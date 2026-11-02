# H3: stablecoin pre-funding, plus Singapore and India regulation (research memo)

Prepared 2026-11-02 by research-intern, with crypto-protocol-engineer checking the chain facts. **Research memo only: no build, no outreach, not legal or tax advice.**

**About the sources.** This run could not open any primary source. Every host failed to resolve or was refused (CONNECT 403 / ENOTFOUND): mas.gov.sg, sso.agc.gov.sg, rbi.org.in, fema.rbi.org.in, fiuindia.gov.in, incometaxindia.gov.in, iras.gov.sg, bvnk.com, conduit.financial, bridge.xyz, circle.com, ripple.com, rain.xyz, borderless.xyz. So **nothing below is [VERIFIED] from this run**. Facts come from web-search summaries and are labelled `[ASSUMPTION: secondary, <source>]`. The one exception is copied from the research-intern pack with its original label. To promote these facts, Aashmiin needs to add the hosts above under Allowed domains in the environment's Network access settings, and then this memo should be re-run.

---

## India verdict (read first)

**India verdict: on what we can see, an Indian exporter or freelancer may not take USDT/USDC straight into their own wallet as export proceeds. Export proceeds must arrive in fiat through an authorised dealer (AD) bank, and India also taxes stablecoins as VDAs at 30% with 1% TDS. Clearline should therefore not target Indian recipients of stablecoin payments.** A FEMA/CA lawyer must confirm this before anyone relies on it. (Details are in Part 3.)

---

## Part 1: H3 "Stablecoin pre-funding" (raised by advisor Matt, Protégé Ventures. Matt is an advisor, not a customer.)

**What pre-funding is, in plain words.** A company paying people abroad (suppliers, contractors, sellers, payroll) usually has to place money in a local-currency account, or with its payout partner in that country, *before* the payout date. Bank transfers across borders take 1 to 3+ days, and the partner in the destination country will not pay out until it is sure the money is there. So cash sits idle in many accounts in many currencies, "just in case". That cash cannot be used elsewhere, which lengthens the cash conversion cycle and ties up working capital.

**Who feels it**
- Payment companies, remittance firms and PSPs that run payouts in many corridors. They keep nostro balances or partner balances in each currency.
- Payroll, EOR, contractor-payout and marketplace-payout firms. They often fund payroll before their own clients pay them.
- Exporters and importers. They pay suppliers ahead of time, or wait days for their receipts.

**How big.** No reliable figure. Vendor blogs give a range "from hundreds of billions to trillions". Some pages say "$27tn+". Others attribute ">$10tn" and "about 34% of international payment costs" to McKinsey, but none of them link to the McKinsey report [ASSUMPTION: secondary, spark.money / eco.com / fin.com vendor glossaries]. One page says the FSB cross-border roadmap names pre-funding as a major pool of trapped liquidity [ASSUMPTION: secondary, eco.com]. **Do not quote any of these numbers until the BIS CPMI or FSB reports themselves have been opened.**

**What firms do today.** They pre-fund nostro or partner accounts per corridor, use bank FX credit lines, net payments within one currency, and use local payout partners. Large firms run treasury tools that forecast how much each corridor will need [ASSUMPTION].

**How stablecoins reduce it.** The payer keeps **one** USD stablecoin balance. Settlement to the payout partner happens 24/7 in minutes. The partner then off-ramps to local currency only when the payout is due ("just-in-time"). Pre-funding in many currencies becomes a single balance, or an on-demand top-up [ASSUMPTION: secondary, tazapay.com, fireblocks.com]. The hard limit: the receiving partner still needs certainty the money will arrive, so the need for on/off-ramp liquidity and credit does not disappear [ASSUMPTION: secondary, tazapay.com].

