import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getPool } from "@/lib/db";
import { writeAudit } from "@/lib/review-workflow";
import { serverError } from "@/lib/responses";

const MAX_BATCH_SIZE = 10_000;
const REQUIRED_COLUMNS = ["text"]; // Mínimo necessário

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;
  if (!auth.reviewer) {
    return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const action = String(formData.get("action") || "");

    if (action === "create_from_csv") {
      const file = formData.get("file");
      if (!file || typeof file !== "object") {
        return NextResponse.json(
          { error: "Arquivo CSV não enviado." },
          { status: 400 },
        );
      }

      const name = String(formData.get("name") || "").trim().slice(0, 120);
      const targetReviews = Number(formData.get("targetReviews") || 1);
      const columnMapping = JSON.parse(
        String(formData.get("columnMapping") || "{}"),
      );

      if (!name) {
        return NextResponse.json(
          { error: "Informe um nome para o lote." },
          { status: 400 },
        );
      }

      if (
        !Number.isInteger(targetReviews) ||
        targetReviews < 1 ||
        targetReviews > 10
      ) {
        return NextResponse.json(
          { error: "Número de avaliações por item deve ser entre 1 e 10." },
          { status: 400 },
        );
      }

      // Validar mapeamento de colunas obrigatórias
      if (!columnMapping.textCol) {
        return NextResponse.json(
          { error: "Selecione a coluna que contém o texto a ser avaliado." },
          { status: 400 },
        );
      }

      // Ler e parsear CSV
      const csvText = await file.text();
      const lines = csvText.trim().split(/\r?\n/);
      if (lines.length < 2) {
        return NextResponse.json(
          { error: "CSV deve ter cabeçalho e pelo menos uma linha de dados." },
          { status: 400 },
        );
      }

      const headers = parseCsvLine(lines[0]);
      const headerSet = new Set(headers);

      // Verificar se colunas mapeadas existem
      const mappedCols = [
        columnMapping.textCol,
        columnMapping.labelCol,
        columnMapping.hateTypesCol,
        columnMapping.platformCol,
        columnMapping.contentKindCol,
        columnMapping.externalIdCol,
      ].filter(Boolean);

      for (const col of mappedCols) {
        if (!headerSet.has(col)) {
          return NextResponse.json(
            { error: `Coluna "${col}" não encontrada no CSV.` },
            { status: 400 },
          );
        }
      }

      // Processar linhas
      const items: Array<{
        text: string;
        label?: string;
        hateTypes?: string[];
        platform?: string;
        contentKind?: string;
        externalId?: string;
        raw: Record<string, string>;
      }> = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        if (values.length !== headers.length) continue; // pular linhas malformadas

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => (row[h] = values[idx] || ""));

        const text = row[columnMapping.textCol]?.trim();
        if (!text) continue;

        const item: typeof items[0] = { text, raw: row };

        if (columnMapping.labelCol && row[columnMapping.labelCol]) {
          const label = row[columnMapping.labelCol].trim().toLowerCase();
          if (label === "hate" || label === "não hate" || label === "nao_hate") {
            item.label = label === "hate" ? "hate" : "nao_hate";
          }
        }

        if (columnMapping.hateTypesCol && row[columnMapping.hateTypesCol]) {
          const types = row[columnMapping.hateTypesCol]
            .split(/[,;|]/)
            .map((t) => t.trim())
            .filter(Boolean);
          if (types.length) item.hateTypes = types;
        }

        if (columnMapping.platformCol && row[columnMapping.platformCol]) {
          const platform = row[columnMapping.platformCol].trim().toLowerCase();
          if (
            [
              "facebook",
              "reddit",
              "telegram",
              "tiktok",
              "twitter",
              "whatsapp",
              "youtube",
            ].includes(platform)
          ) {
            item.platform = platform;
          }
        }

        if (columnMapping.contentKindCol && row[columnMapping.contentKindCol]) {
          const kind = row[columnMapping.contentKindCol].trim().toLowerCase();
          if (kind === "post" || kind === "comment") item.contentKind = kind;
        }

        if (columnMapping.externalIdCol && row[columnMapping.externalIdCol]) {
          item.externalId = row[columnMapping.externalIdCol].trim();
        }

        items.push(item);
      }

      if (!items.length) {
        return NextResponse.json(
          { error: "Nenhum item válido encontrado no CSV." },
          { status: 400 },
        );
      }

      if (items.length > MAX_BATCH_SIZE) {
        return NextResponse.json(
          { error: `Lote excede o máximo de ${MAX_BATCH_SIZE} itens.` },
          { status: 400 },
        );
      }

      const pool = getPool();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Inserir lote
        const batchResult = await client.query(
          `
          INSERT INTO gold_sampling_batches (
            batch_name, requested_size, selected_size,
            target_reviews, csv_content, csv_columns, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING batch_id
        `,
          [
            name,
            items.length,
            items.length,
            targetReviews,
            csvText,
            JSON.stringify(columnMapping),
            auth.reviewer.reviewerId,
          ],
        );

        const batchId = Number(batchResult.rows[0].batch_id);

        // Inserir itens do lote e criar análises
        const analysisIds: number[] = [];
        for (const item of items) {
          const analysisResult = await client.query(
            `
            INSERT INTO gemma_hate_analyses (
              platform, content_kind, external_id, text_snapshot,
              pred_label, hate_types, hate_probability, target_identified,
              textual_evidence, justification, model_name, prompt_version,
              status, analyzed_at, text_hash
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'success', NOW(), $13)
            RETURNING analysis_id
          `,
            [
              item.platform || "unknown",
              item.contentKind || "post",
              item.externalId || `csv_${batchId}_${analysisIds.length}`,
              item.text,
              item.label || "nao_hate",
              item.hateTypes || [],
              null,
              null,
              null,
              null,
              "csv_import",
              "v1",
              hashText(item.text),
            ],
          );

          analysisIds.push(Number(analysisResult.rows[0].analysis_id));
        }

        // Inserir itens do lote
        await client.query(
          `
          INSERT INTO gold_sampling_batch_items (batch_id, analysis_id, stratum, target_reviews)
          SELECT $1, unnest($2::bigint[]), unnest($3::text[]), unnest($4::smallint[])
        `,
          [
            batchId,
            analysisIds,
            analysisIds.map(() => "csv_import"),
            analysisIds.map(() => targetReviews),
          ],
        );

        // Criar reviews iniciais (round 1) para cada item * target_reviews
        // Na prática, o sistema de fila já distribui. Aqui apenas garantimos que
        // o batch_item tem target_reviews correto. As reviews são criadas on-demand.

        await writeAudit(client, {
          analysisId: 0,
          actorReviewerId: auth.reviewer.reviewerId,
          eventType: "batch_created_from_csv",
          newValue: {
            batchId,
            name,
            itemCount: items.length,
            targetReviews,
            columnMapping,
          },
        });

        await client.query("COMMIT");

        return NextResponse.json(
          {
            batchId,
            itemCount: items.length,
            targetReviews,
          },
          { status: 201 },
        );
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    }

    if (action === "combine_batches") {
      const batchIds = JSON.parse(
        String(formData.get("batchIds") || "[]"),
      ) as number[];
      const newName = String(formData.get("name") || "").trim().slice(0, 120);
      const targetReviews = Number(formData.get("targetReviews") || 1);

      if (!Array.isArray(batchIds) || batchIds.length < 2) {
        return NextResponse.json(
          { error: "Selecione pelo menos dois lotes para combinar." },
          { status: 400 },
        );
      }

      if (!newName) {
        return NextResponse.json(
          { error: "Informe um nome para o novo lote combinado." },
          { status: 400 },
        );
      }

      if (
        !Number.isInteger(targetReviews) ||
        targetReviews < 1 ||
        targetReviews > 10
      ) {
        return NextResponse.json(
          { error: "Número de avaliações por item deve ser entre 1 e 10." },
          { status: 400 },
        );
      }

      const pool = getPool();
      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // Buscar todos os itens dos lotes origem (únicos por analysis_id)
        const placeholders = batchIds.map((_, i) => `$${i + 1}`).join(",");
        const itemsResult = await client.query(
          `
          SELECT DISTINCT ON (i.analysis_id)
            i.analysis_id, i.stratum, i.target_reviews,
            a.platform, a.content_kind, a.external_id, a.text_snapshot,
            a.pred_label, a.hate_types, a.hate_probability,
            a.target_identified, a.textual_evidence, a.justification
          FROM gold_sampling_batch_items i
          JOIN gemma_hate_analyses a ON a.analysis_id = i.analysis_id
          WHERE i.batch_id IN (${placeholders})
          ORDER BY i.analysis_id, i.batch_item_id
        `,
          batchIds,
        );

        const items = itemsResult.rows;
        if (!items.length) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Nenhum item encontrado nos lotes selecionados." },
            { status: 409 },
          );
        }

        // Criar novo lote
        const batchResult = await client.query(
          `
          INSERT INTO gold_sampling_batches (
            batch_name, requested_size, selected_size,
            target_reviews, created_by
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING batch_id
        `,
          [
            newName,
            items.length,
            items.length,
            targetReviews,
            auth.reviewer.reviewerId,
          ],
        );

        const newBatchId = Number(batchResult.rows[0].batch_id);

        // Inserir itens no novo lote
        await client.query(
          `
          INSERT INTO gold_sampling_batch_items (batch_id, analysis_id, stratum, target_reviews)
          SELECT $1, unnest($2::bigint[]), unnest($3::text[]), unnest($4::smallint[])
        `,
          [
            newBatchId,
            items.map((r) => Number(r.analysis_id)),
            items.map((r) => String(r.stratum)),
            items.map(() => targetReviews),
          ],
        );

        await writeAudit(client, {
          analysisId: 0,
          actorReviewerId: auth.reviewer.reviewerId,
          eventType: "batches_combined",
          newValue: {
            newBatchId,
            name: newName,
            sourceBatchIds: batchIds,
            itemCount: items.length,
            targetReviews,
          },
        });

        await client.query("COMMIT");

        return NextResponse.json(
          {
            batchId: newBatchId,
            itemCount: items.length,
            targetReviews,
          },
          { status: 201 },
        );
      } catch (cause) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (cause) {
    return serverError(cause);
  }
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (auth.response) return auth.response;

  try {
    const url = new URL(request.url);
    const batchId = url.searchParams.get("batchId");
    const action = url.searchParams.get("action");

    if (action === "download_csv" && batchId) {
      const pool = getPool();
      const result = await pool.query(
        `
        SELECT csv_content, batch_name
        FROM gold_sampling_batches
        WHERE batch_id = $1
      `,
        [Number(batchId)],
      );

      if (!result.rowCount || !result.rows[0].csv_content) {
        return NextResponse.json(
          { error: "CSV não encontrado para este lote." },
          { status: 404 },
        );
      }

      const csv = result.rows[0].csv_content;
      const name = result.rows[0].batch_name;

      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}.csv"`,
        },
      });
    }

    if (action === "preview_csv" && batchId) {
      const pool = getPool();
      const result = await pool.query(
        `
        SELECT csv_columns
        FROM gold_sampling_batches
        WHERE batch_id = $1
      `,
        [Number(batchId)],
      );

      if (!result.rowCount) {
        return NextResponse.json(
          { error: "Lote não encontrado." },
          { status: 404 },
        );
      }

      return NextResponse.json({ columns: result.rows[0].csv_columns });
    }

    // Listar lotes disponíveis para combinar
    if (action === "list_for_combine") {
      const pool = getPool();
      const result = await pool.query(
        `
        SELECT batch_id, batch_name, selected_size, target_reviews, created_at,
               csv_content IS NOT NULL AS has_csv
        FROM gold_sampling_batches
        WHERE status = 'active'
        ORDER BY created_at DESC
      `,
      );

      return NextResponse.json({
        batches: result.rows.map((row) => ({
          batchId: Number(row.batch_id),
          name: String(row.batch_name),
          size: Number(row.selected_size),
          targetReviews: Number(row.target_reviews),
          createdAt: new Date(row.created_at).toISOString(),
          hasCsv: Boolean(row.has_csv),
        })),
      });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (cause) {
    return serverError(cause);
  }
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map((s) => s.trim());
}

function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(16, "0");
}