# Competitor positioning summary and teardowns

Last refreshed 2026-10-31 · owner gtm-strategist. **The competitor facts live in
`team/knowledge/research-intern/competitors.md` (owner research-intern); this file cites them and
keeps their labels. A fact that is `[ASSUMPTION: search]` there stays an assumption here.** The
teardowns in §3 are of pages gtm-strategist opened this run (2026-10-31), so those facts are
`[VERIFIED]` as what the company publishes about itself (not as true about the market).

## 1. The map (from research-intern's tracker, labels kept)
| Category | Players (tracker row) | How they position (our reading) | What it means for Clearline's frame |
|---|---|---|---|
| A. Crypto sub-ledgers | Cryptio (1), TRES (8), Bitwave (2), Ledgible (3), Integral (7), Cryptoworth (9), Lukka (10) | Enterprise "back office / FinOS / source of truth" for whole-company digital-asset books; sales-led; SOC reports | Don't take the "crypto accounting" category: we lose on breadth and trust. Frame as the narrow job they don't lead with: receipts → invoice → explained → approved entry |
| B. Invoicing / AR-AP | Request Finance (5) [VERIFIED by claims audit for AR + Xero/QBO/NetSuite sync]; Bitwave AR/AP (2) | Invoice-led, payment through their own rails/reference | **Closest overlap.** Our wedge is plain transfers without their reference; unproven [ASSUMPTION] |
| C. Gateways / infra | Stripe (13) [VERIFIED], CoinGate, NOWPayments (19), BitPay (11), Coinbase (12), Triple-A/HitPay (15, 18), Circle/Bridge/BVNK (14, 16, 17) | Checkout + conversion + their own reports | We sit **alongside** a gateway for receipts that skip it (`OBJECTIONS.md`); "almost none skip it" = not our fit |

## 2. Price anchors a buyer may compare us with
| Anchor | Price as reported | Label |
|---|---|---|
| Request Finance | from US$50/month, free tier | [ASSUMPTION: search, tracker C14] (possible change to US$70 unconfirmed) |
| Bitwave | not public; "from US$500/month" on a competitor page | [ASSUMPTION: secondary, tracker S3] |
| Integral | ~US$500/month per a competitor page | [ASSUMPTION: secondary, tracker S3] |
| Cryptoworth | from US$99/month in listings | [ASSUMPTION: secondary, tracker S3] |
| Cryptio | no price on its pricing page; "Get a quote" | **[VERIFIED]** cryptio.co/pricing, 2026-10-31 |
| Ledgible | Crypto tax from US$49; Enterprise Accounting custom ("expected usage will dictate monthly costs") | **[VERIFIED]** ledgible.io/pricing, 2026-10-31 |
| CoinGate | Standard 1% transaction fee, no monthly fee; Enterprise custom volume-based | **[VERIFIED]** coingate.com/pricing, 2026-10-31 |
| Clearline | US$300 / 30 days, then US$200/month | internal offer, untested (`CLAIMS_AUDIT.md` P0) |
Reading [ASSUMPTION]: US$200/month sits between self-serve invoicing tools (~US$50) and
sub-ledgers (~US$500+ or quote-only). That is a defensible "priced for a small finance team"
point, but no buyer has confirmed it.

## 3. Teardowns (real pages, opened 2026-10-31)

### T1. Cryptio pricing page — https://cryptio.co/pricing [VERIFIED, opened 2026-10-31]
What the page does:
- **No price at all.** "Customize your back-office", select a product (Reconciliation, Accounting,
  Audit), then "Get a quote" / "Request a demo" / "zero-pressure consultation where we will map out
  your flow of funds". FAQ: proof-of-concept offered "if you are looking for an enterprise plan".
