// Roadmap priority 2: "Retry after a partial post creates a duplicate credit note".
// Every post to Xero must be idempotent: a retry of the same request must send the SAME Idempotency-Key
// for every record it re-sends, so Xero can return the record it already made instead of making a second.
//
// Today `idempotencyKeyFor` (src/lib/accounting/rules.ts) hashes only the lines still to post, and the
// Xero adapter sends `<planKey>-<index>` (allocation `<planKey>-<index>-alloc`). After a partial post the
// remaining lines get a new plan key and a new index, so the retry's keys are new and Xero can't dedupe.
//
// These tests are `it.fails` until the fix lands (switch each to `it`). No network: a stub fetch plays a
// Xero org that honours Idempotency-Key the way Xero does (same key -> same record, nothing new created).

import { describe, expect, it } from "vitest";
import { approveAndPost } from "@/lib/accounting/engine";
import { XERO_API, XeroAdapter, type Fetch } from "@/lib/accounting/providers/xero";
import { emptyAccounting, type AccountingData, type InvoiceLink } from "@/lib/accounting/types";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr } from "@/lib/requests/demo";
import { createRequest, decide, ingest } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";

const NOW = "2026-10-25T09:00:00.000Z";
const t = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const sim = new SimulatedProvider();
const opts = { threshold: CONFIRMATIONS };

type Endpoint = "Payments" | "CreditNotes" | "Allocations" | "BankTransactions" | "History";
const endpointOf = (path: string): Endpoint => {
  if (/^\/Payments$/.test(path)) return "Payments";
  if (/^\/CreditNotes$/.test(path)) return "CreditNotes";
  if (/^\/CreditNotes\/[^/]+\/Allocations$/.test(path)) return "Allocations";
  if (/^\/BankTransactions$/.test(path)) return "BankTransactions";
  if (/^\/Invoices\/[^/]+\/History$/.test(path)) return "History";
  throw new Error(`unexpected Xero path ${path}`);
};

/**
 * reject: Xero refuses the call and makes nothing (429 rate limit).
 * lost:   Xero makes the record, but the response never reaches us (504): an unknown outcome.
 */
type Fault = "reject" | "lost";
interface Sent { attempt: number; method: string; endpoint: Endpoint; path: string; key?: string }

/** A stub Xero organisation: records every request, creates records, and dedupes on Idempotency-Key. */
function stubXero() {
  const sent: Sent[] = [];
  const made: Record<Endpoint, string[]> = { Payments: [], CreditNotes: [], Allocations: [], BankTransactions: [], History: [] };
  const byKey = new Map<string, unknown>();
  const faults: { attempt: number; endpoint: Endpoint; nth?: number; fault: Fault }[] = [];
  let attempt = 0;
  const seenThisAttempt: Partial<Record<Endpoint, number>> = {};

  const fetchFn: Fetch = async (url, init) => {
    const path = url.slice(XERO_API.length).split("?")[0];
    const endpoint = endpointOf(path);
    const key = init.headers["Idempotency-Key"];
    sent.push({ attempt, method: init.method, endpoint, path, key });
    const nth = (seenThisAttempt[endpoint] = (seenThisAttempt[endpoint] ?? 0) + 1);
    const f = faults.find((x) => x.attempt === attempt && x.endpoint === endpoint && (x.nth ?? 1) === nth)?.fault;
    const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (f === "reject") return reply(429, { Title: "Too Many Requests" });
    let body = key ? byKey.get(key) : undefined;
    if (body === undefined) {
      const id = `${endpoint.toLowerCase()}-${made[endpoint].length + 1}`;
      made[endpoint].push(id);
      body = endpoint === "Payments" ? { Payments: [{ PaymentID: id }] }
        : endpoint === "CreditNotes" ? { CreditNotes: [{ CreditNoteID: id }] }
        : endpoint === "BankTransactions" ? { BankTransactions: [{ BankTransactionID: id, OverpaymentID: `op-${id}` }] }
        : endpoint === "Allocations" ? { Allocations: [{ AllocationID: id }] }
        : { HistoryRecords: [{ Details: id }] };
      if (key) byKey.set(key, body);
    }
    if (f === "lost") return reply(504, { Title: "Gateway Timeout" });
    return reply(200, body);
  };

  return {
    sent, made,
    /** Make the nth call to `endpoint` in attempt number `attempt` (1-based) fail this way. */
    fail(attemptNo: number, endpoint: Endpoint, fault: Fault, nth = 1) { faults.push({ attempt: attemptNo, endpoint, nth, fault }); },
    /** One approve-and-post run (an "attempt") through the real engine and the real Xero adapter. */
    async run(reqData: RequestsData, acct: AccountingData) {
      attempt++;
      for (const k of Object.keys(seenThisAttempt)) delete seenThisAttempt[k as Endpoint];
      const adapter = new XeroAdapter({ tenantId: "demo-tenant", accessToken: async () => "stub-token" }, fetchFn);
      return approveAndPost(reqData, acct, "R1", { ...opts, by: "Mei", now: t(10 + attempt), adapter });
    },
    keys(attemptNo: number, endpoint: Endpoint) { return sent.filter((s) => s.attempt === attemptNo && s.endpoint === endpoint).map((s) => s.key); },
  };
}

