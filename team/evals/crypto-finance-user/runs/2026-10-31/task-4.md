SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

I am playing a simulated controller. Nothing I say is a customer view.

# Mock sales call (P4): head of finance, Singapore SaaS (FICTIONAL), NetSuite

**Basis:** Calls rows used: 0 for the buyer card (Calls tab: 1 row, advisor, 0 buyers). Sources: `fixtures/mock-call-brief.md` (FICTIONAL buyer; Aashmiin's real planned lines), `objections-bank.md`, `docs/enterprise/OBJECTIONS.md` (`git show origin/enterprise-pack`, read this run), `demo/WHAT_TO_SAY.md` (read this run), `teardowns.md`. The buyer is a segment ("a head of finance at a company like a Singapore SaaS billing overseas"), not a real person. Aashmiin's side below is **only her 8 planned lines, verbatim**. I didn't invent anything she would say.

## The call (15 min, turns)
*Opening: buyer frame set by me.*

**Buyer:** Thanks for the time. Quick context: we bill overseas customers, some pay USDC on Ethereum and some on Base. Our books are in NetSuite, our auditor is a Big Four network firm, and every vendor that touches finance data goes through our security questionnaire. I've got fifteen minutes. What does it do? *(sets up O14, O1, O8)*

**Aashmiin (line 1):** "Clearline matches every stablecoin payment to its invoice and explains the wrong ones."

**Buyer:** "Every"? Every token on every chain? Half of what I care about lands on Base. And how does it match: do I need to send each customer a payment request first, or does it read my wallet? *(probing scope; sets up line 8)*

**Aashmiin (line 2):** "We integrate with Xero, QuickBooks and NetSuite."

**Buyer:** Good, NetSuite is the only one I care about. Which records do you create: customer payments applied to the invoice, or journal entries? Who at your end has done a NetSuite sandbox with you? *(O14. Honest status: Xero built and in testing, QuickBooks next, NetSuite designed, not built [INTERNAL: ACCOUNTING_SYNC.md]. As the buyer I'd find that out in the security review or the pilot and walk.)*

**Aashmiin (line 3):** "Your auditors will accept our evidence pack."

**Buyer:** You've spoken to my auditors? They haven't told *me* what they'll accept. On existence and ownership of the wallet balance specifically, how does reading public chain data help? *(O8. A read-only tool gives per-payment occurrence/accuracy evidence, not ownership [ASSUMPTION: secondary, crypto-accounting-and-audit.md §3].)*

**Aashmiin (line 4):** "It saves about 20 minutes per exception."

**Buyer:** Measured where, on whose tickets? How many exceptions was that averaged over? *(The 20 minutes is a demo estimate, not measured [INTERNAL: WHAT_TO_SAY.md].)*

**Aashmiin (line 5):** "We never hold funds or keys; it's read-only on-chain, and nothing posts until a person approves."

**Buyer:** OK, that I like. Who's "a person"? Do approvers sign in individually, with roles? And where are the ledger credentials stored? It'll be question 14 on our questionnaire. *(O1, O11. Honest: no individual sign-in, names typed; Xero tokens stored as plain JSON; no SOC 2, no pen test [INTERNAL: OBJECTIONS.md "security"].)*

**Buyer (Mom-Test trap):** Honestly, this looks great. I can see my team liking it. *(Compliment, zero commitment. Does she treat it as a buying signal or ask about our last close?)*

**Aashmiin (line 6):** "A few finance teams we've worked with said this was the missing piece."

**Buyer:** Great, can I speak to one of them? Which ERP were they on? *(O15. The truth: 0 customers; Calls tab has 1 row, an advisor, not a buyer. As a buyer I'd check this reference. It's the line that ends trust once found out.)*

**Aashmiin (line 7):** "Pilot is US$300 for 30 days."

**Buyer:** Fine for a pilot. But I can't start one until the questionnaire's done, and I can't do a pilot of a NetSuite integration that I'd only be testing in Xero. What are the success criteria and what happens if you miss them? *(O5-adjacent. Price matches OBJECTIONS.md; WHAT_TO_SAY.md says pricing not set. Internal docs disagree.)*

**Aashmiin (line 8):** "We support Base as well."

**Buyer:** Good, receiving on Base, matched and posted? Since when? *(False today: "Not yet: receiving on Tron, Solana, Base, Polygon" [INTERNAL: WHAT_TO_SAY.md].)*

**Buyer (habit/alternative):** One more. Stripe takes USDC on Ethereum and Base and settles it to my Stripe balance in SGD. Why wouldn't I put Stripe on the invoice and never see a wrong payment? *(O7 [VERIFIED: pack, docs.stripe.com opened 2026-10-31]. For this buyer it's a real alternative: both of their networks are in Stripe's list.)*

**Buyer (competitor):** And Bitwave or Request Finance already sync to NetSuite. *(O4 [INTERNAL: OBJECTIONS.md, VERIFIED by Aashmiin's doc 28 Oct 2026].)*

**Buyer (close):** Send me your security pack and the NetSuite docs and I'll take a look. *(Polite brush-off. No next step with a date was asked for in the planned lines.)*

## Buyer card (shared after the call)
| Field | Content | Source |
|---|---|---|
| Segment | Head of finance, Singapore SaaS billing overseas | fixture (FICTIONAL) |
| ERP | NetSuite | fixture |
| How customers pay | USDC on Ethereum and Base | fixture |
| Push | Payments from overseas customers outside a checkout; auditor evidence per receipt | `[GUESS: persona judgement]`; persona A3 [ASSUMPTION: secondary] |
| Pull | Read-only, approval-gated posting, plain-English exceptions | [INTERNAL: clearline-product.md] |
| Anxiety | Vendor risk (questionnaire), solo founder, ledger write access | fixture; O1, O6 |
| Habit | Stripe for USDC; existing sub-ledger tools with NetSuite sync | O7 [VERIFIED: pack]; O4 [INTERNAL] |
| Must-haves | 1. NetSuite posting. 2. Pass the security questionnaire (individual sign-in, credential storage). 3. Base receiving | fixture; [INTERNAL: OBJECTIONS.md] |
| Deal-breaker | No NetSuite connector | fixture + [INTERNAL: ACCOUNTING_SYNC.md] |

## Scorecard (over-promises first)
| # | Her line | Rating | Why (vs OBJECTIONS.md / WHAT_TO_SAY.md) | Honest version |
|---|---|---|---|---|
| 2 | "We integrate with Xero, QuickBooks and NetSuite." | **Over-promise** (breach of company rule 2) | Xero built and in testing; QuickBooks next; NetSuite designed, not built | "Xero first, it's built and in testing on the Demo Company; QuickBooks next; NetSuite is designed, not built. For you on NetSuite, we're not ready yet." |
| 6 | "A few finance teams we've worked with said this was the missing piece." | **Over-promise / fake reference** (most serious) | 0 customers; Calls tab 1 advisor row, 0 buyers. Red flag: "a reference" | "We have no customers yet. You'd be one of the first, which is why the pilot is cheap." (O15) |
| 3 | "Your auditors will accept our evidence pack." | **Over-promise** | Red flag "auditors accept this"; ownership isn't shown by chain data | "It gives per-payment evidence: tx hash, token contract, network, approver, time. Whether that satisfies your auditor is their call. Happy to show them a sample." |
| 8 | "We support Base as well." | **Over-promise (false)** | WHAT_TO_SAY.md: Base "not yet" | "Today USDC/USDT on Ethereum. Base is not yet. Which networks do your customers use, and in what share?" |
| 4 | "It saves about 20 minutes per exception." | **Over-promise** | Demo estimate, not measured. Red flag "time-saved figure presented as measured" | "In the demo we assume about 20 minutes per exception. It's not measured; we'd measure it on your tickets in the pilot." |
| 1 | "…matches every stablecoin payment…" | **Weak** | "Every" overstates scope (Ethereum only, USDC/USDT) | "…matches USDC and USDT payments on Ethereum to their invoices…" |
| 7 | "Pilot is US$300 for 30 days." | **OK** | Matches OBJECTIONS.md, but WHAT_TO_SAY.md says pricing not set and the website reportedly says free. Pick one before the call; add the refund-if-missed criteria | Add "credited against months 2–4; refunded if we miss 'every payment matched or explained' or 'zero wrong postings'" |
| 5 | "We never hold funds or keys; read-only on-chain; nothing posts until a person approves." | **Strong** | True per OBJECTIONS.md. Add the gaps before they're found: names typed, no SSO, plain-JSON storage, no SOC 2 | Keep, then: "If your policy needs SOC 2 or SSO first, we're not ready yet." |

**Mom-Test check:** none of the 8 planned lines asks about the buyer's life (how they handle a wrong payment today, who decides, last close, last audit). The compliment ("this looks great") had no planned response that tests it. A planned line that answers it with a claim (line 6) would treat it as a buying signal. **Next step with a date:** none planned.

Counts: 8 lines; over-promises 5 (lines 2, 3, 4, 6, 8); weak 1; ok 1; strong 1. Objections used: O1, O4, O5, O7, O8, O11, O14, O15 (8).

## Three changes before a real call
1. **Delete line 6 and replace it with the true count.** A fake reference is the one thing a finance buyer checks. It breaks company rule 2 and would end trust in everything else.
2. **Fix the capability lines (2, 8, 1) to what's built:** "Xero first, QuickBooks next; NetSuite designed, not built", "Ethereum today; Base not yet". With *this* buyer, say early that NetSuite isn't built. Better to qualify out in minute 2 than in the security review.
3. **Replace claims with questions.** Swap lines 3 and 4 for Mom-Test questions: "Walk me through the last USDC payment that arrived wrong. What happened in NetSuite?" and "What did your auditor ask for on stablecoin receipts last year?" Then end with a dated next step (e.g. a questionnaire review call), or an honest "not a fit until NetSuite".

**Objection most likely to end it:** O14 "We're on NetSuite", followed by O1 (security questionnaire: no SSO/SOC 2). Honest read as the simulated buyer: today this segment is **not a fit**. That's useful to know, not a failure.

Source-tie rate: 8 scored lines + 9 buyer-card fields + 3 changes = 20 items; 19 sourced; 1 `[GUESS: persona judgement]` (Push line). **19/20 = 95%.**

## Log (live tools off)
WOULD WRITE: Log row "SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. mock call (SaaS/NetSuite, FICTIONAL buyer): objections 8, over-promises 5 (lines 2,3,4,6,8), top fix: remove 'finance teams we've worked with' line. Report: team/feedback/crypto-finance-user/2026-10-31-mock-call-saas-netsuite.md".
WOULD WRITE: Log row "RISK: SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. Planned pitch lines claim NetSuite/QuickBooks integration, Base support, auditor acceptance, a measured time saving and 'finance teams we've worked with' (0 customers). Fix before any real call."
WOULD WRITE: Log note "for sales-closer-assistant: scorecard in report; use honest versions in call prep."
