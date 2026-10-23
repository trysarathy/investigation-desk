// Review fixes on PR #13 (chunk 2). Each block was written to fail before its fix. On-chain
// transfers are real, replayed from tests/fixtures/live/ (payout side: bsc-payout-*.json).

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resultsCsv } from "@/lib/bulk/export";
import { validateFileB } from "@/lib/csv/files";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { RECORDINGS } from "@/lib/demo/recordings";
import { demoTransport } from "@/lib/demo/transport";
import { FileAuditLog, MemoryAuditLog } from "@/lib/payments/audit";
import { computeExceptions } from "@/lib/payments/exceptions";
import { openContradictionsFor, resolveItemId } from "@/lib/payments/inbox";
import { importWithMapping, type ColumnMapping } from "@/lib/payments/mapping";
import { matchPayments, resolvePaymentRef } from "@/lib/payments/match";
import { renderPack, wrapLines } from "@/lib/payments/pdf";
import { refreshMatching } from "@/lib/payments/refresh";
import type { ExceptionSettings } from "@/lib/payments/settings";
import { applyImport, ledgerFromFileB, MemoryPaymentsStore, saveMappingVersion, type PaymentsData } from "@/lib/payments/store";
import type { ChainTransferRecord, InstructionRecord, PaymentRecord, ReviewDecision } from "@/lib/payments/types";
import { act, clearAll, importFile, MemoryInboxStore, resolveReview, syncAll, type Stores } from "@/lib/payments/workflow";

const NOW = new Date("2026-10-23T08:00:00Z");
const enc = (s: string) => new TextEncoder().encode(s);
const ctx = { importId: "t", fileName: "t.csv", now: NOW };
const ANA = { actor: "Ana", ip: "203.0.113.7" };
const N1 = "dd30c41dc59fb841d451bf098d6b64bd1ec5371e0927d7e863ca6a7fee7d00c7"; // 61.23001201 USDT, index 129
const N2 = "e348b97f471659cf7ca7b65d65bff17a896e9a36f16bddd80fde1d9f91108325"; // 273.987528 USDT, index 65
const N2_TO = "0xa34180c830e2c135b44f95cc96656818b4285466";
const N4 = "9ae6105d006176f68ef43453109de3f9f5fdbec7e895e9eda6dd0b39d3811d80"; // 593.56 USDT
const NOT_FOUND = "4a1d0f6b9c3e2a7d8f5b6c4e3a2d1f0e9c8b7a6d5e4f3a2b1c0d9e8f7a6b5c4d";

const recorded = () => buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
  transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true });
const rematch = (now = NOW) => (d: PaymentsData) => refreshMatching(d, recorded(), [], () => now);

const TP: Omit<ColumnMapping, "version" | "createdAt"> = {
  mappingId: "tp", kind: "provider", name: "TP", provider: "TP",
  columns: { provider_payment_id: "payment_id", merchant_reference: "our_ref", status: "state", amount: "amount", currency: "currency",
    event_time: "created", tx_hash: "hash", type: "kind", relates_to: "parent" },
  values: { status: { DONE: "provider_reports_complete", PROC: "processing", REFUNDED: "returned", CANCELLED: "cancelled" },
    type: { PAYMENT: "principal", FEE: "fee", REFUND: "return" } },
  timestampFormat: "iso8601_offset",
};
const DEFAULT_ROUTES: ExceptionSettings = { version: 1, updatedAt: "", updatedBy: "", routes: [
  { routeId: "default", name: "Any", match: {}, deadlineMinutes: 1440, graceMinutes: 60, expectedLegs: ["instruction", "provider", "chain", "ledger"], fee: { kind: "none" } },
] };
const P_HEAD = "payment_id,our_ref,state,amount,currency,created,hash,kind,parent";
const I_HEAD = "instruction_id,created_at,amount,chain,token,to_address,tx_hash,transfer_index,provider_payment_id,due_by";

