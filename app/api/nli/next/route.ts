import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { currentInference, getPool } from "@/lib/db";
import { NLI_LAYER4_DIMENSIONS } from "@/lib/nli";
import { reviewPlatformPrioritySql } from "@/lib/review-priority";
import { serverError, unauthorized } from "@/lib/responses";

const VALID_PLATFORMS = new Set([
  "facebook",
  "reddit",
  "telegram",
  "tiktok",
  "twitter",
  "whatsapp",
  "youtube",
]);

async function getItem(analysisId: number, reviewerId: number) {
  const result = await getPool().query(
    `
      SELECT
        a.analysis_id, a.platform, a.content_kind, a.external_id,
        a.text_snapshot, a.target_identified, a.analyzed_at,
        c.final_hate_types,
        origin_post.id AS origin_post_id,
        origin_post.external_id AS origin_post_external_id,
        origin_post.title AS origin_post_title,
        origin_post.text AS origin_post_text,
        origin_post.author AS origin_post_author,
        origin_post.url AS origin_post_url,
        origin_post.published_at AS origin_post_published_at,
        parent_comment.id AS parent_comment_id,
        parent_comment.external_id AS parent_comment_external_id,
        parent_comment.text AS parent_comment_text,
        parent_comment.author AS parent_comment_author,
        parent_comment.published_at AS parent_comment_published_at,
        GREATEST(COALESCE(duplicates.duplicate_count, 1) - 1, 0) AS duplicate_count
      FROM gold_nli_reviews n
      JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
      JOIN gold_review_consensus c ON c.analysis_id = a.analysis_id
      LEFT JOIN comments source_comment ON source_comment.id = a.comment_id
      LEFT JOIN posts origin_post ON origin_post.id = source_comment.post_pk
      LEFT JOIN LATERAL (
        SELECT parent.id, parent.external_id, parent.text, parent.author,
               parent.published_at
        FROM comments parent
        WHERE parent.platform = source_comment.platform
          AND parent.external_id = source_comment.parent_external_id
        ORDER BY parent.id
        LIMIT 1
      ) parent_comment ON TRUE
      LEFT JOIN (
        SELECT canonical_analysis_id, COUNT(*) AS duplicate_count
        FROM gold_duplicate_map
        GROUP BY canonical_analysis_id
      ) duplicates ON duplicates.canonical_analysis_id = a.analysis_id
      WHERE n.analysis_id = $1
        AND n.reviewer_id = $2
        AND n.review_status = 'assigned'
        AND c.decision_status IN ('single', 'agreed', 'adjudicated')
        AND c.final_label = 'hate'
    `,
    [analysisId, reviewerId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    analysisId: Number(row.analysis_id),
    platform: String(row.platform),
    contentKind: String(row.content_kind),
    externalId: String(row.external_id),
    text: String(row.text_snapshot),
    goldHateTypes: (row.final_hate_types || []).map(String),
    target: row.target_identified ? String(row.target_identified) : null,
    analyzedAt: new Date(row.analyzed_at).toISOString(),
    duplicateCount: Number(row.duplicate_count || 0),
    originPost: row.origin_post_id
      ? {
          externalId: String(row.origin_post_external_id),
          title: row.origin_post_title ? String(row.origin_post_title) : null,
          text: row.origin_post_text ? String(row.origin_post_text) : null,
          author: row.origin_post_author ? String(row.origin_post_author) : null,
          url: row.origin_post_url ? String(row.origin_post_url) : null,
          publishedAt: row.origin_post_published_at
            ? new Date(row.origin_post_published_at).toISOString()
            : null,
        }
      : null,
    parentComment: row.parent_comment_id
      ? {
          externalId: String(row.parent_comment_external_id),
          text: String(row.parent_comment_text),
          author: row.parent_comment_author
            ? String(row.parent_comment_author)
            : null,
          publishedAt: row.parent_comment_published_at
            ? new Date(row.parent_comment_published_at).toISOString()
            : null,
        }
      : null,
  };
}

async function getStats(reviewerId: number) {
  const result = await getPool().query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE n.reviewer_id = $1 AND n.review_status = 'completed'
        ) AS reviewer_completed,
        COUNT(*) FILTER (WHERE n.review_status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE n.review_status = 'assigned') AS assigned,
        (
          SELECT COUNT(*)
          FROM gold_review_consensus eligible
          WHERE eligible.decision_status IN ('single', 'agreed', 'adjudicated')
            AND eligible.final_label = 'hate'
            AND NOT EXISTS (
              SELECT 1 FROM gold_nli_reviews finished
              WHERE finished.analysis_id = eligible.analysis_id
                AND finished.review_status IN ('assigned', 'completed')
            )
        ) AS waiting
      FROM gold_nli_reviews n
    `,
    [reviewerId],
  );
  const row = result.rows[0];
  return {
    reviewerCompleted: Number(row.reviewer_completed || 0),
    completed: Number(row.completed || 0),
    assigned: Number(row.assigned || 0),
    waiting: Number(row.waiting || 0),
  };
}

export async function GET(request: NextRequest) {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    if (reviewer.mustChangePassword) {
      return NextResponse.json(
        { error: "Troque sua senha antes de iniciar a avaliação NLI." },
        { status: 403 },
      );
    }

    // Verificar se as avaliações estão congeladas
    const freezeCheck = await getPool().query(
      `SELECT frozen FROM gold_review_freeze WHERE freeze_id = 1`,
    );
    if (freezeCheck.rowCount && freezeCheck.rows[0].frozen) {
      return NextResponse.json(
        { item: null, stats: null, frozen: true, message: "No momento não há avaliações a se fazer." },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    const platform = request.nextUrl.searchParams.get("platform") || "";
    if (platform && !VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: "Rede social inválida." }, { status: 400 });
    }

    const client = await getPool().connect();
    const inference = currentInference();
    let analysisId: number | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(731905, $1::INTEGER)", [
        reviewer.reviewerId,
      ]);
      await client.query(
        `
          UPDATE gold_nli_reviews n
          SET review_status = 'invalidated', invalidated_at = NOW()
          WHERE n.reviewer_id = $1
            AND n.review_status = 'assigned'
            AND NOT EXISTS (
              SELECT 1 FROM gold_review_consensus c
              WHERE c.analysis_id = n.analysis_id
                AND c.decision_status IN ('single', 'agreed', 'adjudicated')
                AND c.final_label = 'hate'
            )
        `,
        [reviewer.reviewerId],
      );

      const existingParams: Array<string | number> = [reviewer.reviewerId];
      const existingFilters = [
        "n.reviewer_id = $1",
        "n.review_status = 'assigned'",
        "c.decision_status IN ('single', 'agreed', 'adjudicated')",
        "c.final_label = 'hate'",
      ];
      if (platform) {
        existingParams.push(platform);
        existingFilters.push(`a.platform = $${existingParams.length}`);
      }
      const existing = await client.query(
        `
          SELECT n.analysis_id
          FROM gold_nli_reviews n
          JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
          JOIN gold_review_consensus c ON c.analysis_id = n.analysis_id
          WHERE ${existingFilters.join(" AND ")}
          ORDER BY
            ${reviewPlatformPrioritySql("a.platform")},
            n.assigned_at
          LIMIT 1
        `,
        existingParams,
      );
      analysisId = existing.rowCount
        ? Number(existing.rows[0].analysis_id)
        : null;

      if (!analysisId) {
        const params: Array<string | number> = [
          inference.model,
          inference.promptVersion,
        ];
        const filters = [
          "c.decision_status IN ('single', 'agreed', 'adjudicated')",
          "c.final_label = 'hate'",
          "a.status = 'success'",
          "a.model_name = $1",
          "a.prompt_version = $2",
          "d.analysis_id = d.canonical_analysis_id",
          `NOT EXISTS (
            SELECT 1 FROM gold_nli_reviews active
            WHERE active.analysis_id = a.analysis_id
              AND active.review_status IN ('assigned', 'completed')
          )`,
          `NOT EXISTS (
            SELECT 1 FROM gold_nli_reviews mine
            WHERE mine.analysis_id = a.analysis_id
              AND mine.reviewer_id = ${"$3"}
              AND mine.review_status = 'skipped'
          )`,
        ];
        params.push(reviewer.reviewerId);
        if (platform) {
          params.push(platform);
          filters.push(`a.platform = $${params.length}`);
        }
        const candidate = await client.query(
          `
            WITH completed_by_platform AS (
              SELECT source.platform, COUNT(*) AS completed
              FROM gold_nli_reviews done
              JOIN gemma_hate_analyses source
                ON source.analysis_id = done.analysis_id
              WHERE done.review_status = 'completed'
              GROUP BY source.platform
            )
            SELECT a.analysis_id
            FROM gold_review_consensus c
            JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
            JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
            LEFT JOIN completed_by_platform progress
              ON progress.platform = a.platform
            WHERE ${filters.join(" AND ")}
            ORDER BY
              ${reviewPlatformPrioritySql("a.platform")},
              COALESCE(progress.completed, 0),
              a.analysis_id
            FOR UPDATE OF a SKIP LOCKED
            LIMIT 1
          `,
          params,
        );
        if (candidate.rowCount) {
          analysisId = Number(candidate.rows[0].analysis_id);
          const inserted = await client.query(
            `
              INSERT INTO gold_nli_reviews (
                analysis_id, reviewer_id, review_status, assigned_at,
                invalidated_at
              )
              VALUES ($1, $2, 'assigned', NOW(), NULL)
              ON CONFLICT (analysis_id, reviewer_id) DO UPDATE
              SET review_status = 'assigned', assigned_at = NOW(),
                  invalidated_at = NULL
              WHERE gold_nli_reviews.review_status = 'invalidated'
              RETURNING nli_review_id
            `,
            [analysisId, reviewer.reviewerId],
          );
          if (inserted.rowCount) {
            await client.query(
              `
                INSERT INTO gold_nli_review_audit (
                  nli_review_id, analysis_id, actor_reviewer_id,
                  event_type, new_value
                )
                VALUES ($1, $2, $3, 'assigned',
                  '{"reviewStatus":"assigned"}'::JSONB)
              `,
              [
                Number(inserted.rows[0].nli_review_id),
                analysisId,
                reviewer.reviewerId,
              ],
            );
          } else {
            analysisId = null;
          }
        }
      }
      await client.query("COMMIT");
    } catch (cause) {
      await client.query("ROLLBACK");
      throw cause;
    } finally {
      client.release();
    }

    const [item, stats] = await Promise.all([
      analysisId
        ? getItem(analysisId, reviewer.reviewerId)
        : Promise.resolve(null),
      getStats(reviewer.reviewerId),
    ]);
    return NextResponse.json({
      item,
      stats,
      layer4Dimensions: NLI_LAYER4_DIMENSIONS,
    });
  } catch (cause) {
    return serverError(cause);
  }
}
