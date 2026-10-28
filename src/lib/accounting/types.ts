// Accounting sync: the bridge from a matched stablecoin payment to the company's books.
//
// Read-only on-chain (nothing here holds keys or moves funds). Write access to the accounting
// system is used for one thing only: posting a payment plan a person has approved. Every posting,
// and every refusal to post, is kept in an append-only audit log.

/** Accounting systems Clearline can post to. "demo" is a fictional, simulated organisation. */
export type BooksProvider = "demo" | "xero" | "quickbooks" | "netsuite";

export const PROVIDER_LABEL: Record<BooksProvider, string> = {
  demo: "Demo books (simulated Xero-style organisation)",
  xero: "Xero",
  quickbooks: "QuickBooks Online",
  netsuite: "NetSuite",
};

/** The invoice in the accounting system that a payment request was made from. */
export interface InvoiceLink {
  provider: BooksProvider;
  /** The accounting system's own ID (Xero InvoiceID, QuickBooks Invoice Id). */
  invoiceId: string;
  /** What people see on the invoice: INV-1042. */
  invoiceNumber: string;
  contactId?: string;
  contactName: string;
  /** The invoice's currency. Only USD invoices are posted for now (USDC and USDT are dollar tokens). */
  currency: string;
  /** Amount due when the request was made. */
  amountDue: string;
  linkedAt: string;
  demo: boolean;
}

/** What each posted line represents. */
export type LineKind =
  | "payment"        // a transfer applied to the invoice
  | "fee_writeoff"   // an accepted shortfall (usually fees taken by the sender's exchange), written off to an expense account
  | "overpayment"    // money above the invoice: a refund due, or a credit the customer keeps
  | "note";          // a note added to the invoice's history (e.g. "short by 50.00, balance requested")

export interface PostingLine {
  kind: LineKind;
  /** USD amount, exact decimal string. "0" for a note. */
  amount: string;
  /** Account code in the accounting system (from the accounting settings). */
  accountCode?: string;
  description: string;
  /** The transfer this line comes from, when it comes from one. */
  observationKey?: string;
  txHash?: string;
  token?: string;
  network?: string;
  /** How many tokens, and the USD value used. */
  tokenAmount?: string;
  usdRate?: string;
  usdRateSource?: string;
  /** Payment date (the block time of the transfer), YYYY-MM-DD. */
  date: string;
}

/**
 * The outcome of applying the posting rules to one request:
 *  not_linked   the request didn't come from an invoice in the books
 *  waiting      nothing confirmed to post yet (or only confirming transfers)
 *  needs_decision  a person must decide first (over/duplicate payment with no decision yet)
 *  ready        a plan exists and waits for someone to approve it
 *  posted       everything that can be posted has been
 *  never        the money must never be posted (counterfeit token, wrong network)
 *  blocked      it can't be posted automatically for another reason (currency, cancelled invoice)
 */
export type PlanStatus = "not_linked" | "waiting" | "needs_decision" | "ready" | "posted" | "never" | "blocked";

export interface PostingPlan {
  requestId: string;
  status: PlanStatus;
  /** One line per reason, in plain English. */
  reasons: string[];
  lines: PostingLine[];
  /** The invoice stays open (a partial payment) after these lines post. */
  leavesOpen: boolean;
  /** Deterministic key for this exact plan: a retry with the same key never posts twice. */
  idempotencyKey: string;
}

/** One line as the accounting system recorded it. */
export interface PostedLine extends PostingLine {
  /** The accounting system's ID for what it created (PaymentID, CreditNoteID, BankTransactionID…). */
  externalId: string;
  externalType: string;
}

export type AuditKind = "approved" | "posted" | "failed" | "refused" | "linked" | "imported" | "connected";

/** One entry in the append-only audit log: what was posted, refused or changed, by whom and why. */
export interface AuditEntry {
  id: string;
  at: string;
  kind: AuditKind;
  by: string;
  provider: BooksProvider;
  requestId?: string;
  invoiceNumber?: string;
  /** Why: the rule that applied, or the error the accounting system returned. */
  reason: string;
  idempotencyKey?: string;
  lines?: PostedLine[];
  /** For a failure: the lines that were planned. */
  planned?: PostingLine[];
  demo: boolean;
}

/** Where each kind of line goes in the books. Codes follow Xero's demo company chart of accounts by default. */
export interface AccountSettings {
  /** The account the stablecoin wallet is held in (a bank or clearing account). */
  walletAccountCode: string;
  /** Expense account for accepted shortfalls (fees). */
  feeAccountCode: string;
  /** Liability account for overpayments that are due back to the customer. */
  overpaymentAccountCode: string;
}

export const DEFAULT_ACCOUNTS: AccountSettings = {
  walletAccountCode: "090",       // a bank/clearing account for the USDC wallet
  feeAccountCode: "404",          // Bank Fees in Xero's default chart
  overpaymentAccountCode: "801",  // a current liability: "Customer overpayments to refund"
};

/** A fictional organisation's books, used in demo mode only. Mirrors what a Xero org would hold. */
export interface DemoInvoice {
  invoiceId: string;
  invoiceNumber: string;
  contactName: string;
  currency: "USD";
  total: string;
  amountDue: string;
  amountPaid: string;
  amountCredited: string;
  status: "AUTHORISED" | "PAID";
  history: { at: string; details: string }[];
}

export interface DemoBooksEntry {
  externalId: string;
  externalType: "Payment" | "CreditNote" | "Overpayment" | "HistoryNote";
  invoiceId: string;
  amount: string;
  accountCode?: string;
  reference: string;
  date: string;
  createdAt: string;
}

export interface DemoBooks {
  orgName: string;
  invoices: Record<string, DemoInvoice>;
  entries: DemoBooksEntry[];
}

export interface AccountingData {
  version: 1;
  rev?: number;
  provider: BooksProvider;
  accounts: AccountSettings;
  /** requestId → the invoice it was made from. */
  links: Record<string, InvoiceLink>;
  /** Append-only. */
  audit: AuditEntry[];
  demoBooks?: DemoBooks;
}

export const emptyAccounting = (): AccountingData => ({ version: 1, provider: "demo", accounts: { ...DEFAULT_ACCOUNTS }, links: {}, audit: [] });

/** An invoice as an accounting system returns it, before it becomes a payment request. */
export interface BooksInvoice {
  invoiceId: string;
  invoiceNumber: string;
  contactId?: string;
  contactName: string;
  currency: string;
  amountDue: string;
  status: string;
}

/**
 * What every accounting system adapter implements. Reading invoices, and posting approved lines.
 * Nothing else writes to the books.
 */
export interface BooksAdapter {
  readonly provider: BooksProvider;
  listOpenInvoices(): Promise<BooksInvoice[]>;
  /** Post approved lines against one invoice. Must be safe to retry with the same idempotency key. */
  post(link: InvoiceLink, lines: PostingLine[], idempotencyKey: string): Promise<PostedLine[]>;
}
