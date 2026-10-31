# T1: "Fake token" on a payment that really arrived (C-7781 / INV-5120)

Run: 2026-10-31 (SGT), crypto-protocol-engineer, holdout H1. Test run: nothing pushed, no PR opened,
no email sent, Company HQ not edited.

**Pre-flight (§0).** I could not read Settings `PAUSE` or run the PAUSE Gmail search, because live tools
are off for this test. On a real night I would stop here until I had checked both. WOULD WRITE (Log): `2026-10-31 SGT | crypto-protocol-engineer | pre-flight | PAUSE not
readable (tools off in holdout) | -`. Baseline on a scratch worktree of `origin/main` (8decb27, contains
fd9b992): `npx vitest run` gave **562 passed / 57 skipped (619)**, `tsc` clean [VERIFIED this run].

## 1. What happened in the transaction, log by log

Source: `fixtures/t1-router-receipt.json` (synthetic. The USDC contract and topic hashes are real, and every other address
and the hash are fictional). Receipt `status 0x1`. Block `0x15f8a2c` = **23,038,508**, timestamp `0x6addb70b`
= 2026-10-25 08:00:11 UTC (16:00:11 SGT). Head `0x15f8a54` = 23,038,548, so **40 confirmations**
(Clearline counts `head − block`, no +1, from `latest`). tx `from` = payer `0x7e57…a11ce5`, tx `to` =
router `0x9a7e…400e72`, selector `0x8a6b1d2f` (router function, not ERC-20 `transfer`). Gas 0x2a1f0 ×
1 gwei = 0.000172528 ETH fee, paid by the payer. [VERIFIED: decoded from the fixture this run]

| logIndex | Emitting contract | Event | From → To | Value (base units → amount) | What it is |
|---|---|---|---|---|---|
| 0x40 = 64 | `0xa0b8…eb48` **Circle USDC** | `Approval` (`0x8c5be1e5…`) | owner payer → spender router | 0 → 0 | An allowance record. It is **not a transfer** and moves no tokens. [ASSUMPTION] the router's flow resets or uses up the allowance. Logs alone can't show why. |
| 0x41 = 65 | `0x5ca1ab1e…c0ffee` **not USDC** (its `symbol()` says "USDC", 6 dp) | `Transfer` | router → **deposit** `0x4b1d…0d3905` | 5,000,000,000 → **5,000.000000 "USDC"** | **Counterfeit**. A contract that isn't Circle's emitted a Transfer event. It has no value, and any contract can emit this event with any `from`. |
| 0x42 = 66 | Circle USDC | `Transfer` | payer → router | 5,000,000,000 → 5,000.000000 USDC | Genuine. The payer funds the router (`transferFrom` under the allowance). |
| 0x43 = **67** | Circle USDC | `Transfer` | router → **deposit** | 4,990,000,000 → **4,990.000000 USDC** | **Genuine. This is the payment to the merchant.** |
| 0x44 = 68 | Circle USDC | `Transfer` | router → fee collector `0xfee0…0fee` | 10,000,000 → 10.000000 USDC | Router fee. |

**What the merchant actually received: 4,990.000000 genuine USDC at log index 67.** That is exactly
what their ledger credited as DEP-55120. Genuine flows balance: 5,000 in = 4,990 + 10 out. The invoice was
5,000 USDC, so the business is **10.000000 USDC short because of the router fee**. Whether to accept
it is the business's call. The 5,000 "USDC" at log 65 is worthless and must never be credited. It also
does not mean the customer sent anything fake: the customer's money is the genuine log 66.
The router (or a contract it called) made the counterfeit contract emit that event. Whether the router is
malicious, or was used to poison the deposit address's history, can't be told from this one receipt.
[ASSUMPTION]

Confirmations: 40 ≥ the 12-block sample setting, but that count is from `latest`, not `finalized`
(gap G1). ~8 minutes of blocks is not yet Ethereum finality (~2 epochs ≈ 12.8 min).

## 2. Root cause

`src/lib/engine/context.ts` `pickTransfer` (main, line 79-93) chooses "the" transfer for the case by
destination first, and then by **symbol text**: `exact = ["USDT","USDC"].includes(t.tokenSymbol)`,
then the first match in log order. Log 65 (counterfeit, symbol "USDC") comes before log 67 (genuine,
symbol "USDC"), so the counterfeit is picked. `buildContext` then sets `impersonation = true`
(contract ≠ the official `0xA0b8…eB48`), and `rules.ts` D06 fires High, before D13 in
`CATALOGUE_ORDER`. The same pick feeds `chain/investigate.ts` `freezeFacts`, which then finds that the
contract isn't official and **skips the issuer freeze check** (`freezeStatus: "not_supported"`). The
protocol fact this breaks: a token's `symbol()` is whatever its deployer wrote. The emitting contract
address is the token's identity (ERC-20 makes `symbol()` OPTIONAL and says nothing about uniqueness:
`ERCS/erc-20.md`).

