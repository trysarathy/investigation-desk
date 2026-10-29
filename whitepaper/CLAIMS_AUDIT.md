# Claims audit: Clearline white paper v0.1

Checked on 29 October 2026. Every factual claim in `Clearline_Whitepaper.md` is listed with its source; every product
claim with the file or test that proves it. Web sources were re-opened on 29 Oct 2026 and the quoted figure was found
on the page. Product claims were checked against `main` at `9af0200` (PR #27, accounting-fixes) unless a row names
another branch. `docs/enterprise/CLAIMS_AUDIT.md` (PR #30) was treated as binding; nothing here contradicts it.

Labels: **V** = verified, **A** = assumption (written as a hypothesis in the paper), **G** = guess.

## 1. Market and external facts

| # | Claim in the paper | Label | Source (opened 29 Oct 2026) | Notes |
|---|---|---|---|---|
| M1 | Real-world stablecoin payment volume doubled in 2025 to ~US$400B; ~60% B2B (estimated) | V | https://www.bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure | Quote: "real-world stablecoin payments volume doubled in 2025 to $400B, 60% of which is estimated to be B2B payments". Bessemer, 22 Apr 2026. The 60% is Bessemer's estimate and is called one. |
| M2 | Fiat-backed stablecoin supply exceeded US$273B in March 2026 | V | Bessemer, same page | |
| M3 | Total stablecoin market cap US$308.0B on 13 Aug 2026 | V | https://reap.global/blog/stablecoin-statistics-2026 | Reap cites DefiLlama. |
| M4 | USDT ~59% of supply, USDC ~23% | V | Reap, same page | |
| M5 | Ethereum ~49% of stablecoin supply, Tron ~31% | V | Reap, same page (DefiLlama chains, Aug 2026) | By supply, not by payment volume. |
| M6 | ~US$350–550B real-economy payments of US$28–62T transfers in 2025 | V | Reap, same page (citing BIS; BCG × Allium; McKinsey) | Secondary source; originals not opened. |
| M7 | Real payments ≈ 0.6%–2% of transfer volume | V (derived) | Computed from M6: 350/62,000 = 0.56%; 550/28,000 = 1.96% | Arithmetic only. |
| M8 | EY-Parthenon mid-2025 survey, 350 decision-makers: paying suppliers cross-border 62%, accepting cross-border payments 53% | V | Reap, same page | Via Reap; original EY report not opened. Reap calls it "a directional adoption snapshot". |
| M9 | Stripe, Circle, Coinbase becoming one-stop shops; startups should build outside their paths | V | Bessemer, same page | Quoted verbatim. |
| M10 | 49,999,950 USDT lost to a look-alike address matching first 3 and last 4 characters, after a test payment | V | https://cointelegraph.com/news/address-poisoning-copy-paste-mistake-50m-usdt-loss (20 Dec 2025) and https://etherscan.io/tx/0xc0514a795f065fce8a3e1238a1ba480e8a792d45f6431ee4ba8d800bedd86a0f | The paper's date "19 December 2025" comes from `tests/real_cases.json` (case POISON-1, times checked on-chain by the real-data test); Cointelegraph gives only its publication date (20 Dec). |
| R1 | GENIUS Act = Public Law 119-27, 18 July 2025 | V | https://www.govinfo.gov/metadata/pkg/PLAW-119publ27/mods.xml | |
| R2 | GENIUS Act takes effect 18 Jan 2027; OCC final rule 21 Oct 2026; Treasury AML/sanctions rules separate | V | https://decrypt.co/381502/occ-finalizes-genius-act-stablecoin-rules-ahead-of-january-deadline | Secondary (news). The OCC's own bulletin URL redirected and could not be read. |
| R3 | MiCA rules for EMTs/ARTs applied from 30 June 2024 | V | https://eba.europa.eu/regulation-and-policy/asset-referenced-and-e-money-tokens-mica | The page refers to compliance "from 30 June 2024". |
| R4 | MiCA CASP transitional period ended 1 July 2026 | V | https://www.fsma.be/en/news/crypto-assets-service-providers-end-transitional-period (25 Jun 2026) | Also stated by https://elvingerhoss.lu/insights/publications/mica-end-transitional-period-1-july-2026 |
| R5 | Hong Kong Stablecoins Ordinance commenced 1 Aug 2025 | V | https://www.news.gov.hk/eng/2025/06/20250606/20250606_140750_137.html | |
| R6 | First HK issuer licences to HSBC and Anchorpoint Financial, 10 Apr 2026 | V | https://www.charltonslaw.com/hkma-issues-first-stablecoin-issuer-licences/ | Law-firm summary; the HKMA register page was not reachable from here. |
| R7 | MAS consultation 1 Sep 2026 on PS Act amendments; comments closed 16 Oct 2026; no enactment date | V | https://www.gibsondunn.com/singapore-publishes-draft-legislation-to-implement-its-stablecoin-framework/ | Law-firm summary of the MAS paper. |
| C1 | Stripe settles stablecoin payments to the Stripe balance in local currency; US, with private preview in EU, HK, MX, CH; Singapore not listed | V | https://docs.stripe.com/crypto/stablecoins | Page lists business locations; SG absent on 29 Oct 2026. |
| C2 | HitPay's Singapore stablecoin payments processed by Triple-A (MAS-licensed for DPT services); HitPay does not handle, convert or hold stablecoins; merchants get fiat | V | https://hitpayapp.com/crypto-payment-gateway-hitpay | |
| C3 | Safe{Wallet} with Blockaid warns senders about suspicious/malicious addresses, incl. look-alikes | V | https://safe.global/blog/safe-wallet-gets-even-safer-introducing-blockaid-integration | |
| C4 | Bitwave supports stablecoin invoices/AR and syncs with NetSuite, Xero, QuickBooks, Sage | V | https://www.bitwave.io/request-a-demo-stablecoin-b2b-payments | |
| C5 | Request Finance syncs to QuickBooks Online, Xero, NetSuite | V | https://help.request.finance/en/articles/13038304-accounting-integrations-overview | The page says it syncs "bills, crypto and fiat". |
| C6 | TRES lists native NetSuite, QuickBooks, Xero integrations | V | https://tres.finance/lpp/crypto-accounting | |
| C7 | Cryptio integrates with NetSuite | V | https://blog.cryptio.co/cryptio-the-obvious-choice-for-netsuite-users | |
| C8 | Coinbase Payments (stablecoin payments for e-commerce, live with Shopify) | named only | https://www.pymnts.com/?p=2757287 (19 Jun 2025) | The paper names Coinbase in the processor row but makes no specific claim about it. |
| S1 | EIP-681 defines a URL format for token transfer requests | V | https://ercs.ethereum.org/ERCS/erc-681 | |
| A1 | Crypto accounting tools are built for crypto-native teams and start after money arrives | **A** | none | Not tested against their products. Listed in risks. |
| A2 | Regulatory clarity will bring conventional businesses who expect bank-like controls | **A** | none | |
| A3 | Holding/forwarding funds would likely need a PS Act DPT licence in Singapore | **A** | Supporting context only: C2, R7 | No legal advice taken. |
| A4 | How finance teams handle exceptions today (explorer + spreadsheet + email) | **A** | none | To be tested in customer calls. |
| G1 | 10–30 minutes per exception | **G** | none | |
| G2 | Long-term models: subscription by volume, or per-exception fee via payment companies | **G** | Earlier brief (`pitch/src/build_brief.py` on `brief-fixes`) labelled these ASSUMPTION/GUESS | |

## 2. Product claims

| # | Claim in the paper | Label | Proof | Notes |
|---|---|---|---|---|
| P1 | Read-only on-chain; no wallet, keys or signing code | V | `src/lib/chain/` (`evm.ts`, `tron.ts`, `http.ts`): read calls only | Matches enterprise audit #13. |
| P2 | Payment requests: USDC and USDT on Ethereum only | V | `src/lib/requests/types.ts` (`REQUEST_CHAIN = "ethereum"`, `REQUEST_TOKENS`); `validateRequest` in `lifecycle.ts` | No Tron request code: the local `requests-tron` branch has no commits beyond `main`'s base and is not pushed. |
| P3 | Amount exact decimal, ≤6 places; issuer contract fixed at creation; random public ID | V | `lifecycle.ts` `validateRequest`/`createRequest`; `service.ts` `newPublicId` (9 random bytes) | |
| P4 | Payment page with EIP-681 QR | V | `src/lib/requests/present.ts` `eip681`; `src/app/pay/[publicId]/page.tsx`; test "builds an EIP-681 link in base units" in `tests/requests.test.ts` | |
| P5 | Address checker: match / look-alike / different / invalid; look-alike = first 4 or last 4 hex match; only verdict stored (address kept if look-alike) | V | `lifecycle.ts` `compareAddress`, `recordAddressCheck`; test "f. Fernhill" | |
| P6 | Live mode: a person pastes the tx hash; no address watching | V | `src/lib/requests/provider.ts` header ("No polling or address watching yet"); `service.ts` `attachHash` | Enterprise audit fact 1. |
| P7 | Auto-mark paid is demo-only | V | `service.ts` `createPaymentRequest`: `autoMarkPaid: demo` | Enterprise audit fact 2. |
| P8 | One record per `chain:hash:logIndex`; duplicates count once; confirmations never go back | V | `lifecycle.ts` `ingest`; tests "the same transfer delivered again counts once", "an older event never takes confirmations backwards" | |
| P9 | Rules engine, fixed order, first High wins | V | `src/lib/catalogue.ts` `CATALOGUE_ORDER`; `src/lib/engine/run.ts` | |
| P10 | Checks table (failed, network, address, genuine token/counterfeit, timing, engine findings); only timing overridable; wrong network countable only if in own wallet | V | `lifecycle.ts` `transferIssue`, `allowedDecisions`, `decide`; tests "c. Orbit", "d. Meridian", "a transfer mined before the request…" | |
| P11 | 12 confirmations on Ethereum, a sample setting, not editable | V | `check.ts` `CONFIRMATIONS` from `SAMPLE_SETTINGS`; `demo/REPORT.md` ("Company settings are hard-coded sample settings") | |
| P12 | A chain that doesn't answer pauses the check; missing receipt never read as failure | V | `src/lib/engine/run.ts` (paused chains); `src/lib/chain/evm.ts` lines ~199–201; `check.ts` "Check paused"; `tests/real-cases.test.ts` outage tests | |
| P13 | Check snapshots appended with rule version | V | `lifecycle.ts` `withCheck`; `types.ts` `CheckSnapshot.ruleVersion` | |
| P14 | Attribution rules (one candidate; several → never by amount; paid address → possible duplicate) | V | `lifecycle.ts` `attribute`; tests "two open requests on one address…", "an open request on an address a paid request used…" | |
| P15 | Suggestion scoring 40/35/15/10; Strong ≥80, Possible ≥50; min 40; person confirms with note | V | `lifecycle.ts` `suggestMatches`, `assignUnmatched`; test "e. Kite" | |
| P16 | Derived states and labels | V | `types.ts` `RequestState`, `STATE_LABELS`; `lifecycle.ts` `deriveRequest` | |
| P17 | Explanations from templates; likely cause labelled as inference; replies facts-only, no promises | V | `src/lib/requests/present.ts` (`replyDraft` comment); test "b. Brightline" | |
| P18 | Optional AI explanation; validator rejects ungrounded numbers/addresses/hashes/dates/tokens, banned words, uncited sentences; off by default; untested on real data | V | `src/lib/ai/validate.ts`; `tests/ai.test.ts` (33 tests); `Dockerfile` `AI_EXPLANATIONS=off`; `demo/REPORT.md` | |
| P19 | Posting plan; approval refused if plan changed; idempotency key per line; audit of approvals/postings/failures/refusals | V | `src/lib/accounting/engine.ts` `approveAndPost`; tests in `tests/accounting.test.ts` "approval is for the plan the person saw…", "posting twice never creates a second record…", "a failure on the second line…" | |
| P20 | Posting rules table (exact, short, accepted short, over/duplicate, redelivery, never-post, no reference, non-USD, depeg) | V | `src/lib/accounting/rules.ts` `planPosting`; `docs/ACCOUNTING_SYNC.md`; tests "posting rules" block in `tests/accounting.test.ts` | |
| P21 | Par valuation labelled; 0.5% depeg limit; cents rounded down | V | `rules.ts` `parPrice`, `DEPEG_LIMIT`, `floorCents`; test "payment lines never add up to more than arrived…" | |
| P22 | Xero built and tested against recorded shapes, never run live; QuickBooks built against docs, not run; NetSuite designed only | V | `docs/ACCOUNTING_SYNC.md` "Systems"; `providers/netsuite.ts` throws "isn't built yet"; tests "Xero and QuickBooks request shapes" | Enterprise audit fact 4. |
| P23 | Xero scopes: transactions + contacts.read; minimum for posting, not read-only | V | `src/lib/accounting/providers/xero-auth.ts` `DEFAULT_SCOPES` | |
| P24 | Append-only decisions/activity; attribution history kept | V | `lifecycle.ts` (`decisions`, `activity`, `attributionHistory`) | |
| P25 | Raw chain responses hashed with SHA-256 (investigation pages) | V | `src/lib/view.ts` `evidenceHashes`; `src/lib/chain/http.ts` | |
| P26 | Payment page says not every wallet reads amount/token from QR | V | `src/app/pay/[publicId]/page.tsx` line ~114 | |
| P27 | Security gaps: no sign-in (typed name + optional Basic auth), Xero tokens unencrypted, audit not tamper-evident, JSON files, manual deletion, no pen test/SOC 2; 10-business-day manual deletion promise | V | `docs/enterprise/SECURITY_OVERVIEW.md` §3, §2, §1, §5, §7 (branch `enterprise-pack`, PR #30); `src/middleware.ts`; `src/components/ActingAs.tsx` | |
| P28 | No month-end report feature | V | `grep -ri "month-end" src` finds nothing (enterprise audit fact 5) | Listed as roadmap. |
| P29 | Real-data test: 59/59 after fixes (43/59 before), 52/52 held-out, 0/12 false alarms, wrong-and-High 13 → 0; per-category counts; 7 cases re-checked by independent reviewer | V | `demo/REPORT.md`; `tests/real_cases.json` (59), `tests/real_cases_holdout.json` (52) | Investigation engine only, not request matching. |
| P30 | 13 counterfeit tokens named USDT incl. "ÚЅDТ" | V | `demo/REPORT.md` ("Fake USDT (D06): 13 of 13"); case FAKE-HG in `tests/real_cases.json` | Selection, not prevalence; the paper says so. |
| P31 | 573 tests pass, 57 skipped | V | `npx vitest run` on `qa-polish` (12abf33), run 29 Oct 2026: "Tests 573 passed \| 57 skipped (630)" | On `main` the count is lower; PR #31 not merged. |
| P32 | 23 accounting tests; 62 replays of recorded real cases | V | Same run: `tests/accounting.test.ts` (23), `tests/real-cases.test.ts` (62) | |
| P33 | 113/113 e2e checks ×3; seven demo flows through to the books | V | `demo/QA_REPORT.md` (branch `qa-polish`, PR #31) | |
| P34 | Demo scenarios a–g with amounts | V | `src/lib/requests/demo.ts` `CASES` and `resetDemo`; `demo/REQUESTS_DEMO.md` | Fictional company Northwind Pay. |
| P35 | Case g posting: one payment + one overpayment marked for refund | V | test "duplicate: paid twice posts one payment and one overpayment to refund" | |
| P36 | 0 customers; 0 calls; outreach began 29 Oct 2026 | V (founder) | Founder's status; enterprise audit row 18 | Not provable from code. |
| P37 | Pricing: US$300 for 30 days, then US$200/month | A | `gtm/offer.py` in the separate GTM repo, as recorded in the enterprise claims audit rows 1 and 32–38 | The GTM repo itself was not reachable; untested price. |
| P38 | Open instruction/receipt format | Proposal | Not built. The paper says so. | |

## 3. Cut or softened while writing

- "Correct payments tick themselves off": stated as demo-only (P7).
- "Multi-chain": stated as a design goal; requests are Ethereum-only (P2). The 7-chain investigation engine is mentioned only with the real-data test.
- "Least-privilege accounting access" (from the brief): softened. The Xero scopes are the minimum for posting, but they include write access (P23).
- "Tamper-evident audit log" (from the brief): not claimed. Listed as a known gap with a planned fix (P27).
- Time saved per exception: kept only as a labelled guess (G1); the demo's "20-minute investigation" line is not used.
- HK Ordinance date: Charltons says "effective since July 2025"; the paper uses the government's 1 August 2025 notice (R5).
- No market-size (TAM) figure is given: none could be sourced bottom-up.
