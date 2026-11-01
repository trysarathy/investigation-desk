// The demo payments (ADR 0003): real public transfers, replayed offline, against SAMPLE (fictional)
// invoices. Each expected outcome in catalogue.json is labelled from chain facts and the approved
// rules, never from this product. A failing case here is a product miss; never change the label to
// pass it. Where the product is wrong today the test is `it.fails` with the reason in `known_gap`,
// and the product logic is left for its own reviewed (and, if it widens auto-matching, approved) PR.

import { describe, expect, it } from "vitest";
import { AUTO_RULE } from "@/lib/requests/lifecycle";
import { catalogue, provenance, runScenario, sha256Of, type Scenario } from "./fixtures/real/scenarios/runner";

const all = catalogue().scenarios;
const found = all.filter((s) => s.transfer);
const MINIMUM: Record<string, number> = { exact: 4, partial: 3, over: 2, wrong_token: 2, wrong_network: 2, lookalike_address: 2, ambiguous: 2, confirming: 1 };

describe("demo scenarios: the catalogue", () => {
  it("has 21 slots: the 20 demo payments on real transfers, plus a reported gap with no transfer", () => {
    expect(all).toHaveLength(21);
    expect(found).toHaveLength(20);
    for (const s of all.filter((x) => !x.transfer)) expect(s.gap, s.id).toMatch(/NOT FOUND/);
  });
  it("meets the coverage minimums with real transfers (the confirming slot is a reported gap)", () => {
    for (const [type, min] of Object.entries(MINIMUM)) {
      const n = found.filter((s) => s.case_type === type).length;
      if (type === "confirming") expect(all.filter((s) => s.case_type === type && s.gap)).toHaveLength(min);
      else expect(n, type).toBeGreaterThanOrEqual(min);
    }
    expect(found.some((s) => s.case_type === "partial" && s.person_decision?.kind === "accept_short")).toBe(true);
  });
  it("replays only recordings that are byte-for-byte the ones in provenance.json and their originals", () => {
    const prov = new Map(provenance().recordings.map((r) => [r.file, r]));
    for (const s of found) expect(sha256Of(s.transfer!.recording), s.id).toBe(prov.get(s.transfer!.recording)?.sha256);
    for (const r of prov.values()) expect(sha256Of(r.file), r.file).toBe(sha256Of(r.copied_from, true));
  });
  it("labels every invoice as sample data", () => {
    for (const s of found) for (const i of s.invoices) expect(i.sample, `${s.id} ${i.id}`).toBe(true);
  });
});

const reasonsMatch = (s: Scenario, reasons: string[]) =>
  s.label.reason_includes.every((w) => reasons.join(" ").toLowerCase().includes(w.toLowerCase()));

describe("demo scenarios: never a false match (every case)", () => {
  for (const s of found) {
    it(`${s.id} ${s.case_type}: auto-matches only when labelled auto_match, and only to the true invoice`, async () => {
      const o = await runScenario(s);
      expect(o.autoMatched.length, `auto-matched ${o.autoMatched}`).toBeLessThanOrEqual(1);
      if (o.action === "auto_match") {
        expect(s.label.expected_action).toBe("auto_match");
        expect(o.invoice).toBe(s.label.true_invoice);
      }
      if (o.afterDecision) expect(o.afterDecision.acknowledgedBy?.by).not.toBe(AUTO_RULE);
    });
  }
});

// A shared address with two open invoices, only one equal to the transfer: an amount-only link
// (forbidden, docs/SPEC.md "Matching") would auto-match SAMPLE-INV-2023. This must stay a review.
describe("demo scenarios: amount alone never links", () => {
  it("SCN-20: two open invoices on one address, one equal to the amount: no system link, no auto-match", async () => {
    const s = found.find((x) => x.id === "SCN-20")!;
    expect(s.invoices.filter((i) => i.amount === "100.00")).toHaveLength(1);
    const o = await runScenario(s);
    expect(o.autoMatched).toEqual([]);
    expect(o.action).toBe("review");
    expect(o.reasons.join(" ")).toMatch(/amount alone isn't proof/);
  });
});

describe("demo scenarios: expected outcome (offline replay through the request path)", () => {
  for (const s of found) {
    const test = s.known_gap ? it.fails : it;
    test(`${s.id} ${s.case_type}: ${s.label.expected_action}${s.known_gap ? " (fails today: see known_gap)" : ""}`, async () => {
      const o = await runScenario(s);
      expect(o.action, o.reasons.join(" / ")).toBe(s.label.expected_action);
      if (s.label.expected_action === "auto_match") expect(o.invoice).toBe(s.label.true_invoice);
      expect(reasonsMatch(s, o.reasons), `reasons: ${o.reasons.join(" / ")}`).toBe(true);
      if (s.after_decision === "completed_by_person") {
        expect(o.afterDecision?.state).toBe("completed");
        expect(o.afterDecision?.acknowledgedBy?.kind).toBe(s.person_decision!.kind);
      }
    });
  }
  for (const s of all.filter((x) => !x.transfer)) it.todo(`${s.id} ${s.case_type}: gap, no recorded real transfer yet`);
});
