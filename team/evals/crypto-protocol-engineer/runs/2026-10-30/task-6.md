# Task 6: the payment that was "seen twice" (REQ-1101 / INV-2290)

To: Aashmiin. Source: `fixtures/t6-reorg.json` (fictional hashes in real response shapes; the token is real Ethereum USDC `0xa0b8…eb48`). The code behaviour is from reading `main` (identical to the ai-team branch `src/`) [VERIFIED by reading]. Numbers below were computed this run.

## Short answers
- **Did they pay twice? No.** It's one transaction (`0x00000000…012345`), one Transfer of 12,500.00 USDC, seen in two different blocks, because the first block it landed in (21,593,641) was replaced (reorged out) and the same transaction was re-included in 21,593,642. An Ethereum transaction (one sender nonce) can be in the canonical chain only once.
- **Why stuck at 4 of 12:** our code keyed the payment on `logIndex`, which changes when a transaction moves blocks. So the re-included transfer became a **second** payment record. The ghost first record will never be updated again, so it sits at "4 of 12" forever.
- **What went wrong in our code:** gap G2 (reorg-blind) and G1 (counting from `latest`), exactly as listed in the knowledge pack: logIndex in the key, first block number wins, confirmations never go down, receipts cached forever, no block-hash or finality check.
- **Today, for the customer:** INV-2290 *is* paid once, in block 21,593,642. A person can clear the ghost record with the existing "dismiss transfer" action. Steps are in §4.

## 1. What happened on-chain
| | Lookup 1 (Mei, 02:00:20Z) | Lookup 2 (Raj, 02:03:30Z) |
|---|---|---|
| Head (`eth_blockNumber`) | `0x1497e2d` = 21,593,645 | `0x1497e3b` = 21,593,659 |
| Receipt block | `0x1497e29` = **21,593,641**, hash `0x…aa11…` | `0x1497e2a` = **21,593,642**, hash `0x…bb22…` |
| Status | `0x1` | `0x1` |
| Transfer log | USDC contract, from `0x…c0ffee01`, to `0x00000000a1b2…8f90` (= request address), value `0x2e90edd00` = 12,500,000,000 ÷ 10^6 = **12,500.000000 USDC** | identical contract, from, to, value |
| `logIndex` | `0x41` = **65** | `0x0c` = **12** |
| Confirmations (head − block) | 4 | 17 |
| Canonical block 21,593,641 at lookup 2 | n/a | `eth_getBlockByNumber(0x1497e29).hash` = `0x…cc33…` **≠ `0x…aa11…`** |

Reading: block 21,593,641 with hash `aa11` is no longer canonical; the canonical 21,593,641 is `cc33` and doesn't contain our tx. The same tx hash is in 21,593,642 (`bb22`). One payment, re-included after a reorg, with a new block number, block hash and `logIndex` (the log's position in the **block**). Contract, from, to, value and the tx hash didn't change.

Protocol note: at lookup 1 the provider's head was 21,593,645, so block `aa11` already had 4 descendants in that view. A ≥5-block reorg on post-merge Ethereum is very unusual (ethereum.org lists short 1-2-block reorgs of `latest` as the residual risk). The other explanation is that Mei's lookup was answered by a node on a minority fork or a lagging/bad node (attack pattern A8). Both explanations look the same in the data and need the same fix. It's also why the pack recommends a second provider before anything irreversible (G9). [ASSUMPTION about which one; the fixture can't tell]

