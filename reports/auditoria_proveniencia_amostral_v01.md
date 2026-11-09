# Auditoria de proveniência amostral do Dataset Radar Ódio v0.1

**Escopo:** camadas 1 e 2, exclusivamente.  
**Modo de execução:** banco consultado em transação `READ ONLY`; somente consultas `SELECT` e inspeção de arquivos/Git.  
**Retrato do banco:** 11/09/2026 19:32:26 UTC (16:32:26 BRT).  
**Universo de inferência de referência:** `gemma3:4b` / `gemma3_4b_structured_v2`, 212.476 análises com `status = 'success'`.

Os totais encontrados são 25 registros superiores aos números informados no pedido. Por isso, este relatório usa o retrato efetivamente observado: **25.115** decisões gold resolvidas, das quais **4.005** são `hate` e **21.110** são `nao_hate`.

## 1. Resumo executivo

| Pergunta | Resposta | Justificativa verificável |
|---|---|---|
| É possível recuperar `batch_id`? | **PARCIALMENTE** | 953/25.115 registros (3,79%) possuem vínculo direto com `gold_sampling_batch_items`, todos no lote 24. Nenhum lote adicional foi recuperado para os outros 24.162 registros. |
| É possível recuperar `sampling_stratum`? | **PARCIALMENTE** | Os mesmos 953 registros possuem `stratum` diretamente armazenado. Para os demais, os atributos atuais permitiriam apenas criar um pseudoestrato, sem comprovar que foi o estrato histórico. |
| É possível recuperar `N_h`? | **NÃO** | Não existe campo, snapshot do universo elegível ou log do quadro amostral por lote/estrato. Uma recomputação atual não prova o valor histórico. |
| É possível recuperar `n_h`? | **PARCIALMENTE** | Para o lote 24, `n_h` é contável diretamente nos itens preservados. Não há lote/estrato comprovado para os outros 24.162 registros. |
| É possível recuperar `inclusion_probability`? | **NÃO** | Nenhuma tabela, auditoria, configuração ou código persiste probabilidade de inclusão. A seleção observada não foi equiprovável. |
| É possível reconstruir pesos amostrais cientificamente defensáveis? | **NÃO** | Faltam `N_h` histórico e probabilidades de inclusão; além disso, houve ordenação determinística por cobertura, predição do Gemma, incerteza e identificador, com filtros opcionais não registrados. |

**Conclusão principal:** a proveniência científica diretamente utilizável restringe-se aos 953 registros do lote 24. Para os demais campos e registros, quando indicado abaixo, vale a conclusão: **NÃO RECUPERÁVEL COM AS EVIDÊNCIAS DISPONÍVEIS.**

### Classificação do conjunto completo

| Metadado | A — direto | B — indireto/determinístico | C — apenas aproximável | D — sem informação recuperável |
|---|---:|---:|---:|---:|
| `batch_id` | 953 | 0 | 0 | 24.162 |
| `sampling_stratum` | 953 | 0 | 24.162 | 0 |

Os 24.162 casos classificados como C para estrato **não** devem receber um valor no dataset científico: plataforma, rótulo e tipos previstos pelo Gemma ainda existem, mas não há prova de que um estrato histórico tenha sido atribuído a esses itens. No CSV auxiliar, portanto, permanecem `NULL` e `unknown`.

### Classificação exigida para os 24.162 registros originalmente ausentes

| Metadado | Categoria A | Categoria B | Categoria C | Categoria D |
|---|---:|---:|---:|---:|
| `batch_id` ausente | 0 | 0 | 0 | **24.162** |
| `sampling_stratum` ausente | 0 | 0 | **24.162** | 0 |

Assim, nenhum dos registros inicialmente sem metadado foi promovido às categorias científicas A ou B.

## 2. Evidências encontradas

### 2.1 Inventário estrutural relevante

Contagens abaixo são exatas no retrato da auditoria. As tabelas das camadas fora do escopo foram excluídas da inspeção analítica.

