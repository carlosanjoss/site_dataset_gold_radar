import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { currentInference, getPool } from "@/lib/db";
import { serverError, unauthorized } from "@/lib/responses";

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function count(row: Record<string, unknown>, key: string) {
  return Number(row[key] || 0);
}

export async function GET() {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    if (reviewer.mustChangePassword) {
      return NextResponse.json(
        { error: "Troque sua senha antes de continuar." },
        { status: 403 },
      );
    }
    if (reviewer.role !== "admin") {
      return NextResponse.json(
        { error: "Acesso exclusivo do administrador." },
        { status: 403 },
      );
    }

    const inference = currentInference();
    const params = [inference.model, inference.promptVersion];
    const pool = getPool();
    const [
      analysisResult,
      reviewResult,
      confusionResult,
      platformResult,
      reviewerResult,
      typeResult,
      dailyResult,
      exampleResult,
      nliResult,
      nliModelResult,
      nliModelDimensionResult,
      nliModelComparisonResult,
      nliModelExampleResult,
      nliRunResult,
    ] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*) FILTER (WHERE status = 'success') AS total_analyses,
            COUNT(DISTINCT text_hash) FILTER (WHERE status = 'success') AS unique_texts,
            COUNT(*) FILTER (
              WHERE status = 'success' AND reused_from_analysis_id IS NOT NULL
            ) AS reused_analyses,
            COUNT(*) FILTER (WHERE status = 'error') AS errors,
            AVG(inference_seconds) FILTER (WHERE status = 'success') AS avg_inference_seconds
          FROM gemma_hate_analyses
          WHERE model_name = $1 AND prompt_version = $2
        `,
        params,
      ),
      pool.query(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
            ) AS reviewed,
            COUNT(*) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
            ) AS reviewed_unique_texts,
            COUNT(*) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                AND NOT EXISTS (
                  SELECT 1 FROM gold_hate_reviews corrected_review
                  WHERE corrected_review.analysis_id = c.analysis_id
                    AND corrected_review.review_status = 'corrected'
                )
            ) AS confirmed,
            COUNT(*) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                AND EXISTS (
                  SELECT 1 FROM gold_hate_reviews corrected_review
                  WHERE corrected_review.analysis_id = c.analysis_id
                    AND corrected_review.review_status = 'corrected'
                )
            ) AS corrected,
            (
              SELECT COUNT(*)
              FROM gold_hate_reviews assigned_review
              JOIN gemma_hate_analyses assigned_analysis
                ON assigned_analysis.analysis_id = assigned_review.analysis_id
              WHERE assigned_review.review_status = 'assigned'
                AND assigned_analysis.model_name = $1
                AND assigned_analysis.prompt_version = $2
            ) AS assigned,
            (
              SELECT COUNT(*)
              FROM gold_hate_reviews skipped_review
              JOIN gemma_hate_analyses skipped_analysis
                ON skipped_analysis.analysis_id = skipped_review.analysis_id
              WHERE skipped_review.review_status = 'skipped'
                AND skipped_analysis.model_name = $1
                AND skipped_analysis.prompt_version = $2
            ) AS skipped,
            COUNT(*) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                AND c.resolved_at >= CURRENT_DATE
            ) AS reviewed_today,
            COUNT(*) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                AND c.resolved_at >= CURRENT_DATE - INTERVAL '6 days'
            ) AS reviewed_last_7_days,
            (
              SELECT COUNT(DISTINCT active_review.reviewer_id)
              FROM gold_hate_reviews active_review
              JOIN gemma_hate_analyses active_analysis
                ON active_analysis.analysis_id = active_review.analysis_id
              WHERE active_review.review_status IN ('confirmed', 'corrected')
                AND active_analysis.model_name = $1
                AND active_analysis.prompt_version = $2
            ) AS active_reviewers,
            AVG(
              EXTRACT(EPOCH FROM (
                c.resolved_at - (
                  SELECT MIN(timing_review.assigned_at)
                  FROM gold_hate_reviews timing_review
                  WHERE timing_review.analysis_id = c.analysis_id
                )
              ))
            ) FILTER (
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
            ) AS avg_review_seconds
          FROM gold_review_consensus c
          JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
          WHERE a.status = 'success'
            AND a.model_name = $1
            AND a.prompt_version = $2
        `,
        params,
      ),
      pool.query(
        `
          SELECT
            COUNT(*) AS sample_size,
            COUNT(*) FILTER (
              WHERE a.pred_label = 'hate' AND c.final_label = 'hate'
            ) AS true_positive,
            COUNT(*) FILTER (
              WHERE a.pred_label = 'nao_hate' AND c.final_label = 'nao_hate'
            ) AS true_negative,
            COUNT(*) FILTER (
              WHERE a.pred_label = 'hate' AND c.final_label = 'nao_hate'
            ) AS false_positive,
            COUNT(*) FILTER (
              WHERE a.pred_label = 'nao_hate' AND c.final_label = 'hate'
            ) AS false_negative,
            COUNT(*) FILTER (WHERE a.pred_label = 'hate') AS gemma_hate,
            COUNT(*) FILTER (WHERE c.final_label = 'hate') AS gold_hate,
            COUNT(*) FILTER (
              WHERE a.pred_label = 'hate' AND c.final_label = 'hate'
            ) AS type_sample_size,
            COUNT(*) FILTER (
              WHERE a.pred_label = 'hate'
                AND c.final_label = 'hate'
                AND a.hate_types @> c.final_hate_types
                AND c.final_hate_types @> a.hate_types
            ) AS exact_type_matches
          FROM gold_review_consensus c
          JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
          WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
            AND a.status = 'success'
            AND a.model_name = $1
            AND a.prompt_version = $2
        `,
        params,
      ),
      pool.query(
        `
          WITH analyses AS (
            SELECT platform, COUNT(*) AS total
            FROM gemma_hate_analyses
            WHERE status = 'success'
              AND model_name = $1
              AND prompt_version = $2
            GROUP BY platform
          ), reviews AS (
            SELECT
              a.platform,
              COUNT(*) FILTER (
                  WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
              ) AS reviewed,
              COUNT(*) FILTER (
                WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                  AND EXISTS (
                    SELECT 1 FROM gold_hate_reviews corrected_review
                    WHERE corrected_review.analysis_id = c.analysis_id
                      AND corrected_review.review_status = 'corrected'
                  )
              ) AS corrected,
              COUNT(*) FILTER (
                WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                  AND a.pred_label = c.final_label
              ) AS agreements,
              COUNT(*) FILTER (
                WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                  AND a.pred_label = 'hate' AND c.final_label = 'hate'
              ) AS true_positive,
              COUNT(*) FILTER (
                WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                  AND a.pred_label = 'hate' AND c.final_label = 'nao_hate'
              ) AS false_positive,
              COUNT(*) FILTER (
                WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                  AND a.pred_label = 'nao_hate' AND c.final_label = 'hate'
              ) AS false_negative
            FROM gold_review_consensus c
            JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
            WHERE a.status = 'success'
              AND a.model_name = $1
              AND a.prompt_version = $2
            GROUP BY a.platform
          )
          SELECT
            a.platform,
            a.total,
            COALESCE(r.reviewed, 0) AS reviewed,
            COALESCE(r.corrected, 0) AS corrected,
            COALESCE(r.agreements, 0) AS agreements,
            COALESCE(r.true_positive, 0) AS true_positive,
            COALESCE(r.false_positive, 0) AS false_positive,
            COALESCE(r.false_negative, 0) AS false_negative
          FROM analyses a
          LEFT JOIN reviews r ON r.platform = a.platform
          ORDER BY a.total DESC
        `,
        params,
      ),
      pool.query(
        `
          SELECT
            u.reviewer_id,
            u.display_name,
            u.username,
            COUNT(*) FILTER (
              WHERE a.analysis_id IS NOT NULL
                AND r.review_status IN ('confirmed', 'corrected')
            ) AS reviewed,
            COUNT(*) FILTER (
              WHERE a.analysis_id IS NOT NULL AND r.review_status = 'confirmed'
            ) AS confirmed,
            COUNT(*) FILTER (
              WHERE a.analysis_id IS NOT NULL AND r.review_status = 'corrected'
            ) AS corrected,
            COUNT(*) FILTER (
              WHERE a.analysis_id IS NOT NULL AND r.review_status = 'skipped'
            ) AS skipped,
            MAX(r.reviewed_at) FILTER (
              WHERE a.analysis_id IS NOT NULL
                AND r.review_status IN ('confirmed', 'corrected')
            ) AS last_reviewed_at
          FROM gold_reviewers u
          LEFT JOIN gold_hate_reviews r ON r.reviewer_id = u.reviewer_id
          LEFT JOIN gemma_hate_analyses a
            ON a.analysis_id = r.analysis_id
            AND a.status = 'success'
            AND a.model_name = $1
            AND a.prompt_version = $2
          WHERE u.username IS NOT NULL AND u.active IS TRUE
          GROUP BY u.reviewer_id
          ORDER BY reviewed DESC, u.display_name
        `,
        params,
      ),
      pool.query(
        `
          WITH completed AS (
            SELECT
              COALESCE(a.hate_types, ARRAY[]::TEXT[]) AS gemma_types,
              COALESCE(c.final_hate_types, ARRAY[]::TEXT[]) AS gold_types
            FROM gold_review_consensus c
            JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
            WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
              AND a.status = 'success'
              AND a.model_name = $1
              AND a.prompt_version = $2
          )
          SELECT
            c.category_code,
            c.category_name,
            COUNT(*) FILTER (
              WHERE c.category_code = ANY(completed.gemma_types)
            ) AS predicted,
            COUNT(*) FILTER (
              WHERE c.category_code = ANY(completed.gold_types)
            ) AS gold,
            COUNT(*) FILTER (
              WHERE c.category_code = ANY(completed.gemma_types)
                AND c.category_code = ANY(completed.gold_types)
            ) AS true_positive
          FROM gemma_hate_categories c
          CROSS JOIN completed
          WHERE c.active IS TRUE
          GROUP BY c.category_code, c.category_name, c.sort_order
          ORDER BY c.sort_order
        `,
        params,
      ),
      pool.query(
        `
          SELECT
            c.resolved_at::date AS review_date,
            COUNT(*) AS reviewed,
            COUNT(*) FILTER (
              WHERE EXISTS (
                SELECT 1 FROM gold_hate_reviews corrected_review
                WHERE corrected_review.analysis_id = c.analysis_id
                  AND corrected_review.review_status = 'corrected'
              )
            ) AS corrected
          FROM gold_review_consensus c
          JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
          WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
            AND c.resolved_at >= CURRENT_DATE - INTERVAL '29 days'
            AND a.status = 'success'
            AND a.model_name = $1
            AND a.prompt_version = $2
          GROUP BY c.resolved_at::date
          ORDER BY review_date
        `,
        params,
      ),
      pool.query(
        `
          SELECT *
          FROM (
            SELECT
              a.analysis_id,
              a.platform,
              a.text_snapshot,
              a.pred_label,
              a.hate_types,
              c.final_label,
              c.final_hate_types,
              c.resolved_at,
              CASE
                WHEN a.pred_label = 'hate' AND c.final_label = 'nao_hate'
                  THEN 'false_positive'
                WHEN a.pred_label = 'nao_hate' AND c.final_label = 'hate'
                  THEN 'false_negative'
              END AS outcome,
              ROW_NUMBER() OVER (
                PARTITION BY
                  CASE
                    WHEN a.pred_label = 'hate' AND c.final_label = 'nao_hate'
                      THEN 'false_positive'
                    WHEN a.pred_label = 'nao_hate' AND c.final_label = 'hate'
                      THEN 'false_negative'
                  END
                ORDER BY c.resolved_at DESC
              ) AS example_rank
            FROM gold_review_consensus c
            JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
            WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
              AND a.status = 'success'
              AND a.model_name = $1
              AND a.prompt_version = $2
              AND a.pred_label <> c.final_label
          ) examples
          WHERE example_rank <= 5
          ORDER BY outcome, example_rank
        `,
        params,
      ),
      pool.query(
        `
          WITH eligible AS (
            SELECT c.analysis_id
            FROM gold_review_consensus c
            JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
            JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
            WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
              AND c.final_label = 'hate'
              AND a.status = 'success'
              AND a.model_name = $1
              AND a.prompt_version = $2
              AND d.analysis_id = d.canonical_analysis_id
          ), reviews AS (
            SELECT n.*
            FROM gold_nli_reviews n
            JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
            WHERE a.model_name = $1 AND a.prompt_version = $2
          )
          SELECT
            (SELECT COUNT(*) FROM eligible) AS eligible,
            COUNT(*) FILTER (WHERE review_status = 'completed') AS completed,
            COUNT(*) FILTER (WHERE review_status = 'assigned') AS assigned,
            COUNT(*) FILTER (WHERE review_status = 'skipped') AS skipped,
            COUNT(DISTINCT reviewer_id) FILTER (
              WHERE review_status = 'completed'
            ) AS active_reviewers,
            AVG(EXTRACT(EPOCH FROM (reviewed_at - assigned_at))) FILTER (
              WHERE review_status = 'completed'
            ) AS avg_review_seconds,
            COUNT(*) FILTER (
              WHERE review_status = 'completed' AND layer3_level = 'N1'
            ) AS n1,
            COUNT(*) FILTER (
              WHERE review_status = 'completed' AND layer3_level = 'N2'
            ) AS n2,
            COUNT(*) FILTER (
              WHERE review_status = 'completed' AND layer3_level = 'N3'
            ) AS n3,
            COUNT(*) FILTER (
              WHERE review_status = 'completed' AND layer3_level = 'N4'
            ) AS n4,
            COUNT(*) FILTER (
              WHERE review_status = 'completed' AND layer3_level = 'N5'
            ) AS n5,
            COUNT(*) FILTER (
              WHERE review_status = 'completed'
                AND layer4_dimensions @> ARRAY['authoritarianism']::TEXT[]
            ) AS authoritarianism,
            COUNT(*) FILTER (
              WHERE review_status = 'completed'
                AND layer4_dimensions @> ARRAY['dehumanization']::TEXT[]
            ) AS dehumanization,
            COUNT(*) FILTER (
              WHERE review_status = 'completed'
                AND layer4_dimensions @> ARRAY['factualization']::TEXT[]
            ) AS factualization,
            COUNT(*) FILTER (
              WHERE review_status = 'completed'
                AND layer4_dimensions @> ARRAY['social_dominance']::TEXT[]
            ) AS social_dominance,
            COUNT(*) FILTER (
              WHERE review_status = 'completed'
                AND layer4_dimensions @> ARRAY['revictimization']::TEXT[]
            ) AS revictimization
          FROM reviews
        `,
        params,
      ),
      pool.query(
        `
          WITH eligible AS (
            SELECT DISTINCT a.platform, a.text_hash
            FROM gemma_hate_analyses a
            WHERE a.status = 'success'
              AND a.is_hate IS TRUE
              AND a.model_name = $1
              AND a.prompt_version = $2
              AND NULLIF(BTRIM(a.text_snapshot), '') IS NOT NULL
          ), latest_results AS (
            SELECT DISTINCT ON (r.platform, r.text_hash)
              r.result_id,
              r.platform,
              r.text_hash,
              r.nli_model_name,
              r.primary_score,
              r.toxicity_score,
              r.toxicity_label,
              r.created_at
            FROM radar_nli_layer3_results r
            JOIN gemma_hate_analyses source
              ON source.analysis_id = r.source_gemma_analysis_id
            WHERE source.model_name = $1
              AND source.prompt_version = $2
            ORDER BY r.platform, r.text_hash, r.created_at DESC, r.result_id DESC
          )
          SELECT
            e.platform,
            COUNT(*) AS eligible,
            COUNT(model.result_id) AS processed,
            AVG(model.primary_score) AS avg_primary_score,
            AVG(model.toxicity_score) AS avg_toxicity_score,
            COUNT(*) FILTER (WHERE model.toxicity_label = 'alta') AS high,
            COUNT(*) FILTER (WHERE model.toxicity_label = 'media') AS medium,
            COUNT(*) FILTER (WHERE model.toxicity_label = 'baixa') AS low,
            COUNT(*) FILTER (
              WHERE model.toxicity_label = 'nao_toxico'
            ) AS non_toxic,
            MAX(model.created_at) AS last_processed_at,
            (ARRAY_AGG(model.nli_model_name ORDER BY model.created_at DESC)
              FILTER (WHERE model.nli_model_name IS NOT NULL))[1] AS model_name
          FROM eligible e
          LEFT JOIN latest_results model
            ON model.platform = e.platform AND model.text_hash = e.text_hash
          GROUP BY GROUPING SETS ((e.platform), ())
          ORDER BY e.platform NULLS FIRST
        `,
        params,
      ),
      pool.query(
        `
          WITH latest_results AS (
            SELECT DISTINCT ON (r.platform, r.text_hash)
              r.result_id,
              r.platform,
              r.text_hash,
              r.primary_dimension,
              r.primary_score,
              r.created_at
            FROM radar_nli_layer3_results r
            JOIN gemma_hate_analyses source
              ON source.analysis_id = r.source_gemma_analysis_id
            WHERE source.model_name = $1
              AND source.prompt_version = $2
            ORDER BY r.platform, r.text_hash, r.created_at DESC, r.result_id DESC
          )
          SELECT
            primary_dimension,
            COUNT(*) AS total,
            AVG(primary_score) AS avg_score
          FROM latest_results
          WHERE primary_dimension IS NOT NULL
          GROUP BY primary_dimension
          ORDER BY total DESC, primary_dimension
        `,
        params,
      ),
      pool.query(
        `
          WITH comparisons AS (
            SELECT
              human.layer3_level AS human_level,
              CASE
                WHEN human.layer3_level = 'N1' THEN 'baixa'
                WHEN human.layer3_level IN ('N2', 'N3') THEN 'media'
                WHEN human.layer3_level IN ('N4', 'N5') THEN 'alta'
              END AS human_band,
              model.toxicity_label AS model_band
            FROM gold_nli_reviews human
            JOIN gemma_hate_analyses analysis
              ON analysis.analysis_id = human.analysis_id
            JOIN LATERAL (
              SELECT result.toxicity_label
              FROM radar_nli_layer3_results result
              WHERE result.source_gemma_analysis_id = human.analysis_id
              ORDER BY result.created_at DESC, result.result_id DESC
              LIMIT 1
            ) model ON TRUE
            WHERE human.review_status = 'completed'
              AND analysis.model_name = $1
              AND analysis.prompt_version = $2
          )
          SELECT human_level, human_band, model_band, COUNT(*) AS total
          FROM comparisons
          WHERE human_band IS NOT NULL AND model_band IS NOT NULL
          GROUP BY human_level, human_band, model_band
          ORDER BY human_level, model_band
        `,
        params,
      ),
      pool.query(
        `
          WITH comparisons AS (
            SELECT
              human.analysis_id,
              analysis.platform,
              analysis.text_snapshot,
              human.layer3_level AS human_level,
              CASE
                WHEN human.layer3_level = 'N1' THEN 1
                WHEN human.layer3_level IN ('N2', 'N3') THEN 2
                WHEN human.layer3_level IN ('N4', 'N5') THEN 3
              END AS human_index,
              model.toxicity_label AS model_band,
              CASE model.toxicity_label
                WHEN 'nao_toxico' THEN 0
                WHEN 'baixa' THEN 1
                WHEN 'media' THEN 2
                WHEN 'alta' THEN 3
              END AS model_index,
              model.primary_score,
              human.reviewed_at
            FROM gold_nli_reviews human
            JOIN gemma_hate_analyses analysis
              ON analysis.analysis_id = human.analysis_id
            JOIN LATERAL (
              SELECT result.toxicity_label, result.primary_score
              FROM radar_nli_layer3_results result
              WHERE result.source_gemma_analysis_id = human.analysis_id
              ORDER BY result.created_at DESC, result.result_id DESC
              LIMIT 1
            ) model ON TRUE
            WHERE human.review_status = 'completed'
              AND analysis.model_name = $1
              AND analysis.prompt_version = $2
          )
          SELECT *
          FROM comparisons
          WHERE human_index IS NOT NULL
            AND model_index IS NOT NULL
            AND model_index < human_index
          ORDER BY human_index - model_index DESC, reviewed_at DESC
          LIMIT 5
        `,
        params,
      ),
      pool.query(
        `
          SELECT
            run_id,
            run_name,
            status,
            nli_model_name,
            total_selected,
            processed_count,
            started_at,
            finished_at,
            (
              SELECT COUNT(*)
              FROM radar_nli_runs failed
              WHERE failed.layer_name = 'layer3' AND failed.status = 'failed'
            ) AS failed_runs,
            (
              SELECT COUNT(*)
              FROM radar_nli_runs completed
              WHERE completed.layer_name = 'layer3'
                AND completed.status = 'completed'
            ) AS completed_runs
          FROM radar_nli_runs
          WHERE layer_name = 'layer3'
          ORDER BY started_at DESC
          LIMIT 1
        `,
      ),
    ]);

    const analyses = analysisResult.rows[0] as Record<string, unknown>;
    const reviews = reviewResult.rows[0] as Record<string, unknown>;
    const confusion = confusionResult.rows[0] as Record<string, unknown>;
    const nli = nliResult.rows[0] as Record<string, unknown>;
    const nliModel = nliModelResult.rows.find((row) => row.platform === null) as
      | Record<string, unknown>
      | undefined;
    const nliRun = nliRunResult.rows[0] as Record<string, unknown> | undefined;
    const nliBandIndexes: Record<string, number> = {
      nao_toxico: 0,
      baixa: 1,
      media: 2,
      alta: 3,
    };
    const nliComparisonSample = nliModelComparisonResult.rows.reduce(
      (sum, row) => sum + Number(row.total),
      0,
    );
    const nliExactBandMatches = nliModelComparisonResult.rows.reduce(
      (sum, row) =>
        sum + (row.human_band === row.model_band ? Number(row.total) : 0),
      0,
    );
    const nliNearBandMatches = nliModelComparisonResult.rows.reduce(
      (sum, row) => {
        const humanIndex = nliBandIndexes[String(row.human_band)];
        const modelIndex = nliBandIndexes[String(row.model_band)];
        return sum +
          (Number.isFinite(humanIndex) &&
          Number.isFinite(modelIndex) &&
          Math.abs(humanIndex - modelIndex) <= 1
            ? Number(row.total)
            : 0);
      },
      0,
    );
    const nliBandAbsoluteError = nliModelComparisonResult.rows.reduce(
      (sum, row) => {
        const humanIndex = nliBandIndexes[String(row.human_band)];
        const modelIndex = nliBandIndexes[String(row.model_band)];
        return sum +
          (Number.isFinite(humanIndex) && Number.isFinite(modelIndex)
            ? Math.abs(humanIndex - modelIndex) * Number(row.total)
            : 0);
      },
      0,
    );
    const totalAnalyses = count(analyses, "total_analyses");
    const reviewed = count(reviews, "reviewed");
    const tp = count(confusion, "true_positive");
    const tn = count(confusion, "true_negative");
    const fp = count(confusion, "false_positive");
    const fn = count(confusion, "false_negative");
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      inference: {
        model: inference.model,
        promptVersion: inference.promptVersion,
        averageSeconds: analyses.avg_inference_seconds
          ? Number(analyses.avg_inference_seconds)
          : null,
        errors: count(analyses, "errors"),
      },
      dataset: {
        totalAnalyses,
        uniqueTexts: count(analyses, "unique_texts"),
        reusedAnalyses: count(analyses, "reused_analyses"),
        reviewed,
        reviewedUniqueTexts: count(reviews, "reviewed_unique_texts"),
        confirmed: count(reviews, "confirmed"),
        corrected: count(reviews, "corrected"),
        assigned: count(reviews, "assigned"),
        skipped: count(reviews, "skipped"),
        reviewedToday: count(reviews, "reviewed_today"),
        reviewedLast7Days: count(reviews, "reviewed_last_7_days"),
        activeReviewers: count(reviews, "active_reviewers"),
        averageReviewSeconds: reviews.avg_review_seconds
          ? Number(reviews.avg_review_seconds)
          : null,
        progress: ratio(reviewed, totalAnalyses),
      },
      nli: {
        eligible: count(nli, "eligible"),
        completed: count(nli, "completed"),
        assigned: count(nli, "assigned"),
        skipped: count(nli, "skipped"),
        waiting: Math.max(
          0,
          count(nli, "eligible") -
            count(nli, "completed") -
            count(nli, "assigned"),
        ),
        activeReviewers: count(nli, "active_reviewers"),
        averageReviewSeconds: nli.avg_review_seconds
          ? Number(nli.avg_review_seconds)
          : null,
        progress: ratio(count(nli, "completed"), count(nli, "eligible")),
        layer3: ["N1", "N2", "N3", "N4", "N5"].map((level) => ({
          level,
          count: count(nli, level.toLowerCase()),
        })),
        layer4: [
          ["authoritarianism", "Autoritarismo discursivo"],
          ["dehumanization", "Desumanização"],
          ["factualization", "Produção de factualidade"],
          ["social_dominance", "Dominância Social"],
          ["revictimization", "Revitimização e autovitimização"],
        ].map(([code, name]) => ({ code, name, count: count(nli, code) })),
      },
      nliModel: {
        modelName: nliModel?.model_name ? String(nliModel.model_name) : null,
        eligible: nliModel ? count(nliModel, "eligible") : 0,
        processed: nliModel ? count(nliModel, "processed") : 0,
        coverage: nliModel
          ? ratio(count(nliModel, "processed"), count(nliModel, "eligible"))
          : null,
        averagePrimaryScore:
          nliModel?.avg_primary_score === null ||
          nliModel?.avg_primary_score === undefined
            ? null
            : Number(nliModel.avg_primary_score),
        averageToxicityScore:
          nliModel?.avg_toxicity_score === null ||
          nliModel?.avg_toxicity_score === undefined
            ? null
            : Number(nliModel.avg_toxicity_score),
        lastProcessedAt: nliModel?.last_processed_at
          ? new Date(String(nliModel.last_processed_at)).toISOString()
          : null,
        toxicity: [
          ["nao_toxico", "Não tóxico", "non_toxic"],
          ["baixa", "Baixa", "low"],
          ["media", "Média", "medium"],
          ["alta", "Alta", "high"],
        ].map(([code, name, key]) => ({
          code,
          name,
          count: nliModel ? count(nliModel, key) : 0,
        })),
        primaryDimensions: nliModelDimensionResult.rows.map((row) => ({
          code: String(row.primary_dimension),
          count: Number(row.total),
          averageScore:
            row.avg_score === null ? null : Number(row.avg_score),
        })),
        comparison: {
          sampleSize: nliComparisonSample,
          exactBandAgreement: ratio(nliExactBandMatches, nliComparisonSample),
          nearBandAgreement: ratio(nliNearBandMatches, nliComparisonSample),
          meanAbsoluteError:
            nliComparisonSample > 0
              ? nliBandAbsoluteError / nliComparisonSample
              : null,
          matrix: ["baixa", "media", "alta"].map((humanBand) => ({
            humanBand,
            counts: ["nao_toxico", "baixa", "media", "alta"].map(
              (modelBand) => ({
                modelBand,
                count: nliModelComparisonResult.rows
                  .filter(
                    (row) =>
                      row.human_band === humanBand &&
                      row.model_band === modelBand,
                  )
                  .reduce((sum, row) => sum + Number(row.total), 0),
              }),
            ),
          })),
        },
        run: nliRun
          ? {
              runId: Number(nliRun.run_id),
              runName: String(nliRun.run_name),
              status: String(nliRun.status),
              totalSelected: Number(nliRun.total_selected),
              processedCount: Number(nliRun.processed_count),
              startedAt: new Date(String(nliRun.started_at)).toISOString(),
              finishedAt: nliRun.finished_at
                ? new Date(String(nliRun.finished_at)).toISOString()
                : null,
              completedRuns: count(nliRun, "completed_runs"),
              failedRuns: count(nliRun, "failed_runs"),
            }
          : null,
        platforms: nliModelResult.rows
          .filter((row) => row.platform !== null)
          .map((row) => ({
            platform: String(row.platform),
            eligible: Number(row.eligible),
            processed: Number(row.processed),
            coverage: ratio(Number(row.processed), Number(row.eligible)),
            high: Number(row.high),
            medium: Number(row.medium),
            low: Number(row.low),
            nonToxic: Number(row.non_toxic),
          })),
        underestimatedExamples: nliModelExampleResult.rows.map((row) => ({
          analysisId: Number(row.analysis_id),
          platform: String(row.platform),
          text: String(row.text_snapshot),
          humanLevel: String(row.human_level),
          modelBand: String(row.model_band),
          primaryScore:
            row.primary_score === null ? null : Number(row.primary_score),
        })),
      },
      model: {
        sampleSize: count(confusion, "sample_size"),
        truePositive: tp,
        trueNegative: tn,
        falsePositive: fp,
        falseNegative: fn,
        gemmaHate: count(confusion, "gemma_hate"),
        goldHate: count(confusion, "gold_hate"),
        agreement: ratio(tp + tn, tp + tn + fp + fn),
        precision,
        recall,
        f1:
          precision !== null && recall !== null && precision + recall > 0
            ? (2 * precision * recall) / (precision + recall)
            : null,
        specificity: ratio(tn, tn + fp),
        typeAgreement: ratio(
          count(confusion, "exact_type_matches"),
          count(confusion, "type_sample_size"),
        ),
        examples: {
          falsePositives: exampleResult.rows
            .filter((row) => row.outcome === "false_positive")
            .map((row) => ({
              analysisId: Number(row.analysis_id),
              platform: String(row.platform),
              text: String(row.text_snapshot),
              gemmaLabel: String(row.pred_label),
              gemmaHateTypes: (row.hate_types || []).map(String),
              goldLabel: String(row.final_label),
              goldHateTypes: (row.final_hate_types || []).map(String),
              resolvedAt: new Date(row.resolved_at).toISOString(),
            })),
          falseNegatives: exampleResult.rows
            .filter((row) => row.outcome === "false_negative")
            .map((row) => ({
              analysisId: Number(row.analysis_id),
              platform: String(row.platform),
              text: String(row.text_snapshot),
              gemmaLabel: String(row.pred_label),
              gemmaHateTypes: (row.hate_types || []).map(String),
              goldLabel: String(row.final_label),
              goldHateTypes: (row.final_hate_types || []).map(String),
              resolvedAt: new Date(row.resolved_at).toISOString(),
            })),
        },
      },
      platforms: platformResult.rows.map((row) => {
        const total = Number(row.total);
        const platformReviewed = Number(row.reviewed);
        const platformTp = Number(row.true_positive);
        const platformFp = Number(row.false_positive);
        const platformFn = Number(row.false_negative);
        return {
          platform: String(row.platform),
          total,
          reviewed: platformReviewed,
          corrected: Number(row.corrected),
          progress: ratio(platformReviewed, total),
          agreement: ratio(Number(row.agreements), platformReviewed),
          precision: ratio(platformTp, platformTp + platformFp),
          recall: ratio(platformTp, platformTp + platformFn),
        };
      }),
      reviewers: reviewerResult.rows.map((row) => ({
        reviewerId: Number(row.reviewer_id),
        displayName: String(row.display_name),
        username: String(row.username),
        reviewed: Number(row.reviewed),
        confirmed: Number(row.confirmed),
        corrected: Number(row.corrected),
        skipped: Number(row.skipped),
        lastReviewedAt: row.last_reviewed_at
          ? new Date(row.last_reviewed_at).toISOString()
          : null,
      })),
      hateTypes: typeResult.rows.map((row) => {
        const predicted = Number(row.predicted);
        const gold = Number(row.gold);
        const typeTp = Number(row.true_positive);
        const typePrecision = ratio(typeTp, predicted);
        const typeRecall = ratio(typeTp, gold);
        return {
          code: String(row.category_code),
          name: String(row.category_name),
          predicted,
          gold,
          truePositive: typeTp,
          precision: typePrecision,
          recall: typeRecall,
          f1:
            typePrecision !== null &&
            typeRecall !== null &&
            typePrecision + typeRecall > 0
              ? (2 * typePrecision * typeRecall) /
                (typePrecision + typeRecall)
              : null,
        };
      }),
      daily: dailyResult.rows.map((row) => ({
        date:
          row.review_date instanceof Date
            ? row.review_date.toISOString().slice(0, 10)
            : String(row.review_date).slice(0, 10),
        reviewed: Number(row.reviewed),
        corrected: Number(row.corrected),
      })),
    });
  } catch (cause) {
    return serverError(cause);
  }
}
