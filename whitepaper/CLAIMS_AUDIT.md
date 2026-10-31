# Claims audit: Clearline working paper v0.2

Checked on 29 October 2026, after the independent sceptical review (`REVIEW.md`, not committed). Every factual claim in
`Clearline_Whitepaper.md` is listed with its source; every product claim with the file or test that proves it.
Web sources were opened on 29 Oct 2026 and the figure was found on the page. `docs/enterprise/CLAIMS_AUDIT.md`
(PR #30) was treated as binding.

**Pinned commits.** Product claims are true of `main` at **`9af0200`** (merge of PR #27) unless marked otherwise.
Unmerged branches cited: `qa-polish` @ `12abf33` (PR #31: QA report, 573-test run) and `enterprise-pack` @ `7c493e3`
(PR #30: security overview). No Tron payment-request code exists on any pushed branch.

Labels: **V** = verified, **A** = assumption (written as a hypothesis), **G** = guess.

## 1. Market, regulation and competitors

| # | Claim | Label | Source | Notes |
|---|---|---|---|---|
| M1 | Market cap US$308.0B on 13 Aug 2026; USDT ~59%, USDC ~23%; Ethereum ~49%, Tron ~31% of supply | V | https://reap.global/blog/stablecoin-statistics-2026 (DefiLlama) | By supply, not payment volume |
| M2 | Real-economy payments 2025: US$350–550B (BCG); ~US$390B (McKinsey/Artemis) | V | Reap, same page: "$350–550 billion (BCG) and ~$390 billion (McKinsey/Artemis; BIS citing Visa)" | **Fixed from v0.1**, which attributed the range to BIS, BCG and McKinsey jointly |
| M3 | Gross transfers US$28–62T+: ~US$28T (BIS), >US$62T (BCG × Allium), "depending on the method" | V | Reap, same page | Reap also gives ~US$33T (Artemis); not used |
| M4 | Real payments "about 1%" of gross transfers; "most transfer volume is not commerce" | V (derived) | From M2/M3 | **Fixed**: v0.1 divided figures across studies (0.6–2%) and said "the rest is trading", which the source doesn't say. BCG counts US$4.2T (~7%) as "genuine economic activity"; not used in the paper |
| M5 | McKinsey: B2B stablecoin payment base ~US$226B a year | V | Reap, same page | |
| M6 | Bessemer: 60% of 2025 real-world stablecoin payments estimated B2B | V | https://www.bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure | Bessemer's own US$400B figure no longer used in the body |
| M7 | EY-Parthenon mid-2025, 350 respondents: ~13% had used stablecoins (8% of corporates); use cases 62% / 53% | V | Reap, same page | **Added** the 13% usage figure. Original EY report not opened |
| M8 | Dec 2025: 49,999,950 USDT to a look-alike (first 3 and last 4 characters) after a test payment; from the payer's own wallet history | V | https://cointelegraph.com/news/address-poisoning-copy-paste-mistake-50m-usdt-loss ; https://etherscan.io/tx/0xc0514a795f065fce8a3e1238a1ba480e8a792d45f6431ee4ba8d800bedd86a0f | **Added** that Clearline would only have helped via the payee's page |
| M9 | Wrong-network recoverability: same key works on every EVM chain for an ordinary key-held address; often not for smart-contract wallets or exchange deposit addresses | A (technical fact, not externally cited) | Standard EVM address derivation; the reviewer's correction | **Fixed**: v0.1 used a Tron-vs-Ethereum example, which can't happen with pasted addresses |
| R1 | GENIUS Act = Public Law 119-27, 18 July 2025 | V | https://www.govinfo.gov/metadata/pkg/PLAW-119publ27/mods.xml | |
| R2 | Effective 18 Jan 2027; OCC final rule 21 Oct 2026 | V | https://decrypt.co/381502/occ-finalizes-genius-act-stablecoin-rules-ahead-of-january-deadline | News source; OCC bulletin URL redirected |
| R3 | MiCA EMT rules since 30 Jun 2024 | V | https://eba.europa.eu/regulation-and-policy/asset-referenced-and-e-money-tokens-mica | |
| R4 | MiCA CASP transition ended 1 Jul 2026 | V | https://www.fsma.be/en/news/crypto-assets-service-providers-end-transitional-period | |
| R5 | HK Stablecoins Ordinance from 1 Aug 2025 | V | https://www.news.gov.hk/eng/2025/06/20250606/20250606_140750_137.html | |
| R6 | First HK licences: HSBC and Anchorpoint, 10 Apr 2026 | V | https://www.charltonslaw.com/hkma-issues-first-stablecoin-issuer-licences/ | Law-firm summary |
| R7 | MAS consultation 1 Sep 2026; comments closed 16 Oct; no enactment date; non-MAS stablecoins stay lawful under the DPT regime | V | https://www.gibsondunn.com/singapore-publishes-draft-legislation-to-implement-its-stablecoin-framework/ | Law-firm summary |
| C1 | Stripe: USDC, USDP, USDG (no USDT); US$10,000 per transaction; settles to the Stripe balance in local currency; US plus private preview in EU, HK, MX, CH; SG not listed | V | https://docs.stripe.com/crypto/stablecoins | |
| C2 | Stripe completed the Bridge acquisition, 4 Feb 2025 | V | https://stripe.com/us/newsroom/news/stripe-completes-bridge-acquisition | |
| C3 | HitPay (SG): USDT, USDC, PYUSD on ERC-20, TRC-20, Solana, Polygon, Arbitrum; Triple-A (MAS-licensed) handles and converts; merchants get fiat; HitPay doesn't hold stablecoins | V | https://hitpayapp.com/crypto-payment-gateway-hitpay | The page lists tokens and networks but not which token runs on which network |
| C4 | BVNK offers similar infrastructure | named only | none | "We have not reviewed them in detail" |
| C5 | Safe{Wallet} + Blockaid warn senders about suspicious and look-alike addresses | V | https://safe.global/blog/safe-wallet-gets-even-safer-introducing-blockaid-integration | |
| C6 | Fireblocks: transfers only to whitelisted destinations approved by an admin group | V | https://developers.fireblocks.com/docs/whitelist-addresses | |
| C7 | Request Finance: fiat-denominated invoices paid in crypto or fiat to the supplier's wallet; reconciliation; accounting export | V | https://www.request.finance/accounts-receivable | The page doesn't name stablecoins or networks |
| C8 | Request Finance syncs with QuickBooks Online, Xero, NetSuite | V | https://help.request.finance/en/articles/13038304-accounting-integrations-overview | |
| C9 | Request Network: payment through a contract that logs a `paymentReference`; balance = sum of payment events with that reference; partial payments supported | V | https://docs.request.network/advanced/protocol-overview/how-payment-networks-work | |
| C10 | Bitwave, TRES, Cryptio ERP sync | V | https://www.bitwave.io/request-a-demo-stablecoin-b2b-payments ; https://tres.finance/lpp/crypto-accounting ; https://blog.cryptio.co/cryptio-the-obvious-choice-for-netsuite-users | |
| S1 | EIP-681 URL format | V | https://ercs.ethereum.org/ERCS/erc-681 | |
| S2 | ERC-7699 exists as a proposal (ERC-20 transfer reference extension) | V | https://ercs.ethereum.org/ERCS/erc-7699 | The page shows no status; the paper calls it "a proposal" |
| S3 | Solana Pay `reference` keys locate a payment | V | https://solana.com/docs/tools/solana-pay/specification/version1 | |
| S4 | BIP70: certificate-based payment requests; "never saw widespread adoption"; outside security dependency; removed from Bitcoin Core in 2019 | V | https://bitcoinops.org/en/topics/bip70-payment-protocol/ | Disabled by default in 0.19 (Nov 2019); support removed Oct 2019 (PR 17165) |
| S5 | Ethereum `finalized` tag; about two epochs (12–13 minutes) | V | https://docs.tatum.io/docs/evm-block-finality-and-confidence | Vendor docs, not ethereum.org (not reachable) |
| S6 | FASB proposed ASU (Topic 230), 18 Aug 2026: examples of stablecoins as cash equivalents; comments by 19 Nov 2026; not final | V | https://www.crowe.com/insights/take-into-account/fasb-proposes-cash-equivalents-guidance-for-stablecoins | Firm summary; FASB page not opened |
| S7 | Xero apps created on or after 2 Mar 2026 use granular scopes | V | https://developer.xero.com/faq/granular-scopes | |
| A1 | Many B2B payers send plain transfers without a reference, and the cost sits in those exceptions | A | none | Core hypothesis |
| A2 | Most businesses publish one treasury address rather than one per invoice | A | none | |
| A3 | Holding funds would likely need a DPT licence in Singapore | A | Context: C3, R7 | No legal advice taken |
| A4 | Issuer freeze on a sender is weak protection for receipts, because the transfer fails on-chain | A | Reasoning (a frozen address can't send) | |
| A5 | No settled IFRS/SFRS(I) guidance specific to stablecoins found | A | Searched; nothing found | Absence of evidence only |
| A6 | First customers in SG/HK; much SG/HK B2B USDT is on Tron | A | none | |
| A7 | Liability terms limited to fees; PI insurance needed | A | none | No lawyer review |
| G1 | 10–30 minutes per exception | G | none | |
| G2 | 500–2,000 target businesses in SG/HK; US$1.2–4.8M a year | G | Arithmetic on a guess | |
| G3 | Chain data US$50–300/month per deployment | G | none | |
| G4 | Per-exception partner pricing | G | none | |
| P0 | Pricing: founding pilot US$300 for 30 days, then US$200/month, first 10 businesses | A | Aashmiin's decision, 31 Oct 2026 (also `gtm/offer.py` in the separate GTM repo) | Set, but untested with buyers |

## 2. Product claims

| # | Claim | Proof | Notes |
|---|---|---|---|
| P1 | Read-only on-chain; no keys or signing | `src/lib/chain/` | |
| P2 | Payment pages: USDC/USDT on Ethereum only | `src/lib/requests/types.ts` (`REQUEST_CHAIN`, `REQUEST_TOKENS`) | |
| P3 | EIP-681 QR | `src/lib/requests/present.ts` `eip681`; test "builds an EIP-681 link in base units" | |
| P4 | Address checker *warns* (match / look-alike / different / invalid; first 4 or last 4 hex); only when the payer pastes into it; last 20 checks kept | `lifecycle.ts` `compareAddress`, `recordAddressCheck` (`.slice(-20)`) | **Fixed**: v0.1 implied it stops payments |
| P5 | Verification checks; frozen sender **or destination** | `lifecycle.ts` `transferIssue`; `src/lib/chain/investigate.ts` (freeze calls on sender and destination) | |
| P6 | Pause on unanswered data source; missing receipt never read as failure | `src/lib/engine/run.ts`; `src/lib/chain/evm.ts` ~L199 | |
| P7 | Attribution: one candidate only; never by amount alone | `lifecycle.ts` `attribute`; tests in `tests/requests.test.ts` | |
| P8 | Append-only: decisions, activity, check snapshots, posting audit. Requests and observations updated in place; `attributionHistory` keeps earlier attributions | `lifecycle.ts` (`ingest`, `withCheck`, `decide`); `accounting/engine.ts` `appendAudit` | **Fixed** (v0.1 said all records were append-only) |
| L1 | Live: a person pastes the hash; no address watching | `src/lib/requests/provider.ts` header; `service.ts` `attachHash` | |
| L2 | Live: no confirmation polling | `service.ts` (lookups only in `attachHash`) | |
| L3 | Live: auto-mark off | `service.ts` `autoMarkPaid: demo` | |
| L4 | Pasting from a request page doesn't attribute to it (no `claimedFor`); shared address → ambiguous | `service.ts` `attachHash` calls `ingest` without `claimedFor`; `lifecycle.ts` `attribute` | |
| L5 | Unidentified suggestions unreachable live | `provider.ts` `lookup` keeps only `sameAddress(t.to, request.receivingAddress)` | |
| L6 | Wrong-network: live returns a message, records nothing | `provider.ts` ("Found on …, not Ethereum") | |
| L7 | Freeze check only when a hash is looked up | `chain/investigate.ts` `freezeFacts` called from `fetchFacts` | |
| L8 | Fake token whose symbol doesn't contain the requested name → "wrong token"; never counted/posted | `lifecycle.ts` `transferIssue`; `accounting/rules.ts` `neverKinds` | |
| P9 | Posting rules; never-post kinds; par with label; 0.5% limit; cents down | `src/lib/accounting/rules.ts`; `docs/ACCOUNTING_SYNC.md`; tests "posting rules" (10) | |
| P10 | Idempotency key per line; audit of approve/post/fail/refuse; refused if plan changed | `accounting/engine.ts`; tests in "approval, idempotency and audit" | |
| P11 | `approveAndPost` accepts a missing plan key; the web route requires it | `engine.ts` (`expectedKey?`); `src/app/api/accounting/[id]/route.ts` (400 if missing) | **Added** as a known gap |
| P12 | Xero scopes: code requests `accounting.transactions` | `src/lib/accounting/providers/xero-auth.ts` `DEFAULT_SCOPES` | **Fixed**: no "minimum scopes" claim; a separate PR updates it |
| P13 | Xero tested against recorded shapes, never live; QuickBooks not run; NetSuite designed | `docs/ACCOUNTING_SYNC.md`; `providers/netsuite.ts`; tests "Xero and QuickBooks request shapes" (4) | |
| P14 | 12 confirmations, sample setting; no reorg handling | `requests/check.ts` `CONFIRMATIONS`; no reorg code (`grep -ri reorg src` empty) | |
| P15 | AI: off in the Docker image; on whenever an Anthropic key is set; evidence (IDs removed) sent to Anthropic | `Dockerfile` (`AI_EXPLANATIONS=off`); `src/lib/ai/anthropic.ts` `configuredModel`; `src/lib/ai/explain.ts` | **Fixed** (v0.1 said "off by default") |
| P16 | AI validator rules | `src/lib/ai/validate.ts`; `tests/ai.test.ts` | |
| P17 | Clearline-specific tests: 23 request + 23 accounting (10 posting rules, 4 request shapes) | `tests/requests.test.ts`, `tests/accounting.test.ts` | **Fixed** wording |
| P18 | 573 passing tests overall, mostly the earlier product | `npx vitest run` on `qa-polish` @ `12abf33`, 29 Oct 2026 | PR #31 |
| P19 | 113/113 e2e ×3; seven demo flows | `demo/QA_REPORT.md` on `qa-polish` | PR #31 |
| P20 | Earlier product: 59/59 (43 before), 52/52 held-out; sample company data; 7 re-checked independently | `demo/REPORT.md`; `tests/real_cases*.json` | Now attributed to the earlier deposit-investigation product |
| P21 | 13 counterfeit "USDT" incl. "ÚЅDТ" (Cyrillic and accented letters) | `demo/REPORT.md`; case FAKE-HG | **Fixed** wording |
| P22 | Security gaps | `docs/enterprise/SECURITY_OVERVIEW.md` (PR #30); `src/middleware.ts`; `src/components/ActingAs.tsx` | |
| P23 | Demo cases a–g | `src/lib/requests/demo.ts` | Fictional company |
| P24 | 0 customers, 0 calls, outreach from 29 Oct 2026 | Founder's status | Not provable from code |

## 3. Review items and what changed

| Review item | Done |
|---|---|
| 11 factual errors | M2–M4 (market maths), M9 (wrong network), recoverability, M8 (poisoning context), P21 (ÚЅDТ), P4 (checker warns), P8 (append-only), P12 (scopes), P17 (test counts), status box wording, P15 (AI), plus M7 (13%) |
| "Live today vs demo only" table and code-gap facts | Section 4.3 (L1–L8), P11, P14; pinned commits above |
| Missing arguments | Matching premise (4.4), Request Finance/Network (3), prior art and BIP70 (6), Tron first (8, 10), processors (3), sanctions (5), accounting classification (4.5), finality (4.5), whitelisting (3), bottom-up size and unit economics (8), liability (5) |
| Presentation | Ghost table headers fixed (headers no longer repeat); figures 2–4 redrawn; body 9 pages; implementation detail in Appendix A; footnotes only (references list removed); "working paper"; unnumbered abstract; SG/HK, not "four markets"; JSON schema cut; "no customers" kept to the status box and section 7 (plus one roadmap mention of the call target) |
