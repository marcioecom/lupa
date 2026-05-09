import { setTimeout as delay } from "node:timers/promises";
import { eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { config } from "../../config";
import { type Db, getDb, schema } from "../../db/client";
import { chunkArray, pMap } from "../concurrency";
import { fetchHtml } from "../http-client";
import { contentHash } from "../parsers/common";
import { parseContratoDetail, type ContratoDetail } from "../parsers/contrato-detail";
import {
  parseContratoList,
  type ContratoListItem,
  type ContratoListPage,
} from "../parsers/contrato-list";
import type { PaginationForm } from "../parsers/portal-helpers";

const logger = pino({
  level: config.LOG_LEVEL,
  transport: { target: "pino-pretty", options: { colorize: true } },
});

const CHUNK_SIZE = 500;
const LIST_URL_PATH = "/contrato/Index";

export type RunOptions = {
  limit?: number;
  skipDetails?: boolean;
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
  detailsFetched: number;
  errors: number;
  status: "success" | "partial" | "failed";
};

type EnrichedItem = {
  list: ContratoListItem;
  detail: ContratoDetail | null;
};

type CollectedList = {
  items: ContratoListItem[];
  pagesScraped: number;
  recordsSeen: number;
  firstPage: ContratoListPage | null;
};

export async function runContratoPipeline(options: RunOptions = {}): Promise<RunSummary> {
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

  const enriched = await fetchAllDetails(collected.items, options);

  return applyToDb(db, runId, enriched, {
    pagesScraped: collected.pagesScraped,
    recordsSeen: collected.recordsSeen,
    sourceLastUpdate: collected.firstPage?.sourceLastUpdate ?? null,
    skipDetails: options.skipDetails ?? false,
  });
}

async function collectListItems(options: RunOptions): Promise<CollectedList> {
  const baseUrl = config.SCRAPER_BASE_URL;
  const pageFrom = options.pageFrom ?? 1;
  const pageTo = options.pageTo ?? Number.MAX_SAFE_INTEGER;

  const items: ContratoListItem[] = [];
  let firstPage: ContratoListPage | null = null;
  let pagesScraped = 0;
  let recordsSeen = 0;

  let currentPage = pageFrom;
  let lastKnownPage = pageTo === Number.MAX_SAFE_INTEGER ? Infinity : pageTo;

  while (currentPage <= lastKnownPage) {
    const page: ContratoListPage =
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
      "scraped contrato list page",
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

async function fetchAllDetails(
  items: ContratoListItem[],
  options: RunOptions,
): Promise<EnrichedItem[]> {
  if (options.skipDetails) {
    return items.map((list) => ({ list, detail: null }));
  }
  return pMap(items, config.SCRAPER_CONCURRENCY, async (list) => ({
    list,
    detail: await fetchOneDetail(list),
  }));
}

async function fetchOneDetail(item: ContratoListItem): Promise<ContratoDetail | null> {
  try {
    const response = await fetchHtml(item.detailUrl);
    return parseContratoDetail(response.body, config.SCRAPER_BASE_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url: item.detailUrl, err: message }, "failed to fetch/parse contrato detail");
    return null;
  }
}

type ApplyContext = {
  pagesScraped: number;
  recordsSeen: number;
  sourceLastUpdate: string | null;
  skipDetails: boolean;
};

type Prepared = {
  item: EnrichedItem;
  merged: ReturnType<typeof mergeListAndDetail>;
  hash: string;
};

async function applyToDb(
  db: Db,
  runId: number,
  enriched: EnrichedItem[],
  ctx: ApplyContext,
): Promise<RunSummary> {
  const detailsFetched = enriched.filter((e) => e.detail !== null).length;
  const detailErrors = ctx.skipDetails ? 0 : enriched.length - detailsFetched;

  const summary: RunSummary = {
    runId,
    pagesScraped: ctx.pagesScraped,
    recordsSeen: ctx.recordsSeen,
    recordsInserted: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    detailsFetched,
    errors: detailErrors,
    status: detailErrors > 0 ? "partial" : "success",
  };

  if (enriched.length === 0) {
    await persistApplyCounts(db, runId, summary);
    return summary;
  }

  const prepared: Prepared[] = enriched.map((item) => {
    const merged = mergeListAndDetail(item.list, item.detail);
    const hash = contentHash(buildHashInput(merged, item.detail));
    return { item, merged, hash };
  });

  const existingRows = await db
    .select({
      id: schema.contratos.id,
      externalId: schema.contratos.externalId,
      contentHash: schema.contratos.contentHash,
    })
    .from(schema.contratos)
    .where(inArray(schema.contratos.externalId, prepared.map((p) => p.merged.externalId)));

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
        .update(schema.contratos)
        .set({ lastSeenAt: new Date(), sourceLastUpdate: ctx.sourceLastUpdate })
        .where(inArray(
          schema.contratos.externalId,
          toUnchanged.map((u) => u.merged.externalId),
        ));
    }

    const writes = [...toInsert, ...toUpdate];
    if (writes.length === 0) return;

    const idMap = await bulkUpsertContratos(tx, writes, ctx.sourceLastUpdate);
    await replaceAllChildren(tx, writes, idMap);
  });

  summary.recordsInserted = toInsert.length;
  summary.recordsUpdated = toUpdate.length;
  summary.recordsUnchanged = toUnchanged.length;

  await persistApplyCounts(db, runId, summary);
  return summary;
}

