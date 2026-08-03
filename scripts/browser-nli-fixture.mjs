import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { config } from "dotenv";
import path from "node:path";
import pg from "pg";

const scrypt = promisify(scryptCallback);
for (const envPath of [
  path.resolve(".env.local"),
  path.resolve(".env"),
  path.resolve("../social_data_pipeline/.env"),
]) {
  config({ path: envPath, override: false, quiet: true });
  if (process.env.POSTGRES_URI) break;
}
if (!process.env.POSTGRES_URI) throw new Error("POSTGRES_URI não encontrada.");

const mode = process.argv[2] || "prepare";
const suppliedUsername = process.argv[3] || "";
const client = new pg.Client({ connectionString: process.env.POSTGRES_URI });
await client.connect();
try {
  if (mode === "cleanup") {
    const user = await client.query(
      `SELECT reviewer_id FROM gold_reviewers WHERE username = $1`,
      [suppliedUsername],
    );
    if (user.rowCount) {
      const reviewerId = Number(user.rows[0].reviewer_id);
      const reviews = await client.query(
        `SELECT analysis_id FROM gold_hate_reviews WHERE reviewer_id = $1`,
        [reviewerId],
      );
      await client.query(`DELETE FROM gold_nli_review_audit WHERE actor_reviewer_id = $1`, [reviewerId]);
      await client.query(`DELETE FROM gold_nli_reviews WHERE reviewer_id = $1`, [reviewerId]);
      await client.query(`DELETE FROM gold_review_audit WHERE actor_reviewer_id = $1`, [reviewerId]);
      for (const row of reviews.rows) {
        await client.query(`DELETE FROM gold_review_consensus WHERE analysis_id = $1`, [Number(row.analysis_id)]);
      }
      await client.query(`DELETE FROM gold_hate_reviews WHERE reviewer_id = $1`, [reviewerId]);
      await client.query(`DELETE FROM gold_reviewers WHERE reviewer_id = $1`, [reviewerId]);
    }
    console.log("FIXTURE_CLEANED");
  } else {
    const username = `browser.nli.${Date.now()}`;
    const password = "Browser@Nli123";
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
    const reviewer = await client.query(
      `
        INSERT INTO gold_reviewers (
          display_name, reviewer_code, username, password_hash, password_salt,
          role, must_change_password
        ) VALUES ('Teste visual NLI', $1, $2, $3, $4, 'admin', FALSE)
        RETURNING reviewer_id
      `,
      [username.toUpperCase().slice(0, 32), username, passwordHash, salt],
    );
    const reviewerId = Number(reviewer.rows[0].reviewer_id);
    const candidate = await client.query(
      `
        SELECT a.analysis_id
        FROM gemma_hate_analyses a
        JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
        WHERE a.status = 'success'
          AND a.model_name = 'gemma3:4b'
          AND a.prompt_version = 'gemma3_4b_structured_v2'
          AND d.analysis_id = d.canonical_analysis_id
          AND length(a.text_snapshot) BETWEEN 80 AND 1200
          AND NOT EXISTS (SELECT 1 FROM gold_hate_reviews r WHERE r.analysis_id = a.analysis_id)
          AND NOT EXISTS (SELECT 1 FROM gold_review_consensus c WHERE c.analysis_id = a.analysis_id)
          AND NOT EXISTS (SELECT 1 FROM gold_nli_reviews n WHERE n.analysis_id = a.analysis_id)
        ORDER BY a.analysis_id DESC
        LIMIT 1
      `,
    );
    if (!candidate.rowCount) throw new Error("Sem análise livre para o fixture.");
    const analysisId = Number(candidate.rows[0].analysis_id);
    const category = await client.query(
      `SELECT category_code FROM gemma_hate_categories WHERE active IS TRUE ORDER BY sort_order LIMIT 1`,
    );
    const categoryCode = String(category.rows[0].category_code);
    const hateReview = await client.query(
      `
        INSERT INTO gold_hate_reviews (
          analysis_id, reviewer_id, review_status, final_label,
          final_hate_types, review_round, reviewed_at
        ) VALUES ($1, $2, 'corrected', 'hate', ARRAY[$3]::TEXT[], 1, NOW())
        RETURNING review_id
      `,
      [analysisId, reviewerId, categoryCode],
    );
    await client.query(
      `
        INSERT INTO gold_review_consensus (
          analysis_id, decision_status, final_label, final_hate_types,
          resolved_at
        ) VALUES ($1, 'single', 'hate', ARRAY[$2]::TEXT[], NOW())
      `,
      [analysisId, categoryCode],
    );
    await client.query(
      `
        INSERT INTO gold_nli_reviews (analysis_id, reviewer_id, review_status)
        VALUES ($1, $2, 'assigned')
      `,
      [analysisId, reviewerId],
    );
    console.log(JSON.stringify({
      username,
      password,
      reviewerId,
      analysisId,
      reviewId: Number(hateReview.rows[0].review_id),
    }));
  }
} finally {
  await client.end();
}
