/**
 * ISO 20022 camt.054 (BankToCustomerDebitCreditNotification) → normalised bank lines; versions .001.02 and .001.08
 * (others are read with a warning). A notification reports booked debits and credits on one account as they happen;
 * it usually carries no balances, so its lines cannot be tied to an opening and closing balance (warning no_balances).
 *
 * v1 rules (the conservative choices):
 * - One bank account per file. A file whose notifications name more than one account is refused (multiple_accounts)
 *   rather than split: an upload belongs to exactly one bank account, so splitting would import lines into an account
 *   nobody chose. The person asks the bank for one file per account.
 * - Only booked (BOOK) entries are lines; pending and information-only entries are reported as skipped.
 * - A reversal (RvslInd true) keeps the direction the bank states for the entry and is flagged, never netted.
 * The reader and its XML safety rules (no DOCTYPE or entities, bounded nesting, size and entry limits) live in camt.ts.
 */
import { parseCamt, type CamtOptions, type CamtSpec } from "./camt";
import type { BankParseResult } from "./types";

const CAMT054: CamtSpec = {
  format: "camt054", message: "054", root: "BkToCstmrDbtCdtNtfctn", item: "Ntfctn", noun: "notification", invalid: "invalid_camt054",
  expectBalances: false, singleAccount: true,
};

export type Camt054Options = CamtOptions;

export function parseCamt054(input: Uint8Array | string, opts: Camt054Options = {}): BankParseResult {
  return parseCamt(input, CAMT054, opts);
}
