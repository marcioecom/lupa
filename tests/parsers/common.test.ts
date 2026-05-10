import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  canonicalize,
  contentHash,
  extractIdFromDetailUrl,
  formatBRMoney,
  parseAnoFromNumero,
  parseBRDate,
  parseBRMoney,
  parseBRTime,
  parsePercentage,
  parseSequencialFromNumero,
} from "../../src/scraper/parsers/common";

describe("parseBRMoney", () => {
  it("parses thousand-dot + comma-decimal", () => {
    expect(parseBRMoney("3.761.965,56")).toBe(376196556n);
    expect(parseBRMoney("345.007,91")).toBe(34500791n);
    expect(parseBRMoney("46.800,00")).toBe(4680000n);
    expect(parseBRMoney("128.810,04")).toBe(12881004n);
  });

  it("parses with currency prefix and surrounding whitespace", () => {
    expect(parseBRMoney("  R$ 1.234,56  ")).toBe(123456n);
    expect(parseBRMoney("R$2.500.000,00")).toBe(250000000n);
  });

  it("parses integer-only values (no separators)", () => {
    expect(parseBRMoney("100")).toBe(10000n);
    expect(parseBRMoney("0")).toBe(0n);
  });

  it("parses values with only comma decimal (no thousand sep)", () => {
    expect(parseBRMoney("1234,56")).toBe(123456n);
    expect(parseBRMoney("0,99")).toBe(99n);
  });

  it("handles negative values", () => {
    expect(parseBRMoney("-1.000,00")).toBe(-100000n);
  });

  it("returns null for empty/garbage input", () => {
    expect(parseBRMoney("")).toBe(null);
    expect(parseBRMoney(null)).toBe(null);
    expect(parseBRMoney(undefined)).toBe(null);
    expect(parseBRMoney("   ")).toBe(null);
    expect(parseBRMoney("abc")).toBe(null);
  });

  it("truncates fractional part beyond 2 digits", () => {
    expect(parseBRMoney("1,2345")).toBe(123n);
  });
});

describe("formatBRMoney", () => {
  it("round-trips parseBRMoney for canonical values", () => {
    expect(formatBRMoney(376196556n)).toBe("3.761.965,56");
    expect(formatBRMoney(99n)).toBe("0,99");
    expect(formatBRMoney(100n)).toBe("1,00");
    expect(formatBRMoney(0n)).toBe("0,00");
  });
  it("handles negatives", () => {
    expect(formatBRMoney(-100n)).toBe("-1,00");
  });
  it("returns null for null/undefined", () => {
    expect(formatBRMoney(null)).toBe(null);
    expect(formatBRMoney(undefined)).toBe(null);
  });
});

describe("parseBRDate", () => {
  it("converts dd/mm/yyyy to ISO", () => {
    expect(parseBRDate("21/05/2026")).toBe("2026-05-21");
    expect(parseBRDate("05/02/2026")).toBe("2026-02-05");
    expect(parseBRDate("12/01/2026")).toBe("2026-01-12");
  });

  it("pads single-digit components", () => {
    expect(parseBRDate("1/2/2026")).toBe("2026-02-01");
  });

  it("rejects invalid month/day", () => {
    expect(parseBRDate("32/01/2026")).toBe(null);
    expect(parseBRDate("01/13/2026")).toBe(null);
    expect(parseBRDate("00/00/2026")).toBe(null);
  });

  it("rejects malformed inputs", () => {
    expect(parseBRDate("")).toBe(null);
    expect(parseBRDate("2026-05-21")).toBe(null);
    expect(parseBRDate("21/05/26")).toBe(null);
    expect(parseBRDate(null)).toBe(null);
  });
});

