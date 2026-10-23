// Browser-safe helpers for bulk results: which rows count as non-credited, and CSV export.

import type { BulkResult } from "./types";
import { csvValue } from "../csv/cell";

/** "Non-credited" = everything not shown as credited (D13), including paused rows still unknown. */
export const isNonCredited = (r: BulkResult) => r.code !== "D13";

const CSV_COLUMNS = ["line", "tx_hash", "stated_chain", "found_chain", "customer_id", "customer_from_file_a", "state",
  "verdict_code", "verdict", "confidence", "token", "amount", "note"] as const;

// The CSV cell writers live in csv/cell.ts, shared with the reconciled export.
export { csvCell } from "../csv/cell";

export function resultsCsv(results: BulkResult[]): string {
  const lines = results.map((r) => [r.line, r.txHash, r.statedChain, r.foundChain, r.customerId, r.customerInferred ? "yes" : "no",
    r.state, r.code, r.label, r.confidence, r.token, r.amount, r.note].map(csvValue).join(","));
  return [CSV_COLUMNS.join(","), ...lines].join("\n") + "\n";
}
