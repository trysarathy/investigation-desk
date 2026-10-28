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

describe("posting rules", () => {
  it("exact: one payment applied to the invoice, with tx hash, token, network and USD value", async () => {
    const { reqData: d0, acct, books } = invoiced("1000.00");
    const reqData = put(d0, tx(addr("R1"), "1000.00", "a"));
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.status).toBe("ready");
    expect(plan.lines).toHaveLength(1);
    const [l] = plan.lines;
    expect(l).toMatchObject({ kind: "payment", amount: "1000.00", token: "USDC", network: "Ethereum", usdRate: "1.00", tokenAmount: "1000.00", date: t(5).slice(0, 10) });
    expect(l.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(l.description).toContain(l.txHash!);
    expect(l.usdRateSource).toMatch(/par/);
    const res = await post(reqData, acct, new DemoBooksAdapter(books, () => t(10)));
    expect(res.error).toBeUndefined();
    expect(Object.values(books.invoices)[0]).toMatchObject({ status: "PAID", amountDue: "0.00", amountPaid: "1000.00" });
    expect(res.acct.audit.map((e) => e.kind)).toEqual(["approved", "posted"]);
    expect(res.acct.audit[1].lines?.[0].externalType).toBe("Payment");
  });

  it("short: posts a partial payment and a note; the invoice stays open", async () => {
    const { reqData: d0, acct, books } = invoiced("5000.00");
    const reqData = put(d0, tx(addr("R1"), "4950.00", "a"));
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.status).toBe("ready");
    expect(plan.leavesOpen).toBe(true);
    expect(plan.lines.map((l) => [l.kind, l.amount])).toEqual([["payment", "4950.00"], ["note", "0"]]);
    expect(plan.lines[1].description).toMatch(/Short by 50\.00/);
    const res = await post(reqData, acct, new DemoBooksAdapter(books, () => t(10)));
    expect(Object.values(books.invoices)[0]).toMatchObject({ status: "AUTHORISED", amountDue: "50.00" });
    expect(Object.values(books.invoices)[0].history.at(-1)?.details).toMatch(/Short by 50\.00/);
    // The balance arrives later: only the new transfer posts, and the invoice closes.
    const later = put(reqData, tx(addr("R1"), "50.00", "b", { blockTime: t(60) }), t(61));
    const plan2 = planPosting(later, res.acct, "R1", opts);
    expect(plan2.lines.map((l) => [l.kind, l.amount])).toEqual([["payment", "50.00"]]);
    await post(later, res.acct, new DemoBooksAdapter(books, () => t(70)));
    expect(Object.values(books.invoices)[0]).toMatchObject({ status: "PAID", amountDue: "0.00" });
  });

  it("short, accepted as settled: the shortfall posts as a separate fee line and the invoice closes", async () => {
    const { reqData: d0, acct, books } = invoiced("5000.00");
    const reqData = decideAs(put(d0, tx(addr("R1"), "4950.00", "a")), "R1", "accept_short", "Exchange fee; agreed with Priya.");
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.lines.map((l) => [l.kind, l.amount, l.accountCode])).toEqual([["payment", "4950.00", "090"], ["fee_writeoff", "50.00", "404"]]);
    expect(plan.leavesOpen).toBe(false);
    await post(reqData, acct, new DemoBooksAdapter(books, () => t(10)));
    expect(Object.values(books.invoices)[0]).toMatchObject({ status: "PAID", amountPaid: "4950.00", amountCredited: "50.00" });
  });

  it("over: needs a decision first; then the invoice amount posts once and the excess separately", async () => {
    const { reqData: d0, acct, books } = invoiced("1000.00");
    const paid = put(d0, tx(addr("R1"), "1200.00", "a"));
    const undecided = planPosting(paid, acct, "R1", opts);
    expect(undecided.status).toBe("needs_decision");
    const refused = await post(paid, acct, new DemoBooksAdapter(books, () => t(10)));
    expect(refused.error).toMatch(/refunded or kept/);
    expect(refused.acct.audit.at(-1)?.kind).toBe("refused");
    expect(books.entries).toHaveLength(0); // nothing reached the books
    const kept = decideAs(paid, "R1", "accept_over");
    const plan = planPosting(kept, acct, "R1", opts);
    expect(plan.status).toBe("ready");
    expect(plan.lines.map((l) => [l.kind, l.amount])).toEqual([["payment", "1000.00"], ["overpayment", "200.00"]]);
    expect(plan.lines[1].description).toMatch(/customer credit/);
  });

  it("duplicate: paid twice posts one payment and one overpayment to refund, never two payments", async () => {
    const { reqData: d0, acct, books } = invoiced("1980.00");
    let reqData = put(d0, tx(addr("R1"), "1980.00", "a"));
    reqData = put(reqData, tx(addr("R1"), "1980.00", "b", { blockTime: t(9) }), t(10));
    expect(deriveRequest(reqData, reqData.requests.R1, CONFIRMATIONS).duplicate).toBe(true);
    reqData = decideAs(reqData, "R1", "refund_excess", "Kestrel asked for the refund.");
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.lines.map((l) => [l.kind, l.amount, l.accountCode])).toEqual([["payment", "1980.00", "090"], ["overpayment", "1980.00", "090"]]); // received into the wallet's bank account, never a liability code
    expect(totalOf(plan.lines, "payment")).toBe("1980");
    expect(plan.lines[1].description).toMatch(/refund.*paid twice/);
    const res = await post(reqData, acct, new DemoBooksAdapter(books, () => t(11)));
    expect(books.entries.filter((e) => e.externalType === "Payment")).toHaveLength(1);
    expect(books.entries.filter((e) => e.externalType === "Overpayment")).toHaveLength(1);
    // The same chain event delivered again changes nothing and posts nothing.
    const again = put(reqData, tx(addr("R1"), "1980.00", "b", { blockTime: t(9) }), t(12));
    expect(planPosting(again, res.acct, "R1", opts).status).toBe("posted");
  });

  it("wrong network: never posted, even after a person accepts it", async () => {
    const { reqData: d0, acct, books } = invoiced("3200.00", "R1", "USDT");
    const tron = tx(addr("R1"), "3200.00", "tron", { chain: "tron", tokenContract: USDT_TRON, tokenSymbol: "USDT" });
    const reqData = ingest(d0, tron, t(6), "test", checkObservation(t(6)), CONFIRMATIONS, { claimedFor: "R1" }).data;
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.status).toBe("never");
    expect(plan.lines).toHaveLength(0);
    expect(plan.reasons.join(" ")).toMatch(/never posted: it was sent on Tron/);
    const res = await post(reqData, acct, new DemoBooksAdapter(books, () => t(10)));
    expect(res.error).toBeTruthy();
    expect(res.acct.audit.at(-1)).toMatchObject({ kind: "refused" });
    expect(books.entries).toHaveLength(0);
  });

  it("counterfeit: never posted", async () => {
    const { reqData: d0, acct, books } = invoiced("7500.00", "R1", "USDT");
    const fake = tx(addr("R1"), "7500.00", "fake", { tokenContract: COUNTERFEIT_USDT, tokenSymbol: "USDT" });
    const reqData = put(d0, fake);
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.status).toBe("never");
    expect(plan.reasons.join(" ")).toMatch(/never posted: it isn't genuine USDT/);
    const res = await post(reqData, acct, new DemoBooksAdapter(books, () => t(10)));
    expect(res.acct.audit.at(-1)).toMatchObject({ kind: "refused" });
    expect(books.entries).toHaveLength(0);
    expect(Object.values(books.invoices)[0].status).toBe("AUTHORISED");
  });

  it("no reference: nothing posts until a person confirms which invoice it pays; then it posts as exact", async () => {
    const { reqData: d0, acct } = invoiced("2180.00");
    const treasury = addr("treasury");
    // The business's main address (on its website): money there has no invoice reference.
    let reqData = put({ ...d0, wallets: [{ chain: "ethereum", address: treasury, label: "Main receiving address", demo: false }] }, tx(treasury, "2180.00", "kite"));
    expect(unattributed(reqData)).toHaveLength(1);
    const before = planPosting(reqData, acct, "R1", opts);
    expect(before.status).toBe("waiting");
    expect(before.reasons.join(" ")).toMatch(/no reference posts only after a person confirms/);
    const key = unattributed(reqData)[0].key;
    const { assignUnmatched } = await import("@/lib/requests/lifecycle");
    reqData = assignUnmatched(reqData, key, "R1", "Kite's remittance email names INV-R1.", { now: t(8), by: "Mei", threshold: CONFIRMATIONS, check: checkObservation(t(8)) }).data;
    const after = planPosting(reqData, acct, "R1", opts);
    expect(after.status).toBe("ready");
    expect(after.lines.map((l) => [l.kind, l.amount])).toEqual([["payment", "2180.00"]]);
  });

  it("confirming transfers wait; nothing posts before the confirmations", () => {
    const { reqData: d0, acct } = invoiced("1000.00");
    const reqData = put(d0, tx(addr("R1"), "1000.00", "a", { confirmations: 2 }));
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.status).toBe("waiting");
    expect(plan.reasons[0]).toMatch(/still confirming/);
  });

  it("only USD invoices, only near-par prices, only linked requests", () => {
    const { reqData: d0, acct } = invoiced("1000.00");
    const reqData = put(d0, tx(addr("R1"), "1000.00", "a"));
    expect(planPosting(reqData, { ...acct, links: { R1: { ...acct.links.R1, currency: "SGD" } } }, "R1", opts).status).toBe("blocked");
    const depeg: PriceSource = () => ({ rate: "0.97", source: "test feed" });
    const p = planPosting(reqData, acct, "R1", { ...opts, price: depeg });
    expect(p.status).toBe("blocked");
    expect(p.reasons.join(" ")).toMatch(/0\.97 USD.*by hand/);
    const nearPar: PriceSource = () => ({ rate: "0.9990", source: "test feed" });
    expect(planPosting(reqData, acct, "R1", { ...opts, price: nearPar }).status).toBe("ready");
    expect(planPosting(reqData, { ...acct, links: {} }, "R1", opts).status).toBe("not_linked");
  });
});

