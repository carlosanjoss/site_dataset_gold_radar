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

if (!process.env.POSTGRES_URI) {
  throw new Error("POSTGRES_URI não encontrada.");
}

const initialUsers = [
  {
    displayName: "Administrador",
    username: "admin",
    role: "admin",
  },
  {
    displayName: "Mirele Santos Cardoso",
    username: "mirele.cardoso",
    role: "reviewer",
  },
  {
    displayName: "Rose Mariane P. Cavalcante",
    username: "rose.cavalcante",
    role: "reviewer",
  },
  {
    displayName: "Ruan Cardoso Santos",
    username: "ruan.santos",
    role: "reviewer",
  },
  {
    displayName: "Vanessa Santos Farias",
    username: "vanessa.farias",
    role: "reviewer",
  },
  {
    displayName: "Yasmin Reis B. Cruz",
    username: "yasmin.cruz",
    role: "reviewer",
  },
  {
    displayName: "Juliana Brandão",
    username: "juliana.brandao",
    role: "reviewer",
  },
  {
    displayName: "Mel Andrade",
    username: "mel.andrade",
    role: "reviewer",
  },
  {
    displayName: "Ryan Gabriel",
    username: "ryan.gabriel",
    role: "reviewer",
  },
];

function generateTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(12);
  let body = "";
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `${body.slice(0, 4)}@${body.slice(4, 8)}#${body.slice(8)}7aA`;
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return { hash: derived.toString("hex"), salt };
}

const client = new pg.Client({ connectionString: process.env.POSTGRES_URI });
const credentials = [];
const skipped = [];

await client.connect();
try {
  await client.query("BEGIN");
  for (const user of initialUsers) {
    const existing = await client.query(
      "SELECT reviewer_id FROM gold_reviewers WHERE LOWER(username) = $1",
      [user.username],
    );
    if (existing.rowCount) {
      skipped.push(user.username);
      continue;
    }

    const temporaryPassword = generateTemporaryPassword();
    const password = await hashPassword(temporaryPassword);
    const reviewerCode = user.username
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "-")
      .slice(0, 32);

    await client.query(
      `
        INSERT INTO gold_reviewers (
          display_name, reviewer_code, username, password_hash, password_salt,
          role, must_change_password
        )
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      `,
      [
        user.displayName,
        reviewerCode,
        user.username,
        password.hash,
        password.salt,
        user.role,
      ],
    );
    credentials.push({
      nome: user.displayName,
      usuario: user.username,
      senhaTemporaria: temporaryPassword,
      perfil: user.role,
    });
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}

console.log(JSON.stringify({ credentials, skipped }, null, 2));
