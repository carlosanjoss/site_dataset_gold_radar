-- ============================================================
-- MIGRAÇÃO V2: Lotes baseados em CSV, Múltiplas Avaliações, Freeze
-- ============================================================

-- 1. Tabela de controle de freeze global
CREATE TABLE IF NOT EXISTS gold_review_freeze (
    freeze_id           BIGSERIAL PRIMARY KEY,
    frozen              BOOLEAN NOT NULL DEFAULT FALSE,
    frozen_at           TIMESTAMPTZ,
    frozen_by           BIGINT REFERENCES gold_reviewers(reviewer_id),
    unfrozen_at         TIMESTAMPTZ,
    unfrozen_by         BIGINT REFERENCES gold_reviewers(reviewer_id),
    reason              TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garante apenas uma linha de controle
INSERT INTO gold_review_freeze (freeze_id, frozen)
VALUES (1, FALSE)
ON CONFLICT (freeze_id) DO NOTHING;

-- 2. Adicionar colunas em gold_sampling_batches para suporte a CSV
ALTER TABLE gold_sampling_batches
    ADD COLUMN IF NOT EXISTS csv_content        TEXT,           -- CSV original (para download/reuso)
    ADD COLUMN IF NOT EXISTS csv_columns        JSONB,          -- Mapeamento: {labelCol, hateTypesCol, textCol, platformCol, ...}
    ADD COLUMN IF NOT EXISTS target_reviews     SMALLINT NOT NULL DEFAULT 1
                            CHECK (target_reviews >= 1 AND target_reviews <= 10),
    ADD COLUMN IF NOT EXISTS freeze_snapshot    BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Remover constraints limitando a 2 reviews e permitir N reviews (1-10)
-- gold_sampling_batch_items.target_reviews
ALTER TABLE gold_sampling_batch_items
    DROP CONSTRAINT IF EXISTS gold_sampling_batch_items_target_reviews_check;

ALTER TABLE gold_sampling_batch_items
    ADD CONSTRAINT gold_sampling_batch_items_target_reviews_check
        CHECK (target_reviews >= 1 AND target_reviews <= 10);

-- gold_hate_reviews.review_round
ALTER TABLE gold_hate_reviews
    DROP CONSTRAINT IF EXISTS gold_hate_reviews_review_round_check;

ALTER TABLE gold_hate_reviews
    ADD CONSTRAINT gold_hate_reviews_review_round_check
        CHECK (review_round >= 1 AND review_round <= 10);

-- 4. Índices para performance com N reviews
CREATE INDEX IF NOT EXISTS idx_gold_hate_reviews_analysis_round
    ON gold_hate_reviews (analysis_id, review_round)
    WHERE review_status <> 'skipped';

CREATE INDEX IF NOT EXISTS idx_gold_batch_items_target_reviews
    ON gold_sampling_batch_items (target_reviews, batch_id);

-- 5. Função helper para verificar freeze ativo
CREATE OR REPLACE FUNCTION is_review_frozen()
RETURNS BOOLEAN AS $$
DECLARE
    frozen_state BOOLEAN;
BEGIN
    SELECT frozen INTO frozen_state
    FROM gold_review_freeze
    WHERE freeze_id = 1;
    RETURN COALESCE(frozen_state, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. Trigger para auditoria de freeze
CREATE OR REPLACE FUNCTION gold_audit_freeze_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.frozen IS DISTINCT FROM NEW.frozen THEN
        INSERT INTO gold_review_audit (
            analysis_id, actor_reviewer_id, event_type,
            previous_value, new_value, metadata
        ) VALUES (
            0, -- analysis_id 0 = evento global
            COALESCE(NEW.frozen_by, NEW.unfrozen_by),
            CASE WHEN NEW.frozen THEN 'global_freeze_activated' ELSE 'global_freeze_deactivated' END,
            jsonb_build_object('frozen', OLD.frozen),
            jsonb_build_object('frozen', NEW.frozen),
            jsonb_build_object('reason', NEW.reason)
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gold_audit_freeze ON gold_review_freeze;
CREATE TRIGGER trg_gold_audit_freeze
AFTER UPDATE ON gold_review_freeze
FOR EACH ROW EXECUTE FUNCTION gold_audit_freeze_change();

-- ============================================================
-- FIM DA MIGRAÇÃO V2
-- ============================================================