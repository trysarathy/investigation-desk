import { describe, expect, it } from "vitest";
import {
  actors, decide, exceptions, initialDemo, outstanding, payout, prepare, repay, review, setDate,
} from "../../src/lib/mentor-demo/engine";

const ID = "ADV-001";
const get = (s: ReturnType<typeof initialDemo>) => s.advances.find((a) => a.id === ID)!;

describe("guided funding narrative for demo day", () => {
  it("begins with a proposed exposure but no booked receivable", () => {
    const s = initialDemo();
    expect(s.asOf).toBe("2026-11-09");
    expect(get(s).amount).toBe(100000);
    expect(get(s).paid).toBe(0);
    expect(outstanding(get(s))).toBe(0);
    expect(review(s, ID).map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
  });
  it("enforces operator preparation and a named, different treasury approver", () => {
    const prepared = prepare(initialDemo(), ID, "operator");
    expect(get(prepared).preparedBy).toBe(actors.operator);
    expect(() => decide(prepared, ID, "viewer", "approved", "reason")).toThrow();
    expect(() => decide(prepared, ID, "operator", "approved", "reason")).toThrow();
    const approved = decide(prepared, ID, "approver", "approved", "Explicit evidence check");
    expect(get(approved).decidedBy).toBe(actors.approver);
    expect(get(approved).reason).toBe("Explicit evidence check");
    expect(approved.events.map((e) => e.label)).toContain("Approved by treasury");
  });
  it("shows the 100k payout, 40k receipt, 60k owed and overdue evidence in sequence", () => {
    const prepared = prepare(initialDemo(), ID, "operator");
    const approved = decide(prepared, ID, "approver", "approved", "Terms and cash checked");
    const paid = payout(setDate(approved, "2026-11-10"), ID, "operator");
    expect(get(paid).paid).toBe(100000);
    expect(get(paid).repaid).toBe(0);
    expect(outstanding(get(paid))).toBe(100000);
    const partiallyRepaid = repay(setDate(paid, "2026-11-14"), ID, "operator", 40000);
    expect(get(partiallyRepaid).stage).toBe("partly_repaid");
    expect(get(partiallyRepaid).repaid).toBe(40000);
    expect(outstanding(get(partiallyRepaid))).toBe(60000);
    expect(exceptions(partiallyRepaid).filter((e) => e.advanceId === ID && e.severity === "high")).toHaveLength(0);
    const late = setDate(partiallyRepaid, "2026-11-19");
    expect(exceptions(late).some((e) => e.advanceId === ID && e.severity === "high" && e.detail.includes("60,000"))).toBe(true);
    expect(late.events.filter((e) => e.advanceId === ID).map((e) => e.label)).toEqual([
      "Prepared for treasury", "Approved by treasury", "Supplier payout recorded", "Partial receipt matched",
    ]);
    expect(initialDemo().advances[0].stage).toBe("proposed");
  });
  it("cannot turn the guided story into a money movement or a viewer approval", () => {
    const s = initialDemo();
    expect(() => prepare(s, ID, "viewer")).toThrow();
    expect(() => payout(s, ID, "operator")).toThrow();
    expect(() => repay(s, ID, "operator", 40000)).toThrow();
  });
});
