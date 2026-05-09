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

export type PaginationForm = {
  action: string;
  dadosfilter: string;
  total: string;
  ordem: string | null;
  lastPage: number;
};

export function parseLicitacaoList(html: string, baseUrl: string): LicitacaoListPage {
  const $ = cheerio.load(html);

  const sourceLastUpdate = parseLastUpdate($);
  const totalRecords = parseTotalRecords($);
  const range = parseCurrentRange($);
  const paginationForm = parsePaginationForm($, baseUrl);
  const items = parseRows($, baseUrl);

  const totalPages = paginationForm?.lastPage ?? null;

  return {
    sourceLastUpdate,
    totalRecords,
    currentRangeStart: range?.start ?? null,
    currentRangeEnd: range?.end ?? null,
    totalPages,
    paginationForm,
    items,
  };
}

function parseLastUpdate($: cheerio.CheerioAPI): string | null {
  let result: string | null = null;
  $("strong").each((_, el) => {
    const text = cleanWhitespace($(el).text());
    if (text.startsWith("Última atualização")) {
      const dateText = cleanWhitespace($(el).parent().find("span").first().text());
      result = parseBRDate(dateText);
      return false;
    }
  });
  return result;
}

function parseTotalRecords($: cheerio.CheerioAPI): number | null {
  const totalInput = $("input[name='total']").first().attr("value");
  if (totalInput && /^\d+$/.test(totalInput)) {
    return Number(totalInput);
  }
  const text = $("body").text();
  const match = text.match(/total de\s+(\d+)\s+registros/i);
  return match ? Number(match[1]) : null;
}

function parseCurrentRange($: cheerio.CheerioAPI): { start: number; end: number } | null {
  const text = $("body").text();
  const match = text.match(/Exibindo\s+(\d+)\s+de\s+(\d+)\s+de\s+um\s+total/i);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]) };
}

function parsePaginationForm($: cheerio.CheerioAPI, baseUrl: string): PaginationForm | null {
  const form = $("form").filter((_, el) => {
    return $(el).find("input[name='dadosfilter']").length > 0;
  }).first();

  if (form.length === 0) return null;

  const action = absoluteUrl(form.attr("action") ?? "", baseUrl) ?? baseUrl;
  const dadosfilter = form.find("input[name='dadosfilter']").first().attr("value") ?? "";
  const total = form.find("input[name='total']").first().attr("value") ?? "";
  const ordem = form.find("input[name='ordem']").first().attr("value") ?? null;

  let lastPage = 1;
  form.find("button[name='pagina']").each((_, el) => {
    const value = Number($(el).attr("value") ?? "0");
    if (Number.isFinite(value) && value > lastPage) lastPage = value;
  });

  return { action, dadosfilter, total, ordem, lastPage };
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

    const descricaoFields = parseDescricaoCell(descricaoCell);

    items.push({
      externalId,
      numero,
      ano: parseAnoFromNumero(numero),
      numeroSequencial: parseSequencialFromNumero(numero),
      modalidade: descricaoFields.modalidade,
      dataSessao: descricaoFields.dataSessao,
      horaSessao: descricaoFields.horaSessao,
      valorEstimadoCentavos: descricaoFields.valorEstimadoCentavos,
      situacao: nullIfEmpty(situacao),
      objeto: nullIfEmpty(objeto),
      detailUrl,
      rawDescricao: nullIfEmpty(descricaoCell.text()),
    });
  });

  return items;
}

type DescricaoFields = {
  modalidade: string | null;
  dataSessao: string | null;
  horaSessao: string | null;
  valorEstimadoCentavos: bigint | null;
};

function parseDescricaoCell($cell: cheerio.Cheerio<any>): DescricaoFields {
  const fields: Record<string, string> = {};

  $cell.find("strong").each((_, strongEl) => {
    const cheerioApi = ($cell as any).constructor;
    void cheerioApi;
    const label = cleanWhitespace($cell.find(strongEl).text()).replace(/:\s*$/, "");
    let value = "";
    let node: any = (strongEl as any).nextSibling;
    while (node) {
      if (node.type === "text") {
        value += node.data ?? "";
      } else if (node.name === "br") {
        break;
      } else if (node.name === "strong") {
        break;
      } else if (node.children) {
        for (const child of node.children) {
          if (child.type === "text") value += child.data ?? "";
        }
      }
      node = node.next ?? null;
    }
    if (label) fields[label.toLowerCase()] = cleanWhitespace(value);
  });

  return {
    modalidade: nullIfEmpty(fields["modalidade"]),
    dataSessao: parseBRDate(fields["data"]),
    horaSessao: parseBRTime(fields["hora"]),
    valorEstimadoCentavos: parseBRMoney(fields["valor estimado"]),
  };
}
