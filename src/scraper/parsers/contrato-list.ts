import * as cheerio from "cheerio";
import {
  absoluteUrl,
  cleanWhitespace,
  extractIdFromDetailUrl,
  nullIfEmpty,
  parseAnoFromNumero,
  parseBRDate,
  parseBRMoney,
  parseSequencialFromNumero,
} from "./common";
import {
  parseCurrentRange,
  parseLabeledStrongCell,
  parseLastUpdate,
  parsePaginationForm,
  parseTotalRecords,
  type PaginationForm,
} from "./portal-helpers";

export type ContratoListItem = {
  externalId: string;
  numero: string;
  ano: number | null;
  numeroSequencial: number | null;
  unidadeGestora: string | null;
  modalidade: string | null;
  finalidade: string | null;
  objeto: string | null;
  vigenciaFim: string | null;
  valorCentavos: bigint | null;
  situacao: string | null;
  detailUrl: string;
  rawDescricao: string | null;
};

export type ContratoListPage = {
  sourceLastUpdate: string | null;
  totalRecords: number | null;
  currentRangeStart: number | null;
  currentRangeEnd: number | null;
  totalPages: number | null;
  paginationForm: PaginationForm | null;
  items: ContratoListItem[];
};

export function parseContratoList(html: string, baseUrl: string): ContratoListPage {
  const $ = cheerio.load(html);

  const paginationForm = parsePaginationForm($, baseUrl);

  return {
    sourceLastUpdate: parseLastUpdate($),
    totalRecords: parseTotalRecords($),
    currentRangeStart: parseCurrentRange($)?.start ?? null,
    currentRangeEnd: parseCurrentRange($)?.end ?? null,
    totalPages: paginationForm?.lastPage ?? null,
    paginationForm,
    items: parseRows($, baseUrl),
  };
}

function parseRows($: cheerio.CheerioAPI, baseUrl: string): ContratoListItem[] {
  const items: ContratoListItem[] = [];

  $("table.table tbody tr").each((_, row) => {
    const cells = $(row).find("> td");
    if (cells.length < 4) return;

    const numero = cleanWhitespace(cells.eq(0).text());
    const descricaoCell = cells.eq(1);
    const situacao = cleanWhitespace(cells.eq(2).text());
    const link = cells.eq(3).find("a[href]").first();
    const href = link.attr("href") ?? "";
    const detailUrl = absoluteUrl(href, baseUrl);
    const externalId = extractIdFromDetailUrl(href);

    if (!externalId || !detailUrl) return;

    const fields = parseLabeledStrongCell(descricaoCell);

    items.push({
      externalId,
      numero,
      ano: parseAnoFromNumero(numero),
      numeroSequencial: parseSequencialFromNumero(numero),
      unidadeGestora: nullIfEmpty(fields["unidade gestora"]),
      modalidade: nullIfEmpty(fields["modalidade"]),
      finalidade: nullIfEmpty(fields["finalidade"]),
      objeto: nullIfEmpty(fields["objeto"]),
      vigenciaFim: parseBRDate(fields["vigência do contrato"] ?? fields["vigencia do contrato"]),
      valorCentavos: parseBRMoney(fields["valor do contrato"]),
      situacao: nullIfEmpty(situacao),
      detailUrl,
      rawDescricao: nullIfEmpty(descricaoCell.text()),
    });
  });

  return items;
}
