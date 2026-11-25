/**
 * v1 bank accounts: the pure rules shared by the upload service and its tests. A bank account is identified by the
 * last four characters of its number only; a statement's lines must be in the account's currency.
 *
 * Duplicates (founder decision 9, src/server/uploads.ts `bankLineFingerprintBody`): a statement row's fingerprint, and
 * the bank line id made from it, include the upload's bank account, so the same line in two accounts is two lines and
 * again in the same account a duplicate. A row of an upload with NO account (before migration 0039) keeps the old
 * fingerprint (no account) and the old line id; a later re-upload of such a line to ANY account of the entity is still
 * a duplicate (its account was never recorded, so Clearline cannot tell it apart), as is one to the same account made
 * before this change. An identical FILE stays refused for the entity whatever the account (uploads_content_uq).
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
