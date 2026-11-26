/**
 * v1 (founder decision 9): other-currency amounts of an entity (e.g. a USD bank account under the SGD entity). Pure.
 * A recorded rate only SHOWS an amount in the entity's currency; it never makes two amounts tie (ties are evaluated in
 * the account's own currency, bridge.ts). No rate in the window, or two recorded rates at the same instant that
 * disagree: "needs a rate", never 0 and never derived from another pair, a provider credit or a quote.
 */
import { divRoundHalfUp, instantMs, parseRate } from "./amounts";
import { FIAT_DECIMALS } from "./config";
import type { FiatCurrency, FiatRate, FxValue } from "./types";

/** [ASSUMPTION, for sign-off] a rate is usable only when recorded at most this long before the instant it values. */
export const FIAT_RATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const fiatPair = (from: FiatCurrency, to: FiatCurrency) => `${from}/${to}`;

/** amountMinor in `from` × rate (to per 1 from) → minor units of `to`, half-up. Exact (BigInt only). */
export function convertMinor(amountMinor: bigint, from: FiatCurrency, to: FiatCurrency, rate: string): bigint {
  const r = parseRate(rate);
  return divRoundHalfUp(amountMinor * r.num * 10n ** BigInt(FIAT_DECIMALS[to]), r.den * 10n ** BigInt(FIAT_DECIMALS[from]));
}

/**
 * The last millisecond of a calendar date in a zone at a fixed UTC offset: a rate "at or before the value date" is one
 * recorded no later than the end of that day in the entity's zone [ASSUMPTION, for sign-off].
 */
export function endOfLocalDay(date: string, utcOffsetMinutes: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 86_400_000 - 1 - utcOffsetMinutes * 60_000).toISOString();
}

const sameRate = (a: string, b: string) => { const x = parseRate(a), y = parseRate(b); return x.num * y.den === y.num * x.den; };

/** The recorded rate for `pair` at `at`: the latest one at or before it, at most FIAT_RATE_MAX_AGE_MS older. */
export function rateAt(rates: readonly FiatRate[], pair: string, at: string): { rate: FiatRate } | { reason: string } {
  const t = instantMs(at);
  const usable = rates.filter((r) => r.pair === pair && instantMs(r.asOf) <= t && t - instantMs(r.asOf) <= FIAT_RATE_MAX_AGE_MS);
  if (usable.length === 0) return { reason: `no ${pair} rate is recorded in the 24 hours up to ${at}` };
  const latest = Math.max(...usable.map((r) => instantMs(r.asOf)));
  const tied = usable.filter((r) => instantMs(r.asOf) === latest);
  if (tied.some((r) => !sameRate(r.rate, tied[0].rate))) return { reason: `two recorded ${pair} rates at the same time disagree; Clearline does not choose` };
  return { rate: [...tied].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0))[0] };
}

/** An other-currency amount's value in `to` at `at`, from a recorded rate only. */
export function valueIn(amountMinor: bigint, from: FiatCurrency, to: FiatCurrency, rates: readonly FiatRate[], at: string): FxValue {
  const pair = fiatPair(from, to);
  if (from === to) return { status: "rated", amountMinor, currency: to, pair, rate: "1.0000", asOf: at, source: "same currency" };
  const found = rateAt(rates, pair, at);
  if ("reason" in found) return { status: "needs_rate", currency: to, pair, reason: found.reason };
  return { status: "rated", amountMinor: convertMinor(amountMinor, from, to, found.rate.rate), currency: to, pair, rate: found.rate.rate, asOf: found.rate.asOf, source: found.rate.source };
}
