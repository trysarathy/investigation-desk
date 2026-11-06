# Clearline: competitor analysis and how to stand out

Prepared 7 November 2026 for Aashmiin Kaur's crypto and fintech mentor meetings.

**How to read this.** Every claim about a competitor comes from a page I opened on 7 Nov 2026. The source number in brackets, for example [S15], links to the list in section 5. Labels:
- **[VERIFIED]**: the opened page says it.
- **[ASSUMPTION]**: my reasoning from verified facts. Treat it as a hypothesis to test.
- **[GUESS]**: a judgement call with little evidence behind it.

Vendor pages describe the vendor's own claims. They are not independent proof of performance. A job post shows work a company was hiring for at that date. It does not prove how the work is done today.

**What Clearline is (the current story).** It is a desk for cross-border payment providers that pay suppliers before their customers reimburse them. It does two jobs:
- Review the advance: is the invoice eligible, is cash actually free, and what happens if the importer pays late?
- Track what is still owed after the supplier is paid, linking the funding decision to delivery and collections.

It takes no custody and makes no credit decision. The first buyer is a Singapore provider that already advances money to recurring enterprise customers. The demo corridor is SG→US USD supplier payout.

**What is built** [VERIFIED, repo branch `provider-funding-lifecycle`, commit 35e539d, and `funding-replay-parity`, PR71]:
- A Python stdlib engine that tracks four separate facts: authorisation/reservation, cash draw, supplier delivery, and customer repayment.
- Accounting identities checked after every event. A breadth-first export walks every reachable state of seven synthetic cases.
- 139 Python tests for the earlier replay. The commit message reports a 208-test challenger round for the lifecycle build.

Nothing connects to a live bank, provider or ERP. No customer case has been replayed.

---

## 1. TL;DR

1. **No vendor I could find sells exactly "review this customer advance, then track what's still owed" to cross-border payment providers** [ASSUMPTION, based on about 60 vendor pages, section 3]. But the providers that make the most advances have built this in-house as a credit product. Examples: Ebury Supplier Payment Finance [S15], Payoneer Capital Advance [S14], and Airwallex's Singapore lending team [S8–S11]. Others hand the whole job to a financier, as PingPong did with MODIFI [S29].
2. **The gap that is left is narrow.** It is mid-sized licensed providers that front money to a few enterprise customers on their own balance sheet, without a lending product. In January 2024 Singapore had about 201 active Major Payment Institutions (MPIs), and 93% held a cross-border transfer licence [S110]. How many of them advance money is **unknown**.
3. **The evidence that the manual work exists is real but indirect.** Thunes, Nium and BVNK hired treasury staff in Singapore for daily funding wires, Excel-based liquidity monitoring, manual transaction handling and daily reconciliations [S100–S103]. None of those posts mentions customer advances.
4. **Stand out by being the quiet layer next to the provider's existing systems.** Concretely: a check that cash is free once MAS-safeguarded customer money is excluded [S104], an outstanding-advance ledger that writes into the tools the provider already uses, and alerts only on exceptions. Do not build another dashboard, credit model or stablecoin matcher.
5. **The biggest threat is substitution, not a clone.** Lenders that bundle payments, such as Airwallex lending and Ebury, and embedded financiers such as MODIFI, let a provider stop carrying advances itself. Clearline survives only if it becomes the evidence-and-servicing record that both the provider and its funder (bank or financier) rely on.

---

## 2. Competitor matrix

Overlap means how directly the product replaces Clearline's two jobs for Clearline's first buyer: reviewing the advance before payout, and tracking the receivable after payout.

| # | Name | Category | Region (as seen on page) | Overlap | Why |
|---|---|---|---|---|---|
| 1 | Airwallex (lending) | Provider with own credit | SG-hired lending team | **High (as substitute)** | Building SME lending, underwriting, collections and portfolio analytics in Singapore [S8–S11]. It can lend directly to the importer. |
| 2 | Ebury Supplier Payment Finance | Provider with own credit | UK, Europe, AU, NZ | **High (as substitute)** | Pays the supplier and the client repays up to 150 days later. Credit lines £50k–5m [S15][S16]. This is Clearline's case, run as an in-house product. |
| 3 | Payoneer Capital Advance | Provider with own credit | Multi-region | Medium | Credit based on account activity, repaid automatically from future balance [S14]. Aimed at sellers, not supplier advances to enterprises. |
| 4 | MODIFI (with PingPong) | Embedded trade credit via provider | Global, launched in SG | **High (as substitute)** | PSP plus financier B2B pay-later, so the provider does not carry the advance [S29][S30]. |
| 5 | Ripple Payments / Ripple Treasury | Rails + TMS | 60+ markets | Medium | "Zero Pre-Funding" treasury plus a $1B TMS acquisition [S24][S25]. Line of Credit for ODL users since 2020 [S26]. Attacks corridor prefunding, not customer credit. |
| 6 | Nium | Cross-border provider | 190+ countries | Low (as competitor), **potential buyer** | Clients prefund Nium, and Nium reconciles prefund requests automatically [S1][S2]. No customer-advance product found. |
| 7 | Thunes | Cross-border network | 140 countries, 720 members | Low (as competitor), **potential channel** | Members prefund in fiat, USDC or EURC [S5][S6]. No member-credit product found. |
| 8 | Wise Business | Provider | SG and global | Low | Accounts, payments and interest. No credit product on the SG page [S13]. |
| 9 | Corpay Cross-Border | Provider + FX risk | 200+ countries | Low | Payments and hedging. No supplier-advance product on the opened page [S17]. |
| 10 | Rapyd, dLocal | Payout platforms | Global / EM | Low | Payout rails. No advance product on opened pages [S18][S19]. |
| 11 | Aspire, Volopay, Reap | SME spend/payments | SG / APAC / HK | Low | SME tools. Reap credit is 100% collateralised [S22]. Not provider tooling. |
| 12 | Flash Payments (Ripple customer) | Provider | Australia | n/a: **potential customer** | Australian cross-border provider using Ripple Payments [S27]. |
| 13 | LiquidX | Trade/receivables finance platform | Global | Medium | Origination, monitoring and "turn-key business process servicing (TradeOps)" for financial institutions and corporates [S50]. Built for financiers, not for a PSP's ad-hoc advances. |
| 14 | C2FO, SAP Taulia | Buyer-led early pay / SCF | Global | Low | Large-buyer supplier programmes. ERP-integrated [S33][S34]. |
| 15 | Demica | Bank receivables platform | Global (banks) | Low–Medium | Automates bank trade-receivables programmes [S42]. Built for banks. |
| 16 | Drip Capital, Tradewind, Marco | Importer/exporter financiers | US / global / LatAm–US | Low (as substitute) | They lend to the importer directly, which takes the need away [S38][S39][S43]. |
| 17 | Validus, Funding Societies | SEA SME lenders | SEA | Low | Direct lenders. Funding Societies' page could not be opened. |
| 18 | KredX | India SCF/TReDS | India | Low | Domestic India invoice finance [S45]. |
| 19 | MonetaGo | Duplicate-financing registry | IN, SG, BH | Low (**useful input**) | Built Singapore's Trade Finance Registry [S51]. Treat it as a data source. |
| 20 | Traydstream, Komgo, Contour | Bank trade-finance workflow | Global | Low | Document/LC workflows for banks [S47][S48][S52][S53]. |
| 21 | Taktile, Provenir | Credit decisioning | Global | Medium | They own the credit-decision layer, which Clearline explicitly does not [S55][S56]. |
| 22 | Codat, Rutter, Plaid, Validis, Ocrolus | Financial-data connectors | Global | Low (**suppliers**) | Clearline could use them as inputs [S41][S59–S62]. |
| 23 | Zest AI, Alloy | Consumer credit / fraud | US-led | Low | Different problem [S57][S58]. |
| 24 | Lendflow, Slope | Embedded-lending infra | US | Low–Medium | For brands that launch lending programmes [S63][S64]. |
| 25 | Mondu, Billie, Hokodo, Two, Resolve | B2B BNPL / net terms | Europe / US | Low (as analogue) | Merchant checkout credit. The provider takes the risk [S65–S69]. |
| 26 | LoanPro, Canopy | Loan servicing core | US-led | **Medium–High** | They already do "track what is still owed" for working-capital lines and cash advances [S70][S71]. Too heavy for a PSP that isn't a lender. |
| 27 | Modern Treasury | Payment ops + ledger | US-centric | **Medium** | Lending solution: disburse, collect repayments, per-capital-partner accounts, ledger [S72][S74]. |
| 28 | Formance, Fragment, TigerBeetle | Ledger infrastructure | Global | Medium | Building blocks a provider's engineers could use to build Clearline's ledger themselves [S75–S78]. |
| 29 | Kyriba, Trovata, Nilus, Statement | TMS / cash visibility | Global | Medium (**integration targets**) | Cash position and forecasting. Kyriba also does supplier/receivables financing [S79–S81][S88][S89]. |
| 30 | Duco, AutoRek | Reconciliation | Global | Low–Medium | AutoRek sells safeguarding and loan reconciliations [S82][S83]. |
| 31 | HighRadius, Kolleno | O2C / AR / credit mgmt | Global | Low–Medium | Corporate AR and collections, not PSP advances [S84][S85]. |
| 32 | Ramp, Brex | US spend + treasury yield | US | Low | Not relevant to SG providers [S86][S87]. |
| 33 | BVNK (Mastercard), Bridge (Stripe), Circle CPN, Conduit, Borderless | Stablecoin rails | Global | Low–Medium | They shorten the *corridor-liquidity* clock, not the *customer-repayment* clock [S90–S96]. |
| 34 | Request Finance, Bitwave, TRES | Crypto AP/AR/accounting | Global | **High for the old experiment** only | Stablecoin invoice matching plus ERP sync already sold [S97–S99]. |
| 35 | Spreadsheet + bank portal + treasury analysts | Incumbent | Everywhere | **Highest** | Free, flexible, already trusted. Evidence in §3.6. |

