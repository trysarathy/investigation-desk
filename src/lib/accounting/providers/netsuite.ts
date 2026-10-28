// NetSuite: the interface only. Designed, not built (see docs/ACCOUNTING_SYNC.md).
//
// Planned mapping, through SuiteTalk REST Web Services (record API), token-based or OAuth 2.0 M2M auth:
//   payment       POST /record/v1/customerPayment   { customer, account, tranDate, payment, memo, apply: { items: [{ doc: invoiceId, apply: true, amount }] } }
//   fee_writeoff  POST /record/v1/creditMemo         then apply it to the invoice on the next customerPayment
//   overpayment   POST /record/v1/customerPayment   with no apply lines (unapplied credit), or a customerDeposit
//   note          PATCH /record/v1/invoice/{id}     memo, or a custom "Clearline audit" field
// Idempotency: an external ID on each record (externalId = the line's idempotency key), which
// NetSuite rejects if it already exists.

import type { BooksAdapter, BooksInvoice, InvoiceLink, PostedLine, PostingLine } from "../types";

export class NetSuiteAdapter implements BooksAdapter {
  readonly provider = "netsuite" as const;
  async listOpenInvoices(): Promise<BooksInvoice[]> { throw new Error("NetSuite isn't built yet: designed only (docs/ACCOUNTING_SYNC.md)."); }
  async post(_link: InvoiceLink, _lines: PostingLine[], _key: string): Promise<PostedLine[]> { throw new Error("NetSuite isn't built yet: designed only (docs/ACCOUNTING_SYNC.md)."); }
}
