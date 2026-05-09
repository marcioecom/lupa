import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseContratoDetail } from "../../src/scraper/parsers/contrato-detail";

const baseUrl = "https://transparencia.tceto.tc.br";
const vigenteHtml = readFileSync(
  resolve(__dirname, "../fixtures/contrato-detail-vigente.html"),
  "utf-8",
);
const licitadoHtml = readFileSync(
  resolve(__dirname, "../fixtures/contrato-detail-licitado.html"),
  "utf-8",
);

describe("parseContratoDetail - vigente sem licitação (10262)", () => {
  const detail = parseContratoDetail(vigenteHtml, baseUrl);

  it("parses header with single-date vigencia (no range)", () => {
    expect(detail.header.numeroFromTitle).toBe("027/2026");
    expect(detail.header.modalidade).toBe("DISPENSA DE LICITAÇÃO");
    expect(detail.header.situacao).toBe("VIGENTE");
    expect(detail.header.unidadeGestora).toBe("TRIBUNAL DE CONTAS DO ESTADO DO TOCANTINS");
    expect(detail.header.finalidade).toBe("CONTRATAÇÃO");
    expect(detail.header.cnpjEmpresa).toMatch(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/);
    expect(detail.header.empresaContratada).toBeTruthy();
    expect(detail.header.objeto).toMatch(/manutenção/);
    expect(detail.header.contratoPdfUrl).toMatch(/\/contrato\/download\//);
  });

  it("does NOT cross-reference a licitacao (DISPENSA)", () => {
    expect(detail.header.licitacaoExternalId).toBeNull();
  });

  it("returns no documentos / aditivos / apostilamentos / pagamentos when tabs are empty", () => {
    expect(detail.documentos).toEqual([]);
    expect(detail.aditivos).toEqual([]);
    expect(detail.apostilamentos).toEqual([]);
    expect(detail.pagamentos).toEqual([]);
  });

  it("parses responsaveis (always populated)", () => {
    expect(detail.responsaveis.length).toBeGreaterThan(0);
    const r = detail.responsaveis[0];
    expect(r.nome).toBeTruthy();
    expect(r.cpf).toMatch(/^\*\*\*/);
    expect(r.funcao).toMatch(/Gestor|Fiscal/);
    if (r.dataInicio) expect(r.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseContratoDetail - licitado (10259)", () => {
  const detail = parseContratoDetail(licitadoHtml, baseUrl);

  it("parses header with vigencia range and R$ value", () => {
    expect(detail.header.numeroFromTitle).toBe("024/2026");
    expect(detail.header.modalidade).toBe("PREGÃO ELETRÔNICO");
    expect(detail.header.empresaContratada).toBe("BRADESCO S.A");
    expect(detail.header.cnpjEmpresa).toBe("60.746.948/0001-12");
    expect(detail.header.vigenciaInicio).toBe("2026-07-08");
    expect(detail.header.vigenciaFim).toBe("2031-07-08");
    expect(detail.header.dataPublicacaoExtrato).toBe("2026-04-24");
    expect(detail.header.valorCentavos).toBe(250000000n);
    expect(detail.header.situacao).toBe("VIGENTE");
    expect(detail.header.fundamentoLegal).toMatch(/PREGÃO ELETRÔNICO/);
  });

  it("captures licitacao cross-reference from edital tab", () => {
    expect(detail.header.licitacaoExternalId).toBe("3728");
  });

  it("parses responsaveis with Gestor + Fiscal roles", () => {
    expect(detail.responsaveis.length).toBeGreaterThanOrEqual(2);
    const funcoes = new Set(detail.responsaveis.map((r) => r.funcao));
    expect(funcoes.has("Gestor")).toBe(true);
    expect(funcoes.has("Fiscal")).toBe(true);
    const gestor = detail.responsaveis.find((r) => r.funcao === "Gestor");
    expect(gestor?.dataInicio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(gestor?.dataFim).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns empty arrays for unpopulated tabs", () => {
    expect(detail.documentos).toEqual([]);
    expect(detail.aditivos).toEqual([]);
    expect(detail.apostilamentos).toEqual([]);
    expect(detail.pagamentos).toEqual([]);
  });
});
