import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { serverError, unauthorized } from "@/lib/responses";

export async function GET(request: NextRequest) {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    if (reviewer.mustChangePassword) {
      return NextResponse.json(
        { error: "Troque sua senha antes de consultar o histórico NLI." },
        { status: 403 },
      );
    }
    const page = Math.max(
      1,
      Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1,
    );
    const pageSize = 15;
    const search = (request.nextUrl.searchParams.get("search") || "")
      .trim()
      .slice(0, 160);
    const params: Array<string | number> = [reviewer.reviewerId];
    const filters = ["n.reviewer_id = $1", "n.review_status = 'completed'"];
    if (search) {
      params.push(search);
      filters.push(`(
        a.text_snapshot ILIKE '%' || $${params.length} || '%'
        OR a.analysis_id::TEXT = $${params.length}
        OR a.external_id ILIKE '%' || $${params.length} || '%'
      )`);
    }
    const pool = getPool();
    const totalResult = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM gold_nli_reviews n
        JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
        WHERE ${filters.join(" AND ")}
      `,
      params,
    );
    const total = Number(totalResult.rows[0]?.total || 0);
    params.push(pageSize, (page - 1) * pageSize);
    const result = await pool.query(
      `
        SELECT
          n.nli_review_id, n.analysis_id, n.layer3_level,
          n.layer3_answers, n.layer4_dimensions, n.review_note,
          n.reviewed_at, a.platform, a.content_kind, a.external_id,
          a.text_snapshot, c.final_hate_types
        FROM gold_nli_reviews n
        JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
        LEFT JOIN gold_review_consensus c ON c.analysis_id = n.analysis_id
        WHERE ${filters.join(" AND ")}
        ORDER BY n.reviewed_at DESC, n.nli_review_id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return NextResponse.json(
      {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        rows: result.rows.map((row) => ({
          nliReviewId: Number(row.nli_review_id),
          analysisId: Number(row.analysis_id),
          platform: String(row.platform),
          contentKind: String(row.content_kind),
          externalId: String(row.external_id),
          text: String(row.text_snapshot),
          goldHateTypes: (row.final_hate_types || []).map(String),
          layer3Level: String(row.layer3_level),
          layer3Answers: row.layer3_answers || {},
          layer4Dimensions: (row.layer4_dimensions || []).map(String),
          note: row.review_note ? String(row.review_note) : "",
          reviewedAt: new Date(row.reviewed_at).toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return serverError(cause);
  }
}
