import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { currentInference, getPool } from "@/lib/db";
import { syncNliEligibility, writeAudit } from "@/lib/review-workflow";
import { serverError } from "@/lib/responses";

const MAX_BATCH_SIZE = 10_000;
const PLATFORM_COVERAGE_TARGET_PERCENT = 35;

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;
    const pool = getPool();
    const inference = currentInference();
    const [
      reviewersResult,
      batchesResult,
      conflictsResult,
      auditResult,
      duplicateResult,
      platformCoverageResult,
    ] = await Promise.all([
      pool.query(
        `
          SELECT
            u.reviewer_id,
            u.display_name,
            u.username,
            u.role,
            u.double_review_enabled,
            COUNT(r.review_id) FILTER (
              WHERE r.review_round = 2
                AND r.review_status IN ('confirmed', 'corrected')
            ) AS second_reviews
          FROM gold_reviewers u
          LEFT JOIN gold_hate_reviews r ON r.reviewer_id = u.reviewer_id
          WHERE u.username IS NOT NULL AND u.active IS TRUE
          GROUP BY u.reviewer_id
          ORDER BY u.role, u.display_name
        `,
      ),
      pool.query(
        `
          SELECT
            b.batch_id,
            b.batch_name,
            b.requested_size,
            b.selected_size,
            b.double_review_percent,
            b.status,
            b.created_at,
            creator.display_name AS creator_name,
            COUNT(i.batch_item_id) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
            ) AS resolved_items,
            COUNT(i.batch_item_id) FILTER (
              WHERE c.decision_status = 'conflict'
            ) AS conflict_items,
            COUNT(i.batch_item_id) FILTER (
              WHERE c.decision_status = 'awaiting_second'
            ) AS awaiting_second
          FROM gold_sampling_batches b
          LEFT JOIN gold_reviewers creator ON creator.reviewer_id = b.created_by
          LEFT JOIN gold_sampling_batch_items i ON i.batch_id = b.batch_id
          LEFT JOIN gold_review_consensus c ON c.analysis_id = i.analysis_id
          GROUP BY b.batch_id, creator.display_name
          ORDER BY b.created_at DESC
          LIMIT 30
        `,
      ),
      pool.query(
        `
          SELECT
            c.analysis_id,
            a.platform,
            a.content_kind,
            a.text_snapshot,
            a.pred_label,
            a.hate_types,
            a.hate_probability,
            c.updated_at,
            jsonb_agg(
              jsonb_build_object(
                'reviewId', r.review_id,
                'reviewerId', r.reviewer_id,
                'reviewerName', u.display_name,
                'reviewerUsername', u.username,
                'finalLabel', r.final_label,
                'finalHateTypes', r.final_hate_types,
                'note', r.review_note,
                'reviewedAt', r.reviewed_at
              )
              ORDER BY r.review_round, r.reviewed_at
            ) FILTER (
              WHERE r.review_status IN ('confirmed', 'corrected')
            ) AS reviews
          FROM gold_review_consensus c
          JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
          JOIN gold_hate_reviews r ON r.analysis_id = c.analysis_id
          JOIN gold_reviewers u ON u.reviewer_id = r.reviewer_id
          WHERE c.decision_status = 'conflict'
          GROUP BY c.analysis_id, a.analysis_id
          ORDER BY c.updated_at
          LIMIT 50
        `,
      ),
      pool.query(
        `
          SELECT
            au.audit_id,
            au.analysis_id,
            au.event_type,
            au.previous_value,
            au.new_value,
            au.metadata,
            au.created_at,
            actor.display_name AS actor_name,
            actor.username AS actor_username,
            a.platform,
            LEFT(a.text_snapshot, 240) AS text_preview,
            a.pred_label AS gemma_label,
            a.hate_types AS gemma_hate_types
          FROM gold_review_audit au
          JOIN gemma_hate_analyses a ON a.analysis_id = au.analysis_id
          LEFT JOIN gold_reviewers actor
            ON actor.reviewer_id = au.actor_reviewer_id
          ORDER BY au.created_at DESC, au.audit_id DESC
          LIMIT 100
        `,
      ),
      pool.query(
        `
          WITH groups AS (
            SELECT
              d.canonical_analysis_id,
              COUNT(*) AS group_size
            FROM gold_duplicate_map d
            JOIN gemma_hate_analyses a ON a.analysis_id = d.analysis_id
            WHERE a.model_name = $1
              AND a.prompt_version = $2
              AND a.status = 'success'
            GROUP BY d.canonical_analysis_id
          )
          SELECT
            COALESCE(SUM(group_size), 0) AS mapped_analyses,
            COUNT(*) AS unique_texts,
            COALESCE(SUM(group_size - 1), 0) AS duplicate_records,
            COUNT(*) FILTER (WHERE group_size > 1) AS duplicate_groups,
            COALESCE(SUM(group_size - 1) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
            ), 0) AS decisions_reused
          FROM groups g
          LEFT JOIN gold_review_consensus c
            ON c.analysis_id = g.canonical_analysis_id
        `,
        [inference.model, inference.promptVersion],
      ),
      pool.query(
        `
          WITH canonical AS (
            SELECT a.analysis_id, a.platform
            FROM gemma_hate_analyses a
            JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
            WHERE a.model_name = $1
              AND a.prompt_version = $2
              AND a.status = 'success'
              AND d.analysis_id = d.canonical_analysis_id
          ), sampled AS (
            SELECT analysis_id FROM gold_sampling_batch_items
            UNION
            SELECT analysis_id
            FROM gold_hate_reviews
            WHERE review_status <> 'skipped'
          ), resolved AS (
            SELECT analysis_id
            FROM gold_review_consensus
            WHERE decision_status IN ('single', 'agreed', 'adjudicated')
          )
          SELECT
            c.platform,
            COUNT(*) AS total,
            COUNT(s.analysis_id) AS sampled,
            COUNT(r.analysis_id) AS reviewed,
            CEIL(
              COUNT(*) * ($3::NUMERIC / 100)
            )::BIGINT AS target
          FROM canonical c
          LEFT JOIN sampled s ON s.analysis_id = c.analysis_id
          LEFT JOIN resolved r ON r.analysis_id = c.analysis_id
          GROUP BY c.platform
          ORDER BY c.platform
        `,
        [
          inference.model,
          inference.promptVersion,
          PLATFORM_COVERAGE_TARGET_PERCENT,
        ],
      ),
    ]);

    return NextResponse.json({
      inference,
      reviewers: reviewersResult.rows.map((row) => ({
        reviewerId: Number(row.reviewer_id),
        displayName: String(row.display_name),
        username: String(row.username),
        role: String(row.role),
        doubleReviewEnabled: Boolean(row.double_review_enabled),
        secondReviews: Number(row.second_reviews),
      })),
      batches: batchesResult.rows.map((row) => ({
        batchId: Number(row.batch_id),
        name: String(row.batch_name),
        requestedSize: Number(row.requested_size),
        selectedSize: Number(row.selected_size),
        doubleReviewPercent: Number(row.double_review_percent),
        status: String(row.status),
        createdAt: new Date(row.created_at).toISOString(),
        creatorName: row.creator_name ? String(row.creator_name) : null,
        resolvedItems: Number(row.resolved_items),
        conflictItems: Number(row.conflict_items),
        awaitingSecond: Number(row.awaiting_second),
      })),
      conflicts: conflictsResult.rows.map((row) => ({
        analysisId: Number(row.analysis_id),
        platform: String(row.platform),
        contentKind: String(row.content_kind),
        text: String(row.text_snapshot),
        gemmaLabel: String(row.pred_label),
        gemmaHateTypes: (row.hate_types || []).map(String),
        hateProbability:
          row.hate_probability === null ? null : Number(row.hate_probability),
        updatedAt: new Date(row.updated_at).toISOString(),
        reviews: Array.isArray(row.reviews) ? row.reviews : [],
      })),
      audit: auditResult.rows.map((row) => ({
        auditId: Number(row.audit_id),
        analysisId: Number(row.analysis_id),
        eventType: String(row.event_type),
        previousValue: row.previous_value,
        newValue: row.new_value,
        metadata: row.metadata,
        createdAt: new Date(row.created_at).toISOString(),
        actorName: row.actor_name ? String(row.actor_name) : null,
        actorUsername: row.actor_username
          ? String(row.actor_username)
          : null,
        platform: String(row.platform),
        textPreview: String(row.text_preview),
        gemmaLabel: row.gemma_label ? String(row.gemma_label) : null,
        gemmaHateTypes: (row.gemma_hate_types || []).map(String),
      })),
      duplicates: {
        mappedAnalyses: Number(duplicateResult.rows[0].mapped_analyses),
        uniqueTexts: Number(duplicateResult.rows[0].unique_texts),
        duplicateRecords: Number(duplicateResult.rows[0].duplicate_records),
        duplicateGroups: Number(duplicateResult.rows[0].duplicate_groups),
        decisionsReused: Number(duplicateResult.rows[0].decisions_reused),
      },
      platformCoverageTargetPercent: PLATFORM_COVERAGE_TARGET_PERCENT,
      platformCoverage: platformCoverageResult.rows.map((row) => {
        const total = Number(row.total);
        const target = Number(row.target);
        const sampled = Number(row.sampled);
        const reviewed = Number(row.reviewed);
        return {
          platform: String(row.platform),
          total,
          target,
          sampled,
          reviewed,
          remainingToSample: Math.max(target - sampled, 0),
          remainingToReview: Math.max(target - reviewed, 0),
          targetProgress:
            target > 0 ? Math.min(reviewed / target, 1) : 1,
          datasetCoverage: total > 0 ? reviewed / total : 0,
        };
      }),
    });
  } catch (cause) {
    return serverError(cause);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (!auth.reviewer) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }
  const client = await getPool().connect();
  try {
    const body = await request.json();
    const action = String(body.action || "");
    if (action === "create_batch") {
      const name = String(body.name || "").trim().slice(0, 120);
      const requestedSize = Number(body.size);
      const doubleReviewPercent = Number(body.doubleReviewPercent || 0);
      if (!name) {
        return NextResponse.json(
          { error: "Informe um nome para o lote." },
          { status: 400 },
        );
      }
      if (
        !Number.isInteger(requestedSize) ||
        requestedSize < 1 ||
        requestedSize > MAX_BATCH_SIZE
      ) {
        return NextResponse.json(
          { error: `O lote deve ter entre 1 e ${MAX_BATCH_SIZE} itens.` },
          { status: 400 },
        );
      }
      if (
        !Number.isInteger(doubleReviewPercent) ||
        doubleReviewPercent < 0 ||
        doubleReviewPercent > 100
      ) {
        return NextResponse.json(
          { error: "A porcentagem de revisão dupla deve ficar entre 0 e 100." },
          { status: 400 },
        );
      }

      await client.query("BEGIN");
      if (doubleReviewPercent > 0) {
        const eligible = await client.query(
          `
            SELECT COUNT(*) AS total
            FROM gold_reviewers
            WHERE active IS TRUE
              AND username IS NOT NULL
              AND double_review_enabled IS TRUE
          `,
        );
        if (Number(eligible.rows[0].total) < 2) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            {
              error:
                "Selecione pelo menos dois avaliadores para a revisão dupla.",
            },
            { status: 400 },
          );
        }
      }

      const inference = currentInference();
      const candidateLimit = Math.min(requestedSize * 20, 200_000);
      const candidates = await client.query(
        `
          WITH all_canonical AS (
            SELECT a.analysis_id, a.platform
            FROM gemma_hate_analyses a
            JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
            WHERE a.status = 'success'
              AND a.model_name = $1
              AND a.prompt_version = $2
              AND d.analysis_id = d.canonical_analysis_id
          ), sampled AS (
            SELECT analysis_id FROM gold_sampling_batch_items
            UNION
            SELECT analysis_id
            FROM gold_hate_reviews
            WHERE review_status <> 'skipped'
          ), platform_coverage AS (
            SELECT
              a.platform,
              COUNT(*) AS total,
              COUNT(s.analysis_id) AS sampled
            FROM all_canonical a
            LEFT JOIN sampled s ON s.analysis_id = a.analysis_id
            GROUP BY a.platform
          ), canonical AS (
            SELECT
              a.analysis_id,
              a.platform,
              a.pred_label,
              a.hate_types,
              a.hate_probability
            FROM gemma_hate_analyses a
            JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
            WHERE a.status = 'success'
              AND a.model_name = $1
              AND a.prompt_version = $2
              AND d.analysis_id = d.canonical_analysis_id
              AND NOT EXISTS (
                SELECT 1
                FROM gold_sampling_batch_items used
                WHERE used.analysis_id = a.analysis_id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM gold_hate_reviews reviewed
                WHERE reviewed.analysis_id = a.analysis_id
                  AND reviewed.review_status <> 'skipped'
              )
          ), expanded AS (
            SELECT
              c.*,
              bucket.stratum,
              ROW_NUMBER() OVER (
                PARTITION BY c.platform, bucket.stratum
                ORDER BY
                  ABS(COALESCE(c.hate_probability, 0.5) - 0.5),
                  c.analysis_id
              ) AS bucket_rank
            FROM canonical c
            CROSS JOIN LATERAL UNNEST(
              CASE
                WHEN c.pred_label = 'hate' AND CARDINALITY(c.hate_types) > 0
                  THEN c.hate_types
                WHEN c.pred_label = 'hate'
                  THEN ARRAY['hate_sem_tipo']::TEXT[]
                ELSE ARRAY['nao_hate']::TEXT[]
              END
            ) AS bucket(stratum)
          ), ranked AS (
            SELECT
              e.*,
              pc.total,
              pc.sampled,
              CEIL(
                pc.total * ($4::NUMERIC / 100)
              )::BIGINT AS target,
              ROW_NUMBER() OVER (
                PARTITION BY e.platform
                ORDER BY e.bucket_rank, e.stratum, e.analysis_id
              ) AS platform_rank
            FROM expanded e
            JOIN platform_coverage pc ON pc.platform = e.platform
          )
          SELECT analysis_id, platform, stratum, bucket_rank
          FROM ranked
          ORDER BY
            CASE WHEN sampled < target THEN 0 ELSE 1 END,
            platform_rank::NUMERIC / GREATEST(target - sampled, 1),
            bucket_rank,
            platform,
            stratum,
            analysis_id
          LIMIT $3
        `,
        [
          inference.model,
          inference.promptVersion,
          candidateLimit,
          PLATFORM_COVERAGE_TARGET_PERCENT,
        ],
      );

      const selected: Array<{
        analysisId: number;
        stratum: string;
      }> = [];
      const selectedIds = new Set<number>();
      for (const row of candidates.rows) {
        const analysisId = Number(row.analysis_id);
        if (selectedIds.has(analysisId)) continue;
        selectedIds.add(analysisId);
        selected.push({
          analysisId,
          stratum: `${String(row.platform)} · ${String(row.stratum)}`,
        });
        if (selected.length >= requestedSize) break;
      }
      if (!selected.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Não há novos textos disponíveis para criar este lote." },
          { status: 409 },
        );
      }

      const batch = await client.query(
        `
          INSERT INTO gold_sampling_batches (
            batch_name, requested_size, selected_size,
            double_review_percent, created_by
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING batch_id
        `,
        [
          name,
          requestedSize,
          selected.length,
          doubleReviewPercent,
          auth.reviewer.reviewerId,
        ],
      );
      const doubleCount = Math.round(
        (selected.length * doubleReviewPercent) / 100,
      );
      const doubleIndexes = new Set<number>();
      if (doubleCount > 0) {
        for (let index = 0; index < doubleCount; index += 1) {
          doubleIndexes.add(
            Math.min(
              selected.length - 1,
              Math.floor((index * selected.length) / doubleCount),
            ),
          );
        }
      }
      await client.query(
        `
          INSERT INTO gold_sampling_batch_items (
            batch_id, analysis_id, stratum, target_reviews
          )
          SELECT $1, rows.analysis_id, rows.stratum, rows.target_reviews
          FROM UNNEST(
            $2::BIGINT[],
            $3::TEXT[],
            $4::SMALLINT[]
          ) AS rows(analysis_id, stratum, target_reviews)
        `,
        [
          Number(batch.rows[0].batch_id),
          selected.map((item) => item.analysisId),
          selected.map((item) => item.stratum),
          selected.map((_, index) => (doubleIndexes.has(index) ? 2 : 1)),
        ],
      );
      await client.query("COMMIT");
      return NextResponse.json(
        {
          batchId: Number(batch.rows[0].batch_id),
          selectedSize: selected.length,
          doubleReviewItems: doubleIndexes.size,
        },
        { status: 201 },
      );
    }

    if (action === "resolve_conflict") {
      const analysisId = Number(body.analysisId);
      const reviewId = Number(body.reviewId);
      if (
        !Number.isSafeInteger(analysisId) ||
        analysisId <= 0 ||
        !Number.isSafeInteger(reviewId) ||
        reviewId <= 0
      ) {
        return NextResponse.json(
          { error: "Conflito ou decisão inválida." },
          { status: 400 },
        );
      }
      await client.query("BEGIN");
      const conflict = await client.query(
        `
          SELECT decision_status
          FROM gold_review_consensus
          WHERE analysis_id = $1
          FOR UPDATE
        `,
        [analysisId],
      );
      if (
        !conflict.rowCount ||
        conflict.rows[0].decision_status !== "conflict"
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Este conflito já foi resolvido ou não existe." },
          { status: 409 },
        );
      }
      const chosen = await client.query(
        `
          SELECT final_label, final_hate_types
          FROM gold_hate_reviews
          WHERE review_id = $1
            AND analysis_id = $2
            AND review_status IN ('confirmed', 'corrected')
        `,
        [reviewId, analysisId],
      );
      if (!chosen.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "A decisão escolhida não pertence a este conflito." },
          { status: 400 },
        );
      }
      const priorReviews = await client.query(
        `
          SELECT
            r.review_id,
            r.final_label,
            r.final_hate_types,
            u.display_name AS reviewer_name
          FROM gold_hate_reviews r
          JOIN gold_reviewers u ON u.reviewer_id = r.reviewer_id
          WHERE r.analysis_id = $1
            AND r.review_status IN ('confirmed', 'corrected')
          ORDER BY r.review_round
        `,
        [analysisId],
      );
      await client.query(
        `
          UPDATE gold_review_consensus
          SET decision_status = 'adjudicated',
              final_label = $2,
              final_hate_types = $3,
              resolved_by = $4,
              resolved_at = NOW(),
              updated_at = NOW()
          WHERE analysis_id = $1
        `,
        [
          analysisId,
          chosen.rows[0].final_label,
          chosen.rows[0].final_hate_types,
          auth.reviewer.reviewerId,
        ],
      );
      await writeAudit(client, {
        analysisId,
        actorReviewerId: auth.reviewer.reviewerId,
        eventType: "conflict_adjudicated",
        previousValue: { decisionStatus: "conflict" },
        newValue: {
          decisionStatus: "adjudicated",
          selectedReviewId: reviewId,
          finalLabel: chosen.rows[0].final_label,
          finalHateTypes: chosen.rows[0].final_hate_types,
        },
        metadata: { conflictingReviews: priorReviews.rows },
      });
      await syncNliEligibility(client, analysisId);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (cause) {
    await client.query("ROLLBACK").catch(() => undefined);
    return serverError(cause);
  } finally {
    client.release();
  }
}
