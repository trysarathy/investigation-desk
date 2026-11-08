import { describe, expect, it } from "vitest";
import {
  actors, createDemoAdvance, decide, dailyDigest, exceptions, freeCash, importBundledSample, initialDemo, journalCsv,
  ledgerCsv, money, outstanding, payout, prepare, repay, review, setDate,
} from "../../src/lib/mentor-demo/engine";

describe("standalone synthetic mentor demo", () => {
  it("seeds a believable, clearly fictional provider workflow", () => {
    const s = initialDemo();
    expect(s.advances).toHaveLength(3);
    expect(s.advances[0].stage).toBe("proposed");
    expect(s.advances[1].stage).toBe("partly_repaid");
    expect(s.advances[2].stage).toBe("repaid");
    expect(freeCash(s)).toBe(250000);
    expect(outstanding(s.advances[1])).toBe(60000);
    expect(outstanding(s.advances[2])).toBe(0);
    expect(review(s, "ADV-001").map((c) => c.status)).toEqual([
      "pass", "pass", "pass", "pass", "pass",
    ]);
  });
  it("enforces separate maker and treasury decision", () => {
    const s = initialDemo();
    expect(() => prepare(s, "ADV-001", "approver")).toThrow();
    const p = prepare(s, "ADV-001", "operator");
    expect(p.advances[0].stage).toBe("prepared");
    expect(() => decide(p, "ADV-001", "operator", "approved", "yes")).toThrow();
    expect(() => decide(p, "ADV-001", "approver", "approved", "")).toThrow();
    const approved = decide(p, "ADV-001", "approver", "approved", "Cash and invoice checked");
    expect(approved.advances[0].stage).toBe("approved");
    expect(approved.advances[0].decidedBy).toBe(actors.approver);
    expect(s.advances[0].stage).toBe("proposed");
  });
  it("keeps supplier payout separate from customer repayment", () => {
    const p = decide(prepare(initialDemo(), "ADV-001", "operator"), "ADV-001", "approver", "approved", "Validated evidence");
    expect(() => payout(p, "ADV-001", "operator")).toThrow();
    const onDay = setDate(p, "2026-11-10");
    const paid = payout(onDay, "ADV-001", "operator");
    expect(outstanding(paid.advances[0])).toBe(100000);
    const late = setDate(paid, "2026-11-19");
    expect(exceptions(late).some((e) => e.advanceId === "ADV-001" && e.title.includes("Overdue"))).toBe(true);
    const partial = repay(late, "ADV-001", "operator", 40000);
    expect(outstanding(partial.advances[0])).toBe(60000);
    const final = repay(partial, "ADV-001", "operator", 60000);
    expect(final.advances[0].stage).toBe("repaid");
    expect(outstanding(final.advances[0])).toBe(0);
    expect(() => repay(final, "ADV-001", "operator", 1)).toThrow();
  });
  it("prevents overpayments and viewer writes", () => {
    const s = initialDemo();
    expect(() => repay(s, "ADV-002", "viewer", 1)).toThrow();
    expect(() => repay(s, "ADV-002", "operator", 60001)).toThrow();
    expect(() => repay(s, "ADV-002", "operator", 1.5)).toThrow();
    expect(() => prepare(s, "ADV-001", "viewer")).toThrow();
    expect(() => decide(s, "ADV-001", "viewer", "declined", "No")).toThrow();
  });
  it("flags duplicates and insufficient cash before approval", () => {
    const s = initialDemo();
    s.advances.push({ ...s.advances[0], id: "ADV-004" });
    expect(review(s, "ADV-004").find((c) => c.key === "invoice")?.status).toBe("fail");
    const small = initialDemo();
    small.cash.balance = 190000;
    expect(review(small, "ADV-001").find((c) => c.key === "cash")?.status).toBe("fail");
    const prepared = prepare(small, "ADV-001", "operator");
    expect(() => decide(prepared, "ADV-001", "approver", "approved", "Trying to override")).toThrow();
    expect(decide(prepared, "ADV-001", "approver", "declined", "Insufficient free cash").advances[0].stage).toBe("declined");
  });
  it("generates one-line all-clear when there are no exceptions", () => {
    const s = initialDemo();
    s.advances = s.advances.map((a) => ({ ...a, paid: a.amount, repaid: a.amount, stage: "repaid" }));
    s.unmatched = [];
    expect(exceptions(s)).toHaveLength(0);
    expect(dailyDigest(s).trim().split("\n")).toHaveLength(1);
    expect(dailyDigest(s)).toContain("All clear");
  });
  it("keeps exports consistent, plain and journal-balanced", () => {
    const s = initialDemo();
    const csv = ledgerCsv(s);
    expect(csv).toContain("still_owed");
    expect(csv).toContain('"60000"');
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(4);
    const journal = journalCsv(s).trim().split("\r\n").slice(1).map((line) => line.split(","));
    const totalDebit = journal.reduce((sum, row) => sum + Number(row[3]), 0);
    const totalCredit = journal.reduce((sum, row) => sum + Number(row[4]), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(money(60000)).toBe("SGD 60,000.00");
  });
  it("creates a synthetic advance without changing real money or approval states", () => {
    const seed = initialDemo();
    const caseData = { customerId: "C-001", supplier: "Pacific Demo", invoice: "INV-SYN-010",
      amount: 30000, payoutDate: "2026-11-12", due: "2026-11-19" };
    const created = createDemoAdvance(seed, "operator", caseData);
    expect(seed.advances).toHaveLength(3);
    expect(created.advances).toHaveLength(4);
    expect(created.advances[3]).toMatchObject({ id: "ADV-004", stage: "proposed", paid: 0, repaid: 0 });
    expect(review(created, "ADV-004")).toHaveLength(5);
    expect(() => createDemoAdvance(seed, "viewer", caseData)).toThrow();
    expect(() => createDemoAdvance(created, "operator", caseData)).toThrow("already");
    expect(() => createDemoAdvance(seed, "operator", { ...caseData, amount: -1 })).toThrow();
    expect(() => createDemoAdvance(seed, "operator", { ...caseData, due: "2026-11-10" })).toThrow();
  });
  it("imports a bundled fake CSV row at most once", () => {
    const created = importBundledSample(initialDemo(), "operator");
    expect(created.advances[3].invoice).toBe("INV-NC-7774");
    expect(() => importBundledSample(created, "operator")).toThrow("already");
    expect(() => importBundledSample(initialDemo(), "viewer")).toThrow();
  });
  it("rejects invalid replay dates and preserves the original demo on reset", () => {
    const seed = initialDemo();
    expect(() => setDate(seed, "2026-12-12")).toThrow();
    expect(setDate(seed, "2026-11-19").asOf).toBe("2026-11-19");
    expect(initialDemo()).toEqual(seed);
  });
});
