import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { currentInference, getPool } from "@/lib/db";
import { serverError, unauthorized } from "@/lib/responses";

export async function GET() {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    if (reviewer.mustChangePassword) {
      return NextResponse.json(
        { error: "Troque sua senha antes de iniciar a revisão." },
        { status: 403 },
      );
    }
    const inference = currentInference();
    const pool = getPool();
    const [reviewerResult, globalResult] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*) FILTER (
              WHERE review_status IN ('confirmed', 'corrected')
            ) AS reviewed,
            COUNT(*) FILTER (WHERE review_status = 'confirmed') AS confirmed,
            COUNT(*) FILTER (WHERE review_status = 'corrected') AS corrected,
            COUNT(*) FILTER (WHERE review_status = 'skipped') AS skipped
          FROM gold_hate_reviews
          WHERE reviewer_id = $1
        `,
        [reviewer.reviewerId],
      ),
      pool.query(
        `
          SELECT
            (
              SELECT COUNT(*)
              FROM gemma_hate_analyses a
              WHERE a.status = 'success'
                AND a.model_name = $1
                AND a.prompt_version = $2
            ) AS total,
            (
              SELECT COUNT(*)
              FROM gold_review_consensus c
              JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
              WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
                AND a.model_name = $1
                AND a.prompt_version = $2
            ) AS reviewed
        `,
        [inference.model, inference.promptVersion],
      ),
    ]);
    const mine = reviewerResult.rows[0];
    const global = globalResult.rows[0];
    return NextResponse.json({
      reviewer: {
        reviewed: Number(mine.reviewed),
        confirmed: Number(mine.confirmed),
        corrected: Number(mine.corrected),
        skipped: Number(mine.skipped),
      },
      global: {
        reviewed: Number(global.reviewed),
        total: Number(global.total),
      },
    });
  } catch (cause) {
    return serverError(cause);
  }
}
