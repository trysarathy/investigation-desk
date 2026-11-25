/**
 * v1 Phase 0.5 property tests for the evidence-level split (founder decisions 12–16), with the repo's seeded PRNG (no
 * Math.random): an amount alone never matches; shuffled input order gives identical results; re-runs are idempotent;
 * the bank evidence level never shows higher than the evidence supports, and nothing produces `bank_authenticated`.
 * The world is the small synthetic preset as the blind test's files give it, plus a per-payment settlement file and
 * imported statement lines, so the split's rule (M5.batch.tied_evidence_separate) is exercised. Synthetic · fictional.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BANK_EVIDENCE_RANK, type MatchRecord, type ReconcileInput } from "@/lib/clearline/merchant";
import { smallWorld } from "@/lib/clearline/synthetic";
import { blindInput, perPaymentLines } from "../../fixtures/synthetic/blind-input";
import { reconcile, shuffleInput } from "./helpers";

const SEEDS = Array.from({ length: 25 }, (_, i) => 9001 + i * 7919);
function prng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
}

const world = smallWorld();
const TOTALS: ReconcileInput[] = world.entitySpecs.map((e) => blindInput(world, e.id));
const BASE: ReconcileInput[] = TOTALS.map((i) => ({ ...i, settlementPaymentLines: perPaymentLines(world, i) }));
/** Both settlement shapes: per-payment lines (batches tie) and totals only (only a grouping is proposed). */
const SHAPES: [string, ReconcileInput[], string][] = [["per-payment lines", BASE, "M5.batch.tied_evidence_separate"], ["totals only", TOTALS, "M5.grouping.matched_settlement_unlinked"]];
const CLOSING = new Set(["matched", "matched_with_difference"]);
const view = (r: MatchRecord) => [r.orderId, r.explanation.decision, r.explanation.ruleId, r.explanation.decidingStep, r.bank.evidence, r.bank.settled, r.bank.batchTied, r.bank.settlementVerified];
const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));

/** A random variation of the bank side: which lines a second person confirmed, which are "feed" lines, the flag, one-cent errors. */
function vary(input: ReconcileInput, seed: number): ReconcileInput {
  const next = prng(seed);
  return {
    ...input,
    policy: { ...input.policy, allowImportedBankLinesAsVerified: next() % 2 === 0 },
    bankLines: input.bankLines.map((l) => {
      const { secondPersonConfirmed: _c, ...rest } = l;
      void _c;
      const r = next() % 6;
      const source = r === 0 ? ("bank_feed" as const) : ("csv_import" as const);
      const amountMinor = r === 1 ? l.amountMinor + 1n : l.amountMinor;
      return { ...rest, source, amountMinor, ...(next() % 3 !== 0 ? { secondPersonConfirmed: true as const } : {}) };
    }),
  };
}

describe("evidence-level split: baseline", () => {
  it("the split closes exact payments in tied batches with imported lines, and nothing else changes kind", () => {
    const recs = BASE.flatMap((i) => reconcile(i).records);
    const split = recs.filter((r) => r.explanation.ruleId === "M5.batch.tied_evidence_separate");
    expect(split.length).toBeGreaterThan(0);
    for (const r of split) {
      expect(r.explanation.decision).toBe("matched");
      expect(r.explanation.history.some((h) => h.ruleId === "M4.exact.no_quote_terms" && h.outcome === "pass")).toBe(true);
      expect([r.bank.batchTied, r.bank.settlementVerified, r.bank.evidence, r.bank.settled]).toEqual([true, false, "imported_two_person_confirmed", true]);
    }
    // a payment with a difference in such a batch is never closed by the split
    for (const r of recs) if (r.explanation.decision === "matched_with_difference") expect(r.explanation.ruleId).not.toBe("M5.batch.tied_evidence_separate");
  });
});

