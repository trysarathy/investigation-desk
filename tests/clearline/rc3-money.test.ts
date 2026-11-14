/**
 * rc3 Priority A — exact money (invariant 1). Integer minor units; every product or ratio on money
 * uses BigInt (convertMinor, applyBpsFloor). The liquidity test failed before M-1.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeLiquidity, convertMinor, emptyWorkspace, formatMinorPlain, parseAmount, parseWorkspaceValue, sampleWorkspace, scenarioIntentId, serializeWorkspace, type Workspace } from "@/lib/clearline";
import { attempt, baseInput, debitLine, errorCode, run } from "./helpers";
import { MAX_AMOUNT_MINOR, applyBpsFloor } from "@/lib/clearline/money";

const ENGINE = path.resolve(__dirname, "../../src/lib/clearline");

describe("rc3 M-1: basis-point amounts are exact above 2^53", () => {
  it("applyBpsFloor is exact where the float expression is off by one", () => {
    const amount = 9_007_199_254_740_839;
    expect(Math.floor((amount * 500) / 10000)).toBe(450_359_962_737_042); // float: wrong
    expect(applyBpsFloor(amount, 500)).toBe(450_359_962_737_041); // exact
    expect(applyBpsFloor(2_465_137, 10)).toBe(2_465);
    expect(() => applyBpsFloor(1.5, 10)).toThrow(RangeError);
  });

  it("the liquidity buffer for a very large balance is computed exactly", () => {
    const ws = emptyWorkspace();
    ws.liquidityPolicy.minBufferMinor = {};
    ws.liquidity = [{ ...ws.liquidity[0], eligibleMinor: 9_007_199_254_740_839, restrictedMinor: 0, safeguardedMinor: 0, asOf: ws.asOf }];
    const row = computeLiquidity(ws).rows[0];
    expect(row.bufferMinor).toBe(450_359_962_737_041);
    expect(row.usableMinor).toBe(9_007_199_254_740_839 - 450_359_962_737_041);
  });
});

describe("rc3 invariant 1: no floating point on money paths (static scan of src/lib/clearline)", () => {
  const files = readdirSync(ENGINE).filter((f) => f.endsWith(".ts"));
  const src = Object.fromEntries(files.map((f) => [f, readFileSync(path.join(ENGINE, f), "utf8")]));
  it("no parseFloat, toFixed or toPrecision anywhere in the engine", () => {
    for (const [f, text] of Object.entries(src)) expect(`${f}: ${/parseFloat|toFixed|toPrecision/.test(text)}`).toBe(`${f}: false`);
  });
  it("no float multiplication or division of a minor-unit amount (bps, rates) outside BigInt", () => {
    for (const [f, text] of Object.entries(src)) {
      const offenders = text.split("\n").filter((l) => /[Mm]inor\w*\s*\*\s*\w*(Bps|bps|rate|Rate)|(Bps|bps)\s*\)\s*\/\s*10_?000/.test(l) && !/BigInt|\dn\b/.test(l));
      expect(`${f}: ${offenders.join(" | ")}`).toBe(`${f}: `);
    }
  });
  it("Number(...) is only used on an already bounds-checked BigInt result or on a webhook timestamp", () => {
    const uses = Object.entries(src).flatMap(([f, text]) => text.split("\n").filter((l) => /\bNumber\(/.test(l)).map((l) => `${f}: ${l.trim()}`));
    for (const u of uses) expect(u).toMatch(/^(money\.ts: (return ok\(Number\((minor|out)\)\);|return Number\(\(BigInt\(amountMinor\) \* BigInt\(bps\)\) \/ 10_000n\);)|webhooks\.ts: const t = Number\(m\[1\]\);|scenarios\.ts: return m \? Number\(m\[1\]\) : Number\.MAX_SAFE_INTEGER;|migrate\.ts: const seqOf = \(id: string\) => Number\(\/_\(\\d\+\)\$\/\.exec\(id\)\?\.\[1\] \?\? Number\.MAX_SAFE_INTEGER\);)$/);
  });
  it("decimal strings round-trip exactly, USDC at 6 decimals", () => {
    const p = parseAmount("6427.830000", "USDC");
    expect(p).toEqual({ ok: true, value: 6_427_830_000 });
    expect(formatMinorPlain(6_427_830_000, "USDC")).toBe("6427.830000");
    expect(convertMinor(1_000_000, "SGD", "USDC", "0.741234")).toEqual({ ok: true, value: 7_412_340_000 });
    expect(parseAmount("0.1", "SGD").ok && formatMinorPlain(10, "SGD")).toBe("0.10");
  });
});

describe("review m-1: amounts and totals are bounded so every sum the engine computes is exact", () => {
  const sample = () => JSON.parse(serializeWorkspace(sampleWorkspace())) as Workspace;
  const refusedAt = (ws: Workspace, field: RegExp) => {
    const r = parseWorkspaceValue(ws);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field ?? "").toMatch(field);
  };
  it("a single amount above MAX_AMOUNT_MINOR (10^15) is refused at parse (before: 2^53−1 accepted)", () => {
    expect(MAX_AMOUNT_MINOR).toBe(1_000_000_000_000_000);
    const a = sample(); a.intents[0].amountMinor = Number.MAX_SAFE_INTEGER; refusedAt(a, /^intents\[0\]\.amountMinor$/);
    const b = sample(); b.liquidity[0].eligibleMinor = MAX_AMOUNT_MINOR + 1; refusedAt(b, /^liquidity\[0\]\.eligibleMinor$/);
    const c = sample(); c.statementLines[0].amountMinor = MAX_AMOUNT_MINOR + 1; refusedAt(c, /^statementLines\[0\]\.amountMinor$/);
    const d = sample(); d.liquidityPolicy.bufferBps = 10_001; refusedAt(d, /^liquidityPolicy\.bufferBps$/);
    const e = sample(); e.liquidityPolicy.minBufferMinor.SGD = MAX_AMOUNT_MINOR + 1; refusedAt(e, /^liquidityPolicy\.minBufferMinor\.SGD$/);
  });
  it("the reviewer's overflow workspace (two committed SGD payouts whose sum is inexact above 2^53) is refused", () => {
    const ws = sample();
    const sgd = ws.intents.filter((i) => i.sourceCurrency === "SGD").slice(0, 2);
    sgd[0].amountMinor = 4_503_599_627_370_497;
    sgd[1].amountMinor = 4_503_599_627_370_498;
    refusedAt(ws, /amountMinor|^intents$/);
  });
  it("per-currency totals: two SGD payouts of 6 × 10^14 each (each valid, total above 10^15) are refused; USD is a separate total", () => {
    const ws = sample();
    const sgd = ws.intents.filter((i) => i.sourceCurrency === "SGD");
    for (const i of sgd) i.amountMinor = 1;
    sgd[0].amountMinor = 600_000_000_000_000;
    sgd[1].amountMinor = 600_000_000_000_000;
    refusedAt(ws, /^intents$/);
    sgd[1].amountMinor = 400_000_000_000_000 - (sgd.length - 2);
    for (const i of ws.instructions) { const x = ws.intents.find((y) => y.id === i.intentId)!; i.amountMinor = x.amountMinor; }
    expect(parseWorkspaceValue(ws).ok).toBe(true);
  });
  it("actions never produce a workspace parse would refuse: create_intent and ingest_statement_line enforce the same totals", () => {
    let ws = emptyWorkspace();
    ws = run(ws, "usr_maya", { type: "create_intent", input: baseInput({ amountMinor: MAX_AMOUNT_MINOR }) }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput({ amountMinor: 1 }) }))).toBe("invalid_amount");
    expect(errorCode(attempt(ws, "usr_maya", { type: "create_intent", input: baseInput({ amountMinor: 1, sourceCurrency: "USD" }) }))).toBe("ok");
    ws = run(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: MAX_AMOUNT_MINOR }) }).workspace;
    expect(errorCode(attempt(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ amountMinor: 1 }) }))).toBe("invalid_amount");
    expect(parseWorkspaceValue(ws).ok).toBe(true);
  });
  it("a chain observation amount above 10^15 is refused at input (a rejected observation is stored, so it must stay loadable)", () => {
    const ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s4_chain")!;
    const o = ws.chainObservations.find((x) => x.intentId === id)!;
    const { id: _a, observedAt: _b, updatedAt: _c, finalityThreshold: _d, status: _e, label: _f, ...input } = o;
    expect(errorCode(attempt(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...input, tokenSymbol: "USDT", amountMinor: MAX_AMOUNT_MINOR + 1 } }))).toBe("invalid_field");
  });
});
