# Codebase map: investigation-desk (`src/`)

Read from the code on 2026-10-29 (branch `ai-team` = `main` at 533b096). Every statement below is
[VERIFIED] against the file named unless labelled otherwise. If you change a module, update this file in
the same PR.

Stack: Next.js 15.5 / React 19 / TypeScript 5.9, Vitest 3.2, one Node process, JSON files under `.data/`
(or `$DESK_DATA_DIR`) instead of a database. Runtime deps that matter for protocol work: `@noble/hashes`
(keccak-256 for EIP-55), `node:crypto` (sha256 for Tron base58check and raw-response hashing). There is no
signing library and no key handling anywhere in `src/`: keep it that way.

## 1. The two products inside one app

| Product | Where | Status |
|---|---|---|
| **Payment requests + accounting sync** (what is sold today) | `src/lib/requests/`, `src/lib/accounting/`, pages `/requests`, `/pay/[publicId]`, `/books` | Demo mode (default) runs on simulated transfers; live mode (`DEMO_MODE=off`) = Ethereum only, USDC/USDT, a person pastes a tx hash (`attach_hash`); no address watching, no polling |
| **Deposit investigation desk** (D01-D18 engine, the "brain") | `src/lib/engine/`, `src/lib/chain/`, `src/lib/workspace/`, `src/lib/bulk/`, pages `/investigate`, `/cases/[id]`, `/bulk`, `/settings` | Hidden from nav in demo mode, reachable by URL; live lookups on Tron, Ethereum, BNB Chain + cross-check Polygon, Base, Arbitrum, Optimism |
| **Payment records / three-way matching / exception inbox** | `src/lib/payments/`, pages `/payments`, `/inbox` | CSV imports (BVNK preset), matching, exceptions, PDF evidence packs |

The payment-request flow reuses the deposit engine: `requests/check.ts` turns one observed transfer into
engine `Facts` and calls `engine/run.ts investigate()`.

## 2. Data flow: chain read → evidence → rules → matching → accounting

```
hash (pasted / CSV / attach_hash)
  └─ normalise.ts normaliseInput()            hash = 64 hex, lower-case, no 0x
     └─ chain/investigate.ts fetchFacts()     looks the hash up on ALL 7 chains in parallel (lookupOne)
        ├─ chain/tron.ts TronFetcher.lookup   /wallet/gettransactionbyid, /wallet/gettransactioninfobyid,
        │                                     /wallet/getblock (head = LATEST, not solidified), symbol()/decimals()
        ├─ chain/evm.ts EvmFetcher.lookup     eth_getTransactionByHash, eth_getTransactionReceipt (logs),
        │                                     eth_getBlockByNumber (time), eth_blockNumber (head = latest), eth_call
        ├─ freezeFacts()                      USDT isBlackListed(address) / USDC isBlacklisted(address), sender + destination
        └─ historyFacts()                     D07b: look-alike's prior transfers (TronGrid v1 / Etherscan tokentx / Blockscout)
     → Facts (types.ts)                       incl. rawResponses[] with sha256 + fetchedAt
        └─ engine/context.ts buildContext()   pickTransfer, addressAtTime, confirmations = head − block,
                                              claimedSymbol (confusables), impersonation, matchLedger
           ├─ engine/evidence.ts buildEvidence()   stable evidence ids ev.*
           └─ engine/rules.ts RULES (pure)          one function per code
              └─ engine/run.ts investigate()        first High in CATALOGUE_ORDER, else first Medium, else D99;
                                                    any chain lookup error + no tx → state "paused"
                 ├─ deposit desk: lib/view.ts → /cases/[id]; ai/explain.ts words it (validated by ai/validate.ts)
                 └─ requests: requests/check.ts checkObservation() → CheckSnapshot on the Observation
                    └─ requests/lifecycle.ts ingest() → attribute() → deriveRequest() (state machine)
                       └─ accounting/rules.ts planPosting() → accounting/engine.ts approveAndPost()
                          (only a "ready" plan, only after a person clicks Approve, idempotency key per line)
```

