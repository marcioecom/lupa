# lupa - SPEC

## Objetivo

Transformar 3 paginas do portal de transparencia do TCE-TO (Tribunal de Contas do Estado do Tocantins) em uma API REST que alimentara um painel de BI.

Fontes:
- https://transparencia.tceto.tc.br/licitacao (~670 registros)
- https://transparencia.tceto.tc.br/contrato/Index (~1.191 registros)
- https://transparencia.tceto.tc.br/obraseservicosdeengenharia (~14 registros)

## Status do projeto

**Os 3 modulos do escopo original estao cobertos end-to-end.**

| Modulo | Registros | Iteracao | Tabelas | Endpoints |
|---|---|---|---|---|
| licitacoes | 670 | 1 | 1 + 4 filhas | list/detail/4 children/3 stats |
| contratos | 1.191 | 3 | 1 + 5 filhas | list/detail/5 children/4 stats |
| obras | 14 | 4 | 1 (sem filhas) | list/detail/3 stats |

API tem documentacao automatica via Scalar em `/docs` (gerada de `@fastify/swagger`).

## Stack

- Node.js 20+ / TypeScript 5+
- pnpm
- PostgreSQL 16 (via Docker Compose local)
- Drizzle ORM
- undici (HTTP) + cheerio (parser HTML)
- Fastify (API REST)
- vitest (testes)

## Modelo de dados (resumo)

**Licitacoes** (iteracao 1): tabela principal `licitacoes` + 4 filhas (documentos, empresas, pregoeiros, contratos_atas).

**Contratos** (iteracao 3): tabela principal `contratos` + 5 filhas (documentos, aditivos, apostilamentos, pagamentos, responsaveis). Coluna `contratos.licitacao_external_id` faz cross-reference (sem FK rigida) para `licitacoes.external_id`, permitindo join no BI quando o contrato originou de uma licitacao.

**Obras** (iteracao 4): tabela unica `obras` (as 7 abas do detalhe estao vazias no dataset atual; modelaremos quando aparecerem dados). Coluna `obras.contrato_external_id` faz cross-reference para `contratos.external_id` (1:1 com os contratos no dataset atual). Campo `medicoes_percentual numeric(5,2)` para tracking fisico da obra (BI-friendly).

Tabela `scraping_runs` (compartilhada) para auditoria com coluna `module = 'licitacao' | 'contrato' | 'obra'`.

Convencoes:
- valores monetarios em `bigint` (centavos)
- datas em `date`/`timestamp` nativos
- `external_id` text UNIQUE para idempotencia
- `content_hash` SHA-256 para detectar mudancas

## API

REST sob `/api/`, JSON. Paginacao por `?page=&pageSize=`.

Rotas principais:
- `/health`
- `/api/meta/last-scrape?module=licitacao|contrato`
- `/api/licitacoes` (lista + filtros: ano, modalidade, situacao, valorMin/Max, dataDe/Ate, q full-text)
- `/api/licitacoes/:id` (detalhe completo)
- `/api/licitacoes/:id/{documentos,empresas,pregoeiros,contratos-atas}`
- `/api/licitacoes/stats/{by-modalidade,by-situacao,by-month}`
- `/api/contratos` (lista + filtros: ano, modalidade, situacao, unidadeGestora, cnpj, licitacaoExternalId, vigenciaDe/Ate, valorMin/Max, q full-text)
- `/api/contratos/:id` (detalhe completo)
- `/api/contratos/:id/{documentos,aditivos,apostilamentos,pagamentos,responsaveis}`
- `/api/contratos/stats/{by-modalidade,by-situacao,by-month,by-empresa}`
- `/api/obras` (lista + filtros: ano, situacao, empresa, contratoExternalId, valorMin/Max, q full-text)
- `/api/obras/:id` (detalhe)
- `/api/obras/stats/{by-situacao,by-ano,by-empresa}`
- `/docs` (UI Scalar com OpenAPI 3.1 auto-gerado)

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

**Numeros medidos** (2026-05-09 a 2026-05-10, banco local em Docker):
- **Licitacoes** (670 registros): carga limpa **2:33min**, re-run idempotente **2:33min** (~4.7x mais rapido que a implementacao serial anterior).
- **Contratos** (1.191 registros): carga limpa **4:19min**, re-run idempotente **4:16min**. Detalhes da carga: 3.544 documentos, 612 aditivos, 208 apostilamentos, 4.365 pagamentos, 1.903 responsaveis.
- **Obras** (14 registros): carga limpa **~32s** (dominado pela latencia do portal de obras, hoje em ~30s para 1 request). Pipeline mais simples - sem fetch de detalhe. 100% das obras linkam para um contrato ja na DB.

Re-runs de licitacao/contrato continuam baixando todos os detalhes pelo HTTP - o gargalo e a rede, nao o DB. Mitigacao futura: list-hash short-circuit (TODO).

## TODOs conhecidos
- **Re-execucao mais rapida**: hoje a 2a rodada continua baixando todos os detalhes mesmo quando nada mudou. Otimizacao: armazenar um `list_hash` separado (so dos campos da listagem), comparar antes do fetch e pular detalhe quando casa. Reduziria re-execucao para ~10-15s.
- Busca full-text sem acento no Postgres (carrega extensao `unaccent` ou ajusta dicionario). Hoje so casa com acento ("manutenção" sim, "manutencao" nao).
- **Tabelas filhas de obras** (medições, empenhos, planilhas, cronogramas, fontes recurso, liquidações, documentos liquidação) - todas vazias hoje, modelar quando aparecerem dados.
- **Sub-modulo Obras Paralisadas** (`/obrasparalisadas`) - 6 atestados PDF anuais.
- Endpoint `/api/contratos/:id/obras` (join via `obras.contrato_external_id`). Trivial.
- Endpoint `/api/licitacoes/:id/contratos-derivados` (join via `contratos.licitacao_external_id`). Trivial.
- Download fisico dos PDFs (editais, contratos).
- Tuning do scheduler em produçao (hoje roda licitacao + contrato + obra em sequencia a cada N horas).

## Como rodar (dev)

> Nota: usamos a porta `5433` no host para nao colidir com outros postgres locais. Ajuste em `.env` se precisar.

```bash
docker compose up -d              # postgres em localhost:5433
cp .env.example .env
pnpm install
pnpm db:push                      # aplica schema
pnpm test                         # roda testes de parser
pnpm scrape:licitacao --limit 3   # carga parcial de licitacoes
pnpm scrape:contrato --limit 3    # carga parcial de contratos
pnpm scrape:obra --limit 3        # carga parcial de obras
pnpm api                          # API em http://127.0.0.1:3000 (UI Scalar em /docs)
```
