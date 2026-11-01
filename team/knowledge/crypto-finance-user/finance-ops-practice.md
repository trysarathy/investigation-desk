# Finance-ops practice: month-end close, crypto reconciliation, Xero / QuickBooks / NetSuite

Accessed 2026-10-31. Official help centres for Xero (central.xero.com), Intuit (quickbooks.intuit.com)
and Oracle NetSuite (docs.oracle.com) were **blocked** from this environment, so their content is
`[ASSUMPTION: secondary, search]` (search results describing the official page). Do not quote menu
names to a customer from this file until research-intern opens the pages.

## 1. Month-end close for a business that receives stablecoins
A generic close, adapted for wallets (synthesis, `[GUESS: persona judgement]`, steps cross-checked
against the vendor checklists in §2):

1. **Cut-off.** Decide which receipts belong to the month. On-chain timestamps are UTC block times; the
   books are in local time (SGT). A transfer at 2026-11-01 01:10 SGT is 2026-10-31 17:10 UTC. The
   company needs one written rule and the tool must show which it used. `[GUESS: persona judgement]`
2. **Completeness.** Every wallet and every exchange/gateway account the company uses is in scope.
   Data from each is imported for the full period.
3. **Match receipts to invoices.** Exact matches cleared; exceptions (short, over, duplicate, no
   reference, wrong network, counterfeit) each have an owner and a decision.
4. **Post.** Receipts posted to the ledger with the right account, date, amount, and a reference an
   auditor can trace (tx hash, network, token contract).
5. **Reconcile balances.** Ledger balance of each wallet account ties to the on-chain balance at the
   cut-off time; differences explained (in transit, fees, unposted items).
6. **Valuation.** Stablecoins are often carried at par in practice, but the policy must be written and
   a depeg tolerance chosen; Clearline values at par and blocks automatic posting > 0.5% off par
   [INTERNAL: docs/ACCOUNTING_SYNC.md].
7. **Review and sign-off.** Reviewer checks the reconciliations and exception decisions; the close
   package (reconciliations, exception list, evidence) is filed for the auditor.

