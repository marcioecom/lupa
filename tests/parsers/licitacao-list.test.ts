import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLicitacaoList } from "../../src/scraper/parsers/licitacao-list";

const fixtureHtml = readFileSync(
  resolve(__dirname, "../fixtures/licitacao-list.html"),
  "utf-8",
);
const baseUrl = "https://transparencia.tceto.tc.br";

describe("parseLicitacaoList - real fixture", () => {
  const page = parseLicitacaoList(fixtureHtml, baseUrl);

  it("extracts the source last update date", () => {
    expect(page.sourceLastUpdate).toBe("2026-05-04");
  });

  it("extracts the total records count from the hidden form input", () => {
    expect(page.totalRecords).toBe(670);
  });

  it("extracts the current range (1..20)", () => {
    expect(page.currentRangeStart).toBe(1);
    expect(page.currentRangeEnd).toBe(20);
  });

  it("extracts the pagination form with dadosfilter and last page", () => {
    expect(page.paginationForm).not.toBeNull();
    expect(page.paginationForm!.dadosfilter.length).toBeGreaterThan(0);
    expect(page.paginationForm!.total).toBe("670");
    expect(page.paginationForm!.lastPage).toBe(34);
    expect(page.paginationForm!.action).toBe("https://transparencia.tceto.tc.br/licitacao");
  });

  it("extracts 20 items on page 1", () => {
    expect(page.items).toHaveLength(20);
  });

  it("first item matches the visible page 1 header (005/2026)", () => {
    const first = page.items[0];
    expect(first.numero).toBe("005/2026");
    expect(first.ano).toBe(2026);
    expect(first.numeroSequencial).toBe(5);
    expect(first.modalidade).toBe("Pregão Eletrônico");
    expect(first.dataSessao).toBe("2026-05-21");
    expect(first.horaSessao).toBe("10:00:00");
    expect(first.valorEstimadoCentavos).toBe(34500791n);
    expect(first.situacao).toBe("Andamento");
    expect(first.externalId).toBe("3730");
    expect(first.detailUrl).toBe("https://transparencia.tceto.tc.br/licitacao/details/3730");
    expect(first.objeto).toMatch(/manutenção preventiva/);
  });

  it("parses a value with thousands separator (004/2026 = 2.500.000,00)", () => {
    const item = page.items.find((i) => i.numero === "004/2026");
    expect(item?.valorEstimadoCentavos).toBe(250000000n);
  });

  it("parses Pregão Eletrônico - SRP modalidade variant", () => {
    const item = page.items.find((i) => i.numero === "003/2026");
    expect(item?.modalidade).toBe("Pregão Eletrônico - SRP");
  });

  it("captures Realizada situacao", () => {
    const realizada = page.items.filter((i) => i.situacao === "Realizada");
    expect(realizada.length).toBeGreaterThan(0);
  });

  it("all items have non-null externalId, numero and detailUrl", () => {
    for (const item of page.items) {
      expect(item.externalId).toBeTruthy();
      expect(item.numero).toBeTruthy();
      expect(item.detailUrl).toMatch(/^https:\/\/transparencia\.tceto\.tc\.br\/licitacao\/details\/\d+$/);
    }
  });
});
