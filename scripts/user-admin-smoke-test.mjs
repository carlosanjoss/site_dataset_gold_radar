import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const root = process.cwd();
for (const envPath of [
  path.join(root, ".env.local"),
  path.join(root, ".env"),
  path.join(root, "..", "social_data_pipeline", ".env"),
]) {
  config({ path: envPath, override: false, quiet: true });
  if (process.env.POSTGRES_URI) break;
}
if (!process.env.POSTGRES_URI) throw new Error("POSTGRES_URI não encontrada.");

const baseUrl = process.env.REVIEW_APP_URL || "http://localhost:3000";
const suffix = Date.now();
const adminUsername = `test.user.admin.${suffix}`;
const targetUsername = `test.user.target.${suffix}`;
const adminPassword = "Admin@Teste123";
const originalTargetPassword = "Original@Teste123";
const reviewerIds = [];
const client = new pg.Client({ connectionString: process.env.POSTGRES_URI });

async function insertUser(username, role, password) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  const result = await client.query(
    `
      INSERT INTO gold_reviewers (
        display_name, reviewer_code, username, password_hash, password_salt,
        role, must_change_password
      ) VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      RETURNING reviewer_id
    `,
    [
      `Teste ${role}`,
      username.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 32),
      username,
      hash,
      salt,
      role,
    ],
  );
  const reviewerId = Number(result.rows[0].reviewer_id);
  reviewerIds.push(reviewerId);
  return reviewerId;
}

async function login(username, password) {
  return fetch(`${baseUrl}/api/reviewers/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

function sessionCookie(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

await client.connect();
try {
  const adminId = await insertUser(adminUsername, "admin", adminPassword);
  const targetId = await insertUser(
    targetUsername,
    "reviewer",
    originalTargetPassword,
  );
  const adminLogin = await login(adminUsername, adminPassword);
  if (!adminLogin.ok) throw new Error("Login do administrador de teste falhou.");
  const adminCookie = sessionCookie(adminLogin);

  const reset = await fetch(`${baseUrl}/api/admin/users`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ reviewerId: targetId, action: "resetPassword" }),
  });
  const resetBody = await reset.json();
  if (!reset.ok || !resetBody.temporaryPassword) {
    throw new Error(`Reset de senha falhou: ${JSON.stringify(resetBody)}`);
  }
  if ((await login(targetUsername, originalTargetPassword)).ok) {
    throw new Error("A senha anterior continuou válida após o reset.");
  }
  const resetLogin = await login(targetUsername, resetBody.temporaryPassword);
  const resetLoginBody = await resetLogin.json();
  if (!resetLogin.ok || !resetLoginBody.reviewer?.mustChangePassword) {
    throw new Error("A senha temporária não exigiu troca no próximo acesso.");
  }

  const remove = await fetch(
    `${baseUrl}/api/admin/users?reviewerId=${targetId}`,
    { method: "DELETE", headers: { Cookie: adminCookie } },
  );
  if (!remove.ok) {
    throw new Error(`Exclusão de acesso falhou: ${await remove.text()}`);
  }
  if ((await login(targetUsername, resetBody.temporaryPassword)).ok) {
    throw new Error("O usuário excluído ainda conseguiu entrar.");
  }
  const inactive = await client.query(
    `
      SELECT active,
        (SELECT COUNT(*) FROM gold_reviewer_sessions WHERE reviewer_id = $1) AS sessions
      FROM gold_reviewers
      WHERE reviewer_id = $1
    `,
    [targetId],
  );
  if (inactive.rows[0]?.active || Number(inactive.rows[0]?.sessions) !== 0) {
    throw new Error("A exclusão não removeu o acesso e as sessões.");
  }

  const removeSelf = await fetch(
    `${baseUrl}/api/admin/users?reviewerId=${adminId}`,
    { method: "DELETE", headers: { Cookie: adminCookie } },
  );
  if (removeSelf.status !== 400) {
    throw new Error("O administrador conseguiu excluir a própria conta.");
  }

  const reactivate = await fetch(`${baseUrl}/api/admin/users`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ reviewerId: targetId, action: "reactivate" }),
  });
  const reactivateBody = await reactivate.json();
  if (!reactivate.ok || !reactivateBody.temporaryPassword) {
    throw new Error(`Reativação falhou: ${JSON.stringify(reactivateBody)}`);
  }
  if (!(await login(targetUsername, reactivateBody.temporaryPassword)).ok) {
    throw new Error("O usuário reativado não conseguiu entrar.");
  }

  console.log(
    "Gestão de usuários validada: reset, troca obrigatória, exclusão, proteção da conta admin e reativação.",
  );
} finally {
  if (reviewerIds.length) {
    await client.query(
      "DELETE FROM gold_reviewer_sessions WHERE reviewer_id = ANY($1::bigint[])",
      [reviewerIds],
    );
    await client.query(
      "DELETE FROM gold_reviewers WHERE reviewer_id = ANY($1::bigint[])",
      [reviewerIds],
    );
  }
  await client.query(
    "DELETE FROM gold_login_attempts WHERE attempted_username = ANY($1::text[])",
    [[adminUsername, targetUsername]],
  );
  await client.end();
}
