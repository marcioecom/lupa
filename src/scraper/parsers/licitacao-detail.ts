import * as cheerio from "cheerio";
import {
  absoluteUrl,
  cleanWhitespace,
  nullIfEmpty,
  parseBRDate,
  parseBRMoney,
  parseBRTime,
} from "./common";

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

  const situacao = dl.get("situação") ?? dl.get("situacao") ?? null;
  const dataDisponibilizacao = parseBRDate(
    dl.get("data de disponibilização deste arquivo no site") ??
      dl.get("data de disponibilizacao deste arquivo no site"),
  );
  const numeroProcessoInterno = dl.get("número processo interno") ?? dl.get("numero processo interno") ?? null;
  const dataSessao = parseBRDate(dl.get("data da sessão") ?? dl.get("data da sessao"));
  const horaSessao = parseBRTime(dl.get("horário da sessão") ?? dl.get("horario da sessao"));
  const localSessao = dl.get("local da sessão") ?? dl.get("local da sessao") ?? null;
  const observacao = dl.get("observação") ?? dl.get("observacao") ?? null;
  const objeto = dl.get("objeto") ?? null;

  const editalAnchor = $("a")
    .filter((_, a) => /Baixe o Edital/i.test($(a).text()))
    .first();
  const editalPdfUrl = absoluteUrl(editalAnchor.attr("href") ?? null, baseUrl);

  return {
    modalidadeFromTitle,
    numeroFromTitle,
    situacao: nullIfEmpty(situacao),
    dataDisponibilizacao,
    numeroProcessoInterno: nullIfEmpty(numeroProcessoInterno),
    dataSessao,
    horaSessao,
    localSessao: nullIfEmpty(localSessao),
    observacao: nullIfEmpty(observacao),
    objeto: nullIfEmpty(objeto),
    editalPdfUrl,
  };
}

function collectDlPairs($: cheerio.CheerioAPI): Map<string, string> {
  const map = new Map<string, string>();
  $("dl").each((_, dlEl) => {
    let currentKey: string | null = null;
    $(dlEl)
      .children()
      .each((_, child) => {
        const tag = (child as any).name;
        const text = cleanWhitespace($(child).text()).replace(/:\s*$/, "");
        if (tag === "dt") {
          currentKey = text.toLowerCase();
        } else if (tag === "dd" && currentKey) {
          if (!map.has(currentKey)) map.set(currentKey, text);
          currentKey = null;
        }
      });
  });
  return map;
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
  if (tab.find(".alert").length > 0 && tab.find("table").length === 0) return items;

  const headers = readHeaders($, tab);

  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td").map((_, c) => cleanWhitespace($(c).text())).get() as string[];
    if (cells.length === 0) return;
    const raw = zipHeadersValues(headers, cells);
    const razaoSocial = pick(raw, ["empresa", "razão social", "razao social"]);
    const cnpj = pick(raw, ["cpf / cnpj", "cnpj", "cpf/cnpj"]);
    const status = pick(raw, ["status"]);
    const vencedora = pick(raw, ["vencedora(s)", "vencedora"]);
    const valor = pick(raw, ["valor", "valor da proposta", "valor proposta"]);

    items.push({
      razaoSocial,
      cnpj,
      situacao: status,
      classificacao: vencedora && /sim/i.test(vencedora) ? "Vencedora" : null,
      valorPropostaCentavos: parseBRMoney(valor),
      rawData: raw,
    });
  });
  return items;
}

function parseContratosAtas($: cheerio.CheerioAPI, baseUrl: string): LicitacaoDetailContratoAta[] {
  const items: LicitacaoDetailContratoAta[] = [];
  const tab = $("#tab_default_3");
  if (tab.find(".alert").length > 0 && tab.find("table").length === 0) return items;

  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td");
    if (cells.length < 3) return;
    const numero = nullIfEmpty(cells.eq(0).text());
    const descricaoCell = cells.eq(1);
    const status = nullIfEmpty(cells.eq(2).text());
    const link = cells.eq(3).find("a[href]").first();
    const href = link.attr("href") ?? null;

    const fields = parseLabeledFields(descricaoCell);
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
      rawData: {
        ...fields,
        status: status ?? null,
      },
    });
  });
  return items;
}

function parsePregoeiros($: cheerio.CheerioAPI): LicitacaoDetailPregoeiro[] {
  const items: LicitacaoDetailPregoeiro[] = [];
  const tab = $("#tab_default_4");
  if (tab.find(".alert").length > 0 && tab.find("table").length === 0) return items;

  const headers = readHeaders($, tab);

  tab.find("table tbody tr").each((_, row) => {
    const cells = $(row).find("> td").map((_, c) => cleanWhitespace($(c).text())).get() as string[];
    if (cells.length === 0) return;
    const raw = zipHeadersValues(headers, cells);
    items.push({
      nome: pick(raw, ["nome"]),
      cpf: pick(raw, ["cpf"]),
      funcao: pick(raw, ["função", "funcao", "cargo"]),
      rawData: raw,
    });
  });
  return items;
}

function readHeaders($: cheerio.CheerioAPI, tab: cheerio.Cheerio<any>): string[] {
  return tab.find("table thead th").map((_, th) => cleanWhitespace($(th).text()).toLowerCase()).get() as string[];
}

function zipHeadersValues(headers: string[], values: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < Math.max(headers.length, values.length); i++) {
    const key = headers[i] ?? `col_${i}`;
    out[key] = nullIfEmpty(values[i] ?? null);
  }
  return out;
}

function pick(raw: Record<string, string | null>, keys: string[]): string | null {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k];
  }
  return null;
}

function parseLabeledFields($cell: cheerio.Cheerio<any>): Record<string, string> {
  const out: Record<string, string> = {};
  $cell.find("strong").each((_, strongEl) => {
    const label = cleanWhitespace(($cell as any).find(strongEl).text()).replace(/:\s*$/, "").toLowerCase();
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
