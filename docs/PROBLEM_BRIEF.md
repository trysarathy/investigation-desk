# Problem brief: which pain should Clearline lead with?

gtm-strategist with research-intern, 2 Nov 2026 (SGT). **DRAFT for Aashmiin. Research only. 0 buyer interviews.**
Sources: the three memos in `docs/research/`, `team/research/buyer-pain.md`, `docs/INTERVIEWS/SCRIPT_CORE.md`,
`company/PRODUCT_FACTS.md`, `docs/POSTING_RULES.md` §9, Calls tab. Labels copied unchanged (rule 2); nothing new opened.

## 1. Why we're doing this

Two advisor calls so far, no buyers: Antoine Lebrun (fractional CFO, advisor, 30 Oct; his notes are not in the sources
used here) and Matt and Vishal (Protégé Ventures, advisors, 2 Nov). Their verdict, in Aashmiin's notes, was "not too sure
what you're building". Matt: "Accounting makes life easier, but does it really do anything that's not already out
there?"; pre-funding is the unsolved pain; "Founders build products and then try to fit into a market... it doesn't
really work." Vishal: "Why fix this in the books at the end of the period instead of the moment the payment comes in?";
finance vs ops/sales buyers; stablecoins are not cash in the books; FX for non-USD companies [advisor, 2 Nov 2026,
Aashmiin's notes]. This brief turns those four challenges into hypotheses H1-H4, scores them from desk research and picks
what to test first. **It is not demand evidence.** Every score below moves only when real buyers talk to us.

## 2. The four hypotheses

### H1 "Moment of payment": a trusted "paid, safe to release" signal for ops/sales
- **Who:** the person who says "ship it" (ops, sales, fulfilment) [ASSUMPTION]. Exporters and trading firms in SG, HK and
  UAE free zones paid in USDT by foreign buyers; OTC desks; hosting/VPS and B2B SaaS that grant access on payment
  [ASSUMPTION]. Sharpest where USDT lands **in the company's own wallet** with no gateway [ASSUMPTION, based on the
  competitor table]. Tron carries about 30% of stablecoin supply [VERIFIED: research-intern 2026-10-31,
  https://stablecoins.llama.fi/stablecoincharts/Tron]. (The memo also lists Indian service exporters; see the
  Regulation box: India is out.)
- **How often:** every payment received, far more often than month-end [ASSUMPTION]. No measured frequency.
- **Today:** explorer lookup by hand, a payer's screenshot, the gateway dashboard, an OTC desk on chat, or waiting for
  the bank credit [ASSUMPTION].
- **Cost:** [GUESS] 5-15 min per manual check; the real cost is a delayed shipment or goods released against a fake or
  short payment, up to the whole order value.
