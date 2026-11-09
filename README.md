# Radar Ódio — Sistema de Revisão Humana

Aplicação independente para especialistas confirmarem ou corrigirem as
classificações de discurso de ódio produzidas pelo Gemma. O sistema não altera
o dashboard existente nem sobrescreve as previsões originais.

## Como iniciar localmente com Docker

Dê dois cliques em `ABRIR_DOCKER.cmd`. O script inicia o PostgreSQL, MongoDB e
Redis oficiais de `social_data_pipeline`, prepara a conexão sem imprimir
credenciais, constrói o site e aguarda a resposta em:

```text
http://localhost:3000
```

Para desligar, dê dois cliques em `DESLIGAR_DOCKER.cmd`. Os volumes e os dados
restaurados são preservados. Os contêineres usam `restart: unless-stopped` e o
Docker Desktop está configurado para iniciar com a sessão do Windows.

No PowerShell, os comandos equivalentes são:

```powershell
.\iniciar_docker.ps1
.\desligar_docker.ps1
```

O site, o dashboard, o Gemma e o NLI usam o mesmo PostgreSQL oficial definido
em `../social_data_pipeline/.env`; não há um segundo banco do site.

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

Dê dois cliques em `ABRIR_COM_CLOUDFLARE_DOCKER.cmd`. Se a variável
`CLOUDFLARE_TUNNEL_TOKEN` existir, o script usa o túnel permanente; caso
contrário, cria um Quick Tunnel temporário. O endereço só é informado depois
que o conector registra uma conexão com a borda Cloudflare.

O Cloudflare Tunnel exige saída TCP ou UDP pela porta 7844. Se essa porta for
bloqueada pela rede, libere-a e execute o iniciador novamente. O site local
continua disponível mesmo sem o túnel.

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

## Execução em Docker na máquina virtual

O ambiente Docker contém a aplicação Next.js, PostgreSQL persistente e duas
opções de HTTPS: domínio próprio com Caddy ou túnel nomeado do Cloudflare.

Antes de copiar o projeto, gere o backup do banco atual dando dois cliques em:

```text
CRIAR_BACKUP_DOCKER.cmd
```

O comando cria `backups/radar_odio.dump`. O banco atual tem aproximadamente
1,2 GB antes da compactação; o dump contém dados do projeto e deve ser
transferido por um canal privado.

Na máquina virtual, copie `.env.docker.example` para `.env.docker`, troque a
senha do PostgreSQL e configure uma das opções de acesso HTTPS.

Com domínio apontado para o IP público da VM:

```bash
docker compose --env-file .env.docker --profile https up -d --build
```

Com um túnel nomeado configurado no painel Cloudflare para encaminhar ao
serviço `http://app:3000`:

```bash
docker compose --env-file .env.docker --profile cloudflare up -d --build
```

Para acompanhar a inicialização:

```bash
docker compose --env-file .env.docker logs -f app database
```

Para atualizar o site após copiar uma nova versão do projeto:

```bash
docker compose --env-file .env.docker up -d --build app
```

Para parar sem apagar o banco:

```bash
docker compose --env-file .env.docker down
```

Não use `docker compose down -v` em produção: a opção `-v` remove o volume do
PostgreSQL. O backup é restaurado automaticamente apenas quando o volume é
criado pela primeira vez.

## Comandos de validação

```powershell
npm run build
npm run test:smoke
```

O teste cria contas temporárias, valida login, troca de senha, revisão e gestão
administrativa e apaga todos os dados temporários ao terminar.
