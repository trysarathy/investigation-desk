/**
 * FX rates adapter. Every rate carries { pair, rate, source, observedAt }; a rate without a source or a timestamp is
 * refused, because a rate nobody can trace cannot explain a difference. Rates stay exact decimal strings.
 * Test mode · illustrative data.
 */
import { z } from "zod";
import { parseRate } from "../amounts";
import type { FxRate } from "../types";
import { type AdapterResult, type AdapterSource, RowError, collect, isoInstant, jsonItems } from "./common";

export const FxRow = z.object({
  pair: z.string().regex(/^[A-Z]{3,4}\/[A-Z]{3}$/, "pair is BASE/QUOTE, e.g. USDT/SGD"),
  rate: z.string().min(1).max(40),
  source: z.string({ error: "a rate needs its source" }).trim().min(1, "a rate needs its source").max(120),
  observedAt: z.string({ error: "a rate needs its observation time" }).min(1, "a rate needs its observation time"),
}).strict();

export function parseFxRow(value: unknown): FxRate {
  const r = FxRow.parse(value);
  try { parseRate(r.rate); } catch { throw new RowError(`rate ${JSON.stringify(r.rate)} is not a plain positive decimal`); }
  return { pair: r.pair, rate: r.rate, source: r.source, timestamp: isoInstant(r.observedAt, "observedAt") };
}

export function readFxRates(sources: readonly AdapterSource[]): Promise<AdapterResult<FxRate>> {
  return collect(sources, (raw, id) => ({ items: jsonItems(raw, id, "rates") }), (i) => parseFxRow(i.value), (r) => `${r.pair}|${r.source}|${r.timestamp}`);
}
