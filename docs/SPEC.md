# Product Spec v1 — Stablecoin Payment Investigation Desk

Oct 21, 2026 · @Aashmiin Kaur

## Head-of-product verdict

**Build it, but only as a tool that joins on-chain data with the company's own ledger.** Without the ledger it is a block explorer with nicer sentences, and exchanges already ship self-serve versions of that (Binance.US has a deposit recovery tool where users paste a hash, network and address).

Five honest concerns before anyone writes code:

1. **The easy diagnoses are commoditised.** Wrong network, failed transaction and pending confirmations can each be read off any explorer. Our value is the last mile: "the chain says it arrived, your ledger says it didn't, and here is why" (diagnosis D12). That case needs the customer's data, so data access is the real product risk. \[ASSUMPTION\]
2. **This is the deposit-side problem, not the fiat-payout problem.** The CloseTrace brief's "provider says completed, recipient says not received" fiat leg is out of v1. That is a deliberate scope choice, revisited after interviews.
3. **Some famous causes don't apply to our v1 chains.** USDT and USDC on Tron, Ethereum and BNB Chain use unique deposit addresses, so "missing memo" is rare for us. It stays in the catalogue as out-of-scope so nobody builds it by mistake.
4. **Three AIs, one spec.** Claude Code builds from this document. ChatGPT reviews only. If an AI proposes a different architecture, this doc wins unless you change it here.
5. **Interviews still decide.** The 20 Nov kill date and its criteria from the decision spec still stand. Nothing here is customer-validated yet.

Labels: \[VERIFIED\] = backed by a cited source (see Sources). \[ASSUMPTION\] = a product decision to test. \[GUESS\] = an estimate with no data behind it.

## 1. Problem, user and metrics

**Problem:** when a customer says "I sent USDT but it hasn't arrived", the ops analyst has to check a block explorer, the deposit-address list, the ledger and the compliance queue by hand to find out why, and then write a careful reply.

**User:** payment operations or support analyst (daily user). **Buyer:** head of operations or COO.

**Company type:** Singapore- or India-facing firms that receive customer stablecoin deposits into company-controlled addresses: exchanges, OTC desks, stablecoin payment-acceptance and remittance firms. \[ASSUMPTION: these firms generate the most "not arrived" tickets.\]

### Before and after

| Step | Today | With us |
| --- | --- | --- |
| Find the transaction on the right chain | Explorer search, often several chains | Automatic lookup across all supported chains |
| Check address, token, amount, confirmations | Manual comparison | Deterministic checks |
| Check the company ledger and holds | Separate admin tool or ask another team | Joined automatically from the ledger CSV |
| Write the customer reply | Typed from scratch | Draft from an approved template |
| **Time per ticket** | **15–30 minutes \[GUESS — measure in interviews\]** | **Under 3 minutes \[ASSUMPTION — target\]** |

### Success metrics

| Metric | Definition | v1 target |
| --- | --- | --- |
| Time to diagnosis | Median seconds from case open to verdict shown | Under 10 s for a single hash |
| Time to resolve | Median minutes from ticket open to reply sent, before vs after | 70% reduction \[ASSUMPTION\] |
| Auto-diagnosed rate | Cases where the engine returns a High-confidence verdict | 70% of real cases \[GUESS\] |
| Verdict accuracy | High-confidence verdicts later judged correct by the analyst | 98% or better, measured on a labelled set of 200 past cases |
| Wrong high-confidence verdicts | Count in the pilot evaluation | Zero (release gate) |
| Honest unknowns | Cases marked Unknown instead of a guessed verdict | Tracked; never forced to zero |

## 2. Diagnosis catalogue

The engine runs every check. The verdict follows catalogue order as modified by "Rule precedence" below; every other matching rule is attached to the case as a finding (revised 22 Oct). Codes are stable identifiers the code, the UI and the reply templates all share.

**Confidence rules:** High = read directly from chain data or a company record. Medium = a heuristic that an analyst must confirm. Low is never shown as a verdict; it becomes Unknown.

