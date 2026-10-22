import type { DepositAddressRow, LedgerRow } from "../types";
/** A connector returns snapshots with provenance; it never writes to the source ledger. */
export interface LedgerConnector {
  id: string;
  capabilities: readonly ("addresses" | "ledger")[];
  readSnapshot(cursor?: string): Promise<{
    addresses: DepositAddressRow[];
    ledger: LedgerRow[];
    fetchedAt: string;
    sourceVersion: string;
    complete: boolean;
    nextCursor?: string;
  }>;
  health(): Promise<{ available: boolean; checkedAt: string; reason?: string }>;
}
