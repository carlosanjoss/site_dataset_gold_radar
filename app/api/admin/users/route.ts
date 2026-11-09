import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { currentInference, getPool } from "@/lib/db";
import {
  generateTemporaryPassword,
  hashPassword,
  validatePassword,
} from "@/lib/password";
import {
  MAX_REVIEW_TARGET,
  MINIMUM_SAMPLE_COVERAGE_PERCENT,
  targetProgress,
} from "@/lib/review-targets";
import { serverError, unauthorized } from "@/lib/responses";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

async function requireAdmin() {
  const reviewer = await getAuthenticatedReviewer();
  if (!reviewer) return { reviewer: null, response: unauthorized() };
  if (reviewer.mustChangePassword) {
    return {
      reviewer,
      response: NextResponse.json(
        { error: "Troque sua senha antes de continuar." },
        { status: 403 },
      ),
    };
  }
  if (reviewer.role !== "admin") {
    return {
      reviewer,
      response: NextResponse.json(
        { error: "Acesso exclusivo do administrador." },
        { status: 403 },
      ),
    };
  }
  return { reviewer, response: null };
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;
    const inference = currentInference();
    const [result, policyResult] = await Promise.all([
      getPool().query(
        `
          SELECT
            u.reviewer_id,
            u.display_name,
            u.username,
            u.role,
            u.active,
            u.must_change_password,
            u.double_review_enabled,
            u.review_target,
            u.last_login_at,
            COUNT(r.review_id) FILTER (
              WHERE r.review_status IN ('confirmed', 'corrected')
            )::int AS reviewed_count
          FROM gold_reviewers u
          LEFT JOIN gold_hate_reviews r ON r.reviewer_id = u.reviewer_id
          WHERE u.username IS NOT NULL
          GROUP BY u.reviewer_id
          ORDER BY u.role, u.display_name
        `,
      ),
      getPool().query(
        `
          WITH dataset AS (
            SELECT COUNT(*)::INTEGER AS total
            FROM gemma_hate_analyses
            WHERE status = 'success'
              AND model_name = $1
              AND prompt_version = $2
          ), coverage AS (
            SELECT COUNT(*)::INTEGER AS reviewed
            FROM gold_review_consensus consensus
            JOIN gemma_hate_analyses analysis
              ON analysis.analysis_id = consensus.analysis_id
            WHERE consensus.decision_status IN ('single', 'agreed', 'adjudicated')
              AND analysis.model_name = $1
              AND analysis.prompt_version = $2
          ), reviewers AS (
            SELECT COUNT(*)::INTEGER AS active
            FROM gold_reviewers
            WHERE active IS TRUE
              AND username IS NOT NULL
          )
          SELECT
            dataset.total,
            coverage.reviewed,
            reviewers.active,
            CEIL(dataset.total * ($3::NUMERIC / 100))::INTEGER AS minimum_target
          FROM dataset, coverage, reviewers
        `,
        [
          inference.model,
          inference.promptVersion,
          MINIMUM_SAMPLE_COVERAGE_PERCENT,
        ],
      ),
    ]);
    const policy = policyResult.rows[0];
    const totalSamples = Number(policy.total);
    const globallyReviewed = Number(policy.reviewed);
    const minimumTarget = Number(policy.minimum_target);
    const activeReviewers = Number(policy.active);
    const suggestedInitialTarget = Math.max(
      Math.ceil(minimumTarget / Math.max(activeReviewers + 1, 1)),
      1,
    );
    return NextResponse.json({
      users: result.rows.map((row) => ({
        reviewedCount: Number(row.reviewed_count),
        reviewTarget: Number(row.review_target || 0),
        reviewRemaining: Math.max(
          Number(row.review_target || 0) - Number(row.reviewed_count),
          0,
        ),
        reviewTargetProgress: targetProgress(
          Number(row.reviewed_count),
          Number(row.review_target || 0),
        ),
        reviewerId: Number(row.reviewer_id),
        displayName: String(row.display_name),
        username: String(row.username),
        role: String(row.role),
        active: Boolean(row.active),
        mustChangePassword: Boolean(row.must_change_password),
        doubleReviewEnabled: Boolean(row.double_review_enabled),
        lastLoginAt: row.last_login_at
          ? new Date(row.last_login_at).toISOString()
          : null,
      })),
      targetPolicy: {
        minimumCoveragePercent: MINIMUM_SAMPLE_COVERAGE_PERCENT,
        totalSamples,
        minimumTarget,
        globallyReviewed,
        remainingToMinimum: Math.max(minimumTarget - globallyReviewed, 0),
        minimumProgress: targetProgress(globallyReviewed, minimumTarget),
        activeReviewers,
        suggestedInitialTarget,
      },
    });
  } catch (cause) {
    return serverError(cause);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;
    const body = await request.json();
    const reviewerId = Number(body.reviewerId);
    if (!Number.isSafeInteger(reviewerId) || reviewerId <= 0) {
      return NextResponse.json(
        { error: "Avaliador inválido." },
        { status: 400 },
      );
    }
    const action = String(body.action || "");
    if (action === "resetPassword" || action === "reactivate") {
      if (reviewerId === auth.reviewer?.reviewerId) {
        return NextResponse.json(
          { error: "Use a troca de senha da própria conta." },
          { status: 400 },
        );
      }
      const temporaryPassword = generateTemporaryPassword();
      const password = await hashPassword(temporaryPassword);
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const target = await client.query(
          `
            SELECT reviewer_id, display_name, username, role, active
            FROM gold_reviewers
            WHERE reviewer_id = $1
              AND username IS NOT NULL
            FOR UPDATE
          `,
          [reviewerId],
        );
        if (!target.rowCount) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Usuário não encontrado." },
            { status: 404 },
          );
        }
        const targetUser = target.rows[0];
        if (action === "resetPassword" && !targetUser.active) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Reative o usuário antes de redefinir a senha." },
            { status: 409 },
          );
        }
        await client.query(
          `
            UPDATE gold_reviewers
            SET password_hash = $1,
                password_salt = $2,
                must_change_password = TRUE,
                active = TRUE
            WHERE reviewer_id = $3
          `,
          [password.hash, password.salt, reviewerId],
        );
        await client.query(
          "DELETE FROM gold_reviewer_sessions WHERE reviewer_id = $1",
          [reviewerId],
        );
        await client.query("COMMIT");
        return NextResponse.json({
          user: {
            reviewerId,
            displayName: String(targetUser.display_name),
            username: String(targetUser.username),
            role: String(targetUser.role),
            active: true,
          },
          temporaryPassword,
          action,
        });
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    }
    if (body.reviewTarget !== undefined) {
      const reviewTarget = Number(body.reviewTarget);
      if (
        !Number.isSafeInteger(reviewTarget) ||
        reviewTarget < 1 ||
        reviewTarget > MAX_REVIEW_TARGET
      ) {
        return NextResponse.json(
          {
            error: `A meta deve ser um número inteiro entre 1 e ${MAX_REVIEW_TARGET}.`,
          },
          { status: 400 },
        );
      }
      const result = await getPool().query(
        `
          UPDATE gold_reviewers reviewer
          SET review_target = $1
          WHERE reviewer.reviewer_id = $2
            AND reviewer.username IS NOT NULL
            AND reviewer.active IS TRUE
            AND $1 >= (
              SELECT COUNT(*)
              FROM gold_hate_reviews review
              WHERE review.reviewer_id = reviewer.reviewer_id
                AND review.review_status IN ('confirmed', 'corrected')
            )
          RETURNING reviewer_id, review_target
        `,
        [reviewTarget, reviewerId],
      );
      if (!result.rowCount) {
        return NextResponse.json(
          {
            error:
              "A meta não pode ser menor que o total já avaliado, e a conta precisa estar ativa.",
          },
          { status: 409 },
        );
      }
      return NextResponse.json({
        reviewerId,
        reviewTarget: Number(result.rows[0].review_target),
      });
    }
    if (typeof body.doubleReviewEnabled !== "boolean") {
      return NextResponse.json(
        { error: "Informe se o avaliador participará da revisão dupla." },
        { status: 400 },
      );
    }
    const result = await getPool().query(
      `
        UPDATE gold_reviewers
        SET double_review_enabled = $1
        WHERE reviewer_id = $2
          AND username IS NOT NULL
          AND active IS TRUE
        RETURNING reviewer_id, double_review_enabled
      `,
      [body.doubleReviewEnabled, reviewerId],
    );
    if (!result.rowCount) {
      return NextResponse.json(
        { error: "Avaliador não encontrado." },
        { status: 404 },
      );
    }
    return NextResponse.json({
      reviewerId,
      doubleReviewEnabled: Boolean(
        result.rows[0].double_review_enabled,
      ),
    });
  } catch (cause) {
    return serverError(cause);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;
    const reviewerId = Number(new URL(request.url).searchParams.get("reviewerId"));
    if (!Number.isSafeInteger(reviewerId) || reviewerId <= 0) {
      return NextResponse.json(
        { error: "Usuário inválido." },
        { status: 400 },
      );
    }
    if (reviewerId === auth.reviewer?.reviewerId) {
      return NextResponse.json(
        { error: "Você não pode excluir o acesso da própria conta." },
        { status: 400 },
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        `
          SELECT reviewer_id, display_name, username, role, active
          FROM gold_reviewers
          WHERE reviewer_id = $1
            AND username IS NOT NULL
          FOR UPDATE
        `,
        [reviewerId],
      );
      if (!target.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Usuário não encontrado." },
          { status: 404 },
        );
      }
      const targetUser = target.rows[0];
      if (targetUser.active && targetUser.role === "admin") {
        const admins = await client.query(
          `
            SELECT COUNT(*)::int AS total
            FROM gold_reviewers
            WHERE role = 'admin'
              AND active IS TRUE
          `,
        );
        if (Number(admins.rows[0].total) <= 1) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "O último administrador ativo não pode ser excluído." },
            { status: 409 },
          );
        }
      }

      await client.query(
        `
          UPDATE gold_reviewers
          SET active = FALSE,
              double_review_enabled = FALSE
          WHERE reviewer_id = $1
        `,
        [reviewerId],
      );
      await client.query(
        "DELETE FROM gold_reviewer_sessions WHERE reviewer_id = $1",
        [reviewerId],
      );
      await client.query(
        `
          DELETE FROM gold_hate_reviews
          WHERE reviewer_id = $1
            AND review_status = 'assigned'
        `,
        [reviewerId],
      );
      await client.query(
        `
          UPDATE gold_nli_reviews
          SET review_status = 'invalidated', invalidated_at = NOW()
          WHERE reviewer_id = $1
            AND review_status = 'assigned'
        `,
        [reviewerId],
      );
      await client.query("COMMIT");
      return NextResponse.json({
        user: {
          reviewerId,
          displayName: String(targetUser.display_name),
          username: String(targetUser.username),
          active: false,
        },
      });
    } catch (cause) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  } catch (cause) {
    return serverError(cause);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.response) return auth.response;
    const body = await request.json();
    const displayName = String(body.displayName || "").trim();
    const username = String(body.username || "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : "reviewer";
    const temporaryPassword =
      String(body.temporaryPassword || "") || generateTemporaryPassword();
    const requestedReviewTarget = Number(body.reviewTarget);

    if (displayName.length < 2 || displayName.length > 120) {
      return NextResponse.json(
        { error: "Informe o nome completo do usuário." },
        { status: 400 },
      );
    }
    if (!USERNAME_PATTERN.test(username)) {
      return NextResponse.json(
        {
          error:
            "O usuário deve ter de 3 a 64 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado.",
        },
        { status: 400 },
      );
    }
    if (
      body.reviewTarget !== undefined &&
      (!Number.isSafeInteger(requestedReviewTarget) ||
        requestedReviewTarget < 1 ||
        requestedReviewTarget > MAX_REVIEW_TARGET)
    ) {
      return NextResponse.json(
        {
          error: `A meta deve ser um número inteiro entre 1 e ${MAX_REVIEW_TARGET}.`,
        },
        { status: 400 },
      );
    }
    const validationError = validatePassword(temporaryPassword);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const password = await hashPassword(temporaryPassword);
    const reviewerCode = username
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "-")
      .slice(0, 32);
    const pool = getPool();
    let reviewTarget = requestedReviewTarget;
    if (body.reviewTarget === undefined) {
      const inference = currentInference();
      const suggested = await pool.query(
        `
          WITH dataset AS (
            SELECT CEIL(
              COUNT(*) * ($3::NUMERIC / 100)
            )::INTEGER AS minimum_target
            FROM gemma_hate_analyses
            WHERE status = 'success'
              AND model_name = $1
              AND prompt_version = $2
          ), reviewers AS (
            SELECT COUNT(*)::INTEGER AS active
            FROM gold_reviewers
            WHERE active IS TRUE
              AND username IS NOT NULL
          )
          SELECT GREATEST(
            CEIL(dataset.minimum_target::NUMERIC / (reviewers.active + 1))::INTEGER,
            1
          ) AS suggested_target
          FROM dataset, reviewers
        `,
        [
          inference.model,
          inference.promptVersion,
          MINIMUM_SAMPLE_COVERAGE_PERCENT,
        ],
      );
      reviewTarget = Number(suggested.rows[0].suggested_target);
    }
    const result = await pool.query(
      `
        INSERT INTO gold_reviewers (
          display_name, reviewer_code, username, password_hash, password_salt,
          role, must_change_password, review_target
        )
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)
        RETURNING reviewer_id
      `,
      [
        displayName,
        reviewerCode,
        username,
        password.hash,
        password.salt,
        role,
        reviewTarget,
      ],
    );
    return NextResponse.json(
      {
        user: {
          reviewerId: Number(result.rows[0].reviewer_id),
          displayName,
          username,
          role,
          reviewTarget,
        },
        temporaryPassword,
      },
      { status: 201 },
    );
  } catch (cause) {
    const databaseError = cause as { code?: string };
    if (databaseError.code === "23505") {
      return NextResponse.json(
        { error: "Esse nome de usuário já está cadastrado." },
        { status: 409 },
      );
    }
    return serverError(cause);
  }
}
