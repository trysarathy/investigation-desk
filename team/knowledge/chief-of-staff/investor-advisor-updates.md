# Investor-style and advisor updates

Clearline has no investors yet. Her human advisors act as her board: **Prof Paul Griffin, Dr Catalin
Burlacu, Soon Loo, Donna, Doug Peris (SMU)** (`company/COMPANY_RULES.md` rule 6; note `prompts/RULES.md`
on `gtm-os` lists the mentors without Dr Burlacu: treat him as a mentor all the same). Anything to them
is a **draft for her**: you never send it, never put their addresses on a draft you invent, and never
mention QRE/QCDAO.

## What good practice says
- **Monthly.** Aaron Harris: "Send updates monthly. It's a hell of a forcing function" [VERIFIED S17:
  https://blog.aaronkharris.com/investor-updates, 2026-10-31]. "On time, good news or bad" is our rule, not a quote.
- **Structure:** key metrics with growth rates first (revenue or users, cash/burn), then asks, then a short
  qualitative recap at the bottom [VERIFIED S17 for metrics → asks → qualitative; S18 (Visible.vc,
  secondary, opened 2026-10-31) summarises Harris the same way, recap last]. Corrected 2026-10-31: was
  "3-5 highlights, 1-3 lowlights, 1-3 asks [S18]": those counts are **not** in S18 or S17; treat them as
  our house format, not a YC rule.
- **Aaron Harris (YC):** report "your growth (in revenue or users), your cash/burn, what you need from
  investors and a qualitative measure of how things are going"; "Put the asks higher up"; "Make it
  shorter"; "Adding new things because they're important is good. Removing things because you can't hit
  your milestones is bad." [VERIFIED S17: https://blog.aaronkharris.com/investor-updates, 2026-10-31]
- **Lines, not dots:** Mark Suster's point is that investors judge a founder by a series of data points
  over time, so brief, regular progress notes before you need anything build the relationship
  [ASSUMPTION S19: bothsidesofthetable.com unreachable 2026-10-31]. For advisors this is the main purpose: they see the line of progress, and the asks
  land with context.
- **Board practice:** GitLab links every pre-read in the agenda and its cover email to the board
  "includes any highlights or asks" [VERIFIED S6]. Our cover line = BLUF + asks.
- **Be honest about thin data** (GitLab: acknowledge data quality; judgement with limited data is fine
  if it is known) [VERIFIED S2].

## Monthly update (1st of month, 10:17; Google Doc draft)
Title `Clearline monthly update <Mon YYYY> (DRAFT - not sent)`. ≤ 1 page.
```
Subject idea: Clearline - <Month> update: <one-line headline that is true>
TL;DR (3 lines): where we are vs the 30-day goal; the biggest thing learned; the ask.
Asks (1-3, specific): e.g. "an intro to a finance lead at a Singapore company that invoices in USDC".
Numbers (table; each with its tab; last month | this month | target):
  Paying pilots (north star) · Pilots offered · Calls held · Strong-problem calls · Positive replies ·
  First emails sent · Cash collected (Finance) · MRR committed (Customers) · Costs (Finance) ·
  Bounce % · Complaints. Missing → "not recorded".
Highlights (3-5): shipped product (merged PRs, roadmap `shipped`), real customer learning (anonymised).
Lowlights (1-3): what missed and why, what changes.
Product: what works today in plain words (Xero built and in testing; QuickBooks next; posting only
  once a person approves; read-only, no custody).
Next month: 3 outcomes.
Thanks: anyone who helped, only if the Decisions log/Calls/Partners shows it.
```
Never: projections dressed as results, logos/customers without written permission, "live with
customers", "posts to Xero automatically", runway or burn if Finance doesn't have it (say "not tracked
yet"), anything from QRE.

## Weekly advisor update draft (Sunday, inside the weekly report + a Doc)
Advisors are busy academics/operators. Etiquette [GUESS, reflecting the practice above]:
- **5-8 lines, plain text**, readable on a phone in under a minute. No attachments.
- Line 1: the headline number vs goal ("Week 1: 0 of 5 paid pilots; 3 calls held, 1 strong").
- 2-3 lines: what happened and what was learned (in customers' anonymised words).
- 1 line: what's next this week.
- **One ask, specific, optional, easy to say no to.** Address it to the advisor whose help is on record
  for that kind of thing (Decisions log, Partners "intro via"); if nothing is on record, make it a general
  ask and let her choose who. Never invent an advisor's expertise.
- Same format every time (the "line"), even when the numbers are zero. Zeros stated plainly read as
  honest; silence reads as trouble.
- She chooses whether to send weekly, fortnightly or monthly; you draft every Sunday so it's ready.
- Draft goes in the weekly report body and a Doc `Clearline advisor update <date> (DRAFT)`. If she asks
  you to "just send it", prepare a Gmail **draft** (reply in the advisor's existing thread if one exists;
  never type an address you didn't find in a real thread) and tell her it is one click away.

## Example skeleton (fictional numbers, for shape only)
```
Hi <name>,
Week 2 of Clearline's founding-pilot push: 1 paid pilot of 5 targeted by 28 Nov (US$300 collected).
6 calls held; 2 had a strong problem: both reconcile USDT receipts by hand into Xero, ~2 hours a week.
Shipped: month-end receivables report (the pilot deliverable).
Missed: replies are 1.2% on 160 first emails, below the 2% I hoped; I'm testing a shorter first line.
This week: 3 more pilot offers.
One ask: do you know a finance lead at a Singapore exporter paid in USDC? A 15-min intro would help.
Aashmiin
```
