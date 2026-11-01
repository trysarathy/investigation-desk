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
import { isUnknownOutcome, PartialPostError } from "../types";
import type { BooksAdapter, BooksInvoice, InvoiceLink, PostedLine, PostingLine } from "../types";

export const XERO_API = "https://api.xero.com/api.xro/2.0";

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
          Type: "ACCRECCREDIT", Contact: { ContactID: link.contactId }, Date: l.date, Status: "AUTHORISED", CurrencyCode: "USD", LineAmountTypes: "NoTax",
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
    // 4xx (429 rate limit, 400 validation) = nothing made; 5xx = unknown.
    if (!res.ok) throw Object.assign(new Error(`Xero ${method} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`), { unknownOutcome: res.status >= 500 });
    return (await res.json()) as Record<string, unknown>;
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
    const out: PostedLine[] = [];
    try {
    for (const [i, l] of lines.entries()) {
      const key = l.key ?? `${idempotencyKey}-${i}`;
      const { path, body } = xeroBody(link, l);
      const res = await this.call("PUT", path, body, key);
      if (l.kind === "payment") {
        out.push({ ...l, externalId: String((res.Payments as Record<string, unknown>[])[0]?.PaymentID), externalType: "Payment" });
      } else if (l.kind === "fee_writeoff") {
        const creditNoteId = String((res.CreditNotes as Record<string, unknown>[])[0]?.CreditNoteID);
        await this.call("PUT", `/CreditNotes/${creditNoteId}/Allocations`,
          { Allocations: [{ Invoice: { InvoiceID: link.invoiceId }, Amount: num(l.amount), Date: l.date }] }, `${key}-alloc`);
        out.push({ ...l, externalId: creditNoteId, externalType: "CreditNote" });
      } else if (l.kind === "overpayment") {
        const t = (res.BankTransactions as Record<string, unknown>[])[0] ?? {};
        out.push({ ...l, externalId: String(t.OverpaymentID ?? t.BankTransactionID), externalType: "Overpayment" });
      } else {
        out.push({ ...l, externalId: `history:${link.invoiceId}:${key}`, externalType: "HistoryNote" });
      }
    }
    } catch (e) {
      if (out.length) throw new PartialPostError(e instanceof Error ? e.message : String(e), out, isUnknownOutcome(e));
      throw e;
    }
    return out;
  }

  /**
   * After an unknown outcome, once Xero may have forgotten the key: is this line's record on the invoice?
   * Matched only by identity Clearline wrote (the payment's reference carries the tx hash; the one shortfall
   * credit note per invoice), never by amount alone. Anything it can't tell for sure throws: a person checks.
   */
  async readBack(link: InvoiceLink, l: PostingLine): Promise<PostedLine | undefined> {
    const cantTell = (why: string) => new Error(`Clearline can't confirm from Xero whether the ${l.kind.replace("_", " ")} on ${link.invoiceNumber} reached the books (${why}). Check the invoice in Xero.`);
    if (l.kind !== "payment" && l.kind !== "fee_writeoff") throw cantTell("Xero doesn't show it on the invoice");
    if (l.kind === "payment" && !l.txHash) throw cantTell("the line has no transaction hash");
    const inv = ((await this.call("GET", `/Invoices/${link.invoiceId}`)).Invoices as Record<string, unknown>[] | undefined)?.[0];
    if (!inv) throw cantTell("Xero didn't return the invoice");
    const recs = ((l.kind === "payment" ? inv.Payments : inv.CreditNotes) as Record<string, unknown>[] | undefined) ?? [];
    const ref = l.kind === "payment" ? xeroReference(l) : `Shortfall on ${link.invoiceNumber}`.slice(0, 255);
    const hit = recs.find((r) => r.Reference === ref);
    if (hit) {
      const amount = String(l.kind === "payment" ? hit.Amount : hit.Total);
      if (compareDecimal(amount, l.amount) !== 0) throw cantTell(`Xero shows ${amount}, the line is ${l.amount}`);
      return l.kind === "payment" ? { ...l, externalId: String(hit.PaymentID), externalType: "Payment" } : { ...l, externalId: String(hit.CreditNoteID), externalType: "CreditNote" };
    }
    // A credit note made but not yet allocated isn't on the invoice, so its absence there proves nothing.
    if (l.kind === "fee_writeoff") throw cantTell("no allocated credit note on the invoice");
    if (recs.some((r) => r.Reference === undefined)) throw cantTell("Xero didn't return payment references");
    return undefined;
  }
}
