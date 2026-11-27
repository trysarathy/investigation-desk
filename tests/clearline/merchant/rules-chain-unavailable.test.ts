/**
 * rc7 Phase 2: chain data unavailable. An order whose deposit address or transaction could not be read is never
 * matched, written off or closed; every other order still reconciles. Test mode · illustrative data.
 */
import { describe, expect, it } from "vitest";
import { merchant } from "@/lib/clearline";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { case3 } from "@/lib/clearline/merchant/fixtures/case3";
import type { NetworkId } from "@/lib/clearline/merchant";

const { reconcile, proposeJournals } = merchant;
const down = (network: NetworkId, extra: { address?: string; txHash?: string }) => ({ network, ...extra, source: "trongrid (recorded)", reason: "HTTP 503 after 5 attempts", at: "2026-11-25T02:00:00.000Z" });

describe("[M1.chain.unavailable] chain data unavailable never matches", () => {
  const input = case1();
  const q = input.quotes.find((x) => x.orderId === "BK-24817")!;
  const r = reconcile({ ...input, chainUnavailable: [down(q.network, { address: q.depositAddress })] });
  const rec = r.records.find((x) => x.orderId === "BK-24817")!;
  it("the order is an exception for Payment Operations, with the source, time and reason, and no write-off", () => {
    expect([rec.explanation.decision, rec.explanation.decidingStep, rec.explanation.ruleId]).toEqual(["exception", 1, "M1.chain.unavailable"]);
    expect(rec.attention).toMatchObject({ owner: "Payment Operations" });
    expect(rec.attention!.reason).toContain("Chain data unavailable");
    expect(rec.attention!.reason).toContain("HTTP 503");
    expect(rec.attention!.nextStep).toContain("retries on the next run");
    expect(r.writeOffs.some((w) => w.orderId === "BK-24817")).toBe(false);
  });
  it("no journal closes its AR; the other three orders reconcile exactly as before", () => {
    const js = proposeJournals({ ...input, chainUnavailable: [down(q.network, { address: q.depositAddress })] }, r);
    expect(js.some((j) => j.kind !== "settlement" && j.evidence.orderIds.includes("BK-24817"))).toBe(false);
    const before = reconcile(input).records.filter((x) => x.orderId !== "BK-24817").map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId]);
    expect(r.records.filter((x) => x.orderId !== "BK-24817").map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId])).toEqual(before);
  });
  it("scoped by transaction too: Case 3's part-2 tx unreadable → BK-25102 is not closed", () => {
    const c3 = case3();
    const t2 = c3.transfers[1];
    const e = reconcile({ ...c3, chainUnavailable: [down(t2.network, { txHash: t2.txHash })] }).records[0].explanation;
    expect([e.decision, e.ruleId]).toEqual(["exception", "M1.chain.unavailable"]);
  });
  it("an outage on another address or network changes nothing", () => {
    const other = reconcile({ ...input, chainUnavailable: [down("ethereum", { address: "0x000000000000000000000000000000000000dEaD" }), down("tron", { txHash: "fict_unrelated" })] });
    expect(other.records.map((x) => x.explanation)).toEqual(reconcile(input).records.map((x) => x.explanation));
  });
});

describe("[M1.chain.conflicting] v1: two chain data providers disagree → never matched, a typed exception", () => {
  const input = case1();
  const q = input.quotes.find((x) => x.orderId === "BK-24817")!;
  const clash = { ...down(q.network, { address: q.depositAddress }), reason: "chain data conflicting: primary and fallback disagree on log 0", kind: "conflicting" as const };
  it("the order is an M1.chain.conflicting exception for Payment Operations (outranking 'unavailable'); the other orders are unchanged", () => {
    const r = reconcile({ ...input, chainUnavailable: [down(q.network, { address: q.depositAddress }), clash] });
    const rec = r.records.find((x) => x.orderId === "BK-24817")!;
    expect([rec.explanation.decision, rec.explanation.decidingStep, rec.explanation.ruleId]).toEqual(["exception", 1, "M1.chain.conflicting"]);
    expect(rec.attention).toMatchObject({ owner: "Payment Operations" });
    expect(rec.attention!.reason).toContain("Chain data conflicting");
    expect(rec.attention!.nextStep).toContain("never matches it while the providers disagree");
    expect(r.writeOffs.some((w) => w.orderId === "BK-24817")).toBe(false);
    const before = reconcile(input).records.filter((x) => x.orderId !== "BK-24817").map((x) => [x.orderId, x.explanation.ruleId]);
    expect(r.records.filter((x) => x.orderId !== "BK-24817").map((x) => [x.orderId, x.explanation.ruleId])).toEqual(before);
  });
});
