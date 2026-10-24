// Chunk 2: payout ledger, exception rules, inbox, review resolution. Instruction, provider, ledger
// and bank files are synthetic (tests/fixtures/inbox/); every on-chain transfer is a real public
// transfer replayed from tests/fixtures/live/.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { RECORDINGS } from "@/lib/demo/recordings";
import { demoTransport } from "@/lib/demo/transport";
import { MemoryAuditLog } from "@/lib/payments/audit";
import { computeExceptions, type DepositCaseRow, type PaymentException } from "@/lib/payments/exceptions";
import type { ColumnMapping } from "@/lib/payments/mapping";
import { add, mulBps, sub } from "@/lib/payments/money";
import { refreshMatching } from "@/lib/payments/refresh";
import type { ExceptionSettings } from "@/lib/payments/settings";
import { applyImport, MemoryPaymentsStore, saveMappingVersion, type PaymentsData } from "@/lib/payments/store";
import type { CanonicalPayment, LedgerEntryRecord } from "@/lib/payments/types";
import { act, MemoryInboxStore, resolveReview, saveRoutes, syncAll, type Stores } from "@/lib/payments/workflow";

const NOW = new Date("2026-10-23T08:00:00Z");
const dir = path.join(__dirname, "fixtures/inbox");
const file = (n: string) => new Uint8Array(readFileSync(path.join(dir, n)));
const enc = (s: string) => new TextEncoder().encode(s);
const recorded = () => buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
  transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true });
const rematch = (now = NOW) => (d: PaymentsData) => refreshMatching(d, recorded(), [], () => now);

const TP: Omit<ColumnMapping, "version" | "createdAt"> = {
  mappingId: "tp", kind: "provider", name: "TP settlement report", provider: "TP",
  columns: { provider_payment_id: "payment_id", merchant_reference: "our_ref", status: "state", amount: "amount", currency: "currency",
    event_time: "created", tx_hash: "hash", type: "kind", relates_to: "parent" },
  values: { status: { DONE: "provider_reports_complete", PROC: "processing", REFUNDED: "returned", CANCELLED: "cancelled" },
    type: { PAYMENT: "principal", FEE: "fee", REFUND: "return" } },
  timestampFormat: "iso8601_offset",
};

const ROUTES: ExceptionSettings["routes"] = [
  { routeId: "tp-tron", name: "TP · Tron · USDT", match: { provider: "TP", chain: "tron", token: "USDT" }, deadlineMinutes: 120, graceMinutes: 30,
    expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "fixed", amount: "1.00" } },
  { routeId: "tp-bsc", name: "TP · BNB Chain · USDT", match: { provider: "TP", chain: "bsc", token: "USDT" }, deadlineMinutes: 120, graceMinutes: 30,
    expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "fixed", amount: "0.01" } },
  { routeId: "default", name: "Any other route", match: {}, deadlineMinutes: 1440, graceMinutes: 60,
    expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "none" } },
];
const ANA = { actor: "Ana", ip: "203.0.113.7" };

async function setup(now = NOW): Promise<Stores> {
  const stores: Stores = { payments: new MemoryPaymentsStore(), inbox: new MemoryInboxStore(), audit: new MemoryAuditLog() };
  await saveMappingVersion(stores.payments, TP, now);
  await applyImport(stores.payments, "instruction", "instructions.csv", file("instructions.csv"), "instructions-standard", undefined, now);
  await applyImport(stores.payments, "provider", "provider-1.csv", file("provider-1.csv"), "tp", undefined, now);
  await applyImport(stores.payments, "ledger", "ledger.csv", file("ledger.csv"), "payout-ledger-standard", undefined, now);
  await applyImport(stores.payments, "bank", "bank.csv", file("bank.csv"), "bank-standard", undefined, now);
  await stores.payments.save(await rematch(now)(await stores.payments.load()));
  expect((await saveRoutes(stores, ROUTES, ANA, now)).errors).toEqual([]);
  return stores;
}

const forIns = (data: PaymentsData, id: string): CanonicalPayment =>
  data.match!.result.payments.find((p) => p.anchor.kind === "instruction" && p.anchor.recordId.startsWith(`ins:${id}:`))!;
