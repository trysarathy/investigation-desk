SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# Mock sales call (P4): sceptical head of finance, Singapore SaaS on NetSuite (FICTIONAL buyer)

**Basis:** Calls rows used: 1 (fixture export `calls-export-2026-10-31.csv`), of which buyers: 0 (1 advisor, fractional CFO, scored Weak). Public sources used: 0 opened this run (live tools off); pack sources cited with their labels. Product facts from `company/PRODUCT_FACTS.md` (last checked 2026-10-31). OBJECTIONS.md (branch `enterprise-pack`) **not opened this run** — I used its summary in `objections-bank.md` and `clearline-product.md`. Brief: `fixtures/mock-call-brief.md` (buyer FICTIONAL; pitch lines verbatim).

I am playing a simulated controller. Nothing I say is a customer view. The buyer is "a head of finance at a company like a Singapore SaaS that bills overseas" — not a real person or company.

**SETUP status:** PAUSE could not be read (live tools off) — WOULD READ: Settings `PAUSE`.

---

## The call (15 minutes, in turns)

Aashmiin's lines are quoted verbatim from the brief. I don't invent her follow-up answers; where the call would branch, I write what I'd push on and what a strong answer would contain.

**Min 0–1 — Opening.** *Buyer:* "I've got fifteen minutes before a close meeting. We get some USDC from overseas customers, we're on NetSuite, and anything touching finance data goes through our security questionnaire. Go."

**Line 1.** Aashmiin: "Clearline matches every stablecoin payment to its invoice and explains the wrong ones."
*Buyer:* "Every one? What happens when my customer pays two invoices in one transfer with no reference? Who decides then?" (O2-style edge case; persona B-traits)
→ Push: the product links automatically only with exact identifiers; anything ambiguous goes to a person [INTERNAL: PRODUCT_FACTS "Match payments"]. "Every" isn't true, and for this buyer the Base payments aren't checked at all (see line 8).

**Line 2.** Aashmiin: "We integrate with Xero, QuickBooks and NetSuite."
*Buyer:* "Good, we're on NetSuite. Which NetSuite record does it create — customer payment against the invoice? Into which account? Can I see it in our sandbox next week?" (O14, O4)
→ This is the line that kills the call when the truth comes out: NetSuite is **designed, not built**; QuickBooks code exists but is **not offered**; Xero is **built, in testing** [INTERNAL: PRODUCT_FACTS]. *Buyer, once it's clear:* "So that's not built yet? Then what would I actually be using on day one?"
→ Follow-up objection: "Bitwave / Cryptio already sync to NetSuite. Why wait for you?" (O4)

**Line 3.** Aashmiin: "Your auditors will accept our evidence pack."
*Buyer:* "You've spoken to our auditors? No? Then you can't say that. Our auditor will want existence and ownership of the wallet balance — how does reading a public chain help with ownership?" (O8)
→ Honest content: it doesn't prove ownership; it gives per-payment occurrence and accuracy evidence (tx hash, token contract, network, approver, time) and reproducible verdicts; "confirm with your auditor" [ASSUMPTION: secondary, crypto-accounting-and-audit.md §3; INTERNAL: docs/SPEC.md §6 per pack].
→ Follow-up: "And is USDC cash for us? Which account would you post it to?" (O9) — strong answer: it posts to the account the company chooses; classification is the company's and auditor's call, no advice given.

**Line 4.** Aashmiin: "It saves about 20 minutes per exception."
*Buyer:* "Measured where? With 0 customers, whose exceptions?" (red flag: time-saved presented as measured)
→ The 20 minutes is a demo **estimate**, not measured [INTERNAL: clearline-product.md "Known gaps"]. Strong answer: "That's our assumption; tell me how long your last short payment took and who handled it."
→ Follow-up: "US$200 a month for maybe 15 payments? Why?" (O5) — strong answer asks for their volumes; below ~20–25 payments/month it may not pay back on time alone [GUESS, per pack from ROI_CALCULATOR inputs]; no invented ROI.

**Line 5.** Aashmiin: "We never hold funds or keys; it's read-only on-chain, and nothing posts until a person approves."
*Buyer:* "Fine. Who's the person? If your log says 'Priya', can you prove it was Priya? And send me your SOC 2." (O11, O1, persona C6)
→ True statement [INTERNAL: PRODUCT_FACTS "Custody" and "Xero … posts only after a person clicks Approve"]. To keep it strong she has to volunteer the gaps before the questionnaire finds them: no individual sign-in or roles (approver name typed, not verified), data/tokens stored as plain JSON, no SOC 2, no pen test; self-host option; "if you need SOC 2 first, we're not ready" [INTERNAL: clearline-product.md, objections-bank O1/O11].