describe("evidence-level split properties (25 seeds)", () => {
  for (const [shape, inputs, rule] of SHAPES) it(`${shape}: an amount alone never matches: a transfer to an address not issued for the order, of exactly its invoice, never closes it`, () => {
    for (const seed of SEEDS) {
      const next = prng(seed);
      const input = inputs[seed % inputs.length];
      const closedNow = reconcile(input).records.filter((r) => r.explanation.ruleId === rule);
      expect(closedNow.length).toBeGreaterThan(0);
      const victim = closedNow[next() % closedNow.length];
      const tr = victim.chain.transfers[0];
      // the same transfer and amount, but to an address Clearline never issued: only the amount still "matches"
      const moved: ReconcileInput = { ...input, transfers: input.transfers.map((t) => (t.txHash === tr.txHash && t.logIndex === tr.logIndex ? { ...t, to: `TNotIssued${seed}x${"1".repeat(20)}` } : t)) };
      const after = reconcile(moved).records.find((r) => r.orderId === victim.orderId);
      expect(after === undefined || !CLOSING.has(after.explanation.decision), `${seed} ${victim.orderId}`).toBe(true);
      // and no other order closes with that transfer
      for (const r of reconcile(moved).records) if (CLOSING.has(r.explanation.decision)) expect(r.chain.transfers.some((t) => t.txHash === tr.txHash && t.logIndex === tr.logIndex)).toBe(false);
    }
  });

  for (const [shape, inputs, rule] of SHAPES) it(`${shape}: an invoice with the same amount as a matched payment, but no reference to it, never matches`, () => {
    for (const seed of SEEDS) {
      const next = prng(seed);
      const input = inputs[seed % inputs.length];
      const matched = reconcile(input).records.filter((r) => r.explanation.ruleId === rule);
      const twin = matched[next() % matched.length];
      const inv = input.invoices.find((i) => i.orderId === twin.orderId)!;
      const withTwin: ReconcileInput = { ...input, invoices: [...input.invoices, { ...inv, orderId: `TWIN-${seed}` }] };
      const r = reconcile(withTwin);
      expect(r.records.find((x) => x.orderId === `TWIN-${seed}`)).toBeUndefined();
      expect(json(r.records.map(view))).toBe(json(reconcile(input).records.map(view)));
    }
  });

  for (const [shape, inputs] of SHAPES) it(`${shape}: shuffled input order gives identical results, evidence levels included`, () => {
    for (const seed of SEEDS) {
      const input = vary(inputs[seed % inputs.length], seed);
      const a = reconcile(input), b = reconcile(shuffleInput(input, seed));
      expect(json(b.records.map(view))).toBe(json(a.records.map(view)));
      expect(json(b.bridges.map((x) => [x.batchId, x.tied, x.settlementVerified, x.bankEvidence, x.settled]))).toBe(json(a.bridges.map((x) => [x.batchId, x.tied, x.settlementVerified, x.bankEvidence, x.settled])));
    }
  });

  for (const [shape, inputs] of SHAPES) it(`${shape}: re-runs are idempotent: the same input gives exactly the same output`, () => {
    for (const seed of SEEDS.slice(0, 8)) {
      const input = vary(inputs[seed % inputs.length], seed);
      expect(json(reconcile(input))).toBe(json(reconcile(input)));
    }
  });

  for (const [shape, inputs] of SHAPES) it(`${shape}: the evidence level never shows higher than the evidence supports; the flag never raises it; nothing is bank_authenticated`, () => {
    for (const seed of SEEDS) {
      const input = vary(inputs[seed % inputs.length], seed);
      const r = reconcile(input);
      const lineOf = new Map(input.bankLines.map((l) => [l.bankLineId, l]));
      for (const b of r.bridges) {
        expect(b.bankEvidence).not.toBe("bank_authenticated");
        const l = b.bankLineId ? lineOf.get(b.bankLineId) : undefined;
        if (b.bankEvidence === "imported_two_person_confirmed") expect(l?.source === "csv_import" && l.secondPersonConfirmed === true).toBe(true);
        expect(b.settled).toBe(b.tied && BANK_EVIDENCE_RANK[b.bankEvidence] >= 1);
      }
      const bridgeOf = new Map(r.bridges.map((b) => [b.batchId, b]));
      for (const rec of r.records) {
        expect(rec.bank.evidence).not.toBe("bank_authenticated");
        if (rec.bank.evidence !== "none") {
          expect(rec.bank.batchIds.length).toBeGreaterThan(0);
          for (const id of rec.bank.batchIds) expect(bridgeOf.get(id)!.tied && bridgeOf.get(id)!.bankEvidence === "imported_two_person_confirmed").toBe(true);
        }
        if (rec.bank.settled) expect(rec.bank.batchTied && rec.bank.evidence !== "none").toBe(true);
        if (rec.bank.status === "proposed_grouping" || rec.bank.status === "not_in_batch") expect([rec.bank.evidence, rec.bank.settled]).toEqual(["none", false]);
      }
      // the imported-bank-line flag verifies settlement for journals; it never changes the evidence level
      const flipped = reconcile({ ...input, policy: { ...input.policy, allowImportedBankLinesAsVerified: !input.policy.allowImportedBankLinesAsVerified } });
      expect(json(flipped.records.map((x) => [x.orderId, x.bank.evidence, x.bank.settled]))).toBe(json(r.records.map((x) => [x.orderId, x.bank.evidence, x.bank.settled])));
      // and it never changes which payments are matched (only the rule that records it); a payment with a difference
      // still needs the flag (a check only) to leave review, exactly as before the split
      const matchedOf = (x: typeof r) => x.records.filter((y) => y.explanation.decision === "matched").map((y) => y.orderId);
      expect(matchedOf(flipped)).toEqual(matchedOf(r));
    }
  });
});

