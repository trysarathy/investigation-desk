import { expect, it } from "vitest";
import { accuracy, type LabelledOutcome } from "../src/lib/quality/accuracy";
it("counts false positives and false negatives, excludes synthetic and unreviewed outcomes", () => {
  const rows: LabelledOutcome[] = [
    {
      id: "a",
      predicted: "D12",
      actual: "D13",
      provenance: "analyst",
      adjudicated: true,
    },
    {
      id: "b",
      predicted: "D13",
      actual: "D13",
      provenance: "analyst",
      adjudicated: true,
    },
    {
      id: "c",
      predicted: "D12",
      actual: "D12",
      provenance: "synthetic",
      adjudicated: true,
    },
    {
      id: "d",
      predicted: "D12",
      actual: "D12",
      provenance: "analyst",
      adjudicated: false,
    },
  ];
  const report = accuracy(rows, "analyst");
  expect(report.find((r) => r.code === "D12")).toMatchObject({
    precision: 0,
    recall: null,
    fp: 1,
  });
  expect(report.find((r) => r.code === "D13")).toMatchObject({
    precision: 1,
    recall: 0.5,
    fn: 1,
  });
  expect(report.find((r) => r.code === "D09")).toMatchObject({
    precision: null,
    recall: null,
  });
});
it("deduplicates corrections to avoid inflating accuracy", () => {
  const row: LabelledOutcome = {
    id: "x",
    predicted: "D12",
    actual: "D13",
    provenance: "analyst",
    adjudicated: true,
  };
  expect(
    accuracy([row, row], "analyst").find((r) => r.code === "D12")?.fp,
  ).toBe(1);
});
