/** Exact amount arithmetic: BigInt and rationals only. No floats anywhere. */
import { FIAT_DECIMALS } from "./config";
import type { FiatCurrency } from "./types";

export interface Rational { num: bigint; den: bigint }

/** Parse a plain positive decimal string ("1.3500") into an exact rational. */
export function parseRate(rate: string): Rational {
  const m = /^(\d{1,15})(?:\.(\d{1,12}))?$/.exec(rate);
  if (!m) throw new RangeError(`Rate ${JSON.stringify(rate)} is not a plain decimal`);
  const frac = m[2] ?? "";
  const num = BigInt(m[1] + frac);
  if (num === 0n) throw new RangeError("Rate must be greater than zero");
  return { num, den: 10n ** BigInt(frac.length) };
}

/**
 * Divide and round half-up (away from zero at exactly .5) [ASSUMPTION: the prompt's figures, e.g. 60.2145 → 60.21
 * and 7,333.34415 → 7,333.34, use half-up to the currency's minor unit; half-even is still to be confirmed].
 */
export function divRoundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError("denominator must be positive");
  const neg = num < 0n;
  const a = neg ? -num : num;
  const q = (a * 2n + den) / (2n * den);
  return neg ? -q : q;
}

/** Token base units × rate → fiat minor units, rounded half-up. */
export function toFiatMinor(baseUnits: bigint, decimals: number, rate: string, currency: FiatCurrency): bigint {
  const r = parseRate(rate);
  return divRoundHalfUp(baseUnits * r.num * 10n ** BigInt(FIAT_DECIMALS[currency]), r.den * 10n ** BigInt(decimals));
}

/** bps × amount / 10 000, rounded half-up (0.5% of 18,365.00 = 91.825 → 91.83). */
export const bpsOf = (amountMinor: bigint, bps: number): bigint => divRoundHalfUp(amountMinor * BigInt(bps), 10_000n);

export const abs = (x: bigint): bigint => (x < 0n ? -x : x);
export const sum = (xs: readonly bigint[]): bigint => xs.reduce((t, x) => t + x, 0n);
export const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxBig = (a: bigint, b: bigint): bigint => (a > b ? a : b);

function grouped(units: bigint, decimals: number, minFrac: number): string {
  const neg = units < 0n;
  const digits = abs(units).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let frac = digits.slice(digits.length - decimals);
  while (frac.length > minFrac && frac.endsWith("0")) frac = frac.slice(0, -1);
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

/** "SGD 1,350.00" */
export const fmtFiat = (minor: bigint, currency: FiatCurrency): string => `${currency} ${grouped(minor, FIAT_DECIMALS[currency], FIAT_DECIMALS[currency])}`;
/** "1,000.00 USDT" (trailing zeros beyond 2 places trimmed) */
export const fmtToken = (baseUnits: bigint, decimals: number, symbol: string): string => `${grouped(baseUnits, decimals, 2)} ${symbol}`;
/** part / whole as a percentage with one decimal, half-up: 240/2000 → "12.0%". */
export function fmtPct(part: bigint, whole: bigint): string {
  const tenths = divRoundHalfUp(abs(part) * 1000n, whole);
  return `${tenths / 10n}.${tenths % 10n}%`;
}

/** Parse an ISO instant into epoch milliseconds (pure: no clock is read). */
export function instantMs(iso: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new RangeError(`Not an ISO instant: ${iso}`);
  return ms;
}

/** Local calendar date of an instant at a fixed UTC offset, e.g. ("2026-11-24T17:00:00Z", 480) → "2026-11-25". */
export function localDate(iso: string, utcOffsetMinutes: number): string {
  return new Date(instantMs(iso) + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}
