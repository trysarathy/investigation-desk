# Market facts: stablecoin supply, payments, who receives

Last refreshed 2026-10-29; primary-source re-check 2026-10-31 · owner: research-intern · refresh: monthly (numbers move daily; always
quote the date). Labels as in `research-method.md`; sources `[M#]` at the bottom.

## Read this first: three different numbers people confuse
| Measure | What it is | Order of magnitude | Use it for |
|---|---|---|---|
| **Supply / market cap** | Tokens outstanding | ~US$300bn | Size of the asset, issuer share |
| **Gross transfer volume** | Every on-chain transfer, incl. trading, bots, internal moves | US$28–62T+/yr (method-dependent) | Almost never; it is not commerce |
| **Payments** | Transfers identified as real economic payments (B2B, P2P, card, payouts) | ~US$390–550bn in 2025; ~US$482bn Jan–Sep 2026 | Our market; quote with the measurer |

Never put a gross-transfer number next to the word "payments".

## 1. Supply (asset size)
- **~US$303.3bn total stablecoin supply on 28 Oct 2026**; USDT ~US$182.0bn (60.0%), USDC
  ~US$71.3bn (23.5%) (DefiLlama) [VERIFIED: https://stablecoins.llama.fi/stablecoincharts/all and
  /stablecoin/1, /stablecoin/2 (DefiLlama's own data API), 2026-10-31] [M1]. *Corrected 2026-10-31: was
  ~US$299.1bn total and USDT ~US$181.8bn (60.8%), from a search snippet.* Trend: down from ~US$308.3bn
  on 2 Oct 2026 (*corrected 2026-10-31: was ~US$314.5bn*); ~US$300.7bn on 31 Oct. USDC fell ~US$4.7bn
  in 30 days to 25 Oct (US$76.4bn → US$71.8bn) [VERIFIED: https://stablecoins.llama.fi/stablecoin/2,
  2026-10-31] [M1]. DefiLlama revises history; quote the date you pulled it.
- 13 Aug 2026: ~US$300.9bn; USDT ~61%, USDC ~24%; by chain Ethereum ~49%, Tron ~30% of supply
  [VERIFIED: https://stablecoins.llama.fi/stablecoincharts/all , /stablecoincharts/Ethereum ,
  /stablecoincharts/Tron , 2026-10-31]. *Corrected 2026-10-31: was US$308.0bn, USDT ~59%, USDC ~23%,
  Tron ~31% (DefiLlama via Reap, a secondary source the claims audit had labelled VERIFIED).*
- Allium Q3 2026: supply +0.4% to US$305bn at 30 Sep 2026 [ASSUMPTION: search] [M4]. Different
  dashboards differ by a few billion; always name the source and date.

## 2. Payments (our market)
- 2025 real-economy payments: **US$350–550bn (BCG); ~US$390bn (McKinsey/Artemis)** [VERIFIED]
  (claims audit M2) [M3].
- 2025 gross transfers ~US$28T (BIS) to >US$62T (BCG × Allium): real payments ≈1% of transfers
  [VERIFIED] (claims audit M3/M4) [M3].
- **B2B ~US$226bn/yr** (Dec 2025 annualised, McKinsey/Artemis), up ~733% y/y [VERIFIED]
  (claims audit M5) [M3][M5].
- Bessemer: ~60% of 2025 real-world stablecoin payments estimated B2B [VERIFIED] (claims audit M6) [M6].
- **2026 YTD (Allium Q3 report): ~US$482bn payments Jan–Sep 2026, +45% y/y; September a record
  ~US$72bn; >1bn payment transactions (+71%)** [ASSUMPTION: search] [M4]. Allium's earlier
  report: US$401–527bn Jan–Aug 2026 [ASSUMPTION: search] [M7]. Still unverified 31 Oct: allium.so
  blocked by this environment's network policy.
- **Business-received** share: ~58–64% of identified payments Jan–Aug 2026 (Allium via a
  secondary summary) [ASSUMPTION: search, weak] [M8]; "business-received payments +37% to
  US$246bn over nine months" (Spark citing Allium) [ASSUMPTION: search, S3] [M9]. Do not use
  either outward until the Allium report itself is opened.
- Do **not** use: "US$1.6 quadrillion B2B market", "B2B stablecoins US$1T/yr", or "B2B grew 733%
  in 2026" (a 2025 figure being re-posted as 2026, e.g. [M10]). Unsourced monthly B2B estimates
  (e.g. "US$9–12bn/month") are [GUESS] at best [M11].

## 3. Adoption by businesses
- EY-Parthenon (mid-2025, 350 respondents): ~13% had used stablecoins (8% of corporates)
  [VERIFIED] (claims audit M7, via Reap; EY original not opened) [M3].
- Fireblocks *State of Stablecoins 2025* (295 execs at banks, fintechs, crypto firms; Fireblocks'
  own network): 49% used stablecoins for payments, 41% testing/planning; "90%" figures are
  live+pilot+planned; cross-border B2B is the lead use case; LatAm strongest (71%), North
  America 39%; speed is the top benefit (48%) [ASSUMPTION: search] [M12][M13]. Sample bias: say so.
  (31 Oct: fireblocks.com blocked, report not opened.)
- Mastercard cited ≥US$350bn digital-currency payment volume in 2025 when announcing BVNK
  (17 Mar 2026) [ASSUMPTION: search] [M14]. (31 Oct: mastercard.com blocked.)

## 4. Who receives stablecoins (our ICP evidence) [ASSUMPTION unless sourced]
Segments where receipts land **in the company's own wallet** (best fit), in rough order of how
often we find public evidence (from the lead-research rotation, not a measured ranking):
1. Crypto/Web3 SaaS, data, RPC, node and AI-API firms billing in USDT/USDC.
2. Prop-trading challenge firms and online services priced in USDT/USDC.
3. Hosting/VPS/proxy/VPN providers.
4. Web3 agencies, dev studios, audit firms, crypto media and events (tickets, sponsorships).
5. Web3 legal/accounting/company-formation firms.
6. Payment companies/PSPs, OTC desks, exchanges, remitters (receive customer deposits; the
   SPEC's original buyer) and treasury teams holding stablecoins.
7. Merchants and travel firms paid via gateways that settle in crypto.
Weaker fit: merchants on gateways that **convert to fiat** (Stripe, Coinbase/Shopify default,
HitPay/Triple-A) — the gateway already reconciles [VERIFIED for Stripe and HitPay settlement]
(claims audit C1, C3).

Geography signals: LatAm leads cross-border use (Fireblocks) [ASSUMPTION: search]; much SG/HK B2B
USDT is on Tron (claims audit A6) [ASSUMPTION]; EU payers skew to USDC/EURC after MiCA
(`regulation.md` §2) [ASSUMPTION].

## 5. Numbers Clearline may quote (and how)
| Claim | Exact wording to use | Status |
|---|---|---|
| Market size | "About US$300bn of stablecoins were in circulation in October 2026 (DefiLlama)." | VERIFIED: stablecoins.llama.fi, 2026-10-31 (US$303.3bn on 28 Oct, US$300.7bn on 31 Oct) |
| Payments | "Stablecoin payments were estimated at US$350–550bn in 2025 (BCG) and about US$390bn (McKinsey/Artemis)." | VERIFIED (claims audit) |
| B2B | "McKinsey/Artemis put B2B stablecoin payments at about US$226bn a year at the end of 2025." | VERIFIED (claims audit) |
| USDT share | "USDT is about 60% of supply, USDC about 24% (DefiLlama, Oct 2026)." | VERIFIED: stablecoins.llama.fi, 2026-10-31 (28 Oct: USDT 60.0%, USDC 23.5%; 31 Oct: 59.9% / 23.9%) |

## Sources (all accessed 2026-10-29)
| ID | URL | Tier | How |
|---|---|---|---|
| M1 | https://defillama.com/stablecoins (page 403 from here); data opened via DefiLlama's API https://stablecoins.llama.fi | S2 | Opened 2026-10-31 |
| M2 | https://www.onebullex.com/news/articles/usdc-sheds-4-69b-in-30-days-as-stablecoin-market-cap-falls-to-300-36b | S3 | Search |
| M3 | https://reap.global/blog/stablecoin-statistics-2026 | S3 (cites S2) | Opened by claims audit |
| M4 | https://cryptobriefing.com/stablecoin-payments-rise-45-percent-482b/ | S3 | Search |
| M5 | https://www.mckinsey.com/industries/financial-services/our-insights/stablecoins-in-payments-what-the-raw-transaction-numbers-miss | S2 | Search |
| M6 | https://www.bvp.com/atlas/stablecoins-from-defi-primitive-to-global-financial-infrastructure | S2 | Opened by claims audit |
| M7 | https://blindpay.com/resources/more/stablecoin-payments-statistics-2026 | S3 | Search |
| M8 | https://stablecoininsider.org/allium-stablecoins-report-2026/ | S3 | Search |
| M9 | https://www.spark.money/research/stablecoin-b2b-payment-dominance-shift | S3 | Search |
| M10 | https://x.com/rise_pay/status/2059243160459780401 | X | Search (example of what not to cite) |
| M11 | https://bancoli.com/blog/stablecoin-adoption-b2b-payments-2026 | S3 | Search |
| M12 | https://beincrypto.com/global-institutions-stablecoins-fireblocks-survey | S3 | Search |
| M13 | https://www.crowdfundinsider.com/2025/05/239704-fireblocks-report-show-surging-stablecoin-use/ | S1 | Search |
| M14 | https://thepaypers.com/mergers-aquisitions-and-investments/news/mastercard-to-acquire-bvnk-for-up-to-usd-18-billion | S1 | Search |

**First refresh to-do:** open DefiLlama (M1), the Allium Q3 2026 report itself, and McKinsey (M5);
replace M2/M4/M7–M9 with the primary report.