| Tabela/visão | Linhas | Chave e relação | Campos relevantes à proveniência |
|---|---:|---|---|
| `gemma_hate_analyses` | 212.516 | PK `analysis_id`; FK para `gemma_hate_runs`, `posts`, `comments` e auto-reuso | `analysis_id`, `run_id`, `platform`, `content_kind`, `post_id`, `comment_id`, `external_id`, `text_hash`, `model_name`, `prompt_version`, `pred_label`, `hate_probability`, `hate_types`, `analyzed_at` |
| `gemma_hate_analysis_categories` | 99.032 | FK `analysis_id` | categorias e probabilidades produzidas pelo modelo; não são metadados amostrais |
| `gemma_hate_runs` | 59 | PK `run_id` | modelo e versão do prompt |
| `gold_duplicate_map` | 212.488 | PK/FK `analysis_id`; FK `canonical_analysis_id` | identifica o texto canônico; os 25.115 gold auditados são canônicos |
| `gold_hate_reviews` | 25.467 | PK `review_id`; FKs `analysis_id`, `reviewer_id`, `batch_item_id` | estado, datas da atribuição/revisão, `batch_item_id`, rodada |
| `gold_review_consensus` | 25.115 | PK/FK `analysis_id` | decisão gold e datas; todas as decisões resolvidas atuais têm status `single` |
| `gold_review_audit` | 57.756 | PK `audit_id`; FKs `analysis_id`, `review_id` | eventos e JSONB; não possui lote/estrato nos registros sem lote |
| `gold_sampling_batches` | 1 | PK `batch_id` | nome, tamanho solicitado/selecionado, revisão dupla, estado e datas |
| `gold_sampling_batch_items` | 953 | PK `batch_item_id`; FKs `batch_id` e `analysis_id`; `analysis_id` único | `batch_id`, `analysis_id`, `stratum`, `target_reviews`, `created_at` |
| `posts` | 197.511 | PK `id` | `external_id`, `platform`, `content_type`, `published_at` |
| `comments` | 208.336 | PK `id`; vínculo lógico/físico com post | `external_id`, `post_pk`, `post_external_id`, `parent_external_id`, `published_at` |
| extensões de plataforma | tabelas auxiliares | chaves `post_id`/`comment_id` para `posts`/`comments` | `conversation_id` existe apenas na extensão Twitter; outros campos são específicos da fonte |
| `v_gemma_hate_results` | visão | `analysis_id` | expõe `source_post_id`, `source_comment_id`, `root_post_id` e pai, mas não lote/estrato |
| `v_gold_hate_dataset` | visão | `analysis_id` | agrega gold e Gemma; inclui identidade de avaliador e não deve ser usada diretamente como exportação pública |

As chaves estrangeiras confirmam o caminho `gold_review_consensus.analysis_id` → `gemma_hate_analyses.analysis_id` e, quando existe, `gold_hate_reviews.batch_item_id` → `gold_sampling_batch_items.batch_item_id` → `gold_sampling_batches.batch_id`. Não foi encontrada tabela legada, coluna alternativa de lote, probabilidade, peso ou seed.

Tabelas auxiliares também verificadas:

| Tabela | Linhas | Chave/relação potencial | Resultado para a proveniência |
|---|---:|---|---|
| `gemma_hate_categories` | 11 | PK `category_code`; usada pelas análises | taxonomia corrente sem versão histórica |
| `gold_reviewers` | 16 | PK `reviewer_id` | cadastro; sem lote/estrato por item |
| `gold_reviewer_sessions` | 104 | FK `reviewer_id` | autenticação; sem `analysis_id`/`batch_id` |
| `gold_login_attempts` | 16 | registro de login | sem relação amostral |
| `facebook_posts` | 64 | `post_id` ligado a `posts.id` | extensão de fonte/contexto |
| `facebook_comments` | 34.527 | `comment_id` ligado a `comments.id` | extensão de fonte/contexto |
| `reddit_posts` | 3.300 | `post_id` ligado a `posts.id` | extensão de fonte/contexto |
| `reddit_comments` | 30.923 | `comment_id` ligado a `comments.id` | extensão de fonte/contexto |
| `telegram_messages` | 99.813 | `post_id` ligado a `posts.id` | extensão de fonte/contexto |
| `tiktok_videos` | 3 | `post_id` ligado a `posts.id` | extensão de fonte/contexto |
| `tiktok_comments` | 2.989 | `comment_id` ligado a `comments.id` | extensão de fonte/contexto |
| `twitter_tweets` | 1.051 | `post_id` ligado a `posts.id` | contém `conversation_id`; não contém batch/estrato |
| `whatsapp_messages` | 93.235 | `post_id` ligado a `posts.id` | extensão de fonte/contexto |
| `youtube_videos` | 45 | `post_id` ligado a `posts.id` | extensão de fonte/contexto |
| `youtube_comments` | 122.598 | `comment_id` ligado a `comments.id` | extensão de fonte/contexto |

