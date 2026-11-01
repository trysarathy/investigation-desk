// Xero adapter: reads open sales invoices and posts approved lines through the Xero Accounting API.
//
// Each kind of line maps to one Xero record:
//   payment       PUT /Payments                         (applied to the invoice, Account = the wallet's bank/clearing account)
//   fee_writeoff  PUT /CreditNotes, then PUT /CreditNotes/{id}/Allocations   (allocated to the invoice, line to the fee account)
//   overpayment   PUT /BankTransactions Type RECEIVE-OVERPAYMENT             (a customer overpayment, refundable or kept as credit)
//   note          PUT /Invoices/{id}/History            (a history note on the invoice)
// Every write carries the line's own Idempotency-Key (see `lineKey` in ../rules), the same on every retry.
// Xero keeps a key 6 minutes from the first call and caches the response; after that a reused key is
// processed as new, so after an unknown outcome the engine reads back (`readBack`) before re-sending.
// The access token comes from the OAuth connection (see ./xero-auth.ts); this file never stores it.

import { compareDecimal } from "../../decimal";
import { add } from "../../payments/money";
import { isUnknownOutcome, PartialPostError } from "../types";
import type { BooksAdapter, BooksInvoice, InvoiceLink, MadeRecord, PostedLine, PostingLine } from "../types";

export const XERO_API = "https://api.xero.com/api.xro/2.0";

/** The currency Clearline posts in: only USD invoices are imported (engine `importInvoice`). */
export const POSTING_CURRENCY = "USD";

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface XeroCredentials { accessToken(): Promise<string>; tenantId: string }

/** The reference Xero shows on the payment: short, with the tx hash so an accountant can trace it. */
export function xeroReference(l: PostingLine): string {
  const parts = [l.token && l.network ? `${l.token} on ${l.network}` : undefined, l.txHash ? `tx ${l.txHash}` : undefined, l.usdRate ? `@${l.usdRate} USD` : undefined];
  return parts.filter(Boolean).join(" · ").slice(0, 255) || "Clearline";
}

const num = (s: string) => Number(s); // Xero's JSON takes numbers; amounts are already rounded to cents

/** The request body for each line kind. Exported so the tests can check the exact shapes. */
export function xeroBody(link: InvoiceLink, l: PostingLine) {
  switch (l.kind) {
    case "payment":
      return { path: "/Payments", body: { Payments: [{ Invoice: { InvoiceID: link.invoiceId }, Account: { Code: l.accountCode }, Date: l.date, Amount: num(l.amount), Reference: xeroReference(l) }] } };
    case "fee_writeoff":
      return {
        path: "/CreditNotes",
        body: { CreditNotes: [{
          Type: "ACCRECCREDIT", Contact: { ContactID: link.contactId }, Date: l.date, Status: "AUTHORISED", CurrencyCode: POSTING_CURRENCY, LineAmountTypes: "NoTax",
          Reference: `Shortfall on ${link.invoiceNumber}`.slice(0, 255),
          LineItems: [{ Description: l.description.slice(0, 4000), Quantity: 1, UnitAmount: num(l.amount), AccountCode: l.accountCode }],
        }] },
      };
    case "overpayment":
      return {
        path: "/BankTransactions",
        body: { BankTransactions: [{
          Type: "RECEIVE-OVERPAYMENT", Contact: { ContactID: link.contactId }, BankAccount: { Code: l.accountCode }, Date: l.date,
          Reference: `${/refund/i.test(l.description) ? "To refund" : "Customer credit"} · ${xeroReference(l)}`.slice(0, 255), LineAmountTypes: "NoTax", LineItems: [{ Description: l.description.slice(0, 4000), LineAmount: num(l.amount) }],
        }] },
      };
    case "note":
      return { path: `/Invoices/${link.invoiceId}/History`, body: { HistoryRecords: [{ Details: l.description.slice(0, 2500) }] } };
  }
}

export class XeroAdapter implements BooksAdapter {
  readonly provider = "xero" as const;
  constructor(private readonly creds: XeroCredentials, private readonly fetchFn: Fetch = fetch as unknown as Fetch) {}