**Dropped as competitors** [VERIFIED status]:
- **Marco Polo**: liquidators appointed in Feb 2023 [S49].
- **Stenn**: administrators appointed on 4 Dec 2024 [S37].
- **Triterras/Kratos**: the SEC charged the founder with fraud, alleging loans were added to the Kratos platform after the fact [S40]. The kratos.co domain now belongs to an unrelated music distributor.
- **Jiraaf**: a bond-investment platform [S46].
- **FlashPay** (Thailand): SEA merchant payments [S28].
- **YouTrip**: its business page could not be opened.
- **Tradeshift**: now an e-invoicing/compliance product [S35].
- **Zest and Alloy**: consumer/fraud.

These failures are lessons, not competitors. Each one put consortium governance or volume claims ahead of a single customer's value.

---

## 3. Competitor profiles

Format: **What** · **Buyer** · **Pricing** · **Regions** · **Overlap** · **Strength** · **Gap Clearline could exploit**.

### 3.1 Cross-border payment providers with their own pre-funding or credit features

**Airwallex (lending)** [VERIFIED S7–S12]
- **What:** Business accounts and payments. Since 2025–26 it has been hiring a *Director, Credit Risk, Lending* (Singapore; post removed 2 Jan 2026), a *Senior Product Manager, Lending* (Singapore; removed 29 Sep 2026), and a *Senior Data Scientist, Analytics (Lending)* (Singapore, posted 28 Jul 2026). The data-science post covers delinquency trends, early-warning indicators and portfolio reports. It also hired *Credit Risk Operations (Debt Collections)*, Singapore, for "written-off portfolio management". Airwallex Capital holds a MAS CMS licence for Yield [S12].
- **Buyer:** SMEs and enterprises. **Pricing:** SG plans are public [S7]. Lending pricing was not found.
- **Overlap: High, as a substitute.** If Airwallex lends to the importer directly, the importer's current provider no longer needs to front money.
- **Strength:** Distribution, data, its own collections team.
- **Gap:** It will not sell its credit tooling to competing providers [ASSUMPTION]. The providers it competes with need their own record of an advance.

**Ebury: Supplier Payment Finance** [VERIFIED S15, S16]
- **What:** Unsecured credit lines from £50k to £5m. "We pay your suppliers in their currency, you settle with us in yours up to 150 days later." The client uploads invoices.
- **Pricing:** In NZ, 0.35%–1.2% a month. **Regions:** NZ, Australia, Europe.
- **Overlap: High, as proof the workflow exists.** This is Clearline's exact case, run as a lender's product.
- **Strength:** Balance sheet, FX hedging built in.
- **Gap:** Ebury built its own tooling. The opportunity is with providers that advance *without* having become lenders [ASSUMPTION].

**Payoneer: Capital Advance** [VERIFIED S14]
- **What:** Offers based on Payoneer account activity, repaid automatically from future balances. **Buyer:** marketplace and e-commerce sellers.
- **Overlap: Medium.** The credit is tied to the seller's own receipts, not to a supplier payout.
- **Gap:** It doesn't cover enterprise supplier advances.

**Nium** [VERIFIED S1–S4]
- **What:** Payouts to 190+ countries, multi-currency accounts, stablecoin payouts. Clients send money to a "prefund account" and raise a prefund request. "The platform automatically verifies the transaction details and prefund request details" before crediting. A USDC funding programme was reported on 30 Aug 2026 [S4; article body paywalled].
- **Overlap: Low.** In Nium's model the *client* funds Nium first. That is the opposite of a provider advance.
- **Strength:** Automated prefund matching.
- **Gap:** Nium is evidence of what providers automate today (receiving prefunds). It is not evidence of advance tracking. [ASSUMPTION] Nium is a possible *buyer* if it ever funds payouts before client money arrives.

**Thunes** [VERIFIED S5, S6, S100]
- **What:** Direct Global Network across 140 countries and 90 currencies, with 720 members. Members prefund, including with USDC, and with EURC since Aug 2026.
- **Overlap: Low.**
- **Gap / channel:** Its members are fintechs, neobanks and PSPs. Some of them may front money to their own customers [ASSUMPTION]. Thunes is a possible distribution partner, not a competitor.

