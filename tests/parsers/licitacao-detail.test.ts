import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLicitacaoDetail } from "../../src/scraper/parsers/licitacao-detail";

const baseUrl = "https://transparencia.tceto.tc.br";
const andamentoHtml = readFileSync(resolve(__dirname, "../fixtures/licitacao-detail.html"), "utf-8");
const realizadaHtml = readFileSync(
  resolve(__dirname, "../fixtures/licitacao-detail-realizada.html"),
  "utf-8",
);

describe("parseLicitacaoDetail - andamento (3730)", () => {
  const detail = parseLicitacaoDetail(andamentoHtml, baseUrl);

  it("parses header fields", () => {
    expect(detail.header.modalidadeFromTitle).toBe("Pregão Eletrônico");
    expect(detail.header.numeroFromTitle).toBe("005/2026");
    expect(detail.header.situacao).toBe("Andamento");
    expect(detail.header.dataDisponibilizacao).toBe("2026-05-05");
    expect(detail.header.numeroProcessoInterno).toBe("26.000880-0");
    expect(detail.header.dataSessao).toBe("2026-05-21");
    expect(detail.header.horaSessao).toBe("10:00:00");
    expect(detail.header.localSessao).toBe("Comprasnet");
    expect(detail.header.observacao).toMatch(/site oficial do TCE\/TO/);
    expect(detail.header.objeto).toMatch(/manutenção preventiva/);
    expect(detail.header.editalPdfUrl).toBe(
      "https://transparencia.tceto.tc.br/licitacao/download/MzczMA==",
    );
  });

  it("parses documentos rows", () => {
    expect(detail.documentos.length).toBeGreaterThan(0);
    const first = detail.documentos[0];
    expect(first.numero).toBe("012/2026");
    expect(first.descricao).toBe("Jornal");
    expect(first.data).toBe("2026-05-06");
    expect(first.tipo).toBe("Publicação");
    expect(first.documentoUrl).toMatch(/^https:\/\/transparencia\.tceto\.tc\.br\/documento\/download\//);
  });

  it("returns no empresas when tab is empty", () => {
    expect(detail.empresas).toEqual([]);
  });

  it("returns no contratos/atas when tab is empty", () => {
    expect(detail.contratosAtas).toEqual([]);
  });

  it("parses pregoeiros with masked CPF", () => {
    expect(detail.pregoeiros.length).toBeGreaterThan(0);
    const p = detail.pregoeiros[0];
    expect(p.nome).toBe("MARINES BARBOZA LIMA SILVA");
    expect(p.cpf).toBe("***.755.951-**");
  });
});

describe("parseLicitacaoDetail - realizada (3725)", () => {
  const detail = parseLicitacaoDetail(realizadaHtml, baseUrl);

  it("parses empresas with CNPJ and Vencedora flag", () => {
    expect(detail.empresas.length).toBe(4);
    const winner = detail.empresas.find((e) => e.classificacao === "Vencedora");
    expect(winner).toBeDefined();
    expect(winner!.razaoSocial).toBe("SERVIX INFORMÁTICA LTDA");
    expect(winner!.cnpj).toBe("01134191000147");
    expect(winner!.situacao).toBe("Participante");
  });

  it("non-winners have null classificacao but Participante status", () => {
    const losers = detail.empresas.filter((e) => e.classificacao === null);
    expect(losers.length).toBe(3);
    for (const l of losers) {
      expect(l.situacao).toBe("Participante");
      expect(l.cnpj).toMatch(/^\d{14}$/);
    }
  });

  it("parses contratos/atas tab with 2 rows distinguishing tipo by URL", () => {
    expect(detail.contratosAtas).toHaveLength(2);
    const ata = detail.contratosAtas.find((c) => c.tipo === "Ata");
    const contrato = detail.contratosAtas.find((c) => c.tipo === "Contrato");
    expect(ata).toBeDefined();
    expect(contrato).toBeDefined();
    expect(ata!.numero).toBe("003/2026");
    expect(contrato!.numero).toBe("013/2026");
    expect(ata!.documentoUrl).toMatch(/\/ata\/details\/9243$/);
    expect(contrato!.documentoUrl).toMatch(/\/contrato\/details\/9246$/);
    expect(ata!.rawData.modalidade).toMatch(/SRP/);
    expect(ata!.rawData.status).toBe("VIGENTE");
  });
});
