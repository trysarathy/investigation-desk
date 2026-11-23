/** Minor-unit exponents for bank-statement currencies, built on the repo's existing tables. */
import { CURRENCIES } from "../../money";
import { FIAT_DECIMALS } from "../../merchant/config";
import { fail, ok, type Result } from "../errors";

/**
 * SGD, USD and AED come from the merchant FIAT_DECIMALS table; EUR and PHP from rc5's CURRENCIES; GBP and JPY are
 * added here (ISO 4217: 2 and 0).
 */
export const BANK_CURRENCY_DECIMALS: Readonly<Record<string, number>> = Object.freeze({
  ...FIAT_DECIMALS,
  EUR: CURRENCIES.EUR,
  PHP: CURRENCIES.PHP,
  GBP: 2,
  JPY: 0,
});

export function currencyPrecision(code: string): Result<number, "unknown_currency"> {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (Object.prototype.hasOwnProperty.call(BANK_CURRENCY_DECIMALS, c)) return ok(BANK_CURRENCY_DECIMALS[c]);
  return fail("unknown_currency", `The currency "${code}" is not supported. Supported: ${Object.keys(BANK_CURRENCY_DECIMALS).sort().join(", ")}.`);
}