**Wise Business** [VERIFIED S13]
- **What:** Accounts, payments, interest, accounting connections. No credit product on the SG page. **Overlap: Low.**

**Corpay Cross-Border** [VERIFIED S17]
- **What:** Payments to 200+ countries, multi-currency accounts, currency risk management, invoice automation. About 21,000 customers. No supplier-advance product on the page. **Overlap: Low.**

**Rapyd and dLocal** [VERIFIED S18, S19]
- **What:** Payout/disbursement infrastructure, with dLocal focused on emerging markets. **Overlap: Low.** Both are possible buyers only if they advance to customers. Not evidenced.

**Aspire, Volopay, Reap** [VERIFIED S20–S22]
- **What:** SME spend and payments. Volopay advertises "credit" in its account. Reap cards are "secured corporate credit cards" with "credit limit is 100% of your collateral". Reap bill pay: 0.5% on bank transfers, US$25 cross-border fee.
- **Overlap: Low.** Not tooling for providers. Aspire's historic 60-day credit line could not be confirmed on a current page.

**Ripple Payments / Ripple Treasury** (named by a mentor) [VERIFIED S23–S26]
- **What:**
  - Fiat and stablecoin payouts across 60+ markets through one integration.
  - Line of Credit for ODL customers since Oct 2020: "upfront access to capital for every market through one simple credit arrangement".
  - $1B acquisition of the TMS vendor GTreasury, announced 16 Oct 2025.
  - "Zero Pre-Funding" in Ripple Treasury, reported 27 Jan 2026 via Coinspeaker/Yahoo (not a Ripple page).
- **Overlap: Medium.** Ripple targets the *corridor-liquidity* clock: money parked with payout partners. Clearline's case is the *customer-repayment* clock: the importer hasn't paid the provider. A faster rail does not make the importer pay sooner. The founding paper, p3, makes the same point.
- **Strength:** It now owns a TMS, so it sits inside corporate treasury.
- **Gap:** It doesn't model a provider's receivable from its own customer. **Threat:** Ripple Treasury could add a receivable view inside GTreasury [GUESS].

**"Flash pay" / FlashPay** (named by a mentor) [VERIFIED S27, S28]
- Two different companies exist:
  - **Flash Payments** is "an Australian-based digital payments provider offering solutions for cross-border transactions". It "integrated Ripple Payments" through an exclusive partnership with Ripple.
  - **FlashPay** is a Thailand-listed payment provider for SEA merchants and Chinese cross-border merchants.
- [ASSUMPTION] Because the mentor mentioned it alongside Ripple, they most likely meant **Flash Payments**. That makes it a *customer archetype*, a provider using Ripple liquidity, not a competitor.
- **Action:** ask the mentor whether Flash Payments ever pays out before its customers fund.

**MODIFI (with PingPong)** [VERIFIED S29, S30]
- **What:** Announced in Singapore on 16 Nov 2023. MODIFI provides "global B2B Buy Now Pay Later functionality in partnership with PingPong". Sellers are paid instantly and buyers pay later.
- **Overlap: High, as a substitute.** This is the template for a provider *not* carrying the advance.
- **Gap:** The provider gets no independent record. Clearline could be the hand-off record between a provider and its financier [ASSUMPTION].

**Paysend: Instant Settlement Accounts** [VERIFIED S31]
- **What:** Launched 29 May 2025 for PSPs, banks and FX brokers. Claims up to USD 400bn of "liquidity trapped in cross-border payment processing".
- **Overlap: Low.** Corridor liquidity again.

### 3.2 Trade, receivables and supply-chain finance platforms

**LiquidX** [VERIFIED S50]
- **What:** Digitise invoices; monetise AR, SCF and ABF; TradeHub risk monitoring; "turn-key business process servicing with TradeOps". **Buyer:** financial institutions, corporates, insurers.
- **Overlap: Medium.** Origination plus servicing for funders.
- **Gap:** Built for financing programmes, not one PSP's few enterprise advances. Follow the paper's rule: if a prospect already uses LiquidX for this, don't pitch a replacement.

**C2FO** [VERIFIED S33]
- **What:** Early Pay, dynamic discounting and SCF. Calls itself the "world's largest working capital platform". ERP/AP integration "in weeks".
- **Overlap: Low.** It is buyer-led.
- **Strength to copy:** It sells integration speed.

**SAP Taulia** [VERIFIED S34]
- **What:** Payables, SCF, dynamic discounting, receivables finance, inside SAP. **Overlap: Low.** It shows that working-capital tools win by living inside the ERP.

**Tradeshift** [VERIFIED S35]
- **What:** E-invoicing and compliance. **Overlap: Low.**

**Previse** [VERIFIED S36]
- **What:** Now presents itself as B2B transaction-data insights: "connect, match and monitor", with SmartPay automated early payments. **Overlap: Low.**

**Stenn** [VERIFIED S37]
- **Status:** Joint administrators were appointed to Stenn Assets UK and Stenn International on 4 Dec 2024. **Dropped.**

**Marco (marcofi.com)** [VERIFIED S38]
- **What:** Cross-border finance OS for LatAm–US companies, including a credit line. **Overlap: Low.** Different corridor, and it lends directly.

**Drip Capital** [VERIFIED S39]
- **What:** Import trade finance for US buyers. The buyer submits the invoice and bill of lading, pays 20%, and Drip pays the supplier. **Overlap: Low.** It is a direct lender to the importer, but its process is a useful reference for what evidence an advance needs.

**Triterras / Kratos** [VERIFIED S40]
- **Status:** The SEC alleges the founder had loans added to the Kratos platform "after the fact" to inflate volumes. **Dropped.**
- **Lesson:** Record when each fact was *first known*. Clearline's engine already does this with `known_at ≤ as_of` (funding-replay README).

**Validis** [VERIFIED S41]
- **What:** Standardised accounting data for audit and lending, with an MCP server. **Overlap: Low**; it is a possible data supplier.

**Demica** [VERIFIED S42; homepage blocked]
- **What:** Since 2002, a platform that lets banks automate trade-receivables programmes. **Overlap: Low–Medium** for banks only.

**Tradewind** [VERIFIED S43]
- **What:** Export factoring that advances up to 90%. **Overlap: Low.**

**Validus** [VERIFIED S44]
- **What:** SME lender in SG, ID, TH and VN with US$5bn+ funded. **Overlap: Low.**

**Funding Societies**
- Could not be opened (Cloudflare 403). Not assessed.

**KredX** [VERIFIED S45]
- **What:** RBI-licensed TReDS, reverse factoring, collections automation in India. **Overlap: Low.**

**Jiraaf** [VERIFIED S46]
- **What:** A bond-investment platform. **Dropped.**

**Contour** [VERIFIED S47, S48]
- **What:** LC network, sold by Xalts to XDC Ventures in Oct 2025, which plans to "re-energise" it. Its homepage now shows "USDC settlement on XDC Network". **Overlap: Low.**