### 2.2 Busca dos 24.162 `analysis_id` sem lote

| Estrutura | IDs ausentes encontrados | Observação |
|---|---:|---|
| `gemma_hate_analyses` | 24.162 | contém atributos de conteúdo/modelo, não proveniência amostral |
| `gemma_hate_analysis_categories` | 19.387 | relação um-para-muitos; categorias do Gemma |
| `gold_duplicate_map` | 24.162 | todos mapeados e canônicos |
| `gold_hate_reviews` | 24.162 | 24.434 linhas de revisão devido a reatribuições/revisões |
| `gold_review_audit` | 24.162 | 55.697 eventos; nenhum contém `batchItemId` para esses IDs |
| `gold_review_consensus` | 24.162 | uma decisão gold por item |
| `gold_sampling_batch_items` | **0** | nenhuma correspondência |
| `v_gemma_hate_results` | 24.162 | visão de análise, sem lote |
| `v_gold_hate_dataset` | 24.162 | visão gold, sem lote |

No JSONB de auditoria, as únicas chaves de metadados globais encontradas foram `gemmaLabel`, `gemmaProbability`, `gemmaHateTypes` e, em revisões, `source`. A chave `batchItemId` aparece em 1.019 eventos, todos vinculados aos 953 itens atuais; existem **zero** referências órfãs. Não há `stratum`, `seed`, `N_h`, probabilidade, peso, método, filtros de seleção ou tamanho do quadro elegível.

### 2.3 Estrutura atual de sampling

Existe somente:

- `batch_id = 24`, nome `Gabarito Camada 4 · Twitter · 05df9e3d1433`;
- solicitado = selecionado = 953;
- `double_review_percent = 0`;
- criado em 19/08/2026 11:20:58 UTC;
- 953 itens distintos, todos com decisão gold resolvida;
- estado ainda `active`, embora todos os itens estejam resolvidos.

As sequências estão em 24 (`batch_id`) e 1.950 (`batch_item_id`), enquanto os itens preservados ocupam 998–1.950. Isso, isoladamente, poderia sugerir exclusões. A evidência adicional resolve a dúvida:

1. o dump `backups/radar_odio.dump`, gerado em 14/08/2026, contém as tabelas de lote, porém ambas sem linha alguma;
2. nesse dump, as sequências já estavam em 18 e 36;
3. `scripts/smoke-test.mjs:705-753` cria dados temporários e apaga explicitamente os lotes de teste ao final;
4. no banco atual, os 1.019 eventos com `batchItemId` apontam para itens ainda existentes, sem referência órfã;
5. nenhum dos 24.162 gold sem lote possui `batchItemId` no histórico.

Logo, as lacunas de sequência são compatíveis com testes removidos e **não** recuperam lote para os registros gold ausentes.

### 2.4 Código-fonte, migrations, configurações e Git

| Evidência | Finalidade e regra observada | Seed/probabilidade/`N_h` persistidos? |
|---|---|---|
| `app/api/admin/workflow/route.ts:352-529`, ação de criação de lote | restringe à inferência atual e textos canônicos, exclui itens já amostrados/revisados, expande `pred_label`/`hate_types` em estratos e ordena por cobertura de plataforma, distância da probabilidade a 0,5, posição no estrato e `analysis_id`; depois grava apenas lote, estrato e alvo de revisões | não |
| `app/api/reviews/next/route.ts:370-477` no commit `f81bc704...` | fora de lote, escolhe um item por cobertura de plataforma; depois prioriza `pred_label = 'hate'`, proximidade de 0,5 e `analysis_id`; aceita filtros opcionais de plataforma, tipo de conteúdo e rótulo Gemma | não |
| `app/api/reviews/next/route.ts:426-611` atual | mantém seleção dirigida; adiciona tiers de plataforma e um pool de candidatos, sem sorteio | não |
| `lib/review-priority.ts:1-30` atual | tiers: Twitter/Reddit/Facebook/TikTok; depois YouTube; por fim WhatsApp/Telegram | não |
| `db/migration.sql:175-210` | cria lotes/itens e adiciona `batch_item_id`/rodada à revisão | não |
| `lib/db.ts:40-45` | configuração atual: `gemma3:4b` e `gemma3_4b_structured_v2`, salvo sobrescrita por ambiente | não |
| `scripts/smoke-test.mjs:705-753` | remove revisões e lotes temporários criados pelos testes | não |
| Git | há um único commit, `f81bc70405a9edcb87aa594b820e7f65fb7f0471`, de 03/08/2026; ele já contém as tabelas de lote e a fila dirigida | não há versão anterior no repositório para inspecionar |

