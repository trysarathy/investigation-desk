# Attack and failure patterns: detection, and what the code does today

Code status verified against `main` (533b096) on 2026-10-29. "Today" = what the code does now, with file.
External facts labelled; see Sources.

| # | Pattern | Detect it by | Code today | Status |
|---|---|---|---|---|
| A1 | Address poisoning (zero-value / dust / forged) | intended vs actual destination + prior dust/forged transfer | Engine D07 (High) + D07b (Medium finding); payment-page checker | Partly |
| A2 | Look-alike address in a request or file | EIP-55 checksum, compare with known addresses | CSV only | Gap (G3) |
| A3 | Counterfeit token with same symbol | **contract address** ≠ issuer's official contract | D06; requests flag "counterfeit"/"wrong_token" | Never credited; diagnosis gaps (G13, G4, G8) |
| A4 | `transferFrom` spoofing / forged Transfer "from" a victim | Transfer emitted by a non-official contract, or zero value | Payment counts only the official contract; `isPoisoning` uses forged-out shape | Done |
| A5 | Dust deposits | amount ≤ dust threshold / below minimum | D08 minimums; dust threshold in D07b | Done for deposits; requests treat as short |
| A6 | Wrong-network deposit | same hash found on another chain; address registered elsewhere | D04 (deposits); requests: Tron recorded in demo, live lookup records nothing | Partly (G12) |
| A7 | Reorg double counting / phantom payment | finality tag, block-hash recheck, key independent of logIndex | Not handled | **Gap (G1, G2)** |
| A8 | RPC provider lying, stale or down | error → unknown; cross-check a second provider | Errors pause (good); no cross-check | Partly (G9) |
| A9 | Decimal errors | pin decimals per official contract; integer maths | Integer maths everywhere; decimals trusted from contract | Partly (G6) |
| A10 | Failed tx presented as payment | receipt `status`; Tron `receipt.result` | D03; null receipt = unknown | Done |
| A11 | Frozen sender / frozen receiving address | `isBlacklisted`/`isBlackListed` at lookup | D09 at lookup time only | Partly (G7, G10) |
| A12 | Payment-page / invoice tampering (EIP-681 swap) | integrity of the page; text beside QR | Random publicId; text shown | Residual risk |
| A13 | Prompt injection via chain/ledger data | AI sees evidence only; output validated | `ai/validate.ts`, system prompt | Done |

