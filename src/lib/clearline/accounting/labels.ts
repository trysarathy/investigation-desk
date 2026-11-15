/**
 * Accounting Bridge (rc4) — human labels. Deterministic text only. Merged into HUMAN_LABELS and CODE_LABELS by
 * ../labels.ts, so the console renders every bridge value through HUMAN_LABELS / describeCode.
 *
 * Wording rule: nothing here says "paid" or "posted" unless that is what the record states — a proposed entry is
 * never a posted entry, and a returned payout's entries say the supplier is NOT paid.
 */
import type { AccountRole, AccountingExportKind, AccountingPeriodStatus, JournalProposalStatus, JournalRuleCode, NotProposedCode, SupersessionCode } from "./types";
import type { ExportEvidenceClass, ExportMovementKind } from "./exports";

export const PROPOSAL_STATUS: Record<JournalProposalStatus, string> = {
  proposed: "Proposed — not approved, not posted",
  approved: "Approved — not yet exported",
  exported: "Exported to file — not confirmed as posted",
  posted: "Posted in your ledger (recorded by a person)",
  rejected: "Rejected",
  superseded: "Superseded — evidence changed",
};

export const ACCOUNT_ROLE: Record<AccountRole, string> = {
  bank: "Bank account",
  supplier_payable: "Supplier payable",
  customer_receivable: "Receivable from customer",
  stablecoin_clearing: "Stablecoin clearing",
  provider_clearing: "Payment provider clearing",
  suspense: "Suspense",
};

export const JOURNAL_RULE: Record<JournalRuleCode, string> = {
  JR_SUPPLIER_PAYOUT_DEBIT: "Supplier payout debited from the bank (bank statement evidence)",
  JR_PAYOUT_DEBIT_NOT_DELIVERED: "Payout debited from the bank but not delivered — supplier not paid",
  JR_PAYOUT_RETURN_CREDIT: "Returned payout credited back on the statement — supplier still not paid",
  JR_ADVANCE_DISBURSED: "Advance disbursed to the supplier for the customer (bank statement evidence)",
  JR_REPAYMENT_BY_REFERENCE: "Customer repayment received by its reference",
  JR_STABLECOIN_FINAL_TRANSFER: "Stablecoin transfer final on chain (synthetic testnet) — not a bank credit",
  JR_STABLECOIN_ONRAMP_FUNDING: "Bank debit funding a stablecoin payout's on-ramp — supplier not yet paid",
  JR_REVERSAL: "Reversal of an exported or posted entry whose evidence changed",
};

export const NOT_PROPOSED: Record<NotProposedCode, string> = {
  NP_PROVIDER_REPORT_ONLY: "Provider settlement report only — not evidence; no entry",
  NP_PROVIDER_COMPLETION_ONLY: "Provider reports completed, but there is no bank or final chain evidence — no entry (pending evidence)",
  NP_AMOUNT_ONLY_MATCH: "Only the amount matches — no entry; the exception stays for a person",
  NP_AMBIGUOUS_REFERENCE: "Reference matches more than one item — no entry",
  NP_UNALLOCATED_LINE: "Statement line not matched by a trusted reference — no entry",
  NP_PARTIAL_REMAINDER: "Only part of the line or payout is evidenced — the remainder has no entry",
  NP_ACCEPTED_DIFFERENCE: "A person accepted this bank debit, but it was not matched — no automatic entry; book it by hand after review",
  NP_FEE_NOT_EVIDENCED: "Fees are indicative quote amounts, not evidence — not proposed",
  NP_FX_NOT_EVIDENCED: "No exact FX evidence — the entry is in the currency that left the bank; no FX entry proposed",
  NP_CHAIN_NOT_FINAL: "On-chain transfer not final (or not allocated) — no entry yet",
  NP_CHAIN_NOT_COUNTED: "On-chain transfer not counted (unsupported or conflicting) — no entry",
  NP_EVIDENCE_CONTRADICTED: "The evidence is contradicted — no entry",
  NP_NO_OPEN_PERIOD: "No open accounting period covers this date — open one first",
};

export const SUPERSESSION: Record<SupersessionCode, string> = {
  SP_EVIDENCE_CHANGED: "Evidence changed after the proposal was made",
  SP_EVIDENCE_WITHDRAWN: "The evidence no longer supports an entry",
  SP_RULES_CHANGED: "No longer matches the current posting rules; superseded on load (never exported)",
  SP_MAPPING_CHANGED: "The account codes changed after approval; the entry must be approved again with the new codes",
};

export const PERIOD_STATUS: Record<AccountingPeriodStatus, string> = { open: "Open", closed: "Closed" };

export const EXPORT_KIND: Record<AccountingExportKind, string> = { reconciliation: "Reconciliation export", journal: "Journal export (proposed entries, approved)" };