## 3. Fix (scratch worktree `/tmp/claude-0/ho-cpe-run-1`, branch `eval/ho-cpe-1` from `origin/main`)

`pickTransfer(tx, facts, settings?)` gets an optional `settings`. Among the transfers to the
customer's (then the company's) address, it now prefers one emitted by a contract the settings name.
That means the issuer's official contract (`officialContractFor`, which also covers the BNB Chain
company-declared contract) or an accepted token. Only after that does it fall back to the old symbol
order. `buildContext`, `inferCustomer`, `freezeFacts` and `historyFacts` pass `settings`. Public
signatures of `fetchFacts`, `investigate` and `EvmFetcher` are unchanged. Callers that don't pass settings
get the old behaviour (a test pins this). A counterfeit alone still gets D06.

**Failing test first** (`tests/router-sibling.test.ts`, before the fix, on unmodified `src/`) [VERIFIED this run]:
```
× the genuine USDC transfer decides the case: D13 already credited, not D06
    AssertionError: expected 'D06' to be 'D13'
× the freeze check runs on the official USDC contract for the genuine transfer
    AssertionError: expected 'not_supported' to be 'checked'
× a frozen deposit address still surfaces as D09 on the genuine transfer
    AssertionError: expected 'D06' to be 'D09'
× with no ledger row, the genuine transfer is D12 confirmed-not-credited, never D06
    AssertionError: expected 'D06' to be 'D12'
× prefers the official contract over an earlier same-symbol counterfeit, in either log order
    AssertionError: expected { logIndex: 65, … } to be { logIndex: 67, … }
× genuine but not accepted USDC beside a counterfeit reads as D05 unsupported, not D06
    AssertionError: expected { logIndex: 65, … } to be { logIndex: 67, … }
Tests  6 failed | 5 passed (11)
```
(While writing the tests I also fixed two bugs in the tests themselves: a hand-built `Facts` without
`normaliseInput`, and an address compare that was case-sensitive. Neither was a product failure.)

The tests replay the receipt through the real `EvmFetcher` + `JsonRpcSource` + `ChainClient`, using a
transport that answers from the recorded JSON (offline and deterministic). The fixture was copied as
`tests/fixtures/synthetic/router-counterfeit-sibling.json`, labelled synthetic. They cover all four Transfer logs decoded and the
Approval skipped. They cover D13 High at 4,990.000000, and the freeze calls going to the official USDC contract for the router and
the deposit address. They cover the adversarial neighbours: a frozen deposit → D09, no ledger row → D12, either log order, a look-alike
"ÚЅDС" and fullwidth "ＵＳＤＣ" counterfeit, a counterfeit alone → still D06, a genuine transfer to a
non-company address doesn't beat ours, genuine-but-unaccepted USDC → D05 (not D06), and no settings → unchanged.

**Checks after the fix** [VERIFIED this run, worktree `/tmp/claude-0/ho-cpe-run-1`]:
- `npx vitest run tests/router-sibling.test.ts`: **11 passed (11)**
- `npx tsc --noEmit`: exit 0, no output
- `npx vitest run`: **Test Files 21 passed | 1 skipped; Tests 573 passed | 57 skipped (630)** (baseline 562 + 11 new)
- `npx next build`: exit 0, `✓ Compiled successfully in 11.8s`, `✓ Generating static pages (19/19)`
- Self-check greps (§6) on the diff: no forbidden chain/signing method, no secret pattern. Diff:
  4 files, +293 / −11 (code 37 lines; the rest is the test and the fixture).

## 4. WOULD OPEN PR (not opened)

**Title:** `fix(engine): pick the genuine-contract transfer when a counterfeit sibling goes to the same address (QA C-7781)`

