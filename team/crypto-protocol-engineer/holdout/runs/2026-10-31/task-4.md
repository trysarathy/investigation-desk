# T4: Base USDC, two providers, one answer (Larkspur Studio, INV-3310)

Run: 2026-10-31 (SGT), crypto-protocol-engineer, holdout H1. Pre-flight: PAUSE not readable (tools off).
Code results below come from replaying the fixture through `fetchFacts` + `investigate` on `origin/main`
(8decb27; src identical to fd9b992), in a scratch worktree probe that was not committed and has been removed [VERIFIED this run].
Larkspur is a designer's demo customer (fictional).

## 1. What was paid, and what `main` concludes

**What was actually paid** (provider A raw responses) [VERIFIED: decoded this run]:
- tx `0x00000000ba5e…0d04`, Base block `0x32bed57` = **53,210,455**, time `0x6ae3a8e1` = 2026-10-29
  20:13:21 UTC. Receipt `status 0x1`, one log, `logIndex 3`.
- Emitting contract **`0xd9aA…b6CA` = USDbC** (symbol `USDbC`, 6 decimals, `isBlacklisted` reverts, per the
  fixture's note from the examiner's live check on 31 Oct; I did not re-run it). This is **not**
  Circle's native USDC on Base, `0x8335…2913` (symbol `USDC`, `isBlacklisted` answers) [VERIFIED on-chain
  2026-10-29 in `erc20-trc20.md` §4; that Circle *lists* 0x8335 is still ASSUMPTION, because developers.circle.com
  was blocked]. USDbC is the bridged "USD Base Coin", not issued by Circle [ASSUMPTION: public
  descriptions, not opened this run].
- Transfer `0x0b5e…a11ce0` → **`0x4b1d…ba5e001`**, `0x9502f900` = 2,500,000,000 / 10^6 = **2,500.000000 USDbC**.
  The tx input is `transfer(address,uint256)` straight to the USDbC contract, and it agrees with the log.
- Depth: provider A head 53,210,477 (22 blocks on top). `safe` 53,210,459 ≥ tx block, so the tx is **safe**. `finalized`
  53,209,845 < tx block, so it is **not yet finalized** (610 blocks ≈ 20 min behind at 2 s blocks).
- Workspace: `0x4b1d…ba5e001` is registered **on Ethereum only** (row 2, C-4410).

