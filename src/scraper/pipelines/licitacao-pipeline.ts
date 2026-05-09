import { setTimeout as delay } from "node:timers/promises";
import { eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { config } from "../../config";
import { type Db, getDb, schema } from "../../db/client";
import { fetchHtml } from "../http-client";
import { contentHash } from "../parsers/common";
import { parseLicitacaoDetail, type LicitacaoDetail } from "../parsers/licitacao-detail";
import {
  parseLicitacaoList,
  type LicitacaoListItem,
  type LicitacaoListPage,
  type PaginationForm,
} from "../parsers/licitacao-list";

const logger = pino({
  level: config.LOG_LEVEL,
  transport: { target: "pino-pretty", options: { colorize: true } },
});

const CHUNK_SIZE = 500;

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
  list: LicitacaoListItem;
  detail: LicitacaoDetail | null;
};

type CollectedList = {
  items: LicitacaoListItem[];
  pagesScraped: number;
  recordsSeen: number;
  firstPage: LicitacaoListPage | null;
};

const LIST_URL_PATH = "/licitacao";

export async function runLicitacaoPipeline(options: RunOptions = {}): Promise<RunSummary> {
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

  const items: LicitacaoListItem[] = [];
  let firstPage: LicitacaoListPage | null = null;
  let pagesScraped = 0;
  let recordsSeen = 0;

  let currentPage = pageFrom;
  let lastKnownPage = pageTo === Number.MAX_SAFE_INTEGER ? Infinity : pageTo;

  while (currentPage <= lastKnownPage) {
    const page: LicitacaoListPage =
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
      "scraped list page",
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
  items: LicitacaoListItem[],
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

async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function fetchOneDetail(item: LicitacaoListItem): Promise<LicitacaoDetail | null> {
  try {
    const response = await fetchHtml(item.detailUrl);
    return parseLicitacaoDetail(response.body, config.SCRAPER_BASE_URL);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ url: item.detailUrl, err: message }, "failed to fetch/parse detail");
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
      id: schema.licitacoes.id,
      externalId: schema.licitacoes.externalId,
      contentHash: schema.licitacoes.contentHash,
    })
    .from(schema.licitacoes)
    .where(inArray(schema.licitacoes.externalId, prepared.map((p) => p.merged.externalId)));

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
        .update(schema.licitacoes)
        .set({ lastSeenAt: new Date(), sourceLastUpdate: ctx.sourceLastUpdate })
        .where(inArray(
          schema.licitacoes.externalId,
          toUnchanged.map((u) => u.merged.externalId),
        ));
    }

    const writes = [...toInsert, ...toUpdate];
    if (writes.length === 0) return;

    const idMap = await bulkUpsertLicitacoes(tx, writes, ctx.sourceLastUpdate);
    await replaceAllChildren(tx, writes, idMap);
  });

  summary.recordsInserted = toInsert.length;
  summary.recordsUpdated = toUpdate.length;
  summary.recordsUnchanged = toUnchanged.length;

  await persistApplyCounts(db, runId, summary);
  return summary;
}

