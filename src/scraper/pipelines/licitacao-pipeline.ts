import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import pino from "pino";
import { config } from "../../config";
import { type Db, getDb, schema } from "../../db/client";
import { fetchHtml } from "../http-client";
import { contentHash } from "../parsers/common";
import { parseLicitacaoDetail, type LicitacaoDetail } from "../parsers/licitacao-detail";
import { parseLicitacaoList, type LicitacaoListItem, type LicitacaoListPage, type PaginationForm } from "../parsers/licitacao-list";

const logger = pino({ level: config.LOG_LEVEL, transport: { target: "pino-pretty", options: { colorize: true } } });

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
  const baseUrl = config.SCRAPER_BASE_URL;
  const summary: RunSummary = {
    runId,
    pagesScraped: 0,
    recordsSeen: 0,
    recordsInserted: 0,
    recordsUpdated: 0,
    recordsUnchanged: 0,
    detailsFetched: 0,
    errors: 0,
    status: "success",
  };

  const collected: LicitacaoListItem[] = [];
  let firstPage: LicitacaoListPage | null = null;

  const pageFrom = options.pageFrom ?? 1;
  const pageTo = options.pageTo ?? Number.MAX_SAFE_INTEGER;
  let currentPage = pageFrom;
  let lastKnownPage = pageTo === Number.MAX_SAFE_INTEGER ? Infinity : pageTo;

  while (currentPage <= lastKnownPage) {
    const listResult: { page: LicitacaoListPage } =
      currentPage === 1 && pageFrom === 1
        ? await fetchListFirstPage(baseUrl)
        : await fetchListByPage(baseUrl, currentPage, firstPage?.paginationForm ?? null);

    if (currentPage === pageFrom) firstPage = listResult.page;
    summary.pagesScraped++;

    const remainingBudget = options.limit ? options.limit - collected.length : Infinity;
    const sliced = listResult.page.items.slice(0, Math.max(0, remainingBudget));
    collected.push(...sliced);
    summary.recordsSeen += listResult.page.items.length;

    if (firstPage?.sourceLastUpdate) {
      await db
        .update(schema.scrapingRuns)
        .set({ sourceLastUpdateSeen: firstPage.sourceLastUpdate })
        .where(eq(schema.scrapingRuns.id, runId));
    }

    logger.info(
      { page: currentPage, items: listResult.page.items.length, lastPage: listResult.page.totalPages },
      "scraped list page",
    );

    if (options.limit && collected.length >= options.limit) break;

    const totalPages = listResult.page.totalPages ?? 1;
    if (currentPage >= totalPages) break;
    if (lastKnownPage === Infinity) lastKnownPage = totalPages;

    currentPage++;
    if (config.SCRAPER_REQUEST_DELAY_MS > 0) await delay(config.SCRAPER_REQUEST_DELAY_MS);
  }

  await db
    .update(schema.scrapingRuns)
    .set({ pagesScraped: summary.pagesScraped, recordsSeen: summary.recordsSeen })
    .where(eq(schema.scrapingRuns.id, runId));

  for (const item of collected) {
    try {
      let detail: LicitacaoDetail | null = null;
      if (!options.skipDetails) {
        const response = await fetchHtml(item.detailUrl);
        detail = parseLicitacaoDetail(response.body, baseUrl);
        summary.detailsFetched++;
        if (config.SCRAPER_REQUEST_DELAY_MS > 0) await delay(config.SCRAPER_REQUEST_DELAY_MS);
      }

      const result = await upsertLicitacao(db, item, detail, firstPage?.sourceLastUpdate ?? null);
      if (result === "inserted") summary.recordsInserted++;
      else if (result === "updated") summary.recordsUpdated++;
      else summary.recordsUnchanged++;
    } catch (err) {
      summary.errors++;
      summary.status = "partial";
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ url: item.detailUrl, err: message }, "failed to fetch/parse detail");
      await appendRunError(db, runId, {
        url: item.detailUrl,
        stage: "detail",
        message,
      });
    }
  }

  await db
    .update(schema.scrapingRuns)
    .set({
      recordsInserted: summary.recordsInserted,
      recordsUpdated: summary.recordsUpdated,
      recordsUnchanged: summary.recordsUnchanged,
      detailsFetched: summary.detailsFetched,
    })
    .where(eq(schema.scrapingRuns.id, runId));

  return summary;
}

async function fetchListFirstPage(baseUrl: string): Promise<{ page: LicitacaoListPage }> {
  const url = new URL(LIST_URL_PATH, baseUrl).toString();
  const res = await fetchHtml(url);
  return { page: parseLicitacaoList(res.body, baseUrl) };
}

async function fetchListByPage(
  baseUrl: string,
  page: number,
  form: PaginationForm | null,
): Promise<{ page: LicitacaoListPage }> {
  if (!form) {
    return fetchListFirstPage(baseUrl);
  }
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
  return { page: parseLicitacaoList(res.body, baseUrl) };
}

type UpsertResult = "inserted" | "updated" | "unchanged";

