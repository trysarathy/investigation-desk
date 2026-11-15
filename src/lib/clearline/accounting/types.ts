/**
 * Clearline Accounting Bridge (rc4) — types.
 *
 * SANDBOX ONLY. The bridge connects payment operations to the customer's existing ledger. It is NOT an
 * ERP and never posts anything: it proposes balanced journal entries from recorded evidence, a person
 * approves them (maker ≠ checker), they are exported as a file, and only a person can record that they
 * were posted in the external ledger (`record_posting`, with the external reference the person supplies).
 * A proposed entry is never a posted entry.
 *
 * Every amount is integer minor units of ONE currency; a proposal never mixes currencies.
 */
import type { CurrencyCode, HistoryEntry } from "../types";

// ---------------------------------------------------------------------------------------------
// Chart-of-accounts mapping
// ---------------------------------------------------------------------------------------------

/** Clearline account roles. `bank` is always qualified by the statement account: `bank:<accountRef>`. */
export type AccountRole = "bank" | "supplier_payable" | "customer_receivable" | "stablecoin_clearing" | "provider_clearing" | "suspense";

/** An account key on a journal line: "bank:<accountRef>" or one of the non-bank roles. */
export type AccountKey = string;

export interface AccountMappingEntry {
  /** "bank:<accountRef>" or a non-bank AccountRole. */
  accountKey: AccountKey;
  /** The customer's own account code (fictional in the sandbox). */
  accountCode: string;
  accountName: string;
}

