// First invoice-matching measurement on the demo scenarios (real transfers, sample invoices).
// Print the table with: SCENARIO_EVAL=1 npx vitest run tests/demo-scenarios-eval.test.ts
// Definitions: team/knowledge/matching-engine-engineer/metrics.md. Abstain = sent to a person to
// decide (review); a correct flag or refusal is a decision, not an abstention. n = 20 is a first small
// evaluation set (all tuning, see catalogue.json split_rule), not a held-out benchmark.

import { describe, expect, it } from "vitest";
import { catalogue, runScenario } from "./fixtures/real/scenarios/runner";

const Z = 1.959964;
/** Wilson 95% score interval, as statsmodels proportion_confint(method="wilson"). */
function wilson(k: number, n: number): [number, number] {
  const p = k / n, d = 1 + (Z * Z) / n;
  const c = (p + (Z * Z) / (2 * n)) / d, h = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const ci = (k: number, n: number) => (n === 0 ? "n = 0" : `${k}/${n}, 95% Wilson ${pct(wilson(k, n)[0])}-${pct(wilson(k, n)[1])}`);

describe("demo scenarios: measurement", () => {
  it("scores every found scenario; no false match", async () => {
    const rows = new Map<string, { n: number; ok: number; fm: number; review: number; flag: number; rejected: number; missed: number; auto: number }>();
    const tot = { n: 0, auto: 0, fm: 0, review: 0, exact: 0, exactOk: 0, autoable: 0, autoableOk: 0 };
    for (const s of catalogue().scenarios.filter((x) => x.transfer)) {
      const o = await runScenario(s);
      const r = rows.get(s.case_type) ?? { n: 0, ok: 0, fm: 0, review: 0, flag: 0, rejected: 0, missed: 0, auto: 0 };
      const isAuto = o.action === "auto_match";
      const fm = isAuto && (s.label.expected_action !== "auto_match" || o.invoice !== s.label.true_invoice);
      r.n++; tot.n++;
      if (isAuto) { r.auto++; tot.auto++; }
      if (isAuto && !fm) r.ok++;
      if (fm) { r.fm++; tot.fm++; }
      if (o.action === "review") { r.review++; tot.review++; }
      if (o.action === "flag") r.flag++;
      if (o.action === "rejected") r.rejected++;
      if (s.label.expected_action === "auto_match" && !isAuto) r.missed++;
      if (s.case_type === "exact") { tot.exact++; if (isAuto && !fm) tot.exactOk++; }
      if (s.label.expected_action === "auto_match") { tot.autoable++; if (isAuto && !fm) tot.autoableOk++; }
      rows.set(s.case_type, r);
    }
    if (process.env.SCENARIO_EVAL) {
      console.log("| Case type | n | Auto-matched correct | False matches | Sent to a person | Flagged on the invoice | Refused at lookup, nothing recorded | Missed (expected auto-match) |");
      for (const [t, r] of rows) console.log(`| ${t} | ${r.n} | ${r.ok} | ${r.fm} | ${r.review} | ${r.flag} | ${r.rejected} | ${r.missed} |`);
      const up = tot.auto ? pct(1 - 0.05 ** (1 / tot.auto)) : "n/a";
      console.log(`FMR ${ci(tot.fm, tot.auto)} (exact one-sided 95% upper ${up}); false matches per case ${ci(tot.fm, tot.n)}; abstain ${ci(tot.review, tot.n)}; recall exact ${ci(tot.exactOk, tot.exact)}; recall all auto-matchable ${ci(tot.autoableOk, tot.autoable)}`);
    }
    expect(tot.n).toBe(20);
    expect(tot.fm).toBe(0);
  });
  it("wilson matches the reviewer's recall figure (6/7)", () => expect([pct(wilson(6, 7)[0]), pct(wilson(6, 7)[1])]).toEqual(["48.7%", "97.4%"]));
  it("wilson matches the worked numbers in metrics.md", () => {
    expect(pct(wilson(52, 52)[0])).toBe("93.1%");
    expect(pct(wilson(0, 12)[1])).toBe("24.2%");
  });
});
