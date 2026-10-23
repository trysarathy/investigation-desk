// Canonical payment records (spec "Product direction (23 Oct)"): one payment ID linking
// instruction -> on-chain transfer(s) -> provider record -> bank record -> ledger entry -> later
// returns. Every record keeps its original identifiers, its event time (when it happened, by its
// own source), its observed time (when we read it) and the exact source row or response.

import type { Chain, Token } from "../types";

export type RecordKind = "instruction" | "chain_transfer" | "provider" | "bank" | "ledger";
export type ImportKind = "instruction" | "provider" | "bank" | "ledger";

/** Where one observation of a record came from. A record seen twice has two. */
export type SourceRef =
  | { kind: "file"; importId: string; fileName: string; fileSha256: string; line: number; mappingId: string; mappingVersion: number }
  | { kind: "chain"; url: string; rawSha256: string[]; fetchedAt: string }
  | { kind: "deposit_ledger"; line: number; fileSha256: string };

export interface Identifier {
  /** Canonical role, e.g. "instruction_id" or "provider_payment_id". */
  role: string;
  /** The column (or API field) it was read from, exactly as the source names it. */
  sourceField: string;
  value: string;
}

interface RecordBase {
  /** Ours, deterministic: same input, same ID. Never shown in place of an original identifier. */
  recordId: string;
  kind: RecordKind;
  identifiers: Identifier[];
  /** When it happened according to its source, exactly as given (offset kept). */
  eventTime?: string;
  /** When we first read it (import time, or chain fetch time). */
  observedTime: string;
  /** Every observation. More than one means the same record arrived more than once (a duplicate record, not a second payment). */
  sources: SourceRef[];
  /** The source row as read, every column, unchanged. */
  original: Record<string, string>;
}

export interface InstructionRecord extends RecordBase {
  kind: "instruction";
  instructionId: string;
  chain?: Chain;
  token?: Token;
  toAddress?: string;
  amount: string;
  txHash?: string;
  transferIndex?: number;
  providerPaymentId?: string;
  /** Agreed deadline for the payment to complete (used by the overdue rule, chunk 2). */
  dueBy?: string;
}

/** What a provider status means, kept beside the raw status, never instead of it. */
export type ProviderStatusMeaning =
  | "pending" | "awaiting_approval" | "processing" | "on_hold"
  /** The provider reports it complete. This is not proof the beneficiary was credited. */
  | "provider_reports_complete"
  | "cancelled" | "expired" | "underpaid" | "overpaid" | "returned"
  /** The raw status is not in the mapping: shown as is, with no meaning assumed. */
  | "unmapped";

export type ProviderRowType = "principal" | "fee" | "return" | "other";

export interface ProviderRecord extends RecordBase {
  kind: "provider";
  provider: string;
  providerPaymentId: string;
  merchantReference?: string;
  txHash?: string;
  chain?: Chain;
  transferIndex?: number;
  typeRaw?: string;
  type: ProviderRowType;
  statusRaw: string;
  statusMeaning: ProviderStatusMeaning;
  /** Signed as the provider reports it. */
  amount: string;
  currency?: string;
  fee?: string;
  /** For a return or fee row: the payment it belongs to, by the provider's own identifier. */
  relatesTo?: string;
}

export interface BankRecord extends RecordBase {
  kind: "bank";
  bankReference: string;
  bookedAt: string;
  valueDate?: string;
  amount: string;
  currency: string;
  direction: "credit" | "debit";
  instructionId?: string;
  providerPaymentId?: string;
  /** Free text from the bank. Read as data only; never parsed into a link. */
  remittanceInfo?: string;
  /** For a returned payment: the bank reference of the original. */
  returnOf?: string;
}

