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

const baseUrl = process.env.REVIEW_APP_URL || "http://localhost:3001";
const username = `test.nli.${Date.now()}`;
const password = "Teste@Nli123";
const salt = randomBytes(16).toString("hex");
const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
const client = new pg.Client({ connectionString: process.env.POSTGRES_URI });
let reviewerId = null;
let analysisId = null;

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${pathname} retornou ${response.status}: ${text}`);
  }
  return { response, body };
}

await client.connect();
try {
  const reviewer = await client.query(
    `
      INSERT INTO gold_reviewers (
        display_name, reviewer_code, username, password_hash, password_salt,
        role, must_change_password
      )
      VALUES ('Teste NLI', $1, $2, $3, $4, 'admin', FALSE)
      RETURNING reviewer_id
    `,
    [username.toUpperCase().slice(0, 32), username, passwordHash, salt],
  );
  reviewerId = Number(reviewer.rows[0].reviewer_id);

  const candidate = await client.query(
    `
      SELECT a.analysis_id, a.platform
      FROM gemma_hate_analyses a
      JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
      WHERE a.status = 'success'
        AND a.model_name = 'gemma3:4b'
        AND a.prompt_version = 'gemma3_4b_structured_v2'
        AND d.analysis_id = d.canonical_analysis_id
        AND NOT EXISTS (
          SELECT 1 FROM gold_hate_reviews r WHERE r.analysis_id = a.analysis_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM gold_review_consensus c WHERE c.analysis_id = a.analysis_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM gold_nli_reviews n WHERE n.analysis_id = a.analysis_id
        )
      ORDER BY a.analysis_id DESC
      LIMIT 1
    `,
  );
  if (!candidate.rowCount) throw new Error("Sem item livre para o teste NLI.");
  analysisId = Number(candidate.rows[0].analysis_id);

  await client.query(
    `
      INSERT INTO gold_hate_reviews (
        analysis_id, reviewer_id, review_status, review_round
      ) VALUES ($1, $2, 'assigned', 1)
    `,
    [analysisId, reviewerId],
  );
  const category = await client.query(
    `SELECT category_code FROM gemma_hate_categories WHERE active IS TRUE ORDER BY sort_order LIMIT 1`,
  );
  if (!category.rowCount) throw new Error("Sem categoria HATE ativa.");

  const login = await api("/api/reviewers/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Login não retornou cookie.");
  const headers = { "Content-Type": "application/json", Cookie: cookie };

  const gold = await api(`/api/reviews/${analysisId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action: "corrected",
      finalLabel: "hate",
      finalHateTypes: [String(category.rows[0].category_code)],
      nliLayer3Answers: { N5: false, N4: true },
      nliLayer4Dimensions: [
        "dehumanization",
        "factualization",
        "social_dominance",
      ],
      note: "Teste automatizado integrado",
    }),
  });
  if (!gold.body.nliSaved) {
    throw new Error("As camadas NLI não foram salvas junto da decisão HATE.");
  }
  const stored = await client.query(
    `
      SELECT layer3_level, layer3_answers, layer4_dimensions
      FROM gold_nli_reviews
      WHERE analysis_id = $1 AND reviewer_id = $2
    `,
    [analysisId, reviewerId],
  );
  if (
    stored.rows[0]?.layer3_level !== "N4" ||
    stored.rows[0]?.layer3_answers?.N3 !== undefined ||
    stored.rows[0]?.layer4_dimensions?.length !== 3 ||
    !stored.rows[0]?.layer4_dimensions?.includes("social_dominance")
  ) {
    throw new Error("Persistência das respostas/dimensões NLI está incorreta.");
  }

  await api(`/api/nli/${analysisId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      layer3Answers: { N5: false, N4: false, N3: false, N2: false },
      layer4Dimensions: [],
      note: "Teste de revisão N1",
    }),
  });
  const revised = await client.query(
    `
      SELECT layer3_level, layer3_answers, layer4_dimensions
      FROM gold_nli_reviews
      WHERE analysis_id = $1 AND reviewer_id = $2
    `,
    [analysisId, reviewerId],
  );
  if (
    revised.rows[0]?.layer3_level !== "N1" ||
    revised.rows[0]?.layer3_answers?.N1 !== true ||
    revised.rows[0]?.layer4_dimensions?.length !== 0
  ) {
    throw new Error("Revisão N1/nenhuma dimensão não foi persistida.");
  }

  const history = await api(`/api/nli/history?search=${analysisId}`, {
    headers: { Cookie: cookie },
  });
  if (!history.body.rows?.some((row) => row.analysisId === analysisId)) {
    throw new Error("Histórico NLI não encontrou a avaliação concluída.");
  }
  const metrics = await api("/api/admin/metrics", {
    headers: { Cookie: cookie },
  });
  if (!metrics.body.nli || !Array.isArray(metrics.body.nli.layer3)) {
    throw new Error("Painel admin não retornou as métricas NLI.");
  }

  console.log("Teste NLI concluído: fluxo integrado, N4, seleção múltipla, N1, histórico e métricas.");
} finally {
  if (reviewerId) {
    await client.query(
      `DELETE FROM gold_nli_review_audit WHERE actor_reviewer_id = $1`,
      [reviewerId],
    );
    await client.query(`DELETE FROM gold_nli_reviews WHERE reviewer_id = $1`, [
      reviewerId,
    ]);
    await client.query(`DELETE FROM gold_review_audit WHERE actor_reviewer_id = $1`, [
      reviewerId,
    ]);
    if (analysisId) {
      await client.query(`DELETE FROM gold_review_consensus WHERE analysis_id = $1`, [
        analysisId,
      ]);
    }
    await client.query(`DELETE FROM gold_hate_reviews WHERE reviewer_id = $1`, [
      reviewerId,
    ]);
    await client.query(`DELETE FROM gold_reviewers WHERE reviewer_id = $1`, [
      reviewerId,
    ]);
  }
  await client.end();
}
