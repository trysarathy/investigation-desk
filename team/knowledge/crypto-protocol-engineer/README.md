# Knowledge pack: crypto-protocol-engineer

Last refreshed: **2026-10-29** · Refresh owner: crypto-protocol-engineer (monthly, with the golden-task
re-run, and in the same PR as any code change that makes a file untrue). Built by reading the code on
`main` (533b096), the repo's recorded real chain responses, primary specs/source on GitHub, and live
read-only chain calls.

Labels used throughout: **[VERIFIED]** source opened, file read, or on-chain call made while writing (link
and date given); **[ASSUMPTION]** reasonable, not checked (often: only a search summary was available);
**[GUESS]** estimate. No invented facts, people or numbers.

| File | Use it for |
|---|---|
| `codebase-map.md` | Every module in `src/lib` and `src/app/api`, the data flow chain read → evidence → rules → matching → accounting, tests, how to run, **known gaps G1-G13**. Read before touching code. |
| `erc20-trc20.md` | Transfer event/topic hash, selectors, log decoding with worked real examples, `transfer` vs `transferFrom`, decimals per contract per chain (BSC = 18!), TRC-20 differences, Tron hex vs base58, why energy/bandwidth don't matter for reads |
| `finality-reorgs.md` | Ethereum `safe`/`finalized`, OP Stack unsafe/safe/finalized, Arbitrum soft/hard, BSC fast finality (BEP-126), Polygon milestones, Tron solidified blocks (19 SRs); measured lags; recommended two-gate confirmation policy; what the code does about reorgs today |
| `issuer-controls.md` | Circle FiatToken (`isBlacklisted`, `Blacklisted`, pause, EIP-3009) and Tether TetherToken (`isBlackListed`, `getBlackListStatus`, `AddedBlackList`, `DestroyedBlackFunds`, pause, deprecate) with selectors/topics; bridged tokens with no controls; official contract list and its evidence status; what a freeze means for verdicts |
| `address-formats.md` | EIP-55 checksum, EIP-1191, Tron base58check, ENS rules, Solana notes, why checksums don't stop poisoning |
| `attack-patterns.md` | A1-A13: poisoning, look-alikes, counterfeit tokens, `transferFrom` spoofing, dust, wrong network, reorgs, lying RPCs, decimals, failed txs, freezes, page tampering, prompt injection; each with detection and **whether the code handles it today** |
| `eip-681.md` | Payment URI ABNF, ERC-20 transfer form, what our `eip681()` emits, rules for new chains, Tron practice |
| `providers.md` | Etherscan V2, TronGrid, Alchemy/Infura/QuickNode, public RPCs, Blockscout; limits; multi-provider cross-check policy; cost only where it buys something |
| `secure-read-only-architecture.md` | The non-custodial invariant, allowed/forbidden methods, refusal table with read-only alternatives |

## What could not be verified on 2026-10-29 (session network allowlist blocked these hosts)
developers.circle.com, tether.to, eips.ethereum.org (read the same text from github.com/ethereum/ERCs
instead), ethereum.org (read from its GitHub repo), docs.arbitrum.io, docs.polygon.technology,
docs.etherscan.io, developers.tron.network, provider pricing pages, arXiv/USENIX, Etherscan/Tronscan
web pages, and every Ethereum-mainnet and Polygon RPC tried. Consequences: Ethereum USDT/USDC and L2 USDC
addresses are on-chain-checked or carried from the repo's earlier verification, but **not re-confirmed on
the issuers' own pages**; provider limits and prices are search summaries. First job when network access
allows: open those pages and flip the labels.

Update 2026-10-31: the Arbitrum finality docs (OffchainLabs/arbitrum-docs), BNB BEP-590/619/648/667,
Polygon Heimdall v2 milestones (0xPolygon/heimdall-v2), the JSON-RPC `removed` log flag
(ethereum/execution-apis), ethereum.org account-address derivation and the Tron TIP index were read from
their official GitHub repos and relabelled. One fact corrected: BNB "0.65 s finality" is not in any BEP;
BEP-667 states ~900 ms. Still blocked: issuer pages, Etherscan/provider docs, Polygon docs site, USDT0
source (Everdawn-Labs repos are private), arXiv/USENIX. Open list: `team/UNVERIFIED.md`.

Update 2026-10-31 (wider allowlist): opened Circle's USDC address page, Tether's supported-protocols page,
docs.polygon.technology finality, docs.etherscan.io rate limits + changelog, developers.tron.network rate
limits + consensus, docs.infura.io pricing and the arXiv poisoning paper; read USDT0 on-chain (Arbitrum
RPC), FiatToken and geth source via git clone. Corrected: **USDT0 is freezable** (`isBlocked`,
`addToBlockedList`, `destroyBlockedFunds`); Polygon checkpoints are governance-set length, not "every
≥256 blocks"; TronGrid publishes no fixed QPS/penalty (429 or 403, don't hard-code); Tether lists XAU₮ on
BNB Chain (no USD₮). Still blocked: etherscan.io web, every Ethereum/Polygon RPC, docs.usdt0.to,
tether.io, circle.com, alchemy.com, quicknode.com, wallet docs, mas.gov.sg/sso.agc.gov.sg.

## Refresh checklist
1. Re-run `npx vitest run` and update test counts in `codebase-map.md`.
2. `git log` since last refresh on `src/lib/{chain,engine,requests,accounting,payments}`: update the map
   and gap table.
3. Re-read issuer pages; re-run the on-chain probes (symbol/decimals/freeze/paused/deprecated) for every
   official contract; re-measure `safe`/`finalized`/solidified lags.
4. Re-check provider limits and any deprecations (Etherscan, TronGrid, public RPC policies).
