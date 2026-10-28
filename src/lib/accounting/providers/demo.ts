// Demo books: a FICTIONAL organisation's invoices and payments, kept in Clearline's own data file.
// It behaves like the Xero adapter (same lines in, same kinds of records out) so the demo shows the
// real posting rules end to end, offline. Nothing here talks to Xero.

import { createHash } from "node:crypto";
import { add, sub } from "../../payments/money";
import { cmp, toCents } from "../rules";
import { PartialPostError } from "../types";
import type { BooksAdapter, BooksInvoice, DemoBooks, DemoInvoice, InvoiceLink, PostedLine, PostingLine } from "../types";

export const DEMO_ORG = "Northwind Pay Pte Ltd (demo books, fictional)";

const idFor = (seed: string) => {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

export const demoInvoiceId = (invoiceNumber: string) => idFor(`demo-invoice:${invoiceNumber}`);

export function emptyDemoBooks(): DemoBooks {
  return { orgName: DEMO_ORG, invoices: {}, entries: [] };
}

export function addDemoInvoice(books: DemoBooks, inv: { invoiceNumber: string; contactName: string; total: string }): DemoInvoice {
  const invoiceId = demoInvoiceId(inv.invoiceNumber);
  const invoice: DemoInvoice = {
    invoiceId, invoiceNumber: inv.invoiceNumber, contactName: inv.contactName, currency: "USD",
    total: toCents(inv.total), amountDue: toCents(inv.total), amountPaid: "0.00", amountCredited: "0.00", status: "AUTHORISED", history: [],
  };
  books.invoices[invoiceId] = invoice;
  return invoice;
}

/** Posts into the demo books. Mutates the books it was given (the service saves them). */
export class DemoBooksAdapter implements BooksAdapter {
  readonly provider = "demo" as const;
  constructor(private readonly books: DemoBooks, private readonly now: () => string) {}

  async listOpenInvoices(): Promise<BooksInvoice[]> {
    return Object.values(this.books.invoices).filter((i) => i.status === "AUTHORISED").map((i) => ({
      invoiceId: i.invoiceId, invoiceNumber: i.invoiceNumber, contactName: i.contactName, currency: i.currency, amountDue: i.amountDue, status: i.status,
    }));
  }

  async post(link: InvoiceLink, lines: PostingLine[], idempotencyKey: string): Promise<PostedLine[]> {
    const inv = this.books.invoices[link.invoiceId];
    if (!inv) throw new Error(`Invoice ${link.invoiceNumber} isn't in the demo books.`);
    const out: PostedLine[] = [];
    try {
    lines.forEach((l, i) => {
      const lineKey = `${idempotencyKey}-${i}`;
      const existing = this.books.entries.find((e) => e.reference.endsWith(`[${lineKey}]`));
      if (existing) { out.push({ ...l, externalId: existing.externalId, externalType: existing.externalType }); return; } // a retry: already there
      const externalId = idFor(`demo-entry:${lineKey}`);
      const reference = `${l.description} [${lineKey}]`;
      const at = this.now();
      if (l.kind === "payment" || l.kind === "fee_writeoff") {
        if (cmp(l.amount, inv.amountDue) > 0) throw new Error(`${l.amount} is more than the ${inv.amountDue} due on ${inv.invoiceNumber}.`);
        inv.amountDue = toCents(sub(inv.amountDue, l.amount));
        if (l.kind === "payment") inv.amountPaid = toCents(add(inv.amountPaid, l.amount)); else inv.amountCredited = toCents(add(inv.amountCredited, l.amount));
        if (cmp(inv.amountDue, "0") === 0) inv.status = "PAID";
        const type = l.kind === "payment" ? "Payment" : "CreditNote";
        this.books.entries.push({ externalId, externalType: type, invoiceId: inv.invoiceId, amount: l.amount, accountCode: l.accountCode, reference, date: l.date, createdAt: at });
        inv.history.push({ at, details: `${type === "Payment" ? "Payment" : "Credit note (fee write-off)"} of ${l.amount} USD applied by Clearline.` });
        out.push({ ...l, externalId, externalType: type });
      } else if (l.kind === "overpayment") {
        this.books.entries.push({ externalId, externalType: "Overpayment", invoiceId: inv.invoiceId, amount: l.amount, accountCode: l.accountCode, reference, date: l.date, createdAt: at });
        inv.history.push({ at, details: `Overpayment of ${l.amount} USD recorded by Clearline.` });
        out.push({ ...l, externalId, externalType: "Overpayment" });
      } else {
        this.books.entries.push({ externalId, externalType: "HistoryNote", invoiceId: inv.invoiceId, amount: "0", reference, date: l.date, createdAt: at });
        inv.history.push({ at, details: l.description });
        out.push({ ...l, externalId, externalType: "HistoryNote" });
      }
    });
    } catch (e) {
      if (out.length) throw new PartialPostError(e instanceof Error ? e.message : String(e), out);
      throw e;
    }
    return out;
  }
}