/** A USD request R1 made from a Xero invoice, and accounting data linking the two. */
function invoiced(amount: string) {
  const reqData = createRequest(emptyRequests(), { customerRef: "Acme", invoiceRef: "INV-R1", amount, receivingAddress: addr("R1"), token: "USDC" },
    { now: t(0), by: "Mei", demo: false, publicId: "R1", tokenContract: OFFICIAL_USDC, id: "R1" }).data;
  const link: InvoiceLink = { provider: "xero", invoiceId: "inv-guid", invoiceNumber: "INV-R1", contactId: "contact-guid", contactName: "Acme", currency: "USD", amountDue: amount, linkedAt: t(0), demo: false };
  const acct: AccountingData = { ...emptyAccounting(), provider: "xero", links: { R1: link } };
  return { reqData, acct };
}
const tx = (amount: string, seq: string, minute = 5): TransferEvent =>
  ({ ...sim.send(emptyRequests(), { to: addr("R1"), amount, tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr(`from:${seq}`), seq }),
    source: "live", demo: false, blockNumber: 900 + minute, blockTime: t(minute), confirmations: CONFIRMATIONS });
const put = (d: RequestsData, ev: TransferEvent) => ingest(d, ev, t(6), "test", checkObservation(t(6)), CONFIRMATIONS).data;
const decideAs = (d: RequestsData, kind: "accept_short" | "refund_excess") =>
  decide(d, "R1", { kind, note: "Checked with the customer." }, { now: t(9), by: "Mei", threshold: CONFIRMATIONS, check: checkObservation(t(9)) }).data;

/** 5,000.00 invoiced, 4,950.00 arrived, Mei accepted the 50.00 shortfall: [payment 4950.00, fee_writeoff 50.00]. */
const shortAccepted = () => { const { reqData, acct } = invoiced("5000.00"); return { reqData: decideAs(put(reqData, tx("4950.00", "a")), "accept_short"), acct }; };

