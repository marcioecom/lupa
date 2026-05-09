import * as cheerio from "cheerio";
import {
  absoluteUrl,
  cleanWhitespace,
  extractIdFromDetailUrl,
  nullIfEmpty,
  parseBRDate,
  parseBRMoney,
} from "./common";
import {
  collectDlPairs,
  isEmptyTab,
  pickFromRecord,
  readTableHeaders,
  zipHeadersValues,
} from "./portal-helpers";

export type ContratoDetailHeader = {
  numeroFromTitle: string | null;
  modalidade: string | null;
  unidadeGestora: string | null;
  finalidade: string | null;
  empresaContratada: string | null;
  cnpjEmpresa: string | null;
  fundamentoLegal: string | null;
  vigenciaInicio: string | null;
  vigenciaFim: string | null;
  dataPublicacaoExtrato: string | null;
  valorCentavos: bigint | null;
  situacao: string | null;
  objeto: string | null;
  contratoPdfUrl: string | null;
  licitacaoExternalId: string | null;
};

export type ContratoDetailDocumento = {
  numero: string | null;
  descricao: string | null;
  data: string | null;
  tipo: string | null;
  documentoUrl: string | null;
};

export type ContratoDetailAditivo = {
  numero: string | null;
  descricao: string | null;
  data: string | null;
  valorCentavos: bigint | null;
  documentoUrl: string | null;
  rawData: Record<string, string | null>;
};

export type ContratoDetailApostilamento = {
  numero: string | null;
  descricao: string | null;
  data: string | null;
  rawData: Record<string, string | null>;
};

export type ContratoDetailPagamento = {
  data: string | null;
  notaFiscal: string | null;
  observacao: string | null;
  valorCentavos: bigint | null;
  rawData: Record<string, string | null>;
};

export type ContratoDetailResponsavel = {
  nome: string | null;
  cpf: string | null;
  funcao: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  rawData: Record<string, string | null>;
};

export type ContratoDetail = {
  header: ContratoDetailHeader;
  documentos: ContratoDetailDocumento[];
  aditivos: ContratoDetailAditivo[];
  apostilamentos: ContratoDetailApostilamento[];
  pagamentos: ContratoDetailPagamento[];
  responsaveis: ContratoDetailResponsavel[];
};

const VIGENCIA_RANGE_RE = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*$/;

function parseVigenciaRange(input: string | null | undefined): { inicio: string | null; fim: string | null } {
  if (!input) return { inicio: null, fim: null };
  const m = input.match(VIGENCIA_RANGE_RE);
  if (!m) return { inicio: null, fim: parseBRDate(input) };
  return { inicio: parseBRDate(m[1]), fim: parseBRDate(m[2]) };
}

export function parseContratoDetail(html: string, baseUrl: string): ContratoDetail {
  const $ = cheerio.load(html);

  return {
    header: parseHeader($, baseUrl),
    documentos: parseDocumentos($, baseUrl),
    aditivos: parseAditivos($, baseUrl),
    apostilamentos: parseApostilamentos($),
    pagamentos: parsePagamentos($),
    responsaveis: parseResponsaveis($),
  };
}

function parseHeader($: cheerio.CheerioAPI, baseUrl: string): ContratoDetailHeader {
  const titleText = cleanWhitespace($("h1.page-header").first().text());
  const titleMatch = titleText.match(/CONTRATO\s*:\s*(\S+)/i);
  const numeroFromTitle = titleMatch ? nullIfEmpty(titleMatch[1]) : null;

  const modalidadeHeading = cleanWhitespace($("h3").first().text());
  const modalidadeMatch = modalidadeHeading.match(/Modalidade\s*:\s*(.+?)\s*$/i);
  const modalidade = modalidadeMatch ? nullIfEmpty(modalidadeMatch[1]) : null;

  const dl = collectDlPairs($);
  const vigencia = parseVigenciaRange(dl.get("vigência do contrato") ?? dl.get("vigencia do contrato"));

  const downloadAnchor = $("a")
    .filter((_, a) => /Baixe o Contrato/i.test($(a).text()))
    .first();

  const licitacaoLink = $("#tab_default_1 a[href*='/licitacao/details/']").first();
  const licitacaoExternalId = extractIdFromDetailUrl(licitacaoLink.attr("href") ?? null);

  return {
    numeroFromTitle,
    modalidade,
    unidadeGestora: nullIfEmpty(dl.get("unidade gestora") ?? null),
    finalidade: nullIfEmpty(dl.get("finalidade") ?? null),
    empresaContratada: nullIfEmpty(
      dl.get("nome da contratada") ?? dl.get("empresa contratada") ?? null,
    ),
    cnpjEmpresa: nullIfEmpty(dl.get("cnpj") ?? dl.get("cpf / cnpj") ?? null),
    fundamentoLegal: nullIfEmpty(dl.get("fundamento legal") ?? null),
    vigenciaInicio: vigencia.inicio,
    vigenciaFim: vigencia.fim,
    dataPublicacaoExtrato: parseBRDate(
      dl.get("data publicação extrato") ?? dl.get("data publicacao extrato"),
    ),
    valorCentavos: parseBRMoney(dl.get("valor") ?? null),
    situacao: nullIfEmpty(dl.get("situação") ?? dl.get("situacao") ?? null),
    objeto: nullIfEmpty(dl.get("objeto") ?? null),
    contratoPdfUrl: absoluteUrl(downloadAnchor.attr("href") ?? null, baseUrl),
    licitacaoExternalId,
  };
}

