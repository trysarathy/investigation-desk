# Confirmations, finality and reorgs, per chain

Accessed 2026-10-29 (Polygon and Tron docs re-opened 2026-10-31). [VERIFIED] = source opened or measured
on-chain while writing. Docs sites were blocked on 2026-10-29; where only a search summary was available
the claim is labelled [ASSUMPTION: search summary].

## Vocabulary
- **Inclusion**: the tx is in *a* block. Probabilistic until finality.
- **Confirmations**: blocks built on top. Clearline computes `head − txBlock` (no +1); explorers usually
  show `head − txBlock + 1`. State which one you mean. The `head` matters more than the count: counting
  from `latest` and counting from `finalized` are different policies.
- **Finality**: the point after which reverting needs a protocol-level failure (e.g. slashing ≥ 1/3 of
  stake on Ethereum), not just bad luck or a fast proposer.
- **Reorg**: the canonical chain switches to a sibling branch; txs in the orphaned blocks may vanish or
  be re-included at a **different block number, block hash and logIndex**.

## Ethereum (PoS)
Sources: ethereum.org PoS page `public/content/developers/docs/consensus-mechanisms/pos/index.md` on
`github.com/ethereum/ethereum-org-website` (dev) [VERIFIED]; JSON-RPC block tags in
`github.com/ethereum/execution-apis/blob/main/src/schemas/block.yaml` [VERIFIED].
- Slots of 12 s, epochs of 32 slots. The first block of each epoch is a checkpoint; when ≥ 2/3 of staked
  ETH votes a checkpoint pair, the target is *justified* and the source *finalized*. "To revert a
  finalized block, an attacker would commit to losing at least one-third of the total supply of staked
  ETH." If finality stalls for > 4 epochs, the inactivity leak kicks in. [VERIFIED]
- In practice finalization takes ~2 epochs ≈ 12.8 min (quoted by the OP Stack finality page, below).
  [VERIFIED as quoted there]
- JSON-RPC tags: `finalized` = "the most recent crypto-economically secure block, cannot be re-orged
  outside of manual intervention driven by community coordination"; `safe` = "safe from re-orgs under
  honest majority and certain synchronicity assumptions"; `latest` = "may be re-orged out of the
  canonical chain even under healthy/normal conditions". [VERIFIED]
- Short reorgs (1-2 blocks) of `latest` still happen; ethereum.org lists "short range 'reorgs'
  (although proposer boosting and attestation deadlines mitigate this)" as a residual attack. [VERIFIED]
- Our default 12 confirmations from `latest` (~2.4 min) is a **sample setting** (SPEC section 3) and
  sits between `safe` and `finalized`. It is common exchange practice, not finality.

## OP Mainnet and Base (OP Stack)
Source: `github.com/ethereum-optimism/docs/main/pages/stack/transactions/transaction-finality.mdx` [VERIFIED].
- **unsafe**: in a sequencer block, data not yet on Ethereum (seconds).
- **safe**: block data posted to Ethereum (blob or calldata) and included in an L1 block, "usually 5-10
  minutes from transaction submission".
- **finalized**: the L1 block holding that data is finalized, "about 2 epochs (approximately 12.8 minutes)"
  under normal conditions; "typically around 20-30 minutes after submission". "To reorg a finalized OP
  Stack chain transaction, a reorg of the corresponding Ethereum block would be required."
- The 7-day window is for **withdrawals** (fault-proof dispute period), not transaction finality; fault
  proof challenges do not reorg the chain. [VERIFIED]
- Measured 2026-10-29 via `eth_getBlockByNumber` [VERIFIED on-chain]: OP Mainnet latest 158,832,495,
  safe 158,832,303 (192 blocks ≈ 6.4 min behind), finalized 158,831,940 (555 blocks ≈ 18.5 min
  behind). Base latest 53,237,221, safe −10 blocks, finalized −642 blocks (≈ 21 min). Base `safe` lag
  varies with batch posting; don't assume a constant.

## Arbitrum One (Nitro)
- Soft finality from the sequencer feed: sub-second, "provisional and rely on the Sequencer's integrity
  and availability". Hard finality: the batch is posted to and finalized on the parent chain, "~2 epochs,
  roughly 12–15 minutes" for an Ethereum parent; full settlement (assertion confirmed, withdrawals) takes
  a challenge period "on the order of days". The node's `safe`/`finalized` heads are the last L2 block
  whose batch sits at or before L1 `safe`/`finalized`; "If you index at `finalized`, you will never observe
  a reorg." [VERIFIED: raw.githubusercontent.com/OffchainLabs/arbitrum-docs/master/content/docs/how-arbitrum-works/deep-dives/finality.mdx
  and .../reference/finality-and-reorgs.mdx, 2026-10-31]
- Measured 2026-10-29 [VERIFIED on-chain]: latest 519,309,788; safe −1,669 blocks (≈ 8 min);
  finalized −3,338 blocks (≈ 14 min at the nominal 250 ms block time, but blocks can come faster under load, up to 8/s, so the count is not a clock; Arbitrum `finalized` follows L1 finality of the batch, ~12–15 min per the docs [VERIFIED: arbitrum-docs finality.mdx and priority-gas-auction/pga.mdx, 2026-10-31]; use the tags, not a block count). The node exposes L1-derived `safe`/`finalized` tags: use them.