**Min ~8 — Mom-Test trap.** *Buyer:* "Honestly, this looks great." → Test: does she treat that as a buying signal and move to price, or ask about our life ("How did you handle the last short USDC payment? Who decided? How long did it take?")? Her planned lines contain no question about the buyer at all, so as planned she fails this.

**Line 6.** Aashmiin: "A few finance teams we've worked with said this was the missing piece."
*Buyer:* "Great — can I speak to one of them? Which ERP are they on?" (O15)
→ There are **0 customers** and the Calls tab has **1 advisor conversation, 0 buyer interviews** [INTERNAL: PRODUCT_FACTS; Calls fixture]. That one advisor said "I've never heard of a company that provides this service" and that integration matters "more than the page you showed me" [CALL 2026-10-30 MENTOR-ANTOINE, fractional CFO, advisor not buyer — internal only, never quoted outward]. That is not "finance teams we've worked with". When a buyer asks for the reference and none exists, the call is over and so is trust in lines 2–4.
→ Follow-up: "You're a solo founder. What if you disappear mid-close?" (O6) — strong answer: true; no SLA; self-host, no custody, 30-day term, deletion on exit.

**Line 7.** Aashmiin: "Pilot is US$300 for 30 days."
*Buyer:* "And after 30 days? Is it per entity? And your website says pilots are free — which is it?"
→ Matches the offer [INTERNAL: PRODUCT_FACTS "Offer"]. To be complete: then US$200/month, first 10 businesses, paid by invoice. Known conflict she must expect: the website (`website-fixes`) says "Free during the pilot" and `demo/WHAT_TO_SAY.md` says pricing isn't set [INTERNAL: PRODUCT_FACTS "Known conflicts"]. Don't offer the "pilot fee credited against months 2–4" mentioned in my pack — PRODUCT_FACTS says no credits or discounts without her approval; the two internal docs disagree and she should settle it before the call.

**Line 8.** Aashmiin: "We support Base as well."
*Buyer:* "Good, half our USDC comes on Base. So I can send a Base payment request today?"
→ Not true per PRODUCT_FACTS: payment checks cover **Tron, Ethereum and BNB Chain**; payment requests are **Ethereum only**, and a payment on another network to a request is flagged "this request is Ethereum only" [INTERNAL: PRODUCT_FACTS]. Base is not listed anywhere. (O12, adapted to Base.)
→ Follow-up the buyer will raise anyway: "Stripe takes USDC on Ethereum and Base and settles to our bank currency. Why not put Stripe on the invoice?" (O7) Stripe's stablecoin docs list USDC on Ethereum, Solana, Polygon, Base and Tempo [ASSUMPTION: secondary, pack note of docs.stripe.com opened 2026-10-31; not re-opened this run]. For a USDC-on-Ethereum/Base buyer that is a real alternative; the honest answer is "if your customers will pay through Stripe, you may not need us for those".

**Min 14–15 — Close.** *Buyer:* "Send me something on NetSuite when it exists." No next step with a date was planned in the lines.

---

## Buyer card (now shared)
| Item | Content | Source |
|---|---|---|
| Segment | Singapore SaaS, bills overseas, some receipts in USDC on Ethereum and Base | Brief (FICTIONAL) |
| ERP | NetSuite | Brief |
| Auditor | Big Four-network | Brief |
| Push | Wrong/short stablecoin payments create manual work and posting decisions | persona B1/B3 (pack: vendor pages) [ASSUMPTION: secondary, pack note; not re-opened] |
| Pull | Read-only, approve-before-post, plain-English exceptions | PRODUCT_FACTS [INTERNAL] |
| Anxiety | Security questionnaire (no SOC 2, no sign-in); solo founder; ledger write access | Brief; persona C5/C6 [INTERNAL: OBJECTIONS.md via pack] |
| Habit | NetSuite reconciliation; possibly an existing sub-ledger or Stripe | persona A2/C4 [ASSUMPTION: secondary] |
| Must-haves | 1) posts into NetSuite; 2) covers Base; 3) passes the vendor security questionnaire | Brief + [GUESS: persona judgement] |
| Deal-breaker | No NetSuite posting today | PRODUCT_FACTS: NetSuite designed, not built |