- **Who pays:** owner or COO; finance lead if the Xero entry is bundled [ASSUMPTION].
- **Why now:** B2B stablecoin payments about US$226bn a year at end-2025 [ASSUMPTION: secondary, McKinsey/Artemis via
  Reap, market.md]. Public fiat signal: Xero's "Alert when an invoice has been paid" idea has 205 votes since 2013, and on
  29 Sep 2026 Xero said it "isn't in our near term plans" [VERIFIED: research-intern 2026-11-02,
  https://productideas.xero.com/forums/967115-invoices-quotes/suggestions/44960575-notifications-alert-when-an-invoice-has-been-pai].
  Those posters are not Clearline customers.
- **What exists:** every gateway sends paid/underpaid for **its own** checkout: BVNK (docs.bvnk.com) [ASSUMPTION:
  search]; NOWPayments statuses [VERIFIED: research-intern 2026-11-02,
  https://nowpayments.io/help/dashboard/how-to-view-past-payments-and-purchases]; Circle CPN payins webhook, USDC only
  [VERIFIED: research-intern 2026-11-02, https://developers.circle.com/cpn.md]; Stripe, USDC, no USDT, SG not listed
  [VERIFIED: research-intern 2026-11-02, https://docs.stripe.com/payments/stablecoin-payments.md]; Triple-A (triple-a.io)
  [ASSUMPTION: search]. Closest: **CoinGate payment channels**, a permanent address per client with real-time webhooks
  [VERIFIED: research-intern 2026-11-02, https://coingate.com/payment-channels], 1% per transaction [VERIFIED:
  research-intern 2026-11-02, https://coingate.com/pricing]. Gap: nothing found that watches a company's *own* wallet and
  says "final, right token, right amount, safe to release", then the Xero entry [ASSUMPTION: no such product found in
  this search; absence is not proof].
- **Proves TRUE in 10 conversations:** ≥6 name a person who releases on payment; ≥5 receive into their own wallet; ≥4
  checked an explorer or screenshot in the last 30 days; ≥3 recall a delayed shipment or short/fake/wrong-network payment
  in the last 90 days; ≥3 say where the alert should land; ≥2 accept the pilot price.
- **Proves FALSE:** ≥6 already get the signal from a gateway or OTC desk; release waits for the bank credit anyway; or
  "we release on credit terms".

### H2 Stablecoin FX and lots for non-USD companies
- **Who:** finance lead or outsourced accountant (SG corporate-service/accounting firms) of an SGD-, INR- or
  EUR-functional SME paid in USDC/USDT **that holds balances past month-end**: agencies, dev shops, B2B SaaS selling to
  crypto firms [GUESS: no interviews yet]. Not USD-functional firms, not fiat-settled processor users.
- **How often:** every conversion, plus month-end and year-end audit.
- **Today:** a FIFO spreadsheet and manual journals [ASSUMPTION], or enterprise sub-ledgers.
- **Cost / who pays:** the company, via accountant hours or a subscription; amounts unknown [GUESS]. In the memo's
  illustrative example (rates made up), Xero leaves a 320.00 conversion loss inside the asset and overstates it 380.00 at
  month-end.
- **Why now:** FASB research project on payment digital assets as cash equivalents [VERIFIED:
  accounting-integrations-engineer 2026-11-02,
  https://www.ifrs.org/content/dam/ifrs/meetings/2025/october/fasb-iasb-education-meeting/ap38-cryptocurrencies.pdf];
  cryptoassets on the IASB's candidate list, not the work plan [VERIFIED: accounting-integrations-engineer 2026-11-02,
  https://www.ifrs.org/content/dam/ifrs/meetings/2025/december/iasb/ap8-work-plan-update.pdf]. No deadline.
- **What exists:** Cryptio, FIFO/WAC, manual journals to Xero [VERIFIED: accounting-integrations-engineer 2026-11-02,
  https://apps.xero.com/sg/app/cryptio], "Get a quote" [VERIFIED: accounting-integrations-engineer 2026-11-02,
  https://cryptio.co/pricing]; Bitwave [VERIFIED: accounting-integrations-engineer 2026-11-02,
  https://apps.xero.com/uk/app/bitwave]; TRES [VERIFIED: accounting-integrations-engineer 2026-11-02,
  https://apps.xero.com/us/app/tres-finance-web3-accounting]; Ledgible, enterprise custom [VERIFIED:
  accounting-integrations-engineer 2026-11-02, https://ledgible.io/pricing]; Integral (not checked).
- **TRUE:** ≥4 hold balances across a month-end in a non-USD functional currency **and** use Xero/QBO **and** spend ≥2
  h/month on lots/FX or had an audit adjustment, **and** ≥3 would pay ≥US$100/month.
- **FALSE:** most convert same day or settle to fiat, are USD-functional, or their auditor says "immaterial, ignore".

### H3 Pre-funding (research only, excluded from any build)
- **Who:** PSPs, remittance and payout firms, payroll/EOR, marketplace payouts; exporters/importers paying ahead
  [ASSUMPTION per memo].
- **How often:** continuous; cash sits idle per corridor.
- **Today:** pre-fund nostro/partner accounts, bank FX lines, netting, forecasting [ASSUMPTION].
- **Cost:** no reliable figure. Vendor numbers are not to be quoted until BIS CPMI/FSB reports are opened [ASSUMPTION:
  secondary, spark.money / eco.com / fin.com vendor glossaries].
- **Who pays:** licensed payout firms' treasury teams [ASSUMPTION].
- **Why now:** CPN Managed Payments launched 8 Apr 2026 [ASSUMPTION: secondary, circle.com search snippet (page not
  opened), sidley.com, pymnts.com].
- **What exists (all secondary):** Bridge (Stripe) [ASSUMPTION: secondary, stablecoininsider.org]; BVNK [ASSUMPTION:
  secondary, beinsure.com / eco.com]; Conduit [ASSUMPTION: secondary, eco.com]; Circle CPN; Ripple/RLUSD [ASSUMPTION:
  secondary, coingape.com]; Tazapay [ASSUMPTION: secondary, tazapay.com blog]. All hold or move money; the core product
  needs an MPI/DTSP licence in Singapore [ASSUMPTION: secondary, per memo].
- **TRUE:** a payout firm names a concrete pre-funding amount, time locked or cost. **FALSE:** not their problem, or
  already solved by their bank/PSP (SCRIPT_CORE). Only the read-only "did the settlement land and match" angle fits.

### H4 Current Clearline: match to invoice, explain, into Xero
- **Who:** finance leads, controllers, bookkeepers and outside accountants at firms paid in USDC/USDT into their own
  wallet; crypto/Web3 SaaS and agencies on Xero; accounting-firm partners [ASSUMPTION].
- **How often:** weekly to monthly, peaking at close [ASSUMPTION].
- **Today:** wallet export, spreadsheet matching, chasing short payers, manual journals; or a sub-ledger [VERIFIED:
  research-intern 2026-11-02, https://apps.xero.com/sg/app/cryptio].
- **Cost:** [GUESS] 15-30 min per exception plus close delay; deferrable, so real but not urgent [ASSUMPTION].
- **Who pays:** finance lead or founder [ASSUMPTION].
- **Why now:** FASB comments due 19 Nov 2026 [ASSUMPTION: secondary, Crowe, opened by claims audit 2026-10-29]; GENIUS
  effective 18 Jan 2027 [ASSUMPTION: search, regulation.md].
- **What exists:** Cryptio, "450+ enterprises" [VERIFIED: research-intern 2026-11-02, https://cryptio.co ,
  https://cryptio.co/pricing]; Bitwave [VERIFIED: research-intern 2026-11-02, https://apps.xero.com/us/app/bitwave]; TRES
  [VERIFIED: research-intern 2026-11-02, https://apps.xero.com/za/app/tres-finance-web3-accounting]; Request Finance
  [VERIFIED: claims audit 2026-10-29, help.request.finance accounting-integrations-overview]. Gap: plain-English
  explanations and SMB pricing [ASSUMPTION]. This is Matt's "already out there" point.
- **TRUE:** ≥6 receive ≥25 payments/month into their own wallet and use Xero/QBO; ≥4 show a short, wrong-token or
  unreferenced payment from the last 90 days; ≥4 spend >2 h at close on it; ≥2 accept US$300 for the pilot.
- **FALSE:** ≥5 use a sub-ledger happily; volume under 10/month; or "the accountant does it once a year".

## 3. Regulation box

> **India, in plain words:** on what we can see, an Indian exporter or freelancer may not take USDT/USDC straight into
> their own wallet as export proceeds; proceeds must arrive in fiat through an AD bank, and India taxes stablecoins as
> VDAs at 30% with 1% TDS. **Do not target Indian recipients of stablecoin payments.** A FEMA/CA lawyer must confirm
> [ASSUMPTION: secondary, per H3_REGULATION.md Part 3; no primary source could be opened].

- **Singapore:** USDT/USDC are not "MAS-regulated stablecoins" and are not banned [ASSUMPTION: secondary, Morgan Lewis 22
  Aug 2023, Allen & Gledhill, Bird & Bird]. Lawyer needed on PSA "facilitating" (incl. the pay page) and FSMA Part 9.
- **UAE mainland:** onshore merchants may accept only licensed dirham tokens [ASSUMPTION: secondary, CMS/Pinsent Masons
  via search]. Free zones only, pending counsel.
- **Decision for Aashmiin (H2 finding):** Xero lets only **bank** accounts hold a foreign currency [VERIFIED:
  accounting-integrations-engineer 2026-11-02, https://developer.xero.com/documentation/api/accounting/accounts] and
  revalues only AR, AP and bank [VERIFIED: accounting-integrations-engineer 2026-11-02,
  https://central.xero.com/s/article/Foreign-Currency-Gains-and-Losses-report]. So the approved non-bank "Stablecoin
  clearing" account (POSTING_RULES §9, **decision 1**) is SGD-only and **never revalued**; conversion gains/losses stay
  silently inside it. Fine while receipts are cleared quickly; wrong for anyone holding coins across month-end. Options:
  keep decision 1 and say so in the product (accountant classifies); add a manual-journal step for conversions; or
  revisit decision 1. Not decided here.

## 4. Score table

**Research-only; 0 buyer interviews.** Draft scores from the memos; changes in bold with one line each.

| | H1 Moment of payment | H2 FX & lots | H3 Pre-funding | H4 Current Clearline |
|---|---|---|---|---|
| Pain | 4 | 3 | 4 | 3 |
| Urgency | 4 | 2 | 3 | 2 |
| Willingness to pay | 3 | 2 | 3 | **2** |
| Reachability (solo, SG/India) | **2** | 3 | 2 | 3 |
| Regulatory risk (5 = low) | 3 | 4 | 2 | 4 |
| Fit with what's built | 3 | 2 | 3 | 4 |
| **Total (/30)** | **19** | **16** | **17** | **18** |

- H1 reachability 3→2: the India verdict removes Indian service exporters from the H1 pool, and ops buyers were already
  hard to find publicly.
- H4 willingness to pay 3→2: four funded sub-ledgers already push to Xero, and Matt's "already out there" challenge
  stands until a buyer tells us otherwise.
- H3 scores 17 but is **excluded from any build** (licence risk, crowded incumbents); research only.

## 5. Recommendation: one wedge

**"Safe to release" for SG/HK/UAE-free-zone sellers paid in USDT straight to their own wallet (Tron first): the moment a
payment is final, right token, right amount, ops gets a plain-English "ship it / don't"; then the Xero entry, once a
person approves.** It is the H1/H4 hybrid: H1's urgency on the front, H4's built engine behind it.

**For:** Vishal's question names this buyer; own-wallet USDT is the gap gateways leave (§2 H1, labels there); Xero's
205-vote idea shows the "tell me it's paid" need in fiat and Xero isn't building it (§2 H1);
the check engine (token contract, amount, address, confirmations) and hash checks on Tron, Ethereum and BNB Chain exist
[VERIFIED: build session 2026-10-31, docs/SPEC.md §3; src/lib/chain/tron.ts, evm.ts]; it answers Matt's point by not
starting as "accounting".

**Against:** 0 buyers; CoinGate payment channels already do most of it for anyone willing to receive via CoinGate;
gateways give the signal free; address watching is not built (a person pastes the hash) [ASSUMPTION: unverified pack
entry, competitors.md]; Slack push is "Not in version 1" [VERIFIED: research-intern 2026-11-02, docs/SPEC.md]; payment
requests are Ethereum-only [VERIFIED: build session 2026-10-31, src/lib/requests/check.ts:74]; ops buyers are hard to
reach; UAE mainland and India are out.

**What would change our mind (after the first 10 calls):**
- ≥6 of the H1 group already get "paid" from a gateway or OTC desk, or release only after the bank credit → drop H1,
  lead with H4.
- Fewer than 3 recall a held/wrong release in 90 days, or nobody names a person who checks → H1 is not urgent.
- ≥5 finance leads use a sub-ledger and are happy → H4 is not a wedge either; go back to Matt's question.
- ≥4 non-USD finance leads hold balances across month-end with ≥2 h/month of lot work → move H2 up and settle the
  decision-1 question first.
- No one gives a commitment (intro, data sample, dated follow-up): every hypothesis stays unproven.

**Top 2 for thin demo slices:** **H1** (paste a Tron USDT hash → "final, right token, right amount: safe to release",
using what exists) and **H4** (the same payment matched and the Xero entry prepared for approval). H3: research only.
Any new build (watching, push) needs Aashmiin's roadmap approval.

## 6. The 10 people to talk to next

No names; roles only. Aashmiin chooses and contacts; nothing is sent by us.

| # | Role | Company type | Country | Tests |
|---|---|---|---|---|
| 1 | Ops/fulfilment lead | Trading/export firm paid in USDT by foreign buyers | Singapore | H1 |
| 2 | Founder or COO | Trading firm receiving USDT on Tron to its own wallet | Hong Kong | H1 (+H4) |
| 3 | Ops manager | Free-zone trading company | UAE (free zone) | H1 |
| 4 | Billing/ops lead | Hosting/VPS or B2B SaaS that grants access on payment | Singapore | H1 |
| 5 | Desk operations | OTC desk | Singapore | H1 kill test (do they already confirm?) |
| 6 | Finance lead / controller | Web3 SaaS or agency on Xero, own-wallet receipts | Singapore | H4 (+H1) |
| 7 | Partner | Accounting/corporate-service firm with stablecoin-paid clients on Xero | Singapore | H4, H2 |
| 8 | Finance lead | SGD-functional agency/dev shop holding USDC across month-end | Singapore | H2 |
| 9 | Outsourced accountant | EUR-functional SME paid in USDC | EU | H2 |
| 10 | Treasury/ops lead | Licensed payout firm or PSP | Singapore | H3 (research only) |

Indian recipients are deliberately absent (Regulation box). Script per role: `docs/INTERVIEWS/SCRIPT_*.md`.

## 7. Stress test (crypto-finance-user)

SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

This is a simulation by an AI persona; it is NOT evidence of demand and must not be quoted as a customer.

Basis: Calls rows 2 (both advisors), 0 buyers (§1); public sources: only those already labelled in §2-3, none opened this run.
Every objection is `[GUESS: persona judgement]` unless it points to a labelled line above. **FC** = financial controller,
SGD-base SME. **Ops** = ops/sales lead, merchant/exporter releasing goods. **TR** = treasury lead, cross-border payments firm.

### H1 Moment of payment
| | Strongest objection | What I do today | I'd pay if | Ask a real buyer |
|---|---|---|---|---|
| FC | Release is ops' call; I care about the books. | Nothing until the rec. | It closes a release-control gap my auditor raised. | "Who released the last USDT-paid order, and what did they look at?" |
| Ops | Repeat buyers' screenshots are fine; new buyers prepay or go via an OTC desk that confirms on chat. | Screenshot, explorer, or ask the desk. | I've been burned (fake, short, wrong network) and it beats the screenshot for speed. | "Tell me about the last payment you released on that turned out wrong. What did it cost?" |
| TR | My custodian/PSP webhook already gives final status; I wouldn't route payment ops through a solo founder's tool (O6). | Webhooks into our own ops stack. | Probably never. | "What tells you a payin is final today, and when did that last fail?" |

### H2 FX and lots
| | Strongest objection | What I do today | I'd pay if | Ask a real buyer |
|---|---|---|---|---|
| FC | I convert the same day, so FX never matters; or my auditor calls it immaterial (§2 H2 FALSE). | OTC/exchange conversion; accountant posts a year-end journal. | I hold coins across month-end and got an audit adjustment. | "At last month-end, what stablecoin balance did you hold, and how was it translated?" |
| Ops | Not my problem. | Price in USDT, let finance worry. | Never. | "Have you ever lost margin between quoting in USDT and converting?" |
| TR | We're USD-functional; FX is a desk spread, handled in our treasury system. | Treasury system and hedges. | No. | "What is your functional currency, and who books the conversion difference?" |

### H3 Pre-funding
| | Strongest objection | What I do today | I'd pay if | Ask a real buyer |
|---|---|---|---|---|
| FC | We're not a payout firm. | n/a | n/a | "Do you pay anyone abroad before you are paid?" |
| Ops | I already pay suppliers in USDT; that *is* my pre-funding fix. | Pay supplier in USDT. | n/a | "What do you pay suppliers ahead of time, in what, and how long before you're paid?" |
| TR | Real pain, but the fix is liquidity and a licence; a read-only tool frees no buffer. BVNK/Circle/my bank are already pitching (§2 H3). | Per-corridor buffers, bank lines. | It cuts the buffer I hold, which read-only can't. | "Who confirms a partner's settlement landed and matched, and how long does it take?" |

### H4 Current Clearline
| | Strongest objection | What I do today | I'd pay if | Ask a real buyer |
|---|---|---|---|---|
| FC | Cryptio/Bitwave/TRES already push to Xero (§2 H4); at my volume the bookkeeper does it in an afternoon; approver names are typed, not signed in (O11). | Wallet CSV, spreadsheet, manual journal. | It shortens close, the auditor accepts its evidence, it does Tron (O12), cheaper than a sub-ledger. | "Walk me through last month-end for the wallet: what did you export, how long did it take, what did the auditor ask?" |
| Ops | Doesn't touch me: wrong buyer. | n/a | n/a | n/a |
| TR | Our volumes need APIs and a sub-ledger, not paste-a-hash. | Internal recon or a sub-ledger. | No. | "What reconciles your stablecoin flows today, and what breaks?" |

### The wedge: "Safe to release", own-wallet Tron USDT
- **Ops: the screenshot is faster.** I trust known buyers' screenshots; new ones prepay and I wait. Pasting a hash is
  slower than my wallet app, and watching and push aren't built (§5 Against).
- **Ops/TR: my gateway or OTC desk already tells me.** CoinGate payment channels do this for 1% (§2 H1), and an OTC desk
  confirms on chat for free.
- **FC: I'd never let a tool near my wallet.** "Read-only, no keys" must be the first sentence, and my address in a solo
  founder's database is still a question (O1, O6).
- **FC: Tron USDT straight to our own wallet is a grey area.** My bank asks about crypto receipts and the source of funds. And
  "safe" says nothing about who sent it or freeze/sanctions exposure: a promise you can't keep.
- **FC: I convert instantly, so the Xero half is one entry a month.** Not worth a subscription.
- **What I'd do instead:** screenshot plus explorer plus the desk chat; for anything big, wait for the fiat credit.
- **What would make me pay:** an alert in the chat ops already uses, with no pasting, that has caught a fake-token,
  wrong-network or short payment *before* release, priced below one bad release (their number, not ours).
- **One question per persona:** Ops: "The last time you released goods against USDT, what did you check and how long
  did it take?" FC: "Has your bank or auditor ever asked about USDT received into the company wallet?" TR: "When a
  client's USDT lands on Tron, who confirms it and how?"

### Most likely to be wrong about
1. That enough own-wallet USDT receivers with no gateway or OTC desk exist, and can be reached, in SG/HK/UAE free zones. The wedge rests on this `[ASSUMPTION]`.
2. That ops feels screenshot risk as urgent. With repeat buyers, prepayment or credit terms, many may never have been burned.
3. That paste-a-hash is a product. Without watching and push (not built), it is slower than the habit it replaces.
4. That the person who feels it (ops) pays. Finance holds the budget and may see the Xero half as one entry.
5. That "safe to release" is a claim we can make. It doesn't screen the sender or freeze risk, and own-wallet Tron USDT may be a grey area buyers won't document.
