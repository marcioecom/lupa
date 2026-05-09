import * as cheerio from "cheerio";
import {
  absoluteUrl,
  cleanWhitespace,
  nullIfEmpty,
  parseBRDate,
  parseBRMoney,
  parseBRTime,
} from "./common";
import {
  collectDlPairs,
  isEmptyTab,
  parseLabeledStrongCell,
  pickFromRecord,
  readTableHeaders,
  zipHeadersValues,
} from "./portal-helpers";

export type LicitacaoDetailHeader = {
  modalidadeFromTitle: string | null;
  numeroFromTitle: string | null;
  situacao: string | null;
  dataDisponibilizacao: string | null;
  numeroProcessoInterno: string | null;
  dataSessao: string | null;
  horaSessao: string | null;
  localSessao: string | null;
  observacao: string | null;
  objeto: string | null;
  editalPdfUrl: string | null;
};

export type LicitacaoDetailDocumento = {
  numero: string | null;
  descricao: string | null;
  data: string | null;
  tipo: string | null;
  documentoUrl: string | null;
};

export type LicitacaoDetailEmpresa = {
  razaoSocial: string | null;
  cnpj: string | null;
  situacao: string | null;
  classificacao: string | null;
  valorPropostaCentavos: bigint | null;
  rawData: Record<string, string | null>;
};

export type LicitacaoDetailPregoeiro = {
  nome: string | null;
  cpf: string | null;
  funcao: string | null;
  rawData: Record<string, string | null>;
};

export type LicitacaoDetailContratoAta = {
  numero: string | null;
  tipo: string | null;
  dataAssinatura: string | null;
  valorCentavos: bigint | null;
  documentoUrl: string | null;
  rawData: Record<string, string | null>;
};

export type LicitacaoDetail = {
  header: LicitacaoDetailHeader;
  documentos: LicitacaoDetailDocumento[];
  empresas: LicitacaoDetailEmpresa[];
  contratosAtas: LicitacaoDetailContratoAta[];
  pregoeiros: LicitacaoDetailPregoeiro[];
};

export function parseLicitacaoDetail(html: string, baseUrl: string): LicitacaoDetail {
  const $ = cheerio.load(html);

  return {
    header: parseHeader($, baseUrl),
    documentos: parseDocumentos($, baseUrl),
    empresas: parseEmpresas($),
    contratosAtas: parseContratosAtas($, baseUrl),
    pregoeiros: parsePregoeiros($),
  };
}

function parseHeader($: cheerio.CheerioAPI, baseUrl: string): LicitacaoDetailHeader {
  const titleText = cleanWhitespace($("h1.page-header").first().text());
  let modalidadeFromTitle: string | null = null;
  let numeroFromTitle: string | null = null;
  const titleMatch = titleText.match(/^(.+?):\s*(\S+)\s*$/);
  if (titleMatch) {
    modalidadeFromTitle = nullIfEmpty(titleMatch[1]);
    numeroFromTitle = nullIfEmpty(titleMatch[2]);
  }

  const dl = collectDlPairs($);

  const editalAnchor = $("a")
    .filter((_, a) => /Baixe o Edital/i.test($(a).text()))
    .first();

  return {
    modalidadeFromTitle,
    numeroFromTitle,
    situacao: nullIfEmpty(dl.get("situação") ?? dl.get("situacao") ?? null),
    dataDisponibilizacao: parseBRDate(
      dl.get("data de disponibilização deste arquivo no site") ??
        dl.get("data de disponibilizacao deste arquivo no site"),
    ),
    numeroProcessoInterno: nullIfEmpty(
      dl.get("número processo interno") ?? dl.get("numero processo interno") ?? null,
    ),
    dataSessao: parseBRDate(dl.get("data da sessão") ?? dl.get("data da sessao")),
    horaSessao: parseBRTime(dl.get("horário da sessão") ?? dl.get("horario da sessao")),
    localSessao: nullIfEmpty(dl.get("local da sessão") ?? dl.get("local da sessao") ?? null),
    observacao: nullIfEmpty(dl.get("observação") ?? dl.get("observacao") ?? null),
    objeto: nullIfEmpty(dl.get("objeto") ?? null),
    editalPdfUrl: absoluteUrl(editalAnchor.attr("href") ?? null, baseUrl),
  };
}

