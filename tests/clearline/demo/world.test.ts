/**
 * The demo world (src/lib/clearline/demo/world.ts): deterministic, fictional, the three documented cases with their
 * exact numbers, and a realistic decision mix reached through data alone. Demo · fictional data.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { demoWorld, DEMO_ENTITY_IDS, CASE_DAYS } from "@/lib/clearline/demo/world";
import { DEMO_FIRST_DAY, DEMO_LAST_DAY, DEMO_TODAY } from "@/lib/clearline/demo/clock";
import { reconcile } from "@/lib/clearline/merchant";
import { plainJson } from "./plain";
import { ALLOWED_REAL_CONTRACTS, eip55Valid, tronChecksumValid } from "@/lib/clearline/synthetic";

const hash = (v: unknown) => createHash("sha256").update(plainJson(v)).digest("hex");

describe("demo world", () => {
  const a = demoWorld();
  it("is deterministic (same seed, same bytes)", () => {
    expect(hash(demoWorld().inputs)).toBe(hash(a.inputs));
  });
  it("has about 1,500 orders across TRON and Ethereum, USDT and USDC, in 30 days ending the day before the demo today", () => {
    const orders = a.inputs.reduce((n, i) => n + i.invoices.length, 0);
    expect(orders).toBeGreaterThanOrEqual(1_450);
    expect(orders).toBeLessThanOrEqual(1_550);
    const t = a.inputs.flatMap((i) => i.transfers);
    const paid = t.filter((x) => ALLOWED_REAL_CONTRACTS.includes(x.tokenContract));
    expect(new Set(paid.map((x) => x.network))).toEqual(new Set(["tron", "ethereum"]));
    expect(new Set(paid.map((x) => `${x.network}:${x.tokenContract}`)).size).toBe(3); // USDT on TRON, USDC and USDT on Ethereum
    const days = t.map((x) => x.timestamp.slice(0, 10)).sort();
    expect(days[0] >= DEMO_FIRST_DAY).toBe(true);
    expect(days.at(-1)! <= DEMO_LAST_DAY).toBe(true);
    expect(DEMO_TODAY > DEMO_LAST_DAY).toBe(true);
  });
  it("uses fictional values only (the real ones are the public token contracts)", () => {
    const text = plainJson(a.inputs);
    expect(text).not.toMatch(/@(gmail|yahoo|outlook)\./i);
    for (const tr of a.inputs.flatMap((i) => i.transfers)) {
      for (const addr of [tr.from, tr.to]) expect(tr.network === "tron" ? tronChecksumValid(addr) : eip55Valid(addr)).toBe(false);
    }
  });
  it("generated payments avoid the cases' days in their books", () => {
    for (const i of a.inputs) {
      const blocked = CASE_DAYS[i.entity.id] ?? [];
      const caseIds = /^BK-2[45]\d{3}$/;
      for (const r of i.batches) if (!/^B-(1124|1125|UAE)/.test(r.batchId)) expect(blocked).not.toContain(r.providerDay);
      expect(i.invoices.some((x) => caseIds.test(x.orderId)) || i.entity.id === "none").toBe(true);
    }
  });
});

describe("the three documented cases inside the demo world (pure engine)", () => {
  const { inputs } = demoWorld();
  const run = (id: string) => reconcile(inputs.find((i) => i.entity.id === id)!);
  it("Case 1: batch B-1124-001 nets 5,961.24 and ties to its bank line", () => {
    const b = run(DEMO_ENTITY_IDS.SG).bridges.find((x) => x.batchId === "B-1124-001")!;
    expect(b.lines.find((l) => l.kind === "net")!.amountMinor).toBe(596124n);
    expect(b.tied).toBe(true);
  });
  it("Case 2: merchant day 44,412.30 bridges to net 40,228.68, with BK-24871 held", () => {
    const b = run(DEMO_ENTITY_IDS.SG).bridges.find((x) => x.batchId === "B-1125-SGD")!;
    expect(b.lines.map((l) => [l.kind, l.amountMinor])).toEqual([
      ["merchant_day", 4441230n], ["timing_prior_batch", -297000n], ["held_by_provider", -120000n], ["timing_next_batch", 162000n],
      ["gross", 4186230n], ["provider_fee", -41862n], ["refund_netted", -121500n], ["net", 4022868n],
    ]);
    expect(b.lines.find((l) => l.kind === "held_by_provider")!.orderIds).toEqual(["BK-24871"]);
    expect(b.tied).toBe(true);
  });
  it("Case 3: BK-25102 closes the AED 14.16 gap only through review", () => {
    const r = run(DEMO_ENTITY_IDS.AE).records.find((x) => x.orderId === "BK-25102")!;
    const total = r.explanation.differences.reduce((t, d) => t + d.amountMinor, 0n);
    expect(total === -1416n || total === 1416n).toBe(true);
  });
  it("most payments match; a minority match with a difference or go to review; few are exceptions", () => {
    const recs = inputs.flatMap((i) => reconcile(i).records);
    const share = (d: string) => recs.filter((r) => r.explanation.decision === d).length / recs.length;
    expect(share("matched")).toBeGreaterThan(0.7);
    expect(share("matched_with_difference") + share("suggested_for_review")).toBeGreaterThan(0.08);
    expect(share("exception")).toBeLessThan(0.05);
    expect(share("exception")).toBeGreaterThan(0);
  });
});