**Who already does it.** None of these sites could be opened, so all of the following is secondary.
- **Bridge (Stripe)**: Stripe acquired it. Stablecoin payouts run through Stripe Connect, while the platform's balance stays in fiat [ASSUMPTION: secondary, stablecoininsider.org]. Sources disagree on the acquisition date.
- **BVNK**: enterprise stablecoin payments infrastructure. Mastercard reportedly agreed to acquire it in March 2026 for up to US$1.8bn [ASSUMPTION: secondary, beinsure.com / eco.com]. It has been linked to a Visa Direct pilot in which enterprises pre-fund *in stablecoins* [ASSUMPTION: secondary, eco.com].
- **Conduit**: aimed at emerging markets. Converts USDC/USDT into local-currency payouts through partner banks, settling T+0 to T+1 [ASSUMPTION: secondary, eco.com].
- **Circle CPN**: a network of financial institutions settling in USDC/EURC 24/7, pitched as "mitigating pre-funding". **CPN Managed Payments** launched 8 Apr 2026, so institutions can use it without touching digital assets themselves [ASSUMPTION: secondary, circle.com search snippet (page not opened), sidley.com, pymnts.com].
- **Ripple Payments / RLUSD**: Ripple offers On-Demand Liquidity (the old ODL) and the RLUSD stablecoin. Ripple's claims about its growth are its own [ASSUMPTION: secondary, coingape.com].
- **Others**: Tazapay (sells "no-prefunding payouts") [ASSUMPTION: secondary, tazapay.com blog]. For **Rain** and **Borderless**, searches found nothing usable and the sites would not load [GUESS: both are in stablecoin cards/payout infra; unchecked].

**This market is crowded and well funded (Stripe, Mastercard, Circle, Ripple), and every one of these firms holds or moves the money.**

**What needs a licence in Singapore**
- The **Payment Services Act 2019** regulates seven payment services, among them account issuance, domestic money transfer, cross-border money transfer, merchant acquisition, e-money issuance and **DPT services**. Anyone providing them in Singapore needs a Money-changing, Standard Payment Institution (SPI) or Major Payment Institution (MPI) licence unless exempt [ASSUMPTION: secondary, Deloitte / Allen & Gledhill summaries; MAS guide to the PSA appeared in search results only]. From 4 Apr 2024, the definitions of cross-border transfer and DPT services were widened to include *facilitating* transfers and holding DPT on behalf of customers (custody) [ASSUMPTION: secondary, search summary].
- **FSMA Part 9 (DTSP)** has been in force since **30 Jun 2025**. A Singapore-based firm providing digital token services *only to overseas customers* must be licensed. MAS said such licences would be granted only in "extremely limited circumstances", and it gave no grace period for unlicensed firms [ASSUMPTION: secondary, Withers / CMS / Bird & Bird / Allen & Gledhill].
- **Clearly needs a licence:** holding customer funds or stablecoins, sending them across borders, running the on/off-ramp, issuing accounts or wallets, or exchanging DPT for fiat. In short, any "we settle your payouts just-in-time" product.
- **Possibly buildable without one (lawyer must confirm):** read-only software that a *licensed* firm uses on its own data. Examples: corridor-by-corridor forecasting of pre-funding needs, treasury visibility across nostro balances and stablecoin wallets, and reconciling on-chain settlement against bank or off-ramp statements. In these tools the software never takes possession of money and never instructs a transfer [ASSUMPTION]. The open question for a lawyer is the post-2024 word "facilitating": could software that *triggers* or *routes* top-ups be caught? Tooling that only reads and reports looks lower risk, but no source we opened says so.

**H3 verdict:** keep this as a research memo only, with nothing built. The payment rails are already taken by licensed incumbents. The only adjacent idea that fits Clearline is read-only treasury and reconciliation visibility for licensed payout firms, and that is close to what Clearline already does (see the fit score below).

---

## Part 2: Singapore regulation of the current product