**Marco Polo** [VERIFIED S49]
- **Status:** Insolvent in Feb 2023 with €5.2m of debt. **Dropped.**

**MonetaGo** [VERIFIED S51]
- **What:** Built Singapore's Trade Finance Registry after the 2020 commodity-finance frauds. Selected by ABS from 10 shortlisted companies.
- **Overlap: Low; it is an input.** Clearline should consume an authorised registry result where one exists, not rebuild one.

**Traydstream, Komgo, SGTraDex** [VERIFIED S52–S54]
- **What:** Bank document checking, multi-bank trade-finance platforms, and Singapore's trade data exchange, which has a "trade finance fraud detection" use case. **Overlap: Low.** These are possible evidence sources.

### 3.3 Credit-decision and lending infrastructure

**Taktile** [VERIFIED S55]
- **What:** "Agentic decision platform" for banks and insurers: business onboarding and underwriting. **Overlap: Medium.**
- **Strength:** Policy-as-code decisioning.
- **Gap:** It decides *whether* to lend. It does not track a payout's delivery or match repayments after payout.

**Provenir** [VERIFIED S56]
- **What:** Decisioning plus data marketplace plus case management. Payments companies are a named industry. "120+ financial services providers in 60+ countries". **Overlap: Medium.** Same gap as Taktile.

**Zest AI, Alloy** [VERIFIED S57, S58]
- **What:** Consumer underwriting, fraud and identity. **Overlap: Low.**

**Ocrolus** [VERIFIED S59]
- **What:** Document AI for lenders: bank statements, pay stubs, tax documents. **Overlap: Low.**

**Codat (lending), Rutter, Plaid** [VERIFIED S60–S62]
- **What:** Business accounting/commerce/bank data APIs. Codat lists "Cross-Border Payments" as an industry it serves.
- **Overlap: Low.** These are **suppliers**. Rutter could give Clearline read access to the importer's accounting with permission.

**Lendflow, Slope** [VERIFIED S63, S64]
- **What:** Embedded credit programmes and cash-flow scores. **Overlap: Low–Medium**; US-centric.

**Mondu, Billie, Hokodo, Two, Resolve** [VERIFIED S65–S69]
- **What:** B2B pay-later at merchant checkout. Mondu serves 30+ European countries. Two has "Two for Banks" and "Risk-as-a-Service". Resolve advances 50%, 75% or 90% of the invoice.
- **Overlap: Low.** They are a useful analogy: these vendors *own* the risk and the servicing.

**LoanPro, Canopy (added)** [VERIFIED S70, S71]
- **What:** Loan-management systems with servicing, collections and payments suites. Canopy explicitly supports "Working Capital Line of Credit" and "Cash Advances" for commercial lenders.
- **Overlap: Medium–High** on the post-payout half.
- **Gap:** They assume you are a lender with a loan product, not a PSP whose advance is tied to a supplier payout and a delivery event [ASSUMPTION].

### 3.4 Payment-ops, ledger and reconciliation tools

**Modern Treasury** [VERIFIED S72–S74]
- **What:** Multi-rail payments, stablecoins, ledgers. Its lending solution: "Fund loans … collect repayments by ACH, and keep each capital partner's funds in its own account. One API for the money movement from origination through servicing." Claims $700bn in payments.
- **Pricing:** Not public (form). **Regions:** US-led (ACH, RTP, FedNow).
- **Overlap: Medium.** It is the closest "infra" answer.
- **Gap:** It moves money and keeps the ledger, but has no advance-eligibility policy, no supplier-delivery evidence, and no SG/MAS focus. Clearline must *not* move money.

**Formance** [VERIFIED S75, S76]
- **What:** Open-source programmable ledger, with the core under the MIT licence. **Pricing:** Enterprise is a custom annual quote. Wallets, Flows and Reconciliation modules are Enterprise-only.
- **Overlap: Medium.** A provider's engineers could build Clearline's ledger on it.

**Fragment** [VERIFIED S77]
- **What:** Ledger plus payments plus recon. **Pricing:** Free for 1,000 entries a month, then $0.005 per ledger entry. **Overlap: Medium** as a build-it-yourself base.

**TigerBeetle** [VERIFIED S78]
- **What:** A debit/credit financial-transactions database. **Overlap: Low.** It is infrastructure.

**Kyriba** [VERIFIED S79, S80]
- **What:** TMS covering treasury, payments, connectivity, and "Working Capital: supplier & receivables financing", including stablecoin/on-chain liquidity.
- **Overlap: Medium.** It is also an **integration target**. If a provider runs Kyriba, Clearline should post exposures into it rather than replace it.

**Trovata** [VERIFIED S81]
- **What:** Cash visibility and TMS. **Pricing:** Base package **$24k a year** (1 bank, 100 accounts).
- **Overlap: Medium.** Useful benchmark: Clearline's SGD 12k/yr hypothesis is about a third of Trovata's base price.

**Nilus, Statement** [VERIFIED S88, S89]
- **What:** AI treasury/AR/AP. Tipalti has acquired Statement. **Overlap: Low–Medium.** Mostly US corporate treasury.

**Duco** [VERIFIED S82]
- **What:** Rule-based and agentic data matching and reconciliation for financial services. **Overlap: Low–Medium.**

**AutoRek** [VERIFIED S83]
- **What:** Reconciliations, including **safeguarding**, loan, payment and RTP reconciliations.
- **Overlap: Low–Medium.** It is the closest existing seller to the safeguarding angle, but it is reconciliation, not advance review.

**HighRadius, Kolleno** [VERIFIED S84, S85]
- **What:** Corporate O2C: collections, cash application, credit management. **Overlap: Low–Medium.** These tools manage the corporate's own AR, not a PSP's fronted payouts.

**Ramp, Brex** [VERIFIED S86, S87]
- **What:** US business banking with treasury yield. **Overlap: Low.**

### 3.5 Stablecoin rails (and the earlier experiment)

**BVNK** [VERIFIED S90, S91]
- **What:** Stablecoin send/receive and embedded wallets. Mastercard completed the up-to-$1.8bn acquisition (Cointelegraph, 4 Aug 2026). BVNK hired a Singapore "Treasury & Payment Operations Analyst" who handles "manual and automated transactions" [S103].
- **Overlap: Low–Medium.**

**Bridge (Stripe)** [VERIFIED S92, S93]
- **What:** Stablecoin orchestration, issuance and wallets. Stripe completed the acquisition on 4 Feb 2025. **Overlap: Low.**

**Circle Payments Network** [VERIFIED S94]
- **What:** "Settled in stablecoins". Used by PSPs, fintechs and banks for B2B cross-border payments. **Overlap: Low–Medium.**

**Conduit, Borderless** [VERIFIED S95, S96]
- **What:** Conduit offers USD accounts and stablecoin/fiat payouts. Borderless orchestrates 19+ licensed providers in 113+ countries with a flat platform fee. **Overlap: Low.**

