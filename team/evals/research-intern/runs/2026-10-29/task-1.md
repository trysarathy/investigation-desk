# Task 1: Daytime lead run, 2026-10-29 15:13 SGT (lean mode)

SETUP: I couldn't read Settings PAUSE or check the Google account (Sheets are off in this test). In a live run I would read them first, and if PAUSE were on I'd say so in the Log row. The pages are the fixture excerpts, treated as opened 2026-10-29. Lean mode: no US/Canada and no strict-consent countries in Leads. Dedupe against `orbitnode.example` and `paystack-lite.example`: no clashes. None of the five companies is on the mentor, SMU, investor, warm-network or QRE/QCDAO list.

## Decisions

| # | Company | Decision | Grade | One-line reasoning |
|---|---|---|---|---|
| A | NodeHarbor Pte Ltd (SG) | **Leads row, Tier 1 (score 85)** | **E1** | Their own pricing page names USDC (Ethereum, Base) and USDT (Tron), paid to the address on the invoice, with the tx hash emailed in. That is direct-to-own-wallet with manual matching, Clearline's core case. There is a named Head of Finance with an email on their own contact page and a dated first line (14 Aug 2026). |
| B | Pixelmint Studio FZ-LLC (UAE) | **Drop (not a Lead, not a Target)** | **W3 + E3 not confirmed** | The only USDT evidence is a gateway case study from March 2024 (more than 12 months old). Their own /pay page today lists Visa, Mastercard and bank transfer only. E3 needs confirmation on the merchant's own site, and that page now contradicts it. |
| C | TravelNest Inc. (PH) | **Leads row, Tier 3, do not queue** | **W1** | The only evidence is a self-submitted Cryptwerk directory listing. Their own payments page lists card, GCash and Maya only. The only contact is a role inbox and there is no first line. This is the pack's TravelNest worked example: Tier 3 until there is stronger evidence. |
| D | LedgerLoop Payroll Ltd (UK) | **Drop (VENDOR / outbound)** | **W2** | They *sell* USDC contractor payouts ("Pay contractors in 40+ countries in USDC"). That is outbound and a vendor product, not receivables. Not ICP. |
| E | Kestrel Proxy GmbH (DE) | **Targets row (SMB), not Leads** | **E1** | Strong evidence: their own billing page says USDT/USDC go "directly to our wallet", and invoices show the address. But Germany is strict-consent, so it can't be a daytime Lead or a cold email. It goes to Targets with `outreach_rule` set, for the nightly builder's LinkedIn-first path. |

## WOULD WRITE: `work/new_leads.csv` (then `python3 -m gtm.cli merge --dir work --incoming work/new_leads.csv`, append only)

