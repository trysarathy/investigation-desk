// The SAMPLE COMPANY DATA (fictional company, real transactions) as an investigation workspace.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Workspace } from "../../../src/lib/chain/investigate";
import { validateFileA, validateFileB } from "../../../src/lib/csv/files";

const DIR = path.join(__dirname, "..", "..", "real-data");
export const REAL_CASES_FILE = path.join(__dirname, "..", "..", "real_cases.json");

export interface RealCase {
  id: string; category: string; chain: string; tx_hash: string | null; input: string | null; customer_id: string | null;
  expected: string; expected_findings: string[]; scoring?: string; dynamic?: boolean;
}

export function realCases(): RealCase[] {
  return JSON.parse(readFileSync(REAL_CASES_FILE, "utf8")).cases;
}

export function sampleWorkspace(customerId?: string): Workspace {
  const a = validateFileA(new Uint8Array(readFileSync(path.join(DIR, "SAMPLE-file-a-deposit-addresses.csv"))));
  const b = validateFileB(new Uint8Array(readFileSync(path.join(DIR, "SAMPLE-file-b-ledger.csv"))));
  return { customerId, depositAddresses: a.rows, ledger: b.rows, ledgerUploadedAt: "2026-10-24T15:43:03.581Z",
    fileARejectedRows: a.rowErrors.length, fileBRejectedRows: b.rowErrors.length };
}
