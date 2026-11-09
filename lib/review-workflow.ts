import type { PoolClient } from "pg";

type CompletedReview = {
  review_id: string | number;
  reviewer_id: string | number;
  final_label: "hate" | "nao_hate";
  final_hate_types: string[];
  reviewed_at: Date | string;
};

function normalizedDecision(review: CompletedReview) {
  return {
    label: review.final_label,
    types: (review.final_hate_types || []).map(String).sort(),
  };
}

export async function refreshConsensus(
  client: PoolClient,
  analysisId: number,
) {
  const targetResult = await client.query(
    `
      SELECT COALESCE(i.target_reviews, 1) AS target_reviews
      FROM gemma_hate_analyses a
      LEFT JOIN gold_sampling_batch_items i ON i.analysis_id = a.analysis_id
      WHERE a.analysis_id = $1
    `,
    [analysisId],
  );
  if (!targetResult.rowCount) return null;
  const targetReviews = Number(targetResult.rows[0].target_reviews);
  const completedResult = await client.query<CompletedReview>(
    `
      SELECT
        review_id,
        reviewer_id,
        final_label,
        final_hate_types,
        reviewed_at
      FROM gold_hate_reviews
      WHERE analysis_id = $1
        AND review_status IN ('confirmed', 'corrected')
      ORDER BY review_round, reviewed_at, review_id
    `,
    [analysisId],
  );
  const completed = completedResult.rows;

  if (completed.length < targetReviews) {
    await client.query(
      `
        INSERT INTO gold_review_consensus (
          analysis_id, decision_status, final_label, final_hate_types,
          resolved_by, resolved_at, updated_at
        )
        VALUES ($1, 'awaiting_reviews', NULL, ARRAY[]::TEXT[], NULL, NULL, NOW())
        ON CONFLICT (analysis_id) DO UPDATE
        SET decision_status = 'awaiting_reviews',
            final_label = NULL,
            final_hate_types = ARRAY[]::TEXT[],
            resolved_by = NULL,
            resolved_at = NULL,
            updated_at = NOW()
      `,
      [analysisId],
    );
    return { status: "awaiting_reviews" as const };
  }

  const first = normalizedDecision(completed[0]);
  const allAgree = completed
    .slice(1, targetReviews)
    .every((review) => {
      const decision = normalizedDecision(review);
      return (
        decision.label === first.label &&
        JSON.stringify(decision.types) === JSON.stringify(first.types)
      );
    });

  if (targetReviews === 1 || allAgree) {
    const decisionStatus = targetReviews === 1 ? "single" : "agreed";
    const resolvedAt = completed
      .slice(0, targetReviews)
      .map((review) => new Date(review.reviewed_at))
      .sort((left, right) => right.getTime() - left.getTime())[0];
    await client.query(
      `
        INSERT INTO gold_review_consensus (
          analysis_id, decision_status, final_label, final_hate_types,
          resolved_by, resolved_at, updated_at
        )
        VALUES ($1, $2, $3, $4, NULL, $5, NOW())
        ON CONFLICT (analysis_id) DO UPDATE
        SET decision_status = EXCLUDED.decision_status,
            final_label = EXCLUDED.final_label,
            final_hate_types = EXCLUDED.final_hate_types,
            resolved_by = NULL,
            resolved_at = EXCLUDED.resolved_at,
            updated_at = NOW()
      `,
      [analysisId, decisionStatus, first.label, first.types, resolvedAt],
    );
    return { status: decisionStatus, decision: first };
  }

  await client.query(
    `
      INSERT INTO gold_review_consensus (
        analysis_id, decision_status, final_label, final_hate_types,
        resolved_by, resolved_at, updated_at
      )
      VALUES ($1, 'conflict', NULL, ARRAY[]::TEXT[], NULL, NULL, NOW())
      ON CONFLICT (analysis_id) DO UPDATE
      SET decision_status = 'conflict',
          final_label = NULL,
          final_hate_types = ARRAY[]::TEXT[],
          resolved_by = NULL,
          resolved_at = NULL,
          updated_at = NOW()
    `,
    [analysisId],
  );
  return { status: "conflict" as const };
}

export async function writeAudit(
  client: PoolClient,
  input: {
    analysisId: number;
    reviewId?: number | null;
    actorReviewerId?: number | null;
    eventType: string;
    previousValue?: unknown;
    newValue?: unknown;
    metadata?: unknown;
  },
) {
  await client.query(
    `
      INSERT INTO gold_review_audit (
        analysis_id, review_id, actor_reviewer_id, event_type,
        previous_value, new_value, metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
    `,
    [
      input.analysisId,
      input.reviewId || null,
      input.actorReviewerId || null,
      input.eventType,
      JSON.stringify(input.previousValue ?? null),
      JSON.stringify(input.newValue ?? null),
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export async function syncNliEligibility(
  client: PoolClient,
  analysisId: number,
) {
  const consensus = await client.query(
    `
      SELECT decision_status, final_label
      FROM gold_review_consensus
      WHERE analysis_id = $1
    `,
    [analysisId],
  );
  const eligible = Boolean(
    consensus.rowCount &&
      ["single", "agreed", "adjudicated"].includes(
        String(consensus.rows[0].decision_status),
      ) &&
      consensus.rows[0].final_label === "hate",
  );
  if (eligible) return;

  const invalidated = await client.query(
    `
      UPDATE gold_nli_reviews
      SET review_status = 'invalidated',
          invalidated_at = NOW()
      WHERE analysis_id = $1
        AND review_status = 'assigned'
      RETURNING nli_review_id, reviewer_id
    `,
    [analysisId],
  );
  for (const row of invalidated.rows) {
    await client.query(
      `
        INSERT INTO gold_nli_review_audit (
          nli_review_id, analysis_id, actor_reviewer_id,
          event_type, previous_value, new_value
        )
        VALUES ($1, $2, $3, 'eligibility_invalidated',
          '{"reviewStatus":"assigned"}'::JSONB,
          '{"reviewStatus":"invalidated"}'::JSONB)
      `,
      [Number(row.nli_review_id), analysisId, Number(row.reviewer_id)],
    );
  }
}