async function bulkUpsertLicitacoes(
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
      .insert(schema.licitacoes)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.licitacoes.externalId,
        set: {
          numero: sql`excluded.numero`,
          ano: sql`excluded.ano`,
          numeroSequencial: sql`excluded.numero_sequencial`,
          modalidade: sql`excluded.modalidade`,
          descricao: sql`excluded.descricao`,
          objeto: sql`excluded.objeto`,
          situacao: sql`excluded.situacao`,
          dataSessao: sql`excluded.data_sessao`,
          horaSessao: sql`excluded.hora_sessao`,
          valorEstimadoCentavos: sql`excluded.valor_estimado_centavos`,
          numeroProcessoInterno: sql`excluded.numero_processo_interno`,
          localSessao: sql`excluded.local_sessao`,
          observacao: sql`excluded.observacao`,
          dataDisponibilizacao: sql`excluded.data_disponibilizacao`,
          detailUrl: sql`excluded.detail_url`,
          editalPdfUrl: sql`excluded.edital_pdf_url`,
          sourceLastUpdate: sql`excluded.source_last_update`,
          contentHash: sql`excluded.content_hash`,
          lastSeenAt: sql`now()`,
          lastChangedAt: sql`now()`,
        },
      })
      .returning({ id: schema.licitacoes.id, externalId: schema.licitacoes.externalId });
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

  await tx.delete(schema.licitacaoDocumentos).where(inArray(schema.licitacaoDocumentos.licitacaoId, affectedIds));
  await tx.delete(schema.licitacaoEmpresas).where(inArray(schema.licitacaoEmpresas.licitacaoId, affectedIds));
  await tx.delete(schema.licitacaoPregoeiros).where(inArray(schema.licitacaoPregoeiros.licitacaoId, affectedIds));
  await tx.delete(schema.licitacaoContratosAtas).where(inArray(schema.licitacaoContratosAtas.licitacaoId, affectedIds));

  const docRows: typeof schema.licitacaoDocumentos.$inferInsert[] = [];
  const empRows: typeof schema.licitacaoEmpresas.$inferInsert[] = [];
  const preRows: typeof schema.licitacaoPregoeiros.$inferInsert[] = [];
  const cntRows: typeof schema.licitacaoContratosAtas.$inferInsert[] = [];

  for (const p of writesWithDetail) {
    const id = idMap.get(p.merged.externalId);
    if (id === undefined || p.item.detail === null) continue;

    const seenDoc = new Set<string>();
    for (const d of p.item.detail.documentos) {
      const key = d.numero ?? "";
      if (seenDoc.has(key)) continue;
      seenDoc.add(key);
      docRows.push({ ...d, licitacaoId: id });
    }
    for (const e of p.item.detail.empresas) {
      empRows.push({
        licitacaoId: id,
        cnpj: e.cnpj,
        razaoSocial: e.razaoSocial,
        situacao: e.situacao,
        valorPropostaCentavos: e.valorPropostaCentavos,
        classificacao: e.classificacao,
        rawData: e.rawData,
      });
    }
    for (const pr of p.item.detail.pregoeiros) {
      preRows.push({
        licitacaoId: id,
        nome: pr.nome,
        cpf: pr.cpf,
        funcao: pr.funcao,
        rawData: pr.rawData,
      });
    }
    for (const c of p.item.detail.contratosAtas) {
      cntRows.push({
        licitacaoId: id,
        numero: c.numero,
        tipo: c.tipo,
        dataAssinatura: c.dataAssinatura,
        valorCentavos: c.valorCentavos,
        documentoUrl: c.documentoUrl,
        rawData: c.rawData,
      });
    }
  }

  for (const chunk of chunkArray(docRows, CHUNK_SIZE)) await tx.insert(schema.licitacaoDocumentos).values(chunk);
  for (const chunk of chunkArray(empRows, CHUNK_SIZE)) await tx.insert(schema.licitacaoEmpresas).values(chunk);
  for (const chunk of chunkArray(preRows, CHUNK_SIZE)) await tx.insert(schema.licitacaoPregoeiros).values(chunk);
  for (const chunk of chunkArray(cntRows, CHUNK_SIZE)) await tx.insert(schema.licitacaoContratosAtas).values(chunk);
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

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchListFirstPage(baseUrl: string): Promise<LicitacaoListPage> {
  const url = new URL(LIST_URL_PATH, baseUrl).toString();
  const res = await fetchHtml(url);
  return parseLicitacaoList(res.body, baseUrl);
}

async function fetchListByPage(
  baseUrl: string,
  page: number,
  form: PaginationForm | null,
): Promise<LicitacaoListPage> {
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
  return parseLicitacaoList(res.body, baseUrl);
}

function buildHashInput(
  merged: ReturnType<typeof mergeListAndDetail>,
  detail: LicitacaoDetail | null,
) {
  return {
    ...merged,
    valorEstimadoCentavos: merged.valorEstimadoCentavos?.toString() ?? null,
    documentos: detail?.documentos ?? [],
    empresas: detail?.empresas?.map(canonicalEmpresa) ?? [],
    pregoeiros: detail?.pregoeiros ?? [],
    contratosAtas: detail?.contratosAtas?.map(canonicalContrato) ?? [],
  };
}

function mergeListAndDetail(item: LicitacaoListItem, detail: LicitacaoDetail | null) {
  const header = detail?.header;
  return {
    externalId: item.externalId,
    numero: item.numero,
    ano: item.ano,
    numeroSequencial: item.numeroSequencial,
    modalidade: header?.modalidadeFromTitle ?? item.modalidade ?? null,
    descricao: item.rawDescricao,
    objeto: header?.objeto ?? item.objeto ?? null,
    situacao: header?.situacao ?? item.situacao ?? null,
    dataSessao: header?.dataSessao ?? item.dataSessao ?? null,
    horaSessao: header?.horaSessao ?? item.horaSessao ?? null,
    valorEstimadoCentavos: item.valorEstimadoCentavos,
    numeroProcessoInterno: header?.numeroProcessoInterno ?? null,
    localSessao: header?.localSessao ?? null,
    observacao: header?.observacao ?? null,
    dataDisponibilizacao: header?.dataDisponibilizacao ?? null,
    detailUrl: item.detailUrl,
    editalPdfUrl: header?.editalPdfUrl ?? null,
  };
}

function canonicalEmpresa(e: LicitacaoDetail["empresas"][number]) {
  return { ...e, valorPropostaCentavos: e.valorPropostaCentavos?.toString() ?? null };
}
function canonicalContrato(c: LicitacaoDetail["contratosAtas"][number]) {
  return { ...c, valorCentavos: c.valorCentavos?.toString() ?? null };
}

async function startRun(db: Db) {
  const [row] = await db
    .insert(schema.scrapingRuns)
    .values({ module: "licitacao", status: "running" })
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