const excFor = (excs: PaymentException[], data: PaymentsData, id: string) =>
  excs.filter((e) => e.subject.kind === "payment" && e.subject.paymentId === forIns(data, id).paymentId);
const codes = (excs: PaymentException[]) => excs.map((e) => e.code).sort();

let stores: Stores;
let data: PaymentsData;
let excs: PaymentException[];
beforeAll(async () => {
  stores = await setup();
  data = await stores.payments.load();
  excs = computeExceptions({ data, settings: (await stores.inbox.load()).settings, now: NOW });
});

// ---- 1. Payout ledger ----

describe("payout ledger import", () => {
  it("validates strictly: bad rows listed, status kept raw beside its meaning", () => {
    const log = data.imports.find((i) => i.kind === "ledger")!;
    expect(log).toMatchObject({ outcome: "imported", acceptedRows: 6, rejectedRows: 1 });
    expect(log.rowErrors[0]).toMatchObject({ line: 7, column: "amount", value: "1,000" });
    const held = data.records.ledger.find((r) => r.entryId === "L-2099")!;
    expect([held.status, held.statusMeaning]).toEqual(["ON_HOLD", "unmapped"]);
  });

  it("links the ledger leg on instruction ID, provider payment ID, or the transfer's chain + hash + index", () => {
    const basis = (id: string) => { const l = forIns(data, id).legs.ledger; return l.state === "linked" ? l.links[0].basis : l.state; };
    expect(basis("INS-2001")).toBe("instruction_id");
    expect(basis("INS-2003")).toBe("provider_payment_id");
    expect(basis("INS-2002")).toBe("chain_tx_index");
  });

  it("an entry naming two different payments goes to review on both", async () => {
    const s = await setup();
    await applyImport(s.payments, "ledger", "l2.csv", enc("entry_id,booked_at,amount,status,instruction_id,provider_payment_id\nL-X,2026-10-22T06:00:00Z,-1,POSTED,INS-2006,AP-2004\n"),
      "payout-ledger-standard", undefined, NOW);
    const d = await rematch()(await s.payments.load());
    for (const id of ["INS-2006", "INS-2004"]) {
      const r = d.match!.result.reviews.find((x) => x.paymentId === forIns(d, id).paymentId && x.leg === "ledger");
      expect(r?.reason, id).toBe("conflicting_ids");
    }
  });
});

// ---- 2. Exception rules ----