- Block numbers are ~0.25 s apart (nominal 250 ms on Arbitrum One [VERIFIED: arbitrum-docs pga.mdx, 2026-10-31]); "12 confirmations" on Arbitrum is 3 seconds of sequencer trust and
  means nothing about L1 settlement. **Never port an Ethereum block count to an L2.**

## BNB Smart Chain
Source: BEP-126 "Fast Finality Mechanism", `github.com/bnb-chain/BEPs/master/BEPs/BEP126.md` [VERIFIED].
- Validators BLS-vote; a block is *justified* when its direct child's header carries ≥ 2/3 aggregated
  votes, and "If there are two continuous blocks have been justified, then the previous one is finalized."
  "The finality of a block can be achieved within two blocks in most cases." Before BEP-126, full nodes
  waited ~2/3 × 21 = 14 blocks for probabilistic finality. [VERIFIED]
- Measured 2026-10-29 [VERIFIED on-chain]: latest 130,444,004, safe = latest, finalized = latest − 1.
  `finalized` is cheap to read and almost real-time: prefer it to a block count.
- Later BEPs [VERIFIED: raw.githubusercontent.com/bnb-chain/BEPs/master/BEPs/BEP-590.md, BEP-648.md,
  BEP-667.md, BEP-619.md, 2026-10-31]: BEP-590 (Enabled) extends vote-inclusion rules; BEP-648 (Enabled)
  lets nodes justify from the in-memory vote pool once ⅔+ votes arrive, without waiting for the next
  header; BEP-619 (Enabled) cut the block interval to 0.45 s; BEP-667 (**Draft**) proposes voting every
  N blocks and gives today's average finality as **900 ms** at 0.45 s blocks. **Correction:** the
  "0.65 s finality" figure from the blog summary appears in none of these BEPs; quote ~0.9 s (BEP-667) or
  just "finalized tag, about a second", and finality rules/thresholds are unchanged from BEP-126.

## Polygon PoS
- Heimdall v2 milestones: validators propose up to 10 recent block hashes; "Once 2/3+ of the network
  agrees, the milestone is finalized, and all transactions up to that milestone are considered final, with
  no chance of reorganization"; finality "is deterministic even before a checkpoint is submitted to L1"
  [VERIFIED: raw.githubusercontent.com/0xPolygon/heimdall-v2/develop/x/milestone/README.md, 2026-10-31].
- Polygon's docs: "deterministic finality is now achieved in 2 to 5 seconds, thanks to 1 to 2 second
  block times in Heimdall"; "Milestones typically finalize a transaction within 2 to 5 seconds"; use
  `eth_getBlockByNumber` with the `"finalized"` tag to get the latest finalized block, and "Finalized blocks
  are considered irreversible"; a tx is final when its block ≤ that block [VERIFIED: https://docs.polygon.technology/pos/concepts/finality/finality, 2026-10-31].
- Checkpoints to Ethereum are separate from milestones: they "cover a contiguous range of Bor blocks (the
  length is a governance-set parameter, not a fixed cadence)" [VERIFIED: same page]. Corrected 2026-10-31:
  was "checkpoints every ≥256 blocks". Don't wait for a checkpoint to treat a Polygon tx as final.
- Pre-milestone advice (wait 128 or 256 blocks) is superseded by the `finalized` tag: the page makes
  milestone finality the rule and does not mention block counts [VERIFIED: same page; "obsolete" is our
  reading]. No Polygon RPC was reachable to measure the lag (polygon-rpc.com "tenant disabled").

## Tron (DPoS)
Source: TRON docs `mechanism-algorithm/dpos.md` (github.com/tronprotocol/documentation-en, master) [VERIFIED];
re-checked on developers.tron.network/docs/concensus 2026-10-31: ≥ 19 distinct active SRs, "typically in about
1 minute", and the node "does not calculate solidification by counting down a fixed number of confirmations"
[VERIFIED].
- 27 Super Representatives produce blocks in turn every 3 s; epochs of 6 h with a maintenance period
  that skips 2 slots. [VERIFIED]
- "A block becomes an **irreversible block** (commonly referred to as a **solidified block**) when it is
  acknowledged by at least **70%** of the SRs (i.e., 27 × 70% ≈ 19 SRs) … a block is solidified when 18
  subsequent blocks are produced by 18 *different* SRs (plus the original block producer, totaling 19
  distinct SR confirmations)." [VERIFIED]
- So ≈ 19 blocks ≈ 57 s, and only if the SRs are distinct; a skipped or repeated SR lengthens it.
  Measured 2026-10-29: `/wallet/getnowblock` 87,530,167 vs `/walletsolidity/getnowblock` 87,530,148 =
  **19 behind** [VERIFIED on-chain].
