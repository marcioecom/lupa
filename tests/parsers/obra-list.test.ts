import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseObraList } from "../../src/scraper/parsers/obra-list";

const fixtureHtml = readFileSync(
  resolve(__dirname, "../fixtures/obra-list.html"),
  "utf-8",
);
const baseUrl = "https://transparencia.tceto.tc.br";

describe("parseObraList - real fixture", () => {
  const page = parseObraList(fixtureHtml, baseUrl);

  it("extracts the source last update date", () => {
    expect(page.sourceLastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("extracts the total records count", () => {
    expect(page.totalRecords).toBe(14);
  });

  it("extracts the pagination form even with single page", () => {
    expect(page.paginationForm).not.toBeNull();
    expect(page.paginationForm!.total).toBe("14");
    expect(page.paginationForm!.action).toMatch(/\/obraseservicosdeengenharia$/);
  });

  it("extracts all 14 items", () => {
    expect(page.items).toHaveLength(14);
  });

  it("uses contratoExternalId as the obra externalId (1:1 with contratos)", () => {
    const ids = page.items.map((i) => i.externalId);
    const unique = new Set(ids);
    expect(unique.size).toBe(14);
    for (const item of page.items) {
      expect(item.externalId).toBe(item.contratoExternalId);
      expect(item.contratoUrl).toMatch(/^https:\/\/transparencia\.tceto\.tc\.br\/contrato\/details\/\d+$/);
    }
  });

  it("first item has all listing fields populated correctly", () => {
    const first = page.items[0];
    expect(first.ano).toBe(2024);
    expect(first.descricaoIntervencao).toMatch(/ares-condicionados/);
    expect(first.descricaoBem).toBe("Edificio do Instituto de Contas");
    expect(first.empresa).toBe("CONFORTLINE ENGENHARIA TERMICA LTDA");
    expect(first.dataInicio).toBe("2024-07-05");
    expect(first.previsaoTermino).toBe("2024-09-23");
    expect(first.valorIntervencaoCentavos).toBe(43987905n);
    expect(first.valorContratoCentavos).toBe(43987905n);
    expect(first.valorAditivoCentavos).toBe(0n);
    expect(first.situacao).toBe("Recebimento Definitivo");
    expect(first.medicoesPercentual).toBe("100.00");
    expect(first.contratoExternalId).toBe("4041");
  });

  it("parses partial-progress percentage (54,71 %)", () => {
    const item = page.items.find((i) => i.contratoExternalId === "4027");
    expect(item?.medicoesPercentual).toBe("54.71");
  });

  it("parses non-zero valor aditivo (131.840,55)", () => {
    const item = page.items.find((i) => i.contratoExternalId === "4027");
    expect(item?.valorAditivoCentavos).toBe(13184055n);
  });
});
