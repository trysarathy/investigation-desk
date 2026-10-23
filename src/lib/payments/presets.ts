// Starting mappings. Each is an ordinary saved mapping (version 1); editing one saves version 2.
// BVNK is the first provider reference format (spec 23 Oct). Nothing in the matcher is BVNK
// specific: another provider is another mapping with its own columns, statuses and row types.

import type { ColumnMapping } from "./mapping";

const CREATED = "2026-10-23T00:00:00Z";

const BVNK_DOCS = {
  csvReport: "https://help.bvnk.com/hc/en-us/articles/19635415278866-Downloading-CSV-reports-once-off-or-scheduled",
  reconcile: "https://docs.bvnk.com/bvnk/reconciliation/reconcile-transactions/",
  glossary: "https://docs.bvnk.com/bvnk/references/glossary/",
  paymentRead: "https://docs.bvnk.com/bvnk/api-explorer/endpoints/payment-read/",
  payoutOverview: "https://docs.bvnk.com/bvnk/use-cases/stablecoin-payments-for-platforms/payout-overview/",
  payoutRead: "https://docs.bvnk.com/bvnk/api-explorer/endpoints/payout-read/",
  payoutWebhook: "https://docs.bvnk.com/docs/listening-for-payout-webhooks-2",
  cryptoStatus: "https://help.bvnk.com/hc/en-us/articles/21881129577874-Understanding-the-status-of-a-crypto-payment",
} as const;

/**
 * BVNK Merchant Portal transaction export ("Transaction Balance Report").
 * Column names follow BVNK's header reference guide and reconciliation page; statuses follow
 * the payment status enum and the payout pages. BVNK's report has no network or transfer-index
 * column, so the chain leg links on the hash alone (see the matcher's single-transfer rule).
 */
export const BVNK_TRANSACTION_REPORT: ColumnMapping = {
  mappingId: "bvnk-transaction-report",
  version: 1,
  kind: "provider",
  name: "BVNK transaction report (reference format)",
  provider: "BVNK",
  createdAt: CREATED,
  columns: {
    provider_payment_id: "Transaction ID",
    provider_uuid: "Transaction UUID",
    merchant_reference: "Merchant Reference",
    tx_hash: "Transaction Hash",
    type: "Transaction Type",
    status: "Payment Status",
    event_time: "Date Created",
    amount: "Amount",
    currency: "Currency",
    description: "Description",
  },
  values: {
    status: {
      PENDING: "pending",
      PENDING_APPROVAL: "awaiting_approval",
      PROCESSING: "processing",
      // BVNK: COMPLETE once the transaction is registered on-chain with a hash. That is the
      // provider's view of its own leg, not proof the beneficiary was credited.
      COMPLETE: "provider_reports_complete",
      // The payout webhook example spells it COMPLETED.
      COMPLETED: "provider_reports_complete",
      CANCELLED: "cancelled",
      EXPIRED: "expired",
      UNDERPAID: "underpaid",
      OVERPAID: "overpaid",
    },
    type: { PAYIN: "principal", PAYOUT: "principal", FEE: "fee" },
  },
  timestampFormat: "iso8601_offset",
  sources: [
    { about: "Column names: Transaction ID (BVNK-generated), Transaction UUID, Transaction Hash, Date Created, Transaction Type, Description, Amount, Currency", url: BVNK_DOCS.csvReport },
    { about: "Match on Transaction ID, Transaction UUID or Merchant Reference; Payment Status values; Transaction Type values PAYIN, PAYOUT, FEE", url: BVNK_DOCS.reconcile },
    { about: "Payment status enum PENDING, PROCESSING, CANCELLED, COMPLETE, UNDERPAID, OVERPAID, EXPIRED; reference is the merchant's own payment reference", url: BVNK_DOCS.paymentRead },
    { about: "Payout states PENDING, PROCESSING, COMPLETE (on-chain with a hash), CANCELLED (cancelled or failed)", url: BVNK_DOCS.payoutOverview },
    { about: "PENDING_APPROVAL applies to fiat payouts only", url: BVNK_DOCS.payoutRead },
    { about: "Payout status-change webhook; example status COMPLETED", url: BVNK_DOCS.payoutWebhook },
    { about: "transactionReference, customerReference", url: BVNK_DOCS.glossary },
    { about: "On-hold state for security review (exact status spelling not published, so not mapped: it shows raw)", url: BVNK_DOCS.cryptoStatus },
  ],
  notes: [
    "Check against a real export before a pilot: the help-centre header guide was read only in part, and the timestamp format of Date Created is not documented (ISO 8601 with offset is assumed; switch the mapping to epoch milliseconds if the export uses them).",
    "Statuses not listed here are kept raw and shown as unmapped; none is guessed.",
  ],
};

export const INSTRUCTIONS_STANDARD: ColumnMapping = {
  mappingId: "instructions-standard",
  version: 1,
  kind: "instruction",
  name: "Payment instructions (standard columns)",
  createdAt: CREATED,
  columns: {
    instruction_id: "instruction_id", created_at: "created_at", amount: "amount", chain: "chain", token: "token",
    to_address: "to_address", tx_hash: "tx_hash", transfer_index: "transfer_index",
    provider_payment_id: "provider_payment_id", due_by: "due_by",
  },
  timestampFormat: "iso8601_offset",
};

export const BANK_STANDARD: ColumnMapping = {
  mappingId: "bank-standard",
  version: 1,
  kind: "bank",
  name: "Bank records (standard columns)",
  createdAt: CREATED,
  columns: {
    bank_reference: "bank_reference", booked_at: "booked_at", value_date: "value_date", amount: "amount",
    currency: "currency", direction: "direction", instruction_id: "instruction_id",
    provider_payment_id: "provider_payment_id", remittance_info: "remittance_info", return_of: "return_of",
  },
  values: { direction: { CRDT: "credit", DBIT: "debit", credit: "credit", debit: "debit" } },
  timestampFormat: "iso8601_offset",
};

export const PRESET_MAPPINGS: ColumnMapping[] = [INSTRUCTIONS_STANDARD, BVNK_TRANSACTION_REPORT, BANK_STANDARD];
