# Fuzzing and property-based testing

Money code fails at the edges examples don't reach: 7 decimal places, leading zeros, an amount one
base unit short, a mixed-case address, a formula in a customer reference. Property-based testing
states a rule ("for all inputs such that P, Q holds") and lets a generator search for a counterexample,
then shrinks it to the smallest failing input [VERIFIED, fast-check README].

## Recommendation: add `fast-check` as a dev dependency (needs a PR and Aashmiin's merge)
- **What**: `fast-check@4.10.2` (MIT, one dependency `pure-rand`, last modified 2026-09-19 per
  `npm view` on 29 Oct) [VERIFIED: npm registry metadata]. Dev only: it never ships.
- **Why it earns a dependency**: our core invariants are exactly property-shaped (exact decimal
  arithmetic, base-unit conversion, address canonicalisation, "never count a counterfeit", "posting
  lines never exceed what arrived"), and every one is tested today by a handful of hand-picked
  examples (test-map G7). Writing our own generator + shrinker is more code than the dependency.
- **Why not more**: no Stryker/mutation testing, no fuzzing service. Re-assess after a pilot.
- **Cost of a flaky property**: properties are seeded; a failure prints the seed and path
  (`Property failed after N tests (seed: …, path: …)`) [VERIFIED, README]. Record both in the bug
  so it replays exactly. Keep `numRuns` modest (default 100) in the nightly suite so vitest stays
  under 15 s; run `numRuns: 10_000` in the Sunday review.

## Probe run, 29 Oct 2026 (scratch copy of main @ fd9b992, fast-check installed with `--no-save`)
[VERIFIED: run; the throwaway file is not committed]
| Property | Result |
|---|---|
| `compareDecimal(a,b)` agrees with BigInt comparison (leading zeros, 0–8 decimals, up to 10^15) | pass |
| `sub(add(a,b), b) == a` (`payments/money.ts`) | pass |
| `toBaseUnits(a)` = exact integer of a × 10^6 for ≤ 6 decimals | pass |
| `normaliseAmount` and `formatUsdc` keep the exact value | pass |
| `percentOf` within 0.05 of the exact percentage | pass |
| `canonicalAddress` idempotent; EVM compare case-insensitive | pass |
| `csvCell(s)` never emits a cell starting `= + - @ \t \r` (random graphemes) | pass |
| `csvCell` neutralises full-width `＝ ＋ － ＠` (OWASP list) | **FAIL**: counterexample `["＝",""]` → test-map G8 |

## Properties to add (in this order; each is one small PR with the dependency PR first)
| # | Module | Property | Generator notes |
|---|---|---|---|
| P1 | `src/lib/decimal.ts` | `compareDecimal` is a total order consistent with BigInt; antisymmetric; `isDecimal` rejects `1e3`, `-1`, `.5`, `1.`, `１` (full-width digit), `٣` (Arabic-Indic) | Strings built from (int bigint, scale, frac, leading zeros); plus a "nasty strings" `fc.constantFrom` |
| P2 | `src/lib/payments/money.ts` | add/sub inverse; `sum` order-independent; `mulBps(a, 10000) == a`; parse rejects non-decimals | Signed decimals |
| P3 | `requests/lifecycle.ts` `toBaseUnits`, `formatUsdc`, `normaliseAmount`, `percentOf` | Round-trip exact; > 6 decimals throws; `validateRequest` accepts iff decimal, ≤ 6 places, > 0, ≤ 12 integer digits | Boundaries 0.000001, 999999999999.999999 |
| P4 | `src/lib/chain/abi.ts`/`evm.ts` `formatUnits` | `formatUnits(v, d)` × 10^d == v for any uint256 and d in 0..36 | `fc.bigInt({min:0n,max:2n**256n-1n})` |
| P5 | `deriveRequest` | For any multiset of confirmed genuine transfers to the request: received == exact sum; state `matched` iff sum == amount, `short` iff <, `over` iff > | Split amounts from a random partition of the invoice ± one base unit |
| P6 | `accounting/rules.ts` `planPosting` | Sum of payment lines ≤ received (cents round down); never a line for counterfeit / wrong network / failed / wrong token; plan key changes iff lines change | Random mixes of good and bad transfers |
| P7 | `requests/lifecycle.ts` `transferIssue` | For any token contract ≠ official: never counts, whatever the symbol (random Unicode incl. homoglyphs) | `fc.string({unit:"grapheme"})` symbols |
| P8 | `src/lib/address.ts` | Canonical form idempotent; EVM case-insensitive; Tron hex ↔ base58 round-trip for any 20-byte payload | 20 random bytes |
| P9 | `requests/lifecycle.ts` `compareAddress` | Real address → `match`; any 40-hex sharing first 4 or last 4 (not equal) → `lookalike`; invalid formats → `invalid` | Mutate middle characters |
| P10 | `src/lib/csv/cell.ts` | Output never starts a formula (incl. full-width), and parses back (with `csv/parse.ts`) to the original text minus the `'` prefix | `fc.string({unit:"grapheme"})` + separators |
| P11 | `src/lib/csv/parse.ts`, `csv/files.ts` | Never throws on arbitrary bytes; either a parse or a row/file error | `fc.uint8Array({maxLength: 4096})` |
| P12 | `src/lib/ai/validate.ts` | Any output containing a number/address/hash not in the evidence is rejected | Inject random tokens into a valid sentence |

## Shape of a property test (matches the repo's vitest style)
```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compareDecimal } from "@/lib/decimal";

const decimal = fc.tuple(fc.bigInt({ min: 0n, max: 10n ** 15n }), fc.integer({ min: 0, max: 8 }), fc.bigInt({ min: 0n, max: 10n ** 8n }))
  .map(([i, n, f]) => i.toString() + (n ? "." + f.toString().padStart(n, "0").slice(0, n) : ""));
const scaled = (s: string) => { const [i, f = ""] = s.split("."); return BigInt(i + f.padEnd(20, "0")); };

describe("decimal properties", () => {
  it("compareDecimal agrees with exact integer comparison", () => {
    fc.assert(fc.property(decimal, decimal, (a, b) => {
      const x = scaled(a), y = scaled(b);
      expect(compareDecimal(a, b)).toBe(x < y ? -1 : x > y ? 1 : 0);
    }));
  });
});
```

## Example-based fuzz without a dependency (use until the PR merges)
A fixed "nasty inputs" table in a normal test: `""`, `" 1"`, `"1 "`, `"01"`, `"1."`, `".1"`, `"1e3"`,
`"-0"`, `"0x10"`, `"１"`, `"1,000"`, `"999999999999.9999999"`, `"=1+1"`, `"＝1"`, `"a;=1"`, `"\t=1"`,
40-hex with mixed case, 41-hex, Tron address with a bad checksum, Cyrillic `"ЕТН"`/`"ՍЅDС"` symbols.

## Sources
- fast-check README: https://github.com/dubzzz/fast-check/blob/main/packages/fast-check/README.md (accessed 2026-10-29) [VERIFIED]
- fast-check package metadata: `npm view fast-check version time.modified license dependencies` (run 2026-10-29) [VERIFIED]
- OWASP CSV Injection (full-width characters): see `owasp.md` [VERIFIED]