**Request Finance** [VERIFIED S97, via WebFetch]
- **What:** Stablecoin/fiat invoicing with automated reconciliation and QuickBooks/Xero/NetSuite integration.
- **Pricing:** Free tier, Basic $500–600 a month, Premium $7,500–9,000 a month.
- **Overlap: High for the old stablecoin-matching experiment.** That is a reason to keep it archived.

**Bitwave, TRES** [VERIFIED S98, S99]
- **What:** Enterprise crypto accounting, "invoice matching", ERP subledger, multi-source reconciliation. **Overlap: High for the old experiment.**

**Conclusion on stablecoins** [ASSUMPTION]: These rails reduce *how long a payout partner holds liquidity*. They do not make the importer repay sooner. They do not remove Clearline's problem. They may *add* a fact to track (on-chain transfer vs. off-ramp credit), which the paper already plans for.

### 3.6 The real incumbent: spreadsheets, email, bank portals and treasury analysts

What the evidence shows people do today [VERIFIED]:

- **Thunes, Treasury Analyst** (Singapore, posted 24 Aug 2026) [S100]:
  - "Prepare and execute daily funding wires and FX conversions"
  - "performing daily reconciliations of all trading and settlement activity"
  - "Investigate and resolve payment issues … non-receipt of funds"
  - "Confirm credit of funds, release transactions"
- **Nium, Senior Analyst – Treasury Operations** [S101]:
  - "Manage end-to-end funding activities across multiple currency corridors … initiating, monitoring, and confirming fund transfers"
  - "Monitor intraday liquidity positions and escalate potential shortfalls"
  - "proficiency in Excel"
- **Nium, Director – Treasury – Cash Management & Safeguarding** (London; removed 19 Nov 2025) [S102]:
  - "Oversee daily safeguarding reconciliations, asset segregation"
  - Safeguarding policy "in compliance with FCA, EEA, MAS"
- **BVNK, Treasury & Payment Operations Analyst APAC** (Singapore; removed 6 Nov 2025) [S103]:
  - "Process and monitor both manual and automated transactions, including deposit allocation … Handle failed payments, liquidity movements"
  - Weekend on-call is "shared among 12 analysts"

**What this proves and doesn't:**
- It proves that providers employ people to do daily funding, liquidity monitoring and reconciliations by hand or semi-manually, in Singapore.
- It does **not** prove that those people review customer advances, or that advances are frequent. No job post I opened mentions fronting customers.
- [ASSUMPTION] Where advances exist, they are handled by the same treasury team plus a credit/risk sign-off, in Excel and email. This is the founder's advisor account, not observed.

**Incumbent strength:** zero cost and full flexibility. The reviewer can call the approver directly.

**Incumbent gap:** no single record that separates "supplier paid" from "provider repaid"; no reservation lock on cash; no audit trail of what was known when [ASSUMPTION, to test in the replay].

---

## 4. Answers

### Q1. Is "advance review + what's still owed" already solved for cross-border providers?

**For providers that turned advances into a credit product, yes, in-house.**
- Ebury runs the exact flow (pay supplier now, client repays up to 150 days later) as a priced product [S15][S16].
- Payoneer runs activity-based advances with automatic repayment [S14].
- Airwallex has staffed a full Singapore lending function: credit-risk director, product manager, portfolio data science, collections [S8–S11].
- These firms are **not buyers**. They are the benchmark, and potential substitutes.

**For providers that don't want the risk, yes, by partnering.**
- PingPong + MODIFI moves the credit and its servicing to the financier [S29].
- Loan-servicing cores (Canopy, LoanPro) and Modern Treasury's lending flow cover the post-payout half for anyone willing to be a lender [S70][S71][S74].

**For mid-sized licensed providers that front money ad hoc, without a lending product: probably not.** This is the only plausible gap.
- [ASSUMPTION] No vendor page I opened offers a lightweight tool that links an advance to (a) free-cash checks under safeguarding, (b) supplier delivery evidence and (c) repayment matching.
- [VERIFIED] The workflow sits inside teams that hire for manual funding and reconciliation work [S100–S103].

**How well do the in-house solutions work?** Unknown. No public metrics.

**Is it real enough to sell? Not yet proven.** The honest grade is *weak*:
- [VERIFIED, founding paper p1] The only direct evidence is one advisor's account.
- [VERIFIED S110] The market ceiling is small. About 201 active MPIs in Jan 2024, 93% with cross-border licences. The share that front enterprise customers is unknown [ASSUMPTION: perhaps a few dozen, GUESS].
- At the paper's SGD 12k a year, 20–100 paying providers is SGD 240k–1.2m ARR (paper p6). That is not venture scale on its own.

**Regulatory facts that make the problem sharper.** All need Singapore counsel before use.
- [VERIFIED S104] PSA 2019 s.23, "Safeguarding of money received from customer", applies to Major Payment Institutions.
  - [ASSUMPTION] An advance should come from the provider's own funds or a facility, not from safeguarded customer money. "Is cash actually free?" is therefore partly a regulatory question, not only a liquidity one.
  - Nium's safeguarding-director post names MAS among the regimes it must meet [S102].
- [VERIFIED S105] PSA licensees "are prohibited from … lending to individuals or sole proprietorships".
  - [ASSUMPTION] Advances to *companies* are the permitted lane. Clearline's eligibility rules should hard-block non-corporate borrowers.
- [VERIFIED S106, S107] Under the Moneylenders Act, an "excluded moneylender" includes a person regulated by MAS "to the extent … permitted", and lenders "solely to corporations" commonly rely on the exclusion.
  - [ASSUMPTION] This is why corporate-only advances are viable for PSPs. Do not state it as legal advice.
- [VERIFIED S109] Since 4 Apr 2024, MAS regulates facilitation of cross-border money transfer "even where moneys are not accepted or received in Singapore".
  - Being non-custodial does not exempt Clearline from analysis if it ever *initiates* payments. Stay read-and-record only.

### Q2. The 3–5 strongest ways to stand out

These are concrete product decisions. They follow mentor feedback: integrate into existing systems, stay quiet when things go well, alert on exceptions, keep it simple for non-experts.

**Move 1: Build "What's still owed" first. Ship it as an exposure feed, not a dashboard.**
- **Input:** the provider's daily bank-statement export (CSV/MT940) plus its payout status export.
- **Output:**
  - A per-advance record with three states kept apart: supplier paid, provider repaid, fees outstanding.
  - A daily file or API post into the systems the provider already has: its general ledger/ERP (Xero/NetSuite journal), its TMS (Kyriba/Trovata import), or simply a Google Sheet or Excel it already uses.
- **Why first:**
  - The post-payout half rests on objective data (bank lines, payout status).
  - It is furthest from the credit decision that Taktile/Provenir and in-house teams own.
  - It is easy to replay on five historical cases.
  - [ASSUMPTION] A wrongly matched repayment, or an importer receipt mistaken for repayment, is a concrete, auditable error. "Faster review" is a vague benefit.
- **Reuse:** the engine's four-facts model and invariants. That is the built asset.