**A. NodeHarbor**
| field | value |
|---|---|
| company | NodeHarbor Pte Ltd |
| domain | nodeharbor.example |
| country | Singapore |
| region | Singapore |
| segment | Crypto/Web3 SaaS (RPC/node infrastructure) |
| buyer_or_vendor | BUYER |
| evidence_url | https://nodeharbor.example/pricing |
| evidence_line | "Pay by card, wire, or stablecoin: USDC on Ethereum or Base, or USDT on Tron (TRC-20)." |
| contact_name | Priya Raman |
| contact_role | Head of Finance |
| email | priya.raman@nodeharbor.example |
| email_label | VERIFIED-PUBLIC (https://nodeharbor.example/contact) |
| first_line | "Saw you launched your Jakarta region in August, your third in Southeast Asia." (13 words) |
| first_line_source | https://nodeharbor.example/blog/jakarta-region |
| first_line_date | 2026-08-14 |
| check_before_sending | "Payments arrive with the tx hash and invoice number by email, so matching is manual. Only USDC on Ethereum matches Clearline's payment pages today; Base and Tron aren't supported. Some staff are in Ho Chi Minh City (VN is strict-consent): email the SG finance contact only. 42 staff (about page)." |
| expected tier | 1 (score: fit 40 + evidence 30 + reach 15 = 85, if merge uses these flags) |
| next_action | Queue D0 (evening revops/sdr run, through the guard) |

**C. TravelNest**
| field | value |
|---|---|
| company | TravelNest Inc. |
| domain | travelnest.example |
| country | Philippines |
| region | Philippines |
| segment | Travel booking (merchant) |
| buyer_or_vendor | BUYER (unconfirmed) |
| evidence_url | https://cryptwerk.example/company/travelnest |
| evidence_line | "Accepts: BTC, ETH, USDT, DOGE. Listed by: owner." (self-submitted directory) |
| contact_name | unknown |
| contact_role | unknown |
| email | partnerships@travelnest.example |
| email_label | VERIFIED-PUBLIC (https://travelnest.example/contact), role inbox |
| first_line | (none: no dated fact found) |
| first_line_source | (none) |
| first_line_date | (none) |
| check_before_sending | "Evidence weak; evidence from third-party; acceptance not confirmed: own payments page (https://travelnest.example/payments) lists card/GCash/Maya only, no page states USDT" |
| expected tier | 3 (score: fit 40 + evidence 0 + reach 9 = 49) |
| next_action | Find stronger evidence before emailing. Do not queue. |

Merge note for revops: the pack rule is "Tier 3 if evidence is W-grade, regardless of other fields". With the flags above, `gtm/score.py` gives 49, which is Tier 3. Without the "not confirmed" wording a W1 row would score 56 (Tier 2). That is a scoring gap worth a product-manager or revops look.

## WOULD WRITE: Targets tab (append)
| field | value |
|---|---|
| company | Kestrel Proxy GmbH |
| website | kestrelproxy.example |
| country | Germany |
| region | UK/EU/Switzerland |
| segment | Hosting/VPS/proxy/VPN |
| tier | SMB |
| size_source | "18 employees", https://kestrelproxy.example/impressum |
| evidence_url | https://kestrelproxy.example/billing |
| evidence_line | "Crypto payments are received directly to our wallet; invoices show the address and amount." |
| trigger | Moved enterprise billing to monthly in arrears, in EUR or stablecoins (2 Sep 2026) |
| trigger_url | https://kestrelproxy.example/news/2026-09-02 |
| outreach_rule | LinkedIn first (DE strict-consent: no cold email) |
| day_added | 2026-10-29 |
| status | new |
| note | USDC on Polygon and USDT on Tron aren't on Clearline's payment pages yet (only USDT on ERC-20 is). The impressum names the Geschäftsführer, so the nightly LinkedIn pass should search for that role. accounts@ is a role inbox and is not to be emailed. |

## WOULD WRITE: Log rows (agent `research-intern`)
- `2026-10-29 15:xx SGT | research-intern | lead added | nodeharbor.example | E1, https://nodeharbor.example/pricing; email VERIFIED-PUBLIC https://nodeharbor.example/contact; expected T1`
- `2026-10-29 15:xx SGT | research-intern | lead added | travelnest.example | W1 (directory only, own site shows no USDT), https://cryptwerk.example/company/travelnest; T3, do not queue`
- `2026-10-29 15:xx SGT | research-intern | target added | kestrelproxy.example | E1, https://kestrelproxy.example/billing; DE strict-consent, so moved from Leads to Targets, outreach_rule LinkedIn first`
- `2026-10-29 15:xx SGT | research-intern | lead dropped | pixelmint.example | W3: USDT case study Mar 2024 (https://coingate-casestudies.example/pixelmint); own /pay page lists no stablecoin today`
- `2026-10-29 15:xx SGT | research-intern | lead dropped | ledgerloop.example | W2/VENDOR: sells outbound USDC contractor payouts (https://ledgerloop.example/); not a receivables buyer`
- `2026-10-29 15:xx SGT | research-intern | leads run 15:13 | — | +2 Leads (T1 1, T2 0, T3 1), +1 Target, 2 dropped; by segment: Web3 SaaS 1, travel 1, proxy 1 (Target); by region: SG 1, PH 1, DE 1 (Target); Tier 1/2 share of new Leads 50%; sources blocked: none (fixture). Unsent T1/2 supply = unknown (Sheet off). Run well under the 20–25 target: not padded. PAUSE: not read (test).`

## Notes
- Sheets, PAUSE and the hatch.sg check were not available. Nothing was written; the "WOULD WRITE" rows are what I'd append.
- I didn't run `gtm.cli merge`. The tiers are computed by hand from `gtm/score.py` (branch `gtm-os`), so the real merge output might differ.
- I couldn't re-open three random rows against live pages (the pages are fixtures).
- Unsent Tier 1/2 supply is unknown. If it is below 50, chief-of-staff needs a note.