## A1. Address poisoning
**What.** The attacker generates a vanity address matching the first and last characters of an address
the victim sends to, then plants it in the victim's history: a zero-value `transferFrom` on the genuine
token, a dust transfer, or a forged Transfer from a counterfeit token "from the victim to the look-alike".
The victim later copies the wrong address from history. Scale: Tsuchiya et al. (USENIX Security 2025)
report ~270 million poisoning attempts against ~17 million victims on Ethereum and BNB Smart Chain, and
6,633 incidents with ≥ US$83.8 million lost (Jul 2022-Jun 2024) [ASSUMPTION: from search summaries of the
USENIX page and arXiv 2501.16681; neither opened from this session].
**Real cases in the repo** [VERIFIED from recordings and `tests/real_cases.json`]: POISON-1, 19 Dec 2025,
49,999,950 USDT to `0xbaff…f8b5` instead of `0xbaf4…f8b5` (first 3 + last 4 equal), 12 minutes after the
look-alike sent the victim 0.005 USDT; POISON-2, 9 Aug 2026, 39,889.952535 USDT after a forged
counterfeit-USDT transfer.
**Detect.** (1) Destination ≠ intended address (the fact: D07, High). (2) Destination looks like an
address the customer was meant to use (heuristic). (3) Before the payment, a dust-in or forged-out
transfer between the look-alike and the sender (heuristic). (2)+(3) = D07b, Medium, analyst confirms.
**Today.** `engine/context.ts looksAlike` (first 3 + last 4), `isPoisoning`, `chain/investigate.ts
historyFacts` (Tron TronGrid v1, Ethereum Etherscan `tokentx` or Blockscout; **off on BSC/Base/OP/Polygon/
Arbitrum**: public RPCs can't list history). Rule precedence keeps D07 as verdict, D07b as a finding.
Payment page: `compareAddress` (first 4 OR last 4) warns the payer *before* sending. Prevention beats
detection: the business's own published address is the one place we can help before money moves.

## A2. Look-alike or mistyped address entered by staff
**What.** A finance user types or pastes the receiving address of a request with one character wrong, or
pastes a poisoned address from their own history.
**Detect.** EIP-55 checksum on mixed-case input (catches typos, 0.0247% miss rate); compare with the
business's known wallets and flag near-misses (`looksAlike`).
**Today.** `validateRequest` and `/api/accounting/import` accept any `0x` + 40 hex (gap G3).
`csv/files.ts checkAddress` already implements EIP-55 and Tron checksums: reuse it.

## A3. Counterfeit token with the same symbol
**What.** Anyone can deploy an ERC-20/TRC-20 whose `symbol()` returns "USDT", "USDC", "ÚЅDТ", "USD₮" or
fullwidth "ＵＳＤＴ", and whose `decimals()` returns 6, and emit Transfers to you. Explorers may even label
the sender as an exchange hot wallet (SPEC D06 sources: imToken, Trust Wallet).
**Detect.** The log's emitting **contract address** must equal the issuer's official contract for that
chain. Symbol, name, decimals and the tx's `to` are never evidence of genuineness.
**Today.** Engine D06 via `impersonation` + `claimedSymbol` (NFKD + Cyrillic/Greek confusables);
requests count only `tokenContract == request.tokenContract`; accounting never posts it.
Gaps: (G13) `claimedSymbol` does not strip Unicode format characters (U+200E/U+200F/U+2063): the real counterfeit "USDT" tokens in POISON-1's history get D05, not D06; (G4) `transferIssue` labels a confusable symbol "wrong_token" instead of "counterfeit" (wording only);
(G8) no official contracts configured for Polygon/Base/Arbitrum/OP, and `₮` (U+20AE) isn't folded, so
Arbitrum's genuine-ish "USD₮0" isn't recognised as claiming USDT.

## A4. `transferFrom` spoofing / forged Transfer events
**What.** (a) Zero-amount `transferFrom(victim, lookalike, 0)` on the genuine token emits a real Transfer
"from" the victim without their signature (ERC-20 requires zero-value transfers to fire the event). (b) A
fake token emits `Transfer(victim → anyone, 1000000)` with no balance behind it.
**Detect.** For payments: only the official contract counts, amount > 0, and the payment must be a
Transfer **to** our address. For "who paid": the Transfer `from` is not proof the owner of `from` acted;
don't use it to infer the customer without File A / request context.
**Today.** Handled for counting (official contract + exact amounts). `isPoisoning` recognises the
forged-out shape (zero value or different contract).

## A5. Dust
**What.** Tiny transfers to seed poisoning, probe addresses, or (on UTXO chains) deanonymise.
**Detect.** Amount ≤ `Settings.dustThreshold` or below the company minimum.
**Today.** D08 below-minimum for deposits; requests treat a tiny transfer as a short payment needing
review (it never auto-completes). Consider auto-dismissing confirmed zero-value transfers from the
request view so they don't create noise (not built).

## A6. Wrong-network deposit
**What.** USDT/USDC sent to the right **address** on the wrong **chain** (Arbitrum instead of Ethereum,
BSC instead of Ethereum). Funds are only recoverable if the business controls that key on that chain
(EOA: yes in principle; contract wallet: maybe not; exchange deposit address: depends on the exchange).
**Detect.** Look the hash up on every chain (done: `ALL_CHAINS`); destination registered for another chain.
**Today.** D04 for deposits (High), next step depends on `keysHeldOnOtherChains`. Requests: a wrong-network
transfer is `wrong_network`, never posted, a person may accept it if it landed in the business's own
wallet there. Live `LiveHashProvider` returns a message and **records nothing** for a non-Ethereum hash
(G12), so the evidence is lost. Real case NET-ARB: 3,876.96 USDT0 on Arbitrum to an Ethereum deposit
address [VERIFIED recording].

## A7. Reorg double counting and phantom payments
**What.** A transfer seen at shallow depth disappears (orphaned) or is re-included in another block at a
different logIndex. Counting it before finality, or keying it by logIndex, yields a payment that never
happened or one counted twice.
**Detect.** Gate irreversible actions on the chain's finality signal (`finalized` tag, Tron solidified
head); re-read the receipt and compare `blockHash` to the canonical block at that height; key
observations by `chain + txHash + position of the transfer within the tx` (stable across re-inclusion),
keep `blockHash`/`logIndex` as attributes that may change; honour `removed: true`.
**Today.** Not handled (G1, G2): latest-based counts; mined tx/receipt/block cached forever; `ingest` keeps
the first block number and never lowers confirmations; observation key includes logIndex, so re-inclusion
creates a second observation → "Paid twice" + refund suggestion. Payments `refresh.ts` never re-reads a
found hash. The whitepaper (4.5) states "does not handle chain reorganisations" [VERIFIED].

