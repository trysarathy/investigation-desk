// Second review on PR #12: retired payment IDs never vanish; merchant-reference fees and returns
// wait for linked legs; provider records held in a review keep their reserved IDs. Written to fail first.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFetchers } from "@/lib/chain/sources";
import { MemoryStore } from "@/lib/chain/store";
import { RECORDINGS } from "@/lib/demo/recordings";
import { demoTransport } from "@/lib/demo/transport";
import { importWithMapping, type ColumnMapping } from "@/lib/payments/mapping";
import { describeRedirect, matchPayments, resolvePaymentRef } from "@/lib/payments/match";
import { BVNK_TRANSACTION_REPORT, INSTRUCTIONS_STANDARD } from "@/lib/payments/presets";
import { refreshMatching } from "@/lib/payments/refresh";
import { applyImport, clearRecords, MemoryPaymentsStore, type PaymentsData } from "@/lib/payments/store";
import type { InstructionRecord, MatchResult, PaymentRecord, ProviderRecord } from "@/lib/payments/types";

const NOW = new Date("2026-10-23T08:00:00Z");
const enc = (s: string) => new TextEncoder().encode(s);
const recorded = () => buildFetchers({ tronKey: "demo", etherscanKey: "demo", store: new MemoryStore(),
  transport: demoTransport(RECORDINGS), sleep: async () => {}, noSpacing: true });
const bvnk = new Uint8Array(readFileSync(path.join(__dirname, "fixtures/payments/bvnk-report-1.csv")));

const T1 = "056fbff6c4d78bd1f3f36ecd685f71f383efd6d23b176cecfaaa0fe47686c797";
const INS_HEADER = "instruction_id,created_at,amount,chain,token,to_address,tx_hash,transfer_index,provider_payment_id,due_by";
const INS_1001 = `INS-1001,2026-10-21T22:40:00+08:00,655.000000,tron,USDT,TDvCcgSKb72upPS2dVmjCkuxYvQJSSBgAS,${T1},,,`;
const INS_1001_OTHER = `INS-1001,2026-10-21T22:40:00+08:00,665.000000,tron,USDT,TDvCcgSKb72upPS2dVmjCkuxYvQJSSBgAS,${T1},,,`;

const byProvider = (r: MatchResult, providerPaymentId: string) =>
  r.payments.find((p) => p.identifiers.some((i) => i.kind === "provider" && i.role === "provider_payment_id" && i.value === providerPaymentId));
const byInstruction = (r: MatchResult, id: string) =>
  r.payments.find((p) => p.anchor.kind === "instruction" && p.anchor.recordId.startsWith(`ins:${id}:`))!;
const run = async (store: MemoryPaymentsStore): Promise<PaymentsData> => {
  const next = await refreshMatching(await store.load(), recorded(), [], () => NOW);
  await store.save(next);
  return next;
};

// ---- 1. Retired payment IDs redirect, never vanish ----

