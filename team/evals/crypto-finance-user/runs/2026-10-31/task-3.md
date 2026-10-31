SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# Value feedback (P2): would the controller at "Harbourline Trading" (FICTIONAL) pay US$200/month today?

**Basis:** Calls rows used: 1 (of which buyers: 0; the one row is a fractional CFO, an advisor). Public sources: 0 opened this run; pack sources cited with their labels. Scenario: `fixtures/value-scenario.md` (FICTIONAL). Product facts: `clearline-product.md`, `demo/WHAT_TO_SAY.md`, OBJECTIONS.md (`origin/enterprise-pack`). As of today there have been **0 buyer interviews**. Everything below is a simulation's opinion.

## Scenario I'm answering for (all FICTIONAL, from the fixture)
Singapore B2B wholesale. Finance team of 2. Around 30 stablecoin invoice payments a month: about **20 USDT on Tron** and 10 USDC on Ethereum, sent directly from customers' exchange accounts to two company wallets. No gateway. Books in Xero. Annual external audit. Close takes about 4 days. Last quarter: several short payments after exchange fees, one on the wrong network, a few with no invoice number.

## Verdict
**As the simulated controller: no, not at US$200/month today.**

The reason is blunt. Two-thirds of my receipts arrive as USDT on Tron. Clearline's payment-request flow receives USDC/USDT on **Ethereum only**, and "a payment sent on Tron is detected as a wrong-network payment" [INTERNAL: demo/WHAT_TO_SAY.md; clearline-product.md known gaps]. So for about 20 of my 30 payments a month, the tool would flag my normal payments as wrong. It wouldn't verify, match or post them. What's left is about 10 USDC payments, which is below the roughly 20–25 a month where the internal pricing doc itself says it may not pay for itself on time alone [GUESS, INTERNAL: OBJECTIONS.md / ROI_CALCULATOR inputs].

The fit is otherwise good on paper, and that's why this isn't a flat "never":
- I'm direct-to-wallet with no gateway. That's where OBJECTIONS.md says Clearline adds the most ("payments that don't go through the gateway").
- I'm on Xero. It's built and in testing, and posts only once a person approves [INTERNAL: clearline-product.md].
- My exception types (short after fees, wrong network, no invoice number) are the ones the posting rules handle: short accepted → payment + separate fee write-off; wrong network never posted; no reference → nothing until a person confirms [INTERNAL: docs/ACCOUNTING_SYNC.md via clearline-product.md].

### What would flip it to "yes, try the pilot"
1. **Tron receiving in the payment-request flow** (USDT-TRC20 verified, matched and postable). Without this, nothing else matters for this company.
2. **Individual sign-in for approvers.** I have an annual audit, and today "the approver's name is typed, not verified" [INTERNAL: clearline-product.md]. I won't put postings with a typed name in front of my auditor.
3. **A period view I can close from:** October receipts per wallet, what's posted and what's not, a roll-forward per wallet and token. The pack found none documented [GUESS: from docs only, clearline-product.md], and that's where my 4 days go (`finance-ops-practice.md` §2: the close package and roll-forward are what the auditor reviews `[GUESS: persona judgement]`).

