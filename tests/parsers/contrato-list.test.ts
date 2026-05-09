import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseContratoList } from "../../src/scraper/parsers/contrato-list";

const fixtureHtml = readFileSync(
  resolve(__dirname, "../fixtures/contrato-list.html"),
  "utf-8",
);
const baseUrl = "https://transparencia.tceto.tc.br";

describe("parseContratoList - real fixture", () => {
  const page = parseContratoList(fixtureHtml, baseUrl);

  it("extracts the source last update date", () => {
    expect(page.sourceLastUpdate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("extracts the total records count", () => {
    expect(page.totalRecords).toBe(1191);
  });

  it("extracts the pagination form with dadosfilter and last page", () => {
    expect(page.paginationForm).not.toBeNull();
    expect(page.paginationForm!.total).toBe("1191");
    expect(page.paginationForm!.lastPage).toBeGreaterThan(1);
    expect(page.paginationForm!.action).toMatch(/^https:\/\/transparencia\.tceto\.tc\.br\/contrato/);
  });

  it("extracts 20 items on page 1", () => {
    expect(page.items).toHaveLength(20);
  });

  it("first item has all listing fields populated (027/2026)", () => {
    const first = page.items[0];
    expect(first.numero).toBe("027/2026");
    expect(first.ano).toBe(2026);
    expect(first.numeroSequencial).toBe(27);
    expect(first.unidadeGestora).toBe("TRIBUNAL DE CONTAS DO ESTADO DO TOCANTINS");
    expect(first.modalidade).toBe("DISPENSA DE LICITAÇÃO");
    expect(first.finalidade).toBe("CONTRATAÇÃO");
    expect(first.objeto).toMatch(/manutenção preventiva/);
    expect(first.vigenciaFim).toBe("2027-04-29");
    expect(first.valorCentavos).toBe(5300000n);
    expect(first.situacao).toBe("VIGENTE");
    expect(first.externalId).toBe("10262");
    expect(first.detailUrl).toBe("https://transparencia.tceto.tc.br/contrato/details/10262");
  });

  it("parses thousand-separator value (024/2026 = 2.500.000,00)", () => {
    const item = page.items.find((i) => i.numero === "024/2026");
    expect(item?.valorCentavos).toBe(250000000n);
    expect(item?.modalidade).toBe("PREGÃO ELETRÔNICO");
  });

  it("parses INEXIGIBILIDADE modalidade variant", () => {
    const item = page.items.find((i) => i.numero === "025/2026");
    expect(item?.modalidade).toBe("INEXIGIBILIDADE");
  });

  it("all items have non-null externalId, numero and detailUrl matching pattern", () => {
    for (const item of page.items) {
      expect(item.externalId).toBeTruthy();
      expect(item.numero).toMatch(/^\d{3}\/\d{4}$/);
      expect(item.detailUrl).toMatch(/^https:\/\/transparencia\.tceto\.tc\.br\/contrato\/details\/\d+$/);
    }
  });
});
