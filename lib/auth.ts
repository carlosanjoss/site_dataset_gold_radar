import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getPool } from "@/lib/db";

export const SESSION_COOKIE = "gold_reviewer_session";

export type AuthenticatedReviewer = {
  reviewerId: number;
  displayName: string;
  reviewerCode: string;
  username: string;
  role: "admin" | "reviewer";
  mustChangePassword: boolean;
};

export function hashSession(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getAuthenticatedReviewer(): Promise<AuthenticatedReviewer | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const result = await getPool().query(
    `
      SELECT
        r.reviewer_id,
        r.display_name,
        r.reviewer_code,
        r.username,
        r.role,
        r.must_change_password
      FROM gold_reviewer_sessions s
      JOIN gold_reviewers r ON r.reviewer_id = s.reviewer_id
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND r.active IS TRUE
    `,
    [hashSession(token)],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    reviewerId: Number(row.reviewer_id),
    displayName: String(row.display_name),
    reviewerCode: String(row.reviewer_code),
    username: String(row.username),
    role: row.role === "admin" ? "admin" : "reviewer",
    mustChangePassword: Boolean(row.must_change_password),
  };
}
