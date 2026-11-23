/** Formatting helpers shared by the synthetic file writers. Pure; no clock, no locale lookups. */
import { partsAt, ms } from "../time";

const abs = (x: bigint) => (x < 0n ? -x : x);

function split(units: bigint, decimals: number): { neg: boolean; whole: string; frac: string } {
  const digits = abs(units).toString().padStart(decimals + 1, "0");
  return { neg: units < 0n, whole: digits.slice(0, digits.length - decimals), frac: digits.slice(digits.length - decimals) };
}

/** 1350.00 style, or with separators: (135000n, { group: ",", decimal: "." }) → "1,350.00". */
export function decimal(units: bigint, decimals: number, opts: { group?: string; decimal?: string; minFrac?: number } = {}): string {
  const { neg, whole, frac } = split(units, decimals);
  let f = frac;
  const minFrac = opts.minFrac ?? decimals;
  while (f.length > minFrac && f.endsWith("0")) f = f.slice(0, -1);
  const w = opts.group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, opts.group) : whole;
  return `${neg ? "-" : ""}${w}${f ? (opts.decimal ?? ".") + f : ""}`;
}

export const minorPlain = (m: bigint): string => decimal(m, 2);
export const minorGrouped = (m: bigint): string => decimal(m, 2, { group: "," });
export const unitsPlain = (u: bigint): string => decimal(u, 6);
export const unitsGrouped = (u: bigint): string => decimal(u, 6, { group: ",", minFrac: 2 });
/** A JS number for a spreadsheet cell (display only; the exact value is the decimal string). */
export const toNumber = (units: bigint, decimals: number): number => Number(decimal(units, decimals));

/** RFC 4180 field quoting for a given delimiter. */
export function csvField(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
export function csv(rows: readonly (readonly string[])[], delimiter = ",", eol = "\r\n"): string {
  return rows.map((r) => r.map((v) => csvField(v, delimiter)).join(delimiter)).join(eol) + eol;
}

export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);
export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** DD/MM/YYYY HH:mm at a fixed offset. */
export function ddmmyyyyHHmm(isoInstant: string, offsetMinutes: number): string {
  const p = partsAt(ms(isoInstant), offsetMinutes);
  return `${p.dd}/${p.mm}/${p.yyyy} ${p.HH}:${p.MI}`;
}
/** MM/DD/YYYY at a fixed offset. */
export function mmddyyyy(isoInstant: string, offsetMinutes: number): string {
  const p = partsAt(ms(isoInstant), offsetMinutes);
  return `${p.mm}/${p.dd}/${p.yyyy}`;
}
/** YYYY-MM-DD → DD.MM.YYYY */
export const dotted = (date: string): string => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
/** YYYY-MM-DD → YYMMDD */
export const yymmdd = (date: string): string => date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);

export const xmlEscape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Stable JSON with bigint rendered as strings (writers pass strings anyway). */
export const json = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n";