**USDT is not a MAS-regulated stablecoin.** MAS finalised its stablecoin framework on **15 Aug 2023**. It covers **single-currency stablecoins (SCS) pegged to SGD or a G10 currency and issued in Singapore**. Reserves must be held in the pegged currency, in cash, cash equivalents or short-dated government debt. Redemption is at par, reportedly within 5 business days. **Only SCS regulated under the framework may use the label "MAS-regulated stablecoin"**, and misusing the label can lead to penalties and a place on the Investor Alert List. Stablecoins outside the framework stay under the general DPT regime, and they are **not banned** from being issued, used or circulated in Singapore [ASSUMPTION: secondary, Morgan Lewis 22 Aug 2023, Allen & Gledhill, Bird & Bird; the MAS media release appeared in search results but could not be opened]. USDT (issued by Tether, outside Singapore) and USDC (issued by Circle) are therefore not "MAS-regulated stablecoins" under this framework [ASSUMPTION, based on the scope test above]. Neither source we saw lists any token as having received the label, so **which issuers or tokens qualify today is unknown**.

The framework needed amendments to the PSA. Our pack records a draft consultation from 1 Sep to 16 Oct 2026, with no date set for the law to take effect [ASSUMPTION: secondary, Gibson Dunn via claims audit R7 (pack label copied)]. One law-firm note mentions a "stablecoin issuance service" licence above S$5m in circulation [ASSUMPTION: secondary, A&O Shearman via search].

**Is a read-only verification/reconciliation tool covered by the PSA?**
- What Clearline does (chain facts): it checks USDT/USDC payments by transaction hash on Tron, Ethereum and BNB Chain, and it is read-only on chain with no custody, no keys and no moving of funds [VERIFIED: build session 2026-10-31, docs/SPEC.md §3; company/COMPANY_RULES.md rule 3]. Its payment-request pages are Ethereum-only, and they display a pay-to address; Clearline is never the recipient [VERIFIED: build session 2026-10-31, src/lib/requests/check.ts:74].
- What the sources say: the PSA licenses *payment services*, such as transferring, exchanging, holding or facilitating. No source we saw puts read-only data or accounting software in scope, and none expressly excludes it either. We could not open the PSA's First Schedule exclusions or MAS's FAQs. Our pack's view is that Clearline "does not perform a DPT service" (pack label [ASSUMPTION], claims audit A3, no legal advice taken).
- **Unclear, and needs a lawyer:** (1) whether a pay page that shows a merchant's address counts as "facilitating" under the 2024 amendments; (2) whether FSMA Part 9 could reach a Singapore firm whose customers are all overseas, if any of its features ever touched transfers; (3) GST treatment of stablecoin receipts. The pack records an IRAS conflict on whether fiat-pegged tokens count as DPT for GST, which is still open.

---

## Part 3: India check

**The plain version:** on what we can see, taking USDT/USDC directly as export proceeds is **not a permitted way of realising them** under FEMA. On top of that, VDA tax (30% with no loss set-off, plus 1% TDS) and an RBI stance that "leans toward prohibition" make it **high risk**.

**FEMA and export proceeds.** The RBI Master Direction on Export of Goods and Services, issued under FEMA ss.10(4) and 11(1), requires export proceeds to be realised through **AD banks** in freely convertible currency or INR, within set time limits. No crypto route appears in the text we could see [ASSUMPTION: secondary, search summary of rbi.org.in MD id=10395; page not opened]. The RBI reportedly notified new FEMA export/import regulations in 2026, possibly effective **1 Oct 2026**. These reportedly extend realisation to 15 months and add set-off as a way to realise proceeds [ASSUMPTION: secondary, Mondaq / L&S / karboncard; status not confirmed]. Stablecoins are treated as VDAs, not foreign currency, so a receipt into a wallet is not documented export realisation (no e-FIRA, no purpose code) [ASSUMPTION: secondary, xflowpay / karboncard vendor blogs]. The pattern vendors call compliant: a licensed provider converts the stablecoin **outside India** and remits fiat through the banking system [ASSUMPTION: secondary, xflowpay]. An Enforcement Directorate FEMA press release dated **19 Jun 2026** reportedly covers searches of Mudrex and Saber.money over unauthorised cross-border crypto transfers [ASSUMPTION: secondary, exchange4media; the ED PDF appeared in search results but was not opened].