async function bulkUpsertContratos(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  writes: Prepared[],
  sourceLastUpdate: string | null,
): Promise<Map<string, number>> {
  const rows = writes.map((p) => ({
    ...p.merged,
    contentHash: p.hash,
    sourceLastUpdate,
  }));

  const idMap = new Map<string, number>();
  for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
    const result = await tx
      .insert(schema.contratos)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.contratos.externalId,
        set: {
          numero: sql`excluded.numero`,
          ano: sql`excluded.ano`,
          numeroSequencial: sql`excluded.numero_sequencial`,
          modalidade: sql`excluded.modalidade`,
          finalidade: sql`excluded.finalidade`,
          unidadeGestora: sql`excluded.unidade_gestora`,
          empresaContratada: sql`excluded.empresa_contratada`,
          cnpjEmpresa: sql`excluded.cnpj_empresa`,
          fundamentoLegal: sql`excluded.fundamento_legal`,
          objeto: sql`excluded.objeto`,
          vigenciaInicio: sql`excluded.vigencia_inicio`,
          vigenciaFim: sql`excluded.vigencia_fim`,
          valorCentavos: sql`excluded.valor_centavos`,
          dataPublicacaoExtrato: sql`excluded.data_publicacao_extrato`,
          situacao: sql`excluded.situacao`,
          licitacaoExternalId: sql`excluded.licitacao_external_id`,
          detailUrl: sql`excluded.detail_url`,
          contratoPdfUrl: sql`excluded.contrato_pdf_url`,
          sourceLastUpdate: sql`excluded.source_last_update`,
          contentHash: sql`excluded.content_hash`,
          lastSeenAt: sql`now()`,
          lastChangedAt: sql`now()`,
        },
      })
      .returning({ id: schema.contratos.id, externalId: schema.contratos.externalId });
    for (const r of result) idMap.set(r.externalId, r.id);
  }
  return idMap;
}

async function replaceAllChildren(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  writes: Prepared[],
  idMap: Map<string, number>,
): Promise<void> {
  const writesWithDetail = writes.filter((p) => p.item.detail !== null);
  if (writesWithDetail.length === 0) return;

  const affectedIds = writesWithDetail
    .map((p) => idMap.get(p.merged.externalId))
    .filter((id): id is number => id !== undefined);
  if (affectedIds.length === 0) return;

  await tx.delete(schema.contratoDocumentos).where(inArray(schema.contratoDocumentos.contratoId, affectedIds));
  await tx.delete(schema.contratoAditivos).where(inArray(schema.contratoAditivos.contratoId, affectedIds));
  await tx.delete(schema.contratoApostilamentos).where(inArray(schema.contratoApostilamentos.contratoId, affectedIds));
  await tx.delete(schema.contratoPagamentos).where(inArray(schema.contratoPagamentos.contratoId, affectedIds));
  await tx.delete(schema.contratoResponsaveis).where(inArray(schema.contratoResponsaveis.contratoId, affectedIds));

  const docRows: typeof schema.contratoDocumentos.$inferInsert[] = [];
  const aditRows: typeof schema.contratoAditivos.$inferInsert[] = [];
  const apostRows: typeof schema.contratoApostilamentos.$inferInsert[] = [];
  const pagRows: typeof schema.contratoPagamentos.$inferInsert[] = [];
  const respRows: typeof schema.contratoResponsaveis.$inferInsert[] = [];

  for (const p of writesWithDetail) {
    const id = idMap.get(p.merged.externalId);
    if (id === undefined || p.item.detail === null) continue;

    const seenDoc = new Set<string>();
    for (const d of p.item.detail.documentos) {
      const key = d.numero ?? "";
      if (seenDoc.has(key)) continue;
      seenDoc.add(key);
      docRows.push({ ...d, contratoId: id });
    }
    for (const a of p.item.detail.aditivos) {
      aditRows.push({ contratoId: id, ...a });
    }
    for (const a of p.item.detail.apostilamentos) {
      apostRows.push({ contratoId: id, ...a });
    }
    for (const pg of p.item.detail.pagamentos) {
      pagRows.push({ contratoId: id, ...pg });
    }
    for (const r of p.item.detail.responsaveis) {
      respRows.push({ contratoId: id, ...r });
    }
  }

  for (const chunk of chunkArray(docRows, CHUNK_SIZE)) await tx.insert(schema.contratoDocumentos).values(chunk);
  for (const chunk of chunkArray(aditRows, CHUNK_SIZE)) await tx.insert(schema.contratoAditivos).values(chunk);
  for (const chunk of chunkArray(apostRows, CHUNK_SIZE)) await tx.insert(schema.contratoApostilamentos).values(chunk);
  for (const chunk of chunkArray(pagRows, CHUNK_SIZE)) await tx.insert(schema.contratoPagamentos).values(chunk);
  for (const chunk of chunkArray(respRows, CHUNK_SIZE)) await tx.insert(schema.contratoResponsaveis).values(chunk);
}