export interface ChainTransferRecord extends RecordBase {
  kind: "chain_transfer";
  chain: Chain;
  /** Lower-case, no 0x: the join key. The original spelling is kept in identifiers. */
  txHash: string;
  /** Log index (EVM) or event index (Tron). Absent for a failed transaction with no transfer. */
  transferIndex?: number;
  txStatus: "success" | "failed";
  token?: string;
  tokenContract?: string;
  from?: string;
  to?: string;
  amount?: string;
  blockNumber: number;
  /** How many token transfers the whole transaction carries. */
  transfersInTx: number;
}

/** What a ledger status means, kept beside the raw status. */
export type LedgerStatusMeaning = "posted" | "pending" | "reversed" | "failed" | "unmapped";

export interface LedgerEntryRecord extends RecordBase {
  kind: "ledger";
  /** The company's payout ledger (mapped import), or File B (the deposit ledger). */
  ledger: "payout" | "deposit";
  entryId: string;
  chain?: Chain;
  txHash?: string;
  transferIndex?: number;
  /** Signed as the ledger books it. */
  amount: string;
  currency?: string;
  /** Raw status, as the ledger wrote it. */
  status: string;
  statusMeaning: LedgerStatusMeaning;
  instructionId?: string;
  providerPaymentId?: string;
  /** For a reversal entry: the entry ID it reverses. */
  reverses?: string;
  /** Deposit ledger (File B) rows: the deposit address credited. */
  toAddress?: string;
}

export type PaymentRecord = InstructionRecord | ProviderRecord | BankRecord | ChainTransferRecord | LedgerEntryRecord;

/** A hash we asked the chains about, and what they said. Errors are unknowns, never "not found". */
export interface ChainLookupSummary {
  txHash: string;
  /** "pending": a node knows it but it isn't mined yet. */
  result: "found" | "not_found" | "pending" | "error";
  /** Where it was found. With "found", the one chain; see `chains` when there are more. */
  chain?: Chain;
  /** Every chain it was found on. More than one goes to review. */
  chains?: Chain[];
  /** Chains that errored or only saw it pending, so "only on `chain`" isn't confirmed. */
  unresolved?: Chain[];
  checkedAt: string;
  error?: string;
}

// ---- Matching output ----

export type LegName = "instruction" | "chain" | "provider" | "bank" | "ledger";

export type LinkBasis =
  | "anchor"
  | "instruction_id"
  | "provider_payment_id"
  | "merchant_reference"
  | "chain_tx_index"
  /** Hash given without a transfer index, and the transaction carries exactly one token transfer. */
  | "chain_tx_single_transfer"
  /** A bank row's return-of column names the linked bank record. */
  | "return_of"
  /** A ledger entry's reverses column names the linked ledger entry. */
  | "reverses"
  /** A person confirmed this record for this leg (see the decision in the audit log). */
  | "confirmed";

export interface Link {
  recordId: string;
  basis: LinkBasis;
  /** Plain words: which identifier on which record equalled which. */
  detail: string;
}

/** A possible record for a leg, ranked by similarity. Never linked on this alone. */
export interface Candidate {
  recordId: string;
  score: number;
  reasons: string[];
  /** A provider record that had its own payment keeps that payment ID while it is held here. */
  reservedPaymentId?: string;
}

export type Leg =
  /** With a reviewId: linked, under review (a "direction changed" review waits for a person). */
  | { state: "linked"; links: Link[]; reviewId?: string }
  | { state: "missing"; suggestions: Candidate[]; note?: string }
  | { state: "needs_review"; reviewId: string }
  /** We couldn't find out (a chain lookup failed). Not the same as missing. */
  | { state: "unknown"; note: string }
  /** Not expected for this payment (e.g. no bank leg without bank records). */
  | { state: "not_applicable" };

export type ReviewReason =
  | "multiple_candidates"
  | "conflicting_ids"
  | "conflicting_record"
  | "chain_mismatch"
  /** A fee or return row relates to a provider payment, but the payment's provider leg isn't linked. */
  | "provider_leg_not_linked"
  /** A linked ledger entry's transfer now counts the other way (inbound vs outbound, per File A). */
  | "direction_changed";