  private async call(method: "GET" | "PUT", path: string, body?: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.creds.accessToken()}`,
      "xero-tenant-id": this.creds.tenantId,
      Accept: "application/json",
    };
    if (body) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await this.fetchFn(`${XERO_API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { // no response at all (timeout, connection reset): Xero may or may not have made the record
      throw Object.assign(new Error(`Xero ${method} ${path}: no response (${e instanceof Error ? e.message : String(e)})`), { unknownOutcome: true });
    }
    // Only a 4xx answer (429 rate limit, 400 validation) means nothing was made. Anything else once the
    // request was sent (5xx, a reply that can't be read) is an unknown outcome.
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`Xero ${method} ${path} failed (${res.status}): ${text.slice(0, 300)}`), { unknownOutcome: res.status < 400 || res.status >= 500 });
    }
    try {
      return (await res.json()) as Record<string, unknown>;
    } catch {
      throw Object.assign(new Error(`Xero ${method} ${path} answered ${res.status} but the reply couldn't be read`), { unknownOutcome: true });
    }
  }

  async listOpenInvoices(): Promise<BooksInvoice[]> {
    const where = encodeURIComponent('Type=="ACCREC"&&Status=="AUTHORISED"');
    const res = await this.call("GET", `/Invoices?where=${where}&summaryOnly=true`);
    const list = (res.Invoices as Record<string, unknown>[] | undefined) ?? [];
    return list.map((i) => {
      const c = (i.Contact ?? {}) as Record<string, string>;
      return {
        invoiceId: String(i.InvoiceID), invoiceNumber: String(i.InvoiceNumber ?? ""), contactId: c.ContactID, contactName: c.Name ?? "",
        currency: String(i.CurrencyCode ?? ""), amountDue: String(i.AmountDue ?? "0"), status: String(i.Status ?? ""),
      };
    });
  }

  async post(link: InvoiceLink, lines: PostingLine[], idempotencyKey: string): Promise<PostedLine[]> {
    // An answer without the record's id counts as unknown: Xero may well have made it.
    const idOf = (res: Record<string, unknown>, list: string, ...fields: string[]) => {
      const rec = (res[list] as Record<string, unknown>[] | undefined)?.[0] ?? {};
      const id = fields.map((f) => rec[f]).find((v) => v != null);
      if (id == null) throw Object.assign(new Error(`Xero's reply to ${list} had no ${fields[0]}`), { unknownOutcome: true });
      return String(id);
    };
    const out: PostedLine[] = [];
    const made: Record<string, MadeRecord> = {};
    let key = "";
    try {
      for (const [i, l] of lines.entries()) {
        key = l.key ?? `${idempotencyKey}-${i}`;
        const { path, body } = xeroBody(link, l);
        if (l.kind === "fee_writeoff") {
          // Two calls. Once the credit note exists it is never created again: a failed allocation is retried against it.
          const creditNoteId = l.madeId ?? idOf(await this.call("PUT", path, body, key), "CreditNotes", "CreditNoteID");
          made[key] = { id: creditNoteId, amount: l.amount, currency: POSTING_CURRENCY }; // the CurrencyCode xeroBody sent
          await this.call("PUT", `/CreditNotes/${creditNoteId}/Allocations`,
            { Allocations: [{ Invoice: { InvoiceID: link.invoiceId }, Amount: num(l.amount), Date: l.date }] }, `${key}-alloc`);
          delete made[key];
          out.push({ ...l, externalId: creditNoteId, externalType: "CreditNote" });
          continue;
        }
        const res = await this.call("PUT", path, body, key);
        if (l.kind === "payment") out.push({ ...l, externalId: idOf(res, "Payments", "PaymentID"), externalType: "Payment" });
        else if (l.kind === "overpayment") out.push({ ...l, externalId: idOf(res, "BankTransactions", "OverpaymentID", "BankTransactionID"), externalType: "Overpayment" });
        else out.push({ ...l, externalId: `history:${link.invoiceId}:${key}`, externalType: "HistoryNote" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const extra = { unknownOutcome: isUnknownOutcome(e), inFlight: key, made };
      if (out.length) throw new PartialPostError(msg, out, extra);
      throw Object.assign(e instanceof Error ? e : new Error(msg), extra);
    }
    return out;
  }

  /**
   * After an unknown outcome, once Xero may have forgotten the key: is this line's record in Xero?
   * Matched only by identity Clearline wrote (the payment's reference carries the tx hash; the credit note's
   * id or its "Shortfall on" reference; the note's exact text), never by amount alone. "Absent" also needs
   * the invoice's AmountPaid / AmountCredited to equal what Clearline recorded. Anything unclear throws.
   */
  async readBack(link: InvoiceLink, l: PostingLine, recorded: PostedLine[]): Promise<PostedLine | undefined> {
    const cantTell = (why: string) => new Error(`Clearline can't confirm from Xero whether the ${l.kind.replace("_", " ")} on ${link.invoiceNumber} reached the books (${why}). Check the invoice in Xero.`);
    if (l.kind === "note") {
      const hist = ((await this.call("GET", `/Invoices/${link.invoiceId}/History`)).HistoryRecords as Record<string, unknown>[] | undefined) ?? [];
      return hist.some((h) => h.Details === l.description.slice(0, 2500)) ? { ...l, externalId: `history:${link.invoiceId}:${l.key}`, externalType: "HistoryNote" } : undefined;
    }
    if (l.kind === "overpayment") throw cantTell("Xero doesn't show it on the invoice");
    if (l.kind === "payment" && !l.txHash) throw cantTell("the line has no transaction hash");
    const inv = ((await this.call("GET", `/Invoices/${link.invoiceId}`)).Invoices as Record<string, unknown>[] | undefined)?.[0];
    if (!inv) throw cantTell("Xero didn't return the invoice");
    const pay = l.kind === "payment";
    const recs = ((pay ? inv.Payments : inv.CreditNotes) as Record<string, unknown>[] | undefined) ?? [];
    const ref = pay ? xeroReference(l) : `Shortfall on ${link.invoiceNumber}`.slice(0, 255);
    const hit = recs.find((r) => (!pay && l.madeId ? r.CreditNoteID === l.madeId : r.Reference === ref));
    if (hit) {
      const amount = String(pay ? hit.Amount : hit.Total);
      if (compareDecimal(amount, l.amount) !== 0) throw cantTell(`Xero shows ${amount}, the line is ${l.amount}`);
      return pay ? { ...l, externalId: String(hit.PaymentID), externalType: "Payment" } : { ...l, externalId: String(hit.CreditNoteID), externalType: "CreditNote" };
    }
    // A credit note made but not allocated isn't on the invoice, so its absence there proves nothing unless we hold its id.
    if (!pay && !l.madeId) throw cantTell("no allocated credit note on the invoice");
    if (pay && recs.some((r) => r.Reference === undefined)) throw cantTell("Xero didn't return payment references");
    const field = pay ? "AmountPaid" : "AmountCredited";
    const ours = recorded.filter((x) => x.kind === l.kind).reduce((s, x) => add(s, x.amount), "0");
    if (typeof inv[field] !== "number" || compareDecimal(String(inv[field]), ours) !== 0) throw cantTell(`Xero's ${field} is ${String(inv[field])}, Clearline recorded ${ours}`);
    return undefined;
  }
}
