# lupa - SPEC

## Objetivo

Transformar 3 paginas do portal de transparencia do TCE-TO (Tribunal de Contas do Estado do Tocantins) em uma API REST que alimentara um painel de BI.

Fontes:
- https://transparencia.tceto.tc.br/licitacao (~670 registros)
- https://transparencia.tceto.tc.br/contrato/Index (~1.191 registros)
- https://transparencia.tceto.tc.br/obraseservicosdeengenharia (~14 registros)

## Iteracao atual

**Iteracao 1 - Licitacoes + fundacao do projeto.**

Contratos e obras serao iteracoes posteriores que reaproveitam a fundacao (config, http client, db client, parser helpers, padroes de upsert/auditoria).

## Stack

- Node.js 20+ / TypeScript 5+
- pnpm
- PostgreSQL 16 (via Docker Compose local)
- Drizzle ORM
- undici (HTTP) + cheerio (parser HTML)
- Fastify (API REST)
- vitest (testes)

## Modelo de dados (resumo)

Tabela principal `licitacoes` + 4 tabelas filhas (documentos, empresas, pregoeiros, contratos_atas) ligadas por `licitacao_id` com cascade. Tabela `scraping_runs` para auditoria.

Convencoes:
- valores monetarios em `bigint` (centavos)
- datas em `date`/`timestamp` nativos
- `external_id` text UNIQUE para idempotencia
- `content_hash` SHA-256 para detectar mudancas

## API

REST sob `/api/`, JSON. Paginacao por `?page=&pageSize=`.

Rotas principais:
- `/health`
- `/api/meta/last-scrape`
- `/api/licitacoes` (lista + filtros)
- `/api/licitacoes/:id` (detalhe completo)
- `/api/licitacoes/:id/{documentos,empresas,pregoeiros,contratos-atas}`
- `/api/licitacoes/stats/{by-modalidade,by-situacao,by-month}`

## Paginacao do portal (resolvido)

A paginacao **NAO** e GET com `?page=N`. E POST para `/licitacao` com:
- `dadosfilter`: PHP-serialize + base64 do array `{inicio, fim}` (vem da pagina 1)
- `total`: total de registros (ex: `670`)
- `pagina`: numero da pagina alvo
- `ordem`: `pesq`

O pipeline ja faz isso: na pagina 1 ele extrai os campos do formulario (vendo o tag `<form>` que contem o input hidden `dadosfilter`) e nas paginas seguintes faz POST com `pagina=N`, reaproveitando o `dadosfilter` original.

Referencia: `src/scraper/parsers/licitacao-list.ts` -> `parsePaginationForm` e `src/scraper/pipelines/licitacao-pipeline.ts` -> `fetchListByPage`.

> Validado em ambiente real com `pnpm scrape:licitacao --limit 25 --skip-details`: 2 paginas, 25 registros, navegacao `pagina=1 -> pagina=2` funciona e traz registros mais antigos (de 2024-2025) na pagina 2.

## Performance da carga

A fase de DB usa `INSERT ... ON CONFLICT (external_id) DO UPDATE` em chunks (CHUNK_SIZE=500), uma unica `SELECT` para descobrir o que ja existe, particionamento em memoria (insert/update/unchanged), `UPDATE` em massa para os unchanged e bulk `DELETE` + bulk `INSERT` chunked para as 4 tabelas filhas. Tudo dentro de uma transacao unica.

Os fetches HTTP de detalhe sao paralelizados via worker pool (`pMap`) com `SCRAPER_CONCURRENCY=4` por padrao. Sem `delay` interno - a concorrencia limitada controla a taxa.

## TODOs conhecidos
- Busca full-text sem acento no Postgres (carrega extensao `unaccent` ou ajusta dicionario). Hoje so casa com acento ("manutenção" sim, "manutencao" nao).
- Scraper de contratos (proxima iteracao).
- Scraper de obras (proxima iteracao).
- Scheduler/cron quando definir hosting.
- Download fisico dos PDFs de editais.

## Como rodar (dev)

> Nota: usamos a porta `5433` no host para nao colidir com outros postgres locais. Ajuste em `.env` se precisar.

```bash
docker compose up -d              # postgres em localhost:5433
cp .env.example .env
pnpm install
pnpm db:push                      # aplica schema
pnpm test                         # roda testes de parser
pnpm scrape:licitacao --limit 3   # carga parcial para validar
pnpm api                          # API em http://127.0.0.1:3000
```
