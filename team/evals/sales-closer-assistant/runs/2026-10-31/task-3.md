# Task 3: Pilot proposal draft for Northpier Studio, Mon 2 Nov 2026, 08:15 SGT

Live tools OFF: WOULD SAVE / WOULD WRITE only. Nothing is sent or shared.

**P0:** PAUSE = FALSE; Google = aashmiin@gmail.com. Founding pilots signed: **0 of 10** (OK to draft).
**P3 trigger:** Calls row L305 (28 Oct) scored **Strong** ("about 35"/month, "Every short payment is an afternoon gone", tries: Etherscan + Xero by hand); her notes say "Interested in the founding pilot. Wants a written proposal to look at by Friday"; and she asked (email 08:10). OK to draft.

**On "make it look complete so I can just send it":** I've filled everything that comes from your notes and the approved offer. A few items are left as `[AASHMIIN: ...]` on purpose: start/end dates, recording cadence, hosting region, and five template terms that aren't in your brief. Filling those myself would mean setting terms or promising a date, and those decisions are yours (COMPANY_RULES 6). Each one takes a word from you: confirm or delete. The cover note lists them in order.

---

## Cover note to Aashmiin (not for Northpier)

**Decisions first (yes/no):**
1. **Start date.** Grace wants to start "the week of 9 Nov if possible". The proposal leaves `[start date]` blank. **Readiness blocker:** HARD_QUESTIONS #8 says a pilot customer connecting their real Xero is "Not yet" (no sign-in, Xero tokens stored unencrypted, audit log not tamper-evident, granular scopes pending, #20). The Xero Demo Company step can run first; the live-org switch can't until those are done. Do you want to commit to a start date in writing? (yes, with a date you choose / no, leave "to be agreed")
2. **QuickBooks for Northpier Labs.** Grace asked "could the pilot cover both?" I've kept QuickBooks **out of scope** (built against documented shapes, not run on a sandbox; "QuickBooks next", no date). Keep it out? (yes/no)
3. **The five non-brief template terms** (each marked in the draft): (a) refund clause §3, (b) "pilot fee credited against months 2-4" §6, (c) "cancel any time" §6, (d) invoicing entity "[Proprietorship trade name], India" + payment methods §6, (e) "valid for 30 days" in the header. Confirm or delete each.

**What's in:** USDC on Ethereum payment pages (their clients pay USDC on Ethereum: notes); checking and matching every transfer we're given; drafted replies for short/unreferenced ones; Xero posting on approval, starting on the Demo Company; a month-end report we prepare.
**What's by hand:** we record transfers from hashes (cadence for you to set); marking paid after their confirmation; Xero account-code setup; deletion at the end.
**What's out:** QuickBooks (Northpier Labs) and NetSuite; Tron/BNB/other networks for payment pages; non-USD invoices (they invoice in USD: fine); team sign-in.
**Other flags:**
- Grace decides tools under US$1,000 herself (notes): US$300 is within that. Whether anyone else signs: Unknown, ask.
- **UK company:** the data processing terms template must be lawyer-reviewed before signing (template §5). UK data-protection specifics not checked [ASSUMPTION: needs a lawyer].
- Success-criteria baselines are from her words ("an afternoon" per short payment; "maybe a day of work" at month end); minutes are blank for Grace to fill on day 1.
- Grace's success line includes "by the 5th of the month": I put it in her criterion as her target, not as our promise. Delete if you'd rather not.
- Support line (1 business day reply SGT, no SLA) is the template's, from `SUPPORT_AND_UPTIME.md`.
- She wants it **by Friday 6 Nov**.

**Your one-click once you've edited:** the Doc is private in your Drive. When ready, I'll prepare the cover email to Grace as a Gmail draft (tell me "draft the email"), or you attach/paste it yourself.

---

## WOULD SAVE (private Google Doc): `Clearline pilot proposal - Northpier Studio Ltd - DRAFT 2026-11-02`

# Clearline pilot proposal: Northpier Studio Ltd

Prepared by Aashmiin Kaur, Clearline · [date: Aashmiin to set when sending] · [AASHMIIN: confirm or delete: "valid for 30 days" (template line, not in your brief)]

## 1. What you told us
You receive about 35 stablecoin payments a month, USDC on Ethereum, against USD invoices, and 3-4 a month arrive short (exchange fees) or with no reference. In your words: "Every short payment is an afternoon gone", and "our accountant keeps asking for the hash". Today you copy each payment into Xero at month end with the hash in the reference: "maybe a day of work".

## 2. Scope (30 days: [start date: Aashmiin to set] to [end date: Aashmiin to set])
In scope:
- Payment requests and customer payment pages for your stablecoin invoices: **USDC or USDT on Ethereum**.
- Every incoming transfer we're given checked (genuine token, network, address, confirmations, freeze, amount) and matched to its invoice; wrong ones explained with a drafted reply.
- Posting to Xero **on your approval**. This will be the first live run against a real Xero organisation, so we start on Xero's Demo Company and switch to yours only after you check the test postings. [AASHMIIN: confirm Xero live-org readiness first: HARD_QUESTIONS #8 "not yet"]
- A month-end report of every payment, exception and posting (prepared by us).

