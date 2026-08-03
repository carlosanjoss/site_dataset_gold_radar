import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { getPool } from "@/lib/db";
import {
  generateTemporaryPassword,
  hashPassword,
  validatePassword,
} from "@/lib/password";
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
    const result = await getPool().query(
      `
        SELECT
          u.reviewer_id,
          u.display_name,
          u.username,
          u.role,
          u.active,
          u.must_change_password,
          u.double_review_enabled,
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
    );
    return NextResponse.json({
      users: result.rows.map((row) => ({
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
        reviewedCount: Number(row.reviewed_count),
      })),
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
    const validationError = validatePassword(temporaryPassword);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const password = await hashPassword(temporaryPassword);
    const reviewerCode = username
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "-")
      .slice(0, 32);
    const result = await getPool().query(
      `
        INSERT INTO gold_reviewers (
          display_name, reviewer_code, username, password_hash, password_salt,
          role, must_change_password
        )
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING reviewer_id
      `,
      [
        displayName,
        reviewerCode,
        username,
        password.hash,
        password.salt,
        role,
      ],
    );
    return NextResponse.json(
      {
        user: {
          reviewerId: Number(result.rows[0].reviewer_id),
          displayName,
          username,
          role,
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