## 2. Exactly what our code did, and why
1. **Lookup 1** → `requests/service.ts attachHash` → `LiveHashProvider.lookup` → `chain/evm.ts EvmFetcher.lookup`. The receipt has a `status`, so `ttlFor` caches it with **`Infinity`** (`evm.ts:195-196`); the tx with a `blockNumber` also gets `Infinity` (`evm.ts:183-184`), and so does block 641's header (`evm.ts:206`). → `requests/lifecycle.ts ingest()` with key `obsKey(chain, hash, logIndex)` = `ethereum:0x…012345:65` (`lifecycle.ts:167`), new → Observation **A**: block 21,593,641, 4 confirmations. Activity: "Detected a 12,500.00 USDC transfer 0x00000000…012345, in block 21,593,641."
2. **Lookup 2** returned the re-included receipt (logIndex 12). Key `ethereum:0x…012345:12` doesn't exist, so the "new" branch (`lifecycle.ts:199-221`) runs. It doesn't look for the same tx hash under another index. → Observation **B**: block 21,593,642, 17 confirmations, plus a second "Detected…" entry. Same request (address attribution).
3. **`deriveRequest`** (`lifecycle.ts:326-345`): both A and B count (genuine USDC, right address). B (17 ≥ 12) → `confirmed`, so `received` = 12,500.00. A (4 < 12) → `confirming`, so `pending` = 12,500.00 and `maxConfirmations` = 4. Since `confirming.length > 0` it returns state **"confirming"** with the reason "12,500.00 USDC is confirming (4 of 12)". That's exactly the screen: "Received 12,500.00 USDC; 12,500.00 USDC is confirming (4 of 12)."
4. **Why it never moves:** nothing will ever update key `…:65`. There's no polling (G10), and every future lookup of this hash returns the canonical receipt with logIndex 12, which updates B. `ingest`'s "update" branch keeps `prev.blockNumber` (first block wins) and `Math.max` on confirmations ("never go backwards", `lifecycle.ts:176-177`), so even a correct re-read couldn't move A to the new block. Nothing reads `blockHash`, `removed`, or the `finalized` tag.
5. **Worse outcomes these same bugs allow:**
   - **(a) "Paid twice":** if A were ever pushed past 12 (for example by a lookup served from the cache below), `deriveRequest` would have two confirmed transfers of exactly the amount. That gives `duplicate = true`, "Paid twice… 12,500.00 USDC more than the invoice", and a `refund_excess` suggestion for money that never arrived.
   - **(b) Phantom payment:** the receipt from the orphaned block is cached **forever** in `.data/cache` (`FileStore`, `live.ts:58`). In the code as written, a second lookup in the same deployment would usually get **lookup 1's stale receipt back from the cache** (block 641, logIndex 65), with a fresh head from `eth_blockNumber` (ttl 5 s). So A climbs to 18 "confirmations" of a block that is no longer canonical, and the request shows "matched", or with auto-mark on, "Marked paid automatically". If the tx had been dropped instead of re-included, we'd have marked paid a payment that doesn't exist. The fixture shows lookup 2 getting a fresh receipt, so this deployment didn't hit the cache [ASSUMPTION: different process/cache dir; not determinable from the fixture]. Either way it is the same root cause.
   - Posting: `accounting/rules.ts planPosting` counts confirmed transfers. A plan made under (a) or (b) would be "ready" on wrong facts. It still needs a person's Approve, which is the only reason no wrong posting was possible.

Root cause in one line: `requests/lifecycle.ts ingest` identifies a payment by `chain:hash:logIndex` and assumes a block number never changes. But `logIndex` and the block are properties of the block, not of the payment, and `chain/evm.ts` caches pre-finality data as immutable.