## 3. `src/lib/chain/` (read-only chain access)

| File | What it does | Key types / exports |
|---|---|---|
| `types.ts` | One chain's answer for one hash | `ChainLookupResult {lookup, tx?, currentBlock?}`, `TokenMeta` |
| `abi.ts` | Minimal ABI decoding: `TRANSFER_TOPIC` (ddf252ad…), `decodeTransferLogs` (keeps only logs with **exactly 3 topics** and topic0 = Transfer, so ERC-721 4-topic Transfers are skipped), `decodeTransferCall` (selector a9059cbb, to recover intent of a failed call), `formatUnits`, `decodeAbiString` (string or bytes32), `decodeAbiUint` (<256 only) | `RawLog`, `TRANSFER_TOPIC` |
| `http.ts` | `ChainClient`: per-host throttle, retries 429/403/5xx and body-classified rate limits with jittered backoff, response cache (`ttlSec`, `ttlFor`), stores every `RawResponse` with sha256; redacts `apikey` | `ChainClient`, `ChainApiError(retryable)`, `KEY_NOT_SET`, `Transport` |
| `evm.ts` | `EtherscanSource` (V2 proxy module, `chainid=`), `JsonRpcSource`, `BlockscoutHistory` (3 pages max, throws if not fully read), `EvmFetcher.lookup` (null receipt = **unknown**, never failed), `ethCall` (any error → undefined) | `EvmSource`, `EvmFetcher` |
| `tron.ts` | `TronFetcher.lookup`, `isBlackListed`, `trc20From` (TronGrid v1 history), `tokenMeta`. Log index = position in `log[]`. Log `address` and topics are 20-byte hex without `41`; converted with `tronHexToBase58('41'+hex)` | `TronFetcher`, `tronClassifyBody` |
| `sources.ts` | Which source per chain: Etherscan V2 for 1/137/42161 (falls back to `KEYLESS_RPC` drpc/arb1 without `ETHERSCAN_API_KEY`); public RPC for BSC/Base/OP; spacing per host | `EVM_SOURCES`, `KEYLESS_RPC`, `buildFetchers` |
| `investigate.ts` | `fetchFacts`, `lookupOne` (any exception → `result:"error"`), `FREEZE_SELECTOR` (USDT `0xe47d6060`, USDC `0xfe575a87`, checked by keccak in `tests/chain.test.ts`), `inferCustomer`, `freezeFacts`, `historyFacts` | `Workspace`, `LiveDeps` |
| `live.ts` | Wires fetchers from env (`TRONGRID_API_KEY`, `ETHERSCAN_API_KEY`, `LIVE_LOOKUPS`, `OFFLINE_REPLAY_DIR`); `overrideChainDeps` for tests | `liveDeps()` |
| `store.ts` | `ResponseStore`: `MemoryStore`, `FileStore` (`.data/raw/<sha>.json`, `.data/cache/`) | |

Caching facts to know: a tx with `blockNumber` and a receipt with `status` are cached **forever**
(`ttlSec: Infinity`), and `eth_getBlockByNumber` by number is cached forever. That is correct only for
finalized data (see `finality-reorgs.md`).

## 4. `src/lib/engine/` (pure rules; no network, no clock but `facts.checkedAt`)

