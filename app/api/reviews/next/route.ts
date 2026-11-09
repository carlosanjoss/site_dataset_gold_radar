import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { currentInference, getPool } from "@/lib/db";
import {
  reviewPlatformPriority,
  reviewPlatformOrderValuesSql,
  reviewPlatformPrioritySql,
} from "@/lib/review-priority";
import { MINIMUM_SAMPLE_COVERAGE_PERCENT } from "@/lib/review-targets";
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
const PLATFORM_COVERAGE_TARGET_PERCENT = MINIMUM_SAMPLE_COVERAGE_PERCENT;

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

    // Verificar se as avaliações estão congeladas
    const freezeCheck = await getPool().query(
      `SELECT frozen FROM gold_review_freeze WHERE freeze_id = 1`,
    );
    if (freezeCheck.rowCount && freezeCheck.rows[0].frozen) {
      return NextResponse.json(
        { item: null, categories: [], frozen: true, message: "No momento não há avaliações a se fazer." },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
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
      await client.query(
        `
          WITH dataset AS (
            SELECT CEIL(
              COUNT(*) * ($3::NUMERIC / 100)
            )::INTEGER AS minimum_target
            FROM gemma_hate_analyses
            WHERE status = 'success'
              AND model_name = $1
              AND prompt_version = $2
          ), active_reviewers AS (
            SELECT COUNT(*)::INTEGER AS total
            FROM gold_reviewers
            WHERE active IS TRUE
              AND username IS NOT NULL
          ), allocation AS (
            SELECT GREATEST(
              CEIL(
                dataset.minimum_target::NUMERIC /
                GREATEST(active_reviewers.total, 1)
              )::INTEGER,
              1
            ) AS increment
            FROM dataset, active_reviewers
          ), completed AS (
            SELECT COUNT(*)::INTEGER AS total
            FROM gold_hate_reviews
            WHERE reviewer_id = $4
              AND review_status IN ('confirmed', 'corrected')
          )
          UPDATE gold_reviewers target
          SET review_target = GREATEST(
            target.review_target + allocation.increment,
            completed.total + allocation.increment
          )
          FROM allocation, completed
          WHERE target.reviewer_id = $4
            AND target.active IS TRUE
            AND target.review_target <= completed.total
        `,
        [
          inference.model,
          inference.promptVersion,
          MINIMUM_SAMPLE_COVERAGE_PERCENT,
          reviewer.reviewerId,
        ],
      );
      const existing = await client.query(
        `
          SELECT r.analysis_id
          FROM gold_hate_reviews r
          JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
          WHERE ${existingFilters.join(" AND ")}
          ORDER BY
            ${reviewPlatformPrioritySql("a.platform")},
            r.assigned_at
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
                SELECT COALESCE(MAX(review_round), 0) + 1
                FROM gold_hate_reviews r
                WHERE r.analysis_id = i.analysis_id
                  AND r.review_status <> 'skipped'
              ) AS review_round
            FROM gold_sampling_batch_items i
            JOIN gold_sampling_batches b ON b.batch_id = i.batch_id
            JOIN gemma_hate_analyses a ON a.analysis_id = i.analysis_id
            JOIN platform_coverage coverage ON coverage.platform = a.platform
            WHERE ${batchFilters.join(" AND ")}
            ORDER BY
              ${reviewPlatformPrioritySql("a.platform")},
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
          // Step 1: Get platform coverage (lightweight, cached per request)
          const coverageResult = await client.query(
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
              )
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
            `,
            [inference.model, inference.promptVersion, PLATFORM_COVERAGE_TARGET_PERCENT],
          );

          const coverageByPlatform = new Map();
          for (const row of coverageResult.rows) {
            coverageByPlatform.set(String(row.platform), {
              total: Number(row.total),
              workCount: Number(row.work_count),
              target: Number(row.target),
            });
          }

          // Step 2: Get a small candidate pool per platform using the fast
          // platform index, then balance the preferred platforms in memory.
          const candidateParams: Array<string | number> = [
            inference.model,
            inference.promptVersion,
            reviewer.reviewerId,
          ];
          let candidatePlatformParamIdx = 4;
          let candidateContentKindParamIdx = 0;
          let candidateGemmaLabelParamIdx = 0;

          if (platform) {
            candidateParams.push(platform);
            candidatePlatformParamIdx = candidateParams.length;
          }
          if (contentKind) {
            candidateParams.push(contentKind);
            candidateContentKindParamIdx = candidateParams.length;
          }
          if (gemmaLabel) {
            candidateParams.push(gemmaLabel);
            candidateGemmaLabelParamIdx = candidateParams.length;
          }

          const candidateQuery = `
            WITH platform_order(platform, priority) AS (
              VALUES
                ${reviewPlatformOrderValuesSql()}
            )
            SELECT
              candidate.analysis_id,
              candidate.platform,
              candidate.pred_label,
              candidate.hate_probability
            FROM platform_order desired
            CROSS JOIN LATERAL (
              SELECT
                a.analysis_id,
                a.platform,
                a.pred_label,
                a.hate_probability
              FROM gemma_hate_analyses a
              WHERE a.platform = desired.platform
                AND a.status = 'success'
                AND a.model_name = $1
                AND a.prompt_version = $2
                ${platform ? `AND a.platform = $${candidatePlatformParamIdx}` : ""}
                ${contentKind ? `AND a.content_kind = $${candidateContentKindParamIdx}` : ""}
                ${gemmaLabel ? `AND a.pred_label = $${candidateGemmaLabelParamIdx}` : ""}
                AND NOT EXISTS (
                  SELECT 1 FROM gold_hate_reviews mine
                  WHERE mine.analysis_id = a.analysis_id
                    AND mine.reviewer_id = $3
                )
                AND NOT EXISTS (
                  SELECT 1 FROM gold_hate_reviews r
                  WHERE r.analysis_id = a.analysis_id
                    AND r.review_status <> 'skipped'
                )
                AND NOT EXISTS (
                  SELECT 1 FROM gold_sampling_batch_items bi
                  WHERE bi.analysis_id = a.analysis_id
                )
                AND EXISTS (
                  SELECT 1 FROM gold_duplicate_map d
                  WHERE d.analysis_id = a.analysis_id
                )
              ORDER BY
                CASE WHEN a.pred_label = 'hate' THEN 0 ELSE 1 END,
                ABS(COALESCE(a.hate_probability, 0.5) - 0.5),
                a.analysis_id
              LIMIT 20
            ) candidate
            ORDER BY
              desired.priority,
              desired.platform,
              CASE WHEN candidate.pred_label = 'hate' THEN 0 ELSE 1 END,
              ABS(COALESCE(candidate.hate_probability, 0.5) - 0.5),
              candidate.analysis_id
          `;

          const candidateResult = await client.query(
            candidateQuery,
            candidateParams,
          );

          // Step 3: Sort candidates by platform coverage priority in memory
          if (candidateResult.rowCount && candidateResult.rowCount > 0) {
            const candidates = candidateResult.rows.map((row) => ({
              analysisId: Number(row.analysis_id),
              platform: String(row.platform),
              predLabel: String(row.pred_label),
              hateProbability: Number(row.hate_probability),
            }));

            // Prefer the scarce-platform tier, then keep coverage balanced
            // between platforms in the same tier.
            candidates.sort((a, b) => {
              const priorityDifference =
                reviewPlatformPriority(a.platform) -
                reviewPlatformPriority(b.platform);
              if (priorityDifference !== 0) return priorityDifference;
              const covA = coverageByPlatform.get(a.platform) ?? {
                workCount: 0,
                target: 1,
              };
              const covB = coverageByPlatform.get(b.platform) ?? {
                workCount: 0,
                target: 1,
              };
              const aBelow = covA.workCount < covA.target ? 0 : 1;
              const bBelow = covB.workCount < covB.target ? 0 : 1;
              if (aBelow !== bBelow) return aBelow - bBelow;
              const aRatio = covA.workCount / Math.max(covA.target, 1);
              const bRatio = covB.workCount / Math.max(covB.target, 1);
              if (aRatio !== bRatio) return aRatio - bRatio;
              return 0; // Already pre-sorted by hate label and probability
            });

            for (const candidate of candidates) {
              const inserted = await client.query(
                `
                  INSERT INTO gold_hate_reviews
                    (analysis_id, reviewer_id, review_status, review_round)
                  VALUES ($1, $2, 'assigned', 1)
                  ON CONFLICT DO NOTHING
                  RETURNING review_id
                `,
                [candidate.analysisId, reviewer.reviewerId],
              );
              if (!inserted.rowCount) continue;

              analysisId = candidate.analysisId;
              await writeAudit(client, {
                analysisId,
                reviewId: Number(inserted.rows[0].review_id),
                actorReviewerId: reviewer.reviewerId,
                eventType: "assigned",
                newValue: { reviewRound: 1, targetReviews: 1 },
              });
              break;
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
