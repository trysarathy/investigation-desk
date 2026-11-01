// Accounting sync: every posting rule (exact, short, over, duplicate, wrong network, counterfeit, no
// reference), the approval gate, idempotency, the audit log, the Xero and QuickBooks request shapes,
// and the demo books. Every transfer is synthetic and goes through the real request ingestion.

import { describe, expect, it } from "vitest";
import { approveAndPost, importInvoice, seedDemoBooks } from "@/lib/accounting/engine";
import { addDemoInvoice, DemoBooksAdapter, emptyDemoBooks } from "@/lib/accounting/providers/demo";
import { qboBodies, QuickBooksAdapter } from "@/lib/accounting/providers/quickbooks";
import { XeroAdapter, xeroBody, xeroReference, type Fetch } from "@/lib/accounting/providers/xero";
import { cmp, planPosting, toCents, totalOf, type PriceSource } from "@/lib/accounting/rules";
import { emptyAccounting, type AccountingData, type BooksAdapter, type InvoiceLink, type PostingLine } from "@/lib/accounting/types";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC, OFFICIAL_USDT } from "@/lib/requests/check";
import { addr, COUNTERFEIT_USDT, resetDemo } from "@/lib/requests/demo";
import { createRequest, decide, deriveRequest, ingest, unattributed } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";
import { USDT_TRON } from "@/lib/fixtures";

const NOW = "2026-10-25T09:00:00.000Z";
const t = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const sim = new SimulatedProvider();
const opts = { threshold: CONFIRMATIONS };

/** A request made from an invoice in the (demo) books, and the books holding that invoice. */
function invoiced(amount = "1000.00", id = "R1", token: "USDC" | "USDT" = "USDC") {
  const reqData = createRequest(emptyRequests(), { customerRef: "Acme", invoiceRef: `INV-${id}`, amount, receivingAddress: addr(id), token },
    { now: t(0), by: "Mei", demo: false, publicId: id, tokenContract: token === "USDT" ? OFFICIAL_USDT : OFFICIAL_USDC, id }).data;
  const books = emptyDemoBooks();
  const inv = addDemoInvoice(books, { invoiceNumber: `INV-${id}`, contactName: "Acme", total: amount });
  const link: InvoiceLink = { provider: "demo", invoiceId: inv.invoiceId, invoiceNumber: inv.invoiceNumber, contactId: "C-1", contactName: "Acme", currency: "USD", amountDue: amount, linkedAt: t(0), demo: false };
  const acct: AccountingData = { ...emptyAccounting(), links: { [id]: link }, demoBooks: books };
  return { reqData, acct, books, link };
}
const tx = (to: string, amount: string, seq: string, o: Partial<TransferEvent> = {}): TransferEvent =>
  ({ ...sim.send(emptyRequests(), { to, amount, tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr(`from:${seq}`), seq }),
    source: "live", demo: false, blockNumber: 900, blockTime: t(5), confirmations: CONFIRMATIONS, ...o });
const put = (d: RequestsData, ev: TransferEvent, at = t(6)) => ingest(d, ev, at, "test", checkObservation(at), CONFIRMATIONS).data;
const decideAs = (d: RequestsData, id: string, kind: Parameters<typeof decide>[2]["kind"], note = "Checked with the customer.", observationKey?: string) =>
  decide(d, id, { kind, note, observationKey }, { now: t(9), by: "Mei", threshold: CONFIRMATIONS, check: checkObservation(t(9)) }).data;
const post = (reqData: RequestsData, acct: AccountingData, adapter: BooksAdapter, id = "R1", expectedKey?: string) =>
  approveAndPost(reqData, acct, id, { ...opts, by: "Mei", now: t(10), adapter, expectedKey });


describe("PROBE", () => {
  it("probe", async () => {
    const { reqData: d0, acct, books } = invoiced("1000.00");
    let reqData = put(d0, tx(addr("R1"), "333.335", "a"));
    reqData = put(reqData, tx(addr("R1"), "333.335", "b", { blockTime: t(6) }), t(7));
    reqData = put(reqData, tx(addr("R1"), "333.33", "c", { blockTime: t(7) }), t(8));
    const plan = planPosting(reqData, acct, "R1", opts);
    console.log("PLAN3", plan.status, JSON.stringify(plan.lines.map((l) => [l.kind, l.amount])));
    const res = await post(reqData, acct, new DemoBooksAdapter(books, () => t(10)));
    console.log("POST3", res.error, JSON.stringify(Object.values(books.invoices).map(i => [i.amountDue, i.amountPaid, i.status])));
    const { reqData: e0, acct: a2 } = invoiced("20.00");
    const p1 = planPosting(put(e0, tx(addr("R1"), "10.005", "d")), a2, "R1", opts);
    console.log("SHORT1", JSON.stringify(p1.lines.map((l) => [l.kind, l.amount, l.tokenAmount])));
  });
});