describe("approval, idempotency and audit", () => {
  it("posting twice never creates a second record; the second attempt is refused and logged", async () => {
    const { reqData: d0, acct, books } = invoiced("1000.00");
    const reqData = put(d0, tx(addr("R1"), "1000.00", "a"));
    const first = await post(reqData, acct, new DemoBooksAdapter(books, () => t(10)));
    const second = await post(reqData, first.acct, new DemoBooksAdapter(books, () => t(11)));
    expect(second.error).toMatch(/Already in the books/);
    expect(books.entries).toHaveLength(1);
    expect(second.acct.audit.map((e) => e.kind)).toEqual(["approved", "posted", "refused"]);
  });

  it("an adapter retry with the same idempotency key returns the existing record", async () => {
    const { reqData: d0, acct, books } = invoiced("1000.00");
    const reqData = put(d0, tx(addr("R1"), "1000.00", "a"));
    const plan = planPosting(reqData, acct, "R1", opts);
    const a = new DemoBooksAdapter(books, () => t(10));
    const once = await a.post(acct.links.R1, plan.lines, plan.idempotencyKey);
    const twice = await a.post(acct.links.R1, plan.lines, plan.idempotencyKey);
    expect(twice[0].externalId).toBe(once[0].externalId);
    expect(books.entries).toHaveLength(1);
  });

  it("approval is for the plan the person saw: a changed plan must be approved again", async () => {
    const { reqData: d0, acct, books } = invoiced("5000.00");
    const reqData = put(d0, tx(addr("R1"), "4950.00", "a"));
    const seen = planPosting(reqData, acct, "R1", opts);
    const changed = decideAs(reqData, "R1", "accept_short");
    const res = await post(changed, acct, new DemoBooksAdapter(books, () => t(10)), "R1", seen.idempotencyKey);
    expect(res.error).toMatch(/plan changed/);
    expect(res.acct.audit.at(-1)).toMatchObject({ kind: "refused" });
    expect(books.entries).toHaveLength(0);
  });

  it("a failure part-way is recorded with what was planned, and nothing is marked posted", async () => {
    const { reqData: d0, acct } = invoiced("1000.00");
    const reqData = put(d0, tx(addr("R1"), "1000.00", "a"));
    const broken: BooksAdapter = { provider: "xero", listOpenInvoices: async () => [], post: async () => { throw new Error("Xero 503"); } };
    const res = await post(reqData, acct, broken);
    expect(res.error).toMatch(/Xero 503/);
    expect(res.acct.audit.map((e) => e.kind)).toEqual(["approved", "failed"]);
    expect(res.acct.audit[1].planned).toHaveLength(1);
    expect(planPosting(reqData, res.acct, "R1", opts).status).toBe("ready"); // still to post
  });

  it("a failure on the second line records the first as posted, and a retry never posts it again", async () => {
    const { reqData: d0, acct, books, link } = invoiced("1000.00");
    const reqData = decideAs(put(d0, tx(addr("R1"), "1200.00", "a")), "R1", "refund_excess");
    const plan = planPosting(reqData, acct, "R1", opts);
    expect(plan.lines.map((l) => l.kind)).toEqual(["payment", "overpayment"]);
    // An adapter that posts the payment for real, then fails on the overpayment.
    const real = new DemoBooksAdapter(books, () => t(10));
    let calls = 0;
    const flaky: BooksAdapter = { provider: "xero", listOpenInvoices: async () => [], post: async (l, lines, key) => {
      const { PartialPostError } = await import("@/lib/accounting/types");
      const first = await real.post(l, [lines[0]], `${key}-first`);
      calls++;
      throw new PartialPostError("Xero 503 on line 2", first);
    } };
    const res = await post(reqData, acct, flaky);
    expect(res.error).toMatch(/503/);
    expect(res.acct.audit.map((e) => e.kind)).toEqual(["approved", "posted", "failed"]);
    // The retry plan holds only the overpayment: the payment is already in the books.
    const retry = planPosting(reqData, res.acct, "R1", opts);
    expect(retry.lines.map((l) => l.kind)).toEqual(["overpayment"]);
    await post(reqData, res.acct, new DemoBooksAdapter(books, () => t(12)));
    expect(books.entries.filter((e) => e.externalType === "Payment")).toHaveLength(1);
    expect(calls).toBe(1);
    expect(link.invoiceNumber).toBe("INV-R1");
  });

  it("payment lines never add up to more than arrived (cents round down), and an exact payment closes the invoice", () => {
    const { reqData: d0, acct } = invoiced("1000.00");
    let reqData = put(d0, tx(addr("R1"), "333.335", "a"));
    reqData = put(reqData, tx(addr("R1"), "333.335", "b", { blockTime: t(6) }), t(7));
    const short = planPosting(reqData, acct, "R1", opts).lines.filter((l) => l.kind === "payment");
    expect(short.map((l) => l.amount)).toEqual(["333.33", "333.34"]); // 666.67 posted for 666.67 received
    const { reqData: e0, acct: a2 } = invoiced("315.405");
    const exact = planPosting(put(e0, tx(addr("R1"), "315.405", "c")), a2, "R1", opts).lines;
    expect(exact.map((l) => [l.kind, l.amount])).toEqual([["payment", "315.41"]]); // closes the invoice it was raised for
  });

  it("importing an invoice makes a linked request, once", () => {
    const inv = { invoiceId: "X-1", invoiceNumber: "INV-9", contactId: "C", contactName: "Orbit", currency: "USD", amountDue: "750.00", status: "AUTHORISED" };
    const o = { now: t(0), by: "Mei", demo: false, publicId: "p", receivingAddress: addr("x"), token: "USDC" as const, tokenContract: OFFICIAL_USDC, provider: "xero" as const };
    const res = importInvoice(emptyRequests(), emptyAccounting(), inv, o);
    expect(res.requestId).toBeTruthy();
    expect(res.reqData.requests[res.requestId!]).toMatchObject({ invoiceRef: "INV-9", customerRef: "Orbit", amount: "750.00" });
    expect(res.acct.links[res.requestId!]).toMatchObject({ invoiceId: "X-1", provider: "xero" });
    expect(importInvoice(res.reqData, res.acct, inv, o).error).toMatch(/already has/);
    expect(importInvoice(emptyRequests(), emptyAccounting(), { ...inv, currency: "EUR" }, o).error).toMatch(/only USD/);
  });
});

