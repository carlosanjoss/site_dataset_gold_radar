import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/password";
import { serverError, unauthorized } from "@/lib/responses";

export async function POST(request: Request) {
  try {
    const reviewer = await getAuthenticatedReviewer();
    if (!reviewer) return unauthorized();
    const body = await request.json();
    const newPassword = String(body.newPassword || "");
    const validationError = validatePassword(newPassword);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const password = await hashPassword(newPassword);
    await getPool().query(
      `
        UPDATE gold_reviewers
        SET password_hash = $1,
            password_salt = $2,
            must_change_password = FALSE
        WHERE reviewer_id = $3
      `,
      [password.hash, password.salt, reviewer.reviewerId],
    );
    return NextResponse.json({
      reviewer: { ...reviewer, mustChangePassword: false },
    });
  } catch (cause) {
    return serverError(cause);
  }
}