## 2. What published crypto close checklists say
- **Cryptio (enterprise help centre):** the month-end close is "the most common and frequent accounting
  process our clients will undergo"; numbered steps include generating an end-of-month reconciliation
  report used as the basis for the trial balance comparison
  ([support.cryptio.co](https://support.cryptio.co/hc/en-gb/articles/20202941864721-Month-end-checklist-Enterprise)).
  A second Cryptio best-practice checklist begins with data completeness ("verify that all sources have
  been imported") and its reconciliation report consolidates ledger entries, asset roll-forward, trial
  balance and transaction history, stored "as part of the close package for audit readiness"
  ([cryptio.support.site](https://cryptio.support.site/article/month-end-close-best-practice)).
  `[ASSUMPTION: secondary, search — support.cryptio.co blocked]` Teardown in `teardowns.md`.
- **Cryptoworth:** a crypto-adapted close checklist organised by phase, including wallet reconciliation
  and on-chain/off-chain matching ([cryptoworth.com](https://www.cryptoworth.com/blog/month-end-close-checklist)).
  `[ASSUMPTION: secondary, search — host blocked]`
- **KoinX:** six steps starting with consolidating wallet and exchange data and using one consistent
  pricing source for the close date ([koinx.com](https://www.koinx.com/blog/how-to-reconcile-crypto-transactions)).
  `[ASSUMPTION: secondary, search — host blocked]`
- **TRES Finance case study (Tezos Foundation):** the team uses TRES "across their full month-end close
  process", including monthly reconciliations, wallet balance validation and audit support
  ([tres.finance](https://tres.finance/how-tezos-foundation-streamlined-digital-asset-accounting-with-tres/)).
  `[ASSUMPTION: secondary, search — page blocked by Cloudflare when fetched; vendor case study]`

What a controller takes from these: the close package and the **roll-forward** (opening balance +
receipts − disbursements ± adjustments = closing balance, per wallet, per token) are what the auditor
reviews. A tool that only explains single payments, without the period view, solves step 3 and leaves
steps 5–7 manual. `[GUESS: persona judgement]`

## 3. Tolerances and short payments (how mature payment tools handle it)
- **Stripe** (bank transfers, not stablecoins): with automatic reconciliation, "within a certain margin of
  error, Stripe auto-reconciles invoices and credits the difference"; overpayments mark the invoice
  paid and leave the remainder for manual application; with several open invoices it applies funds
  to the oldest ([docs.stripe.com/invoicing/reconciliation](https://docs.stripe.com/invoicing/reconciliation)).
  The page is marked **Deprecated**. `[VERIFIED]`
- **NOWPayments** (crypto gateway): recommends merchants set "Repeated Payments" and "Wrong-asset
  deposits" to "Partially Paid" so they are held for review; "Finished: Be very careful with this
  setting. If selected, it automatically marks every deposit as 'Finished,' even if the amount is
  wrong." ([nowpayments.io](https://nowpayments.io/blog/best-integration-practices-at-nowpayments)) `[VERIFIED]`
- **Clearline today:** short with no decision → partial payment plus a note, invoice open for the
  shortfall; short accepted → payment plus a separate fee write-off line; wrong network, counterfeit,
  failed → never posted [INTERNAL: docs/ACCOUNTING_SYNC.md]. There is **no tolerance setting** yet
  (every short payment needs a person) — a likely controller ask. `[GUESS: persona judgement]`

## 4. The ERP reconciliation workflows a controller already knows
| System | Workflow (as described) | Source | Label |
|---|---|---|---|
| Xero | Bank statement lines are reconciled against Xero transactions: accept a suggested match, "Find & Match" (search invoices/bills, split for partial payments), create via bank rules, or cash-code in bulk. A Xero product-ideas post says two statement lines can't be matched to each other. | [productideas.xero.com](https://productideas.xero.com/forums/967136-banking-chart-of-accounts/suggestions/46690366-find-and-match-reconcile-two-statement-lines-to); third-party tutorials (e.g. [trykeep.com](https://trykeep.com/newsroom/how-to-reconcile-in-xero-a-detailed-tutorial)) | [ASSUMPTION: secondary, search — no official Xero Central page returned; xero.com blocked] |
| QuickBooks Online | Reconcile an account: enter statement ending balance and date, check the beginning balance, tick cleared transactions until the difference is zero; a beginning-balance mismatch opens the Reconciliation Discrepancy Report. | [Intuit help (US)](https://quickbooks.intuit.com/learn-support/en-us/banking-topics/how-to-reconcile-accounts/00/186470) | [ASSUMPTION: secondary, search — host blocked] |
| NetSuite | Transactions > Bank > **Match Bank Data** (imported bank lines and NetSuite transactions side by side; Intelligent Transaction Matching rules), then **Reconcile Account Statement**; the account needs "Use Match Bank Data and Reconcile Account Statement Pages" checked (automatic for new accounts since 2021.1). | [Oracle NetSuite help](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4842302228.html), [account setting](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_162636875948.html) | [ASSUMPTION: secondary, search — host blocked] |

**Why it matters for testing:** a wallet is reconciled like a bank account only if there is a
"statement" (the on-chain transfer list for the wallet, for the period) to reconcile against. When
Clearline posts into a Xero bank account that represents the wallet, the controller will expect a
statement-like feed for that account, or Xero's reconcile screen will show the postings as unreconciled.
`[GUESS: persona judgement — test it on the Xero Demo Company before claiming either way]`

## 5. Clearline's posting rules a controller will check (internal)
From [INTERNAL: docs/ACCOUNTING_SYNC.md]: exact → one payment with tx hash, token, network, USD value
and rate source in the reference; duplicate → one payment + one overpayment marked for refund, never
two payments; same transfer delivered twice → nothing new; non-USD invoice → blocked; > 0.5% off par →
blocked; payment lines rounded **down** to cents. Account codes are set in a JSON file, **no settings
screen** yet; fee account default "404 Bank Fees" in the Xero Demo Company.

## First refresh to-do (research-intern)
Open: Xero Central articles on reconciling bank statement lines, Find & Match, bank rules; Intuit
"Reconcile an account in QuickBooks Online"; the two Oracle NetSuite pages above; support.cryptio.co
month-end checklist. Hosts: central.xero.com, quickbooks.intuit.com, docs.oracle.com, support.cryptio.co.
