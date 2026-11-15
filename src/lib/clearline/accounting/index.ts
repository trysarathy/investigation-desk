/**
 * Clearline Accounting Bridge (rc4, CHANGE 15) — public surface, re-exported by ../index.ts.
 * SANDBOX ONLY: proposes balanced journal entries from evidence; never posts anything anywhere.
 */
export * from "./types";
export { deriveJournalCandidates, balanceOf, isBalanced, bankKey, ledgerProblem, payableBound, onStablecoinRail, netByKey, isInLedger, isConfirmedNotImported } from "./derive";
export type { JournalCandidate, JournalDerivation } from "./derive";
export { ACCOUNT_ROLES, NON_BANK_ROLES, DEFAULT_SAMPLE_MAPPING, roleOfKey, mappingProblem, unmappedKeys, resolvePeriod, periodContaining } from "./periods";
export type { PeriodResolution } from "./periods";
export {
  ACCOUNTING_EXPORT_MARKING, buildReconciliationExport, reconciliationExportToCsv, buildJournalExport, journalExportToCsv, accountingExportToJson,
  RECONCILIATION_EXPORT_CSV_COLUMNS, JOURNAL_EXPORT_CSV_COLUMNS,
} from "./exports";
export type { ReconciliationExport, ReconciliationExportRow, ExportEvidenceClass, ExportMovementKind, ExportAmount, JournalExport, JournalExportEntry, JournalExportLine } from "./exports";
export { accountingBridgeView, ACCOUNTING_BRIDGE_DISCLAIMER } from "./view";
export type { AccountingBridgeView, JournalProposalRow } from "./view";
export { ACCOUNTING_ACTION_TYPES } from "./actions";
export { JOURNAL_RULE_CODES, RULE_SHAPE, SHOWS_SUPPLIER_PAID } from "./validate";
