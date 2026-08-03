CREATE TABLE IF NOT EXISTS gold_reviewers (
    reviewer_id       BIGSERIAL PRIMARY KEY,
    display_name      TEXT NOT NULL CHECK (NULLIF(BTRIM(display_name), '') IS NOT NULL),
    reviewer_code     VARCHAR(32) NOT NULL UNIQUE,
    active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE gold_reviewers
    ADD COLUMN IF NOT EXISTS username VARCHAR(64),
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS password_salt TEXT,
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'reviewer',
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS double_review_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gold_reviewers_username
    ON gold_reviewers (LOWER(username))
    WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS gold_login_attempts (
    attempt_id         BIGSERIAL PRIMARY KEY,
    attempted_username VARCHAR(64) NOT NULL,
    succeeded          BOOLEAN NOT NULL DEFAULT FALSE,
    attempted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gold_login_attempts_recent
    ON gold_login_attempts (attempted_username, attempted_at DESC)
    WHERE succeeded IS FALSE;

CREATE TABLE IF NOT EXISTS gold_reviewer_sessions (
    session_id        BIGSERIAL PRIMARY KEY,
    reviewer_id       BIGINT NOT NULL REFERENCES gold_reviewers(reviewer_id) ON DELETE CASCADE,
    token_hash        CHAR(64) NOT NULL UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL,
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gold_reviewer_sessions_reviewer
    ON gold_reviewer_sessions (reviewer_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS gold_hate_reviews (
    review_id         BIGSERIAL PRIMARY KEY,
    analysis_id       BIGINT NOT NULL UNIQUE
                      REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    reviewer_id       BIGINT NOT NULL
                      REFERENCES gold_reviewers(reviewer_id),
    review_status     TEXT NOT NULL DEFAULT 'assigned'
                      CHECK (review_status IN ('assigned', 'confirmed', 'corrected', 'skipped')),
    final_label       TEXT CHECK (final_label IN ('hate', 'nao_hate')),
    final_hate_types  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    review_note       TEXT,
    assigned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at       TIMESTAMPTZ,
    CHECK (
        (review_status IN ('assigned', 'skipped') AND final_label IS NULL)
        OR
        (review_status IN ('confirmed', 'corrected') AND final_label IS NOT NULL)
    ),
    CHECK (
        final_label IS NULL
        OR (final_label = 'hate' AND cardinality(final_hate_types) > 0)
        OR (final_label = 'nao_hate' AND cardinality(final_hate_types) = 0)
    )
);

ALTER TABLE gold_hate_reviews
    DROP CONSTRAINT IF EXISTS gold_hate_reviews_analysis_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gold_hate_reviews_analysis_reviewer
    ON gold_hate_reviews (analysis_id, reviewer_id);

CREATE INDEX IF NOT EXISTS idx_gold_hate_reviews_reviewer_status
    ON gold_hate_reviews (reviewer_id, review_status, assigned_at);
CREATE INDEX IF NOT EXISTS idx_gold_hate_reviews_status
    ON gold_hate_reviews (review_status, reviewed_at);

ALTER TABLE gemma_hate_categories
    ADD COLUMN IF NOT EXISTS positive_example TEXT,
    ADD COLUMN IF NOT EXISTS boundary_example TEXT;

-- Mantém os códigos internos produzidos pelo modelo e atualiza somente a
-- taxonomia apresentada aos avaliadores e aos painéis administrativos.
UPDATE gemma_hate_categories
SET
    category_name = CASE category_code
        WHEN 'aporophobia' THEN 'Classismo'
        WHEN 'body_shame' THEN 'Gordofobia'
        WHEN 'political' THEN 'Ódio político'
        WHEN 'misogyny' THEN 'Sexismo'
        ELSE category_name
    END,
    description = CASE category_code
        WHEN 'aporophobia' THEN 'Hostilidade baseada em classe social, pobreza ou vulnerabilidade econômica.'
        WHEN 'body_shame' THEN 'Hostilidade baseada no peso corporal, especialmente contra pessoas gordas.'
        WHEN 'political' THEN 'Ódio ou hostilidade generalizante contra grupos e identidades políticas.'
        WHEN 'misogyny' THEN 'Hostilidade ou discriminação baseada em sexo ou gênero.'
        ELSE description
    END,
    positive_example = CASE category_code
        WHEN 'aporophobia' THEN '“Pobre é tudo igual e não merece ocupar este lugar.”'
        WHEN 'body_shame' THEN '“Pessoa gorda deveria ter vergonha de aparecer em público.”'
        WHEN 'political' THEN '“Todo eleitor desse partido é criminoso e deve ser expulso.”'
        WHEN 'misogyny' THEN '“Mulheres são incapazes de liderar e devem obedecer aos homens.”'
        ELSE positive_example
    END,
    boundary_example = CASE category_code
        WHEN 'aporophobia' THEN 'Debater renda, pobreza ou políticas econômicas sem inferiorizar pessoas por sua classe social não basta para marcar hate.'
        WHEN 'body_shame' THEN 'Uma descrição neutra de aparência ou uma conversa sobre saúde sem humilhação baseada no peso não basta para marcar hate.'
        WHEN 'political' THEN 'Criticar um político ou uma decisão pública, sem atacar todos os integrantes de um grupo, não basta para marcar hate.'
        WHEN 'misogyny' THEN 'Discutir gênero, desigualdade ou sexismo de terceiros sem atacar pessoas por sexo ou gênero não basta para marcar hate.'
        ELSE boundary_example
    END
WHERE category_code IN ('aporophobia', 'body_shame', 'political', 'misogyny');

UPDATE gemma_hate_categories
SET
    positive_example = CASE category_code
        WHEN 'ageism' THEN '“Pessoas dessa idade são inúteis e deveriam ser excluídas.”'
        WHEN 'aporophobia' THEN '“Pobre é tudo igual e não merece ocupar este lugar.”'
        WHEN 'body_shame' THEN '“Gente com esse corpo deveria ter vergonha de aparecer.”'
        WHEN 'capacitism' THEN '“Pessoas com deficiência são incapazes e só atrapalham.”'
        WHEN 'lgbtphobia' THEN '“Esse grupo não deveria ter os mesmos direitos.”'
        WHEN 'political' THEN '“Todo eleitor desse partido é criminoso e deve ser expulso.”'
        WHEN 'racism' THEN '“Pessoas dessa raça são inferiores.”'
        WHEN 'religious_intolerance' THEN '“Quem segue essa religião deve ser eliminado daqui.”'
        WHEN 'misogyny' THEN '“Mulher não serve para liderar e deve obedecer.”'
        WHEN 'xenophobia' THEN '“Gente desse país é uma praga e precisa ir embora.”'
        ELSE 'Ataque generalizante contra um grupo protegido ou socialmente identificável.'
    END,
    boundary_example = CASE category_code
        WHEN 'political' THEN 'Criticar um político ou uma decisão pública, sem atacar todos os integrantes de um grupo, não basta para marcar hate.'
        ELSE 'Crítica a uma pessoa ou comportamento específico, sem generalização contra o grupo, normalmente não é discurso de ódio.'
    END
WHERE positive_example IS NULL OR boundary_example IS NULL;

-- A categoria genérica não faz parte do protocolo de rotulagem gold.
-- Ela continua preservada nas respostas históricas do modelo, mas não pode
-- mais ser selecionada ou validada por avaliadores.
UPDATE gemma_hate_categories
SET active = FALSE
WHERE category_code = 'other';

CREATE TABLE IF NOT EXISTS gold_sampling_batches (
    batch_id                BIGSERIAL PRIMARY KEY,
    batch_name              TEXT NOT NULL,
    requested_size          INTEGER NOT NULL CHECK (requested_size BETWEEN 1 AND 10000),
    selected_size           INTEGER NOT NULL DEFAULT 0,
    double_review_percent   SMALLINT NOT NULL DEFAULT 0
                            CHECK (double_review_percent BETWEEN 0 AND 100),
    status                  TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'closed')),
    created_by              BIGINT REFERENCES gold_reviewers(reviewer_id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at               TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS gold_sampling_batch_items (
    batch_item_id      BIGSERIAL PRIMARY KEY,
    batch_id           BIGINT NOT NULL
                       REFERENCES gold_sampling_batches(batch_id) ON DELETE CASCADE,
    analysis_id        BIGINT NOT NULL
                       REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    stratum            TEXT NOT NULL,
    target_reviews     SMALLINT NOT NULL DEFAULT 1
                       CHECK (target_reviews IN (1, 2)),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, analysis_id),
    UNIQUE (analysis_id)
);

CREATE INDEX IF NOT EXISTS idx_gold_batch_items_queue
    ON gold_sampling_batch_items (batch_id, target_reviews, batch_item_id);

ALTER TABLE gold_hate_reviews
    ADD COLUMN IF NOT EXISTS batch_item_id BIGINT
        REFERENCES gold_sampling_batch_items(batch_item_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS review_round SMALLINT NOT NULL DEFAULT 1
        CHECK (review_round IN (1, 2));

DROP INDEX IF EXISTS uq_gold_hate_reviews_batch_round;
CREATE UNIQUE INDEX uq_gold_hate_reviews_batch_round
    ON gold_hate_reviews (batch_item_id, review_round)
    WHERE batch_item_id IS NOT NULL AND review_status <> 'skipped';
DROP INDEX IF EXISTS uq_gold_hate_reviews_analysis_round;
CREATE UNIQUE INDEX uq_gold_hate_reviews_analysis_round
    ON gold_hate_reviews (analysis_id, review_round)
    WHERE review_status <> 'skipped';

CREATE TABLE IF NOT EXISTS gold_review_consensus (
    analysis_id        BIGINT PRIMARY KEY
                       REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    decision_status    TEXT NOT NULL
                       CHECK (
                         decision_status IN (
                           'awaiting_second', 'single', 'agreed',
                           'conflict', 'adjudicated'
                         )
                       ),
    final_label        TEXT CHECK (final_label IN ('hate', 'nao_hate')),
    final_hate_types   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    resolved_by        BIGINT REFERENCES gold_reviewers(reviewer_id),
    resolved_at        TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (decision_status IN ('awaiting_second', 'conflict') AND final_label IS NULL)
        OR
        (decision_status IN ('single', 'agreed', 'adjudicated') AND final_label IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_gold_consensus_status
    ON gold_review_consensus (decision_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS gold_review_audit (
    audit_id           BIGSERIAL PRIMARY KEY,
    analysis_id        BIGINT NOT NULL
                       REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    review_id          BIGINT REFERENCES gold_hate_reviews(review_id) ON DELETE SET NULL,
    actor_reviewer_id  BIGINT REFERENCES gold_reviewers(reviewer_id) ON DELETE SET NULL,
    event_type         TEXT NOT NULL,
    previous_value     JSONB,
    new_value          JSONB,
    metadata           JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gold_review_audit_recent
    ON gold_review_audit (created_at DESC, audit_id DESC);
CREATE INDEX IF NOT EXISTS idx_gold_review_audit_analysis
    ON gold_review_audit (analysis_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gemma_hate_review_queue
    ON gemma_hate_analyses (
      model_name, prompt_version, platform, analysis_id
    )
    WHERE status = 'success';

-- Avaliação humana das camadas NLI. A Camada 3 usa uma árvore de decisão
-- N5 -> N4 -> N3 -> N2, com N1 como resultado quando todas forem negativas.
-- Respostas não exibidas depois do primeiro "sim" permanecem nulas no JSON.
CREATE TABLE IF NOT EXISTS gold_nli_reviews (
    nli_review_id       BIGSERIAL PRIMARY KEY,
    analysis_id         BIGINT NOT NULL
                        REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    reviewer_id         BIGINT NOT NULL
                        REFERENCES gold_reviewers(reviewer_id),
    review_status       TEXT NOT NULL DEFAULT 'assigned'
                        CHECK (
                          review_status IN (
                            'assigned', 'completed', 'skipped', 'invalidated'
                          )
                        ),
    layer3_level        TEXT CHECK (layer3_level IN ('N1', 'N2', 'N3', 'N4', 'N5')),
    layer3_answers      JSONB NOT NULL DEFAULT '{}'::JSONB
                        CHECK (jsonb_typeof(layer3_answers) = 'object'),
    layer4_dimensions   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
                        CHECK (
                          layer4_dimensions <@ ARRAY[
                            'authoritarianism', 'dehumanization', 'factualization',
                            'social_dominance', 'revictimization'
                          ]::TEXT[]
                        ),
    review_note         TEXT,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at         TIMESTAMPTZ,
    invalidated_at      TIMESTAMPTZ,
    CHECK (
      (review_status = 'completed' AND layer3_level IS NOT NULL AND reviewed_at IS NOT NULL)
      OR
      (review_status <> 'completed' AND layer3_level IS NULL)
    ),
    UNIQUE (analysis_id, reviewer_id)
);

-- Renomeia a antiga dimensão humana sem alterar os resultados históricos
-- brutos produzidos pelos modelos NLI.
ALTER TABLE gold_nli_reviews
    DROP CONSTRAINT IF EXISTS gold_nli_reviews_layer4_dimensions_check;

UPDATE gold_nli_reviews
SET layer4_dimensions = ARRAY(
    SELECT CASE
        WHEN dimension = 'masculinism' THEN 'social_dominance'
        ELSE dimension
    END
    FROM UNNEST(layer4_dimensions) AS dimension
)
WHERE 'masculinism' = ANY(layer4_dimensions);

ALTER TABLE gold_nli_reviews
    ADD CONSTRAINT gold_nli_reviews_layer4_dimensions_check
    CHECK (
      layer4_dimensions <@ ARRAY[
        'authoritarianism', 'dehumanization', 'factualization',
        'social_dominance', 'revictimization'
      ]::TEXT[]
    );

-- As Camadas 3 e 4 agora fazem parte da mesma sequência das Camadas 1 e 2.
-- Em revisão dupla, cada especialista pode registrar sua própria avaliação NLI.
DROP INDEX IF EXISTS uq_gold_nli_active_analysis;
CREATE INDEX IF NOT EXISTS idx_gold_nli_active_analysis
    ON gold_nli_reviews (analysis_id)
    WHERE review_status IN ('assigned', 'completed');
CREATE INDEX IF NOT EXISTS idx_gold_nli_reviewer_queue
    ON gold_nli_reviews (reviewer_id, review_status, assigned_at);
CREATE INDEX IF NOT EXISTS idx_gold_nli_completed
    ON gold_nli_reviews (review_status, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS gold_nli_review_audit (
    audit_id            BIGSERIAL PRIMARY KEY,
    nli_review_id       BIGINT REFERENCES gold_nli_reviews(nli_review_id) ON DELETE SET NULL,
    analysis_id         BIGINT NOT NULL
                        REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    actor_reviewer_id   BIGINT REFERENCES gold_reviewers(reviewer_id) ON DELETE SET NULL,
    event_type          TEXT NOT NULL,
    previous_value      JSONB,
    new_value           JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gold_nli_audit_analysis
    ON gold_nli_review_audit (analysis_id, created_at DESC);

CREATE OR REPLACE VIEW gold_nli_dataset AS
SELECT
    a.analysis_id,
    a.platform,
    a.content_kind,
    a.external_id,
    a.text_snapshot,
    c.final_hate_types,
    n.layer3_level,
    n.layer3_answers,
    n.layer4_dimensions,
    n.review_note,
    n.reviewer_id,
    reviewer.display_name AS reviewer_name,
    n.reviewed_at
FROM gold_nli_reviews n
JOIN gemma_hate_analyses a ON a.analysis_id = n.analysis_id
JOIN gold_review_consensus c ON c.analysis_id = n.analysis_id
JOIN gold_reviewers reviewer ON reviewer.reviewer_id = n.reviewer_id
WHERE n.review_status = 'completed'
  AND c.decision_status IN ('single', 'agreed', 'adjudicated')
  AND c.final_label = 'hate';
CREATE UNIQUE INDEX IF NOT EXISTS idx_gold_hate_reviews_analysis_reviewer
    ON gold_hate_reviews (analysis_id, reviewer_id);

CREATE TABLE IF NOT EXISTS gold_duplicate_map (
    analysis_id            BIGINT PRIMARY KEY
                           REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    canonical_analysis_id  BIGINT NOT NULL
                           REFERENCES gemma_hate_analyses(analysis_id) ON DELETE CASCADE,
    text_hash              VARCHAR(64) NOT NULL,
    refreshed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gold_duplicate_map_canonical
    ON gold_duplicate_map (canonical_analysis_id);
CREATE INDEX IF NOT EXISTS idx_gemma_hate_analyses_exact_duplicate
    ON gemma_hate_analyses (model_name, prompt_version, text_hash, analysis_id)
    WHERE status = 'success';

INSERT INTO gold_duplicate_map (
    analysis_id, canonical_analysis_id, text_hash, refreshed_at
)
SELECT
    analysis_id,
    MIN(analysis_id) OVER (
        PARTITION BY model_name, prompt_version, text_hash
    ) AS canonical_analysis_id,
    text_hash,
    NOW()
FROM gemma_hate_analyses
WHERE status = 'success'
ON CONFLICT (analysis_id) DO UPDATE
SET canonical_analysis_id = EXCLUDED.canonical_analysis_id,
    text_hash = EXCLUDED.text_hash,
    refreshed_at = NOW();

CREATE OR REPLACE FUNCTION gold_sync_duplicate_map()
RETURNS TRIGGER AS $$
DECLARE
    canonical_id BIGINT;
BEGIN
    IF NEW.status <> 'success' OR NEW.text_hash IS NULL THEN
        DELETE FROM gold_duplicate_map WHERE analysis_id = NEW.analysis_id;
        RETURN NEW;
    END IF;

    SELECT MIN(analysis_id)
    INTO canonical_id
    FROM gemma_hate_analyses
    WHERE status = 'success'
      AND model_name = NEW.model_name
      AND prompt_version = NEW.prompt_version
      AND text_hash = NEW.text_hash;

    INSERT INTO gold_duplicate_map (
        analysis_id, canonical_analysis_id, text_hash, refreshed_at
    )
    VALUES (NEW.analysis_id, canonical_id, NEW.text_hash, NOW())
    ON CONFLICT (analysis_id) DO UPDATE
    SET canonical_analysis_id = EXCLUDED.canonical_analysis_id,
        text_hash = EXCLUDED.text_hash,
        refreshed_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gold_sync_duplicate_map ON gemma_hate_analyses;
CREATE TRIGGER trg_gold_sync_duplicate_map
AFTER INSERT OR UPDATE OF status, text_hash, model_name, prompt_version
ON gemma_hate_analyses
FOR EACH ROW EXECUTE FUNCTION gold_sync_duplicate_map();

INSERT INTO gold_review_consensus (
    analysis_id, decision_status, final_label, final_hate_types,
    resolved_at, updated_at
)
SELECT
    r.analysis_id,
    'single',
    r.final_label,
    r.final_hate_types,
    r.reviewed_at,
    COALESCE(r.reviewed_at, NOW())
FROM gold_hate_reviews r
WHERE r.review_status IN ('confirmed', 'corrected')
ON CONFLICT (analysis_id) DO NOTHING;

INSERT INTO gold_review_audit (
    analysis_id, review_id, actor_reviewer_id, event_type,
    new_value, metadata, created_at
)
SELECT
    r.analysis_id,
    r.review_id,
    r.reviewer_id,
    'historical_import',
    jsonb_build_object(
        'reviewStatus', r.review_status,
        'finalLabel', r.final_label,
        'finalHateTypes', r.final_hate_types,
        'note', r.review_note
    ),
    jsonb_build_object(
        'gemmaLabel', a.pred_label,
        'gemmaHateTypes', a.hate_types,
        'gemmaProbability', a.hate_probability
    ),
    COALESCE(r.reviewed_at, r.assigned_at)
FROM gold_hate_reviews r
JOIN gemma_hate_analyses a ON a.analysis_id = r.analysis_id
WHERE NOT EXISTS (
    SELECT 1
    FROM gold_review_audit au
    WHERE au.review_id = r.review_id
      AND au.event_type = 'historical_import'
);

DROP VIEW IF EXISTS v_gold_hate_dataset;
CREATE VIEW v_gold_hate_dataset AS
WITH review_summary AS (
    SELECT
        r.analysis_id,
        MIN(r.reviewer_id) AS reviewer_id,
        MIN(rv.reviewer_code) AS reviewer_code,
        MIN(rv.display_name) AS reviewer_name,
        STRING_AGG(r.review_note, E'\n' ORDER BY r.reviewed_at)
            FILTER (WHERE r.review_note IS NOT NULL) AS review_note,
        BOOL_OR(r.review_status = 'corrected') AS had_correction,
        COUNT(*) FILTER (
            WHERE r.review_status IN ('confirmed', 'corrected')
        ) AS human_review_count
    FROM gold_hate_reviews r
    JOIN gold_reviewers rv ON rv.reviewer_id = r.reviewer_id
    GROUP BY r.analysis_id
), duplicate_counts AS (
    SELECT canonical_analysis_id, COUNT(*) AS duplicate_count
    FROM gold_duplicate_map
    GROUP BY canonical_analysis_id
)
SELECT
    a.analysis_id,
    a.text_hash,
    a.text_snapshot,
    a.platform,
    a.content_kind,
    a.external_id,
    a.pred_label AS gemma_label,
    a.hate_probability AS gemma_hate_probability,
    a.hate_types AS gemma_hate_types,
    c.final_label AS gold_label,
    c.final_hate_types AS gold_hate_types,
    CASE
        WHEN a.pred_label = 'hate' AND c.final_label = 'hate' THEN 'verdadeiro_positivo'
        WHEN a.pred_label = 'hate' AND c.final_label = 'nao_hate' THEN 'falso_positivo'
        WHEN a.pred_label = 'nao_hate' AND c.final_label = 'hate' THEN 'falso_negativo'
        WHEN a.pred_label = 'nao_hate' AND c.final_label = 'nao_hate' THEN 'verdadeiro_negativo'
    END AS model_outcome,
    CASE WHEN rs.had_correction THEN 'corrected' ELSE 'confirmed' END AS review_status,
    rs.review_note,
    rs.reviewer_id,
    rs.reviewer_code,
    rs.reviewer_name,
    c.resolved_at AS reviewed_at,
    a.model_name,
    a.prompt_version,
    c.decision_status,
    rs.human_review_count,
    GREATEST(COALESCE(dc.duplicate_count, 1) - 1, 0) AS reused_duplicate_count
FROM gold_review_consensus c
JOIN gemma_hate_analyses a ON a.analysis_id = c.analysis_id
LEFT JOIN review_summary rs ON rs.analysis_id = c.analysis_id
LEFT JOIN duplicate_counts dc ON dc.canonical_analysis_id = c.analysis_id
WHERE c.decision_status IN ('single', 'agreed', 'adjudicated');
