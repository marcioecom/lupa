import { setTimeout as delay } from "node:timers/promises";
import { eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { config } from "../../config";
import { type Db, getDb, schema } from "../../db/client";
import { chunkArray, dedupeByKey } from "../concurrency";
import { fetchHtml } from "../http-client";
import { contentHash } from "../parsers/common";
import {
  parseObraList,
  type ObraListItem,
  type ObraListPage,
} from "../parsers/obra-list";
import type { PaginationForm } from "../parsers/portal-helpers";

const logger = pino({
  level: config.LOG_LEVEL,
  transport: { target: "pino-pretty", options: { colorize: true } },
});

const CHUNK_SIZE = 500;
const LIST_URL_PATH = "/obraseservicosdeengenharia";

export type RunOptions = {
  limit?: number;
  pageFrom?: number;
  pageTo?: number;
};

export type RunSummary = {
  runId: number;
  pagesScraped: number;
  recordsSeen: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsUnchanged: number;
  errors: number;
  status: "success" | "partial" | "failed";
};

type CollectedList = {
  items: ObraListItem[];
  pagesScraped: number;
  recordsSeen: number;
  firstPage: ObraListPage | null;
};

export async function runObraPipeline(options: RunOptions = {}): Promise<RunSummary> {
  const db = getDb();
  const run = await startRun(db);

  try {
    const summary = await execute(db, run.id, options);
    await finishRun(db, run.id, summary.status);
    return summary;
  } catch (err) {
    await failRun(db, run.id, err);
    throw err;
  }
}

async function execute(db: Db, runId: number, options: RunOptions): Promise<RunSummary> {
  const collected = await collectListItems(options);
  await persistListPhase(db, runId, collected);

  return applyToDb(db, runId, collected.items, {
    pagesScraped: collected.pagesScraped,
    recordsSeen: collected.recordsSeen,
    sourceLastUpdate: collected.firstPage?.sourceLastUpdate ?? null,
  });
}

async function collectListItems(options: RunOptions): Promise<CollectedList> {
  const baseUrl = config.SCRAPER_BASE_URL;
  const pageFrom = options.pageFrom ?? 1;
  const pageTo = options.pageTo ?? Number.MAX_SAFE_INTEGER;

  const items: ObraListItem[] = [];
  let firstPage: ObraListPage | null = null;
  let pagesScraped = 0;
  let recordsSeen = 0;

  let currentPage = pageFrom;
  let lastKnownPage = pageTo === Number.MAX_SAFE_INTEGER ? Infinity : pageTo;

  while (currentPage <= lastKnownPage) {
    const page: ObraListPage =
      currentPage === pageFrom && pageFrom === 1
        ? await fetchListFirstPage(baseUrl)
        : await fetchListByPage(baseUrl, currentPage, firstPage?.paginationForm ?? null);

    if (currentPage === pageFrom) firstPage = page;
    pagesScraped++;
    recordsSeen += page.items.length;

    const remaining = options.limit ? options.limit - items.length : Infinity;
    items.push(...page.items.slice(0, Math.max(0, remaining)));

    logger.info(
      { page: currentPage, items: page.items.length, lastPage: page.totalPages },
      "scraped obra list page",
    );

    if (options.limit && items.length >= options.limit) break;
    const totalPages = page.totalPages ?? 1;
    if (currentPage >= totalPages) break;
    if (lastKnownPage === Infinity) lastKnownPage = totalPages;

    currentPage++;
    if (config.SCRAPER_REQUEST_DELAY_MS > 0) await delay(config.SCRAPER_REQUEST_DELAY_MS);
  }

  return { items, pagesScraped, recordsSeen, firstPage };
}

async function persistListPhase(db: Db, runId: number, collected: CollectedList): Promise<void> {
  await db
    .update(schema.scrapingRuns)
    .set({
      pagesScraped: collected.pagesScraped,
      recordsSeen: collected.recordsSeen,
      sourceLastUpdateSeen: collected.firstPage?.sourceLastUpdate ?? null,
    })
    .where(eq(schema.scrapingRuns.id, runId));
}

type ApplyContext = {
  pagesScraped: number;
  recordsSeen: number;
  sourceLastUpdate: string | null;
};

type Prepared = {
  item: ObraListItem;
  merged: ReturnType<typeof toRow>;
  hash: string;
};

async function applyToDb(
  db: Db,
  runId: number,
  items: ObraListItem[],
  ctx: ApplyContext,
): Promise<RunSummary> {
  const summary: RunSummary = {
    runId,
    pagesScraped: ctx.pagesScraped,
    recordsSeen: ctx.recordsSeen,
    recordsInserted: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    errors: 0,
    status: "success",
  };

  if (items.length === 0) {
    await persistApplyCounts(db, runId, summary);
    return summary;
  }

  const prepared: Prepared[] = dedupeByKey(
    items.map((item) => {
      const merged = toRow(item);
      const hash = contentHash({
        ...merged,
        valorIntervencaoCentavos: merged.valorIntervencaoCentavos?.toString() ?? null,
        valorContratoCentavos: merged.valorContratoCentavos?.toString() ?? null,
        valorAditivoCentavos: merged.valorAditivoCentavos?.toString() ?? null,
      });
      return { item, merged, hash };
    }),
    (p) => p.merged.externalId,
  );

  const existingRows = await db
    .select({
      id: schema.obras.id,
      externalId: schema.obras.externalId,
      contentHash: schema.obras.contentHash,
    })
    .from(schema.obras)
    .where(inArray(schema.obras.externalId, prepared.map((p) => p.merged.externalId)));

  const existingMap = new Map(existingRows.map((r) => [r.externalId, r]));
  const toInsert: Prepared[] = [];
  const toUpdate: Prepared[] = [];
  const toUnchanged: Prepared[] = [];

  for (const p of prepared) {
    const existing = existingMap.get(p.merged.externalId);
    if (!existing) toInsert.push(p);
    else if (existing.contentHash === p.hash) toUnchanged.push(p);
    else toUpdate.push(p);
  }

  await db.transaction(async (tx) => {
    if (toUnchanged.length > 0) {
      await tx
        .update(schema.obras)
        .set({ lastSeenAt: new Date(), sourceLastUpdate: ctx.sourceLastUpdate })
        .where(inArray(
          schema.obras.externalId,
          toUnchanged.map((u) => u.merged.externalId),
        ));
    }

    const writes = [...toInsert, ...toUpdate];
    if (writes.length === 0) return;

    const rows = writes.map((p) => ({
      ...p.merged,
      contentHash: p.hash,
      sourceLastUpdate: ctx.sourceLastUpdate,
    }));

    for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
      await tx
        .insert(schema.obras)
        .values(chunk)
        .onConflictDoUpdate({
          target: schema.obras.externalId,
          set: {
            ano: sql`excluded.ano`,
            descricaoIntervencao: sql`excluded.descricao_intervencao`,
            descricaoBem: sql`excluded.descricao_bem`,
            empresa: sql`excluded.empresa`,
            dataInicio: sql`excluded.data_inicio`,
            previsaoTermino: sql`excluded.previsao_termino`,
            valorIntervencaoCentavos: sql`excluded.valor_intervencao_centavos`,
            valorContratoCentavos: sql`excluded.valor_contrato_centavos`,
            valorAditivoCentavos: sql`excluded.valor_aditivo_centavos`,
            situacao: sql`excluded.situacao`,
            medicoesPercentual: sql`excluded.medicoes_percentual`,
            objeto: sql`excluded.objeto`,
            contratoExternalId: sql`excluded.contrato_external_id`,
            detailUrl: sql`excluded.detail_url`,
            sourceLastUpdate: sql`excluded.source_last_update`,
            contentHash: sql`excluded.content_hash`,
            lastSeenAt: sql`now()`,
            lastChangedAt: sql`now()`,
          },
        });
    }
  });

  summary.recordsInserted = toInsert.length;
  summary.recordsUpdated = toUpdate.length;
  summary.recordsUnchanged = toUnchanged.length;

  await persistApplyCounts(db, runId, summary);
  return summary;
}