export const EXPORT_EVIDENCE_CLASS: Record<ExportEvidenceClass, string> = {
  evidenced: "Evidenced (bank statement or final chain transfer)",
  provider_reported_only: "Provider-reported only — not evidence",
  unresolved: "Unresolved — needs a person",
};

export const EXPORT_MOVEMENT: Record<ExportMovementKind, string> = {
  supplier_payout_debit: "Supplier payout debit",
  payout_debit_not_delivered: "Payout debit — not delivered",
  payout_return_credit: "Returned payout credit",
  advance_disbursement: "Advance disbursement",
  repayment_credit: "Repayment credit",
  unallocated_credit: "Unallocated credit",
  unallocated_debit: "Unallocated debit",
  provider_settlement_report: "Provider settlement report",
  stablecoin_transfer: "Stablecoin transfer (synthetic testnet)",
  provider_reported_completion: "Provider-reported completion",
  provider_reported_return: "Provider-reported return",
  stablecoin_conversion: "Stablecoin conversion (on-ramp funding vs chain payment) — not evidenced",
};

/** XR_* row codes of the reconciliation export (the rule that classified the row). */
export const EXPORT_ROW_RULE: Record<string, string> = {
  XR_BANK_DEBIT_BY_REFERENCE: "Bank debit matched by the payout's provider payment id",
  XR_RETURN_CREDIT_BY_REFERENCE: "Return credit matched by the payout's provider payment id",
  XR_REPAYMENT_BY_REFERENCE: "Credit matched by the repayment reference",
  XR_CHAIN_FINAL_BY_TX_HASH: "Final on-chain transfer matched by the provider-reported tx hash",
  XR_CHAIN_NOT_FINAL: "On-chain transfer not yet final or not matched",
  XR_CHAIN_NOT_COUNTED: "On-chain transfer not counted",
  XR_LINE_NOT_ALLOCATED: "Statement line not matched by a trusted reference",
  XR_LINE_PARTIAL: "Statement line partly matched",
  XR_PROVIDER_REPORT: "Provider settlement report (provider's claim)",
  XR_PROVIDER_COMPLETION_NO_EVIDENCE: "Provider reports completed; no bank or chain evidence",
  XR_PROVIDER_RETURN_NOT_ON_STATEMENT: "Provider reports returned; the return is not on a statement",
  XR_CONVERSION_NOT_EVIDENCED: "Bank funding and the on-chain payment are in different currencies; the conversion is not evidenced",
  XR_FICTIONAL_SANDBOX: "Fictional sandbox export",
  XR_GENERATED_AT: "Generated at (simulated clock)",
  XR_PERIOD: "Period [from, to)",
};

/** "CODE: …" prefixes of bridge refusals (EngineError.message), for describeError. */
export const BRIDGE_REASON: Record<string, string> = {
  NO_OPEN_PERIOD: "No open accounting period covers this date.",
  PERIOD_CLOSED: "This accounting period is closed; nothing new can be dated in it.",
  PERIOD_OVERLAP: "Accounting periods may not overlap.",
  PERIOD_HAS_PENDING_PROPOSALS: "Approve and export, or reject, the period's open proposals before closing it.",
  EVIDENCE_CHANGED: "The evidence behind this proposal changed; it was superseded. Propose entries again.",
  NOT_BALANCED: "The entry's debits and credits differ.",
  UNMAPPED_ACCOUNT_ROLE: "Map every account role the entries use to one of your account codes first.",
  NOTHING_TO_EXPORT: "There are no approved proposals in this period.",
  MAPPING_REVISION_CONFLICT: "The account mapping changed since you loaded it; reload and try again.",
  NOT_EXPORTED: "Only an exported entry can be recorded as posted.",
  REVERSAL_FIRST: "Approve the reversal of the entry already in your ledger first, so one bank line is never booked twice.",
  REVERSAL_REQUIRED: "This reversal corrects an entry that is (or may be) in your ledger; it cannot be rejected.",
  REVERSAL_ALREADY_EXPORTED: "Its reversal is already exported or posted; post the reversal as the correction instead.",
  LEDGER_DOUBLE_COUNT: "These entries would show a payout paid more than once or book one bank line twice; nothing was proposed.",
    MAPPING_CHANGED_SINCE_APPROVAL: "The account codes changed after approval; the entry must be approved again with the new codes.",
};

/** Every static bridge code with a short label, for describeCode / isKnownCode. */
export const BRIDGE_CODE_LABELS: Readonly<Record<string, string>> = {
  ...JOURNAL_RULE,
  ...NOT_PROPOSED,
  ...SUPERSESSION,
  ...EXPORT_ROW_RULE,
};
