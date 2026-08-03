import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { serverError, unauthorized } from "@/lib/responses";

const PAGE_SIZE = 15;
const MAX_PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    if (reviewer.mustChangePassword) {
      return NextResponse.json(
        { error: "Troque sua senha antes de consultar o histórico." },
        { status: 403 },
      );
    }

    const page = Math.max(
      1,
      Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) ||
        1,
    );
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(
        1,
        Number.parseInt(
          request.nextUrl.searchParams.get("pageSize") || String(PAGE_SIZE),
          10,
        ) || PAGE_SIZE,
      ),
    );
    const search = (
      request.nextUrl.searchParams.get("search") || ""
    ).trim().slice(0, 160);
    const offset = (page - 1) * pageSize;
    const params: Array<string | number> = [reviewer.reviewerId];
    const filters = [
      "r.reviewer_id = $1",
      "r.review_status IN ('confirmed', 'corrected')",
    ];

    if (search) {
      params.push(search);
      filters.push(`(
        a.text_snapshot ILIKE '%' || $${params.length} || '%'
        OR a.analysis_id::TEXT = $${params.length}
        OR a.external_id ILIKE '%' || $${params.length} || '%'
      )`);
    }

    const pool = getPool();
    const countResult = await pool.query(
      `
        SELECT COUNT(*)::BIGINT AS total
        FROM gold_hate_reviews r
        JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
        WHERE ${filters.join(" AND ")}
      `,
      params,
    );
    const total = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    params.push(pageSize, offset);
    const rows = await pool.query(
      `
        SELECT
          r.review_id,
          r.review_status,
          r.final_label,
          r.final_hate_types,
          r.review_note,
          r.reviewed_at,
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
          GREATEST(COALESCE(d.duplicate_count, 1) - 1, 0)
            AS duplicate_count
        FROM gold_hate_reviews r
        JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
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
        WHERE ${filters.join(" AND ")}
        ORDER BY r.reviewed_at DESC NULLS LAST, r.review_id DESC
        LIMIT $${params.length - 1}
        OFFSET $${params.length}
      `,
      params,
    );

    return NextResponse.json(
      {
        page,
        pageSize,
        total,
        totalPages,
        rows: rows.rows.map((row) => ({
          reviewId: Number(row.review_id),
          reviewStatus: String(row.review_status),
          finalLabel: String(row.final_label),
          finalHateTypes: (row.final_hate_types || [])
            .map(String)
            .filter((code: string) => code !== "other"),
          note: row.review_note ? String(row.review_note) : "",
          reviewedAt: new Date(row.reviewed_at).toISOString(),
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
          target: row.target_identified
            ? String(row.target_identified)
            : null,
          evidence: row.textual_evidence
            ? String(row.textual_evidence)
            : null,
          justification: String(row.justification),
          analyzedAt: new Date(row.analyzed_at).toISOString(),
          originPost: row.origin_post_id
            ? {
                externalId: String(row.origin_post_external_id),
                title: row.origin_post_title
                  ? String(row.origin_post_title)
                  : null,
                text: row.origin_post_text
                  ? String(row.origin_post_text)
                  : null,
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
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return serverError(cause);
  }
}