describe("parseBRTime", () => {
  it("normalizes hh:mm:ss", () => {
    expect(parseBRTime("10:00:00")).toBe("10:00:00");
    expect(parseBRTime("08:00:00")).toBe("08:00:00");
  });
  it("accepts hh:mm without seconds", () => {
    expect(parseBRTime("10:00")).toBe("10:00:00");
  });
  it("rejects invalid time", () => {
    expect(parseBRTime("25:00:00")).toBe(null);
    expect(parseBRTime("10:60:00")).toBe(null);
    expect(parseBRTime("foo")).toBe(null);
    expect(parseBRTime("")).toBe(null);
  });
});

describe("parsePercentage", () => {
  it("parses common percent strings to numeric(5,2) format", () => {
    expect(parsePercentage("100,00 %")).toBe("100.00");
    expect(parsePercentage("75.45%")).toBe("75.45");
    expect(parsePercentage("54,71 %")).toBe("54.71");
    expect(parsePercentage("0%")).toBe("0.00");
    expect(parsePercentage("0,00 %")).toBe("0.00");
  });
  it("accepts integer-only percent without decimals", () => {
    expect(parsePercentage("75%")).toBe("75.00");
    expect(parsePercentage("100")).toBe("100.00");
  });
  it("truncates fractional beyond 2 digits", () => {
    expect(parsePercentage("12,3456%")).toBe("12.34");
  });
  it("returns null for empty/garbage", () => {
    expect(parsePercentage("")).toBe(null);
    expect(parsePercentage(null)).toBe(null);
    expect(parsePercentage(undefined)).toBe(null);
    expect(parsePercentage("abc")).toBe(null);
  });
});

describe("parseAnoFromNumero / parseSequencialFromNumero", () => {
  it("extracts year and sequence from numero", () => {
    expect(parseAnoFromNumero("005/2026")).toBe(2026);
    expect(parseSequencialFromNumero("005/2026")).toBe(5);
    expect(parseSequencialFromNumero("014/2025")).toBe(14);
  });
  it("returns null for malformed numero", () => {
    expect(parseAnoFromNumero("")).toBe(null);
    expect(parseSequencialFromNumero("abc")).toBe(null);
  });
});

describe("extractIdFromDetailUrl", () => {
  it("extracts numeric id", () => {
    expect(extractIdFromDetailUrl("/licitacao/details/12345")).toBe("12345");
    expect(extractIdFromDetailUrl("https://transparencia.tceto.tc.br/licitacao/details/999"))
      .toBe("999");
  });
  it("works with /detail/ singular variant", () => {
    expect(extractIdFromDetailUrl("/contrato/detail/42")).toBe("42");
  });
  it("returns null when path lacks the segment", () => {
    expect(extractIdFromDetailUrl("/licitacao")).toBe(null);
    expect(extractIdFromDetailUrl(null)).toBe(null);
  });
});

describe("absoluteUrl", () => {
  it("resolves relative URLs against a base", () => {
    expect(absoluteUrl("/licitacao/details/1", "https://transparencia.tceto.tc.br")).toBe(
      "https://transparencia.tceto.tc.br/licitacao/details/1",
    );
  });
  it("preserves already absolute URLs", () => {
    expect(absoluteUrl("https://example.com/x", "https://transparencia.tceto.tc.br")).toBe(
      "https://example.com/x",
    );
  });
  it("returns null for empty input", () => {
    expect(absoluteUrl(null, "https://x.com")).toBe(null);
    expect(absoluteUrl("", "https://x.com")).toBe(null);
  });
});

describe("canonicalize / contentHash", () => {
  it("is order-independent for object keys", () => {
    const a = canonicalize({ b: 1, a: 2 });
    const b = canonicalize({ a: 2, b: 1 });
    expect(a).toBe(b);
  });
  it("produces stable hash for same content", () => {
    const h1 = contentHash({ numero: "005/2026", valor: 100n });
    const h2 = contentHash({ valor: 100n, numero: "005/2026" });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });
  it("differs when content changes", () => {
    expect(contentHash({ x: 1 })).not.toBe(contentHash({ x: 2 }));
  });
  it("encodes bigint distinctly from number", () => {
    expect(canonicalize(1n)).not.toBe(canonicalize(1));
  });
});