- **Trust stack where a price table would be:** "SOC 1 and SOC 2 Type 1 and Type 2 audited by
  PwC"; "In partnership with Big 4 auditors and top accounting firms"; "Join 50+ world-class
  accounting, audit, tax, and advisory firms" (partner programme as a menu item); named testimonials
  (Uniswap Labs CFO, a Forvis Mazars partner, Gnosis financial controller); scale numbers ("5K+
  tokens tracked", "50M+ transactions processed annually").
- **Use-case menu of 15 segments** (banks, exchanges, treasury companies, payments, stablecoins,
  token issuers, public sector, miners, DeFi, gaming, accounting firms...).
Dunford reading: alternative = spreadsheets/legacy back office; category = "enterprise back-office"
for digital assets; target = institutions. Lessons for Clearline: (1) enterprise buyers expect a
trust stack before price; we have none, so **don't imitate the enterprise page**; publish the
price (our advantage at SMB). (2) The accounting-firm partner programme is part of their GTM
(supports our P1 partner hypothesis). (3) A 15-segment menu works at their scale; at 0 customers
we name one segment.

### T2. Stripe stablecoin payments docs — https://docs.stripe.com/payments/stablecoin-payments [VERIFIED, opened 2026-10-31]
(The older URL docs.stripe.com/crypto/stablecoins now redirects here.)
- Accepted tokens: **USDC (Tempo, Ethereum, Solana, Polygon, Base), USDP (Ethereum, Solana,
  US-only), USDG (Ethereum, US-only). No USDT.** Presentment currency USD (others in private
  preview). "Completed payments settle in your Stripe balance in your local currency." Customer
  limit **10,000 USD per transaction**. Refunds return as stablecoins to the original wallet.
  Customer is redirected to crypto.stripe.com to connect a wallet. (Business-location list did not
  render in the static page: not checked.)
Reading: Stripe positions stablecoins as *just another payment method* inside checkout, converted
to fiat; reconciliation is Stripe's normal balance reporting. Lessons: (1) a Stripe merchant has
no reconciliation gap for these payments, so they are **not our ICP**; (2) our gap is exactly
what Stripe excludes: USDT, > US$10k B2B transfers, payments that never touch a checkout.
Positioning line candidate (to test, not to publish): "for the stablecoin payments that don't go
through a checkout" [ASSUMPTION]. Note: the tracker row 13 (Tempo not listed) predates this page;
research-intern to refresh.

### T3. CoinGate pricing — https://coingate.com/pricing [VERIFIED, opened 2026-10-31]
- Two plans: **Standard** "for growing businesses and startups", "1% primary payment processing
  fee", "No monthly fees"; **Enterprise** "Custom rates tailored to your volume", "value-based",
  "Request consultation". Feature list includes "Instant fiat conversion (volatility shield)" and
  "Financial reconciliation and reporting ... no need to manage or account for crypto yourself".
Reading: gateways price **per transaction** and bundle reconciliation, so for gateway receipts we
add nothing (agrees with `OBJECTIONS.md`). Lesson for pricing: a % fee aligns with volume, but our
value is per *exception* and per *entry*, not per dollar moved; and we never touch funds, so a %
take-rate would look like custody. Keep flat pricing as the default hypothesis (`pricing.md` H2).

### T4 (short). Ledgible pricing — https://ledgible.io/pricing/ [VERIFIED, opened 2026-10-31]
Public self-serve tax price ("Starting at $49") next to "Custom Pricing" for Enterprise
Accounting; and **"Ledgible Crypto Tax Pro is free for Tax Professionals to use. Clients are
charged directly on a per client basis."** Lesson: a ready-made accountant-partner pricing model
(free seat for the firm, per-client charge) to test in the partner programme (`motions-and-partners.md`).

### T5 (short). TRES Finance homepage — https://tres.finance [VERIFIED, opened 2026-10-31]
Category claim: "a single source-of-truth for your digital asset financial data"; "220+ Web3
networks, exchanges, and banking sources"; "AI-powered tools ... complete financial compliance";
CTA "Schedule a Demo"; a blog post (29 Sep 2026) says TRES is "Now Available in Anthropic's
Official Claude Plugin Directory". Lesson: incumbents are moving into AI-assistant channels; our
"plain English explanation" attribute is not unique as AI, only as *payer-facing reply for a wrong
payment* [ASSUMPTION].

## 4. Positioning implications (hypotheses for the monthly review)
1. Category: avoid "crypto accounting"; test "stablecoin receivables for Xero" vs "stablecoin
   payment reconciliation" in subject lines/first calls (one variable at a time).
2. Alternatives to name on calls: the spreadsheet + explorer workflow, the gateway's report, a
   sub-ledger. Never disparage; ask the tracker's questions.
3. Trust: compete on transparency (published price, read-only, no custody, honest gaps), not on
   certifications we don't have.
