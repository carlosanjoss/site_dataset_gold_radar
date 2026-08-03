import { NextResponse } from "next/server";
import { getAuthenticatedReviewer } from "@/lib/auth";
import { getPool } from "@/lib/db";
import {
  NLI_LAYER4_DIMENSIONS,
  validateLayer3Answers,
} from "@/lib/nli";
import { serverError, unauthorized } from "@/lib/responses";

const ALLOWED_LAYER4 = new Set(
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
      { error: "Troque sua senha antes de avaliar as camadas NLI." },
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
    const action = String(body.action || "completed");
    if (!['completed', 'skipped'].includes(action)) {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }
    const note = String(body.note || "").trim().slice(0, 2000) || null;
    let validatedLayer3:
      | ReturnType<typeof validateLayer3Answers>
      | null = null;
    let layer4Dimensions: string[] = [];
    if (action === "completed") {
      validatedLayer3 = validateLayer3Answers(body.layer3Answers);
      if ("error" in validatedLayer3) {
        return NextResponse.json(
          { error: validatedLayer3.error },
          { status: 400 },
        );
      }
      layer4Dimensions = Array.isArray(body.layer4Dimensions)
        ? Array.from(
            new Set<string>(
              body.layer4Dimensions.map((value: unknown) => String(value)),
            ),
          )
        : [];
      if (layer4Dimensions.some((code) => !ALLOWED_LAYER4.has(code as never))) {
        return NextResponse.json(
          { error: "Uma das dimensões da Camada 4 é inválida." },
          { status: 400 },
        );
      }
    }

    await client.query("BEGIN");
    const assigned = await client.query(
      `
        SELECT n.nli_review_id
        FROM gold_nli_reviews n
        JOIN gold_review_consensus c ON c.analysis_id = n.analysis_id
        WHERE n.analysis_id = $1
          AND n.reviewer_id = $2
          AND n.review_status = 'assigned'
          AND c.decision_status IN ('single', 'agreed', 'adjudicated')
          AND c.final_label = 'hate'
        FOR UPDATE OF n
      `,
      [analysisId, reviewer.reviewerId],
    );
    if (!assigned.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Este item NLI não está mais reservado para você." },
        { status: 409 },
      );
    }
    const nliReviewId = Number(assigned.rows[0].nli_review_id);
    if (action === "skipped") {
      await client.query(
        `
          UPDATE gold_nli_reviews
          SET review_status = 'skipped', review_note = $2,
              reviewed_at = NOW()
          WHERE nli_review_id = $1
        `,
        [nliReviewId, note],
      );
    } else if (validatedLayer3 && !("error" in validatedLayer3)) {
      await client.query(
        `
          UPDATE gold_nli_reviews
          SET review_status = 'completed', layer3_level = $2,
              layer3_answers = $3::JSONB, layer4_dimensions = $4,
              review_note = $5, reviewed_at = NOW()
          WHERE nli_review_id = $1
        `,
        [
          nliReviewId,
          validatedLayer3.level,
          JSON.stringify(validatedLayer3.answers),
          layer4Dimensions,
          note,
        ],
      );
    }
    await client.query(
      `
        INSERT INTO gold_nli_review_audit (
          nli_review_id, analysis_id, actor_reviewer_id,
          event_type, previous_value, new_value
        )
        VALUES ($1, $2, $3, $4,
          '{"reviewStatus":"assigned"}'::JSONB, $5::JSONB)
      `,
      [
        nliReviewId,
        analysisId,
        reviewer.reviewerId,
        action === "skipped" ? "skipped" : "decision_submitted",
        JSON.stringify(
          action === "skipped"
            ? { reviewStatus: "skipped", note }
            : {
                reviewStatus: "completed",
                layer3Level:
                  validatedLayer3 && !("error" in validatedLayer3)
                    ? validatedLayer3.level
                    : null,
                layer3Answers:
                  validatedLayer3 && !("error" in validatedLayer3)
                    ? validatedLayer3.answers
                    : {},
                layer4Dimensions,
                note,
              },
        ),
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      layer3Level:
        validatedLayer3 && !("error" in validatedLayer3)
          ? validatedLayer3.level
          : null,
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
      { error: "Troque sua senha antes de alterar a avaliação NLI." },
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
    const layer3 = validateLayer3Answers(body.layer3Answers);
    if ("error" in layer3) {
      return NextResponse.json({ error: layer3.error }, { status: 400 });
    }
    const layer4Dimensions = Array.isArray(body.layer4Dimensions)
      ? Array.from(
          new Set<string>(
            body.layer4Dimensions.map((value: unknown) => String(value)),
          ),
        )
      : [];
    if (layer4Dimensions.some((code) => !ALLOWED_LAYER4.has(code as never))) {
      return NextResponse.json(
        { error: "Uma das dimensões da Camada 4 é inválida." },
        { status: 400 },
      );
    }
    const note = String(body.note || "").trim().slice(0, 2000) || null;
    await client.query("BEGIN");
    const current = await client.query(
      `
        SELECT n.nli_review_id, n.layer3_level, n.layer3_answers,
               n.layer4_dimensions, n.review_note, n.reviewed_at
        FROM gold_nli_reviews n
        JOIN gold_review_consensus c ON c.analysis_id = n.analysis_id
        WHERE n.analysis_id = $1
          AND n.reviewer_id = $2
          AND n.review_status = 'completed'
          AND c.decision_status IN ('single', 'agreed', 'adjudicated')
          AND c.final_label = 'hate'
        FOR UPDATE OF n
      `,
      [analysisId, reviewer.reviewerId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Avaliação NLI não encontrada ou não é mais elegível." },
        { status: 404 },
      );
    }
    const row = current.rows[0];
    await client.query(
      `
        UPDATE gold_nli_reviews
        SET layer3_level = $2, layer3_answers = $3::JSONB,
            layer4_dimensions = $4, review_note = $5,
            reviewed_at = NOW()
        WHERE nli_review_id = $1
      `,
      [
        Number(row.nli_review_id),
        layer3.level,
        JSON.stringify(layer3.answers),
        layer4Dimensions,
        note,
      ],
    );
    await client.query(
      `
        INSERT INTO gold_nli_review_audit (
          nli_review_id, analysis_id, actor_reviewer_id,
          event_type, previous_value, new_value
        )
        VALUES ($1, $2, $3, 'decision_revised', $4::JSONB, $5::JSONB)
      `,
      [
        Number(row.nli_review_id),
        analysisId,
        reviewer.reviewerId,
        JSON.stringify({
          layer3Level: row.layer3_level,
          layer3Answers: row.layer3_answers,
          layer4Dimensions: row.layer4_dimensions,
          note: row.review_note,
          reviewedAt: row.reviewed_at,
        }),
        JSON.stringify({
          layer3Level: layer3.level,
          layer3Answers: layer3.answers,
          layer4Dimensions,
          note,
        }),
      ],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, layer3Level: layer3.level });
  } catch (cause) {
    await client.query("ROLLBACK");
    return serverError(cause);
  } finally {
    client.release();
  }
}
