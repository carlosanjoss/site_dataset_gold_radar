import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hashSession, SESSION_COOKIE } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { serverError } from "@/lib/responses";

export async function POST() {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (token) {
      await getPool().query(
        "DELETE FROM gold_reviewer_sessions WHERE token_hash = $1",
        [hashSession(token)],
      );
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch (cause) {
    return serverError(cause);
  }
}