## A8. RPC/indexer provider lying, stale, rate-limiting or down
**What.** A public or compromised RPC returns `null` for a real tx (looks "not found"), a stale head (fewer
confirmations), a pruned receipt, or fabricated data. Rate limits look like errors.
**Detect.** Treat every error/timeout/`null` receipt for a mined tx as **unknown**; for "found and
success" before an irreversible action, confirm with a second independent provider (receipt hash, status,
log set must match); compare heads across providers; record which provider answered.
**Today.** Good: errors pause the case (`run.ts`), null receipt = unknown (`evm.ts`, after real-data
test showed publicnode returning null receipts), Blockscout throws if history wasn't fully read, raw
responses stored with sha256. Gap: single source per chain; no cross-check (G9).

## A9. Decimal errors
**What.** Reading 18-decimal BSC-USD as 6 (×10^12), floats rounding 0.1+0.2, a fake token's
`decimals()` lying, amounts like `1e3` from an API.
**Detect.** Integer base units end to end; pin expected decimals per official contract; reject
non-decimal strings.
**Today.** Integer/decimal-string maths everywhere (`decimal.ts`, `money.ts`, `formatUnits`, `toBaseUnits`);
non-decimal amount = unknown fact. Decimals are trusted from `decimals()` per contract (G6); request amounts
assume 6 dp (`USDC_DECIMALS`), correct only for Ethereum USDC/USDT.

## A10. Failed transaction presented as payment
**Detect.** EVM `receipt.status == 0x0`; Tron `receipt.result != SUCCESS` (REVERT, OUT_OF_ENERGY,
OUT_OF_TIME). No logs are emitted; only the call data shows intent.
**Today.** D03; intended transfer decoded from call data for the explanation only; never counted.

## A11. Frozen sender or frozen receiving address
See `issuer-controls.md`. Today: D09 at lookup time; freeze state at payment time is not proven; no
periodic re-check of the business's own receiving addresses (G10).

## A12. Payment-page or invoice tampering
**What.** An attacker sends the customer a fake invoice/payment page or swaps the QR (EIP-681 security
considerations).
**Today.** Random unguessable `publicId`; page shows contract, network, address and amount as text.
Impersonation of the business is "not solved" (whitepaper A.7) [VERIFIED].

## A13. Prompt injection through data
Ledger notes or token names can contain "ignore previous instructions". Today: the AI receives evidence
objects only, never decides a verdict, and `ai/validate.ts` rejects ungrounded facts and banned words;
falls back to templates. Keep it that way; never let chain-sourced strings reach a prompt unquoted.

## Sources
- ERC-20 zero-value Transfer rule: https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-20.md (accessed 2026-10-29) [VERIFIED]
- Tsuchiya et al., "Blockchain Address Poisoning", USENIX Security 2025: https://www.usenix.org/conference/usenixsecurity25/presentation/tsuchiya ; arXiv https://arxiv.org/abs/2501.16681 (search summary only, 2026-10-29) [ASSUMPTION]
- ERC-681 security considerations: https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-681.md [VERIFIED]
- Repo: `tests/real_cases.json` (POISON-1/2, NET-ARB, FAKE-*, FRZ-*), `tests/fixtures/real/*.json`, whitepaper `origin/whitepaper:whitepaper/Clearline_Whitepaper.md` sections 4.3, 4.5, A.7 [VERIFIED]
