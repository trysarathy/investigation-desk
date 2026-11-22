/**
 * Settlement report adapter. Two shapes (JSON):
 *  - per-payment: { batches: [...], lines: [...] } where every line carries its batch ID → engine SettlementBatch
 *    and SettlementBatchLine;
 *  - totals only: { totals: [...] } with no batch IDs → a grouping marked "needs_confirmation". The adapter never
 *    invents a batch: the engine's proposed-grouping path (M5.grouping.proposed_needs_confirmation) then applies,
 *    and a person must confirm the grouping against the bank line.
 * Amounts are plain decimals in the batch currency. Test mode · illustrative data.
 */
import { z } from "zod";
import { FIAT_DECIMALS } from "../config";
import type { FiatCurrency, SettlementBatch, SettlementBatchLine, TimeZoneRef } from "../types";
import { type AdapterResult, type AdapterSource, type RawItem, RowError, collect, toUnits } from "./common";

const Cur = z.enum(["SGD", "USD", "AED"]);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Tz = z.object({ name: z.string().min(1).max(64), utcOffsetMinutes: z.number().int().min(-840).max(840) }).strict();
const Amt = z.string().min(1).max(40);
const Totals = { currency: Cur, targetBankAccount: z.string().min(1).max(64), gross: Amt, fees: Amt, refunds: Amt, net: Amt };
const BatchRow = z.object({ batchId: z.string().min(1).max(64), providerDay: Day, providerTimeZone: Tz.optional(), ...Totals }).strict();
const LineRow = z.object({
  batchId: z.string().min(1).max(64), kind: z.enum(["payment", "refund"]), providerPaymentId: z.string().min(1).max(64).optional(),
  refundId: z.string().min(1).max(64).optional(), orderId: z.string().min(1).max(64), amount: Amt,
}).strict();
const TotalRow = z.object({ providerDay: Day, providerTimeZone: Tz.optional(), ...Totals }).strict();

const UTC: TimeZoneRef = { name: "UTC", utcOffsetMinutes: 0 };

/** A totals-only settlement: never a batch, only a grouping a person must confirm. */
export interface SettlementTotalsGrouping {
  id: string;
  status: "needs_confirmation";
  providerDay: string;
  providerTimeZone: TimeZoneRef;
  currency: FiatCurrency;
  targetBankAccount: string;
  grossMinor: bigint; feesMinor: bigint; refundsMinor: bigint; netMinor: bigint;
  note: string;
}

export type SettlementItem =
  | { kind: "batch"; batch: SettlementBatch }
  | { kind: "line"; line: SettlementBatchLine }
  | { kind: "totals"; grouping: SettlementTotalsGrouping };

export interface SettlementResult extends AdapterResult<SettlementItem> {
  shape: "per_payment" | "totals_only" | "mixed" | "none";
  batches: SettlementBatch[];
  batchLines: SettlementBatchLine[];
  groupings: SettlementTotalsGrouping[];
}

function amounts(cur: FiatCurrency, r: { gross: string; fees: string; refunds: string; net: string }) {
  const d = FIAT_DECIMALS[cur];
  const a = { grossMinor: toUnits(r.gross, d, "gross"), feesMinor: toUnits(r.fees, d, "fees"), refundsMinor: toUnits(r.refunds, d, "refunds"), netMinor: toUnits(r.net, d, "net") };
  if (a.grossMinor - a.feesMinor - a.refundsMinor !== a.netMinor) throw new RowError(`gross − fees − refunds ≠ net (${r.gross} − ${r.fees} − ${r.refunds} ≠ ${r.net})`);
  return a;
}

