import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getPool } from "@/lib/db";
import { serverError } from "@/lib/responses";

export async function GET(
  _request: Request,
  context: { params: Promise<{ analysisId: string }> },
) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;
    const analysisId = Number((await context.params).analysisId);
    if (!Number.isSafeInteger(analysisId) || analysisId <= 0) {
      return NextResponse.json({ error: "Análise inválida." }, { status: 400 });
    }

    const result = await getPool().query(
      `
        SELECT
          a.*,
          gr.run_name,
          COALESCE(dm.canonical_analysis_id, a.analysis_id)
            AS canonical_analysis_id,
          GREATEST(COALESCE(duplicates.duplicate_count, 1) - 1, 0)
            AS duplicate_count,
          consensus.decision_status AS review_status,
          consensus.final_label,
          consensus.final_hate_types,
          reviews.review_note,
          reviews.assigned_at,
          reviews.reviewed_at,
          reviews.reviewer_names AS reviewer_name,
          reviews.reviewer_usernames AS reviewer_username,
          reviews.human_review_count
        FROM gemma_hate_analyses a
        LEFT JOIN gemma_hate_runs gr ON gr.run_id = a.run_id
        LEFT JOIN gold_duplicate_map dm ON dm.analysis_id = a.analysis_id
        LEFT JOIN gold_review_consensus consensus
          ON consensus.analysis_id =
            COALESCE(dm.canonical_analysis_id, a.analysis_id)
        LEFT JOIN LATERAL (
          SELECT
            STRING_AGG(DISTINCT rv.display_name, ', ') AS reviewer_names,
            STRING_AGG(DISTINCT rv.username, ', ') AS reviewer_usernames,
            STRING_AGG(hr.review_note, E'\n' ORDER BY hr.reviewed_at)
              FILTER (WHERE hr.review_note IS NOT NULL) AS review_note,
            MIN(hr.assigned_at) AS assigned_at,
            MAX(hr.reviewed_at) AS reviewed_at,
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
        WHERE a.analysis_id = $1
      `,
      [analysisId],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Análise não encontrada." },
        { status: 404 },
      );
    }
    const row = result.rows[0];
    return NextResponse.json({
      analysis: {
        analysisId: Number(row.analysis_id),
        runId: Number(row.run_id),
        runName: row.run_name ? String(row.run_name) : null,
        contentKind: String(row.content_kind),
        sourceId:
          row.content_kind === "post"
            ? Number(row.post_id)
            : Number(row.comment_id),
        platform: String(row.platform),
        externalId: String(row.external_id),
        textHash: String(row.text_hash),
        text: String(row.text_snapshot),
        modelName: String(row.model_name),
        promptVersion: String(row.prompt_version),
        status: String(row.status),
        label: row.pred_label ? String(row.pred_label) : null,
        isHate: row.is_hate,
        hateProbability:
          row.hate_probability === null ? null : Number(row.hate_probability),
        hateTypes: (row.hate_types || []).map(String),
        target: row.target_identified
          ? String(row.target_identified)
          : null,
        evidence: row.textual_evidence
          ? String(row.textual_evidence)
          : null,
        justification: row.justification ? String(row.justification) : null,
        rawResponse: row.raw_response ? String(row.raw_response) : null,
        errorMessage: row.error_message ? String(row.error_message) : null,
        attemptCount: Number(row.attempt_count || 0),
        inferenceSeconds:
          row.inference_seconds === null ? null : Number(row.inference_seconds),
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
              note: row.review_note ? String(row.review_note) : null,
              reviewerName: row.reviewer_name
                ? String(row.reviewer_name)
                : null,
              reviewerUsername: row.reviewer_username
                ? String(row.reviewer_username)
                : null,
              humanReviewCount: Number(row.human_review_count),
              assignedAt: row.assigned_at
                ? new Date(row.assigned_at).toISOString()
                : null,
              reviewedAt: row.reviewed_at
                ? new Date(row.reviewed_at).toISOString()
                : null,
            }
          : null,
      },
    });
  } catch (cause) {
    return serverError(cause);
  }
}
