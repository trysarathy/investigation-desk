# Regulation that touches businesses receiving stablecoins

Last refreshed 2026-10-29 · owner: research-intern · refresh: monthly + any watch hit.
**Not legal or tax advice.** Every "can they / must they" answer needs professional review.

Label key (see `research-method.md`): `[VERIFIED]` = page opened on the date shown;
`[ASSUMPTION: search]` = reported by a web-search result for the cited URL, page **not** opened
(on 2026-10-29 this build's network blocked page fetches; promote at the next refresh);
`[ASSUMPTION]` = our reasoning. Source IDs `[R#]` are listed at the bottom.

**Primary-source re-check 2026-10-31:** only the FIU-IND item below could be opened. Still blocked by
this environment's network policy (CONNECT 403): congress.gov, govinfo.gov, occ.gov,
federalregister.gov, fincen.gov, esma.europa.eu, eba.europa.eu, elegislation.gov.hk, hkma.gov.hk,
mas.gov.sg, iras.gov.sg, sso.agc.gov.sg (403), incometaxindia.gov.in, fca.org.uk,
bankofengland.co.uk, circle.com, binance.com, tether.io (tether.to/news redirects there),
theblock.co. eur-lex.europa.eu answers with a bot challenge (no text). home.treasury.gov and
rbi.org.in load, but the GENIUS NPRMs and an RBI stablecoin statement could not be located on them.
Everything else in this file keeps its old label.

## 0. One-screen summary (as of 29 Oct 2026)

| Jurisdiction | Status | What it means for a business that *receives* USDC/USDT | Next date to watch |
|---|---|---|---|
| **US: GENIUS Act** | Law since 18 Jul 2025; effective 18 Jan 2027 (or earlier); OCC final rule out 21 Oct 2026 | Regulates **issuers** and, from ~Jul 2028, which stablecoins US **service providers** may offer. Receiving payment is not regulated by it [ASSUMPTION]. Expect more US payers on USDC/USAT; USDT's US path is the foreign-issuer route | 18 Jan 2027 effective; Treasury/FinCEN finals; ~18 Jul 2028 DASP rule |
| **EU: MiCA** | EMT/ART rules since 30 Jun 2024; CASP transition ended 1 Jul 2026 | USDT not MiCA-authorised: EU-authorised venues don't offer it. EU payers increasingly pay in **USDC/EURC**. A non-EU merchant receiving USDT is not a CASP for that [ASSUMPTION] | Commission MiCA review; ESMA Q&A |
| **Hong Kong** | Stablecoins Ordinance in force 1 Aug 2025; first 2 issuer licences 10 Apr 2026 | Only licensed fiat-referenced stablecoins may be offered to retail; USDT/USDC are unlicensed in HK. Merely receiving them as payment is not "offering" [ASSUMPTION] | HKD stablecoin launches (HSBC, Anchorpoint); further licences |
| **Singapore** | PSA DPT licensing; FSMA DTSP regime from 30 Jun 2025; draft stablecoin law consulted 1 Sep–16 Oct 2026 | Receiving DPT for your own goods/services is not itself a DPT service [ASSUMPTION]; using DPT as payment is disregarded for GST | MAS response + subsidiary legislation; enactment date (none set) |
| **India** | 30% tax + 1% TDS on VDA transfers; FIU-IND registration for VDA service providers; RBI cautious | Indian recipients face TDS/FEMA/export-realisation questions; CA review always | Any RBI/government stablecoin paper; FIU-IND enforcement |
| **UK** | FCA final stablecoin-issuance rules 30 Jun 2026; regime in force 25 Oct 2027 | No change for receivers yet; UK-issued "qualifying stablecoins" later | FCA gateway window; Oct 2027 go-live |

## 1. United States: GENIUS Act

**Status**
- Public Law 119-27, approved 18 Jul 2025 [VERIFIED] (whitepaper claims audit R1, 2026-10-29) [R1].
- Effective on the earlier of **18 Jan 2027** (18 months after enactment) or 120 days after the
  primary regulators issue final rules [ASSUMPTION: search] [R2][R3].
- **OCC final rule, 21 Oct 2026**, effective 18 Jan 2027, covering permitted payment stablecoin
  issuers (PPSIs) it supervises, foreign issuers and certain custody [ASSUMPTION: search] [R4][R5][R6]
  (also reported in claims audit R2 from a news source [VERIFIED secondary]). Reported content:
  - 1:1 identifiable, segregated reserves; daily liquidity minimum cut from a proposed 10% to 5%;
  - redemption within 2 business days; no automatic 7-day extension; tell the OCC within 24 h if
    requests exceed 10% of a brand's outstanding value;
  - at least US$5m capital; weekly confidential reports from 25 Jan 2027, quarterly from 31 Mar 2027;
  - statutory yield ban kept, "interest/yield" not defined, affiliate presumption dropped;
  - BSA/AML/sanctions left to a separate rulemaking with Treasury; applications not yet open.
- Treasury NPRMs (Apr 2026; 17 Aug 2026 on what it means to "issue" in the US); FinCEN/OFAC AML
  NPRM (Apr 2026) still pending per mid-2026 trackers [ASSUMPTION: search] [R7][R8].

**Key statutory provisions** (law-firm summaries) [ASSUMPTION: search] [R2][R3][R9][R10]
- Only PPSIs may issue payment stablecoins in the US; algorithmic/investment tokens out of scope.
- Reserves: cash, insured deposits, T-bills ≤93 days, short repos, approved MMFs, Fed deposits;
  no rehypothecation except narrow cases.
- Monthly public reserve composition, examined by a registered public accounting firm; CEO and
  CFO certify.
- No yield or interest paid to holders for holding the stablecoin.
- Custody of payment stablecoins/reserves/keys only by regulated institutions.
- **Three years after enactment (≈ Jul 2028)** digital asset service providers may not offer or
  sell to US persons a payment stablecoin not issued by a PPSI (or a compliant foreign issuer).

**Market moves tied to it**
- Tether launched **USAT** on 27 Jan 2026, issued by Anchorage Digital Bank, for the US market;
  USDT continues globally [ASSUMPTION: search] [R11].
- Stripe's Bridge got **conditional OCC approval** for a national trust bank (Feb 2026; sources
  differ 12 vs 17 Feb) [ASSUMPTION: search] [R12].