**Move 2: The free-cash check excludes safeguarded money.**
- Before an advance is approved, compute deployable cash = own-funds and facility headroom − safeguarded customer balances − already-reserved advances − committed payouts.
- Show which rule blocks. Lock the reservation so two cases can't use the same cash (already in the engine's invariants).
- **Differentiator:** Modern Treasury, Formance, Kyriba and Taktile are generic. None ties a customer advance to MAS safeguarding [ASSUMPTION based on S72–S81, S55, S56]. AutoRek reconciles safeguarding but doesn't review advances [S83].
- **Caveat:** have counsel confirm the safeguarding interpretation first.

**Move 3: Silent by default. Five exception alerts, in the channel they already use (email/Slack/Teams).**
- Alert only when:
  1. repayment is past due;
  2. the importer's own receipt is seen but the provider is still unpaid (the Northwind case);
  3. supplier credit is unconfirmed X hours after release;
  4. a partial, wrong-currency or excess repayment needs a human;
  5. a reservation is expiring or double-booked.
- Each alert carries one sentence in plain English and one link to the evidence. No logins are needed for the happy path.
- This answers the mentor feedback directly and keeps the tool simple for non-experts.

**Move 4: A one-click evidence pack for whoever funds or audits the advance.**
- Per advance: what was known when (the `known_at` rule), who approved, the policy version, cash used, delivery and repayment events.
- Exportable as PDF/CSV for the credit committee, the auditor and the *provider's own funding bank*.
- This turns Clearline from "ops convenience" into "record a third party relies on". That is the only route to a moat without building a network [ASSUMPTION]. It also answers the Triterras lesson: never back-date facts [S40].

**Move 5: Stop doing these.**
- Stop positioning stablecoin invoice matching publicly. Request Finance, Bitwave and TRES already sell it with ERP sync [S97–S99]. Keep the code as an evidence adapter.
- Stop credit scoring, registries and "network" talk. MonetaGo owns the SG registry [S51]. Taktile and Provenir own decisioning [S55][S56].
- Stop documentary credits and eBL. That space belongs to Contour, Komgo and Traydstream [S47][S52][S53].
- Stop building a standalone UI beyond one review screen.

**Build order** [ASSUMPTION]:
1. CSV import of five redacted historical advances and a bank statement → outstanding ledger plus repayment matching.
2. Exception alerts by email.
3. Daily export to the provider's sheet or ERP.
4. Evidence pack.
5. Pre-payout free-cash check.
6. Only then, connectors (Kyriba/Xero/NetSuite) chosen by what the first two customers actually run.

### Q3. Positioning

**Primary** [ASSUMPTION; defensible against the matrix]:
> **"Clearline is the exposure record for payment providers that pay suppliers before their customers pay them back: it checks the advance is funded from free cash, tracks it until repaid, and only speaks up when something goes wrong."**

Why it holds up:
- Not a lender: unlike Ebury, Airwallex and MODIFI.
- Not a credit engine: unlike Taktile and Provenir.
- Not a money mover: unlike Modern Treasury.
- Not a TMS: unlike Kyriba and Trovata. It feeds them.

**Alternative A, compliance-led:**
> "Safeguarding-safe customer advances: prove every early payout came from free cash, and keep the receivable visible until it's repaid."

Stronger with risk/compliance buyers. Needs a counsel-confirmed rule set first.

**Alternative B, funder-led:**
> "The servicing record a bank or financier can rely on when it funds a payment provider's supplier advances."

Sells to the provider's lender, such as DBS. Bigger if banks pull it; harder to get first.

### Q4. Threats: who could crush this in 12 months, and how Clearline survives

| Threat | Mechanism | Likelihood in 12 mo | Survival move |
|---|---|---|---|
| **Lenders that bundle payments (Airwallex lending, Ebury SPF)** | They lend to the importer directly, so the provider stops fronting money. | Medium–High [ASSUMPTION; Airwallex hiring S8–S11] | Target providers whose enterprise customers *won't* switch payment provider. Make Clearline the record the provider uses if it later partners with a lender. |
| **Embedded financiers (MODIFI-type)** | The provider hands credit and servicing to a partner [S29]. | Medium | Offer the financier an import of Clearline's evidence pack (Move 4). Be the hand-off, not the loser. |
| **Modern Treasury / Formance / Fragment** | Provider engineers build the ledger themselves [S74–S77]. | Medium for engineering-heavy providers | Sell the policy, evidence and exception layer, not the ledger. Run on top of their ledger if they have one. |
| **Ripple Treasury (GTreasury)** | A TMS plus rails plus "zero pre-funding" adds receivables [S24][S25]. | Low–Medium [GUESS] | Integrate *into* TMSs. Stay rail-neutral. |
| **The spreadsheet** | "Good enough" | **High** | The replay test in the paper (p5, p7): if a better spreadsheet does as well, say so and stop. |

**Single biggest threat** [ASSUMPTION]: **substitution**. The importer gets credit from a lender bundled with payments (Airwallex, Ebury) or from a financier partnered with the PSP (MODIFI), so the provider stops carrying advances.

**How Clearline survives:**
- **Wedge:** providers that already front money and want to keep the customer relationship.
- **Data:** a within-provider history of advance → evidence → outcome, with permission.
- **Partnerships:** the provider's funding bank and auditor accept the evidence pack.
- **Regulatory positioning:** a read-only, non-custodial record-keeper that keeps safeguarded money separate from advances. Confirm with counsel.

### Q5. Partnerships and channels: who would want Clearline to exist

- **The provider's funding bank (e.g. DBS).**
  - [ASSUMPTION] A bank lending a facility to a PSP for advances wants proof that draws match real, eligible, repaid advances. That is borrowing-base-style reporting.
  - [VERIFIED S111] DBS Token Services includes "Conditional Payments". [ASSUMPTION] That conceptually matches "release only when evidence X exists".
  - Aashmiin already has a DBS Institutional Banking contact.
- **Financiers that partner with PSPs (MODIFI-type, Ebury-type) or lend to them.** A standard evidence pack reduces their onboarding work per provider [ASSUMPTION].
- **Auditors / safeguarding reviewers.** A clean per-advance trail separated from safeguarded money [ASSUMPTION]. MAS audit requirements for safeguarding were *not* verified here.
- **Networks whose members are PSPs (Thunes: 720 members) [S5].** A referral channel if members front their customers [ASSUMPTION].
- **TMS/ERP vendors (Kyriba, Trovata, Xero/NetSuite marketplaces).** An integration listing is distribution. Trovata at $24k/yr shows the budget line exists [S81].
- **Data suppliers (Codat, Rutter, Validis, MonetaGo, SGTraDex).** Inputs, not channels [S41][S51][S54][S60][S61].

### Q6. Short answers to the hardest mentor questions

1. **"Why won't Nium (or Thunes, Airwallex) just build this?"**
   - "The big ones that lend already have, as a credit product: Ebury, Payoneer, and Airwallex's lending team in Singapore. Nium's own model is that clients prefund Nium.
   - I'm targeting providers that front a few enterprise customers without wanting to become lenders. For them, building an exposure ledger, evidence trail and safeguarding check is a distraction.
   - If a provider has engineers free for this, they're not my first customer."