export interface AccountMapping {
  /** Starts at 1; every set_account_mapping increments it. */
  revision: number;
  entries: AccountMappingEntry[];
  updatedBy: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------------------------
// Accounting periods
// ---------------------------------------------------------------------------------------------

export type AccountingPeriodStatus = "open" | "closed";

export interface AccountingPeriod {
  id: string;
  name: string;
  /** Calendar dates in the organisation's time zone: [from, to). */
  from: string;
  to: string;
  status: AccountingPeriodStatus;
  openedBy: string;
  openedAt: string;
  closedBy?: string;
  closedAt?: string;
}

// ---------------------------------------------------------------------------------------------
// Journal proposals
// ---------------------------------------------------------------------------------------------

/** The rule that produced a proposal (and each of its lines). */
export type JournalRuleCode =
  /** Bank debit matched by trusted reference to a live supplier payout: Dr supplier payable / Cr bank. */
  | "JR_SUPPLIER_PAYOUT_DEBIT"
  /** Bank debit matched to a payout that is returned, failed, cancelled, expired or on hold: Dr provider clearing / Cr bank (the supplier is NOT paid). */
  | "JR_PAYOUT_DEBIT_NOT_DELIVERED"
  /** Statement-confirmed return credit: Dr bank / Cr provider clearing (reverses the payout; the supplier payable stays open). */
  | "JR_PAYOUT_RETURN_CREDIT"
  /** Bank debit of a payout funded by an approved advance: Dr customer receivable / Cr bank. */
  | "JR_ADVANCE_DISBURSED"
  /** Repayment credit allocated by its repayment reference: Dr bank / Cr customer receivable. */
  | "JR_REPAYMENT_BY_REFERENCE"
  /** Final on-chain transfer to the beneficiary's wallet, allocated by the provider-reported tx hash: Dr supplier payable (or customer receivable) / Cr stablecoin clearing. Never a bank line. */
  | "JR_STABLECOIN_FINAL_TRANSFER"
  /** Reversal of an exported or posted proposal whose evidence changed (corrections are new entries). */
  | "JR_REVERSAL";

export type JournalProposalStatus = "proposed" | "approved" | "exported" | "posted" | "rejected" | "superseded";

export interface JournalLine {
  lineNo: number;
  accountKey: AccountKey;
  side: "debit" | "credit";
  amountMinor: number;
  currency: CurrencyCode;
  memo: string;
  ruleCode: JournalRuleCode;
  /** Ids of the evidence records this line rests on (statement line, allocation, chain observation, repayment allocation, provider events, evidence records). Never empty. */
  evidenceIds: string[];
}

export interface JournalEvidenceRefs {
  statementLineIds: string[];
  allocationIds: string[];
  chainObservationIds: string[];
  repaymentAllocationIds: string[];
  providerEventIds: string[];
  evidenceRecordIds: string[];
}

export interface JournalProposal {
  id: string;
  /** Deterministic identity of what the entry is about, e.g. "JR_SUPPLIER_PAYOUT_DEBIT:alc_00012" or "REV:jp_00190". */
  sourceKey: string;
  ruleCode: JournalRuleCode;
  status: JournalProposalStatus;
  /** The evidence's own date (statement value date, org date of the chain observation, or the reversal date). */
  entryDate: string;
  /** The date the entry is proposed in: entryDate, or the first day of the next open period for a prior-period item. */
  postingDate: string;
  periodId: string;
  /** Set when the entry date falls in a closed period: the entry is moved to the next open period, never silently. */
  priorPeriodItem?: { originalDate: string; originalPeriodId: string; reason: string };
  currency: CurrencyCode;
  lines: JournalLine[];
  evidence: JournalEvidenceRefs;
  intentId?: string;
  advanceId?: string;
  obligationId?: string;
  /** JR_REVERSAL only: the exported or posted proposal it reverses. */
  reverses?: string;
  /** Plain-English description (never says "paid" unless the rule's evidence says so). */
  narrative: string;
  /**
   * Whether this entry shows the supplier as paid: true only for a payout debit evidenced by the bank statement or
   * a final chain transfer (JR_SUPPLIER_PAYOUT_DEBIT, JR_ADVANCE_DISBURSED, JR_STABLECOIN_FINAL_TRANSFER). Always
   * false for a returned, failed, cancelled, expired or held payout, a return credit, a repayment and a reversal.
   */
  showsSupplierPaid: boolean;
  /** SHA-256 of the canonical evidence basis (rule, accounts, amounts, evidence ids, payout class). A different basis supersedes the proposal. */
  basisHash: string;
  createdBy: string;
  createdAt: string;
  approval?: { by: string; at: string; note?: string };
  rejection?: { by: string; at: string; reason: string };
  export?: { exportId: string; by: string; at: string };
  /** Recorded by a PERSON after posting in the external ledger. Clearline never posts. */
  posting?: { externalReference: string; recordedBy: string; recordedAt: string; note?: string; simulated: true };
  supersession?: { at: string; causedBy: string; code: SupersessionCode; reason: string; replacedBy?: string };
  /** An exported or posted proposal whose evidence changed afterwards: kept as it is (corrections are new, approved entries), with why. */
  evidenceChange?: { at: string; causedBy: string; code: SupersessionCode; reason: string };
  history: HistoryEntry[];
}

export type SupersessionCode = "SP_EVIDENCE_CHANGED" | "SP_EVIDENCE_WITHDRAWN";

/** Something the bridge deliberately did NOT propose, with why. */
export type NotProposedCode =
  | "NP_PROVIDER_REPORT_ONLY"
  | "NP_PROVIDER_COMPLETION_ONLY"
  | "NP_AMOUNT_ONLY_MATCH"
  | "NP_AMBIGUOUS_REFERENCE"
  | "NP_UNALLOCATED_LINE"
  | "NP_PARTIAL_REMAINDER"
  | "NP_ACCEPTED_DIFFERENCE"
  | "NP_FEE_NOT_EVIDENCED"
  | "NP_FX_NOT_EVIDENCED"
  | "NP_CHAIN_NOT_FINAL"
  | "NP_CHAIN_NOT_COUNTED"
  | "NP_EVIDENCE_CONTRADICTED"
  | "NP_NO_OPEN_PERIOD";

export interface NotProposedItem {
  code: NotProposedCode;
  text: string;
  refs: string[];
  exceptionIds: string[];
  amount?: { amountMinor: number; currency: CurrencyCode };
}

// ---------------------------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------------------------

export type AccountingExportKind = "reconciliation" | "journal";

export interface AccountingExportRecord {
  id: string;
  kind: AccountingExportKind;
  /** The document's deterministic export id ("rx_…" / "jx_…", from its hash). */
  documentId: string;
  /** SHA-256 of the exported document body. */
  sha256: string;
  /** Reconciliation export: [from, to). Journal export: the period's dates. */
  from: string;
  to: string;
  periodId?: string;
  /** Journal export only. */
  proposalIds?: string[];
  /** Journal export only: the mapping revision used, and the account codes it resolved (so the file can be re-rendered byte for byte). */
  mappingRevision?: number;
  accounts?: AccountMappingEntry[];
  rowCount: number;
  by: string;
  at: string;
}

export interface AccountingBridge {
  version: 1;
  mapping?: AccountMapping;
  periods: AccountingPeriod[];
  proposals: JournalProposal[];
  exports: AccountingExportRecord[];
}

// ---------------------------------------------------------------------------------------------
// Actions (members of WorkspaceAction)
// ---------------------------------------------------------------------------------------------

export type AccountingAction =
  | { type: "set_account_mapping"; entries: AccountMappingEntry[]; expectedRevision?: number }
  | { type: "open_accounting_period"; name: string; from: string; to: string }
  | { type: "close_accounting_period"; periodId: string }
  | { type: "propose_journal_entries"; periodId?: string }
  | { type: "approve_journal_proposal"; proposalId: string; note?: string }
  | { type: "reject_journal_proposal"; proposalId: string; reason: string }
  | { type: "export_journal"; periodId: string }
  | { type: "record_posting"; proposalId: string; externalReference: string; note?: string }
  | { type: "record_reconciliation_export"; from: string; to: string };