## 3. Smallest safe fix (plan; tests first; no code tonight)
**PR 1: `fix/reorg-observation-identity` (pure lifecycle + fetcher; aim < 250 lines)**
1. Observation identity = `chain + txHash + transfer position within the tx` (the ordinal of the matching Transfer log among the tx's receipt logs). That position is stable when the same tx is re-included. Keep `logIndex`, `blockNumber` and `blockHash` as **mutable attributes** of the observation.
2. Read the existing data compatibly: when an event arrives whose `(chain, hash, position)` matches an observation stored under an old `…:logIndex` key, update **that** observation. Don't create a new one.
3. On a re-sighting with a different `blockHash`/`blockNumber`: take the new block and the **new** confirmations, even if lower (they may go down). Append activity "Re-included in block 21,593,642 after a chain reorganisation (first seen in block 21,593,641)". If it was confirmed before and now isn't, it goes back to confirming, and auto-mark doesn't fire.
4. Honour `removed: true` on a log, and a receipt that is now `null`, as **unknown** (pause). Never "failed", never "not paid".
5. `chain/evm.ts`: store `blockHash` in the event. Cache a tx or receipt as immutable only when its block is ≤ the `finalized` block (read with `eth_getBlockByNumber("finalized")`). Otherwise use a short TTL. On every lookup, compare `receipt.blockHash` with `eth_getBlockByNumber(n).hash` (and don't cache that by-number header forever before finality). On a mismatch, re-fetch uncached; if it still mismatches, treat the fact as unknown.

Tests written first (each must fail on main for the stated reason):
- `ingest › same tx re-included at a new block/logIndex is one observation` (t6 shapes: 641/logIndex 65, then 642/logIndex 12): 1 observation, block 21,593,642, 17 confirmations, a "re-included" activity entry; `deriveRequest` → matched once, `duplicate` false. *Fails today: 2 observations, state "confirming (4 of 12)".*
- `ingest › re-inclusion lowers confirmations` (first seen at 20 confs, re-seen in a later block at 3): confirmations 3, state confirming, no auto-mark. *Fails today: `Math.max` keeps 20.*
- `ingest › a batch tx with two transfers to the address is still two observations` (positions 0 and 1). Neighbour case: don't over-merge.
- `ingest › old-key observation is updated, not duplicated` (stored data keyed `…:65`, new event at position 0): one observation.
- `deriveRequest › one tx hash never reads as "Paid twice"` (regression for G2).
- `evm › receipt above finalized is not cached forever` (stub transport: finalized = n−1): the second lookup re-fetches. `evm › block-hash mismatch re-fetches, then pauses`. `evm › finalized tag error → unknown, not final`.
- `ingest › log with removed:true → paused/unknown`.
All offline with stubbed transports. The fictional t6 data is labelled fictional in the fixture.

**PR 2: `feat/finality-gate` (next night)**: two gates (below). "Matched/confirmed" display may use the count, but **auto-mark paid and "Approve and post" require the tx block ≤ the chain's finality signal**, re-checked at gate time with a block-hash comparison. If finality can't be read, the request is paused. Tests: gate refused below `finalized`; allowed at/after; unknown → paused; Tron: solidified head.

**Operational fix for REQ-1101 now (no code):** a person verifies (§4), then uses **"dismiss transfer"** on the ghost observation `…:65` with the note "Orphaned by a chain reorganisation; the same transaction was re-included in block 21,593,642 (logIndex 12)". That appends a decision; it doesn't edit history. The request then derives "matched" from B alone, and someone marks it paid. Never edit `.data` to delete A.

## 4. What Mei/Raj should check before marking INV-2290 paid
1. A fresh read of the receipt for `0x…012345` shows block 21,593,642, hash `bb22…`, status 1, one USDC Transfer of 12,500.000000 to the request address.
2. `eth_getBlockByNumber(21,593,642).hash` = `bb22…` (canonical), and 21,593,642 ≤ `eth_getBlockByNumber("finalized").number` (finalized). After 30+ minutes it should be well past finality (~2 epochs ≈ 12.8 min).
3. Then dismiss A as above and mark paid. Until PR 1 ships, our app can't do checks 1-2 for them. Clearline must not *claim* finality it didn't read.

## 5. Per-chain confirmation policy (proposal; the setting stays the company's)
Two gates, because the cost of being wrong is different:
- **Gate D (display "confirmed / matched")**: reversible, so a block count from `latest` is acceptable.
- **Gate P (mark paid, auto-mark, credit, or offer "Approve and post" to Xero)**: irreversible, so it requires the chain's own **finality signal** read from the node, plus a fresh receipt whose `blockHash` equals the canonical hash at that height. If the signal can't be read, the request is **paused**.

| Chain | Gate D | Gate P (paid / post) | How to read it | Typical wait | Source |
|---|---|---|---|---|---|
| Ethereum | 12 blocks from `latest` (current default; between `safe` and `finalized`) | tx block ≤ **`finalized`** | `eth_getBlockByNumber("finalized")` | ~13-15 min (2 epochs ≈ 12.8 min + inclusion) | ethereum.org PoS page; execution-apis `block.yaml` tag definitions [VERIFIED by pack 2026-10-29] |
| Tron | 20 blocks from latest (current default) | tx block ≤ **solidified** head **and** the receipt is returned by `/walletsolidity/gettransactioninfobyid` | `/walletsolidity/getnowblock` | ~1 min (19 distinct SRs of 27, 3 s blocks) | TRON docs `dpos.md` [VERIFIED by pack]; measured lag 19 blocks |
| BNB Chain | 15 blocks (current default) | tx block ≤ **`finalized`** (BEP-126 fast finality: two consecutive justified blocks) | `eth_getBlockByNumber("finalized")` | seconds (measured finalized = latest − 1) | BEP-126 [VERIFIED by pack] |
| Polygon PoS | `finalized` (milestones) | **`finalized`** | `eth_getBlockByNumber("finalized")` | seconds [ASSUMPTION: Polygon docs search summary only; no Polygon RPC was reachable to measure] | docs.polygon.technology (not opened) |
| Arbitrum One | `safe` | **`finalized`** (batch posted to L1 and the L1 block finalized) | node's L1-derived `safe`/`finalized` tags | ~15-20 min (measured finalized ≈ latest − 3,338 blocks ≈ 16.5 min) | measured on arb1.arbitrum.io [VERIFIED by pack]; Arbitrum docs [ASSUMPTION: search summary] |
| Base | `safe` | **`finalized`** | `eth_getBlockByNumber` tags | ~20-30 min (measured ≈ 21 min) | OP Stack `transaction-finality.mdx` [VERIFIED by pack] |
| OP Mainnet | `safe` | **`finalized`** | `eth_getBlockByNumber` tags | ~20-30 min (measured ≈ 18.5 min) | same |

Rules that go with the table:
1. **Never port a block count between chains.** 12 blocks on Arbitrum is ~3 s of sequencer trust and says nothing about L1 settlement.
2. Exchange block counts (Binance: Tron 20 / Ethereum 12 / BNB 15, cited in SPEC §3) are those exchanges' risk appetite, backed by their own reorg monitoring. They aren't finality, so we use them for Gate D only.
3. Key observations on `chain + txHash + transfer position`, and treat a moved transaction as the **same** payment.
4. Before Gate P on any chain: re-read the receipt, compare its `blockHash` to the canonical block, and (for pilots) have **two independent providers** agree on block hash, status and the Transfer log (G9).
5. Today requests are Ethereum-only, so for the Xero flow only the Ethereum row applies now. The others apply to the deposit desk and to future request chains.
6. The finalized wait on Ethereum (~15 min) is a product trade-off: "Confirmed" shows in ~2.5 min, and "Paid / ready to post" in ~15. That's honest. The 12-count alone isn't.

## Notes
- [VERIFIED this run]: hex conversions; code paths and line numbers read from source (`lifecycle.ts:166-221, 326-345`, `evm.ts:183-207`, `http.ts:92,135`, `live.ts:58`).
- [ASSUMPTION]: deep canonical reorg vs a forked/bad provider at lookup 1; whether lookup 2 bypassed the cache; Polygon/Arbitrum doc statements (search summaries in the pack).
- Not done: no code tonight (the task asks for a plan). PR 1 would be the next nightly build if Aashmiin adds the row (or it's an existing `bug` row).
- WOULD WRITE: Log `crypto-protocol-engineer | REQ-1101 investigation | one payment re-included after reorg; ghost observation from logIndex key (G2) | task-6.md`, and a `RISK:` Log row: `RISK: reorg-blind request ingestion (G1/G2) can show "Paid twice" or mark an orphaned payment paid; no wrong posting possible without Approve | REQ-1101 | task-6.md`. A Product roadmap row `bug`: "Reorg: one tx re-included creates a second observation (REQ-1101)", owner Product, linking this note.
