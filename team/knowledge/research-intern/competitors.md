# Competitor tracker

Last refreshed 2026-10-29; primary-source re-check 2026-10-31 · owner: research-intern · refresh: weekly delta (Sunday brief), full
re-check monthly. Labels as in `research-method.md`; source IDs `[C#]` at the bottom.

## How to read this
- **Clearline today** (the yardstick; product claims from `whitepaper/CLAIMS_AUDIT.md` on branch
  `whitepaper`): per-invoice payment pages for USDC/USDT on Ethereum; on-chain verification
  (amount, token contract, network, freeze checks), matching to the invoice, plain-English
  explanation of wrong payments; posting to Xero **only after a person approves** (Xero built and
  in testing, QuickBooks next, NetSuite designed); read-only, never holds funds. In live mode a
  person pastes the hash (no address watching yet). Pilot US$300/30 days, then US$200/month.
  0 customers. Never claim more than this in a comparison.
- **Categories**: (A) crypto sub-ledgers / accounting; (B) AR/AP and invoicing tools;
  (C) payment gateways and stablecoin infrastructure that include some reconciliation.
- "Where Clearline differs" is our hypothesis for sales conversations, not a proven win
  [ASSUMPTION throughout]. Use it to ask good questions, never to disparage.

## Positioning in one paragraph [ASSUMPTION]
Sub-ledgers (A) are built for crypto-native finance teams with many wallets, tokens and DeFi
positions; they are sales-led and priced for mid-market and enterprise. Gateways (C) reconcile
their *own* checkout flows and usually convert to fiat. Clearline's gap: an SMB or mid-market
business paid in USDC/USDT **directly to its own wallet**, often without a reference, that needs
each payment tied to an invoice, wrong ones explained, and an approved entry in Xero/QuickBooks,
at a price below a sub-ledger contract. Closest overlap: Request Finance (invoice-led).

## Tracker

