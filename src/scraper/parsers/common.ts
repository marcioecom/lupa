import { createHash } from "node:crypto";

export function cleanWhitespace(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/\s+/g, " ").trim();
}

export function nullIfEmpty(input: string | null | undefined): string | null {
  const cleaned = cleanWhitespace(input);
  return cleaned.length === 0 ? null : cleaned;
}

export function parseBRMoney(input: string | null | undefined): bigint | null {
  if (!input) return null;
  const cleaned = input.replace(/[^\d,.-]/g, "").trim();
  if (cleaned.length === 0) return null;

  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;

  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");

  let integerPart: string;
  let fractionalPart: string;

  if (lastComma === -1 && lastDot === -1) {
    integerPart = unsigned;
    fractionalPart = "";
  } else if (lastComma > lastDot) {
    integerPart = unsigned.slice(0, lastComma).replace(/[.,]/g, "");
    fractionalPart = unsigned.slice(lastComma + 1);
  } else {
    integerPart = unsigned.slice(0, lastDot).replace(/[.,]/g, "");
    fractionalPart = unsigned.slice(lastDot + 1);
  }

  if (integerPart.length === 0) integerPart = "0";
  if (!/^\d+$/.test(integerPart) || (fractionalPart.length > 0 && !/^\d+$/.test(fractionalPart))) {
    return null;
  }

  const cents = (fractionalPart + "00").slice(0, 2).padEnd(2, "0");
  const totalCents = BigInt(integerPart) * 100n + BigInt(cents);
  return negative ? -totalCents : totalCents;
}

export function formatBRMoney(cents: bigint | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const negative = cents < 0n;
  const absCents = negative ? -cents : cents;
  const integer = absCents / 100n;
  const fractional = absCents % 100n;
  const integerStr = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fractionalStr = fractional.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${integerStr},${fractionalStr}`;
}

export function parseBRDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = cleanWhitespace(input);
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const d = day.padStart(2, "0");
  const m = month.padStart(2, "0");
  const dayN = Number(d);
  const monthN = Number(m);
  if (monthN < 1 || monthN > 12 || dayN < 1 || dayN > 31) return null;
  return `${year}-${m}-${d}`;
}

export function parseBRTime(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = cleanWhitespace(input);
  const match = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, hour, minute, second] = match;
  const h = hour.padStart(2, "0");
  const hN = Number(h);
  const mN = Number(minute);
  const sN = second ? Number(second) : 0;
  if (hN < 0 || hN > 23 || mN < 0 || mN > 59 || sN < 0 || sN > 59) return null;
  return `${h}:${minute}:${(second ?? "00").padStart(2, "0")}`;
}

export function parseAnoFromNumero(numero: string | null | undefined): number | null {
  if (!numero) return null;
  const match = numero.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1900 || year > 2100) return null;
  return year;
}

export function parseSequencialFromNumero(numero: string | null | undefined): number | null {
  if (!numero) return null;
  const match = numero.match(/^(\d+)\s*\/\s*\d{4}$/);
  if (!match) return null;
  return Number(match[1]);
}

export function extractIdFromDetailUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/details?\/([^/?#]+)/i);
  return match ? match[1] : null;
}

export function absoluteUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "bigint") return `bigint:${value.toString()}`;
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contentHash(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