describe("retired payment IDs", () => {
  it("provider-only X, conflicted instruction arrives and gets Y, conflict resolved: X resolves to Y", async () => {
    const store = new MemoryPaymentsStore();
    await applyImport(store, "provider", "bvnk.csv", bvnk, BVNK_TRANSACTION_REPORT.mappingId, undefined, NOW);
    const r1 = (await run(store)).match!.result;
    const X = byProvider(r1, "TX-B-1")!.paymentId;

    // The instruction arrives twice with different amounts: its provider leg goes to review, so it can't take X.
    await applyImport(store, "instruction", "ins-conflicted.csv", enc(`${INS_HEADER}\n${INS_1001}\n${INS_1001_OTHER}\n`), INSTRUCTIONS_STANDARD.mappingId, undefined, NOW);
    const r2 = (await run(store)).match!.result;
    const y = byInstruction(r2, "INS-1001");
    const Y = y.paymentId;
    expect(Y).not.toBe(X);
    expect(r2.payments.some((p) => p.paymentId === X)).toBe(false);
    const review = r2.reviews.find((rv) => rv.paymentId === Y && rv.leg === "provider")!;
    expect(r2.redirects[X]).toEqual({ from: X, reason: "held_in_review", to: { kind: "review", reviewId: review.reviewId, paymentId: Y } });
    // 3. The held provider record shows in the review queue under its reserved ID.
    const held = review.candidates.find((c) => c.recordId.startsWith("prv:BVNK:TX-B-1:"))!;
    expect(held.reservedPaymentId).toBe(X);
    expect(resolvePaymentRef(r2, X)).toMatchObject({ payment: { paymentId: Y }, review: { reviewId: review.reviewId } });
    expect(describeRedirect(r2.redirects[X])).toBe(`${X} is held in review ${review.reviewId} on ${Y}`);

    // The conflict is resolved: records cleared and the corrected file imported. IDs and redirects survive the clear.
    await store.save(clearRecords(await store.load()));
    await applyImport(store, "provider", "bvnk.csv", bvnk, BVNK_TRANSACTION_REPORT.mappingId, undefined, NOW);
    await applyImport(store, "instruction", "ins-fixed.csv", enc(`${INS_HEADER}\n${INS_1001}\n`), INSTRUCTIONS_STANDARD.mappingId, undefined, NOW);
    const r3 = (await run(store)).match!.result;
    expect(byInstruction(r3, "INS-1001").paymentId).toBe(Y);
    expect(byInstruction(r3, "INS-1001").legs.provider.state).toBe("linked");
    expect(r3.redirects[X]).toEqual({ from: X, reason: "merged", to: { kind: "payment", paymentId: Y } });
    expect(resolvePaymentRef(r3, X)).toMatchObject({ payment: { paymentId: Y }, via: [{ from: X }] });
    expect(describeRedirect(r3.redirects[X])).toBe(`${X} merged into ${Y}`);
    // A bookmarked review ID from run 2 still lands on the payment.
    expect(resolvePaymentRef(r3, review.reviewId).payment?.paymentId).toBe(Y);
  });

  it("every ID ever assigned resolves to a current payment, run after run", async () => {
    const store = new MemoryPaymentsStore();
    await applyImport(store, "provider", "bvnk.csv", bvnk, BVNK_TRANSACTION_REPORT.mappingId, undefined, NOW);
    await run(store);
    const ins = readFileSync(path.join(__dirname, "fixtures/payments/instructions.csv"));
    await applyImport(store, "instruction", "instructions.csv", new Uint8Array(ins), INSTRUCTIONS_STANDARD.mappingId, undefined, NOW);
    const data = await run(store);
    for (const id of new Set(Object.values(data.paymentIds!))) {
      expect(resolvePaymentRef(data.match!.result, id).payment, id).toBeDefined();
    }
  });

  it("a cleared record's ID is still known, as no longer held", async () => {
    const store = new MemoryPaymentsStore();
    await applyImport(store, "provider", "bvnk.csv", bvnk, BVNK_TRANSACTION_REPORT.mappingId, undefined, NOW);
    const X = byProvider((await run(store)).match!.result, "TX-B-1")!.paymentId;
    await store.save(clearRecords(await store.load()));
    const r = (await run(store)).match!.result;
    expect(r.redirects[X]).toEqual({ from: X, reason: "unheld", to: { kind: "none" } });
    expect(resolvePaymentRef(r, X)).toMatchObject({ payment: undefined, via: [{ from: X, reason: "unheld" }] });
    expect(describeRedirect(r.redirects[X])).toBe(`${X} is no longer held: its records were cleared`);
  });

  it("an ID stays with the payment that owns it, even if another instruction sorts first", () => {
    const PROVIDER: ColumnMapping = { mappingId: "tp", version: 1, kind: "provider", name: "TP", provider: "TP", createdAt: NOW.toISOString(),
      columns: { provider_payment_id: "id", merchant_reference: "ref", status: "state", amount: "amount", event_time: "at" },
      values: { status: { DONE: "provider_reports_complete" } }, timestampFormat: "iso8601_offset" };
    const ins = importWithMapping(enc(`instruction_id,created_at,amount\nINS-0,2026-10-21T10:00:00Z,1\nINS-1,2026-10-21T10:00:00Z,1\n`),
      { ...INSTRUCTIONS_STANDARD, columns: { instruction_id: "instruction_id", created_at: "created_at", amount: "amount" } }, { importId: "t", fileName: "t", now: NOW }).rows as InstructionRecord[];
    const prv = importWithMapping(enc(`id,ref,state,amount,at\nAP-1,INS-0,DONE,1,2026-10-21T10:00:00Z\n`), PROVIDER, { importId: "t", fileName: "t", now: NOW }).rows as ProviderRecord[];
    // Y belonged to INS-1 and, once, to AP-1 when they were one payment. AP-1 now names INS-0.
    const r = matchPayments({ instructions: ins, provider: prv, bank: [], chain: [], lookups: [],
      assigned: { "instruction:INS-1": "PAY-AAAAAAAAAA", "provider:TP:AP-1": "PAY-AAAAAAAAAA" } });
    expect(byInstruction(r, "INS-1").paymentId).toBe("PAY-AAAAAAAAAA");
    expect(byInstruction(r, "INS-0").paymentId).not.toBe("PAY-AAAAAAAAAA");
  });
});