| # | Company | Cat. | What they do | Who they sell to | Pricing (public?) | Where Clearline differs [ASSUMPTION] | Latest (dated) | Src |
|---|---|---|---|---|---|---|---|---|
| 1 | **Cryptio** | A | Crypto sub-ledger and "ERP for digital assets": ingestion across 150+ blockchains/exchanges/custodians, reconciliation, ERP sync (NetSuite, QuickBooks, Xero, SAP, Dynamics 365, Sage, Workday), token-supply (mint/burn) tracking; SOC 1 and SOC 2 Type 1/Type 2 audited by PwC [VERIFIED: https://cryptio.co , https://cryptio.co/integrations , https://cryptio.co/pricing , 2026-10-31]; "50+ auto-categorised tx types" not seen [ASSUMPTION: search] | Exchanges, custodians, issuers, funds; "trusted by 400+ leading digital asset institutions", logos incl. Circle, Gemini, Securitize [VERIFIED: https://cryptio.co , 2026-10-31]; "30+ countries" not seen [ASSUMPTION: search] | Not public: "Get a quote" / consultation [VERIFIED: https://cryptio.co/pricing , 2026-10-31]; 1-year terms [ASSUMPTION: search] | Built for whole-company crypto books; Clearline is invoice-first receipts with exception explanations for non-crypto-native finance teams | US$45m Series B, 12 Mar 2026 (BlackFin, Sentinel Global) for loan and treasury apps [ASSUMPTION: search] (31 Oct: blog.cryptio.co and theblock.co blocked) | C1 C2 C3 C4 |
| 2 | **Bitwave** | A+B | Enterprise crypto accounting, payments and reporting; stablecoin B2B AR/AP: approved invoice → on-chain payment via custodian → posts back to ERP (NetSuite, QuickBooks, Sage; Xero listed); vendor wallet verification; SOC 1/SOC 2 Type 2; USDC, PYUSD, USDT, RLUSD; partner BVNK for USD payouts [ASSUMPTION: search, P2 claims] | Enterprises, crypto finance teams; says Coinbase uses it [ASSUMPTION: search] | Not public (contact sales); a competitor page says "from US$500/month" [ASSUMPTION: search, S3] | Bitwave leads with AP and enterprise ERPs; Clearline is AR exceptions for SMB/mid-market on Xero/QuickBooks | RLUSD B2B invoice payment to Ripple (blog, date not captured) [ASSUMPTION: search] | C5 C6 C7 |
| 3 | **Ledgible** | A | Crypto tax and accounting; enterprise accounting with GL integrations (e.g. QuickBooks Online) [VERIFIED: https://ledgible.io/pricing/ , 2026-10-31] | Enterprises, tax professionals/CPAs | Enterprise Accounting custom ("expected usage will dictate monthly costs"); Professional Tax "starting at $49"; Tax Pro free for tax professionals, clients charged per client [VERIFIED: https://ledgible.io/pricing/ , 2026-10-31] | Tax/accounting depth; no invoice matching or payer-facing exception explanations seen | No 2026 news found | C8 |
| 4 | **TaxBit** | A (tax) | Enterprise tax information reporting: 1099-DA, CARF/DAC8 XML filing, cost-basis engine; some crypto accounting [ASSUMPTION: search] | Exchanges, brokers, platforms with reporting duties | Not public | Different job (regulatory tax reporting). Not a direct competitor; a possible partner reference | CARF/DAC8 first reporting season 2026 [ASSUMPTION: search] | C9 C10 |
| 5 | **Request Finance** | B | Invoicing, AR and AP: fiat-denominated invoices paid in crypto or fiat to the supplier's wallet, reconciliation, accounting export [VERIFIED] (claims audit C7); syncs QuickBooks Online, Xero, NetSuite [VERIFIED] (claims audit C8); built on Request Network's `paymentReference` contracts [VERIFIED] (C9) | Web3 companies, DAOs, freelancers/contractors | Public: from US$50/month, free tier; crypto-to-fiat fees ~1% plus US$10 local / US$30 SWIFT [ASSUMPTION: search, P2] | **Closest overlap.** Request matches payments made *through its own rails/reference*; Clearline is aimed at plain transfers to the company's own address (no reference), explains wrong payments, and posts only after approval [ASSUMPTION] | — | C11 C12 C13 C14 |
| 6 | **Coinshift** | (was B) | Was Safe-based treasury ops (mass payouts, multisig, reporting); that product reportedly sunset 31 Mar 2026; now yield products (csUSDL, launched Nov 2024; USPC/iUSPC) [ASSUMPTION: search, weak]. 31 Oct: coinshift.xyz now presents only "iUSPC by Coinshift" (institutional credit yield, FINMA-licensed management) [VERIFIED: https://coinshift.xyz , 2026-10-31]; the sunset date itself not found on an official page | DAOs, crypto treasuries | n/a | No longer an ops competitor if sunset is confirmed; check its former users as leads | csUSDL >US$100m TVL (May 2025 PR) [ASSUMPTION: search] | C15 C16 |
| 7 | **Integral** (integral.xyz) | A | Crypto accounting and treasury for Web3 startups, DAOs, funds: bookkeeping automation, gains/losses, ERP links [ASSUMPTION: search, S3] | Web3 companies, funds; accountants | Not public [ASSUMPTION: search]; competitor page says ~US$500/month [S3] | Crypto-native bookkeeping; Clearline is receipts-to-invoice exceptions | No 2026 news found | C17 C7 |
| 8 | **TRES Finance** | A | Sub-ledger/"FinOS": multi-source reconciliation (amounts, fiat value, counts, cost basis, balances), ERC-4626 pricing, SOC 1/2 Type 2, ERP sync [VERIFIED for ERP sync] (claims audit C10); rest [ASSUMPTION: search] | Enterprises, funds, crypto companies | Not public [ASSUMPTION: search] | Enterprise sub-ledger; Clearline smaller and invoice-led | — | C18 C7 |
| 9 | **Cryptoworth** | A | Crypto accounting: reconciliation, cost basis/tax, QuickBooks Online integration [ASSUMPTION: search, S3] | SMBs, accountants | Listings say from US$99/month (one says 259, currency unclear) [ASSUMPTION: search, S3] | Cheapest sub-ledger; still a ledger, not invoice matching with payer-facing explanations | — | C19 C20 |
| 10 | **Lukka** | A/data | Institutional digital-asset data: ingest, normalise, price, reconcile across "100+ blockchains, trading venues, and custodians"; SOC 1 Type I & II and SOC 2 Type I & II, ISO/IEC 27001 [VERIFIED: https://lukka.tech , https://lukka.tech/institutional-grade-digital-asset-accounting-reporting/ , 2026-10-31]; acquired Blox's accounting software [ASSUMPTION: search] (not found on lukka.tech; site search for "blox" returns nothing; the accounting page cites an Aerial Partners acquisition instead). TRES claims Lukka pivoted to data only (competitor claim, unconfirmed) | Institutions, funds, auditors | Not public | Data infrastructure for institutions; not our buyer | Aug 2026 company PDF [ASSUMPTION: search] | C21 C22 |
| 11 | **BitPay** | C | Crypto payment processing; QuickBooks integration on Business/Enterprise plans [ASSUMPTION: search, P2 support article, older]; stablecoin settlement since 2018 (USDC, GUSD) [ASSUMPTION: search] | Merchants, e-commerce | Fees conflict: 1%, or tiered 2%+$0.25 → 1%+$0.25 [ASSUMPTION: search, S3] | Reconciles only payments through BitPay invoices; Clearline covers direct-to-wallet payments | — | C23 C24 |
| 12 | **Coinbase Commerce / Coinbase Payments** | C | Payments stack for USDC on Base; Shopify integration (announced Jun 2025, with Stripe) — USDC checkout in 34 countries, default settlement to local currency [ASSUMPTION: search] | Merchants, platforms | No official 2026 fee found | Checkout-led, converts to fiat by default; reconciliation lives inside Coinbase/Shopify | Shopify USDC on Base [ASSUMPTION: search] | C25 C26 |
| 13 | **Stripe stablecoin payments** | C | Accept USDC, USDP, USDG (**no USDT**); US$10,000 per transaction; settles to the Stripe balance in local currency; US plus private preview in EU, HK, MX, CH; **SG not listed** [VERIFIED] (claims audit C1, docs.stripe.com). Fee 1.5% widely reported [ASSUMPTION: search] (docs.stripe.com opened 31 Oct: no fee stated; stripe.com/pricing blocked). 31 Oct docs re-check: USDC on Tempo, Ethereum, Solana, Polygon, Base; USDP and USDG US-only; business list = US plus private preview EU/HK/MX/CH; SG still not listed [VERIFIED: https://docs.stripe.com/crypto/stablecoins , 2026-10-31] | Stripe merchants | 1.5% reported | Stripe reconciles Stripe payments only; no USDT; Clearline covers wallet receipts and USDT | Owns Bridge since 4 Feb 2025 [VERIFIED] (claims audit C2) | C27 C28 C29 |
| 14 | **Circle** (CPN, Mint) | C (infra) | Issuer of USDC/EURC; **CPN Managed Payments**: Circle takes on licensing, custody, compliance, minting and settlement so partners "stay in fiat at the edge"; payment platforms and banks can offer it under their brand. CPN gives "financial institutions and enterprises" a single integration [VERIFIED: https://developers.circle.com/cpn.md , https://developers.circle.com/cpn/managed-payments.md , 2026-10-31]. *Corrected 2026-10-31: was "CPN is for financial institutions".* Launch date 8 Apr 2026 [ASSUMPTION: search, P2] (circle.com pressroom blocked) | PSPs, fintechs, banks, enterprises | Negotiated; no public schedule [ASSUMPTION: search] | Infrastructure for FIs, not a finance-team tool. Its PSP members' *merchants* can be Clearline leads | CPN Managed Payments, 8 Apr 2026 | C30 C31 |
| 15 | **Triple-A** | C | MAS-licensed (MPI) crypto/stablecoin gateway; USDC/USDT acceptance, locked rate, fiat settlement; powers HitPay's stablecoin acceptance for 20,000+ SG merchants (fiat settlement) [VERIFIED for HitPay setup] (claims audit C3); licence history [ASSUMPTION: search] | Merchants, PSPs, platforms | Not public | Converts to fiat, so its merchants rarely need us; its *non-converting* merchants and the wrong-payment cases are the gap | — | C32 C33 C34 |
| 16 | **Bridge** (Stripe) | C (infra) | Stablecoin orchestration/issuance APIs; conditional OCC national trust bank approval Feb 2026 [ASSUMPTION: search] | Fintechs, platforms | Not public | API infrastructure, not a reconciliation tool | OCC conditional approval Feb 2026 | C35 |
| 17 | **BVNK** | C (infra) | Stablecoin payments infrastructure (USDT, USDC), 130+ countries, ~US$30bn annualised; **Mastercard agreed to acquire for up to US$1.8bn (17 Mar 2026)**, closing expected by end-2026 [ASSUMPTION: search] | Payment companies, merchants | Not public | Infrastructure; its merchants and provider reports are a reconciliation input (SPEC uses BVNK docs as the first reference format) | Deal close pending | C36 |
| 18 | **HitPay** (SG) | C | SG payments platform; USDT/USDC/PYUSD acceptance via Triple-A, merchants receive fiat, HitPay holds no stablecoins [VERIFIED] (claims audit C3) | SG SMEs | Not captured | Fiat settlement means low need; partner angle only | — | C34 |
| 19 | **NOWPayments / CoinGate** | C | Self-serve crypto gateways; USDT/USDC on several chains, plugins (WooCommerce, Shopify, WHMCS) [ASSUMPTION: search]; fees: NOWPayments "1% service fee"; CoinGate Standard "1% per transaction", no monthly fee, Enterprise custom volume-based [VERIFIED: https://nowpayments.io/pricing , https://coingate.com/pricing , 2026-10-31]. *Corrected 2026-10-31: was "fees ~0.5–1%" (S3).* | Online merchants, hosting/VPN, iGaming-adjacent | 1% list (CoinGate Enterprise custom) | Their merchants often receive crypto (not converted) → good lead source; confirm each merchant on its own site | — | C37 |

## Watch list (check monthly; not yet profiled)
Cryptio-style sub-ledgers: CoinTracker Enterprise, Tactica, CryptaCount. Gateways: Alchemy Pay,
CoinsPaid, OpenNode, Speed, Crossmint. SG/HK: dtcpay (US$15m Series A extension, Series A now US$25m; NAUT dates it 18 Sep 2026, not
28 Oct) [ASSUMPTION: secondary, NAUT tracker opened 2026-10-31] [C38]), FOMO Pay, StraitsX.
Treasury/banking: Jeeves (Series C US$110m, 29 Sep), Noah (seed extension US$16m, 7 Oct), HIFI
(Series A US$37m, 24 Sep) [ASSUMPTION: secondary, NAUT tracker opened 2026-10-31; company releases
not opened, their sites blocked] [C38].

## Questions to ask a prospect who uses one of these [ASSUMPTION]
- Sub-ledger user: "How do you tie a USDT receipt to the right invoice when the payer didn't add a
  reference, and who writes the email when it arrived short?"
- Gateway user: "What share of your stablecoin receipts arrive outside the gateway, straight to a
  wallet?"
- Request Finance user: "What happens when a customer pays the invoice from an exchange instead of
  through the Request link?"

## Sources (all accessed 2026-10-29)
| ID | URL | Tier | How |
|---|---|---|---|
| C1 | https://blog.cryptio.co/crypto-reconciliation-controls-ensure-accurate-general-ledger-entries | P2 | Search |
| C2 | https://cryptio.co/pricing | P2 | Search |
| C3 | https://www.theblock.co/post/393007/cryptio-secures-45-million-series-b-to-scale-financial-infrastructure-for-digital-assets | S1 | Search |
| C4 | https://blog.cryptio.co/cryptio-the-obvious-choice-for-netsuite-users | P2 | Opened by claims audit (C10) |
| C5 | https://www.bitwave.io/solutions/stablecoin-b2b-payments-enterprise-ar-ap | P2 | Search |
| C6 | https://www.bitwave.io/blog/bitwave-rlusd-b2p-payments-integration | P2 | Search |
| C7 | https://tres.finance/tres-finance-vs-lukka-enterprise-a-2025-feature-breakdown/ | S3 (competitor) | Search |
| C8 | https://ledgible.io/pricing/ | P2 | Search |
| C9 | https://www.crowdfundinsider.com/2025/03/237950-taxbit-enables-compliance-across-eus-dac8-directive-and-oecds-crypto-asset-reporting-framework-carf/ | S1 | Search |
| C10 | https://accountingtoday.com/news/taxbit-now-supports-form-1099-da-for-digital-assets | S1 | Search |
| C11 | https://www.request.finance/accounts-receivable | P2 | Opened by claims audit |
| C12 | https://help.request.finance/en/articles/13038304-accounting-integrations-overview | P2 | Opened by claims audit |
| C13 | https://docs.request.network/advanced/protocol-overview/how-payment-networks-work | P2 | Opened by claims audit |
| C14 | https://help.request.finance/en/articles/8622152-what-are-the-fees-for-crypto-to-fiat-payments | P2 | Search |
| C15 | https://thedefiant.io/news/press-releases/coinshift-launches-csusdl-announces-strategic-partnerships | P2 (PR) | Search |
| C16 | https://yespress.io/coinshift | S3 | Search |
| C17 | https://sourceforge.net/software/product/Integral-Crypto/ | S3 | Search |
| C18 | https://tres.finance/lpp/crypto-accounting | P2 | Opened by claims audit (C10) |
| C19 | https://www.capterra.com/p/10012945/Cryptoworth/ | S3 | Search |
| C20 | https://g2.com/products/cryptoworth/pricing | S3 | Search |
| C21 | https://lukka.tech/institutional-grade-digital-asset-accounting-reporting/ | P2 | Search |
| C22 | https://www.crowdfundinsider.com/?p=181940 | S1 | Search |
| C23 | https://support.bitpay.com/hc/en-us/articles/201895853 | P2 | Search |
| C24 | https://eco.com/support/en/articles/14895614-stablecoin-payment-processor-fees-compared-2026 | S3 | Search |
| C25 | https://www.theblock.co/post/357967/shopify-coinbase-stripe-usdc | S1 | Search |
| C26 | https://www.paymentsjournal.com/coinbase-launches-stablecoin-platform-for-e-commerce/ | S1 | Search |
| C27 | https://docs.stripe.com/crypto/stablecoins | P2 | Opened by claims audit |
| C28 | https://stripe.com/us/newsroom/news/stripe-completes-bridge-acquisition | P2 | Opened by claims audit |
| C29 | https://www.theblock.co/post/320404/stripe-crypto-payments | S1 | Search |
| C30 | https://circle.com/pressroom/circle-launches-cpn-managed-payments-a-full-stack-platform-for-seamless-stablecoin-settlement | P2 | Search |
| C31 | https://www.circle.com/pt-br/blog/core-services-of-circle-payments-network-a-new-foundation-for-compliant-stablecoin-payments | P2 | Search |
| C32 | https://www.triple-a.io/newsroom/triplea-the-first-digital-currency-payment-company-to-be-licenced-by-mas | P2 | Search |
| C33 | https://thepaypers.com/payments/company-information/triplea | S1 | Search |
| C34 | https://hitpayapp.com/crypto-payment-gateway-hitpay | P2 | Opened by claims audit |
| C35 | https://www.americanbanker.com/payments/news/stripe-owned-bridge-acquires-trust-charter-for-stablecoins | S1 | Search |
| C36 | https://thepaypers.com/mergers-aquisitions-and-investments/news/mastercard-to-acquire-bvnk-for-up-to-usd-18-billion | S1 | Search |
| C37 | https://nowpayments.io/blog/usdt-for-merchant | P2 | Search |
| C38 | https://naut.so/articles/stablecoin-payments-funding-sep-oct-2026 | S3 | Search |

**First refresh to-do:** open every P2 pricing page (C2, C8, C14, Bitwave, Integral, TRES,
Cryptoworth, BitPay) and replace S3 pricing with the vendor's own page or "not public".
