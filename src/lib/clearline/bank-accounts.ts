/**
 * v1 bank accounts: the pure rules shared by the upload service and its tests. A bank account is identified by the
 * last four characters of its number only; a statement's lines must be in the account's currency.
 */
import type { AppliedRow } from "./mapping";

/** The last four letters or digits of an account number / IBAN, upper case. Nothing longer is ever accepted. */
export const LAST4 = /^[A-Z0-9]{4}$/;

/** "4321", " ab 12 " → "4321", "AB12"; a longer value (a full number) or other characters → null, never truncated. */
export function normaliseLast4(input: string): string | null {
  const v = input.replace(/\s+/g, "").toUpperCase();
  return LAST4.test(v) ? v : null;
}

/** Currencies in a parsed statement other than the account's (sorted, distinct): empty means the statement fits. */
export function otherCurrencies(lines: readonly { currency: string }[], accountCurrency: string): string[] {
  return [...new Set(lines.map((l) => l.currency).filter((c) => c !== accountCurrency))].sort();
}

/**
 * A statement row in another currency than its account's is rejected (code currency_not_bank_account); rows already
 * rejected, and rows without a currency (the mapping reports those), are left as they are.
 */
export function rejectOtherCurrency(rows: AppliedRow[], accountCurrency: string | undefined): AppliedRow[] {
  if (accountCurrency === undefined) return rows;
  return rows.map((r) => (r.status === "rejected" || r.values.currency === undefined || r.values.currency === accountCurrency ? r
    : { ...r, status: "rejected", errors: [...r.errors, { field: "currency", code: "currency_not_bank_account" }] }));
}