function toRow(item: ObraListItem) {
  return {
    externalId: item.externalId,
    ano: item.ano,
    descricaoIntervencao: item.descricaoIntervencao,
    descricaoBem: item.descricaoBem,
    empresa: item.empresa,
    dataInicio: item.dataInicio,
    previsaoTermino: item.previsaoTermino,
    valorIntervencaoCentavos: item.valorIntervencaoCentavos,
    valorContratoCentavos: item.valorContratoCentavos,
    valorAditivoCentavos: item.valorAditivoCentavos,
    situacao: item.situacao,
    medicoesPercentual: item.medicoesPercentual,
    objeto: null as string | null,
    contratoExternalId: item.contratoExternalId,
    detailUrl: item.contratoUrl,
  };
}

async function persistApplyCounts(db: Db, runId: number, summary: RunSummary): Promise<void> {
  await db
    .update(schema.scrapingRuns)
    .set({
      recordsInserted: summary.recordsInserted,
      recordsUpdated: summary.recordsUpdated,
      recordsUnchanged: summary.recordsUnchanged,
    })
    .where(eq(schema.scrapingRuns.id, runId));
}

async function fetchListFirstPage(baseUrl: string): Promise<ObraListPage> {
  const url = new URL(LIST_URL_PATH, baseUrl).toString();
  const res = await fetchHtml(url);
  return parseObraList(res.body, baseUrl);
}

async function fetchListByPage(
  baseUrl: string,
  page: number,
  form: PaginationForm | null,
): Promise<ObraListPage> {
  if (!form) return fetchListFirstPage(baseUrl);
  const body = new URLSearchParams({
    dadosfilter: form.dadosfilter,
    total: form.total,
    pagina: String(page),
    ...(form.ordem ? { ordem: form.ordem } : {}),
  }).toString();

  const res = await fetchHtml(form.action, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  return parseObraList(res.body, baseUrl);
}

async function startRun(db: Db) {
  const [row] = await db
    .insert(schema.scrapingRuns)
    .values({ module: "obra", status: "running" })
    .returning({ id: schema.scrapingRuns.id });
  return row;
}

async function finishRun(db: Db, runId: number, status: RunSummary["status"]) {
  await db
    .update(schema.scrapingRuns)
    .set({ finishedAt: new Date(), status })
    .where(eq(schema.scrapingRuns.id, runId));
}

async function failRun(db: Db, runId: number, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  await db
    .update(schema.scrapingRuns)
    .set({ finishedAt: new Date(), status: "failed", errorSummary: message })
    .where(eq(schema.scrapingRuns.id, runId));
}
