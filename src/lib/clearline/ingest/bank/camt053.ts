/**
 * ISO 20022 camt.053 (BankToCustomerStatement) → normalised bank lines; versions .001.02 and .001.08 (others are read
 * with a warning). The reader and its XML safety rules live in camt.ts. Several statements per file are read in order.
 */
import { parseCamt, type CamtOptions, type CamtSpec } from "./camt";
import type { BankParseResult } from "./types";

const CAMT053: CamtSpec = {
  format: "camt053", message: "053", root: "BkToCstmrStmt", item: "Stmt", noun: "statement", invalid: "invalid_camt053",
  expectBalances: true, singleAccount: false,
};

export type Camt053Options = CamtOptions;

export function parseCamt053(input: Uint8Array | string, opts: Camt053Options = {}): BankParseResult {
  return parseCamt(input, CAMT053, opts);
}
