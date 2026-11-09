import pg from "pg";

if (!process.env.POSTGRES_URI) {
  console.error("POSTGRES_URI não configurada.");
  process.exit(1);
}

const waitSeconds = Math.max(
  10,
  Number.parseInt(process.env.DB_WAIT_SECONDS || "300", 10) || 300,
);
const deadline = Date.now() + waitSeconds * 1000;
let lastMessage = "Banco ainda não respondeu.";

while (Date.now() < deadline) {
  const client = new pg.Client({
    connectionString: process.env.POSTGRES_URI,
    connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT
        to_regclass('public.gemma_hate_analyses') IS NOT NULL
        AND to_regclass('public.gemma_hate_categories') IS NOT NULL AS ready
    `);
    if (result.rows[0]?.ready) {
      console.log("Banco com as inferências do Gemma encontrado.");
      await client.end();
      process.exit(0);
    }
    lastMessage =
      "O PostgreSQL está ativo, mas o backup ainda não contém as tabelas do Gemma.";
  } catch (error) {
    lastMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await client.end().catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}

console.error(`Banco indisponível após ${waitSeconds}s: ${lastMessage}`);
process.exit(1);
