import * as cheerio from "cheerio";
import {
  absoluteUrl,
  cleanWhitespace,
  extractIdFromDetailUrl,
  nullIfEmpty,
  parseBRDate,
  parseBRMoney,
  parsePercentage,
} from "./common";
import {
  parseCurrentRange,
  parseLastUpdate,
  parsePaginationForm,
  parseTotalRecords,
  type PaginationForm,
} from "./portal-helpers";

export type ObraListItem = {
  externalId: string;
  contratoExternalId: string;
  ano: number | null;
  descricaoIntervencao: string | null;
  descricaoBem: string | null;
  empresa: string | null;
  dataInicio: string | null;
  previsaoTermino: string | null;
  valorIntervencaoCentavos: bigint | null;
  valorContratoCentavos: bigint | null;
  valorAditivoCentavos: bigint | null;
  situacao: string | null;
  medicoesPercentual: string | null;
  contratoUrl: string;
};

export type ObraListPage = {
  sourceLastUpdate: string | null;
  totalRecords: number | null;
  currentRangeStart: number | null;
  currentRangeEnd: number | null;
  totalPages: number | null;
  paginationForm: PaginationForm | null;
  items: ObraListItem[];
};

export function parseObraList(html: string, baseUrl: string): ObraListPage {
  const $ = cheerio.load(html);

  const paginationForm = parsePaginationForm($, baseUrl);
  const range = parseCurrentRange($);

  return {
    sourceLastUpdate: parseLastUpdate($),
    totalRecords: parseTotalRecords($),
    currentRangeStart: range?.start ?? null,
    currentRangeEnd: range?.end ?? null,
    totalPages: paginationForm?.lastPage ?? null,
    paginationForm,
    items: parseRows($, baseUrl),
  };
}

function parseRows($: cheerio.CheerioAPI, baseUrl: string): ObraListItem[] {
  const items: ObraListItem[] = [];

  $("table.table tbody tr").each((_, row) => {
    const cells = $(row).find("> td");
    if (cells.length < 11) return;

    const valorContratoCell = cells.eq(7);
    const link = valorContratoCell.find("a[href]").first();
    const href = link.attr("href") ?? "";
    const contratoExternalId = extractIdFromDetailUrl(href);
    const contratoUrl = absoluteUrl(href, baseUrl);

    if (!contratoExternalId || !contratoUrl) return;

    const ano = Number(cleanWhitespace(cells.eq(0).text()));

    items.push({
      externalId: contratoExternalId,
      contratoExternalId,
      ano: Number.isFinite(ano) && ano > 0 ? ano : null,
      descricaoIntervencao: nullIfEmpty(cells.eq(1).text()),
      descricaoBem: nullIfEmpty(cells.eq(2).text()),
      empresa: nullIfEmpty(cells.eq(3).text()),
      dataInicio: parseBRDate(cleanWhitespace(cells.eq(4).text())),
      previsaoTermino: parseBRDate(cleanWhitespace(cells.eq(5).text())),
      valorIntervencaoCentavos: parseBRMoney(cleanWhitespace(cells.eq(6).text())),
      valorContratoCentavos: parseBRMoney(cleanWhitespace(link.text())),
      valorAditivoCentavos: parseBRMoney(cleanWhitespace(cells.eq(8).text())),
      situacao: nullIfEmpty(cells.eq(9).text()),
      medicoesPercentual: parsePercentage(cleanWhitespace(cells.eq(10).text())),
      contratoUrl,
    });
  });

  return items;
}