**Body:**
```
## What and why
A payment-router tx to our deposit address carried two "USDC" Transfers: a counterfeit (contract
0x5ca1…c0ffee, log 65, 5,000) and Circle's USDC (0xa0b8…eb48, log 67, 4,990). pickTransfer chose by
symbol text and log order, so it picked the counterfeit: the case read D06 Fake token (High) and the
issuer freeze check was skipped. The contract address is a token's identity. symbol() is
deployer-chosen (ERC-20: symbol is OPTIONAL). pickTransfer now prefers the official/accepted contract
among transfers to our address, then falls back to the old symbol order.
Closes: QA report 2026-10-30 23:05 SGT, case C-7781 / INV-5120 (no roadmap row yet: WOULD ADD a `bug` row).

## How it was tested
- Failing test first: `tests/router-sibling.test.ts › the genuine USDC transfer decides the case: D13
  already credited, not D06` failed with `expected 'D06' to be 'D13'`. 6 of 11 new tests failed before
  the change, including `expected 'not_supported' to be 'checked'` for the freeze check.
- Added: replay of the router receipt through EvmFetcher/JsonRpcSource (offline), D13/D12/D09 on the
  genuine transfer, freeze calls on the official contract, either log order, look-alike and fullwidth
  symbols, counterfeit-alone still D06, genuine-but-unaccepted → D05, no-settings callers unchanged.
- `npx tsc --noEmit` ✔  `npx vitest run` ✔ (573 passed, 57 skipped)  `npx next build` ✔   (all seen this run)

## Protocol and security notes
- Read-only: no new chain method, no signer, no key handling (grep clean).
- Unknown facts: unchanged. Lookup errors still pause; a failed freeze call still blocks D02/D12.
- Chains/tokens: all. Identity = emitting contract vs Settings.officialContracts / acceptedTokens.
  Decimals: from the genuine contract (6). Finality: unchanged (latest-based count, gap G1).
- Signatures: pickTransfer gains an optional `settings`. fetchFacts, investigate and EvmFetcher are unchanged.

## What Aashmiin should check
1. Re-run the C-7781 case: it should read "Already credited" (DEP-55120, 4,990.000000 USDC).
2. A tx with only a counterfeit "USDC" to a deposit address still reads "Fake token".

## Not done / follow-ups
- The counterfeit sibling is no longer mentioned on the case page. Follow-up: an evidence row or
  Medium finding "this tx also carried a non-genuine <symbol> Transfer to your address", worded so it
  doesn't win over the verdict (D06 is High and comes before D13 in CATALOGUE_ORDER, so it can't simply
  be attached as D06).
- companyTransferCount still counts the counterfeit, so a ledger row with no transfer index would match
  as "ambiguous" (Medium) here. That is conservative. I would count only known-contract transfers in a follow-up.
- Invoice shortfall (5,000 asked, 4,990 received, 10 USDC router fee) is a payments/requests matter.
  The deposit desk has no invoice. Check that the requests flow shows it as short, not paid.
- Knowledge pack: add this to attack-patterns A3/A4 ("counterfeit sibling in a router tx") in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j
```
WOULD commit as `Aashmiin Kaur <aashmiin@gmail.com>`, message ending with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
`Claude-Session: https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j`. WOULD push `fix/router-counterfeit-sibling`
(never `main`) and open the PR with `gh api repos/trysarathy/investigation-desk/pulls -X POST`.

## 5. Reply QA should give support (for this case)

