import type { CurrencyCode, EngineError, Money, Result } from "./types";

/** Supported sandbox currencies and their minor-unit exponent. USDC uses 6 decimals. */
export const CURRENCIES: Readonly<Record<CurrencyCode, number>> = { SGD: 2, USD: 2, PHP: 2, EUR: 2, USDC: 6 };

export const isCurrency = (value: unknown): value is CurrencyCode =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, value);

export const currencyDecimals = (currency: CurrencyCode): number => CURRENCIES[currency];

/** Upper bound for a single sandbox amount (keeps all arithmetic within safe integers). */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000_000; // 1e15 minor units

export const err = (code: EngineError["code"], message: string, extra: Partial<EngineError> = {}): { ok: false; error: EngineError } => ({
  ok: false,
  error: { code, message, ...extra },
});
export const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

export function validateAmountMinor(amountMinor: unknown, field = "amountMinor"): Result<number> {
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_AMOUNT_MINOR)
    return err("invalid_amount", "Amount must be a positive integer number of minor units.", { field });
  return ok(amountMinor);
}

/** Parse a decimal string ("50000.00") into integer minor units without floating point. */
export function parseAmount(text: string, currency: CurrencyCode): Result<number> {
  if (!isCurrency(currency)) return err("invalid_currency", "Unsupported currency.", { field: "currency" });
  const decimals = CURRENCIES[currency];
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(typeof text === "string" ? text.trim() : "");
  if (!match) return err("invalid_amount", "Use a plain positive decimal amount such as 50000.00.");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return err("invalid_amount", `${currency} allows at most ${decimals} decimal places.`);
  const minor = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (minor <= 0n || minor > BigInt(MAX_AMOUNT_MINOR)) return err("invalid_amount", "Amount must be positive and within sandbox limits.");
  return ok(Number(minor));
}

/**
 * rc3 (M-1): floor(amountMinor × bps / 10 000) computed with BigInt. A float product loses integer
 * precision above 2^53 (e.g. 9007199254740839 × 500 / 10000 is 450359962737041, but the float
 * expression gives 450359962737042). Inputs must be non-negative safe integers.
 */
export function applyBpsFloor(amountMinor: number, bps: number): number {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isSafeInteger(bps) || bps < 0) throw new RangeError("applyBpsFloor needs non-negative safe integers");
  return Number((BigInt(amountMinor) * BigInt(bps)) / 10_000n);
}

/** Exact decimal string for minor units, e.g. formatDecimal(5000000, "SGD") === "50000.00". */
export function formatDecimal(amountMinor: number, currency: CurrencyCode): string {
  const decimals = CURRENCIES[currency];
  const negative = amountMinor < 0;
  const digits = BigInt(Math.abs(amountMinor)).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals ? "." + digits.slice(digits.length - decimals) : "";
  return (negative ? "-" : "") + whole + frac;
}

/** "50000.00" — plain decimal string (no symbol, no grouping), e.g. for prefilling inputs. */
export const formatMinorPlain = (amountMinor: number, currency: CurrencyCode): string => formatDecimal(amountMinor, currency);

/** "SGD 50,000.00" / "USDC 6,427.830000" — exact, no floating point. */
export function formatMinor(amountMinor: number, currency: CurrencyCode): string {
  const [whole, frac] = formatDecimal(amountMinor, currency).split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const grouped = whole.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${currency} ${sign}${grouped}${frac !== undefined ? "." + frac : ""}`;
}

export const formatMoney = (m: Money): string => formatMinor(m.amountMinor, m.currency);

/** Adds amounts of ONE currency. Returns currency_mismatch instead of adding across currencies. */
export function addMoney(a: Money, b: Money): Result<Money> {
  if (a.currency !== b.currency) return err("currency_mismatch", `Cannot add ${a.currency} and ${b.currency}.`);
  return ok({ amountMinor: a.amountMinor + b.amountMinor, currency: a.currency });
}

/**
 * Convert source minor units with a decimal-string rate into destination minor units,
 * rounding down (never overstates what a recipient would get). BigInt only.
 *
 * CHANGE 5 (m11): returns a typed error instead of a silent 0. A rate must be a plain positive
 * decimal string (at most 12 decimal places, not zero) — otherwise `invalid_field` (field "rate");
 * the amount must be a non-negative safe integer — otherwise `invalid_amount`.
 */
export function convertMinor(amountMinor: number, from: CurrencyCode, to: CurrencyCode, rate: string): Result<number> {
  if (!isCurrency(from) || !isCurrency(to)) return err("invalid_currency", "Unsupported currency for conversion.", { field: "currency" });
  if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 0)
    return err("invalid_amount", "Amount to convert must be a non-negative integer number of minor units.", { field: "amountMinor" });
  const m = typeof rate === "string" ? /^(\d{1,15})(?:\.(\d{1,12}))?$/.exec(rate) : null;
  if (!m) return err("invalid_field", `Conversion rate ${JSON.stringify(rate ?? null)} is not a plain positive decimal.`, { field: "rate" });
  const rateScale = (m[2] ?? "").length;
  const rateInt = BigInt(m[1] + (m[2] ?? ""));
  if (rateInt === 0n) return err("invalid_field", "Conversion rate must be greater than zero.", { field: "rate" });
  const num = BigInt(amountMinor) * rateInt * 10n ** BigInt(CURRENCIES[to]);
  const den = 10n ** BigInt(rateScale) * 10n ** BigInt(CURRENCIES[from]);
  const out = num / den;
  if (out > BigInt(MAX_AMOUNT_MINOR)) return err("invalid_amount", "Converted amount exceeds sandbox limits.", { field: "amountMinor" });
  return ok(Number(out));
}