O código não contém `ORDER BY random()`, `random.sample`, seed amostral ou sorteio na seleção relevante. A criação do lote também não registra o conjunto elegível, a posição de todos os candidatos nem a versão executável/hash do código. As alterações locais atuais mudam prioridade de plataforma e meta de cobertura em relação ao único commit; como não há commit ou log de implantação associado ao lote 24, o detalhe exato da versão executada não é documentalmente provado.

### 2.5 Mecanismo de inclusão e validade de `π_i = n_h/N_h`

A inclusão foi **dirigida/determinística**, não aleatória simples:

- prioridade por cobertura de plataforma;
- prioridade para rótulo `hate` do Gemma na fila contínua;
- prioridade para casos próximos de 0,5;
- desempate por `analysis_id`;
- possibilidade de filtros solicitados pela interface, não registrada no evento de atribuição;
- estratos multirrótulo expandidos e posterior deduplicação na criação de lote.

Consequentemente, unidades do mesmo estrato não tiveram probabilidade equiprovável demonstrada. Mesmo no lote 24, `n_h/N_h` não pode ser tratado como `π_i`. A fórmula seria válida apenas sob um sorteio equiprobabilístico comprovado dentro de cada estrato, o que não ocorreu ou não foi documentado.

## 3. Cobertura

| Medida | Quantidade |
|---|---:|
| total do dataset no pedido | 25.090 |
| total do dataset no retrato auditado | **25.115** |
| `batch_id` conhecido originalmente/diretamente | 953 |
| `batch_id` adicional recuperado | **0** |
| `batch_id` ainda desconhecido | **24.162** |
| `sampling_stratum` conhecido originalmente/diretamente | 953 |
| `sampling_stratum` adicional recuperado | **0** |
| `sampling_stratum` ainda sem valor cientificamente recuperável | **24.162** |

Os 25.115 registros representam 11,82% das 212.476 análises bem-sucedidas da inferência de referência. Essa porcentagem é cobertura de anotação observada, não taxa probabilística de amostragem.

## 4. Reconstrução do desenho amostral

1. **22/07/2026 a 19/08/2026 — inferência:** foram produzidas as 212.476 análises bem-sucedidas da configuração de referência.
2. **a partir de 28/07/2026 — formação do gold:** os primeiros registros foram atribuídos/revisados pela fila contínua. Há 6.686 gold sem lote associados a `historical_import` (6.681 também têm evento posterior de atribuição e 5 somente importação histórica). O evento preserva decisão e predição Gemma, não o processo de seleção original.
3. **03/08/2026 — único commit:** a estrutura de lote e a fila determinística já aparecem no primeiro e único commit disponível. Não existe histórico anterior que documente outra regra.
4. **14/08/2026 — backup:** o dump confirma que as estruturas de lote existiam, mas estavam vazias. Portanto, os gold existentes até então não estavam associados a lotes persistidos.
5. **19/08/2026 — lote 24:** foram gravados simultaneamente 953 itens Twitter com estrato. Esses itens foram concluídos principalmente em 19–20/08, com os últimos em 22/08.
6. **depois do lote 24 até 11/09/2026 — continuidade:** a fila fora de lote continuou alimentando avaliações. No retrato final, 17.476 gold sem lote não têm importação histórica e possuem evento `assigned`; 6.681 têm importação e atribuição; 5 têm apenas importação. Nenhum dos 24.162 contém vínculo de lote.

Não há evidência de que os 24.162 registros tenham pertencido a lotes persistidos em outro lugar. Eles devem ser tratados como uma amostra de conveniência/seleção dirigida produzida continuamente pela fila, com parte inicial importada de histórico cuja mecânica anterior não foi preservada.

## 5. Estratos

`N_h` e seed ficam `NULL` porque não foram armazenados. `n_h` é a contagem direta de itens preservados no lote 24.