So Larkspur was asked for "2,500.00 USDC on Base" and paid **2,500.000000 USDbC on Base** to an address
that the business has only registered on Ethereum. That is the right amount in the wrong token (a bridged
token, not Circle's USDC), on a chain the business never set up. Whether the business can use funds at
that address on Base depends on whether it is an EOA whose key they hold (yes in principle) or a contract
wallet/exchange address (maybe not) (`address-formats.md`).

**Provider A on `main`: D04 Wrong network, High**, reason "Sent on base; address is registered on
ethereum." [VERIFIED by replay]. How the code gets there:
- `chain/investigate.ts fetchFacts` looks the hash up on all 7 chains. Base answers via `JsonRpcSource`
  (`chain/sources.ts`: public RPC for Base).
- `engine/context.ts buildContext`: `asDepositChain("base")` is undefined (`types.ts DEPOSIT_CHAINS =
  tron, ethereum, bsc`). `addrOnTxChain` filters rows by `r.chain === tx.chain`, which gives none, so
  `addrOtherChain` = the Ethereum row.
- `rules.ts D04` hits High. **D06 is silent**: `claimedSymbol("USDbC")` = "USDBC", which doesn't claim USDC, and
  there is no Base official contract anyway. **D09** is "No confirmed issuer contract to ask on this chain and
  token" (`freezeFacts` returns `not_supported`). **D05** is skipped (not a company address on this chain).
- So the case page never says that the token is USDbC and not USDC. The D04 next step (keys held on other
  chains) is right as far as it goes, but it leaves out the token fact.

**Provider B alone on `main`: D01 Not found on any chain, High**, "Not found on any of 7 chains."
[VERIFIED by replay, with the other chains answering `null`]. `chain/evm.ts EvmFetcher.lookup` turns
`result: null` into `not_found` (`if (!tx) return … "not_found"`). It doesn't compare the provider's head
(`0x32bed34` = 53,210,420) with anything. **B's head is 35 blocks below the block the tx is in**: B hadn't
seen that block yet, so its `null` is not evidence of absence. `rules.ts D01` then says "not found" with High
confidence. The next step tells the customer to find the right hash, which is a confident wrong answer to a
payer who did pay. This is an unknown treated as a negative fact (A8 / G9).

## 2. Review of the PM's settings change

`officialContracts.base.USDC = 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`, "copied from the token list
in our wallet app". **Request changes. Do not merge.**
1. **Wrong contract.** That is USDbC (bridged), not Circle's USDC. Its own `symbol()` says `USDbC`, and
   `isBlacklisted` reverts, so it has no Circle freeze control. Circle's native USDC on Base is
   `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (on-chain: `USDC`, 6 dp, `isBlacklisted` answers
   [VERIFIED 2026-10-29, pack]). I will not paste even that into settings until it has been read from Circle's own page.
2. **Wrong source.** An official contract may only come from the issuer's page (Circle: developers.circle.com
   USDC contract addresses), recorded with URL and date, then checked on-chain at two providers
   (agent "Never" list, playbook §3.1). A wallet app's token list is an aggregator.
3. **What it would do** [VERIFIED by replay with the PM settings]: nothing for this USDbC payment (still
   D04, because USDbC doesn't claim the USDC symbol). But a **genuine native USDC** payment on Base now gets
   **"D06: Symbol USDC, contract differs from the official one"**. Once Base addresses are registered,
   that becomes the verdict: real Circle USDC labelled **Fake token**, "flag to compliance as a possible
   scam". D09 would also try `isBlacklisted` on a contract that reverts, so the freeze check silently stops working.
4. **It doesn't make Base a deposit chain anyway.** `officialContracts` is the only key it touches. Base is
   not in `DepositChain`, `acceptedTokens`, `confirmations` or `minimums`, so D02/D12 can't apply, and every
   payment to a Base address reads as D04/D07.
5. No decimals pin (G6), no finality policy, no provenance note.

## 3. Design: Base as a USDC deposit chain (sequence of small PRs)

**Before any code: verify on-chain and at the source** (all read-only):
- Open Circle's USDC contract-address page and record URL + date for Base → expect `0x8335…2913`. If
  it can't be opened: stop, `needs decision`. Never from memory.
- At **two** providers (mainnet.base.org + one keyed node provider, under Aashmiin's spend decision), `eth_call` on 0x8335:
  `symbol()` `0x95d89b41` = "USDC", `name()`, `decimals()` `0x313ce567` = 6, `isBlacklisted(0x0)` `0xfe575a87`
  answers false, `paused()` `0x5c975abb` = false. Record that it's an upgradeable proxy (re-check on
  implementation change). Same calls on USDbC 0xd9aA, to pin it as "bridged, no issuer freeze".
- Read `eth_chainId` = `0x2105` (8453). Measure `latest`/`safe`/`finalized` lags on both providers.
- Record real fixtures (`scripts/record-live.ts` pattern, keys redacted): a genuine native USDC transfer, a
  USDbC transfer, a failed tx, a counterfeit "USDC", a not-found hash, and a wrong-network case.

**PR 1: config + types (< 200 lines).** `DepositChain` += `base`; `DEPOSIT_CHAINS`, `acceptedTokens.base`,
`minimums.base`, `confirmations.base`, `pendingWindowSec`/`blockTimeSec` already exist. Set
`officialContracts.base.USDC = 0x8335…` with a source/date comment. Add **pinned decimals** per official
contract (`expectedDecimals`), failing closed: a mismatch makes the amount unknown, so the case pauses (closes G6 for
Base). File A/B accept `base` rows (EIP-55 via `checkAddress`). A Base address must be registered *for
Base*, never inferred from an Ethereum row. Tests: settings validation; D06 for a counterfeit "USDC" on Base;
genuine 0x8335 → not D06; USDbC → D05 "unsupported token" with the reason "USDbC is bridged USDC, not
issued by Circle"; a decimals mismatch → unknown, never a number; D04 for Base↔Ethereum address mismatch.

**PR 2: finality gate (< 250 lines).** `EvmFetcher` reads `eth_getBlockByNumber("safe"|"finalized")`.
Facts carry `safeBlock`/`finalizedBlock`. Policy: show "confirmed" at `safe`, and allow D12 "creditable",
auto-mark-paid and "Approve and post" only when tx block ≤ `finalized` (OP Stack: L1 data finalized,
~20-30 min; `finality-reorgs.md`). A block count from `latest` never stands in on an L2. An unreadable tag means
unknown, so the case pauses. Do not cache the tx/receipt/block forever until it is ≤ finalized (part of G2). Tests:
safe-but-not-finalized (this fixture: 53,210,455 between safe 53,210,459 and finalized 53,209,845) →
confirming, not creditable; finalized → D12; tag error → paused.

**PR 3: two providers and disagreement (< 250 lines).** A second Base source. A `null` tx is `not_found` only if
that provider's head ≥ the other provider's head (or ≥ a known tx block). **This fixture's B (head 35
blocks below the tx block) → "lagging", ignored, and the answer comes from A with a "single source" note.** Found on A
and null on B while B's head ≥ A's block means **disagreement**: paused for review, both raw bodies
attached. Before anything irreversible, both must agree on `blockHash`, `status` and the Transfer log (contract, from,
to, value). Head sanity: a provider more than N blocks behind is stale. Also fix the general bug the replay
exposed: D01 "not found" must not be High when any provider's head is behind the others or unknown. Tests:
exactly fixture A+B (→ found, single-source), B alone (→ paused, not D01), a mismatching log (→ paused),
both agree (→ creditable at finality).

**PR 4: issuer checks on Base (< 150 lines).** D09: `isBlacklisted` on 0x8335 for sender and deposit (Circle
blocks transfers to *and* from blacklisted addresses, so a frozen party means a reverted tx: D03 + D09).
USDbC → `not_supported` "no issuer freeze function", never "not frozen". `paused()` banner (G7). Tests per
case, plus a call error → unknown.

**PR 5: payment requests on Base (EIP-681) (< 250 lines).** Requests are Ethereum-only today
(`REQUEST_CHAIN`, `LiveHashProvider`, `present.ts eip681` hard-codes `@1` and `USDC_DECIMALS`). Add a request
chain field, the URI `ethereum:0x8335…2913@8453/transfer?address=<deposit>&uint256=<base units from pinned
decimals>`, `@chainId` always present (ERC-681: without it the wallet's current network is used). The page
text says "Base network, Circle USDC, contract 0x8335…". The live lookup records Base observations. Tests: URI exact
string; amount `2500.00` → `2500000000`; a USDbC payment to a Base request → `wrong_token`; an Ethereum hash
for a Base request → wrong network.

**What stays limited:** D07b history is off on Base (public RPC can't list history; Etherscan V2's free
plan refused chain 8453 per SPEC [ASSUMPTION: not re-tested]). No address watching (G10). Copy says
"Base: in testing" until merged and QA-verified (playbook §3.7). No sales claim before then.

**What I'd tell the PM now:** don't merge the settings change. This payment is USDbC, not USDC. The
designer's demo should show it as "right amount, wrong token (bridged USDbC), sent on Base to an address you
registered for Ethereum", and today the product can't say the token half of that.

## Log rows (WOULD WRITE)
- `2026-10-31 SGT | crypto-protocol-engineer | reviewed PM settings draft "add Base USDC" | changes requested: 0xd9aA = USDbC (bridged), source not issuer | fixture t4`
- `2026-10-31 SGT | crypto-protocol-engineer | WOULD ADD roadmap bug row | D01 High from a lagging provider (null tx, head below tx block) | chain/evm.ts lookup, rules.ts D01`
- `2026-10-31 SGT | crypto-protocol-engineer | WOULD ADD proposed roadmap rows | Base USDC deposit chain PRs 1-5 | task-4 design`
