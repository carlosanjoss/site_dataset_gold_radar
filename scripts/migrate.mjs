import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

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

const sql = await readFile(path.join(root, "db", "migration.sql"), "utf8");
const client = new pg.Client({ connectionString: process.env.POSTGRES_URI });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("Estrutura de revisão humana criada com sucesso.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
