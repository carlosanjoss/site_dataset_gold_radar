import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { currentInference, getPool } from "@/lib/db";
import { writeAudit } from "@/lib/review-workflow";
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
const PLATFORM_COVERAGE_TARGET_PERCENT = 35;

async function getCategories() {
  const result = await getPool().query(
    `
      SELECT
        category_code,
        category_name,
        description,
        positive_example,
        boundary_example
      FROM gemma_hate_categories
      WHERE active IS TRUE
      ORDER BY sort_order
    `,
  );
  return result.rows.map((row) => ({
    code: String(row.category_code),
    name: String(row.category_name),
    description: row.description ? String(row.description) : null,
    positiveExample: row.positive_example
      ? String(row.positive_example)
      : null,
    boundaryExample: row.boundary_example
      ? String(row.boundary_example)
      : null,
  }));
}

async function getReviewItem(analysisId: number, reviewerId: number) {
  const result = await getPool().query(
    `
      SELECT
        a.analysis_id,
        a.platform,
        a.content_kind,
        a.external_id,
        a.text_snapshot,
        a.pred_label,
        a.hate_probability,
        a.hate_types,
        a.target_identified,
        a.textual_evidence,
        a.justification,
        a.analyzed_at,
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
        r.review_round,
        COALESCE(i.target_reviews, 1) AS target_reviews,
        GREATEST(COALESCE(d.duplicate_count, 1) - 1, 0) AS duplicate_count
      FROM gemma_hate_analyses a
      JOIN gold_hate_reviews r
        ON r.analysis_id = a.analysis_id
       AND r.reviewer_id = $2
      LEFT JOIN gold_sampling_batch_items i
        ON i.batch_item_id = r.batch_item_id
      LEFT JOIN comments source_comment ON source_comment.id = a.comment_id
      LEFT JOIN posts origin_post ON origin_post.id = source_comment.post_pk
      LEFT JOIN LATERAL (
        SELECT
          parent.id,
          parent.external_id,
          parent.text,
          parent.author,
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
      ) d ON d.canonical_analysis_id = a.analysis_id
      WHERE a.analysis_id = $1
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
    gemmaLabel: String(row.pred_label),
    hateProbability: Number(row.hate_probability),
    hateTypes: (row.hate_types || [])
      .map(String)
      .filter((code: string) => code !== "other"),
    target: row.target_identified ? String(row.target_identified) : null,
    evidence: row.textual_evidence ? String(row.textual_evidence) : null,
    justification: String(row.justification),
    analyzedAt: new Date(row.analyzed_at).toISOString(),
    originPost: row.origin_post_id
      ? {
          externalId: String(row.origin_post_external_id),
          title: row.origin_post_title
            ? String(row.origin_post_title)
            : null,
          text: row.origin_post_text ? String(row.origin_post_text) : null,
          author: row.origin_post_author
            ? String(row.origin_post_author)
            : null,
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
    reviewRound: Number(row.review_round || 1),
    targetReviews: Number(row.target_reviews || 1),
    duplicateCount: Number(row.duplicate_count || 0),
  };
}

export async function GET(request: NextRequest) {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    if (reviewer.mustChangePassword) {
      return NextResponse.json(
        { error: "Troque sua senha antes de iniciar a revisão." },
        { status: 403 },
      );
    }

    const platform = request.nextUrl.searchParams.get("platform") || "";
    const contentKind = request.nextUrl.searchParams.get("contentKind") || "";
    const gemmaLabel = request.nextUrl.searchParams.get("gemmaLabel") || "";
    if (platform && !VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: "Rede social inválida." }, { status: 400 });
    }
    if (contentKind && !["post", "comment"].includes(contentKind)) {
      return NextResponse.json({ error: "Tipo de conteúdo inválido." }, { status: 400 });
    }
    if (gemmaLabel && !["hate", "nao_hate"].includes(gemmaLabel)) {
      return NextResponse.json({ error: "Rótulo inválido." }, { status: 400 });
    }

    const pool = getPool();
    const inference = currentInference();
    const client = await pool.connect();
    const existingParams: Array<string | number> = [reviewer.reviewerId];
    const existingFilters = [
      "r.reviewer_id = $1",
      "r.review_status = 'assigned'",
    ];
    if (platform) {
      existingParams.push(platform);
      existingFilters.push(`a.platform = $${existingParams.length}`);
    }
    if (contentKind) {
      existingParams.push(contentKind);
      existingFilters.push(`a.content_kind = $${existingParams.length}`);
    }
    if (gemmaLabel) {
      existingParams.push(gemmaLabel);
      existingFilters.push(`a.pred_label = $${existingParams.length}`);
    }
    let analysisId: number | null = null;
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(
        "SELECT pg_advisory_xact_lock(731904, $1::INTEGER)",
        [reviewer.reviewerId],
      );
      const existing = await client.query(
        `
          SELECT r.analysis_id
          FROM gold_hate_reviews r
          JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
          WHERE ${existingFilters.join(" AND ")}
          ORDER BY r.assigned_at
          LIMIT 1
        `,
        existingParams,
      );
      analysisId = existing.rowCount
        ? Number(existing.rows[0].analysis_id)
        : null;

      if (!analysisId) {
        const batchParams: Array<string | number> = [
          reviewer.reviewerId,
          inference.model,
          inference.promptVersion,
          PLATFORM_COVERAGE_TARGET_PERCENT,
        ];
        const batchFilters = [
          "b.status = 'active'",
          `NOT EXISTS (
            SELECT 1
            FROM gold_hate_reviews mine
            WHERE mine.analysis_id = i.analysis_id
              AND mine.reviewer_id = $1
          )`,
          `(
            SELECT COUNT(*)
            FROM gold_hate_reviews taken
            WHERE taken.analysis_id = i.analysis_id
              AND taken.review_status <> 'skipped'
          ) < i.target_reviews`,
          `(
            i.target_reviews = 1
            OR EXISTS (
              SELECT 1
              FROM gold_reviewers eligible
              WHERE eligible.reviewer_id = $1
                AND eligible.double_review_enabled IS TRUE
            )
          )`,
        ];
        if (platform) {
          batchParams.push(platform);
          batchFilters.push(`a.platform = $${batchParams.length}`);
        }
        if (contentKind) {
          batchParams.push(contentKind);
          batchFilters.push(`a.content_kind = $${batchParams.length}`);
        }
        if (gemmaLabel) {
          batchParams.push(gemmaLabel);
          batchFilters.push(`a.pred_label = $${batchParams.length}`);
        }

        const batchCandidate = await client.query(
          `
            WITH platform_totals AS MATERIALIZED (
              SELECT a.platform, COUNT(*) AS total
              FROM gemma_hate_analyses a
              WHERE a.status = 'success'
                AND a.model_name = $2
                AND a.prompt_version = $3
              GROUP BY a.platform
            ), platform_work AS MATERIALIZED (
              SELECT a.platform, COUNT(DISTINCT r.analysis_id) AS work_count
              FROM gold_hate_reviews r
              JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
              WHERE r.review_status <> 'skipped'
                AND a.status = 'success'
                AND a.model_name = $2
                AND a.prompt_version = $3
              GROUP BY a.platform
            ), platform_coverage AS (
              SELECT
                totals.platform,
                totals.total,
                COALESCE(work.work_count, 0) AS work_count,
                CEIL(
                  totals.total * ($4::NUMERIC / 100)
                )::BIGINT AS target
              FROM platform_totals totals
              LEFT JOIN platform_work work ON work.platform = totals.platform
            )
            SELECT
              i.batch_item_id,
              i.analysis_id,
              i.target_reviews,
              (
                CASE
                  WHEN NOT EXISTS (
                    SELECT 1
                    FROM gold_hate_reviews taken
                    WHERE taken.analysis_id = i.analysis_id
                      AND taken.review_round = 1
                      AND taken.review_status <> 'skipped'
                  ) THEN 1
                  ELSE 2
                END
              ) AS review_round
            FROM gold_sampling_batch_items i
            JOIN gold_sampling_batches b ON b.batch_id = i.batch_id
            JOIN gemma_hate_analyses a ON a.analysis_id = i.analysis_id
            JOIN platform_coverage coverage ON coverage.platform = a.platform
            WHERE ${batchFilters.join(" AND ")}
            ORDER BY
              CASE
                WHEN coverage.work_count < coverage.target THEN 0
                ELSE 1
              END,
              coverage.work_count::NUMERIC / GREATEST(coverage.target, 1),
              b.created_at,
              i.batch_item_id
            FOR UPDATE OF i SKIP LOCKED
            LIMIT 1
          `,
          batchParams,
        );

        if (batchCandidate.rowCount) {
          const row = batchCandidate.rows[0];
          analysisId = Number(row.analysis_id);
          const inserted = await client.query(
            `
              INSERT INTO gold_hate_reviews
                (
                  analysis_id, reviewer_id, review_status,
                  batch_item_id, review_round
                )
              VALUES ($1, $2, 'assigned', $3, $4)
              ON CONFLICT DO NOTHING
              RETURNING review_id
            `,
            [
              analysisId,
              reviewer.reviewerId,
              Number(row.batch_item_id),
              Number(row.review_round),
            ],
          );
          if (inserted.rowCount) {
            await writeAudit(client, {
              analysisId,
              reviewId: Number(inserted.rows[0].review_id),
              actorReviewerId: reviewer.reviewerId,
              eventType: "assigned",
              newValue: {
                reviewRound: Number(row.review_round),
                targetReviews: Number(row.target_reviews),
                batchItemId: Number(row.batch_item_id),
              },
            });
          } else {
            analysisId = null;
          }
        } else {
          const params: Array<string | number> = [
            inference.model,
            inference.promptVersion,
            PLATFORM_COVERAGE_TARGET_PERCENT,
            reviewer.reviewerId,
          ];
          const filters = [
            "a.status = 'success'",
            "a.model_name = $1",
            "a.prompt_version = $2",
            "d.analysis_id = d.canonical_analysis_id",
            `NOT EXISTS (
              SELECT 1 FROM gold_hate_reviews mine
              WHERE mine.analysis_id = a.analysis_id
                AND mine.reviewer_id = $4
            )`,
            `NOT EXISTS (
              SELECT 1 FROM gold_hate_reviews r
              WHERE r.analysis_id = a.analysis_id
                AND r.review_status <> 'skipped'
            )`,
            `NOT EXISTS (
              SELECT 1 FROM gold_sampling_batch_items bi
              WHERE bi.analysis_id = a.analysis_id
            )`,
          ];
          if (platform) {
            params.push(platform);
            filters.push(`a.platform = $${params.length}`);
          }
          if (contentKind) {
            params.push(contentKind);
            filters.push(`a.content_kind = $${params.length}`);
          }
          if (gemmaLabel) {
            params.push(gemmaLabel);
            filters.push(`a.pred_label = $${params.length}`);
          }
          const candidate = await client.query(
            `
              WITH platform_totals AS MATERIALIZED (
                SELECT source.platform, COUNT(*) AS total
                FROM gemma_hate_analyses source
                WHERE source.status = 'success'
                  AND source.model_name = $1
                  AND source.prompt_version = $2
                GROUP BY source.platform
              ), platform_work AS MATERIALIZED (
                SELECT source.platform, COUNT(DISTINCT r.analysis_id) AS work_count
                FROM gold_hate_reviews r
                JOIN gemma_hate_analyses source
                  ON source.analysis_id = r.analysis_id
                WHERE r.review_status <> 'skipped'
                  AND source.status = 'success'
                  AND source.model_name = $1
                  AND source.prompt_version = $2
                GROUP BY source.platform
              ), platform_coverage AS (
                SELECT
                  totals.platform,
                  totals.total,
                  COALESCE(work.work_count, 0) AS work_count,
                  CEIL(
                    totals.total * ($3::NUMERIC / 100)
                  )::BIGINT AS target
                FROM platform_totals totals
                LEFT JOIN platform_work work
                  ON work.platform = totals.platform
              )
              SELECT a.analysis_id
              FROM gemma_hate_analyses a
              JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
              JOIN platform_coverage coverage ON coverage.platform = a.platform
              WHERE ${filters.join(" AND ")}
              ORDER BY
                CASE
                  WHEN coverage.work_count < coverage.target THEN 0
                  ELSE 1
                END,
                coverage.work_count::NUMERIC / GREATEST(coverage.target, 1),
                CASE WHEN a.pred_label = 'hate' THEN 0 ELSE 1 END,
                ABS(COALESCE(a.hate_probability, 0.5) - 0.5),
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
                INSERT INTO gold_hate_reviews
                  (analysis_id, reviewer_id, review_status, review_round)
                VALUES ($1, $2, 'assigned', 1)
                ON CONFLICT DO NOTHING
                RETURNING review_id
              `,
              [analysisId, reviewer.reviewerId],
            );
            if (inserted.rowCount) {
              await writeAudit(client, {
                analysisId,
                reviewId: Number(inserted.rows[0].review_id),
                actorReviewerId: reviewer.reviewerId,
                eventType: "assigned",
                newValue: { reviewRound: 1, targetReviews: 1 },
              });
            } else {
              analysisId = null;
            }
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

    const [item, categories] = await Promise.all([
      analysisId
        ? getReviewItem(analysisId, reviewer.reviewerId)
        : Promise.resolve(null),
      getCategories(),
    ]);
    return NextResponse.json(
      { item, categories },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (cause) {
    return serverError(cause);
  }
}
