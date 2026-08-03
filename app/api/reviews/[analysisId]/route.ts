import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { getPool } from "@/lib/db";
import {
  refreshConsensus,
  syncNliEligibility,
  writeAudit,
} from "@/lib/review-workflow";
import {
  NLI_LAYER4_DIMENSIONS,
  validateLayer3Answers,
} from "@/lib/nli";
import { serverError, unauthorized } from "@/lib/responses";

type ReviewAction = "confirmed" | "corrected" | "skipped";

const ALLOWED_NLI_LAYER4 = new Set(
  NLI_LAYER4_DIMENSIONS.map((dimension) => dimension.code),
);

export async function POST(
  request: Request,
  context: { params: Promise<{ analysisId: string }> },
) {
  const reviewer = await getAuthenticatedReviewer();
  if (!reviewer) return unauthorized();
  if (reviewer.mustChangePassword) {
    return NextResponse.json(
      { error: "Troque sua senha antes de iniciar a revisão." },
      { status: 403 },
    );
  }

  const analysisId = Number((await context.params).analysisId);
  if (!Number.isSafeInteger(analysisId) || analysisId <= 0) {
    return NextResponse.json({ error: "Análise inválida." }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    const body = await request.json();
    const action = String(body.action || "") as ReviewAction;
    if (!["confirmed", "corrected", "skipped"].includes(action)) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const note = String(body.note || "").trim().slice(0, 2000) || null;

    await client.query("BEGIN");
    const assigned = await client.query(
      `
        SELECT
          r.review_id,
          r.review_round,
          a.pred_label,
          a.hate_types,
          a.hate_probability
        FROM gold_hate_reviews r
        JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
        WHERE r.analysis_id = $1
          AND r.reviewer_id = $2
          AND r.review_status = 'assigned'
        FOR UPDATE OF r
      `,
      [analysisId, reviewer.reviewerId],
    );
    if (!assigned.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Este item não está mais reservado para você." },
        { status: 409 },
      );
    }

    let finalLabel: "hate" | "nao_hate" | null = null;
    let finalTypes: string[] = [];
    if (action === "confirmed") {
      finalLabel = assigned.rows[0].pred_label;
      finalTypes = (assigned.rows[0].hate_types || [])
        .map(String)
        .filter((code: string) => code !== "other");
      if (finalLabel === "hate" && !finalTypes.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error:
              "A predição usa somente a antiga categoria genérica. Corrija e selecione um tipo específico.",
          },
          { status: 400 },
        );
      }
    } else if (action === "corrected") {
      if (!["hate", "nao_hate"].includes(body.finalLabel)) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Informe o rótulo final da correção." },
          { status: 400 },
        );
      }
      finalLabel = body.finalLabel;
      const submittedTypes: string[] = Array.isArray(body.finalHateTypes)
        ? Array.from(
            new Set<string>(
              body.finalHateTypes.map((value: unknown) => String(value)),
            ),
          )
        : [];
      if (finalLabel === "hate") {
        if (!submittedTypes.length) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Selecione ao menos um tipo de hate." },
            { status: 400 },
          );
        }
        const allowed = await client.query(
          `
            SELECT category_code
            FROM gemma_hate_categories
            WHERE active IS TRUE AND category_code = ANY($1::text[])
          `,
          [submittedTypes],
        );
        if (allowed.rowCount !== submittedTypes.length) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Uma das categorias selecionadas é inválida." },
            { status: 400 },
          );
        }
        finalTypes = submittedTypes;
      }
    }

    let validatedNli: ReturnType<typeof validateLayer3Answers> | null = null;
    let nliLayer4Dimensions: string[] = [];
    if (action !== "skipped" && finalLabel === "hate") {
      validatedNli = validateLayer3Answers(body.nliLayer3Answers);
      if ("error" in validatedNli) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: validatedNli.error },
          { status: 400 },
        );
      }
      nliLayer4Dimensions = Array.isArray(body.nliLayer4Dimensions)
        ? Array.from(
            new Set<string>(
              body.nliLayer4Dimensions.map((value: unknown) => String(value)),
            ),
          )
        : [];
      if (
        nliLayer4Dimensions.some(
          (code) => !ALLOWED_NLI_LAYER4.has(code as never),
        )
      ) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Uma das dimensões da Camada 4 é inválida." },
          { status: 400 },
        );
      }
    }

    await client.query(
      `
        UPDATE gold_hate_reviews
        SET review_status = $1,
            final_label = $2,
            final_hate_types = $3,
            review_note = $4,
            reviewed_at = NOW()
        WHERE analysis_id = $5 AND reviewer_id = $6
      `,
      [action, finalLabel, finalTypes, note, analysisId, reviewer.reviewerId],
    );
    await writeAudit(client, {
      analysisId,
      reviewId: Number(assigned.rows[0].review_id),
      actorReviewerId: reviewer.reviewerId,
      eventType: action === "skipped" ? "skipped" : "decision_submitted",
      previousValue: {
        reviewStatus: "assigned",
        finalLabel: null,
        finalHateTypes: [],
      },
      newValue: {
        reviewStatus: action,
        finalLabel,
        finalHateTypes: finalTypes,
        note,
        reviewRound: Number(assigned.rows[0].review_round || 1),
      },
      metadata: {
        gemmaLabel: String(assigned.rows[0].pred_label),
        gemmaHateTypes: (assigned.rows[0].hate_types || []).map(String),
        gemmaProbability:
          assigned.rows[0].hate_probability === null
            ? null
            : Number(assigned.rows[0].hate_probability),
      },
    });
    const consensus =
      action === "skipped"
        ? null
        : await refreshConsensus(client, analysisId);
    if (action !== "skipped") {
      await syncNliEligibility(client, analysisId);
    }
    let nliSaved = false;
    if (
      action !== "skipped" &&
      finalLabel === "hate" &&
      validatedNli &&
      !("error" in validatedNli)
    ) {
      const nliReview = await client.query(
        `
          INSERT INTO gold_nli_reviews (
            analysis_id, reviewer_id, review_status, layer3_level,
            layer3_answers, layer4_dimensions, review_note,
            assigned_at, reviewed_at, invalidated_at
          )
          VALUES ($1, $2, 'completed', $3, $4::JSONB, $5, $6, NOW(), NOW(), NULL)
          ON CONFLICT (analysis_id, reviewer_id) DO UPDATE
          SET review_status = 'completed',
              layer3_level = EXCLUDED.layer3_level,
              layer3_answers = EXCLUDED.layer3_answers,
              layer4_dimensions = EXCLUDED.layer4_dimensions,
              review_note = EXCLUDED.review_note,
              reviewed_at = NOW(),
              invalidated_at = NULL
          RETURNING nli_review_id
        `,
        [
          analysisId,
          reviewer.reviewerId,
          validatedNli.level,
          JSON.stringify(validatedNli.answers),
          nliLayer4Dimensions,
          note,
        ],
      );
      const nliReviewId = Number(nliReview.rows[0].nli_review_id);
      await client.query(
        `
          INSERT INTO gold_nli_review_audit (
            nli_review_id, analysis_id, actor_reviewer_id,
            event_type, previous_value, new_value
          )
          VALUES ($1, $2, $3, 'inline_decision_submitted', NULL, $4::JSONB)
        `,
        [
          nliReviewId,
          analysisId,
          reviewer.reviewerId,
          JSON.stringify({
            reviewStatus: "completed",
            layer3Level: validatedNli.level,
            layer3Answers: validatedNli.answers,
            layer4Dimensions: nliLayer4Dimensions,
            note,
            source: "integrated_gold_flow",
          }),
        ],
      );
      nliSaved = true;
    }
    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      consensus,
      nliQueued:
        consensus &&
        "decision" in consensus &&
        consensus.decision?.label === "hate",
      nliSaved,
    });
  } catch (cause) {
    await client.query("ROLLBACK");
    return serverError(cause);
  } finally {
    client.release();
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ analysisId: string }> },
) {
  const reviewer = await getAuthenticatedReviewer();
  if (!reviewer) return unauthorized();
  if (reviewer.mustChangePassword) {
    return NextResponse.json(
      { error: "Troque sua senha antes de alterar uma avaliação." },
      { status: 403 },
    );
  }

  const analysisId = Number((await context.params).analysisId);
  if (!Number.isSafeInteger(analysisId) || analysisId <= 0) {
    return NextResponse.json({ error: "Análise inválida." }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    const body = await request.json();
    if (!["hate", "nao_hate"].includes(body.finalLabel)) {
      return NextResponse.json(
        { error: "Informe o rótulo final da avaliação." },
        { status: 400 },
      );
    }
    const finalLabel = body.finalLabel as "hate" | "nao_hate";
    const submittedTypes: string[] = Array.isArray(body.finalHateTypes)
      ? Array.from(
          new Set<string>(
            body.finalHateTypes.map((value: unknown) => String(value)),
          ),
        )
      : [];
    const note = String(body.note || "").trim().slice(0, 2000) || null;
    let finalTypes: string[] = [];

    await client.query("BEGIN");
    if (finalLabel === "hate") {
      if (!submittedTypes.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Selecione ao menos um tipo de hate." },
          { status: 400 },
        );
      }
      const allowed = await client.query(
        `
          SELECT category_code
          FROM gemma_hate_categories
          WHERE active IS TRUE AND category_code = ANY($1::TEXT[])
        `,
        [submittedTypes],
      );
      if (allowed.rowCount !== submittedTypes.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Uma das categorias selecionadas é inválida." },
          { status: 400 },
        );
      }
      finalTypes = submittedTypes;
    }

    const current = await client.query(
      `
        SELECT
          r.review_id,
          r.review_status,
          r.final_label,
          r.final_hate_types,
          r.review_note,
          r.reviewed_at,
          r.review_round,
          a.pred_label,
          a.hate_types,
          a.hate_probability
        FROM gold_hate_reviews r
        JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
        WHERE r.analysis_id = $1
          AND r.reviewer_id = $2
          AND r.review_status IN ('confirmed', 'corrected')
        FOR UPDATE OF r
      `,
      [analysisId, reviewer.reviewerId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Esta avaliação não foi encontrada no seu histórico." },
        { status: 404 },
      );
    }

    const row = current.rows[0];
    const gemmaTypes = (row.hate_types || []).map(String).sort();
    const normalizedFinalTypes = [...finalTypes].sort();
    const matchesGemma =
      finalLabel === String(row.pred_label) &&
      JSON.stringify(normalizedFinalTypes) === JSON.stringify(gemmaTypes);
    const reviewStatus = matchesGemma ? "confirmed" : "corrected";

    await client.query(
      `
        UPDATE gold_hate_reviews
        SET review_status = $1,
            final_label = $2,
            final_hate_types = $3,
            review_note = $4,
            reviewed_at = NOW()
        WHERE review_id = $5
      `,
      [
        reviewStatus,
        finalLabel,
        finalTypes,
        note,
        Number(row.review_id),
      ],
    );
    await writeAudit(client, {
      analysisId,
      reviewId: Number(row.review_id),
      actorReviewerId: reviewer.reviewerId,
      eventType: "decision_revised",
      previousValue: {
        reviewStatus: String(row.review_status),
        finalLabel: String(row.final_label),
        finalHateTypes: (row.final_hate_types || []).map(String),
        note: row.review_note ? String(row.review_note) : null,
        reviewedAt: row.reviewed_at
          ? new Date(row.reviewed_at).toISOString()
          : null,
      },
      newValue: {
        reviewStatus,
        finalLabel,
        finalHateTypes: finalTypes,
        note,
        reviewRound: Number(row.review_round || 1),
      },
      metadata: {
        gemmaLabel: String(row.pred_label),
        gemmaHateTypes: (row.hate_types || []).map(String),
        gemmaProbability:
          row.hate_probability === null
            ? null
            : Number(row.hate_probability),
        source: "reviewer_history",
      },
    });
    const consensus = await refreshConsensus(client, analysisId);
    await syncNliEligibility(client, analysisId);
    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      reviewStatus,
      reviewedAt: new Date().toISOString(),
      consensus,
      nliQueued:
        consensus &&
        "decision" in consensus &&
        consensus.decision?.label === "hate",
    });
  } catch (cause) {
    await client.query("ROLLBACK");
    return serverError(cause);
  } finally {
    client.release();
  }
}