async function persistApplyCounts(db: Db, runId: number, summary: RunSummary): Promise<void> {
  await db
    .update(schema.scrapingRuns)
    .set({
      recordsInserted: summary.recordsInserted,
      recordsUpdated: summary.recordsUpdated,
      recordsUnchanged: summary.recordsUnchanged,
      detailsFetched: summary.detailsFetched,
    })
    .where(eq(schema.scrapingRuns.id, runId));
}

async function fetchListFirstPage(baseUrl: string): Promise<ContratoListPage> {
  const url = new URL(LIST_URL_PATH, baseUrl).toString();
  const res = await fetchHtml(url);
  return parseContratoList(res.body, baseUrl);
}

async function fetchListByPage(
  baseUrl: string,
  page: number,
  form: PaginationForm | null,
): Promise<ContratoListPage> {
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
  return parseContratoList(res.body, baseUrl);
}

function buildHashInput(
  merged: ReturnType<typeof mergeListAndDetail>,
  detail: ContratoDetail | null,
) {
  return {
    ...merged,
    valorCentavos: merged.valorCentavos?.toString() ?? null,
    documentos: detail?.documentos ?? [],
    aditivos: detail?.aditivos?.map(canonicalAditivo) ?? [],
    apostilamentos: detail?.apostilamentos ?? [],
    pagamentos: detail?.pagamentos?.map(canonicalPagamento) ?? [],
    responsaveis: detail?.responsaveis ?? [],
  };
}

function mergeListAndDetail(item: ContratoListItem, detail: ContratoDetail | null) {
  const header = detail?.header;
  return {
    externalId: item.externalId,
    numero: item.numero,
    ano: item.ano,
    numeroSequencial: item.numeroSequencial,
    modalidade: header?.modalidade ?? item.modalidade ?? null,
    finalidade: header?.finalidade ?? item.finalidade ?? null,
    unidadeGestora: header?.unidadeGestora ?? item.unidadeGestora ?? null,
    empresaContratada: header?.empresaContratada ?? null,
    cnpjEmpresa: header?.cnpjEmpresa ?? null,
    fundamentoLegal: header?.fundamentoLegal ?? null,
    objeto: header?.objeto ?? item.objeto ?? null,
    vigenciaInicio: header?.vigenciaInicio ?? null,
    vigenciaFim: header?.vigenciaFim ?? item.vigenciaFim ?? null,
    valorCentavos: header?.valorCentavos ?? item.valorCentavos,
    dataPublicacaoExtrato: header?.dataPublicacaoExtrato ?? null,
    situacao: header?.situacao ?? item.situacao ?? null,
    licitacaoExternalId: header?.licitacaoExternalId ?? null,
    detailUrl: item.detailUrl,
    contratoPdfUrl: header?.contratoPdfUrl ?? null,
  };
}

function canonicalAditivo(a: ContratoDetail["aditivos"][number]) {
  return { ...a, valorCentavos: a.valorCentavos?.toString() ?? null };
}
function canonicalPagamento(p: ContratoDetail["pagamentos"][number]) {
  return { ...p, valorCentavos: p.valorCentavos?.toString() ?? null };
}

async function startRun(db: Db) {
  const [row] = await db
    .insert(schema.scrapingRuns)
    .values({ module: "contrato", status: "running" })
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
