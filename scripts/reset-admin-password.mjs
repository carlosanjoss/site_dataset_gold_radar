import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const scrypt = promisify(scryptCallback);
const username = String(process.argv[2] || "admin").trim().toLowerCase();

if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
  throw new Error("Nome de usuário administrativo inválido.");
}
if (!process.env.POSTGRES_URI) {
  throw new Error("POSTGRES_URI não foi definida no ambiente do contêiner.");
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const bytes = randomBytes(12);
let body = "";
for (const byte of bytes) body += alphabet[byte % alphabet.length];
const temporaryPassword = `${body.slice(0, 4)}@${body.slice(4, 8)}#${body.slice(8)}7aA`;
const passwordSalt = randomBytes(16).toString("hex");
const passwordHash = (await scrypt(temporaryPassword, passwordSalt, 64)).toString("hex");

const client = new pg.Client({ connectionString: process.env.POSTGRES_URI });
await client.connect();
try {
  await client.query("BEGIN");
  const target = await client.query(
    `
      SELECT reviewer_id, username
      FROM gold_reviewers
      WHERE LOWER(username) = $1
        AND role = 'admin'
      FOR UPDATE
    `,
    [username],
  );
  if (target.rowCount !== 1) {
    throw new Error("Conta administrativa não encontrada ou ambígua.");
  }

  const reviewerId = Number(target.rows[0].reviewer_id);
  await client.query(
    `
      UPDATE gold_reviewers
      SET password_hash = $1,
          password_salt = $2,
          must_change_password = TRUE,
          active = TRUE
      WHERE reviewer_id = $3
    `,
    [passwordHash, passwordSalt, reviewerId],
  );
  await client.query(
    "DELETE FROM gold_reviewer_sessions WHERE reviewer_id = $1",
    [reviewerId],
  );
  await client.query("COMMIT");

  console.log(JSON.stringify({
    username: String(target.rows[0].username),
    temporaryPassword,
    mustChangePassword: true,
  }));
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