async function stores(): Promise<Stores> {
  const s: Stores = { payments: new MemoryPaymentsStore(), inbox: new MemoryInboxStore(), audit: new MemoryAuditLog() };
  await saveMappingVersion(s.payments, TP, NOW);
  return s;
}
async function load(s: Stores, files: [string, string, string][], now = NOW) {
  for (const [kind, mapping, csv] of files) await applyImport(s.payments, kind as "instruction", `${kind}.csv`, enc(csv), mapping, undefined, now);
  await s.payments.save(await rematch(now)(await s.payments.load()));
}
const byIns = (d: PaymentsData, id: string) => d.match!.result.payments.find((p) => p.anchor.kind === "instruction" && p.anchor.recordId.startsWith(`ins:${id}:`))!;
const excs = (d: PaymentsData, settings = DEFAULT_ROUTES) => computeExceptions({ data: d, settings, now: NOW });

// ---- 1. A transfer confirmed for one payment is not auto-linked to another ----

describe("confirmed transfer stays with its payment", () => {
  const ins = importWithMapping(enc(`${I_HEAD}\nINS-A,2026-10-22T05:35:00Z,61.23001201,bsc,USDT,,${N1},,,\nINS-B,2026-10-22T05:36:00Z,61.23001201,bsc,USDT,,${N1},,,\n`),
    { ...TP, kind: "instruction", mappingId: "instructions-standard", version: 1, createdAt: "", provider: undefined,
      columns: { instruction_id: "instruction_id", created_at: "created_at", amount: "amount", chain: "chain", token: "token", tx_hash: "tx_hash" }, values: undefined }, ctx).rows as InstructionRecord[];
  const transfer: ChainTransferRecord = { recordId: `chn:bsc:${N1}:129`, kind: "chain_transfer", chain: "bsc", txHash: N1, transferIndex: 129, txStatus: "success",
    token: "USDT", amount: "61.230012010000000000", blockNumber: 1, transfersInTx: 1, eventTime: "2026-10-22T05:41:55Z", observedTime: NOW.toISOString(),
    identifiers: [], original: {}, sources: [{ kind: "chain", url: "https://bscscan.com/tx/0x" + N1, rawSha256: [], fetchedAt: NOW.toISOString() }] };
  const base = { instructions: ins, provider: [], bank: [], chain: [transfer], lookups: [{ txHash: N1, result: "found" as const, chain: "bsc" as const, checkedAt: NOW.toISOString() }] };

  it("both naming it: review; confirmed for A: A links, B does not", () => {
    const before = matchPayments(base);
    for (const p of before.payments) expect(p.legs.chain.state).toBe("needs_review");
    const decision: ReviewDecision = { decisionId: "DEC-0001", reviewId: "REV-x-chain", anchorKey: "instruction:INS-A", paymentId: "", leg: "chain",
      action: "confirm", recordKey: transfer.recordId, recordId: transfer.recordId, by: "Ana", at: NOW.toISOString(), why: "A's payout." };
    const after = matchPayments({ ...base, decisions: [decision] });
    const a = after.payments.find((p) => p.anchor.recordId.startsWith("ins:INS-A:"))!;
    const b = after.payments.find((p) => p.anchor.recordId.startsWith("ins:INS-B:"))!;
    expect(a.legs.chain).toMatchObject({ state: "linked", links: [{ basis: "confirmed" }] });
    expect(b.legs.chain.state).not.toBe("linked");
    const rev = after.reviews.find((r) => r.paymentId === b.paymentId && r.leg === "chain")!;
    expect(rev.message).toMatch(/confirmed for another payment .*DEC-0001/);
  });
});

// ---- 2. Never High on unknown facts ----