interface Tagged { kind: SettlementItem["kind"]; value: unknown }
function explode(raw: unknown, sourceId: string): { items: RawItem[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RowError("a settlement report is an object with batches and lines, or totals");
  const o = raw as Record<string, unknown>;
  const known = ["batches", "lines", "totals", "label", "currency"];
  const extra = Object.keys(o).filter((k) => !known.includes(k));
  if (extra.length) throw new RowError(`unknown fields: ${extra.join(", ")}`);
  if (o.totals !== undefined && (o.batches !== undefined || o.lines !== undefined)) throw new RowError("a report has either batches and lines, or totals, not both");
  const items: RawItem[] = [];
  let row = 0;
  for (const kind of ["batches", "lines", "totals"] as const) {
    if (o[kind] === undefined) continue;
    if (!Array.isArray(o[kind])) throw new RowError(`${kind} must be an array`);
    for (const value of o[kind] as unknown[]) items.push({ source: sourceId, row: ++row, value: { kind: kind === "batches" ? "batch" : kind === "lines" ? "line" : "totals", value } satisfies Tagged });
  }
  return { items };
}

function parse(item: RawItem, lineCurrency: Map<string, FiatCurrency>): SettlementItem {
  const t = item.value as Tagged;
  if (t.kind === "batch") {
    const b = BatchRow.parse(t.value);
    return { kind: "batch", batch: { batchId: b.batchId, providerDay: b.providerDay, providerTimeZone: b.providerTimeZone ?? UTC, currency: b.currency, targetBankAccount: b.targetBankAccount, ...amounts(b.currency, b) } };
  }
  if (t.kind === "line") {
    const l = LineRow.parse(t.value);
    if (l.kind === "payment" && !l.providerPaymentId) throw new RowError("a payment line needs providerPaymentId");
    if (l.kind === "refund" && !l.refundId) throw new RowError("a refund line needs refundId");
    const cur = lineCurrency.get(l.batchId);
    if (!cur) throw new RowError(`line for unknown or rejected batch ${l.batchId}`);
    return { kind: "line", line: { batchId: l.batchId, kind: l.kind, ...(l.providerPaymentId ? { providerPaymentId: l.providerPaymentId } : {}), ...(l.refundId ? { refundId: l.refundId } : {}), orderId: l.orderId, amountMinor: toUnits(l.amount, FIAT_DECIMALS[cur], "line amount") } };
  }
  const g = TotalRow.parse(t.value);
  return {
    kind: "totals", grouping: {
      id: `TG-${g.currency}-${g.providerDay}-${g.targetBankAccount}`, status: "needs_confirmation", providerDay: g.providerDay, providerTimeZone: g.providerTimeZone ?? UTC,
      currency: g.currency, targetBankAccount: g.targetBankAccount, ...amounts(g.currency, g),
      note: "Totals only, no batch ID: the grouping of payments is proposed by the engine and needs confirmation against the bank line.",
    },
  };
}

const keyOf = (x: SettlementItem): string =>
  x.kind === "batch" ? `batch:${x.batch.batchId}` : x.kind === "line" ? `line:${x.line.batchId}|${x.line.kind}|${x.line.providerPaymentId ?? x.line.refundId}` : `totals:${x.grouping.id}`;

export async function readSettlementReports(sources: readonly AdapterSource[]): Promise<SettlementResult> {
  // Lines are checked against the batches of all sources (batch currency), so read sources once and parse batches first.
  const cache = new Map<string, unknown>();
  const failed = new Map<string, unknown>();
  for (const s of sources) { try { cache.set(s.id, await s.read()); } catch (e) { failed.set(s.id, e); } }
  const replay = sources.map((s) => ({ id: s.id, read: () => { if (failed.has(s.id)) throw failed.get(s.id); return cache.get(s.id); } }));
  const pre = await collect(replay, explode, (i) => { if ((i.value as Tagged).kind !== "batch") throw new RowError("skip"); return parse(i, new Map()); }, keyOf);
  const lineCurrency = new Map(pre.accepted.filter((x): x is Extract<SettlementItem, { kind: "batch" }> => x.kind === "batch").map((x) => [x.batch.batchId, x.batch.currency]));
  const res = await collect(replay, explode, (i) => parse(i, lineCurrency), keyOf);
  const batches = res.accepted.flatMap((x) => (x.kind === "batch" ? [x.batch] : []));
  const batchLines = res.accepted.flatMap((x) => (x.kind === "line" ? [x.line] : []));
  const groupings = res.accepted.flatMap((x) => (x.kind === "totals" ? [x.grouping] : []));
  const shape = groupings.length && batches.length ? "mixed" : groupings.length ? "totals_only" : batches.length ? "per_payment" : "none";
  return { ...res, shape, batches, batchLines, groupings };
}