describe("posting to Xero is idempotent across retries (roadmap #2)", () => {
  it.fails("(a) a retry after a partial post sends the same Idempotency-Key for each remaining line", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "CreditNotes", "reject"); // payment posts, the credit note gets a 429
    const first = await xero.run(reqData, acct);
    expect(first.error).toMatch(/429/);
    expect(first.acct.audit.map((e) => e.kind)).toEqual(["approved", "posted", "failed"]);
    const firstKey = xero.keys(1, "CreditNotes")[0];
    expect(firstKey).toBeTruthy();

    const second = await xero.run(reqData, first.acct);
    expect(second.error).toBeUndefined();
    expect(xero.keys(2, "Payments")).toEqual([]); // the payment is not re-sent
    expect(xero.keys(2, "CreditNotes")).toEqual([firstKey]);
  });

  it.fails("(b) a line's key depends only on its own identity, not on which other lines are pending", async () => {
    // Attempt 1: 4,950.00 of 5,000.00 arrived, no decision yet -> [payment, note]. Xero makes the
    // payment but the response is lost (504), so Clearline records nothing as posted.
    const { reqData: d0, acct } = invoiced("5000.00");
    const paid = put(d0, tx("4950.00", "a"));
    const xero = stubXero();
    xero.fail(1, "Payments", "lost");
    const first = await xero.run(paid, acct);
    expect(first.error).toMatch(/504/);
    expect(first.acct.audit.map((e) => e.kind)).toEqual(["approved", "failed"]);

    // Mei then accepts the shortfall -> [payment, fee_writeoff]. It is the SAME transfer and the same
    // payment line, so it must carry the same key, and Xero must hand back the payment it already made.
    const second = await xero.run(decideAs(paid, "accept_short"), first.acct);
    expect(second.error).toBeUndefined();
    expect(xero.keys(2, "Payments")).toEqual(xero.keys(1, "Payments"));
    expect(xero.made.Payments).toHaveLength(1);
  });

  it.fails("(c) a full re-run after Xero did everything posts nothing new (last response lost)", async () => {
    // Attempt 1: payment, credit note and allocation are all made in Xero, but the allocation's response
    // is lost. The adapter only records the payment, so Clearline thinks the write-off is still to post.
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "Allocations", "lost");
    const first = await xero.run(reqData, acct);
    expect(first.error).toMatch(/504/);
    expect(xero.made).toMatchObject({ Payments: ["payments-1"], CreditNotes: ["creditnotes-1"], Allocations: ["allocations-1"] });

    const second = await xero.run(reqData, first.acct);
    expect(second.error).toBeUndefined();
    const third = await xero.run(reqData, second.acct);
    expect(third.plan.status).toBe("posted");
    // One payment, one credit note, one allocation: the re-runs made nothing new in the books.
    expect({ payments: xero.made.Payments.length, creditNotes: xero.made.CreditNotes.length, allocations: xero.made.Allocations.length })
      .toEqual({ payments: 1, creditNotes: 1, allocations: 1 });
  });

  // (d) Every kind of Xero PUT carries an Idempotency-Key, and a retry of that record re-sends the same one.
  const cases: { endpoint: Endpoint; nth?: number; setup: () => { reqData: RequestsData; acct: AccountingData } }[] = [
    // [payment a, payment b, note]: the second payment is the one that fails.
    { endpoint: "Payments", nth: 2, setup: () => { const { reqData, acct } = invoiced("2000.00"); return { reqData: put(put(reqData, tx("600.00", "a")), tx("600.00", "b", 7)), acct }; } },
    { endpoint: "CreditNotes", setup: shortAccepted },
    { endpoint: "Allocations", setup: shortAccepted },
    // [payment, overpayment to refund]
    { endpoint: "BankTransactions", setup: () => { const { reqData, acct } = invoiced("1000.00"); return { reqData: decideAs(put(reqData, tx("1200.00", "a")), "refund_excess"), acct }; } },
    // [payment, note]
    { endpoint: "History", setup: () => { const { reqData, acct } = invoiced("5000.00"); return { reqData: put(reqData, tx("4950.00", "a")), acct }; } },
  ];
  for (const c of cases) {
    it.fails(`(d) PUT ${c.endpoint} carries an Idempotency-Key, and the same one when retried`, async () => {
      const { reqData, acct } = c.setup();
      const xero = stubXero();
      xero.fail(1, c.endpoint, "reject", c.nth ?? 1);
      const first = await xero.run(reqData, acct);
      expect(first.error).toMatch(/429/);
      expect(xero.sent.filter((s) => s.method === "PUT").every((s) => !!s.key)).toBe(true);
      const firstKey = xero.keys(1, c.endpoint)[(c.nth ?? 1) - 1];
      expect(firstKey).toBeTruthy();

      await xero.run(reqData, first.acct);
      expect(xero.sent.filter((s) => s.method === "PUT").every((s) => !!s.key)).toBe(true);
      expect(xero.keys(2, c.endpoint)[0]).toBe(firstKey);
    });
  }

  it.fails("(e) the credit-note allocation key is the same on every retry", async () => {
    // The credit note is made, its allocation is rate-limited twice, then goes through.
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "Allocations", "reject");
    xero.fail(2, "Allocations", "reject");
    const first = await xero.run(reqData, acct);
    const second = await xero.run(reqData, first.acct);
    const third = await xero.run(reqData, second.acct);
    expect(third.error).toBeUndefined();
    const allocKeys = [1, 2, 3].map((n) => xero.keys(n, "Allocations")[0]);
    expect(allocKeys.every(Boolean)).toBe(true);
    expect(new Set(allocKeys).size).toBe(1);
    expect(xero.made.CreditNotes).toHaveLength(1);
  });
});
