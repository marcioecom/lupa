import { createHash } from "node:crypto";

export function cleanWhitespace(input: string | null | undefined): string {
  return input ? input.replace(/\s+/g, " ").trim() : "";
}

export function nullIfEmpty(input: string | null | undefined): string | null {
  const cleaned = cleanWhitespace(input);
  return cleaned.length === 0 ? null : cleaned;
}

const MONEY_RE = /^(-?)(\d+)(?:,(\d{1,}))?$/;

export function parseBRMoney(input: string | null | undefined): bigint | null {
  if (!input) return null;
  const m = input.replace(/[^\d,-]/g, "").match(MONEY_RE);
  if (!m) return null;
  const cents = (m[3] ?? "").padEnd(2, "0").slice(0, 2);
  const total = BigInt(m[2]) * 100n + BigInt(cents);
  return m[1] ? -total : total;
}

export function formatBRMoney(cents: bigint | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const integer = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fractional = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${integer},${fractional}`;
}

const DATE_RE = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
const ISO_DATE_VALID_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function parseBRDate(input: string | null | undefined): string | null {
  const m = input?.match(DATE_RE);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return ISO_DATE_VALID_RE.test(iso) ? iso : null;
}

const TIME_RE = /^\s*([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*$/;

export function parseBRTime(input: string | null | undefined): string | null {
  const m = input?.match(TIME_RE);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:${m[3] ?? "00"}` : null;
}

export function parseAnoFromNumero(numero: string | null | undefined): number | null {
  const m = numero?.match(/(\d{4})/);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1900 && year <= 2100 ? year : null;
}

export function parseSequencialFromNumero(numero: string | null | undefined): number | null {
  const m = numero?.match(/^(\d+)\s*\/\s*\d{4}$/);
  return m ? Number(m[1]) : null;
}

export function extractIdFromDetailUrl(url: string | null | undefined): string | null {
  const m = url?.match(/\/details?\/([^/?#]+)/i);
  return m ? m[1] : null;
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
