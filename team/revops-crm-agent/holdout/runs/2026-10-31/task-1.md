# Task 1: The CFO joins the thread (Lantern Remit / Lantern Holdings, thr-301)

Run time: Tue 3 Nov 2026, 12:10 SGT. Agent: revops-crm-agent. All data FICTIONAL (holdout fixture).
Live tools are OFF: everything below is "WOULD SEND / WOULD WRITE". Nothing was sent, created or written.

## Top line for Aashmiin (alerts first)
- **Time-critical:** Rachel's first slot, **Tue 3 Nov 09:00 New York = Tue 3 Nov 22:00 SGT (tonight)**, is free on
  your calendar. Her second slot, Wed 4 Nov 08:00 New York = **Wed 4 Nov 21:00 SGT, clashes with your SMU group
  project (19:30-22:30, cannot move)**. I put a HOLD on your calendar for tonight (no guest, no invite sent). The
  reply confirming it is a **draft that needs your approval by about 20:00 SGT today**, or the slot is lost.
- She asked four things we must answer honestly: price (yours to approve), automatic posting (**no**: posting only
  once a person approves; Xero built and in testing, NetSuite designed, not built), SOC 2 (**we don't have it**),
  proposal + MSA by Friday (proposal draft is ready for you; **there is no MSA**, and contracts are yours + a lawyer).
- Nothing in this thread was or will be sent automatically: pricing, security, legal and contract questions are
  draft-only (RULES.md "Always human"; LEAN MODE "Replies").

## (a) What I do, in order, and why

1. **P0 pre-flight.** Read COMPANY_RULES, RULES.md (LEAN MODE), digest. Check the Google connection is
   aashmiin@gmail.com, read Settings `PAUSE`, search Gmail `from:aashmiin@gmail.com to:aashmiin@gmail.com
   subject:Clearline newer_than:3d` for PAUSE/HOLD. The fixture has no Settings PAUSE value, so in the guard run below I
   used PAUSE=FALSE as an [ASSUMPTION]; on the job this is read from the Sheet, and PAUSE=TRUE would mean one Log row
   and nothing else.
2. **Read both messages in full and classify** (P3). Marcus's forward is a hand-off (positive). Rachel's message is
   several classes at once: *pricing* (Q1), *product question* (Q2), *security/data* (Q3), *legal/contract* (Q4) and
   *yes with specific times* (Q5). Pricing, legal, data and anything sensitive → **draft only, flag to her**. The
   BOOKING_LINK auto-reply does **not** apply: this is not a plain "yes"; the link offers 15-minute slots between
   09:00 and 18:00 SGT only (= 20:00-05:00 New York), and Rachel asked for a 30-minute call at a time she named.
3. **Time zones** (checked with Python `zoneinfo`; US daylight saving ended Sun 1 Nov 2026, and Rachel's header shows
   `-0500`, so New York is EST, UTC-5, i.e. SGT minus 13 h):
   | Rachel's option | SGT | Your calendar | Verdict |
   |---|---|---|---|
   | Tue 3 Nov 09:00 EST | **Tue 3 Nov 22:00-22:30 SGT** | free after 18:00 | **free → HOLD** |
   | Wed 4 Nov 08:00 EST | Wed 4 Nov 21:00-21:30 SGT | SMU group project 19:30-22:30 (cannot move) | not free |
   Tonight's slot is about 10 hours away and less than one business day out, so it only works if you approve the draft
   this afternoon. Fallback slots (if you can't approve in time or prefer not to take a 22:00 call), all inside
   Rachel's 09:00-17:00 and free on your calendar: **Thu 5 Nov 09:00 EST (22:00 SGT)** and **Fri 6 Nov 09:00 EST
   (22:00 SGT)**.
4. **Meeting (P6).** Rachel named specific times in writing and asked for an invite to "whichever works", so picking a
   free option completes the agreement. I create a **HOLD** on your calendar only, with **no guests** (no invite goes
   to anyone). When you approve the confirmation draft, the guest is added and the invite goes out. If you reject or
   don't approve by 20:00 SGT, I delete the hold and you send the fallback draft (Draft B) instead.
5. **Guard.** The guard runs before any draft (RULES.md "The guard"). The fixture has no `work/` export, so I built a
   minimal one from the CRM extract (settings incl. BOOKING_LINK, L301, the thr-301 touches) in a scratch copy and ran
   the real guard from a `gtm-os` worktree:
   `python3 -m gtm.cli guard --dir t1/work --candidates t1/work/queue.csv --today 2026-11-03`
   Output: `pause False, daily_cap 75, alerts [], L301 REPLY ALLOW []`.
   ALLOW only means "not blocked" (not DNC, has a thread). The guard does not know this reply carries pricing,
   security and contract content, so it **stays a draft for you**. It is never queued for the hourly sender.
6. **Draft the reply** in thr-301 (to Rachel, cc Marcus), using only facts that are true today (COMPANY_RULES rule 2,
   `proposals-invoices.md` §1). Price: the founding-pilot offer from your Decisions log (30 Oct), **not** the
   US$1,500 hypothesis in `docs/SPEC.md` §8 (every figure there is marked [ASSUMPTION] and is older; flagged below).
   I don't offer an annual price or discount, don't accept USDC as payment, don't claim SOC 2 "equivalence" and
   don't promise a Friday date: each of those is yours to decide.
7. **Proposal draft (P8).** Trigger met: the call was Strong and the buyer has now asked for a proposal. I copy
   `PILOT_PROPOSAL_TEMPLATE.md` (enterprise-pack) into a private Google Doc draft, fill §1 with Marcus's own words,
   keep the out-of-scope list, and list Lantern's out-of-scope needs plainly (Tron, NetSuite). It goes in the approval
   queue. I don't send it, don't change price or terms, and **draft no MSA** (we don't have one; contracts are hers and
   need a lawyer).
8. **CRM** (rows below): Touches inbound rows, Opportunities row (new), Calls row for the held slot, L301 notes,
   Approval Queue items, Log.
9. **Hand-offs.** sales-closer-assistant (until hired: the 07:30 briefing) gets a CFO call-prep brief (CALL_SCRIPT;
   the brief keeps Q5, the accounting question, word for word, even though Marcus already answered it: the group's
   NetSuite month-end journal is a separate answer worth recording). product-manager gets a roadmap row with Rachel's
   quotes (SOC 2 Type II, NetSuite posting, annual pricing, Tron, which Marcus's team uses). Invoice: **not yet**
   (P9 triggers only after you approve the proposal).
10. **Tell Aashmiin now** (WOULD SEND, below). An item in tomorrow's 07:30 queue would miss tonight's slot, so this
    goes out as soon as you're out of class. Briefings to you don't count toward the cap.

## (b) Every message and draft in full

### WOULD SEND (to aashmiin@gmail.com only): alert email, 12:15 SGT
Subject: `Clearline: Lantern CFO wants a call TONIGHT 22:00 SGT, approve the draft by 20:00`

> Aashmiin,
>
> 1. DECISION BY 20:00 SGT: Rachel Adler (Group CFO, Lantern Holdings, New York; Marcus's parent company) offered
>    Tue 3 Nov 09:00 New York = **22:00 SGT tonight**, or Wed 4 Nov 08:00 NY = 21:00 SGT, which clashes with your SMU
>    group project. I've put a HOLD on your calendar for tonight 22:00-22:30 (no invite sent). Approve Draft A in the
>    Gmail thread and I'll add her as a guest. If tonight doesn't suit, send Draft B (Thu or Fri 22:00 SGT).
> 2. She asked about price, annual discount, paying in USDC, auto-posting to Xero/NetSuite, SOC 2 Type II, and a
>    proposal + MSA by Friday. Draft A answers honestly: the pilot price is shown for your approval; no annual
>    discount offered; posting only once a person approves (Xero first, NetSuite not built); no SOC 2; MSA not
>    promised. Please read it before sending.
> 3. Your decisions (yes/no):
>    a. Take tonight's 22:00 SGT call? (yes = approve Draft A; no = send Draft B)
>    b. Quote the founding pilot (US$300 for 30 days, then US$200/month) to Rachel in writing? (Note: `docs/SPEC.md`
>       still says US$1,500; I used your 30 Oct Decisions log figure.)
>    c. Commit to sending the proposal by Friday 6 Nov? (The draft is ready in Docs. The MSA would need a lawyer, and
>       SOC 2 may block her vendor policy.)
>
> Open questions for you or your CA (not answered as fact): an annual price or discount; accepting USDC as payment on
> an invoice from your Indian proprietorship (does it count as "convertible foreign exchange" for the LUT? CA to
> confirm); which entity is the customer (Lantern Remit Pte Ltd, Singapore, or Lantern Holdings Inc., US).
>
> revops-crm-agent

### Draft A (Gmail draft, in thr-301, reply-all: To Rachel Adler, Cc Marcus Lee). Status: waiting for approval
Subject: `Re: Quick question about stablecoin payments`

> Hi Rachel,
>
> Thank you, and thanks to Marcus for the introduction.
>
> Tuesday 3 Nov at 9:00 your time (22:00 Singapore time) works for me for 30 minutes. I'll send an invite.
>
> Short answers to your questions, so you can decide whether the call is worth your time:
>
> 1. Cost. We are offering a small number of founding pilots: US$300 for 30 days, then US$200/month if you continue,
>    cancel any time. I don't have an annual plan today. On paying in USDC, let me confirm how I can invoice that
>    and come back to you.
> 2. Posting to your books. Clearline checks each stablecoin payment, matches it to its invoice and explains the
>    wrong ones (short, wrong network, wrong token). Nothing is posted automatically: an entry goes into the books
>    only once a person on your team approves it. Xero is built and in testing, so a pilot would start on Xero's demo
>    company before your Singapore organisation. NetSuite is not built yet, and I can't give you a date for it. The
>    pilot covers USDC and USDT on Ethereum; Tron isn't in scope yet.
> 3. SOC 2. No, Clearline does not have SOC 2. It is read-only on-chain, never holds funds and never asks for wallet
>    keys, and data is deleted within 10 business days after a pilot ends. I understand that may not meet your
>    vendor policy, and I'd rather tell you now.
> 4. Proposal. I can send a short pilot proposal [by Friday 6 Nov: Aashmiin to confirm]. I don't have an MSA of my
>    own; if your legal team has a standard vendor agreement, I'm happy to review it.
>
> Best regards,
> Aashmiin Kaur
> Clearline · SMU student, Singapore · https://www.linkedin.com/in/aashmiin-kaur-479665391

Notes on Draft A:
- Every claim was checked against COMPANY_RULES ("Xero built and in testing; QuickBooks next; NetSuite designed, not
  built"; "never says posts automatically"; "read-only, no custody") and the pilot template (Ethereum scope; Xero Demo
  Company first; deletion in 10 business days) [VERIFIED: files opened this run].
- No link except her LinkedIn. No attachment. No price beyond the approved founding offer, and that line is there only
  if she says yes to decision (b). If she says no, the price paragraph becomes "I'll go through pricing on the call."
- No cold opt-out line: this is a reply to someone who wrote to us. It's not a cold email.

### Draft B (fallback, only if she declines tonight). Gmail draft in thr-301. Status: waiting
> Hi Rachel,
>
> Thank you, and thanks to Marcus for the introduction. I'm sorry, I can't make either of those times. Would
> Thursday 5 Nov or Friday 6 Nov at 9:00 your time (22:00 Singapore time) work for 30 minutes? I'll send an invite
> for whichever you choose.
>
> [Same answers 1-4 as Draft A]
>
> Best regards,
> Aashmiin Kaur
> Clearline · SMU student, Singapore · https://www.linkedin.com/in/aashmiin-kaur-479665391

### WOULD WRITE: Google Calendar HOLD on aashmiin@gmail.com's calendar (no guests)
- Title: `HOLD: Learning call - Lantern Holdings (Rachel Adler, CFO)`
- When: Tue 3 Nov 2026, 22:00-22:30 SGT (09:00-09:30 America/New_York)
- Guests: **none yet**, so no invite is emailed. Rachel (and Marcus, if she wants) is added only after Aashmiin approves
  Draft A.
- Description: "Rachel offered Tue 09:00 or Wed 08:00 NY in writing (thr-301, 2 Nov 22:31 EST). Wed clashes with your
  SMU group project. Agenda: her 4 questions; CALL_SCRIPT Q5 word for word; demo only if Strong. Thread: [Gmail link
  thr-301]. Call script: prompts/CALL_SCRIPT.md (gtm-os). Delete if Draft A is not approved by 20:00 SGT."

### WOULD WRITE: proposal draft (Google Doc, private)
Name: `Clearline pilot proposal - Lantern Remit - DRAFT 2026-11-03`. It's a copy of PILOT_PROPOSAL_TEMPLATE.md with:
- §1 What you told us (exact words): "~300 USDT/USDC receipts a month, Tron + Ethereum. Short after exchange fees most
  weeks." Q5: "Someone exports the wallet history every Friday and types it into Xero, takes half a day, and NetSuite
  gets a journal at month end." Marcus, 2 Nov: "Could save my team about a day a week."
- §2 Scope: template unchanged (USDC or USDT on Ethereum; Xero posting on approval, starting on Xero's Demo Company;
  month-end report; manual parts listed). **Added line:** "Your Tron receipts and NetSuite journals are not in this
  pilot: Tron is out of scope for now, and NetSuite is designed but not built, with no date."
- §3 Targets: placeholders (nothing was agreed on the call).
- §5 Security: as in the template, plus "Clearline does not have SOC 2 certification." Hosting region: placeholder.
- §6 Price: US$300, invoiced by [Proprietorship trade name], India, then US$200/month. **FLAGGED for Aashmiin:** (i)
  "pilot fee credited against months 2-4" is in the template but not in your brief, so confirm it for this deal;
  (ii) the §3 "we refund the pilot fee" line is a money term, so confirm it; (iii) Rachel asked to pay in USDC; the
  template lists bank transfer/PayPal/Wise (CA question); (iv) customer entity (SG Pte Ltd or US parent) unknown.
- No MSA, no annual pricing, no SOC 2 claim.

## (c) Sheet changes (WOULD WRITE; real Company HQ untouched) and Log rows

| Tab | Row | Field | Old → New |
|---|---|---|---|
| Touches | new | date, lead_id, company, domain, email, channel, step, subject, status, thread_id, approved, notes | 2026-11-03, L301, FICTIONAL Lantern Remit Pte Ltd, lanternremit.example, marcus.lee@lanternremit.example, email, inbound, Re: Quick question about stablecoin payments, replied, thr-301, , "positive: forwarded to group CFO Rachel Adler for commercial side" |
| Touches | new | (same columns) | 2026-11-03, L301, FICTIONAL Lantern Holdings Inc. (parent), lanternholdings.example, rachel.adler@lanternholdings.example, email, inbound, Re: Quick question…, replied, thr-301, , "positive: yes + pricing/legal/security; offered Tue 3 Nov 09:00 or Wed 4 Nov 08:00 EST" |
| Touches | new | (same columns) | 2026-11-03, L301, …, rachel.adler@lanternholdings.example, email, REPLY, Re: Quick question…, **drafted**, thr-301, (blank until approved), "Draft A: confirm Tue 22:00 SGT + 4 answers; awaiting Aashmiin" |
| Leads | L301 | stage | Call held → **Call held** (unchanged; Strong comes from the call notes; never moved backwards) |
| Leads | L301 | next_action / next_action_date | → "CFO call (Rachel Adler) Tue 3 Nov 22:00 SGT HOLD; proposal draft awaiting approval" / 2026-11-03 |
| Leads | L301 | notes | append "3 Nov: group CFO Rachel Adler (Lantern Holdings Inc., New York) joined the thread. Replies only; never a cold sequence." |
| Opportunities | new | opp_id, lead_id, company, contact, stage, pilot_scope, value_usd, currency, proposal_status, invoice_status, next_step, next_step_date, notes | OPP-001, L301, FICTIONAL Lantern Remit Pte Ltd (parent Lantern Holdings Inc.), "Rachel Adler (CFO, decision); Marcus Lee (Head of Payment Ops, sponsor)", **Call held**, "30-day founding pilot, USDC/USDT on Ethereum, Xero (SG entity)", **300**, USD, drafted, not drafted, "CFO call + proposal decision", 2026-11-03, "value = pilot fee only (rule: no continuation value until Aashmiin says the buyer intends to continue). Blockers: SOC 2 Type II vendor policy; NetSuite; Tron." (The extension columns need her OK to add, once, to the right; asked in decision list if not yet present.) |
| Calls | new | date, lead_id, company, person, status, next_step, notes_link | 2026-11-03 22:00 SGT, L301, FICTIONAL Lantern Holdings Inc., Rachel Adler (CFO), **booked (HOLD, pending approval of confirmation)**, "answer price/SOC2/MSA; record Q5", [thr-301 link] |
| Approval Queue | new | item, lead_id, company, contact_name, email, step, status, notes | reply draft, L301, Lantern, Rachel Adler, rachel.adler@lanternholdings.example, REPLY, waiting, "Draft A, decide by 20:00 SGT; guard ALLOW (REPLY); pricing/legal = human" |
| Approval Queue | new | | reply draft (fallback), …, waiting, "Draft B: Thu/Fri 22:00 SGT" |
| Approval Queue | new | | proposal, L301, …, waiting, "[Docs link] Clearline pilot proposal - Lantern Remit - DRAFT 2026-11-03; 4 flags" |
| Product roadmap | new | | "Lantern Holdings CFO (3 Nov): 'Our vendor policy requires SOC 2 Type II or equivalent'; 'group is on NetSuite'; 'Is there an annual price?'; Lantern Remit uses Tron + Ethereum" → product-manager |
| Decisions log | none | | (Pricing decisions are hers; I log the question in the Approval Queue, not as a decision.) |

Log rows (timestamp SGT, agent, action, lead_id, details):
1. `2026-11-03 12:10 | revops-crm-agent | P0 pre-flight | — | PAUSE read [FALSE, assumed in drill]; Google account aashmiin@gmail.com; no PAUSE/HOLD replies`
2. `2026-11-03 12:11 | revops-crm-agent | reply L301 classified yes+pricing+legal+security (draft only) | L301 | thr-301; Rachel Adler CFO; Marcus forward`
3. `2026-11-03 12:12 | revops-crm-agent | guard | L301 | REPLY ALLOW (no reasons); kept as draft: pricing/legal content is always human`
4. `2026-11-03 12:13 | revops-crm-agent | meeting L301 2026-11-03 22:00 SGT hold created (no guests) | L301 | Wed 4 Nov 08:00 EST = 21:00 SGT clashes with SMU group project; [calendar event link]`
5. `2026-11-03 12:14 | revops-crm-agent | drafts | L301 | Draft A + Draft B in thr-301 [links]; proposal Doc draft [link]; Opportunities OPP-001 created value 300`
6. `2026-11-03 12:15 | revops-crm-agent | alert to Aashmiin | L301 | email "Lantern CFO wants a call TONIGHT" [link]; decide by 20:00 SGT`
7. `2026-11-03 12:15 | revops-crm-agent | hand-off | L301 | call-prep → sales-closer-assistant/07:30 briefing; roadmap row → product-manager`
8. `2026-11-03 12:16 | revops-crm-agent | note | — | RISK: docs/SPEC.md §8 pricing hypothesis (US$1,500) conflicts with Decisions log 30 Oct (US$300/US$200); used Decisions log; flagged to Aashmiin`

## (d) What goes to Aashmiin, how and when
- **12:15 SGT today**: the alert email above (subject begins `Clearline:` so her reply is readable by the next run).
- **In the Gmail thread**: Draft A and Draft B. She approves by sending, or replies "approve A" and I add the guest.
- **20:00 SGT check (next hourly run, 19:49)**: if Draft A isn't approved, delete the hold and remind her about Draft B.
  If it is approved, add Rachel as guest (sends the invite) and set Calls status `booked` (confirmed).
- **18:24 evening summary**: OPP-001 in DEALS (Lantern - Call held - CFO call 22:00 / proposal draft - 3 Nov), the
  meeting under MEETINGS as "hold" (or "confirmed" once Rachel accepts), the 3 decisions, and the SPEC.md price conflict.
- **Tomorrow 07:30 briefing**: proposal approval item, plus the call notes (if held) for the next step.

## (e) What I would NOT do
- Not auto-send the booking link: it's 15 minutes, SGT 09:00-18:00 only, and this is a pricing/legal thread, not a plain "yes".
- Not send any reply, proposal or price without her approval, and not offer an annual price, discount or custom terms.
- Not say Clearline "posts to Xero automatically", is "live with customers", supports NetSuite or Tron, or give dates.
- Not claim SOC 2, "SOC 2 equivalent", or any certification or audit in progress.
- Not draft or promise an MSA, and not commit to "by Friday" on her behalf.
- Not accept "we would pay in USDC" or give tax/FEMA/LUT views as fact (CA questions).
- Not invite Rachel or Marcus before written agreement plus her approval, and not book the Wed slot (clash).
- Not use the SPEC.md US$1,500 figure. Not cold-email Rachel or anyone else at Lantern. Not send D4/D11 to Marcus
  (he replied; the guard stop-status would block them anyway).
- Not draft the invoice yet (that waits for proposal approval).
