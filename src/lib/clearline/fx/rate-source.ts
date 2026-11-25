/**
 * v1 founder decision 9: where a recorded fiat rate comes from. Pluggable: Clearline calls no real rate API (no
 * account, no paid service, no network). The only implementation here is a LOCAL STAND-IN that answers from a table
 * it is given (fictional rates for tests and demos). A real source would implement the same interface, be reviewed
 * separately and still only RECORD rates (fiat_rates, append-only); a rate never makes amounts tie.
 */
import { parseRate } from "../merchant/amounts";
import { FIAT_DECIMALS } from "../merchant/config";

export interface RateQuote { pair: string; rate: string; asOf: Date; sourceLabel: string }

export interface RateSource {
  /** Shown as the rate's source label, e.g. "Local stand-in (fictional rates)". */
  readonly label: string;
  /** The rate for `pair` ("USD/SGD") as of `asOf`, or null when the source has none (never a guess, never 0). */
  quote(pair: string, asOf: Date): Promise<RateQuote | null>;
}

export const FIAT_PAIR = /^([A-Z]{3})\/([A-Z]{3})$/;

/** "USD/SGD" → its two currencies when both are reconciliation currencies and differ; otherwise null. */
export function parseFiatPair(pair: string): { base: string; quote: string } | null {
  const m = FIAT_PAIR.exec(pair);
  if (!m || m[1] === m[2] || !(m[1] in FIAT_DECIMALS) || !(m[2] in FIAT_DECIMALS)) return null;
  return { base: m[1], quote: m[2] };
}

/** A plain positive decimal with at most 10 places (the column is numeric(24,10)); otherwise null. */
export function validRate(rate: string): string | null {
  if (!/^\d{1,14}(\.\d{1,10})?$/.test(rate)) return null;
  try { parseRate(rate); return rate; } catch { return null; }
}

/** The local stand-in: answers only from the fixed table it was built with ({ "USD/SGD": "1.3500" }). */
export class LocalStandInRateSource implements RateSource {
  readonly label: string;
  private readonly table: ReadonlyMap<string, string>;
  constructor(table: Readonly<Record<string, string>>, label = "Local stand-in (fictional rates)") {
    this.label = label;
    this.table = new Map(Object.entries(table).filter(([p, r]) => parseFiatPair(p) && validRate(r)));
  }
  async quote(pair: string, asOf: Date): Promise<RateQuote | null> {
    const rate = this.table.get(pair);
    return rate === undefined ? null : { pair, rate, asOf, sourceLabel: this.label };
  }
}