describe("exception rules", () => {
  it("a fully linked payment with matching amounts has no exceptions", () => {
    expect(excFor(excs, data, "INS-2003")).toEqual([]);
    expect(excFor(excs, data, "INS-2006")).toEqual([]); // created ten minutes ago: still in flight
  });

  it("missing leg, later stage present: High", () => {
    const e = excFor(excs, data, "INS-2005").find((x) => x.code === "missing_leg")!;
    expect(e).toMatchObject({ confidence: "High", title: "Missing leg: no provider record, though the on-chain transfer and ledger entry are linked" });
    expect(e.evidence.find((x) => x.label === "Missing")!.value).toMatch(/stage 2 of 4/);
  });

  it("missing leg past the route's grace: Medium, only the stage it is stuck at", () => {
    const e = excFor(excs, data, "INS-2007").filter((x) => x.code === "missing_leg");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ confidence: "Medium", title: "Missing leg: no provider record 3 h 0 min after the instruction" });
  });

  it("provider reports complete but reported no hash: raised within grace, as Medium", () => {
    const e = excFor(excs, data, "INS-2008").find((x) => x.code === "missing_leg")!;
    expect(e).toMatchObject({ confidence: "Medium", title: "Missing leg: provider reports complete, but no transaction hash was reported" });
  });

  it("duplicate record is never called a duplicate payment", () => {
    const e = excFor(excs, data, "INS-2002").find((x) => x.code === "duplicate_record")!;
    expect(e.title).toMatch(/^Duplicate record: .*AP-2002.* arrived 2 times$/);
    expect(JSON.stringify(excs)).not.toMatch(/duplicate payment/i);
    expect(e.evidence.map((x) => x.value)).toEqual(expect.arrayContaining(["provider-1.csv line 4 · tp v1", "provider-1.csv line 5 · tp v1"]));
  });

  it("amount mismatch: exact decimals, no fee to explain it", () => {
    const e = excFor(excs, data, "INS-2004").find((x) => x.code === "amount_mismatch")!;
    expect(e).toMatchObject({ confidence: "High", title: "Amount mismatch: instruction 594.56 USDT vs On-chain 593.56" });
    expect(e.evidence.find((x) => x.label.startsWith("On-chain"))!.label).toBe("On-chain (differs by 1)");
  });

  it("a difference equal to the linked fee record is explained", () => {
    expect(codes(excFor(excs, data, "INS-2002"))).toEqual(["duplicate_record"]);
  });

  it("a difference equal to the route's configured fee rule is explained", () => {
    expect(excFor(excs, data, "INS-2003")).toEqual([]);
  });

  it("fee mismatch: the fee record disagrees with the configured rule", () => {
    const e = excFor(excs, data, "INS-2001").find((x) => x.code === "fee_mismatch")!;
    expect(e.title).toBe("Fee mismatch: provider charged 1.5 USDT, the route's rule gives 0.01");
  });

  it("overdue against the instruction's due_by, and against the route's deadline", () => {
    const due = excFor(excs, data, "INS-2007").find((x) => x.code === "overdue")!;
    expect(due.evidence.find((x) => x.label === "Deadline")!.value).toBe("2026-10-23 15:00 SGT (the instruction's due_by)");
    const route = excFor(excs, data, "INS-2005").find((x) => x.code === "overdue")!;
    expect(route.evidence.find((x) => x.label === "Deadline")!.value).toMatch(/created 2026-10-22 13:30 SGT \+ 1 d 0 h, route default/);
    // Complete payments are never overdue, however old.
    expect(excFor(excs, data, "INS-2001").some((x) => x.code === "overdue")).toBe(false);
  });

  it("unmatched settlement: a provider record no instruction carries, and an unlinked bank row", () => {
    const um = excs.filter((e) => e.code === "unmatched_settlement");
    expect(um.map((e) => e.title)).toEqual(expect.arrayContaining([
      "Unmatched settlement: TP AP-2009 (DONE) has no instruction",
      "Unmatched settlement: Bank credit 77 USD, reference BNK-9",
    ]));
    // Its free text names AP-2009, but free text is never read as a link.
    expect(um.find((e) => e.title.includes("BNK-9"))!.subject.kind).toBe("record");
  });

  it("contradiction: provider says completed, then a return arrives later", async () => {
    expect(excFor(excs, data, "INS-2001").some((e) => e.code === "contradiction")).toBe(false);
    const s = await setup();
    await applyImport(s.payments, "provider", "provider-2.csv", file("provider-2-later-return.csv"), "tp", undefined, NOW);
    const d = await rematch()(await s.payments.load());
    const e = computeExceptions({ data: d, settings: (await s.inbox.load()).settings, now: NOW }).find((x) => x.code === "contradiction")!;
    expect(e).toMatchObject({ confidence: "High", subject: { paymentId: forIns(d, "INS-2001").paymentId }, occurredAt: "2026-10-22T09:00:00Z" });
    expect(e.title).toBe("Contradiction: TP reported DONE at 2026-10-22 13:43 SGT, then a return arrived later: TP REFUND AP-2001R: status REFUNDED");
  });

  it("contradiction: the ledger posts, then reverses the same entry", async () => {
    const s = await setup();
    await applyImport(s.payments, "ledger", "l3.csv", enc("entry_id,booked_at,amount,status,currency,instruction_id\nL-2004,2026-10-22T08:00:00Z,-594.56,REVERSED,USDT,INS-2004\n"),
      "payout-ledger-standard", undefined, NOW);
    const d = await rematch()(await s.payments.load());
    const e = computeExceptions({ data: d, settings: (await s.inbox.load()).settings, now: NOW }).find((x) => x.code === "contradiction")!;
    expect(e.evidence.find((x) => x.label === "Ledger reversal")!.value).toMatch(/L-2004: -594.56 USDT, status REVERSED/);
    expect(e.title).toMatch(/The ledger later marked entry L-2004 REVERSED|ledger later marked entry L-2004 REVERSED/);
  });

  it("deposit codes appear as one more family; waiting and resolved cases don't", () => {
    const rows: DepositCaseRow[] = [
      { id: "CS-1", customerId: "C-1", chain: "tron", token: "USDT", amount: "10", code: "D12", label: "Arrived on-chain, not credited", confidence: "High", paused: false, bucket: "needs_action", live: true, href: "/investigate?q=x" },
      { id: "CS-2", customerId: "C-2", chain: "tron", token: "USDT", amount: "10", code: "D02", label: "Waiting for confirmations", confidence: "High", paused: false, bucket: "waiting" },
      { id: "CS-3", customerId: "C-3", chain: "tron", token: "USDT", amount: "10", code: "D13", label: "Already credited", confidence: "High", paused: false, bucket: "resolved" },
    ];
    const d = computeExceptions({ data, settings: { version: 1, updatedAt: "", updatedBy: "", routes: ROUTES }, now: NOW, cases: rows }).filter((e) => e.family === "deposit");
    expect(d).toEqual([expect.objectContaining({ exceptionId: "EXC-CS-1-D12", code: "D12", confidence: "High", subject: { kind: "case", caseId: "CS-1", href: "/investigate?q=x" },
      nextStep: "Escalate internally with the evidence pack (indexer lag or ops backlog)." })]);
  });

  it("exact decimal arithmetic", () => {
    expect(sub("655", "653.500000")).toBe("1.5");
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(mulBps("655", 50)).toBe("3.275");
    expect(sub("1", "1.000")).toBe("0");
  });
});

