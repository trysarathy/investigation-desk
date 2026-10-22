import { expect, it } from "vitest";
import { valueReport } from "../src/lib/platform/value";
import type { CaseRecord } from "../src/lib/platform/store";
it("excludes demo, counts unique cases and labels estimates from explicit elapsed time", () => {
  const base = {
    createdAt: "2026-10-01T00:00:00Z",
    resolvedAt: "2026-10-01T00:10:00Z",
    provenance: "analyst",
    view: { verdicts: [{ state: "verdict", confidence: "High" }] },
  } as CaseRecord;
  const r = valueReport(
    [base, { ...base, provenance: "synthetic" }],
    "2026-10",
    15,
  );
  expect(r).toMatchObject({
    cases: 1,
    resolved: 1,
    medianMinutes: 10,
    autoDiagnosed: 1,
    estimatedHoursSaved: 5 / 60,
  });
  expect(valueReport([], "2026-10").estimatedHoursSaved).toBeNull();
});