| File | What it does |
|---|---|
| `context.ts` | `buildContext` derives `Ctx`: `pickTransfer` (customer's address first, then any company address, exact USDT/USDC symbol before confusable), `addressAtTime` (File A at block time → this_customer / other_customer / retired / unattributed), `confirmations = currentBlock − blockNumber` (no +1), `claimedSymbol` (NFKD + Cyrillic/Greek confusables: "ÚЅDТ" → USDT), `impersonation`, `tokenAccepted`, `belowMinimum`, `matchLedger` (exact only on chain+hash+transfer index+contract), `looksAlike` (first 3 + last 4), `isPoisoning` (dust in, or forged zero-value / other-contract out) |
| `rules.ts` | `RULES` D01-D18 (D15 out of v1, D10 disabled by `mempoolChecksEnabled=false`). `creditable()` requires every fact known; `missingFact()` blocks D02/D12/D16 on unknown head/amount/freeze |
| `evidence.ts` | Evidence rows with stable ids (`EV.*`), explorer links, labels |
| `run.ts` | `investigate()`: pause on lookup error without tx; run all rules in `CATALOGUE_ORDER`; first High, else first Medium, else D99; `fillValues` for templates |

`catalogue.ts`: `RULE_VERSION`, `CATALOGUE_ORDER` (D09 straight after D03), labels, next steps, explorer
URLs. `templates.ts`: reply templates word-for-word from the spec. `contracts.ts`:
`officialContractFor` (issuer contract from Settings; on BSC the company-declared contract,
`source:"company"`, no freeze function). `address.ts`: `canonicalAddress`, `sameAddress`,
`tronHexToBase58`, `tronToHex` (**does not verify the base58 checksum**). `decimal.ts`: exact decimal
compare. `normalise.ts`: input type detection. `types.ts`: `Chain`, `EVM_CHAIN_IDS`, `Facts`, `ChainTx`,
`TokenTransfer`, `Settings`, `Verdict`, `RawResponse`.

## 5. `src/lib/requests/` (payment requests)

| File | What it does |
|---|---|
| `types.ts` | `PaymentRequest` (amount ≤ 6 dp, `tokenContract` fixed at creation, `receivingAddress`), `Observation` (key `chain:hash:logIndex`), `RequestState`, `DecisionKind`, `REQUEST_CHAIN = "ethereum"` |
| `lifecycle.ts` | Pure: `validateRequest` (receiving address: regex only, **no EIP-55 check**), `createRequest`, `attribute` (address-only; several open requests on one address → ambiguous; amount is a hint only), `ingest` (dedupe by key; **block number kept from first sighting; confirmations never go backwards**), `transferIssue` (failed / wrong network / wrong address / counterfeit vs wrong_token by **`symbol.toUpperCase().includes(token)`** / timing / engine), `deriveRequest`, `decide`, `suggestMatches`, `compareAddress` (look-alike = first 4 OR last 4 hex equal), `toBaseUnits` |
| `check.ts` | `REQUEST_SETTINGS` (sample settings + USDC on Ethereum, 12 confirmations), `OFFICIAL` contracts, `factsFor` (synthesises `currentBlock = blockNumber + confirmations`, freeze `not_supported` for simulated), `checkObservation` |
| `provider.ts` | `SimulatedProvider` (demo; hashes start `0x00000000`), `LiveHashProvider.lookup` (Ethereum only; another chain returns a message and **records nothing**) |
| `present.ts` | `eip681()` URI, verdict text, next action, reply drafts, refund *instructions* (text for treasury, never a transaction) |
| `service.ts` | Server side: store lock, `createPaymentRequest`, `actOnRequest`, `attachHash` (live lookup → `ingest`) |
| `demo.ts` | Fictional Northwind week (cases a-g), `COUNTERFEIT_USDT`, `lookalikeOf` |
| `store.ts`, `ui.ts` | JSON store with lock; list/sort helpers |

## 6. `src/lib/accounting/`
`types.ts` (plans, lines, audit), `rules.ts` `planPosting()` (pure; counterfeit / wrong network / failed /
wrong token = never posted; par valuation, 0.5% off-par block; rounding down to cents), `engine.ts`
`approveAndPost()` (the only write to the books; refuses a plan not `ready`; plan key checked in the
**route**, not mandatory in the function: known gap from the whitepaper), `service.ts`, `store.ts`,
`providers/` (`demo.ts` fictional books, `xero.ts` + `xero-auth.ts` OAuth with file-locked refresh,
`quickbooks.ts` built against docs, `netsuite.ts` interface only).

## 7. `src/lib/payments/` (records, three-way matching, inbox)
`types.ts` canonical records; `chain.ts` `fetchTransfers` (one `ChainTransferRecord` per Transfer log,
key `chain:hash:index`; **no confirmations/finality field at all**); `refresh.ts` (a found hash is
"settled" and never re-read: reorg-blind); `match.ts` (exact identifiers only; hash without index links
only if the tx has exactly one transfer); `exceptions.ts` (missing leg, duplicate record, amount/fee
mismatch, overdue, unmatched, contradiction, D-codes); `inbox.ts`, `workflow.ts`, `audit.ts` (append-only
JSONL), `export.ts` + `pdf.ts` (evidence packs), `mapping.ts`/`presets.ts`/`fields.ts` (CSV mappings,
BVNK preset), `money.ts` (exact decimal add/sub), `settings.ts` (routes), `jobs.ts`, `live.ts`, `view.ts`.

## 8. Other `src/lib/`
`csv/files.ts` (Files A/B/bulk validation; **EIP-55 `eip55Ok` and Tron checksum `checkAddress` live here**),
`csv/parse.ts` (strict RFC 4180), `csv/cell.ts` (formula-injection-safe cells), `workspace/` (Files A/B
store), `bulk/` (bulk investigation jobs), `ai/` (`anthropic.ts` model `claude-haiku-5-5` default,
`explain.ts`, `validate.ts` grounding + banned words), `demo/` (recorded-response transport for offline
demo), `fixtures/` (sample settings: `USDT_TRON`, `USDT_ETHEREUM`, `USDC_ETHEREUM`, BSC-USD as a
"sample setting"; confirmations tron 20 / ethereum 12 / bsc 15; one fabricated case per code), `lock.ts`
(per-file lock + atomic rename, one process only), `mode.ts` (`DEMO_MODE`), `data-dir.ts`, `limits.ts`,
`format.ts`, `view.ts`. `src/middleware.ts`: optional HTTP Basic auth (skips `/pay/`).

## 9. `src/app/api/` routes

| Route | Method | Does |
|---|---|---|
| `requests` | POST | create a payment request (`validateRequest`) |
| `requests/[id]/action` | POST | decide / owner / note / `attach_hash` (live Ethereum lookup) |
| `requests/demo` | POST | simulated provider: reset, send, mine, advance, redeliver |
| `requests/payments/confirm` | POST | a person assigns an unidentified payment |
| `pay/[publicId]/check` | POST | public sender address checker (`compareAddress`) |
| `accounting/[id]` | POST | approve and post (requires plan key) |
| `accounting/import` | POST | open invoices → payment requests (receiving address regex only, no EIP-55) |
| `accounting/xero/connect`, `.../callback` | GET | Xero OAuth |
| `uploads/[kind]` | POST | Files A/B upload + validation |
| `bulk`, `bulk/[id]`, `bulk/[id]/cases` | POST/GET/POST | bulk investigation |
| `payments/imports/[kind]`, `mappings`, `match`, `resolve`, `clear`, `export.csv` | various | payment records & matching |
| `inbox/[itemId]/action`, `inbox/[itemId]/evidence.pdf`, `inbox/resolve`, `inbox/routes` | various | exception inbox |
| `demo/reset`, `demo/bulk.csv` | POST/GET | deposit-desk demo |

## 10. Tests and how to run things

```
npm ci
npx tsc --noEmit          # typecheck
npx vitest run            # 21 files; 562 pass / 57 skipped on 2026-10-29 (scratch copy of main)
npx next build            # must be green before any PR
DEMO_MODE=off npm run dev # live mode; keys optional (.env.example)
OFFLINE_REPLAY_DIR=tests/fixtures/real npm run dev   # live mode answered from recordings, no network
RECORD_REAL=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/real-record.test.ts   # re-record real cases
```
Tests live in `tests/*.test.ts` (alias `@` = `src`, `server-only` stubbed). Protocol-relevant ones:
`chain.test.ts` (ABI, selectors, fetchers on stubs), `live.test.ts` (recorded TronGrid/Etherscan/RPC
replays), `real-cases.test.ts` (57 real public txs from `tests/real_cases.json`, answers proven
independently), `real-rules.test.ts` (claimedSymbol, looksAlike, isPoisoning), `engine.test.ts` (one
case per code), `requests.test.ts` (lifecycle + demo cases a-g), `accounting.test.ts` (posting rules).
Fixtures: `tests/fixtures/real/*.json` = real recorded request/response exchanges (`{name, hash,
recordedAt, exchanges[]}`); `tests/fixtures/live/` older recordings; `tests/fixtures/{payments,inbox}/`
synthetic CSVs; `src/lib/fixtures/` fabricated sample data.

## 11. Known gaps and TODOs (protocol-relevant; verified in code 2026-10-29)

| # | Gap | Where | Severity |
|---|---|---|---|
| G1 | Confirmations counted from **latest** head (Tron `/wallet/getblock`, EVM `eth_blockNumber`), not solidified/`finalized`; Tron 19-block solidification and Ethereum ~2-epoch finality not used | `chain/tron.ts`, `chain/evm.ts`, `engine/context.ts` | High before live crediting |
| G2 | **Reorg-blind**: mined tx/receipt/block cached forever; `ingest` keeps the first block number and never lowers confirmations; a re-included tx with a new `logIndex` gets a **second** observation key → can read as "paid twice"; payments `refresh.ts` never re-reads a found hash | `chain/evm.ts`, `requests/lifecycle.ts`, `payments/refresh.ts` | High |
| G3 | Payment-request receiving address and accounting-import address: regex only, **no EIP-55 checksum** (the CSV validator has one) | `requests/lifecycle.ts validateRequest`, `api/accounting/import` | Medium |
| G4 | Counterfeit with confusable symbol ("ÚЅDТ") is labelled `wrong_token`, not `counterfeit` (engine still says D06; never counted or posted) | `requests/lifecycle.ts transferIssue` | Low-Medium (explanation quality) |
| G5 | `tronToHex` doesn't verify the base58check checksum (only `csv/files.ts checkAddress` does) | `address.ts` | Low |
| G6 | Decimals come from the token's own `decimals()` at runtime; no expected-decimals check per official contract (BSC-USD and Binance-Peg USDC are **18**, not 6) | `chain/evm.ts tokenMeta` | Medium when BSC requests arrive |
| G7 | Pause state not read: USDC `paused()`/USDT `paused()` not checked; USDT `deprecated()`/`upgradedAddress()` not checked | `chain/investigate.ts` | Low (incoming mined transfers already happened) |
| G8 | No official contracts for Polygon/Base/Arbitrum/Optimism in settings, so a counterfeit "USDC" there is not D06-checked; Arbitrum USDT0 symbol is `USD₮0` (U+20AE), not recognised as USDT by `pickTransfer`/`claimedSymbol` | `fixtures/index.ts`, `engine/context.ts` | Low (cross-check chains only) |
| G9 | Single provider per chain; no cross-provider check of a "found/success" answer; a lying or stale RPC is believed | `chain/sources.ts` | Medium for pilots |
| G10 | No address watching / polling in live mode: a payment is found only when someone pastes the hash; issuer-freeze state is read only at lookup time | `requests/provider.ts`, `service.ts` | Product gap (documented in whitepaper 4.3) |
| G11 | D07b uses first-3/last-4 in the engine but the sender checker uses first-4 OR last-4; two definitions | `engine/context.ts`, `requests/lifecycle.ts` | Low |
| G12 | Wrong-network payment found by live lookup returns a message and records nothing | `requests/provider.ts` | Product gap |
| G13 | `claimedSymbol` strips only `\s` and U+200B-U+200D/U+FEFF; real counterfeit "USDT" symbols from the POISON-1 attacker contain U+200E, U+200F, U+2063 (Unicode format chars), so they are not read as claiming USDT: a deposit of one to a company address gets **D05 instead of D06** (checked 2026-10-29 by replaying through `investigate`) | `engine/context.ts claimedSymbol` | Medium (wrong diagnosis; still never credited) |