/** A review is about one leg, or about the fee or return rows hanging off the provider leg. */
export type ReviewTarget = LegName | "returns" | "fees";

export interface ReviewItem {
  reviewId: string;
  paymentId: string;
  leg: ReviewTarget;
  reason: ReviewReason;
  message: string;
  /** The records involved, best-ranked first where a ranking applies. */
  candidates: Candidate[];
}

/**
 * A person's resolution of one review: confirm a candidate for a leg, or reject it. Kept for good
 * and re-applied on every run. The record key is stable for the thing decided on: a provider
 * payment ("provider:<provider>:<id>", all its status versions), a ledger entry
 * ("ledger:<ledger>:<entry id>"), otherwise the exact record (content included), so a changed
 * record is decided on again.
 */
export interface ReviewDecision {
  decisionId: string;
  reviewId: string;
  /** The payment's anchor key when decided ("instruction:<id>" or "provider:<provider>:<id>"). */
  anchorKey: string;
  paymentId: string;
  leg: ReviewTarget;
  action: "confirm" | "reject";
  recordKey: string;
  recordId: string;
  /** Self-declared until sign-in lands (week 5). */
  by: string;
  at: string;
  why: string;
}

export interface CanonicalPayment {
  paymentId: string;
  anchor: { kind: RecordKind; recordId: string };
  legs: Record<LegName, Leg>;
  /** Later returns or refunds, linked on an exact identifier only. */
  returns: Link[];
  /** Provider fee rows linked on an exact identifier. */
  fees: Link[];
  /** Every original identifier from every linked record. */
  identifiers: (Identifier & { recordId: string; kind: RecordKind })[];
  /** Linked records in event-time order; records without an event time go last. */
  timeline: { recordId: string; kind: RecordKind; eventTime?: string; observedTime: string; label: string }[];
  /** Records linked here that arrived more than once. */
  duplicateRecords: string[];
  /** Review decisions that shaped this payment. */
  decisions: ReviewDecision[];
}

/**
 * Where a payment ID that no payment carries any more now leads. IDs are never reused or dropped:
 *   merged: its records are linked into another payment;
 *   held_in_review: its records are candidates in a review on another payment;
 *   unheld: its records are no longer held (cleared); kept so the ID still explains itself.
 */
export type PaymentRedirect =
  | { from: string; reason: "merged"; to: { kind: "payment"; paymentId: string } }
  | { from: string; reason: "held_in_review"; to: { kind: "review"; reviewId: string; paymentId: string } }
  | { from: string; reason: "unheld"; to: { kind: "none" } };

export interface MatchResult {
  payments: CanonicalPayment[];
  reviews: ReviewItem[];
  /** Same ID, identical content, more than once: one record, every source kept. */
  duplicateRecords: { recordId: string; kind: RecordKind; sources: SourceRef[] }[];
  /** Records no payment links or reviews (e.g. a bank credit no identifier ties to anything). */
  unlinked: { recordId: string; kind: RecordKind }[];
  /**
   * Every payment ID ever assigned, by anchor key ("instruction:<id>", "provider:<provider>:<id>").
   * Fed back into the next run so an assigned ID never changes.
   */
  paymentIds: Record<string, string>;
  /** Every retired payment ID and where it leads now. Fed back into the next run. */
  redirects: Record<string, PaymentRedirect>;
  /** Linked ledger entries and the direction the transfer had then. Fed back into the next run. */
  ledgerLinks?: LedgerLink[];
  /** Deposit ledger rows on a payment's transfer whose direction can't be told (File A not loaded, no block time). */
  unclassifiedLedger?: { recordId: string; paymentId: string; note: string }[];
}

export type Direction = "inbound" | "outbound" | "unknown";
export interface LedgerLink { ledgerKey: string; paymentId: string; direction: Direction }