- Accounting (not GENIUS, but linked): FASB proposed ASU (18 Aug 2026) with examples of
  stablecoins as cash equivalents; comments due 19 Nov 2026; not final [VERIFIED] (claims audit S6) [R13].

**What it means for Clearline's buyers** [ASSUMPTION]
- A US company receiving USDC for an invoice is not regulated by GENIUS for that. The practical
  effects are on *which token* payers hold and where they can buy it.
- After ~Jul 2028, USDT on US platforms depends on Tether qualifying as a compliant foreign
  issuer; US payers may shift toward USDC/USAT. Clearline should support whatever arrives and
  report the token and contract per payment.
- Sales line we may use: "From January 2027 US stablecoin issuers are federally supervised, with
  full reserves and monthly published reserve reports." Never say Clearline is "GENIUS compliant".

## 2. European Union: MiCA (Regulation (EU) 2023/1114)

**Stablecoin rules**
- Titles on asset-referenced tokens (ARTs) and e-money tokens (EMTs) apply since **30 Jun 2024**
  [VERIFIED] (claims audit R3, EBA page) [R14]. The rest of MiCA, including CASPs, from
  30 Dec 2024 [ASSUMPTION — widely known; confirm on eur-lex].
- EMT issuers must be credit institutions or e-money institutions; white paper notified to the
  competent authority; redemption at par at any time; no interest; recovery/redemption plans
  [ASSUMPTION: search] [R15].
- "Significant" EMT/ART if ≥3 criteria are met (e.g. >10m holders, >€5bn issued/reserves);
  then the EBA supervises directly [ASSUMPTION: search] [R15][R16].
- USDC and EURC are issued in the EU by Circle Mint Europe SAS, a French EMI (authorisation
  announced 1 Jul 2024) [ASSUMPTION: search, secondary tracker] [R17].
- **USDT is not MiCA-authorised**; Tether did not seek authorisation [ASSUMPTION: search] [R18][R19].

