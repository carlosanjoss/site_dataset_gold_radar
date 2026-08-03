import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { hashSession, SESSION_COOKIE } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { serverError } from "@/lib/responses";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

async function recordAttempt(username: string, succeeded: boolean) {
  await getPool().query(
    `
      INSERT INTO gold_login_attempts (attempted_username, succeeded)
      VALUES ($1, $2)
    `,
    [username, succeeded],
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!USERNAME_PATTERN.test(username) || !password) {
      return NextResponse.json(
        { error: "Informe usuário e senha válidos." },
        { status: 400 },
      );
    }

    const pool = getPool();
    const recentFailures = await pool.query(
      `
        SELECT COUNT(*)::int AS total
        FROM gold_login_attempts
        WHERE attempted_username = $1
          AND succeeded IS FALSE
          AND attempted_at > NOW() - INTERVAL '15 minutes'
      `,
      [username],
    );
    if (Number(recentFailures.rows[0].total) >= 8) {
      return NextResponse.json(
        { error: "Muitas tentativas. Aguarde 15 minutos e tente novamente." },
        { status: 429 },
      );
    }

    const result = await pool.query(
      `
        SELECT
          reviewer_id,
          display_name,
          reviewer_code,
          username,
          password_hash,
          password_salt,
          role,
          must_change_password,
          active
        FROM gold_reviewers
        WHERE LOWER(username) = $1
      `,
      [username],
    );

    const row = result.rows[0];
    let valid = false;
    if (row?.active && row.password_hash && row.password_salt) {
      valid = await verifyPassword(
        password,
        String(row.password_salt),
        String(row.password_hash),
      );
    } else {
      // Mantém custo semelhante quando o usuário não existe.
      await hashPassword(password, "00000000000000000000000000000000");
    }

    if (!valid) {
      await recordAttempt(username, false);
      return NextResponse.json(
        { error: "Usuário ou senha incorretos." },
        { status: 401 },
      );
    }

    await recordAttempt(username, true);
    const rawToken = randomBytes(32).toString("hex");
    const sessionDays = Math.max(
      1,
      Number.parseInt(process.env.REVIEW_SESSION_DAYS || "7", 10),
    );
    await pool.query(
      `
        INSERT INTO gold_reviewer_sessions
          (reviewer_id, token_hash, expires_at)
        VALUES ($1, $2, NOW() + ($3 || ' days')::interval)
      `,
      [row.reviewer_id, hashSession(rawToken), String(sessionDays)],
    );
    await pool.query(
      "UPDATE gold_reviewers SET last_login_at = NOW() WHERE reviewer_id = $1",
      [row.reviewer_id],
    );
    await pool.query(
      "DELETE FROM gold_login_attempts WHERE attempted_at < NOW() - INTERVAL '2 days'",
    );

    const reviewer = {
      reviewerId: Number(row.reviewer_id),
      displayName: String(row.display_name),
      reviewerCode: String(row.reviewer_code),
      username: String(row.username),
      role: row.role === "admin" ? "admin" : "reviewer",
      mustChangePassword: Boolean(row.must_change_password),
    };
    const response = NextResponse.json({ reviewer });
    response.cookies.set(SESSION_COOKIE, rawToken, {
      httpOnly: true,
      sameSite: "lax",
      secure:
        request.headers.get("x-forwarded-proto") === "https" ||
        process.env.NODE_ENV === "production",
      maxAge: sessionDays * 24 * 60 * 60,
      path: "/",
    });
    return response;
  } catch (cause) {
    return serverError(cause);
  }
}