2. **"Isn't this Modern Treasury (or Formance)?"**
   - "Modern Treasury moves money and keeps a ledger, and its lending flow disburses and collects.
   - Clearline moves no money. It sits on top of whatever ledger or bank export the provider has. It adds the advance-specific rules: is the cash free once safeguarded money is excluded, has the supplier actually been credited, and is the importer's own receipt *not* a repayment?
   - If a provider runs Modern Treasury, I'd read from it."
3. **"Isn't this Taktile / Provenir?"**
   - "No. They decide whether to lend. The provider keeps that decision.
   - I start *after* the decision: was it funded from free cash, did the supplier get paid, and what's still owed. A credit engine stops caring the moment the decision is made."
4. **"Why not a spreadsheet, or a loan-servicing system like Canopy?"**
   - "A spreadsheet may well be enough. My first paid test is a replay of five of their past cases against their current process, and I'll say so if the spreadsheet wins.
   - Loan-servicing cores assume you run a loan product. These advances are tied to a supplier payout and a delivery event, inside a payments licence."
5. **"Won't stablecoins or Ripple remove pre-funding and kill this?"**
   - "They shorten the time liquidity sits with payout partners. That is the corridor clock.
   - They don't make the importer pay the provider back sooner. That is the customer clock, which is what Clearline tracks.
   - A stablecoin route adds one more fact to check: on-chain transfer vs. off-ramp credit to the supplier."

Bonus: **"Isn't this just Ebury Supplier Payment Finance?"**
- "Ebury is the lender. I'm the record for providers who lend to their own customers, or who want their funder to rely on their records."

---

## 5. Sources

All pages opened on **2026-11-07**. Dates in brackets are the page's own publication dates where shown.

**Cross-border providers and rails**
- S1 Nium docs, Prefund Account. https://docs.nium.com/docs/payins/program-client-and-client-prefund-account
- S2 Nium docs, Key Concepts. https://docs.nium.com/docs/getting-started/key-concepts
- S3 Nium homepage. https://www.nium.com/
- S4 PYMNTS, "Nium Debuts USDC Funding for Client Payouts" [30 Aug 2026; body paywalled]. https://www.pymnts.com/?p=4135655
- S5 Thunes homepage. https://www.thunes.com/
- S6 CFOtech, "Thunes adds EURC prefunding" [17 Aug 2026]. https://cfotech.com.au/story/thunes-adds-eurc-prefunding-for-euro-treasury-flows
- S7 Airwallex SG pricing. https://www.airwallex.com/sg/pricing
- S8 Airwallex, Director, Credit Risk, Lending (SG) [removed 2 Jan 2026]. https://builtinsingapore.com/job/director-credit-risk-lending/7113802
- S9 Airwallex, Senior Data Scientist, Analytics (Lending) (SG) [posted 28 Jul 2026]. https://jobs.airtree.vc/companies/airwallex/jobs/87808253-senior-data-scientist-analytics-lending
- S10 Airwallex, Credit Risk Operations (Debt Collections) (SG) [removed 17 Jun 2026]. https://builtin.com/job/associate-manager-credit-risk-operations/8190087
- S11 Airwallex, Senior Product Manager, Lending (SG) [removed 29 Sep 2026]. https://www.builtinla.com/job/senior-product-manager-lending/9860171
- S12 The Paypers, Airwallex Yield/CMS licence [29 Jul 2025]. https://thepaypers.com/fintech/news/airwallex-introduces-yield-in-singapore-following-mas-licence-approval
- S13 Wise Business SG. https://wise.com/sg/business/
- S14 Payoneer, Cash flow & capital. https://www.payoneer.com/cash-flow-and-capital/
- S15 Ebury, Supplier Payment Finance. https://ebury.com/products/financing/supplier-payment-finance
- S16 eCommerceNews NZ, Ebury SPF launch. https://ecommercenews.co.nz/story/ebury-launches-supplier-payment-finance-in-new-zealand
- S17 Corpay Cross-Border. https://www.corpay.com/cross-border
- S18 Rapyd Disburse. https://www.rapyd.net/products/disburse/
- S19 dLocal. https://www.dlocal.com/
- S20 Aspire Payments (SG). https://aspireapp.com/en-sg/use-case/payments
- S21 Volopay SG. https://www.volopay.com/sg/
- S22 Reap pricing. https://reap.global/pricing (also https://reap.global/)
- S23 Ripple cross-border payments. https://ripple.com/solutions/cross-border-payments/
- S24 Ripple press, GTreasury acquisition [16 Oct 2025]. https://ripple.com/ripple-press/ripple-breaks-into-corporate-treasury-with-gtreasury-acquisition/ (also https://treasury.ripple.com/news/ripple-acquires-gtreasury)
- S25 Yahoo Finance/Coinspeaker, Ripple Treasury "Zero Pre-Funding" [27 Jan 2026]. https://finance.yahoo.com/news/ripple-treasury-platform-eliminates-pre-195747492.html
- S26 Ripple, Line of Credit [8 Oct 2020]. https://ripple.com/insights/fund-instant-cross-border-payments-with-a-line-of-credit-from-ripplenet/
- S27 Ripple case study, Flash Payments. https://ripple.com/customer-case-study/flash-payments/
- S28 Fintech News SG directory, FlashPay (Thailand). https://fintechnews.sg/fintech-startups-thailand/fintech/flashpay/
- S29 PR Newswire, PingPong and MODIFI [16 Nov 2023]. https://prnewswire.com/news-releases/pingpong-and-modifi-announce-partnership-to-transform-b2b-cross-border-payments-and-digital-trade-finance-301990357.html
- S30 MODIFI homepage. https://www.modifi.com/
- S31 The Paypers, Paysend Instant Settlement Accounts [29 May 2025]. https://thepaypers.com/payments/news/paysend-launches-instant-settlement-accounts-for-businesses-to-unlock-liquidity

**Trade/receivables finance**
- S33 C2FO. https://c2fo.com/
- S34 SAP Taulia. https://taulia.com/
- S35 Tradeshift. https://tradeshift.com/
- S36 Previse. https://previse.co/
- S37 Stenn administration notice. https://www.stenn.com/
- S38 Marco. https://www.marcofi.com/
- S39 Drip Capital US trade finance. https://www.dripcapital.com/en-us/products/trade-finance/
- S40 GTR, SEC accuses Triterras [10 Dec 2025]. https://www.gtreview.com/news/global/sec-accuses-triterras-of-fraud-says-transactions-recorded-after-the-fact/ (also https://www.gtreview.com/news/tag/kratos/)
- S41 Validis. https://validis.com/
- S42 GTR, Demica direct access [26 Jun 2019]. https://www.gtreview.com/news/fintech/demica-to-offer-direct-access-to-its-receivables-finance-platform/
- S43 Tradewind. https://www.tradewindfinance.com/
- S44 Validus. https://www.validus.sg/
- S45 KredX. https://www.kredx.com/
- S46 Jiraaf. https://www.jiraaf.com/
- S47 Contour. https://contour.network/
- S48 GTR, XDC Ventures to re-energise Contour [29 Oct 2025]. https://www.gtreview.com/news/digital-trade/xdc-ventures-to-re-energise-contour-after-xalts-sale/
- S49 GTR, Marco Polo liquidators [23 Feb 2023]. https://www.gtreview.com/news/fintech/marco-polo-brings-in-liquidators-as-funds-run-dry/
- S50 LiquidX. https://www.liquidx.com/ and https://www.liquidx.com/working-capital-solutions-monetize/
- S51 MonetaGo case studies. https://www.monetago.com/use-cases
- S52 Traydstream. https://www.traydstream.com/
- S53 Komgo. https://www.komgo.io/
- S54 SGTraDex. https://www.sgtradex.com/

