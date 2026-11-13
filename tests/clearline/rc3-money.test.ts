/**
 * rc3 Priority A — exact money (invariant 1). Integer minor units; every product or ratio on money
 * uses BigInt (convertMinor, applyBpsFloor). The liquidity test failed before M-1.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeLiquidity, convertMinor, emptyWorkspace, formatMinorPlain, parseAmount } from "@/lib/clearline";
import { applyBpsFloor } from "@/lib/clearline/money";

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
    for (const u of uses) expect(u).toMatch(/^(money\.ts: (return ok\(Number\((minor|out)\)\);|return Number\(\(BigInt\(amountMinor\) \* BigInt\(bps\)\) \/ 10_000n\);)|webhooks\.ts: const t = Number\(m\[1\]\);)$/);
  });
  it("decimal strings round-trip exactly, USDC at 6 decimals", () => {
    const p = parseAmount("6427.830000", "USDC");
    expect(p).toEqual({ ok: true, value: 6_427_830_000 });
    expect(formatMinorPlain(6_427_830_000, "USDC")).toBe("6427.830000");
    expect(convertMinor(1_000_000, "SGD", "USDC", "0.741234")).toEqual({ ok: true, value: 7_412_340_000 });
    expect(parseAmount("0.1", "SGD").ok && formatMinorPlain(10, "SGD")).toBe("0.10");
  });
});
