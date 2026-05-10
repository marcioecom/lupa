# lupa

ETL e API REST sobre dados públicos do portal de transparência do TCE-TO ([Tribunal de Contas do Estado do Tocantins](https://transparencia.tceto.tc.br)). Faz o scraping diário de licitações, contratos e obras, persiste em PostgreSQL e expõe os dados via Fastify para alimentar painéis de BI.

## Por que

O portal do TCE-TO tem todos os dados que um analista precisa, mas espalhados em páginas paginadas via POST com payload PHP-serialize+base64, sem API oficial. lupa transforma isso em um banco SQL relacional + endpoints REST que ferramentas de BI (Metabase, PowerBI, Superset) consomem direto.

## Módulos cobertos

| Módulo | Origem | Registros | Tabelas |
|---|---|---|---|
| Licitações | `/licitacao` | ~670 | `licitacoes` + 4 filhas (documentos, empresas, pregoeiros, contratos_atas) |
| Contratos | `/contrato/Index` | ~1.191 | `contratos` + 5 filhas (documentos, aditivos, apostilamentos, pagamentos, responsaveis) |
| Obras | `/obraseservicosdeengenharia` | ~14 | `obras` (sem filhas - as 7 abas do detalhe estão vazias hoje) |

Cross-reference entre módulos via colunas `*_external_id` (sem FK rígida): `contratos.licitacao_external_id` → `licitacoes.external_id`, `obras.contrato_external_id` → `contratos.external_id`.

## Stack

- Node.js 20+ / TypeScript 5
- pnpm
- PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team/)
- [undici](https://undici.nodejs.org/) (HTTP) + [cheerio](https://cheerio.js.org/) (parser HTML)
- [Fastify 5](https://fastify.dev/) (REST API)
- [@fastify/swagger](https://github.com/fastify/fastify-swagger) + [Scalar](https://scalar.com/) (docs auto-geradas)
- [vitest](https://vitest.dev/) (testes)

## Quick start

```bash
docker compose up -d              # postgres em localhost:5433
cp .env.example .env
pnpm install
pnpm db:push                      # aplica schema (12 tabelas)
pnpm test                         # 75+ testes de parsers contra fixtures HTML reais

pnpm scrape:licitacao             # carga completa (~2:30min)
pnpm scrape:contrato              # carga completa (~4:20min)
pnpm scrape:obra                  # carga completa (~30s)

pnpm api                          # http://127.0.0.1:3000
                                  # http://127.0.0.1:3000/docs (Scalar UI)
```

Cada CLI aceita `--limit N`, `--page-from N`, `--page-to N`, e `--skip-details` (licitação/contrato).

## API

REST sob `/api/`, JSON. Documentação interativa em [`/docs`](http://127.0.0.1:3000/docs).

Resumo dos grupos:

- `health` - liveness/readiness
- `meta` - metadados da última carga por módulo
- `licitacoes` - lista (filtros: ano, modalidade, situação, valor, data, full-text), detalhe, sub-recursos, stats
- `contratos` - lista (filtros: ano, modalidade, situação, unidade gestora, CNPJ, vigência, valor, full-text), detalhe, sub-recursos, stats
- `obras` - lista (filtros: ano, situação, empresa, contrato, valor, full-text), detalhe, stats

## Performance

Medições em ambiente local (Docker postgres):

- **Licitações** (670): carga limpa **2:33min**, idempotente **2:33min** (concorrência 4 + bulk upsert).
- **Contratos** (1.191): carga limpa **4:19min**, idempotente **4:16min**. Inclui ~10k registros filhos.
- **Obras** (14): carga limpa **~30s** (dominado pela latência do portal nessa rota).

A versão original serial demorava ~12min para licitações; a otimizada (concorrência HTTP + bulk INSERT ON CONFLICT em transação) ficou ~4.7x mais rápida.

## Scheduler

Em modo API, ligando `SCRAPER_SCHEDULE_ENABLED=true` faz o servidor rodar os 3 pipelines em sequência a cada `SCRAPER_SCHEDULE_INTERVAL_HOURS` (default 24h). Ideal para deploy em Railway/Fly/etc.

## Estrutura

```
src/
  api/
    plugins/        docs, tag-routes
    routes/         health, meta, licitacoes, contratos, obras
    server.ts       Fastify factory
  cli/              entry points (scrape-*, serve)
  db/
    schema/         12 tabelas Drizzle
    client.ts       pool + drizzle factory
  scraper/
    parsers/        common, portal-helpers, {licitacao,contrato,obra}-{list,detail}
    pipelines/      {licitacao,contrato,obra}-pipeline
    concurrency.ts  pMap + chunkArray
    http-client.ts  undici com retry exponencial
    scheduler.ts    cron em-processo para os 3 pipelines
  config.ts         env carregado e validado com zod
tests/
  parsers/          75+ testes contra fixtures HTML reais
  fixtures/         HTML capturado do portal real
```

## Paginação do portal

Não é GET com `?page=N`. É POST com:
- `dadosfilter`: PHP-serialize + base64 do array `{inicio, fim}` (extraído da página 1)
- `pagina`: número da página alvo
- `total`: total de registros
- `ordem`: `pesq`

`src/scraper/parsers/portal-helpers.ts:parsePaginationForm` extrai os campos do `<form>` que envolve a tabela; o pipeline reaproveita o `dadosfilter` original em todos os requests subsequentes.

## SPEC

Detalhes técnicos, decisões de modelagem e TODOs ficam em [SPEC.md](./SPEC.md).