describe("Xero and QuickBooks request shapes", () => {
  const link: InvoiceLink = { provider: "xero", invoiceId: "inv-guid", invoiceNumber: "INV-1042", contactId: "contact-guid", contactName: "Brightline", currency: "USD", amountDue: "5000.00", linkedAt: NOW, demo: false };
  const pay: PostingLine = { kind: "payment", amount: "4950.00", accountCode: "090", txHash: "0xabc", token: "USDC", network: "Ethereum", usdRate: "1.00", date: "2026-10-24", description: "d" };

  it("maps each line kind to the right Xero endpoint and body", () => {
    expect(xeroBody(link, pay)).toEqual({ path: "/Payments", body: { Payments: [{ Invoice: { InvoiceID: "inv-guid" }, Account: { Code: "090" }, Date: "2026-10-24", Amount: 4950, Reference: "USDC on Ethereum · tx 0xabc · @1.00 USD" }] } });
    expect(xeroBody(link, { ...pay, kind: "fee_writeoff", amount: "50.00", accountCode: "404" }).path).toBe("/CreditNotes");
    expect(xeroBody(link, { ...pay, kind: "fee_writeoff", amount: "50.00", accountCode: "404" }).body).toMatchObject({ CreditNotes: [{ Type: "ACCRECCREDIT", Contact: { ContactID: "contact-guid" }, LineItems: [{ UnitAmount: 50, AccountCode: "404" }] }] });
    const over = xeroBody(link, { ...pay, kind: "overpayment", amount: "1980.00", accountCode: "090", description: "Overpayment to refund: 1,980.00 USDC" }).body as { BankTransactions: { BankAccount: { Code: string }; Reference: string }[] };
    expect(over).toMatchObject({ BankTransactions: [{ Type: "RECEIVE-OVERPAYMENT", BankAccount: { Code: "090" } }] });
    expect(over.BankTransactions[0].Reference).toMatch(/^To refund · /);
    expect((xeroBody(link, { ...pay, kind: "overpayment", amount: "5.00", accountCode: "090", description: "Overpayment kept as customer credit" }).body as typeof over).BankTransactions[0].Reference).toMatch(/^Customer credit · /);
    expect(xeroBody(link, { ...pay, kind: "note", amount: "0", description: "Short by 50.00" })).toEqual({ path: "/Invoices/inv-guid/History", body: { HistoryRecords: [{ Details: "Short by 50.00" }] } });
    expect(xeroReference({ ...pay, txHash: "0x" + "a".repeat(400) }).length).toBeLessThanOrEqual(255);
  });

  it("the Xero adapter sends the tenant, the token and an idempotency key per line, and allocates credit notes", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const fake: Fetch = async (url, init) => {
      calls.push({ url, ...init });
      const body = url.endsWith("/Payments") ? { Payments: [{ PaymentID: "pay-1" }] } : url.endsWith("/CreditNotes") ? { CreditNotes: [{ CreditNoteID: "cn-1" }] } : {};
      return { ok: true, status: 200, json: async () => body, text: async () => "" };
    };
    const x = new XeroAdapter({ tenantId: "tenant-1", accessToken: async () => "tok" }, fake);
    const out = await x.post(link, [pay, { ...pay, kind: "fee_writeoff", amount: "50.00", accountCode: "404" }], "clearline-key");
    expect(out.map((o) => [o.externalType, o.externalId])).toEqual([["Payment", "pay-1"], ["CreditNote", "cn-1"]]);
    expect(calls.map((c) => [c.method, c.url.replace("https://api.xero.com/api.xro/2.0", "")])).toEqual([["PUT", "/Payments"], ["PUT", "/CreditNotes"], ["PUT", "/CreditNotes/cn-1/Allocations"]]);
    expect(calls[0].headers).toMatchObject({ Authorization: "Bearer tok", "xero-tenant-id": "tenant-1", "Idempotency-Key": "clearline-key-0" });
    expect(calls[1].headers["Idempotency-Key"]).toBe("clearline-key-1");
    expect(JSON.parse(calls[2].body!)).toEqual({ Allocations: [{ Invoice: { InvoiceID: "inv-guid" }, Amount: 50, Date: "2026-10-24" }] });
  });

  it("a Xero error stops the posting and surfaces the status", async () => {
    const fake: Fetch = async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => "Payment amount exceeds the amount outstanding" });
    const x = new XeroAdapter({ tenantId: "t", accessToken: async () => "tok" }, fake);
    await expect(x.post(link, [pay], "k")).rejects.toThrow(/400.*exceeds/);
  });

  it("QuickBooks: payment linked to the invoice, overpayment as unapplied credit, requestid for idempotency", async () => {
    const [p] = qboBodies(link, pay, "Short by 50.00");
    expect(p.body).toMatchObject({ CustomerRef: { value: "contact-guid" }, TotalAmt: 4950, Line: [{ Amount: 4950, LinkedTxn: [{ TxnId: "inv-guid", TxnType: "Invoice" }] }] });
    expect((p.body as { PrivateNote: string }).PrivateNote).toMatch(/Short by 50\.00/);
    const [o] = qboBodies(link, { ...pay, kind: "overpayment" }, undefined);
    expect(o.body).not.toHaveProperty("Line");
    const urls: string[] = [];
    const fake: Fetch = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ Payment: { Id: "77" } }), text: async () => "" }; };
    const q = new QuickBooksAdapter({ realmId: "123", accessToken: async () => "tok" }, fake);
    const out = await q.post(link, [pay], "k");
    expect(out[0]).toMatchObject({ externalId: "77", externalType: "Payment" });
    expect(urls[0]).toMatch(/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/123\/payment\?minorversion=75&requestid=k-0/);
  });
});

