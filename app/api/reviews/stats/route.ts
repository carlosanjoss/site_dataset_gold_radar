import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { currentInference, getPool } from "@/lib/db";
import {
  MINIMUM_SAMPLE_COVERAGE_PERCENT,
  targetProgress,
} from "@/lib/review-targets";
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
    const [reviewerResult, dailyResult, nliResult, globalResult] =
      await Promise.all([
        pool.query(
          `
            SELECT
              COUNT(*) FILTER (
                WHERE review_status IN ('confirmed', 'corrected')
              ) AS reviewed,
              COUNT(*) FILTER (WHERE review_status = 'confirmed') AS confirmed,
              COUNT(*) FILTER (WHERE review_status = 'corrected') AS corrected,
              COUNT(*) FILTER (WHERE review_status = 'skipped') AS skipped,
              COUNT(*) FILTER (WHERE review_status = 'assigned') AS assigned,
              COUNT(*) FILTER (
                WHERE review_status IN ('confirmed', 'corrected')
                  AND (reviewed_at AT TIME ZONE 'America/Sao_Paulo')::DATE =
                    (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE
              ) AS reviewed_today,
              COUNT(*) FILTER (
                WHERE review_status IN ('confirmed', 'corrected')
                  AND (reviewed_at AT TIME ZONE 'America/Sao_Paulo')::DATE >=
                    (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE - 6
              ) AS reviewed_last_7_days,
              AVG(EXTRACT(EPOCH FROM (reviewed_at - assigned_at))) FILTER (
                WHERE review_status IN ('confirmed', 'corrected')
                  AND reviewed_at IS NOT NULL
                  AND reviewed_at >= assigned_at
              ) AS average_review_seconds,
              MIN(reviewed_at) FILTER (
                WHERE review_status IN ('confirmed', 'corrected')
              ) AS first_reviewed_at,
              MAX(reviewed_at) FILTER (
                WHERE review_status IN ('confirmed', 'corrected')
              ) AS last_reviewed_at,
              (
                SELECT review_target
                FROM gold_reviewers
                WHERE reviewer_id = $1
              ) AS review_target
            FROM gold_hate_reviews
            WHERE reviewer_id = $1
          `,
          [reviewer.reviewerId],
        ),
        pool.query(
          `
            WITH days AS (
              SELECT GENERATE_SERIES(
                (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE - 6,
                (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE,
                INTERVAL '1 day'
              )::DATE AS day
            )
            SELECT
              TO_CHAR(days.day, 'YYYY-MM-DD') AS date,
              COUNT(review.review_id)::INTEGER AS reviewed,
              COUNT(review.review_id) FILTER (
                WHERE review.review_status = 'corrected'
              )::INTEGER AS corrected
            FROM days
            LEFT JOIN gold_hate_reviews review
              ON review.reviewer_id = $1
             AND review.review_status IN ('confirmed', 'corrected')
             AND (review.reviewed_at AT TIME ZONE 'America/Sao_Paulo')::DATE =
               days.day
            GROUP BY days.day
            ORDER BY days.day
          `,
          [reviewer.reviewerId],
        ),
        pool.query(
          `
            SELECT
              COUNT(*) FILTER (WHERE review_status = 'completed') AS completed,
              COUNT(*) FILTER (WHERE review_status = 'assigned') AS assigned,
              COUNT(*) FILTER (
                WHERE review_status = 'completed'
                  AND (reviewed_at AT TIME ZONE 'America/Sao_Paulo')::DATE =
                    (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE
              ) AS completed_today,
              COUNT(*) FILTER (
                WHERE review_status = 'completed'
                  AND (reviewed_at AT TIME ZONE 'America/Sao_Paulo')::DATE >=
                    (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE - 6
              ) AS completed_last_7_days
            FROM gold_nli_reviews
            WHERE reviewer_id = $1
          `,
          [reviewer.reviewerId],
        ),
        reviewer.role === "admin"
          ? pool.query(
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
                ) AS reviewed,
                CEIL((
                  SELECT COUNT(*)
                  FROM gemma_hate_analyses a
                  WHERE a.status = 'success'
                    AND a.model_name = $1
                    AND a.prompt_version = $2
                ) * ($3::NUMERIC / 100)) AS minimum_target
            `,
            [
              inference.model,
              inference.promptVersion,
              MINIMUM_SAMPLE_COVERAGE_PERCENT,
            ],
          )
          : Promise.resolve(null),
      ]);
    const mine = reviewerResult.rows[0];
    const mineNli = nliResult.rows[0];
    const global = globalResult?.rows[0];
    const reviewed = Number(mine.reviewed);
    const reviewTarget = Number(mine.review_target || 0);
    return NextResponse.json({
      reviewer: {
        reviewed,
        confirmed: Number(mine.confirmed),
        corrected: Number(mine.corrected),
        skipped: Number(mine.skipped),
        assigned: Number(mine.assigned),
        reviewedToday: Number(mine.reviewed_today),
        reviewedLast7Days: Number(mine.reviewed_last_7_days),
        averageReviewSeconds:
          mine.average_review_seconds === null
            ? null
            : Number(mine.average_review_seconds),
        firstReviewedAt: mine.first_reviewed_at
          ? new Date(mine.first_reviewed_at).toISOString()
          : null,
        lastReviewedAt: mine.last_reviewed_at
          ? new Date(mine.last_reviewed_at).toISOString()
          : null,
        reviewTarget,
        reviewRemaining: Math.max(reviewTarget - reviewed, 0),
        reviewTargetProgress: targetProgress(reviewed, reviewTarget),
        daily: dailyResult.rows.map((row) => ({
          date: String(row.date),
          reviewed: Number(row.reviewed),
          corrected: Number(row.corrected),
        })),
        nli: {
          completed: Number(mineNli.completed),
          assigned: Number(mineNli.assigned),
          completedToday: Number(mineNli.completed_today),
          completedLast7Days: Number(mineNli.completed_last_7_days),
        },
      },
      global:
        reviewer.role === "admin" && global
          ? {
              reviewed: Number(global.reviewed),
              total: Number(global.total),
              minimumCoveragePercent: MINIMUM_SAMPLE_COVERAGE_PERCENT,
              minimumTarget: Number(global.minimum_target),
              remainingToMinimum: Math.max(
                Number(global.minimum_target) - Number(global.reviewed),
                0,
              ),
              minimumProgress: targetProgress(
                Number(global.reviewed),
                Number(global.minimum_target),
              ),
            }
          : null,
    });
  } catch (cause) {
    return serverError(cause);
  }
}