**The USDT delisting timeline**
- 17 Jan 2025 ESMA/Commission statement: CASPs to restrict services in non-compliant ARTs/EMTs as
  soon as possible and **no later than end-Q1 2025**; sell-only allowed until then; mere custody
  and transfer may continue with a warning to clients [ASSUMPTION: search] [R20][R21].
- Coinbase restricted USDT for EEA users around Dec 2024 (exact date unconfirmed); Kraken moved
  Feb–Mar 2025 (sell-only from 24 Mar); **Binance ended EEA spot USDT trading on 31 Mar 2025**,
  keeping deposits, withdrawals and conversion [ASSUMPTION: search] [R22][R23].
- Self-custody holding of USDT by an EU resident is not illegal: MiCA regulates issuers and CASPs
  [ASSUMPTION: search] [R19].

**CASP transition**
- The grandfathering period ended **1 Jul 2026** EU-wide with no extension (ESMA statement of
  17 Apr 2026); unlicensed firms serving EU clients must stop [VERIFIED] (claims audit R4, FSMA
  Belgium page) [R24]; ESMA statement itself [ASSUMPTION: search] [R25]. One secondary source says
  only ~17% of pre-MiCA registrants had CASP authorisation by May 2026 [ASSUMPTION: search, weak] [R26].

**What it means** [ASSUMPTION]
- An EU customer paying a non-EU supplier: USDC/EURC is the low-friction route; USDT is still
  transferable from self-custody or a non-EU platform but harder to acquire through EU-authorised
  CASPs. Expect EU-origin payments to skew USDC/EURC; expect "wrong token" exceptions where an
  invoice asks for USDT.
- The *supplier* receiving payment for its own service is not providing a crypto-asset service by
  receiving it. If it holds or exchanges crypto for others, MiCA may bite. Counsel needed.

## 3. Hong Kong: Stablecoins Ordinance (Cap. 656)

- Passed 21 May 2025; in force **1 Aug 2025** [VERIFIED date] (claims audit R5, news.gov.hk) [R27];
  passage date [ASSUMPTION: search] [R28].
- HKMA licence needed to issue a fiat-referenced stablecoin (FRS) in Hong Kong, or an
  HKD-referenced one anywhere; only licensed entities may offer FRS to, or actively market them to,
  the HK public [ASSUMPTION: search] [R28][R29].
- Only FRS from HKMA licensees may be offered to **retail**; permitted offerors are licensees,
  authorised institutions, SVF licensees, SFC-licensed VA trading platforms and Type 1
  corporations. USDT/USDC are unlicensed in HK; commentary says professional investors only
  [ASSUMPTION: search, weak secondary] [R30].
- AML/CFT guideline for issuers, including the travel rule, gazetted with the regime
  [ASSUMPTION: search] [R29].
- **First licences 10 Apr 2026**: Anchorpoint Financial (Standard Chartered/Animoca/HKT JV,
  FRS01) and HSBC (FRS02); 36 applications; further licences "very limited"; both plan HKD
  stablecoins (HSBC H2 2026) [VERIFIED licence date] (claims audit R6) [R31]; details
  [ASSUMPTION: search] [R32][R33].

**What it means** [ASSUMPTION]: an HK trading or SaaS firm *accepting* USDT from a counterparty
is not issuing or offering. Advertising "pay us in USDT" to HK retail customers is a grey area to
put to counsel. Watch: once HKD stablecoins launch, HK B2B payers may invoice in them.

## 4. Singapore: MAS

- **Payment Services Act 2019**: DPT services (dealing, exchange, transfer, custody) need an MPI
  or SPI licence. Merchant acceptance usually runs through licensed providers, e.g. HitPay with
  Triple-A (MAS MPI), which convert to SGD [VERIFIED for HitPay/Triple-A] (claims audit C3) [R34];
  Circle Singapore holds an MPI licence [ASSUMPTION: search] [R35].
- **FSMA Part 9 (DTSP) from 30 Jun 2025**: Singapore-based firms providing digital token services
  only to overseas customers must be licensed; no transition; MAS said licences only in extremely
  limited circumstances [ASSUMPTION: search] [R36][R37].