describe("unknown facts lower the confidence", () => {
  it("overdue with the on-chain lookup failed is Medium and says so, not 'still waiting'", async () => {
    const s = await stores();
    await load(s, [
      ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-21T10:00:00Z,61.23001201,bsc,USDT,,${N1},,,2026-10-22T00:00:00Z\n`],
      ["provider", "tp", `${P_HEAD}\nAP-1,INS-1,DONE,61.23001201,USDT,2026-10-21T10:05:00Z,,PAYMENT,\n`],
      ["ledger", "payout-ledger-standard", "entry_id,booked_at,amount,status,currency,instruction_id\nL-1,2026-10-21T10:10:00Z,-61.23001201,POSTED,USDT,INS-1\n"],
    ]);
    // The chains didn't answer this time: the lookup failed.
    const d = await s.payments.load();
    d.chain.lookups = d.chain.lookups.map((l) => ({ ...l, result: "error" as const, error: "No answer from BNB Chain." }));
    d.chain.transfers = [];
    const m = await refreshMatching({ ...d }, buildFetchers({ tronKey: "k", etherscanKey: "k", store: new MemoryStore(), sleep: async () => {}, noSpacing: true,
      transport: async () => { throw new Error("network down"); } }), [], () => NOW);
    expect(byIns(m, "INS-1").legs.chain.state).toBe("unknown");
    const overdue = excs(m).find((e) => e.code === "overdue")!;
    expect(overdue.confidence).toBe("Medium");
    expect(overdue.title).not.toMatch(/still waiting/);
    expect(overdue.title).toMatch(/on-chain lookup failed/);
  });

  it("provider COMPLETE with no hash reported: Medium, worded 'no hash reported'", async () => {
    const s = await stores();
    await load(s, [
      ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-23T07:55:00Z,30.00,tron,USDT,,,,,\n`],
      ["provider", "tp", `${P_HEAD}\nAP-1,INS-1,DONE,30.00,USDT,2026-10-23T07:58:00Z,,PAYMENT,\n`],
    ]);
    const e = excs(await s.payments.load()).find((x) => x.code === "missing_leg")!;
    expect(e).toMatchObject({ confidence: "Medium", title: "Missing leg: provider reports complete, but no transaction hash was reported" });
  });

  it("provider COMPLETE with a hash that is on no chain: still High, saying so", async () => {
    const s = await stores();
    await load(s, [
      ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-23T07:55:00Z,30.00,tron,USDT,,,,,\n`],
      ["provider", "tp", `${P_HEAD}\nAP-1,INS-1,DONE,30.00,USDT,2026-10-23T07:58:00Z,${NOT_FOUND},PAYMENT,\n`],
    ]);
    const e = excs(await s.payments.load()).find((x) => x.code === "missing_leg")!;
    expect(e).toMatchObject({ confidence: "High", title: "Missing leg: provider reports complete, but its transaction is on no supported chain" });
  });
});

// ---- 3. Inbox items follow payment ID redirects ----

describe("inbox items follow a merge", () => {
  it("X merged into Y carries status, owner, notes, history and a person's close to Y", async () => {
    const s = await stores();
    // Run 1: the provider record alone (reported twice), so it is payment X with two exceptions.
    await load(s, [["provider", "tp", `${P_HEAD}\nAP-9,INS-9,DONE,9.00,USDT,2026-10-23T06:00:00Z,,PAYMENT,\nAP-9,INS-9,DONE,9.00,USDT,2026-10-23T06:00:00Z,,PAYMENT,\n`]]);
    const X = (await s.payments.load()).match!.result.payments[0].paymentId;
    const inbox1 = await syncAll(s, { now: NOW });
    const chainX = `EXC-${X.slice(4)}-missing_leg-chain`;
    const dupX = Object.keys(inbox1.items).find((k) => k.startsWith(`EXC-${X.slice(4)}-duplicate_record-`))!;
    expect(inbox1.items[chainX]).toBeDefined();
    await act(s, chainX, { kind: "owner", owner: "Ana" }, ANA, NOW);
    await act(s, chainX, { kind: "note", text: "Asked TP for the hash." }, ANA, NOW);
    await act(s, chainX, { kind: "status", to: "awaiting_provider" }, ANA, NOW);
    await act(s, dupX, { kind: "status", to: "closed", why: "Overlapping export." }, ANA, NOW);

    // Run 2: the instruction arrives in two versions (gets Y); X waits in review. Run 3: a person settles it; X merges into Y.
    await load(s, [["instruction", "instructions-standard", `${I_HEAD}\nINS-9,2026-10-23T05:55:00Z,9.00,tron,USDT,,,,,\nINS-9,2026-10-23T05:55:00Z,9.50,tron,USDT,,,,,\n`]]);
    await syncAll(s, { now: NOW });
    const d2 = await s.payments.load();
    const review = d2.match!.result.reviews.find((r) => r.leg === "instruction")!;
    const right = review.candidates.find((c) => d2.records.instruction.find((i) => i.recordId === c.recordId)!.amount === "9.00")!;
    await resolveReview(s, { reviewId: review.reviewId, recordId: right.recordId, action: "confirm", why: "9.50 was a typo." }, ANA, NOW, rematch());
    const d3 = await s.payments.load();
    const Y = byIns(d3, "INS-9").paymentId;
    expect(resolvePaymentRef(d3.match!.result, X).payment?.paymentId).toBe(Y);

    const inbox = await s.inbox.load();
    const chainY = `EXC-${Y.slice(4)}-missing_leg-chain`;
    expect(inbox.items[chainY]).toMatchObject({ status: "awaiting_provider", owner: "Ana", notes: [{ by: "Ana", text: "Asked TP for the hash." }] });
    expect(inbox.items[chainY].history.map((h) => h.action)).toEqual(expect.arrayContaining(["opened", "owner", "note", "status", "moved"]));
    expect(inbox.items[chainY].history.find((h) => h.action === "moved")!.why).toBe(`${X} merged into ${Y}; this item was ${chainX}.`);
    const dupY = dupX.replace(X.slice(4), Y.slice(4));
    expect(inbox.items[dupY]).toMatchObject({ status: "closed" });
    expect(inbox.items[dupY].history.find((h) => h.to === "closed")).toMatchObject({ by: "Ana", why: "Overlapping export." });
    // The old item IDs still lead somewhere.
    expect(resolveItemId(inbox, chainX)).toBe(chainY);
    expect(resolveItemId(inbox, dupX)).toBe(dupY);
  });
});

// ---- 4. Amount checks without an instruction token ----

describe("amounts compare whenever two legs share an asset", () => {
  it("instruction with no token: provider and on-chain amounts are still compared", async () => {
    const s = await stores();
    await load(s, [
      ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-22T05:35:00Z,100,bsc,,,,,,\n`],
      ["provider", "tp", `${P_HEAD}\nAP-1,INS-1,DONE,100,USDT,2026-10-22T05:43:00Z,0x${N4},PAYMENT,\n`],
    ]);
    const e = excs(await s.payments.load()).find((x) => x.code === "amount_mismatch")!;
    expect(e?.title).toBe("Amount mismatch: provider 100 USDT vs On-chain 593.560000000000000000");
    expect(e.evidence.find((x) => x.label.startsWith("Instruction"))!.label).toBe("Instruction (not compared: no asset)");
  });
});

