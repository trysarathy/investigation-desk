# Task 1: counterfeit "USDT" symbols that slip past the confusable check

Roadmap row (bug, owner Product): "Real counterfeit USDT from the Dec 2025 poisoning case isn't recognised as claiming USDT; the deposit desk calls it 'unsupported token' instead of 'fake token'."

Pre-flight: PAUSE assumed FALSE (tasks.md). Scratch worktree `/tmp/claude-0/cpe-eval-1` from `origin/main` (fd9b992; `src/` and `tests/` are byte-identical to the 533b096 the knowledge pack was built on: `git diff --stat origin/main ai-team -- src tests` empty). `npm ci` OK.
Baseline on main: `npx tsc --noEmit` exit 0; `npx vitest run` **562 passed | 57 skipped (619), 20 files passed + 1 skipped** [VERIFIED this run].

## 1. Is the bug real? Yes [VERIFIED this run]
- All seven contracts in the fixture are present in the repo's real recording `tests/fixtures/real/POISON-1.json` (eth.blockscout.com v2 token-transfer pages for `0xbaff…f8b5`, recorded 2026-10-24), with the same `symbol` strings.
- Each symbol is `U`,`S`,`D`,`T` (or Greek `Τ` U+03A4) with **Unicode format characters (General Category Cf)** between the letters: U+200E LEFT-TO-RIGHT MARK, U+200F RIGHT-TO-LEFT MARK, U+2063 INVISIBLE SEPARATOR, plus U+200B/C/D. They render as "USDT".
- Replaying each through `investigate()` as a deposit to a company Ethereum address (sample case CS-1045's facts with the token swapped) returned **D05 High** for all seven before the change (failing assertions below).

## 2. Root cause (one sentence)
`src/lib/engine/context.ts:70 claimedSymbol` strips only `\s` and U+200B-U+200D/U+FEFF, so U+200E, U+200F and U+2063 survive, the folded symbol is not "USDT", `claimedToken` stays undefined, `impersonation` is never computed (no official contract looked up), and the rule set falls through to D05 "contract not on the allowlist" instead of D06. Protocol fact: `symbol()` is an optional, deployer-controlled string (ERC-20: "OPTIONAL … MUST NOT expect these values to be present"); identity is the emitting log `address`, and a symbol only tells us *what it pretends to be*, which is exactly what D06 needs to read.

## 3. The fix
Remove every `\p{Cf}` (format) character, together with `\p{M}` marks and whitespace, after NFKD and before the confusable map. Cf covers the three seen in the wild and the neighbours an attacker would try next (U+2060 word joiner, U+2061-2064 invisible operators, U+00AD soft hyphen, U+202A-202E bidi embeddings/overrides, U+2066-2069 isolates, U+FEFF, U+200B-U+200F). It does not touch letters, so "USDD", "fUSDT", "DAI" fold exactly as before.

Effect on the verdict for a deposit of one of these tokens to a company address:
- **Before:** D05 "Unsupported token", High. Reply template: "We received {token} on Ethereum, which we don't support for deposits. Our team is reviewing your case under our unsupported-asset policy…", with `{token}` = the raw symbol, which *displays as "USDT"*. The customer reads "we received USDT, unsupported", and the analyst's next step is "Apply the unsupported-asset policy" (i.e. treat it as a real asset to return/handle) for a worthless token.
- **After:** D06 "Fake token", High. Evidence: "Claims to be USDT (symbol uses look-alike characters); contract is not the official one" (official = `0xdAC17F958D2ee523a2206206994597C13D831ec7` from Settings). Reply: "The token you sent is not genuine USDT: its contract address doesn't match the official one. It can't be credited. Please be cautious with whoever supplied it." (`run.ts fillValues` names a look-alike as the token it imitates, so `{symbol}` = "USDT", not the invisible-character string). Next step: "Not credited. Flag to compliance as a possible scam."
- **Unchanged and important:** it was never credited before either. D05 and D06 are both non-crediting; the payment-request path counts only `tokenContract == request.tokenContract`, and accounting never posts counterfeit/wrong_token. This is an explanation-quality defect (wrong diagnosis, wrong next step, misleading reply), not a money defect.

## 4. Tests (failing first, then passing) [VERIFIED this run]
Added to `tests/real-rules.test.ts`, reading the **real recorded** POISON-1 responses (offline, deterministic):
- `claimedSymbol › real counterfeit <contract> claims USDT once format characters are removed` × 7
- `claimedSymbol › folds other invisible format characters too, and leaves real other tickers alone` (U+2060/U+2064/U+00AD; bidi U+202E/U+202A/U+2066 on "USDC"; fullwidth + format; "USDD" with format chars stays USDD; `f⁣USDT` stays FUSDT)
- `D06 for real counterfeit USDT with hidden format characters › <contract>: fake token (D06 High), never unsupported token (D05)` × 7

Before the change, `npx vitest run tests/real-rules.test.ts`:
```
Tests  15 failed | 6 passed (21)
  7× → expected 'D05' to be 'D06' // Object.is equality
  e.g. → expected 'US‎⁣D⁣T‏' to be 'USDT' // Object.is equality
       → expected 'U⁠S⁤D­T' to be 'USDT' // Object.is equality
```
After the change:
```
npx vitest run tests/real-rules.test.ts   Tests  21 passed (21)
npx tsc --noEmit                          exit 0, no output
npx vitest run                            Test Files 20 passed | 1 skipped (21); Tests 577 passed | 57 skipped (634)
npx next build                            exit 0 (route table printed, "○ (Static) … ƒ (Dynamic)")
```
577 = 562 baseline + 15 new; no existing test changed result.

Self-check: diff 2 files, +64/−4 (68 lines); forbidden-method grep on the diff: 0 hits; no `.env*`, `.data/`, `.next/`, keys in the diff.

## 5. Diff (`git -C /tmp/claude-0/cpe-eval-1 diff origin/main`, after `git add -A`)
```diff
diff --git a/src/lib/engine/context.ts b/src/lib/engine/context.ts
index e08a207..a0701b7 100644
--- a/src/lib/engine/context.ts
+++ b/src/lib/engine/context.ts
@@ -65,11 +65,14 @@ const CONFUSABLE: Record<string, string> = {
 
 /**
  * The token a symbol claims to be once look-alike characters are folded away: compatibility
- * forms (fullwidth letters), accents and Cyrillic/Greek look-alikes. "ÚЅDТ" claims USDT.
+ * forms (fullwidth letters), accents, Cyrillic/Greek look-alikes and invisible characters.
+ * "ÚЅDТ" claims USDT. So does "U\u200f\u2063S…D…T": the real counterfeits in the Dec 2025
+ * poisoning case hide Unicode format characters (category Cf: U+200E/U+200F/U+2063, also
+ * zero-width, bidi and soft-hyphen chars) between the letters; they render as nothing.
  */
 export function claimedSymbol(symbol: string): string {
-  const folded = symbol.normalize("NFKD").replace(/\p{M}/gu, "").toUpperCase();
-  return [...folded].map((ch) => CONFUSABLE[ch] ?? ch).join("").replace(/[\s\u200b-\u200d\ufeff]/g, "");
+  const folded = symbol.normalize("NFKD").replace(/[\p{M}\p{Cf}\s]/gu, "").toUpperCase();
+  return [...folded].map((ch) => CONFUSABLE[ch] ?? ch).join("");
 }
 
 export function asDepositChain(chain: string): DepositChain | undefined {
diff --git a/tests/real-rules.test.ts b/tests/real-rules.test.ts
index ce35520..ac73163 100644
--- a/tests/real-rules.test.ts
+++ b/tests/real-rules.test.ts
@@ -1,11 +1,35 @@
 // Unit tests for the rules changed by the real-data test (24 Oct 2026).
 
+import { readFileSync } from "node:fs";
+import path from "node:path";
 import { describe, expect, it } from "vitest";
 import { BlockscoutHistory } from "@/lib/chain/evm";
 import { ChainClient } from "@/lib/chain/http";
 import { MemoryStore } from "@/lib/chain/store";
 import { claimedSymbol, isPoisoning, looksAlike } from "@/lib/engine/context";
-import { SAMPLE_SETTINGS } from "@/lib/fixtures";
+import { findCase, SAMPLE_SETTINGS } from "@/lib/fixtures";
+import { investigate } from "@/lib/engine/run";
+import type { Facts } from "@/lib/types";
+
+// The seven counterfeit "USDT" contracts that sent the Dec 2025 poisoning look-alike (0xbaff…f8b5)
+// forged transfers, with their symbols exactly as eth.blockscout.com returned them (real recording).
+// They hide Unicode format characters (category Cf: U+200E, U+200F, U+2063) between the letters.
+const POISON_1_FAKES = [
+  "0x6b278d3582e7a6ed76d7f2f8b7eb827447888c91", "0x3877bd8266fd6dcdfa893f3ed244ba8837ef4cd2",
+  "0x43ab3d04a695d00233d88d99b2272a1c79233daa", "0xc200b4b7c36ca1a42d1670a824da8d9606184338",
+  "0xcefacfcf7192f2b776b171ff064257a7ae40ffed", "0x77820cbab0f1ddb836b257d4f1df0cad0f05a0a6",
+  "0xfa2c55c4f26ebc569ace8f86bd09221265c49124",
+];
+const RECORDED_SYMBOLS = new Map<string, string>();
+{
+  const rec = JSON.parse(readFileSync(path.join(__dirname, "fixtures/real/POISON-1.json"), "utf8")) as
+    { exchanges: { request: { url: string }; response: { body: string } }[] };
+  for (const e of rec.exchanges.filter((x) => x.request.url.includes("blockscout"))) {
+    for (const it of (JSON.parse(e.response.body).items ?? []) as { token?: { address_hash: string; symbol: string } }[]) {
+      if (it.token) RECORDED_SYMBOLS.set(it.token.address_hash.toLowerCase(), it.token.symbol);
+    }
+  }
+}
 
 describe("claimedSymbol", () => {
   it("folds Cyrillic, accents and fullwidth into the claimed ticker", () => {
@@ -15,6 +39,39 @@ describe("claimedSymbol", () => {
     expect(claimedSymbol("USDD")).toBe("USDD");
     expect(claimedSymbol("fUSDT")).toBe("FUSDT");
   });
+
+  it.each(POISON_1_FAKES)("real counterfeit %s claims USDT once format characters are removed", (c) => {
+    const s = RECORDED_SYMBOLS.get(c);
+    expect(s).toBeDefined();
+    expect(s).not.toBe("USDT");
+    expect(claimedSymbol(s!)).toBe("USDT");
+  });
+
+  it("folds other invisible format characters too, and leaves real other tickers alone", () => {
+    expect(claimedSymbol("U\u2060S\u2064D\u00adT")).toBe("USDT");          // word joiner, invisible plus, soft hyphen
+    expect(claimedSymbol("U\u202eS\u202aD\u2066C")).toBe("USDC");          // bidi overrides / isolates
+    expect(claimedSymbol("Ｕ\u2063Ｓ\u200fＤ\u200eＴ")).toBe("USDT");       // fullwidth + format chars
+    expect(claimedSymbol("U\u200eS\u2063D\u200fD")).toBe("USDD");          // still not USDT
+    expect(claimedSymbol("f\u2063USDT")).toBe("FUSDT");                   // prefix survives
+  });
+});
+
+describe("D06 for real counterfeit USDT with hidden format characters", () => {
+  // CS-1045 is a deposit to a company Ethereum address (fictional sample company) in an
+  // unaccepted token. Swap in each real counterfeit contract + symbol: it must be D06, not D05.
+  const base = findCase("CS-1045")!.snapshots.at(-1)!;
+  const withToken = (contract: string, symbol: string): Facts => ({
+    ...base,
+    tx: { ...base.tx!, transfers: base.tx!.transfers.map((t) => ({ ...t, tokenContract: contract, tokenSymbol: symbol })) },
+  });
+
+  it.each(POISON_1_FAKES)("%s: fake token (D06 High), never unsupported token (D05)", (contract) => {
+    const v = investigate(withToken(contract, RECORDED_SYMBOLS.get(contract)!), SAMPLE_SETTINGS);
+    expect(v.state).toBe("verdict");
+    expect(v.code).toBe("D06");
+    expect(v.confidence).toBe("High");
+    expect(v.findings.map((f) => f.code)).not.toContain("D05");
+  });
 });
 
 describe("looksAlike (first 3 + last 4)", () => {
```

## 6. WOULD OPEN PR:
```
Title: fix(engine): read counterfeit "USDT" with hidden format characters as claiming USDT (D06, not D05)

## What and why
Seven real counterfeit "USDT" contracts from the Dec 2025 poisoning case (POISON-1) return symbols with
Unicode format characters (Cf: U+200E, U+200F, U+2063) between the letters. `claimedSymbol` stripped only
U+200B-U+200D/U+FEFF, so they didn't read as claiming USDT and a deposit of one to a company address got
D05 "Unsupported token" instead of D06 "Fake token". Now all Cf characters are removed before folding.
Token identity stays the emitting contract address (ERC-20: symbol() is optional and deployer-chosen);
the symbol only says what the token pretends to be.
Closes roadmap row: "Real counterfeit USDT from the Dec 2025 poisoning case isn't recognised as claiming USDT…" (gap G13)

## How it was tested
- Failing test first: `tests/real-rules.test.ts › D06 for real counterfeit USDT with hidden format characters ›
  0x6b27…8c91: fake token (D06 High), never unsupported token (D05)` failed with `expected 'D05' to be 'D06'`
  (15 tests failed before the change: 7× D05≠D06, 8× claimedSymbol kept the format chars).
- Added: 7 claimedSymbol cases from the real recording, 1 neighbour case (word joiner, soft hyphen, bidi
  overrides/isolates, fullwidth+format, USDD and fUSDT unchanged), 7 engine replays → D06 High.
- `npx tsc --noEmit` ✔  `npx vitest run` ✔ (577 passed, 57 skipped)  `npx next build` ✔   (all seen this run)

## Protocol and security notes
- Read-only: no chain method, signer or key handling touched (grep clean). Pure function change.
- Unknown facts: unchanged.
- Chains/tokens affected: any chain where a symbol is folded (deposit desk, all chains); decimals/finality: n/a.
- Never-credited behaviour unchanged: D05 and D06 are both non-crediting; only the diagnosis, next step and
  reply change.

## What Aashmiin should check
- /investigate with a deposit of contract 0xfa2c55c4f26ebc569ace8f86bd09221265c49124 (or replay POISON-1's
  history) to a company address: verdict "Fake token", reply says "not genuine USDT".

## Not done / follow-ups
- G4: `requests/lifecycle.ts transferIssue` decides counterfeit vs wrong_token with
  `o.tokenSymbol.toUpperCase().includes(r.token)`; these symbols contain format chars so the request page
  says "wrong_token" ("…is not the token requested") instead of "counterfeit". Fix = reuse `claimedSymbol`
  there (separate small PR; never posted either way).
- Evidence/UI shows the raw symbol, which renders as "USDT"; consider rendering Cf chars visibly
  (e.g. `U‏S…`) in the evidence row so an analyst can see the trick.
- G8: `₮` (U+20AE, Arbitrum "USD₮0") is not folded to T; deliberately not changed here (it is a genuine
  USDT0 token, needs an official-contract decision first).
- The same POISON-1 history contains "DAl" (lower-case L) and a non-official "DAI" (0x5EeF…5Ed3): not a
  USDT/USDC claim, out of scope, noted only.
- Knowledge pack (`codebase-map.md` G13, `attack-patterns.md` A3) lives on the `ai-team` branch, not `main`:
  mark G13 fixed there in a companion change once this merges.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j
```
Branch would be `fix/claimed-symbol-format-chars`, commit as `Aashmiin Kaur <aashmiin@gmail.com>` with the Co-Authored-By and Claude-Session lines. Pushed branch only, never `main`.

WOULD WRITE (Company HQ, live tools off):
- Product roadmap row → status `in review`, PR link.
- Log: `2026-10-30 23:xx SGT | crypto-protocol-engineer | opened PR #<n> | roadmap: counterfeit USDT symbols (G13) | <link>`
- Log summary: `shipped: PR #<n> (G13 claimedSymbol); blocked: none; need decided: none`.

## Notes
- Verified this run: bug reproduced on main code; root cause by reading `context.ts`; all command results above seen by me. Worktree removed and local `eval/cpe-task-1` branch deleted afterwards.
- Assumption: Node's `\p{Cf}` table (Node 22, ICU) matches Unicode's; the tests pin the specific code points we rely on, so a table difference would show as a failing test.
- Fixture data is real public chain data; the deposit facts (CS-1045 company/customer) are fictional sample data.
- Not changed on purpose (scope): G4 request-path wording, G8 `₮`, the knowledge pack.
