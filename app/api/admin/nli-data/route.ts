import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getPool } from "@/lib/db";
import { NLI_LAYER4_DIMENSIONS } from "@/lib/nli";
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
const VALID_STATUSES = new Set([
  "assigned",
  "completed",
  "skipped",
  "invalidated",
]);
const VALID_LEVELS = new Set(["N1", "N2", "N3", "N4", "N5"]);
const VALID_DIMENSIONS = new Set(
  NLI_LAYER4_DIMENSIONS.map((dimension) => dimension.code),
);
const PAGE_SIZES = new Set([10, 25, 50, 100]);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;

    const input = request.nextUrl.searchParams;
    const page = Math.max(1, Number.parseInt(input.get("page") || "1", 10));
    const requestedSize = Number.parseInt(input.get("pageSize") || "25", 10);
    const pageSize = PAGE_SIZES.has(requestedSize) ? requestedSize : 25;
    const platform = String(input.get("platform") || "").toLowerCase();
    const status = String(input.get("status") || "").toLowerCase();
    const level = String(input.get("level") || "").toUpperCase();
    const dimension = String(input.get("dimension") || "").toLowerCase();
    const reviewerId = Number.parseInt(input.get("reviewerId") || "0", 10);
    const search = String(input.get("search") || "").trim().slice(0, 200);

    if (platform && !VALID_PLATFORMS.has(platform)) {
      return NextResponse.json({ error: "Rede social inválida." }, { status: 400 });
    }
    if (status && !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Status NLI inválido." }, { status: 400 });
    }
    if (level && !VALID_LEVELS.has(level)) {
      return NextResponse.json({ error: "Nível NLI inválido." }, { status: 400 });
    }
    if (dimension && !VALID_DIMENSIONS.has(dimension as never)) {
      return NextResponse.json({ error: "Dimensão NLI inválida." }, { status: 400 });
    }

    const filters: string[] = [];
    const values: Array<string | number> = [];
    const add = (condition: string, value: string | number) => {
      values.push(value);
      filters.push(condition.replace("?", `$${values.length}`));
    };
    if (platform) add("a.platform = ?", platform);
    if (status) add("n.review_status = ?", status);
    if (level) add("n.layer3_level = ?", level);
    if (dimension) add("? = ANY(n.layer4_dimensions)", dimension);
    if (reviewerId > 0) add("n.reviewer_id = ?", reviewerId);
    if (search) {
      values.push(`%${search}%`);
      const parameter = `$${values.length}`;
      const searchFilters = [
        `a.text_snapshot ILIKE ${parameter}`,
        `a.external_id ILIKE ${parameter}`,
        `reviewer.display_name ILIKE ${parameter}`,
        `reviewer.username ILIKE ${parameter}`,
      ];
      if (/^\d+$/.test(search)) {
        values.push(Number(search));
        searchFilters.push(`a.analysis_id = $${values.length}`);
      }
      filters.push(`(${searchFilters.join(" OR ")})`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const pool = getPool();
    const [countResult, rowsResult, reviewersResult] = await Promise.all([
      pool.query(
        `
          SELECT COUNT(*) AS total
          FROM gold_nli_reviews n
          JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
          JOIN gold_reviewers reviewer ON reviewer.reviewer_id = n.reviewer_id
          ${where}
        `,
        values,
      ),
      pool.query(
        `
          SELECT
            n.nli_review_id, n.analysis_id, n.review_status,
            n.layer3_level, n.layer3_answers, n.layer4_dimensions,
            n.review_note, n.assigned_at, n.reviewed_at, n.invalidated_at,
            a.platform, a.content_kind, a.external_id, a.text_snapshot,
            c.decision_status AS gold_status, c.final_label AS gold_label,
            c.final_hate_types,
            ARRAY(
              SELECT COALESCE(category.category_name, hate_type.code)
              FROM UNNEST(COALESCE(c.final_hate_types, ARRAY[]::TEXT[]))
                AS hate_type(code)
              LEFT JOIN gemma_hate_categories category
                ON category.category_code = hate_type.code
              WHERE hate_type.code <> 'other'
            ) AS final_hate_type_names,
            reviewer.reviewer_id, reviewer.display_name AS reviewer_name,
            reviewer.username AS reviewer_username,
            model3.nli_model_name AS model3_name,
            model3.primary_dimension AS model3_primary_dimension,
            model3.primary_score AS model3_primary_score,
            model3.active_dimensions AS model3_active_dimensions,
            model3.toxicity_label AS model3_toxicity_label,
            model4.nli_model_name AS model4_name,
            model4.primary_dimension AS model4_primary_dimension,
            model4.primary_score AS model4_primary_score,
            model4.active_dimensions AS model4_active_dimensions
          FROM gold_nli_reviews n
          JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
          JOIN gold_reviewers reviewer ON reviewer.reviewer_id = n.reviewer_id
          LEFT JOIN gold_review_consensus c ON c.analysis_id = n.analysis_id
          LEFT JOIN LATERAL (
            SELECT result.nli_model_name, result.primary_dimension,
                   result.primary_score, result.active_dimensions,
                   result.toxicity_label
            FROM radar_nli_layer3_results result
            WHERE result.source_gemma_analysis_id = n.analysis_id
            ORDER BY result.result_id DESC
            LIMIT 1
          ) model3 ON TRUE
          LEFT JOIN LATERAL (
            SELECT result.nli_model_name, result.primary_dimension,
                   result.primary_score, result.active_dimensions
            FROM radar_nli_layer4_results result
            WHERE result.source_gemma_analysis_id = n.analysis_id
            ORDER BY result.result_id DESC
            LIMIT 1
          ) model4 ON TRUE
          ${where}
          ORDER BY COALESCE(n.reviewed_at, n.assigned_at) DESC,
                   n.nli_review_id DESC
          LIMIT $${values.length + 1}
          OFFSET $${values.length + 2}
        `,
        [...values, pageSize, (page - 1) * pageSize],
      ),
      pool.query(
        `
          SELECT DISTINCT reviewer.reviewer_id, reviewer.display_name,
                          reviewer.username
          FROM gold_nli_reviews n
          JOIN gold_reviewers reviewer ON reviewer.reviewer_id = n.reviewer_id
          ORDER BY reviewer.display_name
        `,
      ),
    ]);

    const total = Number(countResult.rows[0]?.total || 0);
    return NextResponse.json(
      {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        rows: rowsResult.rows.map((row) => ({
          nliReviewId: Number(row.nli_review_id),
          analysisId: Number(row.analysis_id),
          status: String(row.review_status),
          platform: String(row.platform),
          contentKind: String(row.content_kind),
          externalId: String(row.external_id),
          text: String(row.text_snapshot),
          layer3Level: row.layer3_level ? String(row.layer3_level) : null,
          layer3Answers: row.layer3_answers || {},
          layer4Dimensions: (row.layer4_dimensions || []).map(String),
          note: row.review_note ? String(row.review_note) : null,
          assignedAt: new Date(row.assigned_at).toISOString(),
          reviewedAt: row.reviewed_at
            ? new Date(row.reviewed_at).toISOString()
            : null,
          invalidatedAt: row.invalidated_at
            ? new Date(row.invalidated_at).toISOString()
            : null,
          gold: {
            status: row.gold_status ? String(row.gold_status) : null,
            label: row.gold_label ? String(row.gold_label) : null,
            hateTypes: (row.final_hate_types || [])
              .map(String)
              .filter((code: string) => code !== "other"),
            hateTypeNames: (row.final_hate_type_names || []).map(String),
          },
          reviewer: {
            reviewerId: Number(row.reviewer_id),
            name: String(row.reviewer_name),
            username: String(row.reviewer_username),
          },
          model: {
            layer3: row.model3_name
              ? {
                  modelName: String(row.model3_name),
                  primaryDimension: row.model3_primary_dimension
                    ? String(row.model3_primary_dimension)
                    : null,
                  primaryScore:
                    row.model3_primary_score === null
                      ? null
                      : Number(row.model3_primary_score),
                  activeDimensions: (row.model3_active_dimensions || []).map(String),
                  toxicityLabel: row.model3_toxicity_label
                    ? String(row.model3_toxicity_label)
                    : null,
                }
              : null,
            layer4: row.model4_name
              ? {
                  modelName: String(row.model4_name),
                  primaryDimension: row.model4_primary_dimension
                    ? String(row.model4_primary_dimension)
                    : null,
                  primaryScore:
                    row.model4_primary_score === null
                      ? null
                      : Number(row.model4_primary_score),
                  activeDimensions: (row.model4_active_dimensions || []).map(String),
                }
              : null,
          },
        })),
        filters: {
          reviewers: reviewersResult.rows.map((row) => ({
            reviewerId: Number(row.reviewer_id),
            name: String(row.display_name),
            username: String(row.username),
          })),
          dimensions: NLI_LAYER4_DIMENSIONS,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return serverError(cause);
  }
}
