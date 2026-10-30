# RPC and indexer providers

Accessed 2026-10-29. Provider docs (docs.etherscan.io, developers.tron.network, alchemy, infura,
quicknode) were **blocked from this session**; figures below from search summaries are labelled
[ASSUMPTION: search summary] and must be checked on the provider's own page before any spending
decision. Measured behaviour is [VERIFIED].

## What Clearline needs from a provider
By-hash reads only: `eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_getBlockByNumber`
(incl. `safe`/`finalized` tags), `eth_blockNumber`, `eth_call` (symbol, decimals, freeze); Tron
`/wallet/gettransactionbyid`, `/wallet/gettransactioninfobyid`, `/wallet/getblock|getnowblock`,
`/walletsolidity/*`, `triggerconstantcontract`. Plus **history** for D07b (an address's token transfers:
Etherscan `account/tokentx`, Blockscout v2, TronGrid v1 `/accounts/{a}/transactions/trc20`) and, later,
**address watching** (logs filtered by `topics[2] = our address`: `eth_getLogs` or a webhook product).
Archive access is needed only to read historical state (e.g. `isBlacklisted` at a past block) or old
receipts on pruned nodes.

## What the code uses today (`src/lib/chain/sources.ts`, `.env.example`) [VERIFIED in code]
| Chain | Source | Notes |
|---|---|---|
| Ethereum, Polygon, Arbitrum | Etherscan API V2 (`chainid=`), key `ETHERSCAN_API_KEY`; keyless fallback eth.drpc.org / polygon.drpc.org / arb1.arbitrum.io | 400 ms spacing (3/s tripped at 350 ms in week 3) |
| BNB Chain, Base, Optimism | official public RPCs (bsc-dataseed.bnbchain.org, mainnet.base.org, mainnet.optimism.io) | Etherscan free plan refuses 56/8453/10 (SPEC, week 2 test) |
| Tron | TronGrid (`TRON-PRO-API-KEY` optional) | keyless: 400 ms spacing; keyed 80 ms |
| D07b history | Etherscan `tokentx`, Blockscout (eth.blockscout.com v2), TronGrid v1 | BSC/Base/OP/Polygon/Arbitrum: none |

## Provider facts
- **Etherscan API V2**: one key across many EVM chains via `chainid`. Free tier 3 calls/s and up to
  100,000 calls/day on selected chains; some chains not in Free; Free pool for a chain may be shared;
  from 1 Jul 2026 the Free tier returns at most 1,000 records per request (was 10,000); "Max rate limit
  reached" on excess [ASSUMPTION: search summary of docs.etherscan.io rate-limits and changelog]. Since
  24 Oct 2026 keyless calls get "Missing/Invalid API Key" [VERIFIED: code comment and re-checked
  2026-10-29: `{"status":"0","message":"NOTOK","result":"Missing/Invalid API Key"}`]. Paid plans from
  about US$49/month (SPEC cites Yahoo Finance; CostBench lists Lite $49 … Pro Plus $899)
  [ASSUMPTION].
- **TronGrid**: with a key ~15 QPS under the daily quota (older pages: 15/s; another page 30/s), ~1/s over
  quota, 403 + ~30 s penalty when exceeded; keyless requests are "subject to strict rate limiting or even
  complete rejection"; current docs say not to hard-code limits and to use the console [ASSUMPTION:
  search summary of developers.tron.network/reference/rate-limits]. Measured: keyless 3/s and a 5 s
  suspension (real-data test, `sources.ts` comment) [VERIFIED in code]. Its pending pool is load-balanced
  and inconsistent (`docs/week2-d10-mempool.md`) [VERIFIED].
- **Alchemy**: free tier 30M compute units/month, `eth_call` = 26 CU; **Infura**: 3M credits/day free;
  **QuickNode**: free is a one-month trial (10M credits, 15 rps), paid from $49/month [ASSUMPTION: from a
  QuickNode-published comparison found by search, Jul/Aug 2026; competitor-authored]. All three offer
  `safe`/`finalized` tags, archive, and webhook/stream products for address watching [ASSUMPTION].
- **Public RPCs** (measured 2026-10-29) [VERIFIED]: arb1.arbitrum.io and mainnet.base.org answer
  `eth_call` and `safe`/`finalized` tags but returned HTTP 403 to a Python client without a User-Agent
  (curl-style UA fixed it); mainnet.optimism.io and bsc-dataseed answered directly; polygon-rpc.com
  answered "API key disabled, tenant disabled" (-32051, 403). Public endpoints change policy without
  notice: never a production dependency.
- **Blockscout**: keyless REST v2, paginated history; the code stops after 3 pages and reports
  "not fully read" rather than claiming absence [VERIFIED in code].

## Reliability policy (recommended)
1. **Unknown ≠ negative.** Timeout, 429/403/5xx, non-JSON, JSON-RPC error, `null` receipt for a mined tx,
   unreadable `finalized` tag ⇒ the fact is unknown ⇒ pause. (Implemented for lookups.)
2. **Two providers before anything irreversible** (auto-mark paid, posting): the receipt's `blockHash`,
   `status` and the Transfer log (contract, from, to, value) must agree across two independent sources,
   e.g. Etherscan V2 + an Alchemy/Infura node, or TronGrid + a second Tron full node. Disagreement ⇒
   needs review with both raw bodies attached.
3. **Head sanity**: compare provider heads; a provider > N blocks behind the other is stale.
4. **Record provenance**: source, URL (key redacted), fetchedAt, sha256 of body (implemented in `http.ts`).
5. **Privacy**: public endpoints see the hashes and addresses we query (`.env.example` says so). For a
   pilot with real customer data, use keyed providers under a DPA.
6. **Cost only when it buys something**: today zero spend is right (0 customers). First paid step, when a
   pilot signs: Etherscan Lite/Standard (one key, many chains, history for D07b) + one node provider free
   tier as the second source; TronGrid keyed (free). Any spend is Aashmiin's decision (company rule).