// ---- 3. Inbox ----

describe("inbox", () => {
  it("fills itself from matching: every exception and review, opened by the system and audit-logged", async () => {
    const s = await setup();
    const inbox = await syncAll(s, { now: NOW });
    const d = await s.payments.load();
    const exc = computeExceptions({ data: d, settings: inbox.settings, now: NOW });
    expect(Object.keys(inbox.items).sort()).toEqual([...exc.map((e) => e.exceptionId), ...d.match!.result.reviews.map((r) => r.reviewId)].sort());
    const item = inbox.items[exc[0].exceptionId];
    expect(item).toMatchObject({ status: "open", current: true, history: [{ by: "system", action: "opened" }] });
    const log = await s.audit.list();
    expect(log.filter((e) => e.action === "inbox.opened")).toHaveLength(Object.keys(inbox.items).length);
    expect(log.find((e) => e.action === "settings.routes")).toMatchObject({ actor: "Ana", actorKind: "person", ip: "203.0.113.7" });
  });

  it("owner, status, follow-up and notes, each recorded with who and when, and audit-logged", async () => {
    const s = await setup();
    const inbox = await syncAll(s, { now: NOW });
    const id = Object.values(inbox.items).find((i) => i.code === "amount_mismatch")!.itemId;
    const t = (m: number) => new Date(NOW.getTime() + m * 60_000);
    expect(await act(s, id, { kind: "owner", owner: "Ana" }, ANA, t(1))).toEqual({});
    expect(await act(s, id, { kind: "status", to: "awaiting_provider" }, ANA, t(2))).toEqual({});
    expect(await act(s, id, { kind: "follow_up", date: "2026-10-27" }, ANA, t(3))).toEqual({});
    expect(await act(s, id, { kind: "note", text: "Asked TP for their statement line." }, ANA, t(4))).toEqual({});
    expect(await act(s, id, { kind: "status", to: "under_review" }, ANA, t(5))).toEqual({});
    const item = (await s.inbox.load()).items[id];
    expect(item).toMatchObject({ owner: "Ana", status: "under_review", followUp: "2026-10-27", notes: [{ by: "Ana", text: "Asked TP for their statement line." }] });
    expect(item.history.map((h) => h.action)).toEqual(["opened", "owner", "status", "follow_up", "note", "status"]);
    const mine = (await s.audit.list()).filter((e) => e.subject === id && e.actor === "Ana");
    expect(mine.map((e) => e.action)).toEqual(["inbox.owner", "inbox.status", "inbox.follow_up", "inbox.note", "inbox.status"]);
    expect(mine.every((e) => e.ip === "203.0.113.7" && e.at)).toBe(true);
  });

  it("refuses moves that would lose information", async () => {
    const s = await setup();
    const inbox = await syncAll(s, { now: NOW });
    const exc = Object.values(inbox.items).find((i) => i.kind === "exception")!.itemId;
    const rev = Object.values(inbox.items).find((i) => i.kind === "review")!.itemId;
    expect((await act(s, exc, { kind: "status", to: "closed" }, ANA, NOW)).error).toBe("Say why it is being closed.");
    expect((await act(s, exc, { kind: "status", to: "reopened", why: "x" }, ANA, NOW)).error).toBe("Only a closed item can be reopened.");
    expect((await act(s, rev, { kind: "status", to: "closed", why: "x" }, ANA, NOW)).error).toBe("Resolve a review by confirming or rejecting a candidate.");
    expect((await act(s, exc, { kind: "note", text: "x" }, { actor: "" }, NOW)).error).toMatch(/Acting as/);
    expect((await act(s, exc, { kind: "note", text: "x" }, { actor: "ana@example.com" }, NOW)).error).toBe("Use a name, not an email address.");
    expect((await act(s, exc, { kind: "follow_up", date: "next week" }, ANA, NOW)).error).toBe("Follow-up must be a date (YYYY-MM-DD).");
  });

  it("closes an exception by itself when its condition goes away, keeping the history", async () => {
    const s = await setup();
    await syncAll(s, { now: NOW });
    const id = `EXC-${forIns(await s.payments.load(), "INS-2007").paymentId.slice(4)}-missing_leg-provider`;
    await applyImport(s.payments, "provider", "late.csv", enc("payment_id,our_ref,state,amount,currency,created,hash,kind,parent\nAP-2007,INS-2007,PROC,20.00,USDT,2026-10-23T08:05:00Z,,PAYMENT,\n"), "tp", undefined, NOW);
    await s.payments.save(await rematch()(await s.payments.load()));
    const inbox = await syncAll(s, { now: NOW });
    expect(inbox.items[id]).toMatchObject({ status: "closed", current: false });
    expect(inbox.items[id].history.map((h) => h.action)).toEqual(["opened", "closed_by_system"]);
  });

  it("provider says completed, a return arrives later: the contradiction opens and reopens the closed exception on that payment", async () => {
    const s = await setup();
    await syncAll(s, { now: NOW });
    const p1 = forIns(await s.payments.load(), "INS-2001").paymentId;
    const fee = `EXC-${p1.slice(4)}-fee_mismatch`;
    expect(await act(s, fee, { kind: "status", to: "closed", why: "One-off pricing agreed with TP." }, ANA, NOW)).toEqual({});

    const later = new Date("2026-10-23T09:00:00Z");
    await applyImport(s.payments, "provider", "provider-2.csv", file("provider-2-later-return.csv"), "tp", undefined, later);
    await s.payments.save(await rematch(later)(await s.payments.load()));
    const inbox = await syncAll(s, { now: later });

    const contra = inbox.items[`EXC-${p1.slice(4)}-contradiction`];
    expect(contra).toMatchObject({ status: "open", code: "contradiction" });
    const reopened = inbox.items[fee];
    expect(reopened.status).toBe("reopened");
    expect(reopened.history.map((h) => [h.action, h.by])).toEqual([["opened", "system"], ["status", "Ana"], ["reopened", "system"]]);
    expect(reopened.history[1].why).toBe("One-off pricing agreed with TP.");
    expect(reopened.history[2].why).toMatch(new RegExp(`^Contradiction EXC-${p1.slice(4)}-contradiction: Contradiction: TP reported DONE`));
    expect((await s.audit.list()).some((e) => e.action === "inbox.reopened" && e.subject === fee && e.actor === "system")).toBe(true);
  });

  it("the contradiction reopens what a person closed, not what the system closed because it went away", async () => {
    const s: Stores = { payments: new MemoryPaymentsStore(), inbox: new MemoryInboxStore(), audit: new MemoryAuditLog() };
    await saveMappingVersion(s.payments, TP, NOW);
    await saveRoutes(s, ROUTES, ANA, NOW);
    // Instructions alone: INS-2001 is stuck waiting for its provider record, and overdue.
    await applyImport(s.payments, "instruction", "instructions.csv", file("instructions.csv"), "instructions-standard", undefined, NOW);
    await s.payments.save(await rematch()(await s.payments.load()));
    const t1 = NOW, t2 = new Date("2026-10-23T08:10:00Z"), t3 = new Date("2026-10-23T08:20:00Z");
    await syncAll(s, { now: t1 });
    const p1 = forIns(await s.payments.load(), "INS-2001").paymentId.slice(4);
    // The provider report and ledger arrive: those two close by themselves; Ana closes the fee mismatch.
    await applyImport(s.payments, "provider", "provider-1.csv", file("provider-1.csv"), "tp", undefined, NOW);
    await applyImport(s.payments, "ledger", "ledger.csv", file("ledger.csv"), "payout-ledger-standard", undefined, NOW);
    await s.payments.save(await rematch(t2)(await s.payments.load()));
    await syncAll(s, { now: t2 });
    expect(await act(s, `EXC-${p1}-fee_mismatch`, { kind: "status", to: "closed", why: "Agreed." }, ANA, t2)).toEqual({});
    // The later return.
    await applyImport(s.payments, "provider", "provider-2.csv", file("provider-2-later-return.csv"), "tp", undefined, NOW);
    await s.payments.save(await rematch(t3)(await s.payments.load()));
    const inbox = await syncAll(s, { now: t3 });
    expect(inbox.items[`EXC-${p1}-fee_mismatch`].status).toBe("reopened");
    expect(inbox.items[`EXC-${p1}-missing_leg-provider`].status).toBe("closed");
    expect(inbox.items[`EXC-${p1}-overdue`].status).toBe("closed");
    // They were closed by the system at t2, a run before the return.
    expect(inbox.items[`EXC-${p1}-overdue`].history.map((h) => h.action)).toEqual(["opened", "closed_by_system"]);
  });

  it("a closed exception reopens when its evidence changes", async () => {
    const s = await setup();
    await syncAll(s, { now: NOW });
    const id = `EXC-${forIns(await s.payments.load(), "INS-2004").paymentId.slice(4)}-amount_mismatch`;
    await act(s, id, { kind: "status", to: "closed", why: "Rounding agreed." }, ANA, NOW);
    // A fee row arrives that doesn't explain the difference either: new evidence.
    await applyImport(s.payments, "provider", "fee.csv", enc("payment_id,our_ref,state,amount,currency,created,hash,kind,parent\nAP-2004F,,DONE,0.50,USDT,2026-10-21T14:03:00Z,,FEE,AP-2004\n"), "tp", undefined, NOW);
    await s.payments.save(await rematch()(await s.payments.load()));
    const item = (await syncAll(s, { now: NOW })).items[id];
    expect(item.status).toBe("reopened");
    expect(item.history.at(-1)).toMatchObject({ by: "system", action: "reopened", why: expect.stringMatching(/^New evidence/) });
  });
});

