/**
 * rc6 ingestion adapters — the shared contract. Read-only: an adapter only parses what a source delivers; it never
 * holds, sends, converts or settles money or tokens, and it holds no keys.
 *
 * Every adapter reads one or more SOURCES (a file, a page, one chain query). The contract, exercised for every adapter
 * by tests/clearline/merchant/adapter-conformance.test.ts:
 *  - a source that throws (a timeout, a refused connection) is reported as `source_failed` and the others continue;
 *  - a malformed item is rejected with its row number and a reason, and the other items continue;
 *  - an exact duplicate is accepted once and listed in `duplicates`; a conflicting duplicate (same key, different
 *    content) is rejected for every copy, because the adapter cannot know which copy is right;
 *  - delivery order never matters: accepted items are returned in canonical key order.
 */
import { ZodError } from "zod";
import { TEST_MODE_LABEL, type TestModeLabel } from "../types";

export interface AdapterSource<Raw = unknown> { id: string; read: () => Raw | Promise<Raw> }

export type ItemErrorCode = "source_failed" | "malformed" | "invalid" | "duplicate_conflict";
export interface ItemError { source: string; row: number | null; code: ItemErrorCode; reason: string }
export interface Duplicate { source: string; row: number; key: string }

export interface AdapterResult<T> {
  label: TestModeLabel;
  accepted: T[];
  duplicates: Duplicate[];
  errors: ItemError[];
  sources: { id: string; ok: boolean; items: number }[];
}

/** One raw item of a source, with its 1-based row (CSV: the physical line, header = 1; JSON: the array index + 1). */
export interface RawItem { source: string; row: number; value: unknown }

/** Thrown by a parser for an item it rejects; the message is the reason shown to the person importing. */
export class RowError extends Error {}

/** JSON with sorted keys and BigInt as decimal strings: two items are "the same" only if this is equal. */
export function stableJson(v: unknown): string {
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function reasonOf(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`).join("; ");
  return e instanceof Error ? e.message : String(e);
}

export function emptyResult<T>(): AdapterResult<T> { return { label: TEST_MODE_LABEL, accepted: [], duplicates: [], errors: [], sources: [] }; }

/**
 * Read every source, explode each into raw items, parse each item, then de-duplicate by key and sort. Nothing a
 * source or an item does can stop another source or item.
 */
export async function collect<T>(
  sources: readonly AdapterSource[],
  explode: (raw: unknown, sourceId: string) => { items: RawItem[]; errors?: ItemError[] },
  parse: (item: RawItem) => T,
  key: (value: T) => string,
): Promise<AdapterResult<T>> {
  const out = emptyResult<T>();
  const parsed: { item: RawItem; value: T; key: string }[] = [];
  for (const s of sources) {
    let raw: unknown;
    try { raw = await s.read(); } catch (e) {
      out.errors.push({ source: s.id, row: null, code: "source_failed", reason: `Source ${s.id} failed: ${reasonOf(e)}` });
      out.sources.push({ id: s.id, ok: false, items: 0 });
      continue;
    }
    let items: RawItem[];
    try {
      const x = explode(raw, s.id);
      items = x.items;
      out.errors.push(...(x.errors ?? []));
    } catch (e) {
      out.errors.push({ source: s.id, row: null, code: "malformed", reason: `Source ${s.id} is unreadable: ${reasonOf(e)}` });
      out.sources.push({ id: s.id, ok: false, items: 0 });
      continue;
    }
    out.sources.push({ id: s.id, ok: true, items: items.length });
    for (const item of items) {
      try {
        const value = parse(item);
        parsed.push({ item, value, key: key(value) });
      } catch (e) {
        out.errors.push({ source: item.source, row: item.row, code: e instanceof RowError || e instanceof ZodError ? "invalid" : "malformed", reason: reasonOf(e) });
      }
    }
  }
  const byKey = new Map<string, typeof parsed>();
  for (const p of parsed) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  for (const [k, group] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const first = stableJson(group[0].value);
    if (group.some((g) => stableJson(g.value) !== first)) {
      for (const g of group) out.errors.push({ source: g.item.source, row: g.item.row, code: "duplicate_conflict", reason: `${k} is delivered ${group.length} times with different content; none of the copies is used.` });
      continue;
    }
    out.accepted.push(group[0].value);
    for (const g of group.slice(1)) out.duplicates.push({ source: g.item.source, row: g.item.row, key: k });
  }
  out.errors.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : (a.row ?? 0) - (b.row ?? 0)));
  return out;
}

/** A JSON source: an array of items, or an object holding the array under `field`. */
export function jsonItems(raw: unknown, sourceId: string, field?: string): RawItem[] {
  const arr = Array.isArray(raw) ? raw : field && raw && typeof raw === "object" ? (raw as Record<string, unknown>)[field] : undefined;
  if (!Array.isArray(arr)) throw new RowError(field ? `expected an array or an object with "${field}"` : "expected an array");
  return arr.map((value, i) => ({ source: sourceId, row: i + 1, value }));
}

const DECIMAL = /^(\d{1,30})(?:\.(\d{1,36}))?$/;
/** "999.5" with 6 decimals → 999500000n. More decimals than the asset has, a sign or an exponent is refused. */
export function toUnits(text: string, decimals: number, what = "amount"): bigint {
  const m = DECIMAL.exec(text);
  if (!m) throw new RowError(`${what} ${JSON.stringify(text)} is not a plain positive decimal`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new RowError(`${what} ${text} has more than ${decimals} decimals`);
  return BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** 135000n with 2 decimals → "1350.00". */
export function fromUnits(units: bigint, decimals: number): string {
  const neg = units < 0n;
  const s = (neg ? -units : units).toString().padStart(decimals + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, s.length - decimals)}${decimals ? "." + s.slice(s.length - decimals) : ""}`;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** An ISO-8601 UTC instant, normalised to milliseconds ("2026-11-24T02:00:00.000Z"). */
export function isoInstant(text: string, what = "timestamp"): string {
  if (!ISO.test(text) || !Number.isFinite(Date.parse(text))) throw new RowError(`${what} ${JSON.stringify(text)} is not an ISO-8601 UTC instant`);
  return new Date(Date.parse(text)).toISOString();
}