- Read finality directly: `/walletsolidity/getnowblock` (solidified head) and
  `/walletsolidity/gettransactioninfobyid` (returns the receipt only once solidified) [VERIFIED live].
  Clearline today uses `/wallet/getblock` (latest) and a configurable 20-block count (gap G1).

## Recommended confirmation policy (proposal for Aashmiin; the setting stays the company's)

Two gates, because the cost of being wrong differs:
- **Show as "confirmed / matched"** (reversible UI state): may use a block count from `latest`.
- **Mark paid automatically, credit, or offer "Approve and post"** (irreversible business action):
  require the chain's **finality signal**, read from the node, not a count.

| Chain | Display "confirmed" | Gate for paid / post | How to read it | Typical wait |
|---|---|---|---|---|
| Ethereum | 12 blocks on `latest` (current default) | tx block ≤ `finalized` | `eth_getBlockByNumber("finalized")` | ~13-15 min |
| Tron | 20 blocks (current default) | tx block ≤ solidified head, and receipt from `/walletsolidity` | `/walletsolidity/getnowblock` | ~1 min |
| BNB Chain | 15 blocks (current default) | tx block ≤ `finalized` | `eth_getBlockByNumber("finalized")` | seconds |
| Base / OP | `safe` | `finalized` | `eth_getBlockByNumber` tags | ~20-30 min |
| Arbitrum | `safe` | `finalized` | tags (L1-derived) | ~15-20 min |
| Polygon PoS | `finalized` (milestones) | `finalized` | tag | 2-5 s per Polygon docs [VERIFIED 2026-10-31; not measured] |

Plus, for every gate: (1) re-read the receipt at gate time and check `blockHash` still equals the
canonical block at that number (`eth_getBlockByNumber(n).hash`); (2) if the tx is gone or moved, treat
it as a **new observation of the same tx**, not a new payment (key on `chain + txHash + transfer
position within the tx`, not `logIndex` alone); (3) if the `finalized` tag can't be read, the gate is
**unknown → paused**, never "assume final". Exchanges publish block counts (SPEC cites Binance via eco.com:
Tron 20, Ethereum 12, BNB 15); those are their risk appetite with their own reorg monitoring, not a
finality guarantee [VERIFIED as cited in docs/SPEC.md section 3].

## Reorg handling: what the code does today (2026-10-29, see codebase-map G1/G2)
- `chain/evm.ts`: a tx with `blockNumber` and a receipt with `status` are cached with `ttlSec: Infinity`;
  `eth_getBlockByNumber(n)` cached forever. A reorg within the cache lifetime is invisible.
- `requests/lifecycle.ts ingest`: `block = prev.blockNumber ?? ev.blockNumber` (first block wins) and
  `confirmations = max(prev, ev)` ("confirmations never go backwards"). Observation key =
  `chain:hash:logIndex`, so a re-included tx at a new logIndex becomes a **second observation**:
  two confirmed transfers of the full amount → `duplicate` "Paid twice" → refund suggestion.
- `payments/refresh.ts`: a found hash is "settled" and never looked up again.
- No `removed` flag, block-hash check or finality tag is read anywhere.

## Sources
- https://github.com/ethereum/ethereum-org-website (pos/index.md, dev branch), accessed 2026-10-29 [VERIFIED]
- https://github.com/ethereum/execution-apis/blob/main/src/schemas/block.yaml, accessed 2026-10-29 [VERIFIED]
- https://github.com/ethereum-optimism/docs/blob/main/pages/stack/transactions/transaction-finality.mdx, accessed 2026-10-29 [VERIFIED]
- https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP126.md, accessed 2026-10-29 [VERIFIED]
- https://github.com/tronprotocol/documentation-en/blob/master/docs/mechanism-algorithm/dpos.md, accessed 2026-10-29 [VERIFIED]
- https://raw.githubusercontent.com/OffchainLabs/arbitrum-docs/master/content/docs/how-arbitrum-works/deep-dives/finality.mdx , .../reference/finality-and-reorgs.mdx , .../priority-gas-auction/pga.mdx (source of docs.arbitrum.io), accessed 2026-10-31 [VERIFIED]
- https://raw.githubusercontent.com/bnb-chain/BEPs/master/BEPs/BEP-590.md , BEP-619.md , BEP-648.md , BEP-667.md , accessed 2026-10-31 [VERIFIED]
- https://raw.githubusercontent.com/0xPolygon/heimdall-v2/develop/x/milestone/README.md , accessed 2026-10-31 [VERIFIED]
- https://docs.polygon.technology/pos/concepts/finality/finality , opened 2026-10-31 [VERIFIED]
- https://developers.tron.network/docs/concensus ("solidified — once at least 19 distinct active SRs have each produced a block at that height or above, typically in about 1 minute"; code uses `SOLIDIFIED_THRESHOLD = 70`), opened 2026-10-31 [VERIFIED]
- On-chain block-tag reads: arb1.arbitrum.io, mainnet.base.org, mainnet.optimism.io, bsc-dataseed.bnbchain.org, api.trongrid.io (2026-10-29) [VERIFIED]
