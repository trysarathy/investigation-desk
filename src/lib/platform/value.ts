import type { CaseRecord } from "./store";
export function valueReport(
  cases: CaseRecord[],
  month: string,
  baselineMinutes = 15,
) {
  const real = cases.filter(
    (c) => c.provenance === "analyst" && c.createdAt.startsWith(month),
  );
  const durations = real
    .filter((c) => c.resolvedAt)
    .map((c) =>
      Math.max(
        0,
        (Date.parse(c.resolvedAt!) - Date.parse(c.createdAt)) / 60000,
      ),
    )
    .sort((a, b) => a - b);
  const median = durations.length
    ? (durations[Math.floor((durations.length - 1) / 2)] +
        durations[Math.floor(durations.length / 2)]) /
      2
    : null;
  const high = real.filter(
    (c) =>
      c.view.verdicts.at(-1)?.confidence === "High" &&
      c.view.verdicts.at(-1)?.state === "verdict",
  ).length;
  return {
    cases: real.length,
    resolved: durations.length,
    medianMinutes: median,
    autoDiagnosed: real.length ? high / real.length : null,
    estimatedHoursSaved: durations.length
      ? durations.reduce(
          (sum, m) => sum + Math.max(0, baselineMinutes - m),
          0,
        ) / 60
      : null,
    baselineMinutes,
  };
}