function parseDocumentos($: cheerio.CheerioAPI, baseUrl: string): LicitacaoDetailDocumento[] {
  const items: LicitacaoDetailDocumento[] = [];
  $("#tab_default_1 table tbody tr").each((_, row) => {
    const cells = $(row).find("> td");
    if (cells.length < 4) return;
    const link = cells.eq(4).find("a[href]").first();
    items.push({
      numero: nullIfEmpty(cells.eq(0).text()),
      descricao: nullIfEmpty(cells.eq(1).text()),
      data: parseBRDate(cleanWhitespace(cells.eq(2).text())),
      tipo: nullIfEmpty(cells.eq(3).text()),
      documentoUrl: absoluteUrl(link.attr("href") ?? null, baseUrl),
    });
  });
  return items;
}

function parseEmpresas($: cheerio.CheerioAPI): LicitacaoDetailEmpresa[] {
  const items: LicitacaoDetailEmpresa[] = [];
  const tab = $("#tab_default_2");
  if (isEmptyTab(tab)) return items;

  const headers = readTableHeaders($, tab);

  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td").map((_, c) => cleanWhitespace($(c).text())).get() as string[];
    if (cells.length === 0) return;
    const raw = zipHeadersValues(headers, cells);
    const vencedora = pickFromRecord(raw, ["vencedora(s)", "vencedora"]);
    items.push({
      razaoSocial: pickFromRecord(raw, ["empresa", "razão social", "razao social"]),
      cnpj: pickFromRecord(raw, ["cpf / cnpj", "cnpj", "cpf/cnpj"]),
      situacao: pickFromRecord(raw, ["status"]),
      classificacao: vencedora && /sim/i.test(vencedora) ? "Vencedora" : null,
      valorPropostaCentavos: parseBRMoney(
        pickFromRecord(raw, ["valor", "valor da proposta", "valor proposta"]),
      ),
      rawData: raw,
    });
  });
  return items;
}

function parseContratosAtas($: cheerio.CheerioAPI, baseUrl: string): LicitacaoDetailContratoAta[] {
  const items: LicitacaoDetailContratoAta[] = [];
  const tab = $("#tab_default_3");
  if (isEmptyTab(tab)) return items;

  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td");
    if (cells.length < 3) return;
    const numero = nullIfEmpty(cells.eq(0).text());
    const descricaoCell = cells.eq(1);
    const status = nullIfEmpty(cells.eq(2).text());
    const link = cells.eq(3).find("a[href]").first();
    const href = link.attr("href") ?? null;

    const fields = parseLabeledStrongCell(descricaoCell);
    const tipo = href && /\/ata\//i.test(href)
      ? "Ata"
      : href && /\/contrato\//i.test(href)
        ? "Contrato"
        : null;

    items.push({
      numero,
      tipo,
      dataAssinatura: null,
      valorCentavos: null,
      documentoUrl: absoluteUrl(href, baseUrl),
      rawData: { ...fields, status: status ?? null },
    });
  });
  return items;
}

function parsePregoeiros($: cheerio.CheerioAPI): LicitacaoDetailPregoeiro[] {
  const items: LicitacaoDetailPregoeiro[] = [];
  const tab = $("#tab_default_4");
  if (isEmptyTab(tab)) return items;

  const headers = readTableHeaders($, tab);

  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td").map((_, c) => cleanWhitespace($(c).text())).get() as string[];
    if (cells.length === 0) return;
    const raw = zipHeadersValues(headers, cells);
    items.push({
      nome: pickFromRecord(raw, ["nome"]),
      cpf: pickFromRecord(raw, ["cpf"]),
      funcao: pickFromRecord(raw, ["função", "funcao", "cargo"]),
      rawData: raw,
    });
  });
  return items;
}