async function upsertLicitacao(
  db: Db,
  item: LicitacaoListItem,
  detail: LicitacaoDetail | null,
  sourceLastUpdate: string | null,
): Promise<UpsertResult> {
  const merged = mergeListAndDetail(item, detail);
  const hashInput: Record<string, unknown> = {
    ...merged,
    valorEstimadoCentavos: merged.valorEstimadoCentavos === null ? null : merged.valorEstimadoCentavos.toString(),
    documentos: detail?.documentos ?? [],
    empresas: detail?.empresas?.map(canonicalEmpresa) ?? [],
    pregoeiros: detail?.pregoeiros ?? [],
    contratosAtas: detail?.contratosAtas?.map(canonicalContrato) ?? [],
  };
  const hash = contentHash(hashInput);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.licitacoes)
      .where(eq(schema.licitacoes.externalId, item.externalId))
      .limit(1);

    if (!existing) {
      const [inserted] = await tx
        .insert(schema.licitacoes)
        .values({
          ...merged,
          sourceLastUpdate,
          contentHash: hash,
        })
        .returning({ id: schema.licitacoes.id });

      if (detail) await replaceChildren(tx, inserted.id, detail);
      return "inserted" as const;
    }

    if (existing.contentHash === hash) {
      await tx
        .update(schema.licitacoes)
        .set({ lastSeenAt: new Date(), sourceLastUpdate })
        .where(eq(schema.licitacoes.id, existing.id));
      return "unchanged" as const;
    }

    await tx
      .update(schema.licitacoes)
      .set({
        ...merged,
        sourceLastUpdate,
        contentHash: hash,
        lastSeenAt: new Date(),
        lastChangedAt: new Date(),
      })
      .where(eq(schema.licitacoes.id, existing.id));

    if (detail) await replaceChildren(tx, existing.id, detail);
    return "updated" as const;
  });
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

async function replaceChildren(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  licitacaoId: number,
  detail: LicitacaoDetail,
): Promise<void> {
  await tx.delete(schema.licitacaoDocumentos).where(eq(schema.licitacaoDocumentos.licitacaoId, licitacaoId));
  await tx.delete(schema.licitacaoEmpresas).where(eq(schema.licitacaoEmpresas.licitacaoId, licitacaoId));
  await tx.delete(schema.licitacaoPregoeiros).where(eq(schema.licitacaoPregoeiros.licitacaoId, licitacaoId));
  await tx.delete(schema.licitacaoContratosAtas).where(eq(schema.licitacaoContratosAtas.licitacaoId, licitacaoId));

  if (detail.documentos.length > 0) {
    const seen = new Set<string>();
    const rows = detail.documentos
      .filter((d) => {
        const key = d.numero ?? "";
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((d) => ({ ...d, licitacaoId }));
    await tx.insert(schema.licitacaoDocumentos).values(rows);
  }
  if (detail.empresas.length > 0) {
    await tx.insert(schema.licitacaoEmpresas).values(
      detail.empresas.map((e) => ({
        licitacaoId,
        cnpj: e.cnpj,
        razaoSocial: e.razaoSocial,
        situacao: e.situacao,
        valorPropostaCentavos: e.valorPropostaCentavos,
        classificacao: e.classificacao,
        rawData: e.rawData,
      })),
    );
  }
  if (detail.pregoeiros.length > 0) {
    await tx.insert(schema.licitacaoPregoeiros).values(
      detail.pregoeiros.map((p) => ({
        licitacaoId,
        nome: p.nome,
        cpf: p.cpf,
        funcao: p.funcao,
        rawData: p.rawData,
      })),
    );
  }
  if (detail.contratosAtas.length > 0) {
    await tx.insert(schema.licitacaoContratosAtas).values(
      detail.contratosAtas.map((c) => ({
        licitacaoId,
        numero: c.numero,
        tipo: c.tipo,
        dataAssinatura: c.dataAssinatura,
        valorCentavos: c.valorCentavos,
        documentoUrl: c.documentoUrl,
        rawData: c.rawData,
      })),
    );
  }
}

function canonicalEmpresa(e: LicitacaoDetail["empresas"][number]) {
  return { ...e, valorPropostaCentavos: e.valorPropostaCentavos === null ? null : e.valorPropostaCentavos.toString() };
}
function canonicalContrato(c: LicitacaoDetail["contratosAtas"][number]) {
  return { ...c, valorCentavos: c.valorCentavos === null ? null : c.valorCentavos.toString() };
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

async function appendRunError(
  db: Db,
  runId: number,
  err: { url?: string; stage?: string; message: string; attempt?: number },
) {
  const [row] = await db
    .select({ errors: schema.scrapingRuns.errors })
    .from(schema.scrapingRuns)
    .where(eq(schema.scrapingRuns.id, runId))
    .limit(1);
  const existing = row?.errors ?? [];
  await db
    .update(schema.scrapingRuns)
    .set({ errors: [...existing, err] })
    .where(eq(schema.scrapingRuns.id, runId));
}
