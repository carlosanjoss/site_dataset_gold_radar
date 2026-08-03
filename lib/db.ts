import { config } from "dotenv";
import path from "node:path";
import { Pool } from "pg";

function loadDatabaseEnvironment() {
  if (process.env.POSTGRES_URI) return;
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../social_data_pipeline/.env"),
  ];
  for (const candidate of candidates) {
    config({ path: candidate, override: false, quiet: true });
    if (process.env.POSTGRES_URI) return;
  }
}

declare global {
  var goldReviewPool: Pool | undefined;
}

export function getPool() {
  loadDatabaseEnvironment();
  if (!process.env.POSTGRES_URI) {
    throw new Error(
      "POSTGRES_URI não configurada. Crie .env.local ou mantenha o projeto ao lado de social_data_pipeline.",
    );
  }
  if (!global.goldReviewPool) {
    global.goldReviewPool = new Pool({
      connectionString: process.env.POSTGRES_URI,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return global.goldReviewPool;
}

export function currentInference() {
  return {
    model: process.env.GEMMA_MODEL || "gemma3:4b",
    promptVersion:
      process.env.GEMMA_PROMPT_VERSION || "gemma3_4b_structured_v2",
  };
}
