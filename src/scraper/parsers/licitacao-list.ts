import * as cheerio from "cheerio";
import {
  absoluteUrl,
  cleanWhitespace,
  extractIdFromDetailUrl,
  nullIfEmpty,
  parseAnoFromNumero,
  parseBRDate,
  parseBRMoney,
  parseBRTime,
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

export type { PaginationForm };

export type LicitacaoListItem = {
  externalId: string;
  numero: string;
  ano: number | null;
  numeroSequencial: number | null;
  modalidade: string | null;
  dataSessao: string | null;
  horaSessao: string | null;
  valorEstimadoCentavos: bigint | null;
  situacao: string | null;
  objeto: string | null;
  detailUrl: string;
  rawDescricao: string | null;
};

export type LicitacaoListPage = {
  sourceLastUpdate: string | null;
  totalRecords: number | null;
  currentRangeStart: number | null;
  currentRangeEnd: number | null;
  totalPages: number | null;
  paginationForm: PaginationForm | null;
  items: LicitacaoListItem[];
};

export function parseLicitacaoList(html: string, baseUrl: string): LicitacaoListPage {
  const $ = cheerio.load(html);

  const sourceLastUpdate = parseLastUpdate($);
  const totalRecords = parseTotalRecords($);
  const range = parseCurrentRange($);
  const paginationForm = parsePaginationForm($, baseUrl);
  const items = parseRows($, baseUrl);

  return {
    sourceLastUpdate,
    totalRecords,
    currentRangeStart: range?.start ?? null,
    currentRangeEnd: range?.end ?? null,
    totalPages: paginationForm?.lastPage ?? null,
    paginationForm,
    items,
  };
}

function parseRows($: cheerio.CheerioAPI, baseUrl: string): LicitacaoListItem[] {
  const items: LicitacaoListItem[] = [];

  $("table.table tbody tr").each((_, row) => {
    const cells = $(row).find("> td");
    if (cells.length < 5) return;

    const numero = cleanWhitespace(cells.eq(0).text());
    const descricaoCell = cells.eq(1);
    const situacao = cleanWhitespace(cells.eq(2).text());
    const objeto = cleanWhitespace(cells.eq(3).text());
    const actionLink = cells.eq(4).find("a[href]").first();
    const href = actionLink.attr("href") ?? "";
    const detailUrl = absoluteUrl(href, baseUrl);
    const externalId = extractIdFromDetailUrl(href);

    if (!externalId || !detailUrl) return;

    const fields = parseLabeledStrongCell(descricaoCell);

    items.push({
      externalId,
      numero,
      ano: parseAnoFromNumero(numero),
      numeroSequencial: parseSequencialFromNumero(numero),
      modalidade: nullIfEmpty(fields["modalidade"]),
      dataSessao: parseBRDate(fields["data"]),
      horaSessao: parseBRTime(fields["hora"]),
      valorEstimadoCentavos: parseBRMoney(fields["valor estimado"]),
      situacao: nullIfEmpty(situacao),
      objeto: nullIfEmpty(objeto),
      detailUrl,
      rawDescricao: nullIfEmpty(descricaoCell.text()),
    });
  });

  return items;
}