// ---- Review resolution in the app ----

describe("resolving a review in the app", () => {
  it("confirm a candidate: linked with who, when and why; review closed as resolved; audit-logged", async () => {
    const s = await setup();
    await syncAll(s, { now: NOW });
    const d0 = await s.payments.load();
    const p = forIns(d0, "INS-2010");
    const review = d0.match!.result.reviews.find((r) => r.paymentId === p.paymentId && r.leg === "provider")!;
    const b = review.candidates.find((c) => c.recordId.startsWith("prv:TP:AP-2010B:"))!;
    const t = new Date("2026-10-23T08:10:00Z");
    const res = await resolveReview(s, { reviewId: review.reviewId, recordId: b.recordId, action: "confirm", why: "TP confirmed AP-2010A was cancelled and retried as B." }, ANA, t, rematch(t));
    expect(res.error).toBeUndefined();
    expect(res.decision).toMatchObject({ decisionId: "DEC-0001", by: "Ana", at: t.toISOString(), anchorKey: "instruction:INS-2010", recordKey: "provider:TP:AP-2010B", leg: "provider" });

    const d1 = await s.payments.load();
    const after = forIns(d1, "INS-2010");
    expect(after.paymentId).toBe(p.paymentId);
    expect(after.legs.provider).toMatchObject({ state: "linked", links: [{ basis: "confirmed", detail: expect.stringMatching(/^Confirmed by Ana on 2026-10-23 \(DEC-0001\): TP confirmed/) }] });
    expect(after.decisions.map((x) => x.decisionId)).toEqual(["DEC-0001"]);
    const item = (await s.inbox.load()).items[review.reviewId];
    expect(item.status).toBe("closed");
    expect(item.history.map((h) => h.action)).toEqual(["opened", "decision", "resolved"]);
    const log = await s.audit.list();
    expect(log.find((e) => e.action === "review.confirm")).toMatchObject({ actor: "Ana", ip: "203.0.113.7", subject: review.reviewId });
    // The other candidate is now a provider record nothing claims: an unmatched settlement.
    expect(Object.values((await s.inbox.load()).items).some((i) => i.title === "Unmatched settlement: TP AP-2010A (PROC) has no instruction")).toBe(true);
    // The decision holds on every later run.
    const again = await rematch()(d1);
    expect(forIns(again, "INS-2010").legs.provider.state).toBe("linked");
  });

  it("reject a candidate: the remaining exact candidate links on its own identifier", async () => {
    const s = await setup();
    await syncAll(s, { now: NOW });
    const d0 = await s.payments.load();
    const review = d0.match!.result.reviews.find((r) => r.paymentId === forIns(d0, "INS-2010").paymentId)!;
    const a = review.candidates.find((c) => c.recordId.startsWith("prv:TP:AP-2010A:"))!;
    await resolveReview(s, { reviewId: review.reviewId, recordId: a.recordId, action: "reject", why: "Cancelled attempt." }, ANA, NOW, rematch());
    const l = forIns(await s.payments.load(), "INS-2010").legs.provider;
    expect(l).toMatchObject({ state: "linked", links: [{ basis: "merchant_reference" }] });
  });

  it("needs a reason, a name, and a real candidate", async () => {
    const s = await setup();
    await syncAll(s, { now: NOW });
    const d0 = await s.payments.load();
    const review = d0.match!.result.reviews[0];
    const c = review.candidates[0].recordId;
    expect((await resolveReview(s, { reviewId: review.reviewId, recordId: c, action: "confirm", why: " " }, ANA, NOW, rematch())).error).toMatch(/Say why/);
    expect((await resolveReview(s, { reviewId: review.reviewId, recordId: c, action: "confirm", why: "x" }, { actor: "" }, NOW, rematch())).error).toMatch(/Acting as/);
    expect((await resolveReview(s, { reviewId: review.reviewId, recordId: "prv:nope", action: "confirm", why: "x" }, ANA, NOW, rematch())).error).toMatch(/not a candidate/);
    expect(await s.audit.list()).not.toContainEqual(expect.objectContaining({ action: "review.confirm" }));
  });

  it("confirm one version of a conflicted instruction", async () => {
    const s = await setup();
    await applyImport(s.payments, "instruction", "v2.csv", enc(
      "instruction_id,created_at,amount,chain,token\nINS-2006,2026-10-23T07:50:00Z,12.00,tron,USDT\n"), "instructions-standard", undefined, NOW);
    await s.payments.save(await rematch()(await s.payments.load()));
    await syncAll(s, { now: NOW });
    const d0 = await s.payments.load();
    const review = d0.match!.result.reviews.find((r) => r.paymentId === forIns(d0, "INS-2006").paymentId && r.leg === "instruction")!;
    const v2 = review.candidates.find((c) => (d0.records.instruction.find((i) => i.recordId === c.recordId)?.amount) === "12.00")!;
    await resolveReview(s, { reviewId: review.reviewId, recordId: v2.recordId, action: "confirm", why: "Amended to 12.00 by the client." }, ANA, NOW, rematch());
    const p = forIns(await s.payments.load(), "INS-2006");
    expect(p.legs.instruction).toMatchObject({ state: "linked" });
    expect(p.timeline.filter((t) => t.kind === "instruction")).toHaveLength(1);
  });
});

// ---- Route settings ----

describe("route settings", () => {
  it("are validated, versioned and audit-logged", async () => {
    const s = await setup();
    const bad = await saveRoutes(s, [{ ...ROUTES[0], fee: { kind: "fixed", amount: "1,00" } }], ANA, NOW);
    expect(bad.errors).toEqual(expect.arrayContaining(["Route 1: a fixed fee needs an exact decimal amount.",
      "The last route must match anything (empty match), so every payment has a route."]));
    const inbox = await s.inbox.load();
    expect(inbox.settings).toMatchObject({ version: 2, updatedBy: "Ana" });
  });

  it("the ledger leg's records stay typed as payout entries", () => {
    const r = data.records.ledger[0] as LedgerEntryRecord;
    expect(r).toMatchObject({ kind: "ledger", ledger: "payout" });
  });
});
