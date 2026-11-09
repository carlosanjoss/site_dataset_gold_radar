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

function integratedNli(label) {
  return label === "hate"
    ? {
        nliLayer3Answers: { N5: false, N4: false, N3: false, N2: true },
        nliLayer4Dimensions: ["authoritarianism"],
      }
    : {};
}
const suffix = Date.now();
const reviewerUsername = `test.reviewer.${suffix}`;
const adminUsername = `test.admin.${suffix}`;
const reviewerPassword = "Teste@Seguro123";
const adminPassword = "Admin@Teste123";
const client = new pg.Client({ connectionString: process.env.POSTGRES_URI });
const reviewerIds = [];
const batchIds = [];

async function insertUser({
  displayName,
  username,
  password,
  role,
  mustChangePassword,
}) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)).toString("hex");
  const result = await client.query(
    `
      INSERT INTO gold_reviewers (
        display_name, reviewer_code, username, password_hash, password_salt,
        role, must_change_password
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING reviewer_id
    `,
    [
      displayName,
      username.toUpperCase().replace(/[^A-Z0-9_-]/g, "-").slice(0, 32),
      username,
      hash,
      salt,
      role,
      mustChangePassword,
    ],
  );
  const reviewerId = Number(result.rows[0].reviewer_id);
  reviewerIds.push(reviewerId);
  return reviewerId;
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/reviewers/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`Login falhou: ${await response.text()}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("Cookie de sessão não retornado.");
  return { body: await response.json(), cookie };
}

await client.connect();
try {
  const primaryReviewerId = await insertUser({
    displayName: "Avaliador temporário",
    username: reviewerUsername,
    password: reviewerPassword,
    role: "reviewer",
    mustChangePassword: true,
  });

  const firstLogin = await login(reviewerUsername, reviewerPassword);
  if (!firstLogin.body.reviewer.mustChangePassword) {
    throw new Error("A troca obrigatória não foi solicitada.");
  }

  const blockedQueue = await fetch(`${baseUrl}/api/reviews/next`, {
    headers: { Cookie: firstLogin.cookie },
  });
  if (blockedQueue.status !== 403) {
    throw new Error("A fila não foi bloqueada antes da troca de senha.");
  }

  const newPassword = "Nova@Senha123";
  const changePassword = await fetch(
    `${baseUrl}/api/reviewers/change-password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstLogin.cookie,
      },
      body: JSON.stringify({ newPassword }),
    },
  );
  if (!changePassword.ok) {
    throw new Error(`Troca de senha falhou: ${await changePassword.text()}`);
  }

  const contextCandidate = await client.query(
    `
      SELECT a.analysis_id
      FROM gemma_hate_analyses a
      JOIN gold_duplicate_map d ON d.analysis_id = a.analysis_id
      JOIN comments source_comment ON source_comment.id = a.comment_id
      JOIN posts origin_post ON origin_post.id = source_comment.post_pk
      WHERE a.status = 'success'
        AND a.model_name = 'gemma3:4b'
        AND a.prompt_version = 'gemma3_4b_structured_v2'
        AND a.platform = 'youtube'
        AND a.content_kind = 'comment'
        AND d.analysis_id = d.canonical_analysis_id
        AND COALESCE(origin_post.title, origin_post.text, '') <> ''
        AND NOT EXISTS (
          SELECT 1
          FROM gold_hate_reviews review
          WHERE review.analysis_id = a.analysis_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM gold_review_consensus consensus
          WHERE consensus.analysis_id = a.analysis_id
        )
      ORDER BY a.analysis_id
      LIMIT 1
    `,
  );
  if (!contextCandidate.rowCount) {
    throw new Error(
      "Nenhum comentário com post de origem disponível para o teste.",
    );
  }
  await client.query(
    `
      INSERT INTO gold_hate_reviews
        (analysis_id, reviewer_id, review_status, review_round)
      VALUES ($1, $2, 'assigned', 1)
    `,
    [
      Number(contextCandidate.rows[0].analysis_id),
      primaryReviewerId,
    ],
  );

  const next = await fetch(
    `${baseUrl}/api/reviews/next?platform=youtube&contentKind=comment`,
    { headers: { Cookie: firstLogin.cookie } },
  );
  if (!next.ok) throw new Error(`Fila falhou: ${await next.text()}`);
  const nextBody = await next.json();
  if (!nextBody.item) throw new Error("Nenhum item disponível para o teste.");
  if (
    nextBody.item.contentKind !== "comment" ||
    !nextBody.item.originPost ||
    !(
      nextBody.item.originPost.title ||
      nextBody.item.originPost.text
    )
  ) {
    throw new Error(
      "O comentário não trouxe o contexto do post de origem.",
    );
  }
  const expectedCategoryNames = new Map([
    ["political", "Ódio político"],
    ["aporophobia", "Classismo"],
    ["body_shame", "Gordofobia"],
    ["misogyny", "Sexismo"],
  ]);
  for (const [code, expectedName] of expectedCategoryNames) {
    const category = nextBody.categories.find((entry) => entry.code === code);
    if (category?.name !== expectedName) {
      throw new Error(
        `Categoria ${code} deveria aparecer como ${expectedName}.`,
      );
    }
  }

  const filteredPlatform =
    nextBody.item.platform === "facebook" ? "youtube" : "facebook";
  const filteredNext = await fetch(
    `${baseUrl}/api/reviews/next?platform=${filteredPlatform}`,
    { headers: { Cookie: firstLogin.cookie } },
  );
  if (!filteredNext.ok) {
    throw new Error(`Filtro por rede falhou: ${await filteredNext.text()}`);
  }
  const filteredNextBody = await filteredNext.json();
  if (
    !filteredNextBody.item ||
    filteredNextBody.item.platform !== filteredPlatform
  ) {
    throw new Error("A fila não atualizou para a rede social selecionada.");
  }
  const skipFiltered = await fetch(
    `${baseUrl}/api/reviews/${filteredNextBody.item.analysisId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstLogin.cookie,
      },
      body: JSON.stringify({ action: "skipped" }),
    },
  );
  if (!skipFiltered.ok) {
    throw new Error(`Limpeza do filtro falhou: ${await skipFiltered.text()}`);
  }

  const afterSkip = await fetch(
    `${baseUrl}/api/reviews/next?platform=${filteredPlatform}`,
    { headers: { Cookie: firstLogin.cookie } },
  );
  if (!afterSkip.ok) {
    throw new Error(
      `Fila depois de pular falhou: ${await afterSkip.text()}`,
    );
  }
  const afterSkipBody = await afterSkip.json();
  if (
    !afterSkipBody.item ||
    afterSkipBody.item.analysisId === filteredNextBody.item.analysisId
  ) {
    throw new Error(
      "A fila ficou presa no texto que o avaliador já havia pulado.",
    );
  }
  const clearAfterSkip = await fetch(
    `${baseUrl}/api/reviews/${afterSkipBody.item.analysisId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstLogin.cookie,
      },
      body: JSON.stringify({ action: "skipped" }),
    },
  );
  if (!clearAfterSkip.ok) {
    throw new Error(
      `Limpeza da fila após pular falhou: ${await clearAfterSkip.text()}`,
    );
  }

  const confirm = await fetch(
    `${baseUrl}/api/reviews/${nextBody.item.analysisId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstLogin.cookie,
      },
      body: JSON.stringify({
        action: "confirmed",
        ...integratedNli(nextBody.item.gemmaLabel),
      }),
    },
  );
  if (!confirm.ok) {
    throw new Error(`Confirmação falhou: ${await confirm.text()}`);
  }

  const history = await fetch(
    `${baseUrl}/api/reviews/history?search=${nextBody.item.analysisId}`,
    { headers: { Cookie: firstLogin.cookie } },
  );
  if (!history.ok) {
    throw new Error(`Histórico falhou: ${await history.text()}`);
  }
  const historyBody = await history.json();
  const historyItem = historyBody.rows.find(
    (entry) => entry.analysisId === nextBody.item.analysisId,
  );
  if (
    !historyItem ||
    historyItem.finalLabel !== nextBody.item.gemmaLabel
  ) {
    throw new Error("A avaliação concluída não apareceu no histórico.");
  }

  const revisedLabel =
    nextBody.item.gemmaLabel === "hate" ? "nao_hate" : "hate";
  const revisedTypes =
    revisedLabel === "hate"
      ? [String(nextBody.categories[0].code)]
      : [];
  const reviseHistory = await fetch(
    `${baseUrl}/api/reviews/${nextBody.item.analysisId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstLogin.cookie,
      },
      body: JSON.stringify({
        finalLabel: revisedLabel,
        finalHateTypes: revisedTypes,
        note: "Correção temporária do teste de histórico.",
      }),
    },
  );
  if (!reviseHistory.ok) {
    throw new Error(
      `Correção pelo histórico falhou: ${await reviseHistory.text()}`,
    );
  }

  const revisedHistory = await fetch(
    `${baseUrl}/api/reviews/history?search=${nextBody.item.analysisId}`,
    { headers: { Cookie: firstLogin.cookie } },
  );
  const revisedHistoryBody = await revisedHistory.json();
  if (
    !revisedHistory.ok ||
    revisedHistoryBody.rows[0]?.finalLabel !== revisedLabel
  ) {
    throw new Error("A decisão corrigida não foi atualizada no histórico.");
  }

  const restoreHistory = await fetch(
    `${baseUrl}/api/reviews/${nextBody.item.analysisId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstLogin.cookie,
      },
      body: JSON.stringify({
        finalLabel: nextBody.item.gemmaLabel,
        finalHateTypes:
          nextBody.item.gemmaLabel === "hate"
            ? nextBody.item.hateTypes
            : [],
      }),
    },
  );
  if (!restoreHistory.ok) {
    throw new Error(
      `Restauração do histórico falhou: ${await restoreHistory.text()}`,
    );
  }

  const stats = await fetch(`${baseUrl}/api/reviews/stats`, {
    headers: { Cookie: firstLogin.cookie },
  });
  if (!stats.ok) throw new Error(`Métricas falharam: ${await stats.text()}`);
  const statsBody = await stats.json();
  if (statsBody.reviewer.confirmed !== 1) {
    throw new Error("A confirmação não apareceu nas métricas.");
  }
  if (statsBody.global !== null) {
    throw new Error("O progresso geral foi exposto para um avaliador.");
  }

  await insertUser({
    displayName: "Administrador temporário",
    username: adminUsername,
    password: adminPassword,
    role: "admin",
    mustChangePassword: false,
  });
  const adminLogin = await login(adminUsername, adminPassword);
  const adminStats = await fetch(`${baseUrl}/api/reviews/stats`, {
    headers: { Cookie: adminLogin.cookie },
  });
  if (!adminStats.ok) {
    throw new Error(`Métricas do admin falharam: ${await adminStats.text()}`);
  }
  const adminStatsBody = await adminStats.json();
  if (!adminStatsBody.global || adminStatsBody.global.total <= 0) {
    throw new Error("O progresso geral não apareceu para o administrador.");
  }
  const createdUsername = `test.created.${suffix}`;
  const createUser = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminLogin.cookie,
    },
    body: JSON.stringify({
      displayName: "Usuário criado no teste",
      username: createdUsername,
      role: "reviewer",
    }),
  });
  if (!createUser.ok) {
    throw new Error(`Criação pelo admin falhou: ${await createUser.text()}`);
  }
  const createdBody = await createUser.json();
  reviewerIds.push(Number(createdBody.user.reviewerId));
  if (!createdBody.temporaryPassword) {
    throw new Error("A senha temporária não foi devolvida ao administrador.");
  }

  const users = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: adminLogin.cookie },
  });
  if (!users.ok) throw new Error(`Lista de usuários falhou: ${await users.text()}`);
  const usersBody = await users.json();
  if (!usersBody.users.some((user) => user.username === createdUsername)) {
    throw new Error("A conta criada não apareceu no painel administrativo.");
  }
  const createdUser = usersBody.users.find(
    (user) => user.username === createdUsername,
  );
  const enableDoubleReview = await fetch(`${baseUrl}/api/admin/users`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminLogin.cookie,
    },
    body: JSON.stringify({
      reviewerId: createdUser.reviewerId,
      doubleReviewEnabled: true,
    }),
  });
  if (!enableDoubleReview.ok) {
    throw new Error(
      `Seleção para revisão dupla falhou: ${await enableDoubleReview.text()}`,
    );
  }
  const enablePrimaryDoubleReview = await fetch(`${baseUrl}/api/admin/users`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminLogin.cookie,
    },
    body: JSON.stringify({
      reviewerId: primaryReviewerId,
      doubleReviewEnabled: true,
    }),
  });
  if (!enablePrimaryDoubleReview.ok) {
    throw new Error(
      `Seleção do segundo avaliador falhou: ${await enablePrimaryDoubleReview.text()}`,
    );
  }

  const createBatch = await fetch(`${baseUrl}/api/admin/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminLogin.cookie,
    },
    body: JSON.stringify({
      action: "create_batch",
      name: `Lote temporário ${suffix}`,
      size: 2,
      doubleReviewPercent: 100,
    }),
  });
  if (!createBatch.ok) {
    throw new Error(`Criação do lote falhou: ${await createBatch.text()}`);
  }
  const batchBody = await createBatch.json();
  batchIds.push(Number(batchBody.batchId));

  const primaryDoubleItem = await fetch(`${baseUrl}/api/reviews/next`, {
    headers: { Cookie: firstLogin.cookie },
  });
  if (!primaryDoubleItem.ok) {
    throw new Error(
      `Primeira etapa da revisão dupla falhou: ${await primaryDoubleItem.text()}`,
    );
  }
  const primaryDoubleBody = await primaryDoubleItem.json();
  if (
    !primaryDoubleBody.item ||
    primaryDoubleBody.item.targetReviews !== 2 ||
    primaryDoubleBody.item.reviewRound !== 1
  ) {
    throw new Error("O lote não entregou a primeira etapa da revisão dupla.");
  }
  const submitFirstDouble = await fetch(
    `${baseUrl}/api/reviews/${primaryDoubleBody.item.analysisId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: firstLogin.cookie,
      },
      body: JSON.stringify({
        action: "confirmed",
        ...integratedNli(primaryDoubleBody.item.gemmaLabel),
      }),
    },
  );
  if (!submitFirstDouble.ok) {
    throw new Error(
      `Primeira decisão dupla falhou: ${await submitFirstDouble.text()}`,
    );
  }

  const secondLogin = await login(
    createdUsername,
    createdBody.temporaryPassword,
  );
  const secondPassword = "Segunda@Senha123";
  const secondPasswordChange = await fetch(
    `${baseUrl}/api/reviewers/change-password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: secondLogin.cookie,
      },
      body: JSON.stringify({ newPassword: secondPassword }),
    },
  );
  if (!secondPasswordChange.ok) {
    throw new Error(
      `Troca de senha do segundo avaliador falhou: ${await secondPasswordChange.text()}`,
    );
  }
  const secondDoubleItem = await fetch(`${baseUrl}/api/reviews/next`, {
    headers: { Cookie: secondLogin.cookie },
  });
  if (!secondDoubleItem.ok) {
    throw new Error(
      `Segunda etapa da revisão dupla falhou: ${await secondDoubleItem.text()}`,
    );
  }
  const secondDoubleBody = await secondDoubleItem.json();
  if (
    secondDoubleBody.item?.analysisId !==
      primaryDoubleBody.item.analysisId ||
    secondDoubleBody.item.reviewRound !== 2
  ) {
    throw new Error("O mesmo texto não foi encaminhado ao segundo avaliador.");
  }
  const oppositeLabel =
    secondDoubleBody.item.gemmaLabel === "hate" ? "nao_hate" : "hate";
  const oppositeTypes =
    oppositeLabel === "hate"
      ? [String(secondDoubleBody.categories[0].code)]
      : [];
  const submitConflictingDouble = await fetch(
    `${baseUrl}/api/reviews/${secondDoubleBody.item.analysisId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: secondLogin.cookie,
      },
      body: JSON.stringify({
        action: "corrected",
        finalLabel: oppositeLabel,
        finalHateTypes: oppositeTypes,
        ...integratedNli(oppositeLabel),
      }),
    },
  );
  if (!submitConflictingDouble.ok) {
    throw new Error(
      `Decisão divergente falhou: ${await submitConflictingDouble.text()}`,
    );
  }

  const metrics = await fetch(`${baseUrl}/api/admin/metrics`, {
    headers: { Cookie: adminLogin.cookie },
  });
  if (!metrics.ok) {
    throw new Error(`Métricas administrativas falharam: ${await metrics.text()}`);
  }
  const metricsBody = await metrics.json();
  if (
    metricsBody.dataset.totalAnalyses <= 0 ||
    metricsBody.model.sampleSize <= 0 ||
    !metricsBody.platforms.length ||
    !metricsBody.model.examples
  ) {
    throw new Error("O painel administrativo retornou métricas incompletas.");
  }

  const workflow = await fetch(`${baseUrl}/api/admin/workflow`, {
    headers: { Cookie: adminLogin.cookie },
  });
  if (!workflow.ok) {
    throw new Error(`Fluxo do gold falhou: ${await workflow.text()}`);
  }
  const workflowBody = await workflow.json();
  const testConflict = workflowBody.conflicts.find(
    (conflict) =>
      conflict.analysisId === primaryDoubleBody.item.analysisId,
  );
  if (
    !workflowBody.reviewers.some(
      (user) =>
        user.reviewerId === createdUser.reviewerId &&
        user.doubleReviewEnabled === true,
    ) ||
    workflowBody.duplicates.uniqueTexts <= 0 ||
    !Array.isArray(workflowBody.audit) ||
    workflowBody.platformCoverageTargetPercent !== 35 ||
    !Array.isArray(workflowBody.platformCoverage) ||
    !workflowBody.platformCoverage.length ||
    workflowBody.platformCoverage.some(
      (platform) =>
        platform.target !== Math.ceil(platform.total * 0.35) ||
        platform.sampled < platform.reviewed,
    ) ||
    !testConflict ||
    testConflict.reviews.length !== 2
  ) {
    throw new Error("O fluxo do gold retornou dados incompletos.");
  }
  const resolveConflict = await fetch(`${baseUrl}/api/admin/workflow`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminLogin.cookie,
    },
    body: JSON.stringify({
      action: "resolve_conflict",
      analysisId: testConflict.analysisId,
      reviewId: testConflict.reviews[0].reviewId,
    }),
  });
  if (!resolveConflict.ok) {
    throw new Error(
      `Adjudicação do conflito falhou: ${await resolveConflict.text()}`,
    );
  }

  const gemmaData = await fetch(
    `${baseUrl}/api/admin/gemma-data?page=1&pageSize=10`,
    { headers: { Cookie: adminLogin.cookie } },
  );
  if (!gemmaData.ok) {
    throw new Error(`Listagem do Gemma falhou: ${await gemmaData.text()}`);
  }
  const gemmaDataBody = await gemmaData.json();
  if (
    gemmaDataBody.total <= 0 ||
    gemmaDataBody.rows.length === 0 ||
    gemmaDataBody.rows.length > 10
  ) {
    throw new Error("A listagem paginada do Gemma retornou dados inválidos.");
  }
  for (const platform of [
    "facebook",
    "reddit",
    "telegram",
    "tiktok",
    "twitter",
    "whatsapp",
    "youtube",
  ]) {
    const filteredData = await fetch(
      `${baseUrl}/api/admin/gemma-data?page=1&pageSize=10&platform=${platform}`,
      { headers: { Cookie: adminLogin.cookie } },
    );
    if (!filteredData.ok) {
      throw new Error(
        `Filtro do Gemma para ${platform} falhou: ${await filteredData.text()}`,
      );
    }
    const filteredBody = await filteredData.json();
    if (
      filteredBody.total <= 0 ||
      filteredBody.rows.length === 0 ||
      filteredBody.rows.some((row) => row.platform !== platform)
    ) {
      throw new Error(`Filtro por rede retornou dados inválidos para ${platform}.`);
    }
  }

  const detail = await fetch(
    `${baseUrl}/api/admin/gemma-data/${gemmaDataBody.rows[0].analysisId}`,
    { headers: { Cookie: adminLogin.cookie } },
  );
  if (!detail.ok) {
    throw new Error(`Detalhe do Gemma falhou: ${await detail.text()}`);
  }
  const detailBody = await detail.json();
  if (!detailBody.analysis.text || !detailBody.analysis.modelName) {
    throw new Error("O detalhe da análise do Gemma está incompleto.");
  }

  console.log(
    `Fluxos validados: login, troca de senha, análise ${nextBody.item.analysisId}, histórico editável, revisão dupla, auditoria, métricas e banco do Gemma.`,
  );
} finally {
  if (reviewerIds.length) {
    await client.query(
      "DELETE FROM gold_nli_review_audit WHERE actor_reviewer_id = ANY($1::bigint[])",
      [reviewerIds],
    );
    await client.query(
      "DELETE FROM gold_nli_reviews WHERE reviewer_id = ANY($1::bigint[])",
      [reviewerIds],
    );
    const temporaryReviews = await client.query(
      `
        SELECT review_id, analysis_id
        FROM gold_hate_reviews
        WHERE reviewer_id = ANY($1::bigint[])
      `,
      [reviewerIds],
    );
    const temporaryReviewIds = temporaryReviews.rows.map((row) =>
      Number(row.review_id),
    );
    const temporaryAnalysisIds = temporaryReviews.rows.map((row) =>
      Number(row.analysis_id),
    );
    if (temporaryReviewIds.length) {
      await client.query(
        `
          DELETE FROM gold_review_audit
          WHERE review_id = ANY($1::bigint[])
             OR actor_reviewer_id = ANY($2::bigint[])
        `,
        [temporaryReviewIds, reviewerIds],
      );
    }
    if (temporaryAnalysisIds.length) {
      await client.query(
        "DELETE FROM gold_review_consensus WHERE analysis_id = ANY($1::bigint[])",
        [temporaryAnalysisIds],
      );
    }
    await client.query(
      "DELETE FROM gold_hate_reviews WHERE reviewer_id = ANY($1::bigint[])",
      [reviewerIds],
    );
    if (batchIds.length) {
      await client.query(
        "DELETE FROM gold_sampling_batches WHERE batch_id = ANY($1::bigint[])",
        [batchIds],
      );
    }
    await client.query(
      "DELETE FROM gold_reviewer_sessions WHERE reviewer_id = ANY($1::bigint[])",
      [reviewerIds],
    );
    await client.query(
      "DELETE FROM gold_reviewers WHERE reviewer_id = ANY($1::bigint[])",
      [reviewerIds],
    );
  }
  await client.end();
}