// ---- 5. Audit log ----

describe("audit log", () => {
  it("sequence numbers strictly increase under concurrent writes", async () => {
    const log = new FileAuditLog(path.join(await mkdtemp(path.join(tmpdir(), "audit-")), "audit.jsonl"));
    const entry = (i: number) => ({ at: NOW.toISOString(), actor: "system", actorKind: "system" as const, action: "t", subject: `s${i}`, detail: "" });
    await Promise.all(Array.from({ length: 25 }, (_, i) => log.append([entry(i), entry(i)])));
    const seqs = (await log.list()).map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("imports and clear records are logged with the actor; neither runs without one", async () => {
    const s = await stores();
    const csv = enc(`${I_HEAD}\nINS-1,2026-10-22T05:35:00Z,1,bsc,USDT,,,,,\n`);
    expect((await importFile(s, { kind: "instruction", fileName: "i.csv", bytes: csv, mappingId: "instructions-standard" }, { actor: "" }, NOW, rematch())).error).toMatch(/Acting as/);
    const res = await importFile(s, { kind: "instruction", fileName: "i.csv", bytes: csv, mappingId: "instructions-standard" }, ANA, NOW, rematch());
    expect(res.log).toMatchObject({ outcome: "imported", acceptedRows: 1 });
    expect((await clearAll(s, { actor: "" }, NOW)).error).toMatch(/Acting as/);
    expect(await clearAll(s, ANA, NOW)).toEqual({});
    const log = await s.audit.list();
    expect(log.find((e) => e.action === "payments.import")).toMatchObject({ actor: "Ana", ip: "203.0.113.7", subject: "i.csv",
      detail: expect.stringMatching(/^instruction file i\.csv \(instructions-standard v1\): imported, 1 accepted, 0 rejected; SHA-256 [0-9a-f]{64}$/) });
    expect(log.find((e) => e.action === "payments.clear")).toMatchObject({ actor: "Ana", ip: "203.0.113.7" });
    expect((await s.payments.load()).records.instruction).toEqual([]);
  });
});

// ---- 6. PDF wrapping is linear ----

describe("evidence pack wrapping", () => {
  it("a 10,000-character unbroken string wraps and renders in under a second", async () => {
    const long = "ab".repeat(5000);
    const t0 = performance.now();
    const lines = wrapLines(long, 9);
    const pdf = await renderPack({ title: "t", subtitle: "s", generatedAt: NOW.toISOString(), sections: [{ heading: "Long", lines: [long] }] });
    const ms = performance.now() - t0;
    expect(lines.join("")).toBe(long);
    expect(lines.length).toBeGreaterThan(50);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(1000);
  });
});

// ---- 7. Contradiction start time is the earliest instant ----

describe("contradiction timing", () => {
  it("uses parsed instants, not text order, across offsets", async () => {
    const s = await stores();
    await load(s, [
      ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-22T00:30:00Z,9.00,tron,USDT,,,,,\n`],
      ["provider", "tp", [P_HEAD,
        "AP-1,INS-1,DONE,9.00,USDT,2026-10-22T01:00:00Z,,PAYMENT,",
        // 10:00 at +08:00 is 02:00Z: the earliest contradiction, though later as text.
        "AP-1,INS-1,CANCELLED,9.00,USDT,2026-10-22T10:00:00+08:00,,PAYMENT,",
        "AP-1R,,REFUNDED,9.00,USDT,2026-10-22T09:00:00Z,,REFUND,AP-1"].join("\n") + "\n"],
    ]);
    const e = excs(await s.payments.load()).find((x) => x.code === "contradiction")!;
    expect(e.occurredAt).toBe("2026-10-22T10:00:00+08:00");
  });
});

// ---- Decisions ----

describe("contradiction banner", () => {
  it("every other item of the payment points at its open contradiction", async () => {
    const s = await stores();
    await load(s, [
      ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-22T00:30:00Z,9.00,tron,USDT,,,,,\nINS-2,2026-10-22T00:30:00Z,5.00,tron,USDT,,,,,\n`],
      ["provider", "tp", `${P_HEAD}\nAP-1,INS-1,DONE,9.00,USDT,2026-10-22T01:00:00Z,,PAYMENT,\nAP-1R,,REFUNDED,9.00,USDT,2026-10-22T09:00:00Z,,REFUND,AP-1\n`],
    ]);
    const inbox = await syncAll(s, { now: NOW });
    const d = await s.payments.load();
    const p1 = byIns(d, "INS-1").paymentId, p2 = byIns(d, "INS-2").paymentId;
    const paymentOf = (id: string) => resolvePaymentRef(d.match!.result, id).payment?.paymentId ?? id;
    const contra = `EXC-${p1.slice(4)}-contradiction`;
    const others = Object.values(inbox.items).filter((i) => i.subject.kind === "payment" && i.subject.paymentId === p1 && i.itemId !== contra);
    expect(others.length).toBeGreaterThan(0);
    for (const i of others) expect(openContradictionsFor(inbox, i, paymentOf).map((c) => c.itemId)).toEqual([contra]);
    const elsewhere = Object.values(inbox.items).find((i) => i.subject.kind === "payment" && i.subject.paymentId === p2)!;
    expect(openContradictionsFor(inbox, elsewhere, paymentOf)).toEqual([]);
  });
});

describe("ledger legs by direction", () => {
  const fileB = (to: string) => {
    const v = validateFileB(enc(`deposit_id,tx_hash,chain,token,to_address,amount,status,credited_at,customer_id,transfer_index\nDEP-1,0x${N2},bsc,USDT,${to},273.987528,CREDITED,2026-10-22T06:00:00Z,C-1,65\n`));
    expect(v.rowErrors).toEqual([]);
    return ledgerFromFileB(v.rows, v.sha256, NOW.toISOString());
  };
  const records = async () => {
    const s = await stores();
    await load(s, [
      ["instruction", "instructions-standard", `${I_HEAD}\nINS-1,2026-10-22T05:35:00Z,273.987528,bsc,USDT,,0x${N2},65,,\n`],
      ["ledger", "payout-ledger-standard", "entry_id,booked_at,amount,status,currency,instruction_id\nL-1,2026-10-22T05:50:00Z,-273.987528,POSTED,USDT,INS-1\n"],
    ]);
    return s.payments.load();
  };
  const run = (d: PaymentsData, ledger: PaymentRecord[], deposits?: { chain: "bsc"; address: string }[]) =>
    matchPayments({ instructions: d.records.instruction, provider: [], bank: [], chain: d.chain.transfers, lookups: d.chain.lookups,
      ledger: [...d.records.ledger, ...ledger] as never, depositAddresses: deposits });

  it("an outbound payout: the payout ledger links, a deposit row on the same transfer does not", async () => {
    const d = await records();
    const r = run(d, fileB(N2_TO), []);
    const p = r.payments.find((x) => x.anchor.recordId.startsWith("ins:INS-1:"))!;
    expect(p.legs.ledger).toMatchObject({ state: "linked", links: [{ basis: "instruction_id" }] });
  });

  it("an inbound transfer (to a company deposit address): only the deposit ledger links", async () => {
    const d = await records();
    const r = run(d, fileB(N2_TO), [{ chain: "bsc", address: N2_TO }]);
    const p = r.payments.find((x) => x.anchor.recordId.startsWith("ins:INS-1:"))!;
    expect(p.legs.ledger).toMatchObject({ state: "linked", links: [{ recordId: "ldg:DEP-1" }] });
    expect(r.unlinked.map((u) => u.recordId)).toEqual(expect.arrayContaining([expect.stringMatching(/^ldp:L-1:/)]));
  });
});

describe("unmatched ledger entry", () => {
  it("a payout ledger entry tied to no payment is a Medium exception", async () => {
    const s = await stores();
    await load(s, [["ledger", "payout-ledger-standard", "entry_id,booked_at,amount,status,currency\nL-9,2026-10-22T05:50:00Z,-5.00,POSTED,USDT\n"]]);
    const e = excs(await s.payments.load()).find((x) => x.code === "unmatched_ledger_entry")!;
    expect(e).toMatchObject({ confidence: "Medium", title: "Unmatched ledger entry: Payout ledger entry L-9: -5.00 USDT, status POSTED" });
  });
});

describe("bulk export CSV writer", () => {
  it("keeps signed amounts as numbers and still neutralises formulas", () => {
    const out = resultsCsv([{ line: 2, txHash: "ab", customerInferred: false, state: "verdict", code: "D12",
      label: "=HYPERLINK(1)", confidence: "High", token: "USDT", amount: "-5.25" }]);
    const row = out.split("\n")[1];
    expect(row).toContain(",-5.25,");
    expect(row).toContain(",'=HYPERLINK(1),");
  });
});