| batch | stratum | `N_h` | `n_h` | método de seleção | seed | evidência |
|---:|---|---:|---:|---|---|---|
| 24 | `twitter · ageism` | NULL | 4 | ranking determinístico dirigido | NULL | `gold_sampling_batch_items` + código de criação |
| 24 | `twitter · aporophobia` | NULL | 4 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · body_shame` | NULL | 60 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · capacitism` | NULL | 6 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · lgbtphobia` | NULL | 60 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · misogyny` | NULL | 55 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · nao_hate` | NULL | 587 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · other` | NULL | 16 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · political` | NULL | 57 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · racism` | NULL | 57 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · religious_intolerance` | NULL | 28 | ranking determinístico dirigido | NULL | idem |
| 24 | `twitter · xenophobia` | NULL | 19 | ranking determinístico dirigido | NULL | idem |

Os valores `misogyny` e `other` são reproduzidos literalmente como proveniência histórica do banco. Uma taxonomia analítica posterior pode mapear `misogyny` para `sexism` e excluir/recodificar `other`, mas não deve sobrescrever silenciosamente o valor amostral original.

Embora `n_h` seja conhecido, o universo histórico por estrato não foi congelado. Recontar hoje os rótulos/tipos do Gemma produziria apenas um denominador atual; não provaria elegibilidade no instante da seleção, efeitos de itens já revisados, filtros de interface, estado de `skipped`, sobreposição multirrótulo nem versão exata da ordenação executada. Assim, `N_h` é **NÃO RECUPERÁVEL COM AS EVIDÊNCIAS DISPONÍVEIS.**

## 6. Campos adicionais recuperáveis

| Campo do contrato | Situação | Evidência e cobertura |
|---|---|---|
| `content_created_at` | **PARCIALMENTE** | equivalente semântico em `comments.published_at`/`posts.published_at`: 24.162/25.115 disponíveis; 0/953 no lote 24 |
| `context_group_id` | **PARCIALMENTE** | `post_external_id`/post de origem permite agrupar 24.162 registros; os 953 do lote não possuem vínculo de post preservado |
| `post_id` / `source_post_id` | **PARCIALMENTE** | 22.442 registros sem lote possuem identificador interno de post; identificador externo de contexto está disponível nos 24.162 sem lote |
| `parent_id` / `reply_to` | **PARCIALMENTE** | `comments.parent_external_id` está preenchido em 2.673 registros; permite encadeamento parcial |
| `conversation_id` / `thread_id` | **PARCIALMENTE** | `twitter_tweets.conversation_id` disponível em 1.707 de 2.901 gold Twitter; ausente nos 953 do lote 24 |
| `taxonomy_version` | **NÃO** | não existe coluna nem chave de auditoria; a tabela de categorias descreve o estado atual, sem versionamento |
| `guidelines_version` | **NÃO** | não existe coluna, tabela ou chave de auditoria correspondente |
| `context_dependency` | **NÃO** | não há avaliação persistida de dependência de contexto |
| `prompt_version` | **SIM, mas não equivalente** | identifica o prompt do Gemma; não substitui versão da taxonomia ou das diretrizes humanas |

Os identificadores existentes possibilitam agrupamento parcial de postagem original e comentários, respostas e conversas. Contudo, os 953 itens do lote 24 são comentários Twitter com `comment_id` válido, mas `published_at`, `post_pk`, `post_external_id`, `parent_external_id` e `conversation_id` ausentes na fonte normalizada; portanto, não se pode completar seu contexto por relacionamento atual.

## 7. Limitações

- O banco é operacional, não um banco temporal; estados antigos do quadro elegível e dos itens pulados não foram congelados.
- O único commit disponível já contém a infraestrutura atual. Não há histórico Git anterior para explicar a seleção inicial.
- Alterações locais não commitadas mudam prioridade de plataforma/meta de cobertura; não existe registro de implantação que associe uma versão exata do código ao lote 24.
- Filtros opcionais de plataforma, tipo de conteúdo e rótulo Gemma não são gravados no evento de atribuição.
- A auditoria guarda resultados e predições, mas não tamanho do universo, posição de candidato, probabilidade, peso, seed ou razão de inclusão.
- Os IDs de sequência consumidos por testes não representam, por si, lotes científicos. O dump e a ausência de referências órfãs impedem atribuí-los aos gold sem lote.
- Todos os 25.115 consensos resolvidos estão como `single`; não há evidência interna de dupla anotação neste conjunto operacional.
- O lote 24 está marcado `active` mesmo com 953/953 resolvidos; o status não pode ser usado como indicador confiável de conclusão.
- `N_h`, `π_i` e pesos para a amostra completa são **NÃO RECUPERÁVEIS COM AS EVIDÊNCIAS DISPONÍVEIS.**

## 8. Recomendação metodológica

### CENÁRIO C

**O desenho não permite inferência ponderada defensável; usar métricas não ponderadas como principais e registrar a limitação.**

Recomenda-se:

1. tratar a v0.1 como benchmark gold de seleção dirigida, não como amostra probabilística representativa da população;
2. reportar métricas brutas e análises por plataforma, tipo de conteúdo e rótulo/tipo, sem afirmar correção populacional por `N_h/n_h`;
3. manter os 953 itens do lote 24 identificados, mas não calcular pesos para eles: o método também foi dirigido e `N_h` histórico não é comprovável;
4. não preencher retrospectivamente lote/estrato dos 24.162 casos; qualquer pseudoestrato derivado deve receber outro nome e ser descrito como variável analítica pós-coleta;
5. para versões futuras, congelar antes da seleção: `sampling_frame_version`, hash/lista do universo elegível, definição de estrato, `N_h`, método, seed, ordem/sorteio, probabilidade individual ou regra exata, filtros, substituições, timestamp e hash/commit do código;
6. se a meta futura exigir pesos de desenho, realizar sorteio equiprobabilístico dentro de estratos mutuamente definidos e persistir `π_i`; caso a seleção continue por incerteza/prioridade, tratá-la explicitamente como active learning/amostragem dirigida, não como desenho probabilístico.

O arquivo `reports/recovered_sampling_metadata.csv` contém os 25.115 `analysis_id`: 953 com lote/estrato comprovados e 24.162 com `NULL`. O campo `sampling_method` é preenchido apenas para o lote 24 como reconstrução determinística do código; `N_h`, probabilidade e seed permanecem `NULL`.

### Consultas SQL principais (somente leitura)

```sql
-- Cobertura gold e lote
SELECT COUNT(*) AS gold_total,
       COUNT(*) FILTER (WHERE bi.batch_id IS NOT NULL) AS with_batch,
       COUNT(*) FILTER (WHERE bi.batch_id IS NULL) AS without_batch
