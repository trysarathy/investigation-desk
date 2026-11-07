import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { replayCase, replayReport, validateManifest } from "../../src/lib/funding/replay-kit";
import type { ImportKind } from "../../src/lib/funding/model";
const root = "fixtures/funding/replay";
const manifest = validateManifest(JSON.parse(readFileSync(path.join(root, "cases.json"), "utf8")));
const run = (index: number) => {
  const c = manifest.cases[index];
  const data: Partial<Record<ImportKind, string>> = {};
  for (const [kind, file] of Object.entries(c.inputs))
    data[kind as ImportKind] = readFileSync(path.join(root, file), "utf8");
  return { c, data, result: replayCase(c, data) };
};
describe("five-case mentor replay", () => {
  it("replays five synthetic histories in under two minutes", () => {
    const start = Date.now();
    const results = manifest.cases.map((_, i) => run(i).result);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.checks.length === 5)).toBe(true);
    expect(replayReport(results, true)).toContain("Synthetic cases only");
    expect(Date.now() - start).toBeLessThan(120000);
  });
  it("shows a full on-time repayment without an overdue flag", () => {
    const r = run(0).result;
    expect(r.outstanding).toBe("0");
    expect(r.state).toBe("repaid");
    expect(r.first_flags.some((f) => f.code === "overdue")).toBe(false);
  });
  it("shows a real cash failure and recorded treasury refusal", () => {
    const r = run(1).result;
    expect(r.checks.find((c) => c.code === "cash")?.status).toBe("fail");
    expect(r.treatment).toContain("decline");
    expect(r.paid).toBe("0");
  });
  it("flags overdue before partial repayment", () => {
    const r = run(2).result;
    expect(r.outstanding).toBe("60000");
    expect(r.first_flags.find((f) => f.code === "overdue")?.at).toBe("2026-11-17T09:00:00Z");
    expect(r.first_flags.find((f) => f.code === "partial_repayment")?.at).toBe("2026-11-18T09:01:00Z");
  });
  it("rejects duplicate invoice as a clean approval", () => {
    const r = run(3).result;
    expect(r.checks.find((c) => c.code === "invoice")?.status).toBe("fail");
    expect(r.historical_decision).toBe("decline");
  });
  it("does not allocate an unmatched receipt", () => {
    const r = run(4).result;
    expect(r.outstanding).toBe("100000");
    expect(r.first_flags.some((f) => f.code === "unmatched_receipt")).toBe(true);
  });
  it("keeps cutoff checks unchanged when later receipts change", () => {
    const { c, data, result } = run(2);
    data.receipts = data.receipts!.replace("40000", "100000");
    const changed = replayCase(c, data);
    expect(changed.checks).toEqual(result.checks);
    expect(changed.outstanding).toBe("0");
  });
  it("validates scenario IDs and timestamps", () => {
    const duplicate = structuredClone(manifest);
    duplicate.cases[1].id = duplicate.cases[0].id;
    expect(() => validateManifest(duplicate)).toThrow(/unique/);
    const inverted = structuredClone(manifest);
    inverted.cases[0].reconcile_at = "2026-11-08T10:00:00Z";
    expect(() => validateManifest(inverted)).toThrow(/must not precede/);
  });
});