describe("helpers", () => {
  it("rounds to cents and compares signed amounts", () => {
    expect(toCents("4950")).toBe("4950.00");
    expect(toCents("1.005")).toBe("1.01");
    expect(toCents("2180.123456")).toBe("2180.12");
    expect(cmp("-1", "0")).toBe(-1);
    expect(cmp("1.50", "1.5")).toBe(0);
  });
});

describe("demo books", () => {
  it("one invoice per demo request; the week's routine payments are already posted; the cases end where they should", async () => {
    const reqData = resetDemo(emptyRequests(), NOW, (id) => `pub-${id}`);
    const acct = await seedDemoBooks(reqData, emptyAccounting(), { now: NOW, operator: "Mei Tan (Finance ops)", threshold: CONFIRMATIONS });
    const demoReqs = Object.values(reqData.requests).filter((r) => r.demo);
    expect(Object.keys(acct.links)).toHaveLength(demoReqs.length);
    expect(Object.keys(acct.demoBooks!.invoices)).toHaveLength(demoReqs.length);
    const plan = (id: string) => planPosting(reqData, acct, id, opts);
    // Routine week: posted to the books.
    for (const id of ["DEMO-1030", "DEMO-1035", "DEMO-1040", "DEMO-0988"]) expect(plan(id).status).toBe("posted");
    // The seven cases.
    expect(plan("DEMO-1041").status).toBe("waiting");          // a: not paid yet (played live)
    expect(plan("DEMO-1042").status).toBe("ready");            // b: short → partial + note
    expect(plan("DEMO-1042").lines.map((l) => l.kind)).toEqual(["payment", "note"]);
    expect(plan("DEMO-1043").status).toBe("never");            // c: counterfeit
    expect(plan("DEMO-1044").status).toBe("never");            // d: wrong network
    expect(plan("DEMO-1045").status).toBe("waiting");          // e: no reference
    expect(plan("DEMO-1046").status).toBe("waiting");          // f: look-alike (not paid)
    expect(plan("DEMO-1047").status).toBe("needs_decision");   // g: duplicate
    expect(acct.audit.every((e) => e.demo)).toBe(true);
    // Reseeding keeps non-demo links and audit.
    const withReal: AccountingData = { ...acct, links: { ...acct.links, "REQ-1": { ...acct.links["DEMO-1030"], demo: false } }, audit: [...acct.audit, { ...acct.audit[0], id: "real", demo: false }] };
    const again = await seedDemoBooks(reqData, withReal, { now: NOW, operator: "Mei", threshold: CONFIRMATIONS });
    expect(again.links["REQ-1"]).toBeDefined();
    expect(again.audit.some((e) => e.id === "real")).toBe(true);
  });
});