- **Stablecoin framework**: MAS published draft PSA amendments for consultation on **1 Sep 2026**,
  closing **16 Oct 2026**; no enactment date; non-MAS stablecoins stay lawful under the DPT regime
  [VERIFIED] (claims audit R7, Gibson Dunn) [R38]. Reported scope: single-currency stablecoins
  pegged to SGD or a G10 currency issued in Singapore; full HQLA reserves, segregated; par
  redemption within a set period; no interest to holders; only licensees may use the label
  "MAS-regulated stablecoin"; openness to recognising foreign-issued coins; subsidiary legislation
  consulted later [ASSUMPTION: search] [R38][R39][R40].
- **GST (IRAS)**: since 1 Jan 2020 exchanges of DPT for fiat or other DPT are exempt; using a DPT
  as payment is disregarded as a supply; GST applies to the underlying goods/services as normal
  [ASSUMPTION: search, conflicting] [R41]. **Conflict:** other search results quote IRAS as saying
  tokens pegged to fiat (i.e. stablecoins like USDC/USDT) are NOT digital payment tokens for GST, so
  this treatment may not apply to stablecoin receipts. Until a tax adviser confirms, every answer must
  state the conflict; never say "no GST issue". First-refresh to-do: open the IRAS DPT definition and
  put the question to a tax adviser (owner: research-intern, then finance-admin).

**What it means** [ASSUMPTION]: a Singapore company invoicing in USDC/USDT and receiving into its
own wallet is not providing a DPT service by being paid. It must still charge GST on the supply if
registered (how the stablecoin leg itself is treated is unresolved, see R41 conflict above), and book the receipt (FX/valuation). Clearline is read-only and holds nothing, so it
does not perform a DPT service (claims audit A3 — no legal advice taken).

## 5. India

- **Tax**: 30% flat tax on VDA gains (s.115BBH), no loss set-off; **1% TDS** on VDA transfers
  (s.194S) above ₹50,000 (specified persons) or ₹10,000 (others) a year; Income Tax Act 2025
  (from 1 Apr 2026) carries these forward with renumbered sections [ASSUMPTION: search, secondary;
  sources conflict on details] [R42][R43].
- **FIU-IND**: VDA service providers (exchange VDA↔fiat or VDA↔VDA, transfer, safekeeping, issuer-offer
  services, for or on behalf of others) are PMLA reporting entities and must register with FIU-IND;
  failure to register is itself non-compliance (s.13(2) PMLA) [VERIFIED: FIU-IND notice F.No.
  9-8/2023/COMPL/FIU-IND of 04.07.2023, https://fiuindia.gov.in/pdfs/downloads/VDASP04072023.pdf ,
  2026-10-31]. "Including offshore platforms serving Indian users" and "54 registered by May 2026"
  [ASSUMPTION: search, weak] [R44] (no registered-VDA-SP list found on fiuindia.gov.in).
- **RBI**: Governor Malhotra urges a "cautious" approach (monetary sovereignty, capital flows,
  dollarisation); a government working group is to take the final view; a Reuters-attributed
  report says the stance "leans toward prohibition" (unconfirmed) [ASSUMPTION: search] [R45][R44].
- **FEMA**: stablecoins treated as VDAs, not foreign currency; exporters paid in USDT face
  export-realisation questions (FIRA/purpose codes) [ASSUMPTION: search, vendor blog] [R46].

**What it means** [ASSUMPTION]: Indian businesses receiving USDT have tax (TDS on the VDA leg),
FEMA and export-documentation exposure. Good pain for Clearline's evidence pack, but every
India-specific statement needs a CA. Also relevant to Clearline's own invoicing (finance-admin).

## 6. United Kingdom: FCA (only where relevant)

- 30 Jun 2026: FCA final policy statements PS26/9–PS26/13; **PS26/10 = stablecoin issuance**
  (backing in the same currency, short-term deposits/government debt, redemption, safeguarding,
  disclosure; £350k permanent minimum capital for issuers); Bank of England regulates systemic
  issuers [ASSUMPTION: search] [R47][R48][R49].
- PS26/18 perimeter guidance (Sep 2026): hybrid-backed or partly algorithmic tokens are not
  "qualifying stablecoins" [ASSUMPTION: search] [R50].
- Regime in force **25 Oct 2027**; application window reportedly 30 Sep 2026–28 Feb 2027
  (secondary, conflicting) [ASSUMPTION: search] [R51].