FROM gold_review_consensus c
LEFT JOIN gold_sampling_batch_items bi USING (analysis_id)
WHERE c.decision_status IN ('single', 'agreed', 'adjudicated');
```

```sql
-- Lotes e número efetivo de itens
SELECT b.*, COUNT(i.*) AS actual_items,
       COUNT(DISTINCT i.analysis_id) AS distinct_items
FROM gold_sampling_batches b
LEFT JOIN gold_sampling_batch_items i USING (batch_id)
GROUP BY b.batch_id;
```

```sql
-- Procura de batchItemId na auditoria dos gold sem lote
SELECT COUNT(*) FILTER (
         WHERE jsonb_typeof(a.new_value) = 'object'
           AND a.new_value ? 'batchItemId'
       ) AS references_found
FROM gold_review_audit a
JOIN gold_review_consensus c USING (analysis_id)
LEFT JOIN gold_sampling_batch_items bi USING (analysis_id)
WHERE c.decision_status IN ('single', 'agreed', 'adjudicated')
  AND bi.analysis_id IS NULL;
-- Resultado: 0
```

```sql
-- n_h diretamente observável no lote preservado
SELECT batch_id, stratum, COUNT(*) AS n_h
FROM gold_sampling_batch_items
GROUP BY batch_id, stratum
ORDER BY batch_id, stratum;
```

### Resumo de terminal solicitado

```text
TOTAL GOLD: 25115
BATCH DIRETAMENTE CONHECIDO: 953
BATCH RECUPERADO: 0
BATCH NÃO RECUPERÁVEL: 24162

STRATUM DIRETAMENTE CONHECIDO: 953
STRATUM RECUPERADO: 0
STRATUM NÃO RECUPERÁVEL: 24162

PESOS AMOSTRAIS: NÃO VIÁVEIS

ARQUIVO DO RELATÓRIO:
reports/auditoria_proveniencia_amostral_v01.md
```