describe("a matched payment whose settlement is not linked is never settled (25 seeds)", () => {
  for (const [shape, inputs] of SHAPES) it(`${shape}: unlinked, proposed-grouping or untied → not settled, evidence none; and only exact step-4 payments are matched that way`, () => {
    for (const seed of SEEDS) {
      // also drop the per-payment line of one random payment, so some exact payments lose their batch link
      const next = prng(seed);
      const base = vary(inputs[seed % inputs.length], seed);
      const lines = base.settlementPaymentLines;
      const input = lines ? { ...base, settlementPaymentLines: lines.filter((_, k) => k !== next() % lines.length) } : base;
      const r = reconcile(input);
      const tiedOf = new Map(r.bridges.map((b) => [b.batchId, b.tied]));
      for (const rec of r.records) {
        const linked = rec.bank.batchIds.length > 0 && rec.bank.status !== "proposed_grouping" && rec.bank.batchIds.every((id) => tiedOf.get(id));
        if (!linked) expect([rec.orderId, rec.bank.settled, rec.bank.evidence]).toEqual([rec.orderId, false, "none"]);
        if (rec.explanation.ruleId === "M5.grouping.matched_settlement_unlinked") {
          expect(rec.explanation.decision).toBe("matched");
          expect(rec.explanation.differences).toEqual([]);
          expect(rec.explanation.history.some((h) => h.step === 4 && h.outcome === "pass" && (h.ruleId === "M4.exact.no_quote_terms" || h.ruleId === "M4.match.no_difference"))).toBe(true);
          expect(rec.explanation.history.some((h) => h.ruleId === "M5.grouping.proposed_needs_confirmation" && h.outcome === "note" && h.detail.startsWith("Settlement not linked"))).toBe(true);
          expect([rec.bank.status, rec.bank.settled, rec.bank.evidence]).toEqual(["proposed_grouping", false, "none"]);
        }
      }
      // a proposed grouping itself is never settled or closed
      for (const g of r.proposedGroupings) expect(g.status).toBe("proposed_needs_confirmation");
    }
  });
});

describe("bank_authenticated is reserved", () => {
  it("no source file outside the level's own definitions names it (nothing can produce it)", () => {
    const root = path.resolve(__dirname, "../../../src");
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && readFileSync(p, "utf8").includes("bank_authenticated")) hits.push(path.relative(root, p));
      }
    };
    walk(root);
    // types.ts defines the level, its rank and its label; merchant.ts refuses to store it; the schema comment and the
    // bridge comment say it is reserved. No other file may name it (a producer would have to).
    expect(hits.sort()).toEqual(["lib/clearline/merchant/bridge.ts", "lib/clearline/merchant/types.ts", "server/db/merchant-schema.ts", "server/merchant.ts"]);
    const bridge = readFileSync(path.join(root, "lib/clearline/merchant/bridge.ts"), "utf8");
    expect(bridge.split("\n").filter((l) => l.includes("bank_authenticated")).every((l) => l.trim().startsWith("*"))).toBe(true);
  });
});