**Tax**
- **s.115BBH**: VDA income is taxed at a flat **30%** (plus surcharge and cess). Only the cost of acquisition may be deducted. **A VDA loss cannot be set off against any other income or another VDA's gain, and cannot be carried forward** [ASSUMPTION: secondary, taxguru / patronaccounting].
- **s.194S**: **1% TDS** on VDA transfers above ₹50,000 a year for "specified persons" and ₹10,000 for others. Sources disagree on the detail [ASSUMPTION: secondary, search].
- The **Income-tax Act 2025** (from 1 Apr 2026) keeps both rules under renumbered provisions. The new section numbers were not confirmed [ASSUMPTION: secondary, patronaccounting / taxguru].
- **What this means for a freelancer paid in USDT:** the service income is taxed as normal. Converting the USDT to INR is then itself a VDA transfer, with possible 30% tax on any gain and 1% TDS at the exchange, and FX losses on the token cannot be set off. A CA is required.

**RBI stance and updates**
- In 2022, RBI leadership publicly called for crypto to be banned [ASSUMPTION: from memory, not checked this run].
- 2025–26: RBI is "cautious" and prefers a CBDC. Internal documents from May–Jun 2026 reportedly "lean toward prohibition". In July 2026 the RBI reportedly told the Parliamentary Standing Committee it favours "containment and a tendency to prohibit". The Finance Ministry reportedly floated a stablecoin framework in the Economic Survey 2025-26 [ASSUMPTION: secondary, Business Standard / Cointelegraph / paymentexpert.com]. The 2021 government discussion paper has stalled [ASSUMPTION: secondary].
- **FIU-IND:** VDA service providers (exchange, transfer, safekeeping, issuer services, carried out for others) are PMLA reporting entities and must register with FIU-IND [VERIFIED: research-intern 2026-10-31, https://fiuindia.gov.in/pdfs/downloads/VDASP04072023.pdf]. Clearline is read-only, so it does none of these [ASSUMPTION].

**What this means for targeting India:** do not market Clearline to Indian businesses or freelancers *receiving* stablecoins. Clearline would be helping record a receipt route that looks non-compliant. India stays in the "watch" column until a FEMA lawyer and a CA advise otherwise and the RBI or government publishes a framework.

---

## Draft scores for H3 (1–5; research only, not a decision)

| Criterion | Score | Why |
|---|---|---|
| Pain | 4 | Trapped working capital is real and widely cited. The size figures are unverified |
| Urgency | 3 | Rising with stablecoin rails, but firms already live with pre-funding |
| Willingness to pay | 3 | Payout firms do pay for treasury tooling. Unproven for a newcomer |
| Reachability (solo founder, SG/India) | 2 | The buyers are licensed PSPs and treasury teams. Long enterprise cycles. India is effectively closed |
| Regulatory risk (5 = low) | 2 | The core product needs an MPI/DTSP licence. Only read-only tooling might not, and that needs a lawyer |
| Fit with what's built | 3 | On-chain verification and reconciliation carry over to "did the settlement land and match". Forecasting and treasury would be new |

**Overall:** H3 is a weak fit as a business to build now. The read-only "settlement reconciliation for licensed payout firms" angle is worth one question to Matt, prepared as a draft for Aashmiin to send. No build.

**A lawyer is needed for:** PSA "facilitating" scope (Part 1 and the Part 2 pay page); FSMA Part 9 reach; IRAS GST on stablecoin receipts; FEMA export realisation in stablecoins, and the 2026 FEMA regulations; VDA tax on freelancers.
