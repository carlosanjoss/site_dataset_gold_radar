# Radar Ódio — Sistema de Revisão Humana

Aplicação independente para especialistas confirmarem ou corrigirem as
classificações de discurso de ódio produzidas pelo Gemma. O sistema não altera
o dashboard existente nem sobrescreve as previsões originais.

## Como iniciar localmente

Dê dois cliques em:

```text
ABRIR_SISTEMA.cmd
```

O iniciador prepara o banco, aguarda o servidor ficar disponível e abre o
navegador automaticamente. Mantenha a janela do terminal aberta enquanto os
especialistas estiverem avaliando.

No PowerShell:

```powershell
cd "C:\Users\carlo\OneDrive\Documents\ESTUDOS\MESTRADO\Trabalho Radar Ódio\sistema_revisao_hate"
.\iniciar_sistema.ps1
```

Abra o endereço exibido no terminal, normalmente:

```text
http://localhost:3000
```

O projeto procura `POSTGRES_URI` em `.env.local`, `.env` e, como alternativa,
em `../social_data_pipeline/.env`. Portanto, nesta máquina ele usa
automaticamente o banco `radar_odio` já configurado.

## Fluxo do avaliador

1. Entrar com o usuário e a senha temporária fornecidos.
2. Criar uma senha definitiva no primeiro acesso.
3. Confirmar a decisão do Gemma, corrigir o rótulo/tipos ou pular o texto.
4. Ao salvar, o sistema registra automaticamente avaliador, decisão e horário.

Os textos normais ficam reservados para um avaliador. Os itens selecionados
para revisão dupla são enviados a dois especialistas diferentes: decisões
iguais formam consenso automaticamente e divergências seguem para o
administrador.

A tela de revisão também possui um guia de rotulagem com definições, exemplos
positivos e casos de limite para todas as categorias de hate.

## Administrador

O painel administrativo é dividido em:

- **Métricas**: cobertura do dataset gold, matriz de confusão, falsos
  positivos/negativos e exemplos reais para análise qualitativa.
- **Dados do Gemma**: acesso paginado a todas as inferências com busca e filtros.
- **Fluxo do gold**: criação de lotes balanceados, seleção de quem participa da
  revisão dupla, resolução de conflitos, duplicatas e histórico de auditoria.
- **Usuários**: criação de avaliadores e administradores.

Os lotes balanceados distribuem os textos por rede social, rótulo do modelo e
tipo de hate. Duplicatas exatas são agrupadas por hash: somente o texto
canônico entra na fila e a decisão humana é reaproveitada nas cópias idênticas.

Todos os usuários precisam trocar a senha temporária no primeiro acesso. A senha
definitiva precisa ter pelo menos 10 caracteres, incluindo maiúscula, minúscula,
número e caractere especial.

## Acesso público pelo Cloudflare

Dê dois cliques em:

```text
ABRIR_COM_CLOUDFLARE.cmd
```

O iniciador prepara o banco, gera uma versão de produção do sistema na porta
3001 e cria um endereço HTTPS público terminado em `trycloudflare.com`. Copie o
endereço mostrado e envie aos avaliadores. Mantenha a janela aberta enquanto o
acesso externo estiver ativo.

Esse endereço é temporário e muda quando o túnel é reiniciado. Um endereço fixo
exige uma conta Cloudflare, um domínio associado e um túnel nomeado.

Para encerrar o acesso público e o servidor de produção, dê dois cliques em
`DESATIVAR_SITE.cmd`. A execução local em `http://localhost:3000` é preservada.

## Estruturas criadas no PostgreSQL

- `gold_reviewers`: cadastro dos especialistas.
- `gold_reviewer_sessions`: sessões autenticadas.
- `gold_login_attempts`: controle de tentativas de entrada.
- `gold_hate_reviews`: decisões humanas.
- `gold_sampling_batches` e `gold_sampling_batch_items`: amostras balanceadas.
- `gold_review_consensus`: decisão gold simples, consensual ou adjudicada.
- `gold_review_audit`: histórico de atribuições, alterações e decisões.
- `gold_duplicate_map`: grupos de duplicatas exatas e texto canônico.
- `v_gold_hate_dataset`: dataset final com previsão do Gemma, rótulo gold e
  identificação automática de falso positivo/falso negativo. A view contém uma
  linha por texto canônico e informa quantas duplicatas reutilizam a decisão.

Somente decisões resolvidas (`single`, `agreed` ou `adjudicated`) entram na
view gold. Conflitos não entram no dataset final antes da decisão do admin.

## Acesso pela rede local

Outros computadores podem abrir o endereço `http://IP_DESTA_MAQUINA:3000`.
Somente esta máquina precisa acessar o PostgreSQL; os avaliadores acessam a
aplicação pelo navegador.

## Comandos de validação

```powershell
npm run build
npm run test:smoke
```

O teste cria contas temporárias, valida login, troca de senha, revisão e gestão
administrativa e apaga todos os dados temporários ao terminar.