| Code | Diagnosis | Detection rule | Evidence shown | Conf. | Next step | Source |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | Not found on any chain | Hash not found on Tron, or on any Etherscan V2 chain ID in the cross-check list | Per-chain lookup results with timestamps | High | Ask customer for the correct hash or the sending platform's withdrawal record | [OneKey](https://help.onekey.so/en/articles/12569147-deposit-hasn-t-arrived) |
| D02 | Waiting for confirmations | Tx succeeded; current block minus tx block is less than the company's threshold for that chain | Confirmations n of N, estimated time left | High | Wait; auto-recheck every 60 s | [Kraken](https://support.kraken.com/hc/en-us/articles/203325283) |
| D03 | Transaction failed | EVM receipt status = 0, or Tron receipt result is not SUCCESS (for example OUT\_OF\_ENERGY, REVERT) | Receipt status, error code, fee burned | High | Customer resends; no tokens moved | [D'CENT](https://support.dcentwallet.com/hc-faq/coin-send-receive/i-cant-send-tron-trc20-tokens-token-sending-keeps-failing) |
| D04 | Wrong network (EVM) | Same hash found on a different EVM chain; Transfer event `to` is a company deposit address | Chain ID found vs expected, Transfer event | High | Ops decides recovery under policy if the company holds that key on that chain; otherwise unrecoverable | [Binance.US](https://support.binance.us/hc/en-us/articles/4404564207255-Unsupported-Asset-Recovery) |
| D05 | Unsupported token | Transfer to a company address but token contract not on the company's allowlist for that chain | Token contract, symbol, allowlist | High | Apply unsupported-asset policy | [Binance.US](https://support.binance.us/hc/en-us/articles/4404564207255-Unsupported-Asset-Recovery) |
| D06 | Fake token | Token symbol is USDT or USDC but contract address differs from the official contract | Official vs received contract, side by side | High | Not credited; flag to compliance as a possible scam | [Trust Wallet](https://support.trustwallet.com/en/articles/800584-how-can-i-troubleshoot-usdt-balance-and-transaction-issues-in-trust-wallet), [imToken](https://support.token.im/hc/en-us/articles/59274708455193-Beware-of-Fake-USDT-An-Exchange-Hot-Wallet-Label-Is-Not-an-Endorsement-Security-Monthly-Report-49th-Issue) |
| D07 | Wrong address | Destination is not in the deposit-address list and not assigned to this customer | Expected vs actual address | High | Unrecoverable by the company; advise customer | [Binance.US](https://support.binance.us/hc/en-us/articles/360054810374-What-can-I-do-if-I-sent-crypto-to-the-wrong-address) |
| D07b | Look-alike (poisoned) address | D07, plus the destination matches the customer's assigned address on the first 4 and last 4 characters, plus a zero-value or dust transfer from that address appears in the sender's history before the payment | Character-level diff, the earlier poisoning transfer | Medium | Analyst confirms; security notice to customer | [Elliptic](https://www.elliptic.co/blockchain-basics/what-is-address-poisoning/), [CMU paper](https://arxiv.org/html/2501.16681v1) |
| D08 | Below minimum deposit | Amount is less than the company's configured minimum for that token and chain | Amount vs minimum | High | Apply the company's policy (credit on aggregation, or not credited) | [Revolut](https://help.revolut.com/help/wealth/cryptocurrencies/transferring-cryptocurrencies/depositing-cryptocurrencies/issues-with-crypto-deposits/what-happens-if-deposit-is-below-the-minimum-deposit-limit/), [BVNK](https://help.bvnk.com/hc/en-us/articles/37588695187346-Minimum-Transaction-Amounts-FAQ) |
| D09 | Issuer freeze | Read-only call: USDT `isBlackListed(address)` or USDC `isBlacklisted(address)` is true for the sender or the deposit address | Contract call result and block number | High | Escalate to compliance; reply makes no promise | [BlockSec](https://blocksec.com/blog/usdt-blacklist-explained-2026), [Circle implementation](https://medium.com/@j2abro/circle-usdc-blacklist-implementation-8a7bab143a93) |
| D10 | Pending or congested | Tx in mempool but not mined after the chain's normal window | Time pending, current gas price | Medium | Wait; sender may replace the tx | [TokenPocket](https://help.tokenpocket.pro/en/transfer-faq/why-did-i-not-receive-my-funds-from-the-wallet-to-the-exchange) |
| D11 | Sender exchange issue | Customer gave an exchange withdrawal ID, not a hash; or the hash is a batch contract call (handled by decoding Transfer events, so it is not a failure) | Event index inside the batch, or "no on-chain hash yet" | Medium | Ask the sending exchange for the on-chain hash | [TokenPocket](https://help.tokenpocket.pro/en/transfer-tutorial/transfer-faq/why-did-i-not-receive-my-funds-from-the-exchange-to-the-wallet), [Zero Hash](https://docs.zerohash.com/changelog/enhanced-zero-hash-transfers) |
| D12 | **Arrived on-chain, not credited** | Tx confirmed, correct address, token and amount at or above minimum, but no matching credit in the ledger CSV | Chain proof plus the missing or pending ledger row | High | Escalate internally with the evidence pack (indexer lag, ops backlog) | [Cobo](https://help-center.cobo.com/en/articles/15222810-self-service-troubleshooting-guide-for-missing-deposits) |
| D13 | Already credited | Ledger shows a credit for this tx hash | Ledger row, credit time | High | Tell the customer where the credit appears | Company records |
| D14 | On hold | Ledger status = HELD or REVIEW | Ledger status and timestamp only | High | Route to compliance; neutral reply only | Company records |
| D15 | Missing memo or tag | Out of v1: our v1 chains use unique deposit addresses | — | — | — | [Keplr](https://help.keplr.app/troubleshooting/5R3bMyjtr2Qj3TcLwuW7J6/resolve-a-missing-memo-issue/5So5gM41LifQhxiMqFUt9k) |
| D99 | Unknown | No rule matched with High confidence | Every check run, and its result | — | Analyst investigates manually | — |

**D16 — Rejected by company** (added 21 Oct). Detection: tx confirmed, correct address and token, and the ledger row for this exact tx hash has status REJECTED. Evidence: ledger row and any reason code. Confidence: High that it was rejected; the reason is only as good as the ledger's reason code. Next step: route to the deposits team for the reason. Reply: neutral, as D14.**D17 — Sent to another customer's address** (added 22 Oct). Detection: the destination is a company deposit address in File A, but assigned to a different customer than the one in this case. Confidence: High (from File A). Next step: ops checks whether the customer reused an address meant for someone else, then decides any reallocation under policy. The reply must never reveal the other customer: "We've found your transfer and our team is reviewing how it was routed. We'll update you by {date}." **D12 now requires the destination to be assigned to this customer.**

**D18 — Sent to a retired address** (added 22 Oct). Detection: the destination is in File A, but the transfer's block time is after that address's `retired_at`. Confidence: High. Next step: ops decides crediting under the company's retired-address policy (a new Settings field). Reply: neutral, as D17.

**D10 depends on mempool data (22 Oct).** Week 2 must check whether TronGrid or Etherscan V2 expose pending transactions reliably. If not, D10 is disabled, and an unconfirmed or missing hash falls to D01, whose reply already covers "may not have been sent yet".

**`{where_in_app}` in D13 is a company setting**, entered once in Settings, not typed by the analyst on every reply.

### Rule precedence (signed off 21 Oct)

Strict "first High match wins" gave wrong answers in five cases, so these guards override catalogue order:

1. **D02** matches only a deposit that would otherwise be credited. A fake token, wrong address or below-minimum deposit with few confirmations gets its own code, never D02.
2. **D05** skips a token only when its symbol is USDT or USDC and its contract differs from the official one, because that case is D06 (fake token). A genuine USDT or USDC the company doesn't accept is still D05 (revised 22 Oct).
3. **D07b** does not replace D07 (revised 22 Oct). When the look-alike pattern is present, the verdict stays D07 (High: the funds went to an address that isn't the customer's) and D07b is added as a Medium "likely cause" finding that the analyst confirms. A heuristic never hides an established fact.
4. **REJECTED** ledger rows get D16, not D99.
5. **D12, D13, D14, D16** decide a High verdict only on an exact match of chain + tx\_hash + transfer index (EVM log index or Tron event index) + token contract (revised 22 Oct). One transaction can contain several transfers. If the ledger has no transfer index and the transaction holds more than one transfer to company addresses, the verdict caps at Medium. File B gains an optional \`transfer\_index\` column. A row that matches only on address and amount is shown as evidence and caps the verdict at Medium.

**Data-quality guards (22 Oct, from code review):**

- No rule may match on a missing fact. If the current block height, a confirmation count or an amount is unknown, the case is "Check paused" (chain unavailable) or D99, never D02 or D12.
- Addresses and contracts are compared in one canonical form per chain: EVM lowercase hex with `0x`; Tron base58 (hex `41…` is converted before comparing).
- An amount from chain data that isn't a plain decimal string (for example `1e3`) makes that fact unknown; it never crashes the investigation.
- The address-and-amount ledger fallback only considers rows for this case's customer, dated at or after the transfer's block time. D13 also requires the ledger row's customer to be this case's customer.

**D18 reply:** same as D17.

**Rule for all replies (22 Oct):** no template may promise a future credit. Chain evidence establishes eligibility; only a ledger row establishes a credit.

**Scope decision (22 Oct): v1 stays on the deposit side.** A reviewer flagged that the build investigates deposits while the older CloseTrace brief described fiat payouts. That is deliberate (see the verdict at the top): deposits can be diagnosed from public chain data plus one CSV, so they can be demoed now; the payout leg needs partner data we don't have. The hedge: the data model must also hold payout events, provider statuses and later returns, so adding the payout workflow later is new rules, not a rewrite. Interviews decide which workflow v2 adds.

Sources are vendor help centres \[VERIFIED as what each vendor publishes\], not proof of how often each cause happens. Frequency per cause is \[GUESS\] until we label real tickets.

**Official contracts the checks use:** USDT on Tron `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` \[VERIFIED, Trust Wallet and imToken\]. USDT on Ethereum `0xdAC17F958D2ee523a2206206994597C13D831ec7` \[VERIFIED, Coinbase asset page\]. USDC on Ethereum, and USDT and USDC on BNB Chain: \[ASSUMPTION\] confirm against Tether's and Circle's official contract pages before the build; never hard-code from memory.

### Customer reply templates

Every reply is a draft the analyst edits and sends. None promises an outcome.

- **D02:** "Your transfer is on the {chain} network and has {n} of {N} confirmations. Once it reaches {N} confirmations it becomes eligible for crediting, usually within {eta}. We'll update you once our checks are complete."
- **D03:** "Your transaction failed on the network ({error}), so no {token} left your wallet. You can send it again; network fees for the failed attempt are not refundable."
- **D04:** "Your {token} was sent on {found\_chain}, but we only accept it on {expected\_chain}. Our team is reviewing whether it can be recovered. We'll update you by {date}."
- **D06:** "The token you sent is not genuine {symbol}: its contract address doesn't match the official one. It can't be credited. Please be cautious with whoever supplied it."
- **D07/D07b:** "The funds went to {short\_addr}, which is not your deposit address. We can't access or recover funds at that address. Always copy your address from our app, never from your transaction history."
- **D08:** "Your deposit of {amount} is below our minimum of {min} {token}. {policy\_sentence}"
- **D12:** "We can see your transfer arrived on {chain}. Our team is checking why it hasn't been credited yet and will update you by {date}."
- **D09, D14:** "Your deposit is under review. We'll contact you when the review is complete."

Added 21 Oct for codes that had no template:

- **D01:** "We couldn't find a transaction with that ID on {chains\_checked}. Could you send the transaction hash from the sending app's withdrawal history? If the sending platform shows it as pending, it may not have been sent yet."
- **D05:** "We received {token} on {chain}, which we don't support for deposits. Our team is reviewing your case under our unsupported-asset policy and will update you by {date}."
- **D10:** "Your transaction is still waiting to be processed by the {chain} network. Once the network confirms it, our usual deposit checks apply. If it's still pending after {window}, please let us know."
- **D11:** "The ID you sent is a withdrawal reference from the sending platform, not a network transaction hash. Please ask them for the on-chain transaction hash, or check whether the withdrawal has been sent yet."
- **D13:** "Your deposit of {amount} {token} was credited on {credited\_at}. You can see it under {where\_in\_app}."

**Legal note for D09 and D14:** replies must never mention sanctions, AML or suspicion, to avoid tipping-off. \[ASSUMPTION — have a compliance lawyer review this template before any pilot.\]

## 3. Chains and tokens for v1

**v1 deposit chains: Tron, Ethereum, BNB Chain, with USDT and USDC only.** Volume rankings disagree depending on who measures and how, so we rank on payment-relevant data rather than raw volume.

What the sources say:

- Tron carries 60–80% of real-economy stablecoin payment flows, though its share fell from about 74% to about 60% during 2025 \[VERIFIED, BCG/Allium\].
- Roughly 93% of Tron's stablecoin transfer volume is peer-to-peer, the highest of any chain \[VERIFIED, CoinDesk Q2 2026\].
- On Visa's bot-filtered measure, Tron's share fell to 14.6% in February 2026, when Solana led \[VERIFIED, Forklog citing Visa\]. Raw-volume and adjusted-volume rankings point in opposite directions.
- BNB Chain handles about 40% of global stablecoin transaction count but smaller transfer sizes \[VERIFIED, DL Research\].

| Rank | Chain | v1 role | Why | Read-only data source |
| --- | --- | --- | --- | --- |
| 1 | Tron | Deposit chain | Dominant payment and P2P rail in Asia | TronGrid V1 API (`/v1/accounts/{address}/transactions/trc20`, API key in `TRON-PRO-API-KEY`, about 15 requests/s per key) \[VERIFIED, TRON docs\] |
| 2 | Ethereum | Deposit chain | Largest supply; institutional flows | Etherscan API V2 with `chainid=1`, one key across 50+ EVM chains \[VERIFIED, Etherscan docs\]; an RPC provider as fallback |
| 3 | BNB Chain | Deposit chain | High transaction count; exchange-linked liquidity in Asia | Etherscan API V2, `chainid=56` |
| — | Polygon, Base, Arbitrum, Optimism | Cross-check only | Same 0x address format, so wrong-network sends land here (D04) | Etherscan API V2 lookups by chain ID; no deposits accepted |
| 4 | Solana | v1.1 | Huge USDC volume, but a different account model (token accounts) and RPC | Solana RPC provider; deferred |

Tron's USDC status needs checking before build: Circle has wound down USDC on some chains \[ASSUMPTION — verify on Circle's site\]. If it is not supported, Tron is USDT-only.

**Confirmation thresholds** are company settings, not our constants. Defaults to offer: Tron 20, Ethereum 12, BNB Chain 15. Binance's published counts per the eco.com summary \[VERIFIED as reported there; re-check each exchange's page before pilots\].

**Data sources, revised 22 Oct (after Week 2):** Etherscan's free plan refuses BNB Chain, Base and Optimism \[VERIFIED, Week 2 live test and [Etherscan docs](https://docs.etherscan.io/resources/common-error-messages)\]. Until a paying pilot exists, those chains use free official public RPCs, by transaction hash only (`eth_getTransactionByHash`, `eth_getTransactionReceipt`, `eth_blockNumber`; Transfer events come from the receipt's logs, so `eth_getLogs` isn't needed):

| Chain | Chain ID | Source until a paying pilot |
| --- | --- | --- |
| BNB Chain | 56 | `https://bsc-dataseed.bnbchain.org` — official; about 10,000 requests per 5 minutes per IP; `eth_getLogs` disabled \[VERIFIED as reported by [OnFinality](https://www.onfinality.io/en/rpc-assistant/bnb-smart-chain-endpoint)\] |
| Base | 8453 | `https://mainnet.base.org` \[VERIFIED, [Base docs](https://docs.base.org/base-chain/quickstart/connecting-to-base.md)\] |
| Optimism | 10 | `https://mainnet.optimism.io` \[ASSUMPTION — confirm in Optimism docs before use\] |
| Polygon, Arbitrum | 137, 42161 | Etherscan V2 if the free key allows; otherwise their official public RPCs \[ASSUMPTION — test in Week 3\] |

Public RPCs are shared and rate-limited, so they suit development, demos and a first pilot only \[ASSUMPTION\]. Move to a managed RPC provider or Etherscan's paid plan (from US$49/month \[VERIFIED, [Yahoo Finance](https://finance.yahoo.com/news/ethereum-explorer-etherscan-locks-avalanche-143215634.html)\]) once a pilot pays. The look-alike check (D07b) needs a sender's transfer history, which public RPCs can't list: on these chains D07b stays off until then.

**D10 is disabled by default (22 Oct).** Week 2 found that neither TronGrid nor Etherscan gives a reliable pending list or a "first seen" time. A pending or missing hash falls to D01. D10 can return once cases are stored (Week 5) and we record our own first-seen time.

## 4. Inputs from the company

CSV upload in v1, read-only API pull in v2. Three files, UTF-8, one header row. Amounts are decimal strings, never floats. Timestamps are ISO 8601 with an offset.

**File A — deposit addresses** (required)

| Column | Type | Required | Example |
| --- | --- | --- | --- |
| `address` | string | yes | `TQx…` |
| `chain` | enum: tron, ethereum, bsc | yes | `tron` |
| `customer_id` | string | yes | `C-10422` |
| `assigned_at` | timestamp | yes | `2026-09-01T10:00:00+08:00` |
| `retired_at` | timestamp | no | blank |

**File B — deposit ledger** (required)

| Column | Type | Required | Notes |
| --- | --- | --- | --- |
| `deposit_id` | string | yes | Company's own ID |
| `tx_hash` | string | yes, if known | Join key to the chain |
| `chain`, `token` | enum | yes |  |
| `to_address` | string | yes |  |
| `amount` | decimal string | yes |  |
| `status` | enum: CREDITED, PENDING, HELD, REVIEW, REJECTED | yes | Mapped from the company's statuses at setup |
| `credited_at` | timestamp | no |  |
| `customer_id` | string | yes |  |

Added 22 Oct to File B: `transfer_index` (integer, optional: EVM log index or Tron event index) and `reason_code` (string, optional: the company's own rejection or hold reason).

**File C — customers** (optional): `customer_id`, display reference. No names, emails or ID documents are needed or accepted.

**Company settings** (entered in Settings, not CSV): accepted token contracts per chain, confirmation thresholds, minimum deposit per token, below-minimum policy text, and whether ops holds keys on other EVM chains (this decides the D04 next step).

**Validation rules:** reject the file if required columns are missing. Reject a row if an amount does not parse exactly as a decimal, if a chain value is unknown, or if a timestamp has no offset. Show row-level errors; never silently fix data. Re-uploading a file with the same SHA-256 hash is a no-op.

## 5. Screens

Four screens, one left sidebar (Queue, Bulk, Settings), and a command bar opened with ⌘K or Ctrl+K that accepts any hash, address or customer reference.

### 5.1 Case queue (default screen)

**Layout:** header with a search/paste field and "New case". Filter chips: All, Needs action, Waiting, Resolved, Unknown. A table with one row per case: case ID, customer ref, chain badge, token and amount, verdict code with a one-line label, confidence, age, owner.

**Behaviour:** pasting a hash anywhere creates a case and opens it. Rows sort by "needs action" first, then age. Arrow keys move between rows, Enter opens, `A` assigns to me.

| State | What shows |
| --- | --- |
| Loading | Skeleton rows, no spinners over data |
| Empty (new workspace) | "Paste a transaction hash to investigate your first case." plus a sample-data button |
| No filter match | "No cases match these filters." and a Clear button |
| Data stale | Amber bar: "Ledger last uploaded {time}. Verdicts that depend on it may be out of date." |
| Chain API down | Red bar naming the chain; affected cases show "Check paused", never a guessed verdict |

### 5.2 Investigation view

**Layout, top to bottom:**

1. **Verdict bar:** code, plain-English verdict, confidence label, and the sentence "Based on {n} checks at {time}."
2. **Two columns.** Left (wide): the evidence timeline, one row per fact: customer instruction, chain transaction, confirmations, token contract check, address check, ledger row. Each row has a status icon with a text label, the value, and a source link (explorer URL or ledger row number). Right (narrow): next step, owner, case status, and the reply draft with Copy and Edit.
3. **Checks run:** a collapsible list of every check and its result, including the ones that passed.

**Keys:** `C` copies the reply, `E` edits it, `R` re-runs the checks, `Esc` goes back to the queue.

| State | What shows |
| --- | --- |
| Checking | Verdict bar reads "Checking {chain}…"; timeline rows fill in as checks complete |
| High verdict | Full layout as above |
| Medium verdict | Amber verdict bar: "Likely — confirm before replying." Reply stays locked until the analyst ticks Confirm |
| Unknown (D99) | "No rule matched." Shows all checks run and a notes field. No reply draft |
| Contradiction | A later re-check changes the verdict: red banner "Verdict changed from D02 to D12 at {time}"; history kept |

### 5.3 Bulk CSV investigation

Upload a CSV with columns `tx_hash, chain (optional), customer_id (optional)`, up to 1,000 rows. A progress bar runs, then a results table with the same columns as the queue, plus "Create cases for non-credited" and "Export results CSV". Row errors are shown inline; bad rows are skipped, never guessed.

### 5.4 Settings and connections

Tabs: **Data** (upload Files A–C, last upload time, row counts, errors), **Rules** (token allowlist, confirmation thresholds, minimums, below-minimum policy, keys-held-on-other-chains toggle), **Team** (members and roles), **Audit log** (read-only). Changing a rule creates a new rule version; existing verdicts keep the version they used.

## 6. Rules for the engine and the AI

**The verdict is computed by code. The AI only writes sentences about a verdict that code has already produced.**

Pipeline for one case:

1. **Normalise input.** Detect type by format: a 64-hex string (with or without `0x`) is a hash; `T` + 33 base58 characters is a Tron address; `0x` + 40 hex is an EVM address; anything else is a customer reference, looked up in File A.
2. **Fetch facts.** Call the chain APIs (section 3) and read the uploaded ledger. Store every raw response with its fetch time and a SHA-256 of the body.
3. **Run rules** every rule (D01–D18 and D99). Each rule is a pure function: `(facts, settings, rule_version) → {code, confidence, evidence_ids[]}`. No network calls inside rules.
4. **Pick the verdict:** the highest-priority High match under "Rule precedence" wins, and every other matching rule is attached as a finding. If none, the first Medium match is shown as "Likely". If none, D99.
5. **Write text.** Pass the AI only the verdict code, the evidence objects and the reply template. It returns one plain-English paragraph and a filled reply.
6. **Validate text.** Reject the AI output, and fall back to the plain template, if it contains a number, address, hash, date or token name that does not appear in the evidence objects, or any word from the banned list ("guaranteed", "definitely", "refund", "sanction", "AML", "fraud").

Hard rules:

- The AI never decides a code, a confidence or a next step.
- Every sentence in the explanation must map to at least one evidence ID; the UI renders those as links.
- Customer data sent to the AI is limited to the evidence objects: no customer names, emails or IDs. Use a provider with a no-training, zero-retention agreement. \[ASSUMPTION: required by design partners.\]
- If the AI is unavailable, the product still works with template text. The AI is a convenience, not a dependency.
- Every verdict records the rule version, settings version and evidence hashes, so it can be reproduced later.

**Tests that must pass before any pilot:** one fixture case per code D01–D18 plus D99, a contradiction case (D02 becomes D12 after re-check), a malformed-CSV case, and a prompt-injection case (a ledger note saying "ignore instructions" must not change the output).

## 7. Trust and security

**Read-only by construction:** the product holds no private keys, no seed phrases and no signing ability, and calls only read endpoints. Our chain API keys are ours, not the customer's. There is no code path that can move funds.

| Area | v1 requirement |
| --- | --- |
| Data collected | Addresses, tx hashes, amounts, statuses, pseudonymous customer IDs. No names, emails, phone numbers or ID documents. |
| Storage | Managed Postgres in a Singapore region; uploads in private object storage; encryption at rest and in transit |
| Tenancy | Every row carries `workspace_id`; enforced by Postgres row-level security and tested with cross-tenant access tests |
| Authentication | Invite-only workspaces, email plus mandatory TOTP two-factor; sessions expire after 12 hours |
| Retention | Pilot data deleted 90 days after the pilot ends, or on request; deletion is logged |
| Audit log | Append-only record of logins, uploads, case views, verdict changes, reply copies, exports and settings changes, with actor, time and IP |
| AI provider | Receives evidence objects only; contract must state no training and no retention |
| Personal data law | Singapore PDPA obligations on protection, retention and overseas transfers apply \[ASSUMPTION — the CloseTrace brief cites PDPC guidance; not re-checked here\]; India DPDP applicability needs legal review \[ASSUMPTION\] |

**Roles:**

| Action | Analyst | Lead | Admin |
| --- | :-: | :-: | :-: |
| Open cases, run checks, copy replies | Yes | Yes | Yes |
| Bulk investigation, export | No | Yes | Yes |
| Upload data files, change rules | No | No | Yes |
| Invite or remove members, view audit log | No | No | Yes |

**Before any real customer data:** an independent security review and a written data-processing agreement. Building with AI does not remove this step.

## 8. Pricing hypothesis and what is not in v1

**Recommendation: a per-workspace platform fee with seats included, not per-case pricing.** Per-case pricing makes analysts hesitate before opening a case, which defeats the product. \[ASSUMPTION\]

| Plan | Price | Includes |
| --- | --- | --- |
| Pilot | US$1,500 for 4 weeks | 3 seats, 1,000 investigations, bulk run of 60 days of past tickets, weekly review |
| Team | US$1,500/month | 5 seats, 3,000 investigations a month, all v1 features |
| Extra seat | US$150/month | — |
| Overage | Soft cap: warning at 80%, conversation at 100%; nothing is blocked mid-investigation | — |

All prices are \[ASSUMPTION\]. I found no public price for a directly comparable product, so test these in the pilot and expect Singapore and India mid-market firms to push back on anything above this.

**Not in v1:**

- Solana, TON, and any chain beyond those in section 3.
- Memo- or tag-based deposits (D15).
- The fiat payout leg ("provider says completed, recipient says not received").
- Live API connectors to the company's systems: CSV only.
- Sending replies to customers: copy only, no integrations with Zendesk or Intercom.
- Recovering funds, signing, or any transaction.
- Sanctions screening or AML risk scoring (we read issuer freezes only).
- AI that changes a verdict, a confidence or a next step.
- Mobile apps, SSO, self-serve sign-up.

## 9. Design direction

**Calm, dense and fast, like Linear's speed and Stripe's object pages.** The product should feel like a precise instrument, not a crypto dashboard.

- **Colour:** off-white canvas `#F7F7F5`, white panels, near-black text `#17181C`, one accent blue `#3B5BDB`. Semantic colours only for evidence: green = check passed, amber = needs confirming or waiting, red = failed or contradiction. No gradients, no neon, no coin logos as decoration. Full dark mode.
- **Type:** Inter for UI at 13–14 px body; JetBrains Mono (or system mono) for hashes, addresses and amounts with tabular numerals. Truncate long values in the middle (`TR7NHq…gjLj6t`) with copy-on-click and a full value on hover or focus.
- **Layout:** 220 px sidebar, 8 px spacing grid, 1 px borders instead of shadows, 6 px radius.
- **Speed:** every keyboard action responds within 100 ms; network results fill in progressively. No full-page spinners.
- **Keyboard:** ⌘K command bar, `J`/`K` or arrows for rows, single-letter actions shown as hints next to buttons.
- **Words:** sentence case, short verdicts ("Arrived on-chain, not credited"), no exclamation marks, no blame ("The funds went to…", never "You sent to the wrong…").
- **Accessibility:** WCAG 2.2 AA target; status is always shown as text plus an icon, never colour alone; visible focus rings; usable at 200% zoom.

## 10. Six-week build plan and demo script

**Weeks 1–4 build what the interviews need; the 20 Nov kill decision gates weeks 5–6.** Interviews run alongside every week (decision spec, "Next 30 days").

| Week | Dates | Build (Claude Code) | Done when |
| --- | --- | --- | --- |
| 1 | 22–28 Oct | Next.js app shell, design tokens, queue and investigation screens on fixture data (this prototype, rebuilt properly) | Demo runs from a URL with sample cases |
| 2 | 29 Oct–4 Nov | Tron and Ethereum fetchers; rules D01–D07 as pure functions with fixture tests | A real public hash returns a correct verdict |
| 3 | 5–11 Nov | BNB Chain, EVM cross-check (D04), freeze calls (D09), minimums (D08), look-alike check (D07b) | All chain-only codes pass their tests |
| 4 | 12–18 Nov | CSV upload and validation, ledger join (D12–D14), AI explanation with output validator, bulk run | One design partner's past tickets run in bulk |
| — | **20 Nov** | **Kill decision** | 3 firms with the pain, 2 sharing data, 1 paid pilot |
| 5 | 21–27 Nov | Auth with 2FA, roles, row-level security, audit log, settings versioning | Cross-tenant tests pass |
| 6 | 28 Nov–4 Dec | Security review fixes, performance, error states, pilot onboarding | First paid pilot live |

**Who does what:** Claude Code writes code against this spec. ChatGPT reviews pull requests and rule logic as a second opinion. You run interviews, label real cases (the accuracy test set) and approve every change to this spec.

### Demo script for a payment ops lead (10 minutes)

1. **Open on their pain (1 min).** "Walk me through the last 'USDT not arrived' ticket your team handled. How long did it take?" Note the number; don't pitch yet.
2. **Paste a hash (1 min).** In the queue, paste a fixture Tron hash. The verdict appears: "Arrived on-chain, not credited" (D12). Say nothing for five seconds.
3. **Show the evidence (2 min).** Walk the timeline: chain transfer, 20 of 20 confirmations, official USDT contract, the correct deposit address, and the missing ledger row. Click a source link to show it's real data.
4. **Show the reply (1 min).** Press `C`. "That's the reply your analyst sends, and it only contains facts from the evidence."
5. **Show a hard case (2 min).** Open the wrong-address case: the verdict is D07 (High), with a D07b "likely cause" finding showing the character diff and the earlier zero-value poisoning transfer. Then the analyst's confirm step: "We tell you when we're not sure."
6. **Show bulk (1 min).** "Give us last month's tickets as a CSV and we'll show you how many were D12 — money that arrived but wasn't credited."
7. **Ask (2 min).** "Would you share 60 days of redacted tickets for a 4-week paid pilot at US$1,500?" Then stop talking.

Never claim in the demo that fixture cases are customer data, or that accuracy figures exist before the labelled test set is run.

## Sources

Read via web search results on 21 Oct 2026. Help-centre pages change, so re-check each before a pilot.

**Help centres and vendor docs**

- [Binance.US — Unsupported asset recovery](https://support.binance.us/hc/en-us/articles/4404564207255-Unsupported-Asset-Recovery)
- [Binance.US — Deposit recovery tool](https://support.binance.us/en/articles/9842793-how-to-use-the-deposit-recovery-tool)
- [Binance.US — Sent to the wrong address](https://support.binance.us/hc/en-us/articles/360054810374-What-can-I-do-if-I-sent-crypto-to-the-wrong-address)
- [Kraken — Deposit processing times](https://support.kraken.com/hc/en-us/articles/203325283)
- [Revolut — Deposit below minimum](https://help.revolut.com/help/wealth/cryptocurrencies/transferring-cryptocurrencies/depositing-cryptocurrencies/issues-with-crypto-deposits/what-happens-if-deposit-is-below-the-minimum-deposit-limit/)
- [BVNK — Minimum transaction amounts](https://help.bvnk.com/hc/en-us/articles/37588695187346-Minimum-Transaction-Amounts-FAQ)
- [Cobo — Missing deposits troubleshooting](https://help-center.cobo.com/en/articles/15222810-self-service-troubleshooting-guide-for-missing-deposits)
- [Trust Wallet — USDT balance and transaction issues](https://support.trustwallet.com/en/articles/800584-how-can-i-troubleshoot-usdt-balance-and-transaction-issues-in-trust-wallet)
- [imToken — Beware of fake USDT](https://support.token.im/hc/en-us/articles/59274708455193-Beware-of-Fake-USDT-An-Exchange-Hot-Wallet-Label-Is-Not-an-Endorsement-Security-Monthly-Report-49th-Issue)
- [D'CENT — TRC20 OUT OF ENERGY](https://support.dcentwallet.com/hc-faq/coin-send-receive/i-cant-send-tron-trc20-tokens-token-sending-keeps-failing)
- [OneKey — Deposit hasn't arrived](https://help.onekey.so/en/articles/12569147-deposit-hasn-t-arrived)
- [TokenPocket — Wallet to exchange not received](https://help.tokenpocket.pro/en/transfer-faq/why-did-i-not-receive-my-funds-from-the-wallet-to-the-exchange)
- [TokenPocket — Exchange to wallet not received](https://help.tokenpocket.pro/en/transfer-tutorial/transfer-faq/why-did-i-not-receive-my-funds-from-the-exchange-to-the-wallet)
- [Keplr — Missing memo](https://help.keplr.app/troubleshooting/5R3bMyjtr2Qj3TcLwuW7J6/resolve-a-missing-memo-issue/5So5gM41LifQhxiMqFUt9k)
- [Zero Hash — Internal transfers](https://docs.zerohash.com/changelog/enhanced-zero-hash-transfers)
- [Coinbase — Tether asset page (USDT contract)](https://www.coinbase.com/en-sg/price/tether)

**Security, freezes and chain data**

- [Elliptic — Address poisoning](https://www.elliptic.co/blockchain-basics/what-is-address-poisoning/)
- [Tsuchiya et al. — Blockchain Address Poisoning (arXiv)](https://arxiv.org/html/2501.16681v1)
- [BlockSec — USDT blacklist explained](https://blocksec.com/blog/usdt-blacklist-explained-2026)
- [Circle USDC blacklist implementation](https://medium.com/@j2abro/circle-usdc-blacklist-implementation-8a7bab143a93)
- [TRON developers — TRC-20 transaction history](https://developers.tron.network/es/docs/get-trc20-transaction-history)
- [TRON developers — Rate limits](https://developers.tron.network/reference/rate-limits)
- [Etherscan — API V2](https://docs.etherscan.io/etherscan-v2)
- [eco.com — USDT confirmation time by network](https://eco.com/support/en/articles/15247703-usdt-confirmation-time-by-network-2026)

**Volume by chain**

- [BCG and Allium — Stablecoin payments](https://bcg.allium.so/payments)
- [CoinDesk — TRON Network Q2 2026](https://www.coindesk.com/research/tron-network-q2-2026)
- [Forklog — TRON share per Visa](https://forklog.com/en/news/trons-share-in-stablecoin-transactions-plummets-to-14)
- [DL Research — Stablecoins on BNB Chain](https://www.dlnews.com/research/internal/stablecoins-on-bnb-chain-passive-assets-or-fuel-for-a-complete-defi-ecosystem/)
