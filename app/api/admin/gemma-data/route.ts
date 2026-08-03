import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getPool } from "@/lib/db";
import { serverError } from "@/lib/responses";

const VALID_PLATFORMS = new Set([
  "facebook",
  "reddit",
  "telegram",
  "tiktok",
  "twitter",
  "whatsapp",
  "youtube",
]);
const VALID_STATUSES = new Set(["success", "error"]);
const VALID_LABELS = new Set(["hate", "nao_hate"]);
const VALID_KINDS = new Set(["post", "comment"]);
const PAGE_SIZES = new Set([10, 25, 50, 100]);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10));
    const requestedPageSize = Number.parseInt(
      searchParams.get("pageSize") || "25",
      10,
    );
    const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25;
    const platform = String(searchParams.get("platform") || "").toLowerCase();
    const status = String(searchParams.get("status") || "").toLowerCase();
    const label = String(searchParams.get("label") || "").toLowerCase();
    const contentKind = String(
      searchParams.get("contentKind") || "",
    ).toLowerCase();
    const hateType = String(searchParams.get("hateType") || "").slice(0, 80);
    const model = String(searchParams.get("model") || "").slice(0, 120);
    const promptVersion = String(
      searchParams.get("promptVersion") || "",
    ).slice(0, 160);
    const search = String(searchParams.get("search") || "").trim().slice(0, 200);

    if (platform && !VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: "Rede social inválida." }, { status: 400 });
    }
    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }
    if (label && !VALID_LABELS.has(label)) {
      return NextResponse.json({ error: "Rótulo inválido." }, { status: 400 });
    }
    if (contentKind && !VALID_KINDS.has(contentKind)) {
      return NextResponse.json(
        { error: "Tipo de conteúdo inválido." },
        { status: 400 },
      );
    }

    const filters: string[] = [];
    const values: Array<string | number> = [];
    const addFilter = (sql: string, value: string | number) => {
      values.push(value);
      filters.push(sql.replace("?", `$${values.length}`));
    };

    if (platform) addFilter("a.platform = ?", platform);
    if (status) addFilter("a.status = ?", status);
    if (label) addFilter("a.pred_label = ?", label);
    if (contentKind) addFilter("a.content_kind = ?", contentKind);
    if (hateType) addFilter("? = ANY(a.hate_types)", hateType);
    if (model) addFilter("a.model_name = ?", model);
    if (promptVersion) addFilter("a.prompt_version = ?", promptVersion);
    if (search) {
      values.push(`%${search}%`);
      const parameter = `$${values.length}`;
      const searchConditions = [
        `a.text_snapshot ILIKE ${parameter}`,
        `a.external_id ILIKE ${parameter}`,
      ];
      if (/^\d+$/.test(search)) {
        values.push(Number(search));
        searchConditions.push(`a.analysis_id = $${values.length}`);
      }
      filters.push(`(${searchConditions.join(" OR ")})`);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const pool = getPool();
    const [countResult, rowsResult, modelResult, categoryResult] =
      await Promise.all([
        pool.query(
          `SELECT COUNT(*) AS total FROM gemma_hate_analyses a ${where}`,
          values,
        ),
        pool.query(
          `
            SELECT
              a.analysis_id,
              a.run_id,
              gr.run_name,
              a.content_kind,
              a.platform,
              a.external_id,
              a.text_snapshot,
              a.model_name,
              a.prompt_version,
              a.status,
              a.pred_label,
              a.hate_probability,
              a.hate_types,
              a.target_identified,
              a.inference_seconds,
              a.attempt_count,
              a.analyzed_at,
              a.reused_from_analysis_id,
              COALESCE(dm.canonical_analysis_id, a.analysis_id)
                AS canonical_analysis_id,
              GREATEST(COALESCE(duplicates.duplicate_count, 1) - 1, 0)
                AS duplicate_count,
              consensus.decision_status AS review_status,
              consensus.final_label,
              consensus.final_hate_types,
              reviews.reviewer_names AS reviewer_name,
              COALESCE(reviews.human_review_count, 0) AS human_review_count
            FROM gemma_hate_analyses a
            LEFT JOIN gemma_hate_runs gr ON gr.run_id = a.run_id
            LEFT JOIN gold_duplicate_map dm ON dm.analysis_id = a.analysis_id
            LEFT JOIN gold_review_consensus consensus
              ON consensus.analysis_id =
                COALESCE(dm.canonical_analysis_id, a.analysis_id)
            LEFT JOIN LATERAL (
              SELECT
                STRING_AGG(DISTINCT rv.display_name, ', ') AS reviewer_names,
                COUNT(*) FILTER (
                  WHERE hr.review_status IN ('confirmed', 'corrected')
                ) AS human_review_count
              FROM gold_hate_reviews hr
              JOIN gold_reviewers rv ON rv.reviewer_id = hr.reviewer_id
              WHERE hr.analysis_id =
                COALESCE(dm.canonical_analysis_id, a.analysis_id)
            ) reviews ON TRUE
            LEFT JOIN LATERAL (
              SELECT COUNT(*) AS duplicate_count
              FROM gold_duplicate_map grouped_duplicate
              WHERE grouped_duplicate.canonical_analysis_id =
                COALESCE(dm.canonical_analysis_id, a.analysis_id)
            ) duplicates ON TRUE
            ${where}
            ORDER BY a.analysis_id DESC
            LIMIT $${values.length + 1}
            OFFSET $${values.length + 2}
          `,
          [...values, pageSize, (page - 1) * pageSize],
        ),
        pool.query(
          `
            SELECT model_name, prompt_version, COUNT(*) AS total
            FROM gemma_hate_analyses
            GROUP BY model_name, prompt_version
            ORDER BY MAX(analysis_id) DESC
          `,
        ),
        pool.query(
          `
            SELECT category_code, category_name
            FROM gemma_hate_categories
            WHERE active IS TRUE
            ORDER BY sort_order
          `,
        ),
      ]);

    const total = Number(countResult.rows[0].total);
    return NextResponse.json(
      {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        rows: rowsResult.rows.map((row) => ({
        analysisId: Number(row.analysis_id),
        runId: Number(row.run_id),
        runName: row.run_name ? String(row.run_name) : null,
        contentKind: String(row.content_kind),
        platform: String(row.platform),
        externalId: String(row.external_id),
        text: String(row.text_snapshot),
        modelName: String(row.model_name),
        promptVersion: String(row.prompt_version),
        status: String(row.status),
        label: row.pred_label ? String(row.pred_label) : null,
        hateProbability:
          row.hate_probability === null ? null : Number(row.hate_probability),
        hateTypes: (row.hate_types || []).map(String),
        target: row.target_identified
          ? String(row.target_identified)
          : null,
        inferenceSeconds:
          row.inference_seconds === null ? null : Number(row.inference_seconds),
        attemptCount: Number(row.attempt_count || 0),
        analyzedAt: row.analyzed_at
          ? new Date(row.analyzed_at).toISOString()
          : null,
        reusedFromAnalysisId: row.reused_from_analysis_id
          ? Number(row.reused_from_analysis_id)
          : null,
        canonicalAnalysisId: Number(row.canonical_analysis_id),
        duplicateCount: Number(row.duplicate_count),
        review: row.review_status
          ? {
              status: String(row.review_status),
              finalLabel: row.final_label ? String(row.final_label) : null,
              finalHateTypes: (row.final_hate_types || []).map(String),
              reviewerName: row.reviewer_name
                ? String(row.reviewer_name)
                : null,
              humanReviewCount: Number(row.human_review_count),
            }
          : null,
      })),
        filters: {
          models: modelResult.rows.map((row) => ({
            model: String(row.model_name),
            promptVersion: String(row.prompt_version),
            total: Number(row.total),
          })),
          hateTypes: categoryResult.rows.map((row) => ({
            code: String(row.category_code),
            name: String(row.category_name),
          })),
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (cause) {
    return serverError(cause);
  }
}
