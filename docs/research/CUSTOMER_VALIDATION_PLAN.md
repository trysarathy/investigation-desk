# Clearline customer validation plan (6 weeks)

Prepared 2026-11-15 (SGT) by research-agent for Aashmiin Kaur. This is a **PROPOSED plan for the
founder**. **No outreach is sent by any agent.** Under company rule 5, Aashmiin sends everything.
Any outreach list or draft is prepared by its owners (revops-crm-agent / sdr), inside the guard
and caps in `prompts/RULES.md` on `gtm-os`, and goes in the 07:30 approval queue. No named people
appear in this plan.

The segment choice comes from `GLOBAL_MARKETS.md` §4 (decisions D1–D4 there are still pending).
Labels follow company rule 2. Numbers in this plan are targets or thresholds `[GUESS]`, not data.

---

## 1. What we are trying to learn

**Differentiation hypothesis (H-D1)**
- Payment-ops and finance-ops teams that pay across two or more providers or rails, fiat and/or
  stablecoin, regularly hit exceptions that:
  - no single provider's dashboard explains;
  - are hard to resolve because three pieces of evidence sit in different places: execution
    status (the provider says "sent"), settlement evidence (bank statement or on-chain receipt)
    and the ledger.
- They spend material time on these exceptions.
- They would pay for one layer that keeps the three apart, explains each exception and shows
  prefunding (funding) exposure per provider.

