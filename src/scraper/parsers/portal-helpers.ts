import * as cheerio from "cheerio";
import { absoluteUrl, cleanWhitespace, nullIfEmpty, parseBRDate } from "./common";

export type PaginationForm = {
  action: string;
  dadosfilter: string;
  total: string;
  ordem: string | null;
  lastPage: number;
};

export function parseLastUpdate($: cheerio.CheerioAPI): string | null {
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

export function parseTotalRecords($: cheerio.CheerioAPI): number | null {
  const totalInput = $("input[name='total']").first().attr("value");
  if (totalInput && /^\d+$/.test(totalInput)) {
    return Number(totalInput);
  }
  const text = $("body").text();
  const match = text.match(/total de\s+(\d+)\s+registros/i);
  return match ? Number(match[1]) : null;
}

export function parseCurrentRange($: cheerio.CheerioAPI): { start: number; end: number } | null {
  const text = $("body").text();
  const match = text.match(/Exibindo\s+(\d+)\s+de\s+(\d+)\s+de\s+um\s+total/i);
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]) };
}

export function parsePaginationForm($: cheerio.CheerioAPI, baseUrl: string): PaginationForm | null {
  const form = $("form")
    .filter((_, el) => $(el).find("input[name='dadosfilter']").length > 0)
    .first();

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

export function parseLabeledStrongCell(
  $cell: cheerio.Cheerio<any>,
): Record<string, string> {
  const out: Record<string, string> = {};
  $cell.find("strong").each((_, strongEl) => {
    const label = cleanWhitespace($cell.find(strongEl).text()).replace(/:\s*$/, "").toLowerCase();
    let value = "";
    let node: any = (strongEl as any).nextSibling;
    while (node) {
      if (node.type === "text") value += node.data ?? "";
      else if (node.name === "br" || node.name === "strong") break;
      else if (node.children) for (const c of node.children) if (c.type === "text") value += c.data ?? "";
      node = node.next ?? null;
    }
    if (label) out[label] = cleanWhitespace(value);
  });
  return out;
}

export function collectDlPairs($: cheerio.CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $("dl").each((_, dlEl) => {
    let currentKey: string | null = null;
    $(dlEl)
      .children()
      .each((_, child) => {
        const tag = (child as any).name;
        const raw = cleanWhitespace($(child).text());
        if (tag === "dt") {
          currentKey = raw.replace(/\s*:\s*$/, "").toLowerCase();
        } else if (tag === "dd" && currentKey) {
          if (!map.has(currentKey)) map.set(currentKey, raw);
          currentKey = null;
        }
      });
  });
  return map;
}

export function readTableHeaders(
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<any>,
): string[] {
  return scope
    .find("table thead th")
    .map((_, th) => cleanWhitespace($(th).text()).toLowerCase())
    .get() as string[];
}

export function zipHeadersValues(
  headers: string[],
  values: string[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < Math.max(headers.length, values.length); i++) {
    const key = headers[i] ?? `col_${i}`;
    out[key] = nullIfEmpty(values[i] ?? null);
  }
  return out;
}

export function pickFromRecord(
  raw: Record<string, string | null>,
  keys: string[],
): string | null {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return null;
}

export function isEmptyTab(tab: cheerio.Cheerio<any>): boolean {
  return tab.find(".alert").length > 0 && tab.find("table").length === 0;
}