A nice-to-have, not a flip condition: a **tolerance setting** so small exchange-fee shortfalls close to a fee account under a written policy. Today every short payment needs a person [GUESS: persona judgement, finance-ops-practice.md §3; compare Stripe's underpayment margin, VERIFIED: pack, opened 2026-10-31].

## Forces card (JTBD)
| Force | Line | Source |
|---|---|---|
| Push | Short payments after fees, a wrong-network payment, payments with no invoice number. Someone has to chase, write off or match by hand | Fixture (FICTIONAL); B1/B2 in persona [VERIFIED: pack, NOWPayments pages opened 2026-10-31] |
| Push | Annual audit wants traceable evidence per receipt | persona A3 [ASSUMPTION: secondary, search — pcaobus.org blocked] |
| Pull | Plain-English explanation + draft reply + the exact Xero lines, posted only after approval | [INTERNAL: clearline-product.md] |
| Pull | Separate fee write-off and overpayment lines, never two payments for a duplicate | [INTERNAL: docs/ACCOUNTING_SYNC.md] |
| Anxiety | Most of my volume (Tron) isn't supported | [INTERNAL: WHAT_TO_SAY.md] |
| Anxiety | Solo founder, no SLA, plain-JSON storage of Xero tokens, no SOC 2 / pen test | [INTERNAL: OBJECTIONS.md "security", "solo founder"] |
| Anxiety | Typed approver names won't satisfy an auditor | [INTERNAL: clearline-product.md] |
| Habit | Explorer (Tronscan/Etherscan) + spreadsheet + a write-off policy for small differences; tell customers to add the fee | teardowns.md T4 [ASSUMPTION: secondary, search]; O2/O13 in objections bank |

## What it's compared with (no invented numbers)
- **Cheapest alternative:** an explorer, a spreadsheet, a written write-off threshold, and a customer notice ("send the invoice amount plus the network fee"). This costs the clerk's and my time each close, plus the risk of a wrong posting I don't catch. I won't put a number on either. If Aashmiin needs one, it has to come from the prospect's own hours via `ROI_CALCULATOR.md`.
- **Stripe stablecoin checkout:** not an option for most of my volume. Stripe accepts USDC on Ethereum, Solana, Polygon, Base and Tempo, not USDT or Tron, and settles to fiat in the Stripe balance [VERIFIED: pack, docs.stripe.com opened 2026-10-31]. It would only cover my 10 USDC payments, and only if my customers agree to pay through a checkout instead of sending from their exchange.
- The "time saved" figure (6 min per auto-match, 20 per exception) is a **demo estimate, not measured** [INTERNAL: WHAT_TO_SAY.md]. It must not be used as my reason to buy.

## Pricing note (flag, don't resolve)
OBJECTIONS.md says pilot US$300 for 30 days, then US$200/month. `demo/WHAT_TO_SAY.md` says "We haven't set pricing", and the website reportedly says pilots are free. Three answers to one question would make me, as the buyer, ask which is true. Aashmiin to decide. Any price to a prospect needs her approval (company rule 6).

## Mom-Test questions for a real buyer (past tense, specific)
1. "Walk me through the last payment that arrived short. Who noticed, what did you decide, and how did it end up in Xero?"
2. "Last month, how many receipts came in on each network, and which wallets did they land in?" (tests the Tron condition)
3. "At your last audit, what did the auditor ask for on stablecoin receipts, and how long did it take you to produce it?"
4. "Last close, what did you do for the wallets that you don't do for the bank account?" (tests the period-view condition)
5. "Have you ever paid for anything to fix this: a bookkeeper, a tool, a gateway? What happened?"

This is a simulation's opinion. It is not a price test and not evidence anyone would pay.

Source-tie rate: 22 items (verdict reasons, 3 flip conditions + nice-to-have, 8 forces, 3 comparisons, pricing note, fit points); 21 tied to the fixture, an internal doc or a pack source; 1 `[GUESS: persona judgement]` unsupported (tolerance as nice-to-have, partly sourced). **21/22 ≈ 95%.**

## Log (live tools off)
WOULD WRITE: Log row "SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. value feedback (Harbourline, FICTIONAL): verdicts [given scenario ~30/mo, 2/3 Tron: no today], conditions 3 (Tron receiving; approver sign-in; period/roll-forward view), questions 5. Pricing docs disagree (OBJECTIONS.md vs WHAT_TO_SAY.md), flagged to Aashmiin. Report: team/feedback/crypto-finance-user/2026-10-31-value.md".
WOULD WRITE: Log note "for product-manager: SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. Hypothesis to test in real calls: Tron receiving may gate fit for direct-to-wallet USDT payers; ask Mom-Test Q2."