**Rival explanations we must be able to tell apart**
- **R1.** Provider portals (e.g. the provider's own reconciliation reports) are good enough.
  Provider tools do have documented limits. Stripe's payout reconciliation report is "only
  available for users with automatic payouts enabled", and instant payouts must be reconciled by
  the user `[VERIFIED: research-agent 2026-11-15,
  https://docs.stripe.com/reports/payout-reconciliation]`. Whether such limits matter to *these*
  buyers is exactly what the interviews test.
  Single providers also bridge fiat and stablecoin: Nium advertises reaching "190+ countries in
  fiat or stablecoin through a single integration" `[VERIFIED: research-agent 2026-11-15,
  https://www.nium.com/]`. So probe *cross-provider* pain, not fiat-plus-stablecoin pain.
- **R2.** The pain is real, but an existing reconciliation tool or an in-house script already
  solves it.
- **R3.** The pain is real, but it belongs to a team without budget, or it is too infrequent to
  pay for.
- **R4.** Vendor due diligence (MAS outsourcing guidelines, `[ASSUMPTION: secondary]`, see
  GLOBAL_MARKETS §3.1) makes any pilot impractical for a pre-revenue vendor.

---

## 2. Segments and target roles (no named people)

| Cell | Segment | Interviews target | Roles to talk to |
|---|---|---|---|
| A (primary) | Singapore-licensed MPIs offering cross-border money transfer, ~20–300 staff, using ≥ 2 payout partners or rails (ideally ≥ 1 stablecoin/DPT rail) | **8–10 held** | Head or Manager of Payment Operations; Treasury / Liquidity Manager (prefunding); Financial Controller or Finance-Ops lead; Reconciliation team lead; CFO at < 50 staff |
| B (comparison, capped) | Singapore-based exporters, marketplaces or platforms paying or collecting via ≥ 2 providers (bank + wallet/PSP; optionally stablecoin) | **4** | Financial Controller; Finance Manager; AR/AP lead; CFO |
| C (context only, not counted) | Accountants or auditors serving A or B; reconciliation consultants | 2 | Partner or manager in a payments/fintech practice |

**Sourcing (prepared by research, sent by Aashmiin only)**
- Cell A: the MAS Financial Institutions Directory, filtered by MPI and by the cross-border money
  transfer service. This is a primary source. It was not opened this run: mas.gov.sg served a maintenance page
  to curl. Open it from a normal browser.
- Cell B: public evidence of multi-provider use (the company's own pages).
- Events and associations: Aashmiin picks and approves.
- Excluded, per company rules 6 and 7:
  - mentors, SMU staff, investors and her warm network, unless she explicitly chooses them;
  - QRE/QCDAO and its contacts.

**Disqualifiers**
- One provider only.
- Pure money-changer.
- The firm is itself a reconciliation vendor. Note it as a competitor.

---

## 3. Six-week schedule

| Week | Founder activity (≈ 6–8 h/week) | Output |
|---|---|---|
| 0 (prep, 2–3 days) | Approve D1–D4. Research builds the Cell A and B target list from primary registers. revops-crm-agent drafts asks inside the guard. She approves and sends | Target list with evidence; experiment registered in the Log (rule frozen) |
| 1 | First 3–4 interviews (Cell A). No demo in the first 25 minutes | Notes in the Calls tab; Mom Test grade per interview |
| 2 | 3–4 interviews (A); 1–2 (B). Ask for redacted cases at the end of the strong ones (§6) | Running tally vs thresholds; no verdict yet |
| 3 | 2–3 interviews (A); 1–2 (B); 1 context interview (C). First sandbox demo walk-throughs, to interviewees only, after the problem section | Demo feedback logged separately from problem evidence |
| 4 | Finish A to ≥ 8 held; B to 4. Receive redacted cases under the protocol | Case log (§6) |
| 5 | Replay up to 5 redacted cases in the sandbox. Return a written explanation of each case to its owner and ask: "Is this right? Would this have saved you time?" | Case replay outcomes |
| 6 | Decide against the pre-registered rules (§5). gtm-strategist writes SCALE / ITERATE / KILL / INCONCLUSIVE with intervals | Numbered decisions for Aashmiin |

If Cell A has fewer than 8 held interviews at the end of week 6, the verdict is **INCONCLUSIVE**.
Extend once, by up to 3 weeks with a stated end date, or stop. It is never called a win or a loss
(`experiments-and-decision-rules.md` §2–3).

---

## 4. Interview guide (problem questions, not a pitch)

Format: 30–40 minutes. Ask about past events, not opinions about the future. No product mention
until section F.

Rules for the interviewer:
- Ask for the last specific time, with numbers.
- Never ask "would you use…?"
- Note exact words.

**A. Context (5 min)**
1. Walk me through how money moves out (or in) at your company today. Which providers, rails and
   currencies, roughly how many payments a month?
2. Which of those providers do you have to pre-fund, and how do you decide how much to keep at
   each?
3. Who on the team owns reconciliation? What tools do they use? (Provider portals,
   spreadsheets, an internal script, a vendor tool, the accounting system.)

**B. The last exception (10–12 min): the core evidence**
4. Tell me about the last payment that didn't reconcile cleanly. When was it? What happened?
5. How did you first find out? (Customer complaint, bank statement, provider report,
   month-end.)
6. What did the provider say its status was, and what did the bank statement or on-chain record
   show? Where did those two disagree?
7. What did you have to open, and whom did you have to ask, to work out the truth? How long did
   it take from first spotting it to closing it?
8. What did it cost: time, a fee, a write-off, a delayed payout, an unhappy customer, an audit
   question?
9. How many of those happen in a typical month? Is that number written down anywhere?

**C. Funding exposure (5 min)**
10. Tell me about the last time a provider balance ran short or sat idle. How did you notice, and
    what did it cost?
11. How do you know today, at any moment, how much money is at each provider versus committed to
    payouts not yet settled?

**D. Close and audit (5 min)**
12. Walk me through month-end for payments. What takes the longest?
13. What do auditors, or your regulator returns, ask you to prove about payments? What was the
    hardest question you had to answer?

**E. Current fixes and budget (5 min)**
14. What have you tried to fix this: tools, scripts, hires? Why did you keep or drop each?
15. If this were solved, whose budget would it come from? Who else would have to agree?
16. Before a new vendor could see payment data, what would your compliance or IT team need?
    (Tests R4.)

**F. Only now, and only if they ask: the sandbox (optional, ≤ 10 min, §7)**
- Say "this is fictional data; it's a sandbox, not a live product".

**Closing asks**, in this order, each recorded with a date or a no:
- (a) "Could we look at one or two of those past exceptions together, redacted?" (§6)
- (b) "Who else on your team, or at another company, deals with this?"
- (c) A dated follow-up.

**Grading each interview** (`experiments-and-decision-rules.md` §5)

| Grade | Meaning |
|---|---|
| **A** | Gave data (a redacted case) or access |
| **B** | Dated next step |
| **C** | Specific past exception with numbers, from Q4–Q9 |
| **D** | Compliments, hypotheticals |

Only A–C count. An interview is **"Strong"** only if it has a grade C+ exception from the last
90 days **and** an answer to Q15 that names a budget owner.

---

## 5. Evidence thresholds (pre-registered; frozen when registered in the Log)

`EXP-20261116-1  Cross-provider exception pain, Singapore MPIs (Cell A)`

**Primary metric**
- Share of held Cell A interviews that are Strong (definition in §4).
- Minimum n: **8 held**.

| Verdict | Rule |
|---|---|
| **CONFIRM H-D1 (SCALE to a pilot offer)** | ≥ 8 held, and **≥ 5 of 8 Strong** (Wilson 95%: 31–86%), and ≥ 3 named a specific cross-provider exception in the last 90 days that took ≥ 2 hours to close [GUESS bar], and ≥ 2 provided a redacted case (grade A), and ≥ 1 says provider portals do *not* resolve it (against R1) |
| **KILL H-D1 for Cell A** | ≥ 8 held, and **≤ 2 of 8 Strong** (Wilson: 7–59%); or ≥ 6 of 8 say provider portals or an existing tool already cover it (R1/R2); or ≥ 3 say vendor due diligence rules out any pilot with a pre-revenue vendor (R4). In that case run Cell B or the UK next (GLOBAL_MARKETS §4) |
| **ITERATE** | ≥ 8 held, 3–4 Strong, or Strong pain but no budget owner (R3). Change ONE thing (sub-segment, role or problem framing) as a new experiment |
| **INCONCLUSIVE** | < 8 held at the end date. Report k of n with the interval; extend once or stop |

**Cell B** (n = 4) is **directional only**. No verdict is allowed on 4 interviews. It may only
inform which cell to run next.

**Cross-check against the existing beachhead rule.** A segment is declared a beachhead only with
≥ 1 paid pilot as well (`experiments-and-decision-rules.md` §4). This plan stops at "confirm
differentiation". A paid pilot needs:
- an offer, and its price for this buyer. The current US$300 / 30 days offer was set for the
  stablecoin-receipts product. Whether it applies here is **her decision**. This plan proposes
  no price.
- a product that exists. Fiat multi-provider reconciliation is not in PRODUCT_FACTS.

---

## 6. Asking for up to 5 redacted historical cases (secure handling)

**The ask**, said after a Strong interview, never in a first message:
> "Would you be willing to share one or two past exceptions, redacted, so we can see whether we
> would have explained them correctly? You choose what to remove. We'll send back our written
> explanation and delete everything by a date you set."

**Before any data moves** (prerequisites; D4 in GLOBAL_MARKETS)
1. A mutual NDA plus a short data-handling note. If personal data can't be fully removed, add a
   data-processing clause that names Clearline as a **data intermediary** under the PDPA
   `[ASSUMPTION: needs Singapore counsel]`.
2. The customer's compliance team signs off. Expect a questionnaire under MAS outsourcing
   guidelines `[ASSUMPTION: secondary]`. Have a one-page security note ready: where data is
   stored, who can see it, encryption, deletion.
3. **Never** request any of the following (company rule 3):
   - keys, seed phrases or credentials;
   - API access, write access or payment authority.
   Files only, chosen by the customer.

**What to ask for, minimum necessary**

| Item | Detail |
|---|---|
| Per exception | 1–3 records from each source: provider status export row(s), the matching bank-statement or on-chain line, and the ledger entry if any |
| Fields | Dates and times; amount and currency; FX rate and fees; provider name (or "Provider A/B"); status codes; reference fields; network and tx hash for stablecoin legs (public on-chain data) |
| Remove or tokenise | Names of individuals; account numbers (keep the last 2–4 digits if needed for matching); addresses; phone and email; national IDs; beneficiary names (replace with "Beneficiary 1") |
| Outcome | What the customer eventually found was the cause, kept sealed until after our replay, so we can score ourselves honestly |

**Handling**
- Receive via the customer's own secure transfer, or an encrypted archive with the password sent
  by another channel.
- Store only in an access-restricted, encrypted, Singapore-region location. Only Aashmiin has
  access.
- **Not** in email threads, chat, the Company HQ sheet, git, logs or PRs (company rule 4).
- No data from Indian payment-system operators without an India-storage answer first. RBI's
  FAQ says payment data "shall be stored in systems located only in India" and covers "third party
  vendors … retained or engaged by" authorised PSOs `[VERIFIED: research-agent 2026-11-15,
  https://www.rbi.org.in/Scripts/FAQView.aspx?Id=130]`.
- No personal data from EU or UK firms in this sprint; that would need GDPR / UK GDPR transfer
  terms.
- Deletion date is agreed in writing, 30 days by default. Confirm deletion by email.
- The Log gets one row per case, holding only an anonymous case ID, the segment, the date
  received and the date deleted. No data goes in it.

**Cap.** At most **5 cases** across all cells this sprint. Prefer 5 different companies over
5 cases from one.

**Replay scoring** (per case, in week 5)
- Did the sandbox separate execution, settlement and ledger correctly? (Y/N)
- Did our explanation match the customer's sealed outcome? (match / partial / wrong)
- The customer's estimate of time saved (their words).

Report as k of n, for example "3 of 4 matched". No percentages without the denominator.

---

## 7. What to show in the sandbox demo (fictional data, clearly labelled)

**Opening line, every time:**
> "Everything here is fictional data in a sandbox. It shows the approach; it is not a live
> integration."

Never imply real customers, live provider connections or automatic posting. Check
`company/PRODUCT_FACTS.md` before describing anything as built.

**Five screens, about 8 minutes:**

1. **One payout, three truths.** A single cross-border payout:
   - provider says "completed";
   - bank statement shows the amount short by a correspondent fee;
   - the ledger booked the gross amount.
   The three are shown side by side, as separate evidence, never merged.
2. **The exception explained.** A plain-English explanation of why they differ (fee deducted
   in transit), what evidence supports it, and the suggested next action for a person.
3. **Stablecoin leg.** A USDT/USDC payout where the provider status and the on-chain receipt
   disagree (wrong network, or short amount). It uses only what PRODUCT_FACTS says is checkable
   (Tron, Ethereum, BNB Chain).
4. **Funding exposure.** Fictional prefunded balances at Provider A and Provider B versus
   committed, unsettled payouts. Which provider runs short first?
5. **Accounting bridge: planned.** Show it as a mock-up labelled "planned". Say "Xero first,
   QuickBooks next; posts only once a person approves", per company rule 2. For India-type
   prospects, say a Tally/Zoho bridge does not exist.

**Questions after the demo** (record answers separately from problem evidence):
- "Which of these, if any, has happened to you in the last 90 days?"
- "What's missing that you'd need to trust it?"
- "What would you need to see before showing this to your compliance team?"

Demo enthusiasm on its own is grade D and does not count towards Strong.

---

## 8. Metrics (reported weekly with denominators)

| Metric | Definition | Target by end of week 6 [GUESS] |
|---|---|---|
| Interviews held, by cell | Calls tab rows with status "held" | A ≥ 8, B = 4, C ≤ 2 |
| Strong share (Cell A) | Strong / held, with Wilson 95% CI | Decision per §5 |
| Specific exceptions captured | Count of grade C+ stories, last 90 days, with time-to-close | ≥ 6 across A and B |
| Median stated time-to-close per exception | From Q7, in hours (with n) | Reported, no target |
| Exceptions per month (stated) | From Q9 (with n) | Reported, no target |
| Budget owner named | Interviews answering Q15 with a role | Reported as k of n |
| Redacted cases received / replayed / matched | Counts | ≤ 5 received |
| Due-diligence blockers | Interviews where Q16 implies no pilot possible | Kill signal if ≥ 3 |
| Referrals | Introductions offered in closing ask (b) | Reported |
| Founder hours | Hours spent, per week | ≤ 8 |

**Guardrails**
- 0 complaints.
- No rule breach: caps, Do-not-contact, strict-consent countries.
- No personal data outside the case store.
- Every claim in the demo is checked against PRODUCT_FACTS.

**Reporting**
- Weekly: one Log row (gtm-strategist), as "held k / Strong k of n (CI) / cases k".
- Week 6: decision memo with SCALE / ITERATE / KILL / INCONCLUSIVE and up to 3 numbered
  decisions.

---

## 9. Risks and what this plan does not do

- **Product gap.** The brief's fiat multi-provider scope is not built (PRODUCT_FACTS). A
  confirmed problem does not mean the product exists. A pilot offer waits for both her pricing
  decision and the build.
- **Small n.** Even 5 of 8 Strong leaves a 31–86% interval. This sprint can find a *candidate*;
  it cannot prove a market.
- **Sampling bias.** Interviewees who agree to talk are likelier to have the pain. Track how many
  were asked (prepared by revops, sent by her) so the response rate is visible.
- **No legal advice.** PDPA, PSA, DPDP and FEMA points here are research, not advice. D4 counsel
  check before real data.
