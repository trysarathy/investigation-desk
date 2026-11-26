/**
 * The demo world day by day: which rows of an entity's input "arrive" on each day of the window, so the seed can
 * ingest one day at a time and reconcile after each, as a merchant would. Pure.
 *
 * Arrival (UTC calendar date) [ASSUMPTION]: a quote, a payment link and an FX rate when created; an invoice with its
 * first quote; a provider record with its chain transfer (or its quote or link when it names none); a settlement batch
 * and its lines on the batch's provider day (the report closes that day); a bank line on its value date (lines dated after the window are left out). Anything
 * before the window arrives on its first day, anything after it on its last day.
 */
import type { IngestPartsLike } from "./types";
import type { ReconcileInput } from "../merchant/types";
import { DEMO_FIRST_DAY, DEMO_LAST_DAY } from "./clock";

const day = (isoText: string) => isoText.slice(0, 10);
const clamp = (d: string) => (d < DEMO_FIRST_DAY ? DEMO_FIRST_DAY : d > DEMO_LAST_DAY ? DEMO_LAST_DAY : d);

/** Every day of the window, in order. */
export function windowDays(): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${DEMO_FIRST_DAY}T00:00:00.000Z`); ; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push(d);
    if (d === DEMO_LAST_DAY) return out;
  }
}

/** The input's rows grouped by the day they arrive (transfers are not included: they come from the chain recording). */
export function partsByDay(input: ReconcileInput): Map<string, IngestPartsLike> {
  const by = new Map<string, IngestPartsLike>();
  const put = <K extends keyof IngestPartsLike>(d: string, k: K, v: NonNullable<IngestPartsLike[K]>[number]) => {
    const p = by.get(clamp(d)) ?? {};
    ((p[k] ??= [] as never) as unknown[]).push(v);
    by.set(clamp(d), p);
  };
  const quoteDay = new Map(input.quotes.map((q) => [q.quoteId, day(q.createdAt)]));
  const linkDay = new Map(input.paymentLinks.map((l) => [l.linkId, day(l.createdAt)]));
  const firstQuote = new Map<string, string>();
  for (const q of input.quotes) { const d = day(q.createdAt); const p = firstQuote.get(q.orderId); if (!p || d < p) firstQuote.set(q.orderId, d); }
  const tDay = new Map(input.transfers.map((t) => [`${t.network}|${t.txHash}|${t.logIndex}`, day(t.timestamp)]));
  for (const i of input.invoices) put(firstQuote.get(i.orderId) ?? DEMO_FIRST_DAY, "invoices", i);
  for (const q of input.quotes) put(day(q.createdAt), "quotes", q);
  for (const l of input.paymentLinks) put(day(l.createdAt), "paymentLinks", l);
  for (const r of input.providerRecords) {
    const viaTransfer = r.transferRef ? tDay.get(`${r.transferRef.network}|${r.transferRef.txHash}|${r.transferRef.logIndex}`) : undefined;
    const viaRef = (r.ref.linkId && linkDay.get(r.ref.linkId)) || (r.ref.quoteId && quoteDay.get(r.ref.quoteId)) || DEMO_FIRST_DAY;
    // never before its own quote or link (the rows it names must exist first)
    put(viaTransfer && viaTransfer > viaRef ? viaTransfer : viaRef, "providerRecords", r);
  }
  for (const b of input.batches) put(b.providerDay, "batches", b);
  const batchDay = new Map(input.batches.map((b) => [b.batchId, b.providerDay]));
  for (const l of input.batchLines) put(batchDay.get(l.batchId) ?? DEMO_LAST_DAY, "batchLines", l);
  // a bank line dated after the window belongs to a later statement (demo-files/ holds DEMO_TODAY's), not the seed
  for (const b of input.bankLines) if (b.valueDate <= DEMO_LAST_DAY) put(b.valueDate, "bankLines", b);
  for (const f of input.fxRates) put(day(f.timestamp), "fxRates", f);
  return by;
}