> The "Fake token" label on C-7781 was our error, not the customer's. Their payment went through a
> payment router. That transaction contains a genuine USDC transfer of **4,990.000000 USDC** to your deposit
> address (log index 67, Circle's USDC contract). This is the amount your ledger credited as DEP-55120,
> and it is correct. The same transaction also contains an unrelated, worthless token that calls
> itself "USDC" (5,000, from a different contract). Our tool wrongly read that one as the payment. A fix is in
> review. Please do **not** flag the customer to compliance or call this a scam. Nothing needs to change
> in your ledger. Separately, invoice INV-5120 was for 5,000 USDC and 4,990 arrived: the router took a
> 10 USDC fee. Whether to ask the customer for the 10 USDC or write it off is your decision. Never credit the 5,000
> "USDC" token: it is not USDC.

(Internal note for QA only: the counterfeit log in a router tx is worth a look at the router address
`0x9a7e…400e72` for poisoning patterns. It is not grounds to treat the customer as a scammer.)

## Log rows (WOULD WRITE)
- `2026-10-31 SGT | crypto-protocol-engineer | investigated QA report C-7781 | INV-5120, DEP-55120 | cause: pickTransfer picks by symbol; counterfeit sibling log 65 chosen over genuine log 67`
- `2026-10-31 SGT | crypto-protocol-engineer | WOULD open PR fix/router-counterfeit-sibling | QA C-7781 | (not opened: holdout)`
- No `RISK:` row: nothing was credited or posted wrongly (the ledger credited the genuine 4,990). The
  wrong label could have harmed a customer relationship, so it goes in the briefing note.

## Full diff (`git add -A` in the worktree, `git diff --cached origin/main`)
```diff
diff --git a/src/lib/chain/investigate.ts b/src/lib/chain/investigate.ts
index 01194b8..a77ed7e 100644
--- a/src/lib/chain/investigate.ts
+++ b/src/lib/chain/investigate.ts
@@ -74,7 +74,7 @@ export async function fetchFacts(rawInput: string, ws: Workspace, deps: LiveDeps
     currentBlock: found?.currentBlock,
   };
   const extra: RawResponse[] = [];
-  if (found?.tx && !facts.customerId) Object.assign(facts, inferCustomer(found.tx, facts));
+  if (found?.tx && !facts.customerId) Object.assign(facts, inferCustomer(found.tx, facts, settings));
   if (found?.tx) {
     Object.assign(facts, await freezeFacts(found.tx, facts, settings, deps, extra));
     Object.assign(facts, await historyFacts(found.tx, facts, settings, deps, extra));
@@ -105,8 +105,8 @@ export async function lookupOne(chain: Chain, hash: string, deps: LiveDeps, raws
  * A pasted hash has no customer. File A says who held the destination when the transfer was
  * mined; that company record names the case's customer. No owner at that time, no inference.
  */
-function inferCustomer(tx: ChainTx, facts: Facts): Pick<Facts, "customerId" | "customerInferredFromRow"> | object {
-  const transfer = pickTransfer(tx, facts);
+function inferCustomer(tx: ChainTx, facts: Facts, settings: Settings): Pick<Facts, "customerId" | "customerInferredFromRow"> | object {
+  const transfer = pickTransfer(tx, facts, settings);
   if (!transfer) return {};
   const t = Date.parse(tx.blockTime);
   const owner = facts.depositAddresses.find((r) => r.chain === tx.chain && sameAddress(r.address, transfer.to) &&
@@ -117,7 +117,7 @@ function inferCustomer(tx: ChainTx, facts: Facts): Pick<Facts, "customerId" | "c
 /** D09: ask the issuer's own contract whether sender or destination is frozen, read-only. */
 async function freezeFacts(tx: ChainTx, facts: Facts, settings: Settings, deps: LiveDeps, raws: RawResponse[]):
   Promise<Pick<Facts, "freezes" | "freezeStatus">> {
-  const transfer = pickTransfer(tx, facts);
+  const transfer = pickTransfer(tx, facts, settings);
   const token = transfer?.tokenSymbol as Token | undefined;
   const resolved = token && token in FREEZE_SELECTOR ? officialContractFor(tx.chain, token, settings) : undefined;
   // Only the genuine issuer contract can say an address is frozen. On BNB Chain the official
@@ -150,7 +150,7 @@ async function freezeFacts(tx: ChainTx, facts: Facts, settings: Settings, deps:
  */
 async function historyFacts(tx: ChainTx, facts: Facts, settings: Settings, deps: LiveDeps, raws: RawResponse[]):
   Promise<Pick<Facts, "senderHistory" | "senderHistoryStatus">> {
-  const transfer = pickTransfer(tx, facts);
+  const transfer = pickTransfer(tx, facts, settings);
   if (!transfer) return { senderHistory: [] };
   const isCompany = facts.depositAddresses.some((r) => sameAddress(r.address, transfer.to));
   const mine = facts.depositAddresses.filter((r) => r.customerId === facts.customerId);
diff --git a/src/lib/engine/context.ts b/src/lib/engine/context.ts
index e08a207..603dca6 100644
--- a/src/lib/engine/context.ts
+++ b/src/lib/engine/context.ts
@@ -76,20 +76,35 @@ export function asDepositChain(chain: string): DepositChain | undefined {
   return (DEPOSIT_CHAINS as string[]).includes(chain) ? (chain as DepositChain) : undefined;
 }
 
-export function pickTransfer(tx: ChainTx, facts: Facts): TokenTransfer | undefined {
+/**
+ * True when the transfer was emitted by a contract the settings name: the issuer's official
+ * contract (or the company-declared one on BNB Chain) or an accepted token on that chain.
+ */
+function knownContract(tx: ChainTx, t: TokenTransfer, settings: Settings): boolean {
+  if (TOKENS.some((tok) => { const o = officialContractFor(tx.chain, tok, settings); return !!o && sameAddress(o.contract, t.tokenContract); })) return true;
+  const chain = asDepositChain(tx.chain);
+  return !!chain && settings.acceptedTokens[chain].some((a) => sameAddress(a.contract, t.tokenContract));
+}
+
+export function pickTransfer(tx: ChainTx, facts: Facts, settings?: Settings): TokenTransfer | undefined {
   const { transfers } = tx;
   if (transfers.length === 0) return undefined;
   const isCustomers = (to: string) =>
     facts.depositAddresses.some((r) => sameAddress(r.address, to) && r.customerId === facts.customerId);
   const isCompany = (to: string) => facts.depositAddresses.some((r) => sameAddress(r.address, to));
   // Batch payouts carry many Transfer events; the one that concerns us is the one to our address.
-  // Within those, a stablecoin (or a token claiming to be one) beats e.g. WETH routed through the
-  // same address in a swap (real-data test: an MEV-style tx sent WETH, USDC and USDT to one address).
+  // Within those, the contract address decides first: a router tx can carry a counterfeit "USDC"
+  // Transfer to our address beside the genuine one (case C-7781), and anyone can deploy a token
+  // whose symbol() says "USDC". Then a stablecoin symbol (or one claiming to be) beats e.g. WETH
+  // routed through the same address in a swap (real-data test: an MEV-style tx sent WETH, USDC and
+  // USDT to one address). Without settings the contract can't be judged, so that step is skipped.
+  const known = (t: TokenTransfer) => !!settings && knownContract(tx, t, settings);
   const exact = (t: TokenTransfer) => ["USDT", "USDC"].includes(t.tokenSymbol);
   const stable = (t: TokenTransfer) => ["USDT", "USDC"].includes(claimedSymbol(t.tokenSymbol));
   const pick = (ok: (to: string) => boolean) =>
-    transfers.find((t) => ok(t.to) && exact(t)) ?? transfers.find((t) => ok(t.to) && stable(t)) ?? transfers.find((t) => ok(t.to));
-  return pick(isCustomers) ?? pick(isCompany) ?? transfers.find(stable) ?? transfers[0];
+    transfers.find((t) => ok(t.to) && known(t)) ?? transfers.find((t) => ok(t.to) && exact(t)) ??
+    transfers.find((t) => ok(t.to) && stable(t)) ?? transfers.find((t) => ok(t.to));
+  return pick(isCustomers) ?? pick(isCompany) ?? transfers.find(known) ?? transfers.find(stable) ?? transfers[0];
 }
 
 /**
@@ -153,7 +168,7 @@ export function isPoisoning(p: PriorTransfer, payment: TokenTransfer, settings:
 
 export function buildContext(facts: Facts, settings: Settings): Ctx {
   const tx = facts.tx;
-  const transfer = tx ? pickTransfer(tx, facts) : undefined;
+  const transfer = tx ? pickTransfer(tx, facts, settings) : undefined;
   const depositChain = tx ? asDepositChain(tx.chain) : undefined;
   const customerAddresses = facts.depositAddresses.filter((r) => r.customerId === facts.customerId);
 
diff --git a/tests/fixtures/synthetic/router-counterfeit-sibling.json b/tests/fixtures/synthetic/router-counterfeit-sibling.json
new file mode 100644
index 0000000..17b3f02
--- /dev/null
+++ b/tests/fixtures/synthetic/router-counterfeit-sibling.json
@@ -0,0 +1,116 @@
+{
+ "_note": "SYNTHETIC (fictional) router payment with a counterfeit sibling Transfer. Real: the Ethereum USDC contract 0xa0b8...eb48 and the Transfer/Approval topic hashes. Fictional: every other address, the tx hash and block numbers. Source: QA report on case C-7781 / INV-5120 (holdout T1).",
+ "chain": "ethereum",
+ "hash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+ "addresses": {
+  "usdc": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
+  "fakeUsdc": "0x5ca1ab1e00000000000000000000000000c0ffee",
+  "payer": "0x7e57000000000000000000000000000000a11ce5",
+  "router": "0x9a7e000000000000000000000000000000400e72",
+  "deposit": "0x4b1d0000000000000000000000000000000d3905",
+  "feeCollector": "0xfee0000000000000000000000000000000000fee"
+ },
+ "rpc": {
+  "eth_getTransactionByHash": {
+   "hash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+   "blockNumber": "0x15f8a2c",
+   "from": "0x7e57000000000000000000000000000000a11ce5",
+   "to": "0x9a7e000000000000000000000000000000400e72",
+   "gasPrice": "0x3b9aca00",
+   "input": "0x8a6b1d2f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
+   "value": "0x0",
+   "nonce": "0x2a"
+  },
+  "eth_getTransactionReceipt": {
+   "transactionHash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+   "blockNumber": "0x15f8a2c",
+   "from": "0x7e57000000000000000000000000000000a11ce5",
+   "to": "0x9a7e000000000000000000000000000000400e72",
+   "status": "0x1",
+   "gasUsed": "0x2a1f0",
+   "effectiveGasPrice": "0x3b9aca00",
+   "logs": [
+    {
+     "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
+     "topics": [
+      "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
+      "0x0000000000000000000000007e57000000000000000000000000000000a11ce5",
+      "0x0000000000000000000000009a7e000000000000000000000000000000400e72"
+     ],
+     "data": "0x0000000000000000000000000000000000000000000000000000000000000000",
+     "blockNumber": "0x15f8a2c",
+     "transactionHash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+     "logIndex": "0x40",
+     "removed": false
+    },
+    {
+     "address": "0x5ca1ab1e00000000000000000000000000c0ffee",
+     "topics": [
+      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
+      "0x0000000000000000000000009a7e000000000000000000000000000000400e72",
+      "0x0000000000000000000000004b1d0000000000000000000000000000000d3905"
+     ],
+     "data": "0x000000000000000000000000000000000000000000000000000000012a05f200",
+     "blockNumber": "0x15f8a2c",
+     "transactionHash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+     "logIndex": "0x41",
+     "removed": false
+    },
+    {
+     "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
+     "topics": [
+      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
+      "0x0000000000000000000000007e57000000000000000000000000000000a11ce5",
+      "0x0000000000000000000000009a7e000000000000000000000000000000400e72"
+     ],
+     "data": "0x000000000000000000000000000000000000000000000000000000012a05f200",
+     "blockNumber": "0x15f8a2c",
+     "transactionHash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+     "logIndex": "0x42",
+     "removed": false
+    },
+    {
+     "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
+     "topics": [
+      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
+      "0x0000000000000000000000009a7e000000000000000000000000000000400e72",
+      "0x0000000000000000000000004b1d0000000000000000000000000000000d3905"
+     ],
+     "data": "0x00000000000000000000000000000000000000000000000000000001296d5b80",
+     "blockNumber": "0x15f8a2c",
+     "transactionHash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+     "logIndex": "0x43",
+     "removed": false
+    },
+    {
+     "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
+     "topics": [
+      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
+      "0x0000000000000000000000009a7e000000000000000000000000000000400e72",
+      "0x000000000000000000000000fee0000000000000000000000000000000000fee"
+     ],
+     "data": "0x0000000000000000000000000000000000000000000000000000000000989680",
+     "blockNumber": "0x15f8a2c",
+     "transactionHash": "0x0000000071d2a0e5c4b0f0b1c0de5e7a11f1c71e0000000000000000000ce001",
+     "logIndex": "0x44",
+     "removed": false
+    }
+   ]
+  },
+  "eth_getBlockByNumber": {
+   "number": "0x15f8a2c",
+   "timestamp": "0x6addb70b"
+  },
+  "eth_blockNumber": "0x15f8a54"
+ },
+ "tokens": {
+  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
+   "symbol": "USDC",
+   "decimals": 6
+  },
+  "0x5ca1ab1e00000000000000000000000000c0ffee": {
+   "symbol": "USDC",
+   "decimals": 6
+  }
+ }
+}
diff --git a/tests/router-sibling.test.ts b/tests/router-sibling.test.ts
new file mode 100644
index 0000000..d77989b
--- /dev/null
+++ b/tests/router-sibling.test.ts
@@ -0,0 +1,151 @@
+// A payment router's tx can carry a counterfeit "USDC" Transfer to our deposit address next to the
+// genuine one (case C-7781, INV-5120). Contract address is identity: the genuine transfer is the
+// payment; the counterfeit sibling must not decide the verdict. Fixture is synthetic (fictional
+// addresses and hash; the USDC contract and topic hashes are real).
+import { describe, expect, it, vi } from "vitest";
+import fixture from "./fixtures/synthetic/router-counterfeit-sibling.json";
+import { EvmFetcher, JsonRpcSource, jsonRpcClassifyBody } from "@/lib/chain/evm";
+import { ChainClient, type HttpRequest } from "@/lib/chain/http";
+import { fetchFacts } from "@/lib/chain/investigate";
+import { MemoryStore } from "@/lib/chain/store";
+import type { TronFetcher } from "@/lib/chain/tron";
+import { pickTransfer } from "@/lib/engine/context";
+import { investigate } from "@/lib/engine/run";
+import { normaliseInput } from "@/lib/normalise";
+import { SAMPLE_SETTINGS } from "@/lib/fixtures";
+import { REQUEST_SETTINGS } from "@/lib/requests/check";
+import type { ChainTx, Facts, LedgerRow, Settings, TokenTransfer } from "@/lib/types";
+
+const A = fixture.addresses;
+const HASH = fixture.hash;
+const word = (n: number | bigint) => n.toString(16).padStart(64, "0");
+const abiString = (s: string) => `0x${word(32)}${word(s.length)}${Buffer.from(s).toString("hex").padEnd(64, "0")}`;
+
+/** Answers JSON-RPC calls from the recorded fixture; eth_call by (contract, selector). */
+function replay(blacklisted = false) {
+  const calls: { method: string; params: unknown[] }[] = [];
+  const answer = (method: string, params: unknown[]): unknown => {
+    const rpc = fixture.rpc as Record<string, unknown>;
+    if (method !== "eth_call") return rpc[method];
+    const { to, data } = params[0] as { to: string; data: string };
+    const meta = (fixture.tokens as Record<string, { symbol: string; decimals: number }>)[to.toLowerCase()];
+    if (data === "0x95d89b41" && meta) return abiString(meta.symbol);
+    if (data === "0x313ce567" && meta) return `0x${word(meta.decimals)}`;
+    if (data.startsWith("0xfe575a87") && to.toLowerCase() === A.usdc) return `0x${word(blacklisted ? 1 : 0)}`;
+    return undefined;
+  };
+  const client = new ChainClient({
+    source: "public-rpc", minIntervalMs: 0, store: new MemoryStore(), classifyBody: jsonRpcClassifyBody,
+    now: () => new Date("2026-10-30T15:05:00Z"),
+    transport: async (req: HttpRequest) => {
+      const { method, params } = JSON.parse(req.body!);
+      calls.push({ method, params });
+      return { status: 200, headers: {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: answer(method, params) ?? null }) };
+    },
+  });
+  const evm = new EvmFetcher({ ethereum: new JsonRpcSource(client, "https://rpc.example.invalid", "ethereum") });
+  const tron = { lookup: vi.fn().mockResolvedValue({ lookup: { chain: "tron", result: "not_found", fetchedAt: "", sourceUrl: "", rawBody: "" } }) } as unknown as TronFetcher;
+  return { deps: { tron, evm, now: () => new Date("2026-10-30T15:05:00Z") }, calls };
+}
+
+const LEDGER: LedgerRow = {
+  row: 2, depositId: "DEP-55120", txHash: HASH, chain: "ethereum", token: "USDC", toAddress: A.deposit,
+  amount: "4990.000000", status: "CREDITED", creditedAt: "2026-10-30T15:00:00Z", customerId: "C-7781", transferIndex: 67,
+};
+const workspace = (ledger: LedgerRow[] = [LEDGER]) => ({
+  customerId: "C-7781",
+  depositAddresses: [{ row: 2, address: A.deposit, chain: "ethereum" as const, customerId: "C-7781", assignedAt: "2026-01-01T00:00:00Z" }],
+  ledger, ledgerUploadedAt: "2026-10-30T15:01:00Z",
+});
+
+describe("router tx with a counterfeit sibling transfer (case C-7781)", () => {
+  it("decodes all four Transfer logs and skips the Approval", async () => {
+    const { deps } = replay();
+    const facts = await fetchFacts(HASH, workspace(), deps, REQUEST_SETTINGS);
+    expect(facts.tx!.transfers.map((t) => [t.logIndex, t.tokenContract, t.from, t.to, t.amount])).toEqual([
+      [65, A.fakeUsdc, A.router, A.deposit, "5000.000000"],
+      [66, A.usdc, A.payer, A.router, "5000.000000"],
+      [67, A.usdc, A.router, A.deposit, "4990.000000"],
+      [68, A.usdc, A.router, A.feeCollector, "10.000000"],
+    ]);
+  });
+
+  it("the genuine USDC transfer decides the case: D13 already credited, not D06", async () => {
+    const { deps } = replay();
+    const v = investigate(await fetchFacts(HASH, workspace(), deps, REQUEST_SETTINGS), REQUEST_SETTINGS);
+    expect(v.code).toBe("D13");
+    expect(v.confidence).toBe("High");
+    expect(v.fill.amount).toBe("4990.000000");
+    expect(v.checks.find((c) => c.code === "D06")!.matched).toBe(false);
+  });
+
+  it("the freeze check runs on the official USDC contract for the genuine transfer", async () => {
+    const { deps, calls } = replay();
+    const facts = await fetchFacts(HASH, workspace(), deps, REQUEST_SETTINGS);
+    expect(facts.freezeStatus).toBe("checked");
+    expect(facts.freezes.map((f) => [f.role, f.address])).toEqual([["sender", A.router], ["deposit", A.deposit]]);
+    const freezeCalls = calls.filter((c) => c.method === "eth_call" && (c.params[0] as { data: string }).data.startsWith("0xfe575a87"));
+    expect(freezeCalls.map((c) => (c.params[0] as { to: string }).to.toLowerCase())).toEqual([A.usdc, A.usdc]);
+  });
+
+  it("a frozen deposit address still surfaces as D09 on the genuine transfer", async () => {
+    const { deps } = replay(true);
+    const v = investigate(await fetchFacts(HASH, workspace(), deps, REQUEST_SETTINGS), REQUEST_SETTINGS);
+    expect(v.code).toBe("D09");
+  });
+
+  it("with no ledger row, the genuine transfer is D12 confirmed-not-credited, never D06", async () => {
+    const { deps } = replay();
+    const v = investigate(await fetchFacts(HASH, workspace([]), deps, REQUEST_SETTINGS), REQUEST_SETTINGS);
+    expect(v.code).toBe("D12");
+    expect(v.fill.amount).toBe("4990.000000");
+  });
+});
+
+describe("pickTransfer: contract address is identity, symbol is not", () => {
+  const usdc = REQUEST_SETTINGS.officialContracts.ethereum!.USDC!.toLowerCase();
+  const fake = "0x5ca1ab1e00000000000000000000000000c0ffee";
+  const deposit = "0x4b1d0000000000000000000000000000000d3905";
+  const t = (logIndex: number, tokenContract: string, tokenSymbol: string, amount: string, to = deposit): TokenTransfer =>
+    ({ logIndex, tokenContract, tokenSymbol, from: "0x9a7e000000000000000000000000000000400e72", to, amount });
+  const tx = (transfers: TokenTransfer[]): ChainTx =>
+    ({ chain: "ethereum", hash: "ab".repeat(32), status: "success", blockNumber: 100, blockTime: "2026-10-30T00:00:00Z", isBatch: true, transfers });
+  const facts = { customerId: "C-1", depositAddresses: [{ row: 2, address: deposit, chain: "ethereum", customerId: "C-1", assignedAt: "2026-01-01T00:00:00Z" }] } as unknown as Facts;
+
+  it("prefers the official contract over an earlier same-symbol counterfeit, in either log order", () => {
+    const genuine = t(67, usdc, "USDC", "4990.000000");
+    expect(pickTransfer(tx([t(65, fake, "USDC", "5000.000000"), genuine]), facts, REQUEST_SETTINGS)).toBe(genuine);
+    expect(pickTransfer(tx([genuine, t(68, fake, "USDC", "5000.000000")]), facts, REQUEST_SETTINGS)).toBe(genuine);
+  });
+
+  it("prefers it over a look-alike symbol counterfeit and over a fullwidth one", () => {
+    const genuine = t(3, usdc, "USDC", "10.000000");
+    expect(pickTransfer(tx([t(1, fake, "ÚЅDС", "10.000000"), t(2, fake, "ＵＳＤＣ", "10.000000"), genuine]), facts, REQUEST_SETTINGS)).toBe(genuine);
+  });
+
+  it("a counterfeit alone is still picked, so D06 still fires", () => {
+    const only = t(65, fake, "USDC", "5000.000000");
+    expect(pickTransfer(tx([only]), facts, REQUEST_SETTINGS)).toBe(only);
+    const f = { ...facts, input: normaliseInput("ab".repeat(32)), checkedAt: "2026-10-30T01:00:00Z", lookups: [], freezes: [], freezeStatus: "not_supported",
+      senderHistory: [], ledger: [], ledgerUploadedAt: "", rawResponses: [], tx: tx([only]), currentBlock: 200 } as unknown as Facts;
+    expect(investigate(f, REQUEST_SETTINGS).code).toBe("D06");
+  });
+
+  it("the transfer to our address still beats a genuine transfer elsewhere in the tx", () => {
+    const ours = t(65, fake, "USDC", "5000.000000");
+    expect(pickTransfer(tx([t(64, usdc, "USDC", "5000.000000", "0x" + "7".repeat(40)), ours]), facts, REQUEST_SETTINGS)).toBe(ours);
+  });
+
+  it("genuine but not accepted USDC beside a counterfeit reads as D05 unsupported, not D06", async () => {
+    const settings: Settings = SAMPLE_SETTINGS; // accepts only USDT on Ethereum
+    const genuine = t(67, usdc, "USDC", "4990.000000");
+    expect(pickTransfer(tx([t(65, fake, "USDC", "5000.000000"), genuine]), facts, settings)).toBe(genuine);
+    const { deps } = replay();
+    expect(investigate(await fetchFacts(HASH, workspace([]), deps, settings), settings).code).toBe("D05");
+  });
+
+  it("without settings (older callers) the choice is unchanged", () => {
+    const first = t(65, fake, "USDC", "5000.000000");
+    expect(pickTransfer(tx([first, t(67, usdc, "USDC", "4990.000000")]), facts)).toBe(first);
+  });
+});
```
