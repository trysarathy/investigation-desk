// QuickBooks Online adapter (sandbox first). Same lines in as Xero, mapped to QuickBooks records:
//   payment       POST /payment   with a Line linked to the invoice (LinkedTxn TxnType "Invoice")
//   fee_writeoff  POST /creditmemo for the shortfall, then POST /payment of 0 linking the credit memo to the invoice
//   overpayment   POST /payment   with no Line: QuickBooks keeps it as unapplied customer credit
//   note          added to the next payment's PrivateNote (QuickBooks has no invoice history API)
// Every write carries ?requestid=<key>, QuickBooks' idempotency mechanism.
//
// Setup: an Intuit developer app with a sandbox company; QBO_CLIENT_ID / QBO_CLIENT_SECRET in the
// server environment, and QBO_WRITEOFF_ITEM_ID (a service item mapped to the fee expense account).
// [ASSUMPTION] Built against the documented API shapes; not yet run against a sandbox company.

import type { BooksAdapter, BooksInvoice, InvoiceLink, PostedLine, PostingLine } from "../types";
import type { Fetch } from "./xero";

export const qboBase = (realmId: string, env = process.env.QBO_ENV ?? "sandbox") =>
  `${env === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com"}/v3/company/${realmId}`;

export interface QboCredentials { accessToken(): Promise<string>; realmId: string; writeoffItemId?: string }

const amt = (s: string) => Number(s);

export function qboBodies(link: InvoiceLink, l: PostingLine, pendingNote: string | undefined, writeoffItemId?: string) {
  const privateNote = [l.description, pendingNote].filter(Boolean).join(" | ").slice(0, 4000);
  switch (l.kind) {
    case "payment":
      return [{ path: "/payment", body: {
        CustomerRef: { value: link.contactId }, TotalAmt: amt(l.amount), TxnDate: l.date, PaymentRefNum: (l.txHash ?? "").slice(0, 21),
        PrivateNote: privateNote, DepositToAccountRef: l.accountCode ? { value: l.accountCode } : undefined,
        Line: [{ Amount: amt(l.amount), LinkedTxn: [{ TxnId: link.invoiceId, TxnType: "Invoice" }] }],
      } }];
    case "fee_writeoff":
      return [
        { path: "/creditmemo", body: { CustomerRef: { value: link.contactId }, TxnDate: l.date, PrivateNote: privateNote,
          Line: [{ Amount: amt(l.amount), DetailType: "SalesItemLineDetail", Description: l.description.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: writeoffItemId } } }] } },
        // second call links the new credit memo (id filled in by the adapter) to the invoice with a zero payment
      ];
    case "overpayment":
      return [{ path: "/payment", body: { CustomerRef: { value: link.contactId }, TotalAmt: amt(l.amount), TxnDate: l.date, PaymentRefNum: (l.txHash ?? "").slice(0, 21), PrivateNote: privateNote } }];
    case "note":
      return [];
  }
}

export class QuickBooksAdapter implements BooksAdapter {
  readonly provider = "quickbooks" as const;
  constructor(private readonly creds: QboCredentials, private readonly fetchFn: Fetch = fetch as unknown as Fetch) {}

  private async call(method: "GET" | "POST", path: string, body?: unknown, requestId?: string): Promise<Record<string, unknown>> {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${qboBase(this.creds.realmId)}${path}${sep}minorversion=75${requestId ? `&requestid=${encodeURIComponent(requestId)}` : ""}`;
    const res = await this.fetchFn(url, { method, headers: { Authorization: `Bearer ${await this.creds.accessToken()}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new Error(`QuickBooks ${method} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async listOpenInvoices(): Promise<BooksInvoice[]> {
    const q = encodeURIComponent("select * from Invoice where Balance > '0' maxresults 200");
    const res = await this.call("GET", `/query?query=${q}`);
    const list = ((res.QueryResponse as Record<string, unknown> | undefined)?.Invoice as Record<string, unknown>[] | undefined) ?? [];
    return list.map((i) => {
      const c = (i.CustomerRef ?? {}) as Record<string, string>;
      const cur = (i.CurrencyRef ?? {}) as Record<string, string>;
      return { invoiceId: String(i.Id), invoiceNumber: String(i.DocNumber ?? i.Id), contactId: c.value, contactName: c.name ?? "", currency: cur.value ?? "USD", amountDue: String(i.Balance ?? "0"), status: "OPEN" };
    });
  }

  async post(link: InvoiceLink, lines: PostingLine[], idempotencyKey: string): Promise<PostedLine[]> {
    const out: PostedLine[] = [];
    const note = lines.find((l) => l.kind === "note")?.description;
    for (const [i, l] of lines.entries()) {
      const key = `${idempotencyKey}-${i}`;
      if (l.kind === "note") { out.push({ ...l, externalId: `note:${link.invoiceId}:${key}`, externalType: "PrivateNote" }); continue; }
      const [first] = qboBodies(link, l, l.kind === "payment" ? note : undefined, this.creds.writeoffItemId);
      const res = await this.call("POST", first.path, first.body, key);
      if (l.kind === "fee_writeoff") {
        const memoId = String((res.CreditMemo as Record<string, unknown>)?.Id);
        await this.call("POST", "/payment", { CustomerRef: { value: link.contactId }, TotalAmt: 0, TxnDate: l.date,
          Line: [{ Amount: amt(l.amount), LinkedTxn: [{ TxnId: link.invoiceId, TxnType: "Invoice" }] }, { Amount: amt(l.amount), LinkedTxn: [{ TxnId: memoId, TxnType: "CreditMemo" }] }] }, `${key}-link`);
        out.push({ ...l, externalId: memoId, externalType: "CreditMemo" });
      } else {
        out.push({ ...l, externalId: String((res.Payment as Record<string, unknown>)?.Id), externalType: l.kind === "payment" ? "Payment" : "UnappliedPayment" });
      }
    }
    return out;
  }
}
