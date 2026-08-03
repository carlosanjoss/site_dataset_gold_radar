import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

for (const envPath of [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../social_data_pipeline/.env"),
]) {
  config({ path: envPath, override: false, quiet: true });
  if (process.env.POSTGRES_URI) break;
}

if (!process.env.POSTGRES_URI) {
  console.error("POSTGRES_URI não encontrada.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.POSTGRES_URI,
  connectionTimeoutMillis: 10_000,
});

try {
  await client.connect();
  const result = await client.query(`
    SELECT
      to_regclass('public.gold_reviewers') IS NOT NULL
      AND to_regclass('public.gold_hate_reviews') IS NOT NULL
      AND to_regclass('public.gold_review_consensus') IS NOT NULL
      AND to_regclass('public.gold_sampling_batches') IS NOT NULL
      AND to_regclass('public.gold_sampling_batch_items') IS NOT NULL
      AND to_regclass('public.gold_duplicate_map') IS NOT NULL
      AND to_regclass('public.gemma_hate_categories') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'gold_reviewers'
          AND column_name = 'double_review_enabled'
      )
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'gold_hate_reviews'
          AND column_name = 'review_round'
      ) AS ready
  `);
  if (!result.rows[0]?.ready) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