## Scorecard (over-promises first)
| # | Her line (verbatim) | Rating | Why (vs honest answer) | Objection |
|---|---|---|---|---|
| 6 | "A few finance teams we've worked with said this was the missing piece." | **Over-promise (rule 2 breach: fake customers/testimonial)** | 0 customers; 1 advisor call, 0 buyers. Honest: "We have no customers yet; you'd be one of the first, which is why the pilot is cheap." | O15 |
| 2 | "We integrate with Xero, QuickBooks and NetSuite." | **Over-promise (rule 2 breach)** | Xero built, in testing, posts only once you approve; QuickBooks next; NetSuite designed, not built. For this buyer that's the deal-breaker, so say it in minute one. | O14, O4 |
| 3 | "Your auditors will accept our evidence pack." | **Over-promise** (red flag "auditors accept this") | No auditor has reviewed it. Honest: per-payment occurrence/accuracy evidence, reproducible verdicts; doesn't prove ownership; confirm with your auditor. | O8, O9 |
| 8 | "We support Base as well." | **Over-promise** | Not in PRODUCT_FACTS. Honest: "Checks cover Tron, Ethereum, BNB Chain; payment pages are Ethereum-only for now. Base isn't supported — how much of your volume is on Base?" | O12, O7 |
| 4 | "It saves about 20 minutes per exception." | **Over-promise** (estimate presented as measured) | Demo estimate, not measured. Honest: drop it, or "our estimate; tell me your last one". | O5 |
| 1 | "Clearline matches every stablecoin payment to its invoice and explains the wrong ones." | **Weak** | "Every" overstates: automatic only with exact identifiers, ambiguous goes to a person, and Base isn't covered. Fix: "matches payments with exact identifiers automatically and sends anything ambiguous to a person". | O2 |
| 7 | "Pilot is US$300 for 30 days." | **Ok** | Matches the offer. Add "then US$200/month, first 10 businesses, paid by invoice"; expect the "website says free" question; offer no credits. | O5 |
| 5 | "We never hold funds or keys; it's read-only on-chain, and nothing posts until a person approves." | **Strong** | Matches PRODUCT_FACTS exactly. Make it bulletproof by naming the gaps (typed approver name, no SOC 2, plain-JSON storage) before the questionnaire does. | O1, O11 |

**Totals:** 8 lines; 5 over-promises (2 are company-rule-2 breaches: fake customer feedback, unbuilt integrations), 1 weak, 1 ok, 1 strong. Objections used: 12 (O1, O2, O4, O5, O6, O7, O8, O9, O11, O12, O14, O15 — O12 adapted to Base).
**Mom Test:** fail as planned — no question about their past (last short payment, who decided, how long, what share skips the checkout, how much is on Base).
**Next step with a date:** none planned.

## Three changes before a real call
1. **Lead with the truth on NetSuite and Base** (lines 2, 8, 1): "Xero is built and in testing, posts only once you approve; QuickBooks next; NetSuite is designed, not built. Checks cover Tron, Ethereum and BNB Chain; payment pages are Ethereum-only; Base isn't supported." Then qualify: if NetSuite posting and Base are must-haves, say "we're not ready for you yet" and ask to keep talking as a design input — that keeps trust.
2. **Delete lines 6, 3 and 4.** Replace 6 with "we have no customers yet"; 3 with what the evidence actually is plus "confirm with your auditor"; 4 with a question about their own last exception. No dates, references or measured savings.
3. **Bring questions, not claims** (Mom Test), and a dated next step: "Walk me through the last USDC payment that arrived wrong — what happened, who fixed it, how long?", "How much of your USDC comes on Base vs Ethereum?", "Do any customers pay through a checkout like Stripe?", "What's on your vendor security questionnaire for finance tools?" Prepare the honest security answers (no SOC 2, no sign-in, self-host option) in advance.

**Objection most likely to end the call:** NetSuite (O14) — no NetSuite posting is this buyer's deal-breaker, and if line 2 has already claimed it, the moment it's exposed every other line loses credibility. Close second: the security questionnaire (O1).

This is a simulation's opinion. It is not a price test and not evidence anyone would buy.

## Log and hand-offs (live tools off)
WOULD WRITE: Log row — `2026-10-31 SGT | crypto-finance-user | mock call saas-netsuite | SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. mock call: objections 12, over-promises 5 (lines 2, 3, 4, 6, 8), top fix: state NetSuite/Base status truthfully and delete line 6. Report team/evals/crypto-finance-user/runs/2026-10-31-retest/task-4.md`

WOULD WRITE: Log row — `SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. RISK: planned pitch lines over-claim (rule 2): "finance teams we've worked with" (0 customers), "integrate with Xero, QuickBooks and NetSuite", "auditors will accept", "support Base", "saves 20 minutes" as measured. for chief-of-staff: top of 07:30 briefing; lines must not be used on a real call.`

WOULD WRITE: Log row — `SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. for sales-closer-assistant: mock-call scorecard (saas-netsuite) at the report path; rewrite lines 1–4, 6, 8 per "Three changes"; add Mom-Test questions and a dated next step to the call prep.`

WOULD WRITE: Log row — `SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. for chief-of-staff / Aashmiin: pricing conflict to settle before calls — PRODUCT_FACTS offer (no credits) vs pack note "pilot fee credited against months 2–4" vs website "Free during the pilot" vs WHAT_TO_SAY "pricing not set".`