**What it means**: nothing changes for UK receivers today; UK-issued GBP stablecoins arrive from
late 2027.

## 7. What sales and content may say (and may not)
- OK: dated, sourced facts from this file with `[VERIFIED]`.
- Not OK: "Clearline makes you compliant with MiCA/GENIUS/MAS"; "USDT is illegal in the EU";
  "you don't need a licence" (that is advice). Say "worth checking with your counsel".

## Sources (all accessed 2026-10-29)
| ID | URL | Tier | How |
|---|---|---|---|
| R1 | https://www.govinfo.gov/metadata/pkg/PLAW-119publ27/mods.xml | P1 | Opened by claims audit |
| R2 | https://www.morganlewis.com/pubs/2025/07/genius-act-passes-in-us-congress-a-breakdown-of-the-landmark-stablecoin-law | S1 | Search |
| R3 | https://www.gtlaw.com/ar/insights/2025/7/genius-act-enacted-establishing-a-regulatory-framework-for-payment-stablecoins-issued-or-sold-in-the-united-states | S1 | Search |
| R4 | https://www.occ.gov/news-issuances/news-releases/2026/nr-occ-2026-92.html | P1 | Search |
| R5 | https://infobytes.orrick.com/2026-10-23/occ-finalizes-genius-act-rule-for-payment-stablecoin-issuers/ | S1 | Search |
| R6 | https://www.mondaq.com/unitedstates/financial-services/1859202/occ-finalizes-genius-act-rules-for-payment-stablecoin-issuers | S1 | Search |
| R7 | https://www.chapman.com/assets/htmldocuments/Chapman-GENIUS-Act-Rulemaking-and-Reporting-Tracker-081126.pdf | S1 | Search |
| R8 | https://coinmarketcap.com/academy/article/us-treasury-opens-comment-period-on-genius-act-stablecoin-rules | S3 | Search |
| R9 | https://www.paxos.com/blog/genius-act | P2 | Search |
| R10 | https://insightplus.bakermckenzie.com/bm/banking-finance_1/united-states-the-genius-act-a-new-federal-framework-for-stablecoin-issuers-custodians-and-banks | S1 | Search |
| R11 | https://cointelegraph.com/news/tether-launch-usat-regulated-stablecoin-us | S1 | Search |
| R12 | https://www.theblock.co/post/390263/stripe-stablecoin-bridge-wins-conditional-occ-approval-national-bank-charter | S1 | Search |
| R13 | https://www.crowe.com/insights/take-into-account/fasb-proposes-cash-equivalents-guidance-for-stablecoins | S1 | Opened by claims audit |
| R14 | https://eba.europa.eu/regulation-and-policy/asset-referenced-and-e-money-tokens-mica | P1 | Opened by claims audit |
| R15 | https://21analytics.ch/blog/mica-electronic-money-tokens | S3 | Search |
| R16 | https://www.eba.europa.eu/activities/direct-supervision-and-oversight/markets-crypto-assets | P1 | Search |
| R17 | https://eco.com/support/en/articles/15192006-mica-compliant-stablecoins-2026-full-list-with-issuers | S3 | Search |
| R18 | https://thepaypers.com/crypto-web3-and-cbdc/news/tether-exits-eu-market-as-mica-rules-block-usdt-from-exchanges | S1 | Search |
| R19 | https://guardarian.com/blog/?p=9714 | S3 | Search |
| R20 | https://www.esma.europa.eu/press-news/esma-news/esma-and-european-commission-publish-guidance-non-mica-compliant-arts-and-emts | P1 | Search |
| R21 | https://www.williamfry.com/knowledge/esma-statement-on-services-re-non-micar-compliant-art-emts/ | S1 | Search |
| R22 | https://cointelegraph.com/news/binance-halt-spot-usdt-trading-eea-mica-compliance | S1 | Search |
| R23 | https://glenbrook.com/payments_news/stablecoin-shakedown-binance-coinbase-and-kraken-restrict-usdt-in-europe-ahead-of-mica-deadline/ | S1 | Search |
| R24 | https://www.fsma.be/en/news/crypto-assets-service-providers-end-transitional-period | P1 | Opened by claims audit |
| R25 | https://www.esma.europa.eu/sites/default/files/2026-04/ESMA75-113276571-1679_Statement_on_the_end_of_transitional_periods_under_MiCA.pdf | P1 | Search |
| R26 | https://coinpaprika.com/news/mica-transitional-period-ends-1-july-2026/ | S3 | Search |
| R27 | https://www.news.gov.hk/eng/2025/06/20250606/20250606_140750_137.html | P1 | Opened by claims audit |
| R28 | https://www.jonesday.com/en/insights/2025/06/hong-kong-passes-law-on-stablecoins | S1 | Search |
| R29 | https://www.davispolk.com/insights/client-update/hong-kong-s-new-stablecoin-licensing-and-regulatory-regime | S1 | Search |
| R30 | https://asiastablecoin.substack.com/p/hong-kongs-stablecoin-vision-asias | S3 | Search |
| R31 | https://www.charltonslaw.com/hkma-issues-first-stablecoin-issuer-licences/ | S1 | Opened by claims audit |
| R32 | https://www.theblock.co/news/markets/2026-04-10-hsbc-and-anchorpoint-financial-gain-first-hong-kong-stablecoin-issuer-licenses-396990 | S1 | Search |
| R33 | https://news.rthk.hk/rthk/en/component/k2/1850625-20260410.htm | S1 | Search |
| R34 | https://hitpayapp.com/crypto-payment-gateway-hitpay | P2 | Opened by claims audit |
| R35 | https://www.theasianbanker.com/press-releases/circle-singapore-obtained-major-payment-institution-licence | S1 | Search |
| R36 | https://cms.law/en/sgp/legal-updates/singapore-s-june-30-hard-deadline-for-crypto-firms-serving-overseas-customers | S1 | Search |
| R37 | https://www.allenandgledhill.com/sg/publication/articles/30739/regulatory-framework-for-digital-token-service-providers-under-financial-services-and-markets-act-2022-in-operation-on-30-june-2025 | S1 | Search |
| R38 | https://www.gibsondunn.com/singapore-publishes-draft-legislation-to-implement-its-stablecoin-framework/ | S1 | Opened by claims audit (dates); search (scope) |
| R39 | https://www.fireblocks.com/blog/mas-stablecoin-framework-impact | S3 | Search |
| R40 | https://thepaypers.com/crypto-web3-and-cbdc/news/mas-consults-on-legislative-changes-for-stablecoin-framework | S1 | Search |
| R41 | https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/charging-gst-(output-tax)/when-is-gst-not-charged/supplies-exempt-from-gst | P1 | Search |
| R42 | https://www.patronaccounting.com/blog/crypto-vda-taxation-income-tax-act-2025-rules | S3 | Search |
| R43 | https://indiapolicyhub.in/2026/04/23/crypto-tax-rules-india/ | S3 | Search |
| R44 | https://coinpedia.org/cryptocurrency-regulation/crypto-regulations-india/ | S3 | Search |
| R45 | https://cointelegraph.com/news/india-government-consider-stablecoin-framework-diverge-rbi | S1 | Search |
| R46 | https://www.xflowpay.com/blog/stablecoin-b-2-b-payments-india-offramp-compliance | S3 | Search |
| R47 | https://www.fca.org.uk/publication/policy/ps26-10.pdf | P1 | Search |
| R48 | https://www.skadden.com/insights/publications/2026/07/fca-finalises-core-rules-for-the-uk-cryptoasset-regime | S1 | Search |
| R49 | https://www.bankofengland.co.uk/paper/2026/boe-and-fcas-approach-to-joint-regulation-of-systemic-stablecoin-issuers | P1 | Search |
| R50 | https://www.fca.org.uk/publication/policy/ps26-18.pdf | P1 | Search |
| R51 | https://www.adclear.ai/blog/the-fca-cryptoasset-regime-explained-stablecoin-rules-key-dates-and-what-firms-need-to-do | S3 | Search |

**First refresh to-do:** open R4, R20, R25, R41, R47 (the P1 pages) and promote; replace S3 rows
(R15, R17, R19, R26, R30, R42–R44, R46, R51) with P1/S1 sources or drop the claim.
