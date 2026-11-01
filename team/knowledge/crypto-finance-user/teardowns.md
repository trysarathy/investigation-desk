# Teardowns: how real companies handle the controller's problem

Four teardowns, each labelled. Two are from pages opened this run (`[VERIFIED]` as what the company
publishes); two are search-level. Accessed 2026-10-31. Each ends with what it teaches the simulated
controller and the questions it gives a mock buyer.

---

## Teardown 1 — NOWPayments: exception handling as a gateway designs it  `[VERIFIED]`
Pages: [Best Integration Practices](https://nowpayments.io/blog/best-integration-practices-at-nowpayments)
(updated 14 Sep 2026), [Refund policy](https://nowpayments.io/help/payments/common/refund-policy),
[Payment exceptions](https://nowpayments.io/blog/how-nowpayments-support-team-reduces-the-cost-of-payment-exceptions) (30 Oct 2026).

**What they built**
- A **status model** the merchant configures: Confirming, Partially Paid, Finished, Failed; plus
  dashboard settings for "Repeated Payments" and "Wrong-asset deposits".
- **Defaults by business model:** for goods, set both to "Partially Paid" (hold for review); for top-ups,
  "Partially Paid: Accept it. Credit the user with the exact outcome_amount they sent."
- **Warning on automation:** "Finished … automatically marks every deposit as 'Finished,' even if the
  amount is wrong."
- **Wrong network/asset:** auto-processed only if the asset is supported; otherwise a manual refund or
  forward, with the merchant or customer covering a network fee; a "Partnership Agreement" whitelists
  refund addresses so validation isn't repeated.
- **Support as the product:** the exceptions post sells support taking ownership of exceptions (cases of
  US$105 and US$400+, one refund taking about two days).

**What it teaches the persona**
- Gateways already have vocabulary and settings for short/over/wrong-asset. A controller who uses one
  will compare Clearline's statuses with these and ask "what do you do that my gateway's 'Partially
  Paid' doesn't?"
- The gateway's model ends at **status**; nothing in these pages covers posting to the ledger, the
  fee write-off account, or the auditor's evidence. That is the gap Clearline claims. `[GUESS: persona judgement]`
- "Accept it and credit the exact amount" is a real policy choice. Clearline should let the controller
  set it once, not decide every time. `[GUESS: persona judgement]`

**Mock-buyer questions it produces:** "Is your 'short' the same as my gateway's 'Partially Paid'?"
"Can I set a policy so small shortfalls auto-close to a fee account?" "Who pays the network fee on a
wrong-network recovery, and how is that booked?"

---

## Teardown 2 — Stripe: designing the wrong payment out  `[VERIFIED]`
Pages: [Stablecoin payments](https://docs.stripe.com/payments/stablecoin-payments),
[Automatic reconciliation (deprecated, bank transfers)](https://docs.stripe.com/invoicing/reconciliation).

**What they built**
- Customer is redirected to crypto.stripe.com, connects a wallet and picks the token and network; the
  payment is **customer-authenticated**. Accepted: USDC on Tempo, Ethereum, Solana, Polygon, Base (USDP,
  USDG US-only). Completed payments "settle in your Stripe balance in your local currency". Refunds go
  back as stablecoins to the original wallet. No disputes/chargebacks. 10,000 USD per-transaction limit.
- For bank transfers (not stablecoins), Stripe's reconciliation offered an **underpayment margin** and
  rules for overpayments (apply to oldest open invoice).

**What it teaches the persona**
- The cleanest fix for wrong payments is **not letting them happen** (wallet connect, chosen network,
  exact amount). Stablecoin payments made through Stripe settle as fiat in Stripe, so the controller
  books Stripe payouts, not wallet receipts. Clearline's relevance is payments **outside** such
  checkouts: direct-to-wallet B2B transfers, USDT (not in Stripe's accepted list), Tron.
- Tolerances and overpayment rules are standard expectations from mature tools.

**Mock-buyer questions:** "Why wouldn't I just put Stripe on the invoice?" (Honest answer: if your
customers pay USDC through Stripe, you probably don't need Clearline for those payments; ask how many
pay USDT or send directly.) "Do you have a tolerance setting like Stripe's?"

---

## Teardown 3 — Cryptio: the published month-end checklist  `[ASSUMPTION: secondary, search]`
Pages (blocked; content from search results): [Month end checklist (Enterprise)](https://support.cryptio.co/hc/en-gb/articles/20202941864721-Month-end-checklist-Enterprise),
[Month-end close best practice](https://cryptio.support.site/article/month-end-close-best-practice).
Positioning page opened: [cryptio.co/use-cases/payments](https://cryptio.co/use-cases/payments) `[VERIFIED]`:
"Stay compliant with your crypto payment solution — Generate complete and accurate financial statements to
GAAP and IFRS standards", "Trusted by 450+ enterprises" (their claim).

**What the checklist does (per search):** starts with **data completeness** (all sources imported),
then classification and pricing, then an **end-of-month reconciliation report** that consolidates ledger
entries, asset **roll-forward**, trial balance and transaction history, used as the basis for the trial
balance comparison and stored in the **close package for audit readiness**.

**What it teaches the persona**
- The unit of a controller's work is the **period** and the **balance**, not the single payment.
- Enterprise crypto sub-ledgers sell audit-readiness and GAAP/IFRS reporting to companies at scale;
  Clearline is not that and shouldn't pretend. The persona checks whether Clearline gives at least a
  period receipts report and a per-wallet roll-forward, or says clearly it doesn't. `[GUESS: persona judgement]`

**Mock-buyer questions:** "Can you give me a roll-forward per wallet for October?" "What goes in my close
package from your tool?" "We already have a sub-ledger; where do you sit next to it?"

---

## Teardown 4 — A merchant's public notice: "1 USDT ≠ 1 USDT"  `[ASSUMPTION: secondary, search]`
Page (blocked; search result): [SurferCloud notice](https://www.surfercloud.com/blog/important-notice-ensuring-correct-usdt-payments-for-surfercloud-services-1%e2%89%a01usdt).

**What it shows (per search):** a company receiving USDT publicly tells its customers that sending
exactly the invoiced amount arrives short after network fees, causing insufficient payments, and asks
them to send enough to cover fees.

**What it teaches the persona:** short-after-fees is common enough that some merchants solve it with
**customer education** (a notice), not software. A controller's alternative to buying Clearline may be
"tell customers to add the fee and write off small differences". The persona should raise that as the
cheapest competitor. `[GUESS: persona judgement]`

**Mock-buyer question:** "Why can't I just tell customers to cover the fee and write off anything under
US$5?"
