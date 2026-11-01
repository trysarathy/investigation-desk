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
 * reject:  Xero refuses the call and makes nothing (429 rate limit).
 * lost:    Xero makes the record, but the response never reaches us (504): an unknown outcome.
 * badbody: Xero makes the record and answers 200, but the body can't be read (connection cut mid-body).
 */
type Fault = "reject" | "lost" | "badbody";
interface Sent { attempt: number; method: string; endpoint: Endpoint; path: string; key?: string; body?: string }

/**
 * A stub Xero organisation: records every request, creates records, and dedupes on Idempotency-Key for
 * 6 minutes from the key's first call, then forgets it, as Xero documents [VERIFIED: accounting-integrations-engineer
 * 2026-11-01, developer.xero.com/documentation/guides/idempotent-requests/idempotency].
 */
function stubXero() {
  const sent: Sent[] = [];
  const made: Record<Endpoint, string[]> = { Payments: [], CreditNotes: [], Allocations: [], BankTransactions: [], History: [] };
  const byKey = new Map<string, unknown>();
  const firstAt = new Map<string, number>();
  let clock = 0;
  const faults: { attempt: number; endpoint: Endpoint; nth?: number; fault: Fault }[] = [];
  let attempt = 0;
  const seenThisAttempt: Partial<Record<Endpoint, number>> = {};
  const gets: string[] = [];
  let answerGet: ((path: string) => [number, unknown]) | undefined;
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

  const fetchFn: Fetch = async (url, init) => {
    const path = url.slice(XERO_API.length).split("?")[0];
    if (init.method === "GET" && answerGet) { gets.push(path); return reply(...answerGet(path)); }
    const endpoint = endpointOf(path);
    const key = init.headers["Idempotency-Key"];
    sent.push({ attempt, method: init.method, endpoint, path, key, body: init.body });
    const nth = (seenThisAttempt[endpoint] = (seenThisAttempt[endpoint] ?? 0) + 1);
    const f = faults.find((x) => x.attempt === attempt && x.endpoint === endpoint && (x.nth ?? 1) === nth)?.fault;
    if (f === "reject") return reply(429, { Title: "Too Many Requests" });
    if (key && clock - (firstAt.get(key) ?? clock) >= 6 * 60_000) { byKey.delete(key); firstAt.delete(key); }
    let body = key ? byKey.get(key) : undefined;
    if (body === undefined) {
      const id = `${endpoint.toLowerCase()}-${made[endpoint].length + 1}`;
      made[endpoint].push(id);
      body = endpoint === "Payments" ? { Payments: [{ PaymentID: id }] }
        : endpoint === "CreditNotes" ? { CreditNotes: [{ CreditNoteID: id }] }
        : endpoint === "BankTransactions" ? { BankTransactions: [{ BankTransactionID: id, OverpaymentID: `op-${id}` }] }
        : endpoint === "Allocations" ? { Allocations: [{ AllocationID: id }] }
        : { HistoryRecords: [{ Details: id }] };
      if (key) { byKey.set(key, body); firstAt.set(key, clock); }
    }
    if (f === "lost") return reply(504, { Title: "Gateway Timeout" });
    if (f === "badbody") return { ok: true, status: 200, json: async () => { throw new TypeError("terminated: other side closed"); }, text: async () => "" };
    return reply(200, body);
  };

  return {
    sent, made, gets,
    /** Answer GETs (the read-back) with [status, body]. */
    onGet(fn: (path: string) => [number, unknown]) { answerGet = fn; },
    /** Make the nth call to `endpoint` in attempt number `attempt` (1-based) fail this way. */
    fail(attemptNo: number, endpoint: Endpoint, fault: Fault, nth = 1) { faults.push({ attempt: attemptNo, endpoint, nth, fault }); },
    /** One approve-and-post run (an "attempt") through the real engine and the real Xero adapter. */
    async run(reqData: RequestsData, acct: AccountingData, minute?: number) {
      attempt++;
      for (const k of Object.keys(seenThisAttempt)) delete seenThisAttempt[k as Endpoint];
      clock = Date.parse(t(minute ?? 10 + attempt));
      const adapter = new XeroAdapter({ tenantId: "demo-tenant", accessToken: async () => "stub-token" }, fetchFn);
      return approveAndPost(reqData, acct, "R1", { ...opts, orgTimeZone: "Asia/Singapore", by: "Mei", now: new Date(clock).toISOString(), adapter });
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
  it("(a) a retry after a partial post sends the same Idempotency-Key for each remaining line", async () => {
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

  it("(b) a line's key depends only on its own identity, not on which other lines are pending", async () => {
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

  it("(c) a full re-run after Xero did everything posts nothing new (last response lost)", async () => {
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
    it(`(d) PUT ${c.endpoint} carries an Idempotency-Key, and the same one when retried`, async () => {
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

  it("(e) the credit-note allocation key is the same on every retry", async () => {
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

  // Xero keeps a key 6 minutes from the first call [VERIFIED: accounting-integrations-engineer 2026-11-01,
  // developer.xero.com/documentation/guides/idempotent-requests/idempotency]. A later retry reads back first.
  const lostPaymentThenAccepted = async (xero: ReturnType<typeof stubXero>) => {
    const { reqData: d0, acct } = invoiced("5000.00");
    const paid = put(d0, tx("4950.00", "a"));
    xero.fail(1, "Payments", "lost");
    const first = await xero.run(paid, acct, 11);
    expect(first.acct.audit.at(-1)).toMatchObject({ kind: "failed", outcome: "unknown" });
    return { reqData: decideAs(paid, "accept_short"), acct: first.acct };
  };

  it("(f) after Xero's key window, a lost payment is read back from the invoice, recorded with Xero's id, and not re-sent", async () => {
    const xero = stubXero();
    const { reqData, acct } = await lostPaymentThenAccepted(xero);
    const ref = JSON.parse(xero.sent[0].body!).Payments[0].Reference as string;
    xero.onGet(() => [200, { Invoices: [{ Payments: [{ PaymentID: "payments-1", Reference: ref, Amount: 4950 }], CreditNotes: [] }] }]);
    const second = await xero.run(reqData, acct, 30);
    expect(second.error).toBeUndefined();
    expect(xero.gets).toEqual(["/Invoices/inv-guid"]);
    expect(xero.keys(2, "Payments")).toEqual([]);
    expect(xero.made.Payments).toHaveLength(1);
    expect(second.acct.audit.flatMap((e) => (e.kind === "posted" ? e.lines ?? [] : [])).map((l) => [l.kind, l.externalId]))
      .toEqual([["payment", "payments-1"], ["fee_writeoff", "creditnotes-1"]]);
  });

  it("(g) a read-back that can't tell (Xero error, or a credit note not on the invoice) posts nothing and goes to a person", async () => {
    const xero = stubXero();
    const { reqData, acct } = await lostPaymentThenAccepted(xero);
    xero.onGet(() => [503, { Title: "Service Unavailable" }]);
    const second = await xero.run(reqData, acct, 30);
    expect(second.error).toMatch(/Not posted: an earlier attempt ended without a clear answer/);
    expect(second.acct.audit.at(-1)?.kind).toBe("refused");
    expect(xero.sent.filter((s) => s.attempt === 2)).toEqual([]);

    const cn = stubXero();
    cn.fail(1, "CreditNotes", "lost");
    const s0 = shortAccepted();
    const firstCn = await cn.run(s0.reqData, s0.acct, 11);
    cn.onGet(() => [200, { Invoices: [{ Payments: [], CreditNotes: [] }] }]);
    const again = await cn.run(s0.reqData, firstCn.acct, 30);
    expect(again.error).toMatch(/can't confirm from Xero whether the fee writeoff/);
    expect(cn.made.CreditNotes).toHaveLength(1);
  });

  it("(h) a 429 means nothing was made: no read-back, the retry re-sends the same key", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "CreditNotes", "reject");
    const first = await xero.run(reqData, acct, 11);
    expect(first.acct.audit.at(-1)?.outcome).toBeUndefined();
    const second = await xero.run(reqData, first.acct, 40);
    expect(second.error).toBeUndefined();
    expect(xero.gets).toEqual([]);
    expect(xero.keys(2, "CreditNotes")).toEqual(xero.keys(1, "CreditNotes"));
  });

  // Code review of 72d1272 (probes P1-P3): with keys forgotten after 6 minutes, these made duplicates.
  const noRecords = () => [200, { Invoices: [{ AmountPaid: 4950, Payments: [], CreditNotes: [] }] }] as [number, unknown];

  it("(i) credit note made, allocation 429, re-approved after Xero forgot the key: no second credit note", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "Allocations", "reject");
    const first = await xero.run(reqData, acct, 11);
    expect(first.error).toMatch(/429/);
    const second = await xero.run(reqData, first.acct, 30);
    expect(second.error).toBeUndefined();
    expect(xero.made.CreditNotes).toHaveLength(1);
    expect(xero.made.Allocations).toHaveLength(1);
    expect(xero.keys(2, "CreditNotes")).toEqual([]); // the credit note Xero made is re-used, not re-created
    expect(xero.sent.find((s) => s.attempt === 2 && s.endpoint === "Allocations")?.path).toBe("/CreditNotes/creditnotes-1/Allocations");
  });

  it("(j) a 200 whose body can't be read is an unknown outcome, never 'nothing made': no second payment later", async () => {
    const { reqData: d0, acct } = invoiced("5000.00");
    const reqData = put(d0, tx("5000.00", "a"));
    const xero = stubXero();
    xero.fail(1, "Payments", "badbody");
    const first = await xero.run(reqData, acct, 11);
    expect(first.acct.audit.at(-1)).toMatchObject({ kind: "failed", outcome: "unknown" });
    xero.onGet(() => [200, { Invoices: [{ AmountPaid: 5000, Payments: [{ PaymentID: "payments-1", Amount: 5000 }], CreditNotes: [] }] }]);
    const second = await xero.run(reqData, first.acct, 30);
    expect(second.error).toMatch(/can't confirm/);
    expect(xero.made.Payments).toHaveLength(1);
  });

  it("(k) the 6-minute window runs from the key's first send, not from the first unknown failure", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "CreditNotes", "reject"); // credit-note key first sent at 11, nothing made
    xero.fail(2, "CreditNotes", "lost");   // made at 15, response lost
    const first = await xero.run(reqData, acct, 11);
    const second = await xero.run(reqData, first.acct, 15);
    expect(second.acct.audit.at(-1)).toMatchObject({ kind: "failed", outcome: "unknown" });
    xero.onGet(noRecords);
    const third = await xero.run(reqData, second.acct, 19); // 8 min after the first send: Xero forgot the key
    expect(xero.gets).toEqual(["/Invoices/inv-guid"]);
    expect(third.error).toMatch(/can't confirm/);
    expect(xero.made.CreditNotes).toHaveLength(1);
  });

  it("(l) read-back says 'absent' only when the invoice's AmountPaid matches what Clearline recorded", async () => {
    const { reqData: d0, acct } = invoiced("5000.00");
    const reqData = put(d0, tx("5000.00", "a"));
    const xero = stubXero();
    xero.fail(1, "Payments", "lost");
    const first = await xero.run(reqData, acct, 11);
    // The payment is there but its reference came back changed: AmountPaid gives it away.
    xero.onGet(() => [200, { Invoices: [{ AmountPaid: 5000, Payments: [{ PaymentID: "payments-1", Reference: "edited", Amount: 5000 }], CreditNotes: [] }] }]);
    const second = await xero.run(reqData, first.acct, 30);
    expect(second.error).toMatch(/can't confirm/);
    expect(xero.made.Payments).toHaveLength(1);
  });

  it("write-off and note keys include the invoice id (Xero counts key reuse per app, across organisations)", async () => {
    const { lineKey } = await import("@/lib/accounting/rules");
    const l = { kind: "fee_writeoff" as const, amount: "50.00", date: "2026-11-01", description: "" };
    expect(lineKey("R1", l, "inv-a")).not.toBe(lineKey("R1", l, "inv-b"));
    expect(lineKey("R1", { ...l, kind: "note", amount: "0" }, "inv-a")).not.toBe(lineKey("R1", { ...l, kind: "note", amount: "0" }, "inv-b"));
    expect((lineKey("R".repeat(500), l, "i".repeat(500)) + "-alloc").length).toBeLessThanOrEqual(128);
  });

  // Code review of 09d7e8c (probe P7): a credit note Xero made is re-used only for exactly its own amount.
  const SHORTFALL_CHANGED = "A credit note for 50.00 was already made in Xero for this invoice, but the shortfall is now 30.00. "
    + "Clearline won't post anything more for this invoice, so it can't make a mismatched write-off. "
    + "In Xero, adjust or void that credit note, then record the remaining lines below by hand.";

  it("(n) credit note 50.00 made, allocation 429, then 20.00 more arrives: nothing posts, a person checks", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "Allocations", "reject");
    const first = await xero.run(reqData, acct, 11);
    const second = await xero.run(put(reqData, tx("20.00", "b", 20)), first.acct, 30);
    expect(second.error).toBe(SHORTFALL_CHANGED);
    expect(second.acct.audit.at(-1)?.kind).toBe("refused");
    expect(xero.sent.filter((s) => s.attempt === 2)).toEqual([]); // no allocation of 30.00 against the 50.00 credit note
    expect(second.acct.audit.flatMap((e) => (e.kind === "posted" ? e.lines ?? [] : [])).some((l) => l.kind === "fee_writeoff")).toBe(false);
  });

  it("(o) a made credit note smaller than the shortfall now is not re-used either", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "Allocations", "reject");
    const first = await xero.run(reqData, acct, 11);
    // As if the credit note had been made for 30.00 when the shortfall was smaller; the shortfall is now 50.00.
    const audit = first.acct.audit.map((e) => (e.made ? { ...e, made: Object.fromEntries(Object.entries(e.made).map(([k, m]) => [k, { ...m, amount: "30.00" }])) } : e));
    const second = await xero.run(reqData, { ...first.acct, audit }, 30);
    expect(second.error).toMatch(/A credit note for 30\.00 was already made in Xero for this invoice, but the shortfall is now 50\.00\./);
    expect(xero.sent.filter((s) => s.attempt === 2)).toEqual([]);
  });

  it("(p) the made credit note's amount and currency are recorded with its id", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "Allocations", "reject");
    const first = await xero.run(reqData, acct, 11);
    expect(Object.values(first.acct.audit.at(-1)?.made ?? {})).toEqual([{ id: "creditnotes-1", amount: "50.00", currency: "USD" }]);
  });

  it("(q) after that refusal every later approval is refused too, and the message never invites approving again", async () => {
    const { reqData, acct } = shortAccepted();
    const xero = stubXero();
    xero.fail(1, "Allocations", "reject");
    const first = await xero.run(reqData, acct, 11);
    const more = put(reqData, tx("20.00", "b", 20));
    let a = (await xero.run(more, first.acct, 30)).acct;
    for (const minute of [40, 60]) {
      const again = await xero.run(more, a, minute);
      expect(again.error).toBe(SHORTFALL_CHANGED);
      expect(again.error).not.toMatch(/approv/i);
      expect(again.acct.audit.at(-1)?.kind).toBe("refused");
      a = again.acct;
    }
    expect(xero.sent.filter((s) => s.attempt > 1)).toEqual([]); // the 20.00 payment waits too: recorded by hand
  });
});
