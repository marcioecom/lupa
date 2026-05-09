# lupa - SPEC

## Objetivo

Transformar 3 paginas do portal de transparencia do TCE-TO (Tribunal de Contas do Estado do Tocantins) em uma API REST que alimentara um painel de BI.

Fontes:
- https://transparencia.tceto.tc.br/licitacao (~670 registros)
- https://transparencia.tceto.tc.br/contrato/Index (~1.191 registros)
- https://transparencia.tceto.tc.br/obraseservicosdeengenharia (~14 registros)

## Iteracao atual

**Iteracao 3 - Contratos.** Itera sobre a fundacao das iteracoes 1-2 (licitacoes). Obras vem na proxima iteracao.

Modulos cobertos ate aqui:
- `licitacoes` (670 registros) - iteracao 1
- `contratos` (1.191 registros) - iteracao 3

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

Tabela `scraping_runs` (compartilhada) para auditoria com coluna `module = 'licitacao' | 'contrato'`.

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

**Numeros medidos** (2026-05-09, banco local em Docker):
- **Licitacoes** (670 registros): carga limpa **2:33min**, re-run idempotente **2:33min** (~4.7x mais rapido que a implementacao serial anterior).
- **Contratos** (1.191 registros): carga limpa **4:19min**, re-run idempotente **4:16min**. Detalhes da carga: 3.544 documentos, 612 aditivos, 208 apostilamentos, 4.365 pagamentos, 1.903 responsaveis.

Re-runs continuam baixando todos os detalhes pelo HTTP - o gargalo e a rede, nao o DB. Mitigacao futura: list-hash short-circuit (TODO).

## TODOs conhecidos
- **Re-execucao mais rapida**: hoje a 2a rodada continua baixando todos os detalhes mesmo quando nada mudou. Otimizacao: armazenar um `list_hash` separado (so dos campos da listagem), comparar antes do fetch e pular detalhe quando casa. Reduziria re-execucao para ~10-15s.
- Busca full-text sem acento no Postgres (carrega extensao `unaccent` ou ajusta dicionario). Hoje so casa com acento ("manutenção" sim, "manutencao" nao).
- Scraper de obras (proxima iteracao).
- Scheduler/cron quando definir hosting.
- Download fisico dos PDFs (editais, contratos).
- Endpoint `/api/licitacoes/:id/contratos-derivados` (join contratos.licitacao_external_id -> licitacoes.external_id).

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
pnpm api                          # API em http://127.0.0.1:3000
```