// ---- 2. Fee and return rows tied only by merchant reference ----

describe("fees and returns tied by merchant reference", () => {
  const PROVIDER: ColumnMapping = { mappingId: "tp", version: 1, kind: "provider", name: "TP", provider: "TP", createdAt: NOW.toISOString(),
    columns: { provider_payment_id: "id", merchant_reference: "ref", status: "state", amount: "amount", event_time: "at", type: "kind" },
    values: { status: { DONE: "provider_reports_complete" }, type: { PAYMENT: "principal", FEE: "fee", REFUND: "return" } }, timestampFormat: "iso8601_offset" };
  const ctx = { importId: "t", fileName: "t", now: NOW };
  const ins = (body: string) => importWithMapping(enc(`instruction_id,created_at,amount\n${body}\n`),
    { ...INSTRUCTIONS_STANDARD, columns: { instruction_id: "instruction_id", created_at: "created_at", amount: "amount" } }, ctx).rows as PaymentRecord[];
  const prv = (body: string) => importWithMapping(enc(`id,ref,state,amount,at,kind\n${body}\n`), PROVIDER, ctx).rows as PaymentRecord[];
  const go = (i: PaymentRecord[], p: PaymentRecord[]) =>
    matchPayments({ instructions: i as InstructionRecord[], provider: p as ProviderRecord[], bank: [], chain: [], lookups: [] });
  const FEE = "AP-1F,INS-1,DONE,1.00,2026-10-21T10:05:00Z,FEE";
  const REFUND = "AP-1R,INS-1,DONE,100.00,2026-10-22T10:00:00Z,REFUND";

  it("wait in review while the provider leg has several candidates", () => {
    const r = go(ins("INS-1,2026-10-21T10:00:00Z,100.00"), prv([
      "AP-1,INS-1,DONE,100.00,2026-10-21T10:05:00Z,PAYMENT", "AP-2,INS-1,DONE,100.00,2026-10-21T10:06:00Z,PAYMENT", FEE, REFUND,
    ].join("\n")));
    const p = byInstruction(r, "INS-1");
    expect([p.fees, p.returns]).toEqual([[], []]);
    const waiting = r.reviews.filter((x) => x.paymentId === p.paymentId && (x.leg === "fees" || x.leg === "returns"));
    expect(waiting.map((x) => [x.leg, x.reason]).sort()).toEqual([["fees", "provider_leg_not_linked"], ["returns", "provider_leg_not_linked"]]);
    expect(waiting.find((x) => x.leg === "fees")!.message).toMatch(/AP-1F carries merchant reference INS-1, but this payment's instruction and provider legs are not both linked/);
  });

  it("wait in review while the instruction leg is under review", () => {
    const r = go(ins("INS-1,2026-10-21T10:00:00Z,100.00\nINS-1,2026-10-21T10:00:00Z,200.00"), prv(["AP-1,INS-1,DONE,100.00,2026-10-21T10:05:00Z,PAYMENT", FEE].join("\n")));
    const p = byInstruction(r, "INS-1");
    expect(p.fees).toEqual([]);
    expect(r.reviews.some((x) => x.paymentId === p.paymentId && x.leg === "fees")).toBe(true);
  });

  it("attach once both legs are linked", () => {
    const r = go(ins("INS-1,2026-10-21T10:00:00Z,100.00"), prv(["AP-1,INS-1,DONE,100.00,2026-10-21T10:05:00Z,PAYMENT", FEE, REFUND].join("\n")));
    const p = byInstruction(r, "INS-1");
    expect(p.fees).toEqual([expect.objectContaining({ basis: "merchant_reference" })]);
    expect(p.returns).toEqual([expect.objectContaining({ basis: "merchant_reference" })]);
  });
});