function parseDocumentos($: cheerio.CheerioAPI, baseUrl: string): ContratoDetailDocumento[] {
  const items: ContratoDetailDocumento[] = [];
  const tab = $("#tab_default_2");
  if (isEmptyTab(tab)) return items;

  tab.find("table tbody tr").each((_, row) => {
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

function parseAditivos($: cheerio.CheerioAPI, baseUrl: string): ContratoDetailAditivo[] {
  const items: ContratoDetailAditivo[] = [];
  const tab = $("#tab_default_3");
  if (isEmptyTab(tab)) return items;

  const headers = readTableHeaders($, tab);
  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td").map((_, c) => cleanWhitespace($(c).text())).get() as string[];
    if (cells.length === 0) return;
    const raw = zipHeadersValues(headers, cells);
    const link = $(row).find("a[href]").first();
    items.push({
      numero: pickFromRecord(raw, ["número", "numero"]),
      descricao: pickFromRecord(raw, ["descrição", "descricao"]),
      data: parseBRDate(pickFromRecord(raw, ["data"])),
      valorCentavos: parseBRMoney(pickFromRecord(raw, ["valor", "valor do aditivo"])),
      documentoUrl: absoluteUrl(link.attr("href") ?? null, baseUrl),
      rawData: raw,
    });
  });
  return items;
}

function parseApostilamentos($: cheerio.CheerioAPI): ContratoDetailApostilamento[] {
  const items: ContratoDetailApostilamento[] = [];
  const tab = $("#tab_default_6");
  if (isEmptyTab(tab)) return items;

  const headers = readTableHeaders($, tab);
  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td").map((_, c) => cleanWhitespace($(c).text())).get() as string[];
    if (cells.length === 0) return;
    const raw = zipHeadersValues(headers, cells);
    items.push({
      numero: pickFromRecord(raw, ["número", "numero"]),
      descricao: pickFromRecord(raw, ["descrição", "descricao"]),
      data: parseBRDate(pickFromRecord(raw, ["data"])),
      rawData: raw,
    });
  });
  return items;
}

function parsePagamentos($: cheerio.CheerioAPI): ContratoDetailPagamento[] {
  const items: ContratoDetailPagamento[] = [];
  const tab = $("#tab_default_4");
  if (isEmptyTab(tab)) return items;

  const headers = readTableHeaders($, tab);
  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td").map((_, c) => cleanWhitespace($(c).text())).get() as string[];
    if (cells.length === 0) return;
    const raw = zipHeadersValues(headers, cells);
    items.push({
      data: parseBRDate(pickFromRecord(raw, ["data"])),
      notaFiscal: pickFromRecord(raw, ["nota fiscal", "nf"]),
      observacao: pickFromRecord(raw, ["observação", "observacao"]),
      valorCentavos: parseBRMoney(pickFromRecord(raw, ["valor"])),
      rawData: raw,
    });
  });
  return items;
}

function parseResponsaveis($: cheerio.CheerioAPI): ContratoDetailResponsavel[] {
  const items: ContratoDetailResponsavel[] = [];
  const tab = $("#tab_default_5");
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
      dataInicio: parseBRDate(pickFromRecord(raw, ["início", "inicio", "ínicio"])),
      dataFim: parseBRDate(pickFromRecord(raw, ["fim", "término", "termino"])),
      rawData: raw,
    });
  });
  return items;
}