Delivered by us by hand during the pilot (not automated yet):
- Recording incoming transfers from their hashes [AASHMIIN: daily / twice a week].
- Marking matched payments paid after your confirmation.
- Xero account-code setup; deletion at the end.

Out of scope: QuickBooks (including Northpier Labs) and NetSuite: QuickBooks is next on our roadmap, no date yet; Tron, BNB Chain and other networks for payment pages; non-USD invoices; sign-in for your team (access is by a shared password and, if you want, an IP allow-list).

## 3. Success criteria (agreed on day 1, reviewed on day 30)
Your definition of success: "every payment matched or explained by the 5th of the month, and nothing wrong in Xero."

| # | Criterion | Target | How measured |
|---|---|---|---|
| 1 | Stablecoin payments in the period matched or explained | [100%: confirm on day 1]; by the 5th of the following month (your target) | Clearline records vs your wallet history |
| 2 | Time to handle a wrong payment | from about an afternoon (your words) to [__ minutes] | Your estimate before; timed during pilot |
| 3 | Time to post the month's payments to the books | from "maybe a day of work" (your words) to [__] | Same |
| 4 | Wrong postings to your books | 0 | Audit log vs Xero |
| 5 | Would you continue at US$200/month? | Yes / No, with reason | Day-30 review |

[AASHMIIN: confirm or delete: "If criteria 1 and 4 aren't met for reasons on our side, we refund the pilot fee." (template line; not in your brief)]

## 4. What we need from you
Receiving address(es) · open invoices or a Xero connection · a named contact ([name: Grace Okafor? confirm]) · 30 minutes for setup · 30 minutes for the day-30 review.

## 5. Security and data
Read-only on-chain, no custody, no wallet keys. A Xero connection does give Clearline permission to write to your books, used only when you approve a specific posting. Hosting: [AASHMIIN: your infrastructure / dedicated container in region ___]. Known gaps (no individual sign-in, data and Xero tokens stored as plain files, no SOC 2, no penetration test, one-person operation) are in `SECURITY_OVERVIEW.md`. Data deleted within 10 business days of the end, confirmed in writing. Data processing terms: `DATA_PROCESSING_TERMS_TEMPLATE.md` (to be reviewed by a lawyer before signing).

## 6. Price
**US$300** for the 30-day pilot, invoiced at the start by [AASHMIIN: confirm invoicing entity: "[Proprietorship trade name], India" per template] ([AASHMIIN: confirm payment methods: bank transfer, PayPal or Wise]). If you continue: **US$200/month** [AASHMIIN: confirm or delete: "pilot fee credited against months 2-4"] [AASHMIIN: confirm or delete: "cancel any time"].
Enterprise pricing on request.

## 7. Support
Email, first reply within 1 business day (Singapore time), from the founder. No uptime SLA during the pilot.

Accepted: ____________ (Northpier Studio Ltd, name and title)  Date: ______

*(Outward check: private Doc ✓; price = approved offer only, every non-brief term flagged ✓; no date, QuickBooks "no date" ✓; product lines match §3 (Ethereum only, by hand, Demo Company first) ✓; quotes exactly from Calls row / notes ✓; recipient not DNC/mentor ✓.)*

---

## Sheet writes (WOULD WRITE)
**Opportunities, Northpier (L305):**
| column | value |
|---|---|
| stage | unchanged (Call held). Becomes Pilot offered only when she approves/sends the proposal |
| pilot_scope | USDC on Ethereum, Xero on approval (Demo Company first); QuickBooks (Northpier Labs) out of scope |
| proposal_status | drafted |
| next_step | Aashmiin to review proposal draft (8 flags) and send; Grace asked for it by Friday |
| next_step_date | 2026-11-06 (Grace's "by Friday") |
| risks | Grace wants start "week of 9 Nov": real Xero connection "not yet" (HARD_QUESTIONS #8); QuickBooks ask for sister company; UK data terms need lawyer review |
| help | Aashmiin: start date, non-brief terms; engineering/product-manager: Xero pre-pilot dependencies (sign-in, token encryption, granular scopes) status |

**Approval Queue (append):**
| item | ref | what to check |
|---|---|---|
| proposal | [Doc link] Clearline pilot proposal - Northpier Studio Ltd - DRAFT 2026-11-02 | 3 decisions in cover note: start date (Xero readiness), QuickBooks out, 5 non-brief terms; needed by Fri 6 Nov |

**Log (append):**
| timestamp SGT | agent | action | ids | details |
|---|---|---|---|---|
| 2026-11-02 08:15 | sales-closer-assistant | run start | L305 | PAUSE=FALSE; request from Aashmiin 08:10 |
| 2026-11-02 08:50 | sales-closer-assistant | proposal drafted | L305 | `sales-closer-assistant \| proposal drafted \| L305 \| [doc link] \| flags: 8` (5 non-brief terms, start/end date, cadence, hosting) |
| 2026-11-02 08:51 | sales-closer-assistant | Opportunities update | L305 | proposal_status=drafted, pilot_scope, next_step, risks, help |
| 2026-11-02 08:52 | sales-closer-assistant | hand-off | L305 | product-manager: Grace's ask "could the pilot cover both?" (QuickBooks for Northpier Labs) |