**Credit and lending infrastructure**
- S55 Taktile. https://taktile.com/
- S56 Provenir. https://www.provenir.com/
- S57 Zest AI. https://www.zest.ai/
- S58 Alloy. https://www.alloy.com/
- S59 Ocrolus. https://www.ocrolus.com/
- S60 Codat lending. https://www.codat.io/lending/
- S61 Rutter. https://www.rutter.com/
- S62 Plaid. https://plaid.com/
- S63 Lendflow. https://www.lendflow.com/
- S64 Slope. https://slope.so/
- S65 Mondu. https://www.mondu.ai/
- S66 Hokodo. https://www.hokodo.co/
- S67 Two. https://www.two.inc/
- S68 Billie. https://www.billie.io/en
- S69 Resolve and pricing. https://resolvepay.com/ and https://resolvepay.com/pricing
- S70 LoanPro. https://www.loanpro.io/
- S71 Canopy. https://www.canopyservicing.com/

**Payment ops, ledgers, treasury, reconciliation**
- S72 Modern Treasury. https://www.moderntreasury.com/
- S73 Modern Treasury pricing. https://www.moderntreasury.com/pricing
- S74 Modern Treasury lending. https://www.moderntreasury.com/solutions/lending
- S75 Formance. https://www.formance.com/
- S76 Formance pricing. https://www.formance.com/pricing
- S77 Fragment pricing. https://fragment.dev/pricing (also https://fragment.dev/)
- S78 TigerBeetle. https://tigerbeetle.com/
- S79 Kyriba. https://www.kyriba.com/
- S80 Kyriba working capital. https://www.kyriba.com/products/working-capital/
- S81 Trovata pricing. https://trovata.io/pricing/
- S82 Duco. https://du.co/
- S83 AutoRek. https://autorek.com/
- S84 Kolleno. https://www.kolleno.com/
- S85 HighRadius. https://www.highradius.com/
- S86 Ramp. https://ramp.com/treasury
- S87 Brex. https://www.brex.com/product/business-account
- S88 Nilus. https://www.nilus.com/
- S89 Statement (Tipalti acquisition banner). https://www.statement.io/

**Stablecoin and crypto finance**
- S90 BVNK. https://www.bvnk.com/
- S91 Cointelegraph, Mastercard completes BVNK acquisition [4 Aug 2026]. https://cointelegraph.com/news/mastercard-completes-bvnk-acquisition-stablecoin-push
- S92 Bridge. https://www.bridge.xyz/
- S93 Stripe, completes Bridge acquisition [4 Feb 2025]. https://stripe.com/us/newsroom/news/stripe-completes-bridge-acquisition
- S94 Circle Payments Network. https://www.circle.com/cpn
- S95 Conduit. https://www.conduit.financial/
- S96 Borderless. https://www.borderless.xyz/
- S97 Request Finance pricing (via WebFetch). https://www.request.finance/pricing
- S98 Bitwave. https://www.bitwave.io/ (also https://www.bitwave.io/pricing)
- S99 TRES Finance. https://tres.finance/

**Incumbent and regulation**
- S100 Thunes, Treasury Analyst (SG) [posted 24 Aug 2026]. https://jobs.insightpartners.com/companies/thunes/jobs/90979735-treasury-analyst
- S101 Nium, Senior Analyst – Treasury. https://jobera.com/job/nium-senior-analyst-treasury-d16b05ba/
- S102 Nium, Director – Treasury – Cash Management & Safeguarding [removed 19 Nov 2025]. https://builtin.com/job/director-treasury-cash-management-safeguarding/7049329
- S103 BVNK, Treasury & Payment Operations Analyst APAC (SG) [removed 6 Nov 2025]. https://builtinsingapore.com/job/treasury-payment-operations-analyst-apac/7453076
- S104 Payment Services Act 2019 (s.23 heading). https://sso.agc.gov.sg/Act/PSA2019
- S105 Withers, Payment services ecosystem in Singapore. https://www.withersworldwide.com/en-gb/insight/read/payment-services-ecosystem-in-singapore
- S106 Moneylenders Act 2008. https://sso.agc.gov.sg/Act/MA2008
- S107 Legal500, Singapore Lending & Secured Finance. https://www.legal500.com/guides/chapter/singapore-lending-secured-finance/
- S108 MAS, Licensing for Payment Service Providers. https://www.mas.gov.sg/regulation/payments/licensing-for-payment-service-providers
- S109 MAS, Expands Scope of Regulated Payment Services [2 Apr 2024]. https://www.mas.gov.sg/news/media-releases/2024/mas-expands-scope-of-regulated-payment-services
- S110 FXC Intelligence, Singapore MPI data [22 Jan 2024]. https://www.fxcintel.com/research/press-releases/new-data-shows-singapores-importance-to-cross-border-payments-industry
- S111 DBS, Token Services [18 Oct 2024]. https://www.dbs.com/newsroom/DBS_rolls_out_blockchain_powered_banking_for_institutions_with_DBS_Token_Services_marks_new_milestone_in_financial_services
- S112 DBS, Treasury Tokens with Ant International [13 Aug 2024]. https://www.dbs.com/newsroom/DBS_launches_blockchain_powered_Treasury_Tokens_pilot_with_Ant_International_for_247_treasury_and_liquidity_management

**Internal**
- Clearline Founding White Paper, 5 Nov 2026 (7 pp.).
- `docs/mentor-review/{MENTOR_SHEET,REVIEW,PAPER_EDITS}.md` on `origin/review/mentor-paper`.
- `funding-replay/README.md` and `LIFECYCLE_CONTRACT.md` on `origin/provider-funding-lifecycle`.

**Could not verify (blocked or not found):**
- Tazapay's "no-prefunding payouts" article (Cloudflare 403). This is a possible Singapore competitor or customer and should be checked by hand.
- Funding Societies (403).
- Demica homepage.
- YouTrip business page.
- Aspire's current credit line.
- Full text of PSA s.23 and of MAS safeguarding audit requirements (only the section heading was read).
- Any public page of a vendor selling exactly this workflow to PSPs.
- Any provider annual report quantifying customer advances.
- Airwallex's lending product page (evidence is job posts only).
