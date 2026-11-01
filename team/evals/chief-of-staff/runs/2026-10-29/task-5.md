# Task 5 - Sunday weekly report + spot check + advisor update draft, Sun 8 Nov 2026, 17:38 SGT

P0: Google account = aashmiin@gmail.com · Settings PAUSE = FALSE · sources: `metrics.json` (gtm.cli
17:30), Calls, Opportunities, Finance (empty), Customers (empty), `spot_check_sample.md`,
`decisions_metric.csv`, `log_notes.csv`, common Goals/Decisions/Risks/Settings.
Pace: 28 Nov - 8 Nov = 20 days = 2.9 weeks left.

---

WOULD SEND (Gmail, to aashmiin@gmail.com only):

```
To: aashmiin@gmail.com
Subject: Clearline weekly report 2026-11-08 - 1 spot-check error

BLUF: 0 paid and 0 offered after week 2. 2 Strong calls (Northwind, Kestrel) are the way to the
first 2 offers this week. The spot check found 1 factual error and 1 over-age first line, and couldn't
open 5 of 10 sources, so I don't recommend raising WEEK1_SPOTCHECK_PASSED. 2 approvals have waited
3 days.

1. STOP AND RISKS
- SPOT CHECK - FACTUAL ERROR: Quayside Shipping (L-0881) got "Congrats on Quayside's Series A in June
  2026"; its page says "US$3m seed round". Owner: research-intern (first line) / revops-crm-agent
  (guard). Stopped: nothing; already sent. You: nothing. I recommend no correction email (a second
  cold email makes it worse) and a guard rule: funding-round claims only when the source is opened
  that run. I've logged it to both.
- SPOT CHECK - OVER 12 MONTHS: Saffron Freight (L-0950) got a line from a March 2025 post (about 20
  months old when sent). It's true, but it breaks the 12-month rule. The guard check added on gtm-os
  this week should stop repeats [ASSUMPTION: not tested].
- SPOT CHECK - 5 OF 10 COULDN'T BE CHECKED (1 x 404, 4 timeouts). These count as "couldn't check", not passes.
- NUMBERS CONFLICT: calls booked 6 (gtm.cli) vs 5 in the Calls tab (4 held + 1 booked). Goals
  "Current (live)" is stale (16 first emails vs 118 in Touches). I report from the source tabs.

2. NUMBERS (gtm.cli metrics 17:30 unless stated; week-2 target not set on Goals tab / 30-day)
| Metric | Now | This week | 30-day target | Pace needed (2.9 weeks) |
|---|---|---|---|---|
| Paying pilots (Opportunities; Finance) | 0 | 0 | 5 | 1.75/week |
| Pilots offered (Opportunities) | 0 | 0 | 10 | 3.5/week |
| Strong calls (Calls) | 2 | 2 | 6 | 1.4/week |
| Calls held (Calls) | 4 | 4 | 15 | 3.9/week |
| Positive replies | 3 | not split | - | - |
| Replies | 5 (4.2% of 118) | 4 | 25 | 7.0/week |
| First emails sent (Touches) | 118 | 86 | 450 | 116/week |
| Cash collected (Finance) | US$0 (tab empty) | US$0 | US$1,500 | - |
| MRR committed (Customers) | not recorded (tab empty) | - | US$1,000 | - |
| Partner conversations / content | not in this run's sources | | 8 / 8 | |
Guardrails: bounce 7d 1.5%, all-time 1.7% (< 2%) · complaints 0 · emails 30d 214 / 1,000 · spot-check errors 1 (target 0).
Pace: behind on every funnel step. First emails ran 86 against 116 needed. Offers are the gap: 0 of 10.

3. SPOT CHECK (10 of 86 first emails this week, random draw)
Passed 3 · factual error 1 · over 12 months 1 · couldn't check 5. Rows written to the Spot checks tab.
- PASS: Coral Bay Traders, Polar Ledger, Vela Robotics.
- ERROR: Quayside Shipping (Series A vs seed). OVER-AGE: Saffron Freight (Mar 2025).
- COULDN'T CHECK: Dunmore Textiles (404), Anchor Point, Brisa Coffee, Ferrovia Parts, Lantern Studios (timeouts).
WEEK1_SPOTCHECK_PASSED: I don't recommend raising it (needs 0 errors; bounce < 2% and 0 complaints are
met). It stays FALSE; no reply needed.

4. PIPELINE (Opportunities, Calls)
- Northwind Remit - pilot discussion; next: offer the founding pilot at the follow-up, 13 Nov.
- Kestrel Pay - proposal drafted (USDC on Ethereum, QuickBooks); next: you review the draft, due 9 Nov. Not sent.
- Calls booked next week: Brightwater Pay, Wed 11 Nov.
- No next step: Mesa Digital (call 4 Nov, no notes, 4 days). Tidewater (Weak): next step "send
  one-pager". None stale over 7 days yet.

5. WHAT WE LEARNED
- What's working: too early (n = 3 positive replies, 4 calls). Logistics/freight 2 of 31 first emails
  got positive replies, fintech 1 of 40; that is too few to call a segment.
- The accounting question, by system (Calls tab, word for word):
  Xero 2: Northwind - "Someone exports the wallet history, matches it in a spreadsheet, then posts
  manual journals in Xero. Two days at month-end." Tidewater - "We don't receive stablecoins, so nothing
  goes into Xero from that side."
  QuickBooks 1: Kestrel - "We key them into QuickBooks every Friday; it takes about half a day."
  NetSuite 0 · other 0 · not recorded 1 (Mesa Digital, no notes).
- Left out on purpose (no source): a "~40 interested companies" [GUESS] note (research-analyst), a
  "~US$6,000 pipeline" estimate (sdr), and "logistics is clearly our best segment" (sdr; n = 3).

6. TEAM
- research-intern: 209 leads added in 7 days (gtm.cli); 1 factual error in a first line.
- revops-crm-agent: 86 first emails, bounce 1.5%, 0 complaints; 2 partner drafts waiting on you.
- sales-closer-assistant: 3 call summaries, Kestrel proposal draft; 1 call without notes (Mesa).
- crypto-protocol-engineer, qa-security-engineer, content-marketer, devops: not in this run's
  sources - couldn't check.

7. MY METRIC (decisions within 24 h, from the briefing maps)
- 2 of 10 within 24 h (20%; target ≥ 80%): the Northwind follow-up and the booking link.
- 3 were answered 24-25 h after first shown (Harbourline restart, #42 merge, secret rotation), i.e.
  the morning after the briefing. 2 took 2+ days (LinkedIn post 37 h, Tron 49 h). The advisor update took 4 days.
- Waiting > 24 h now: 2 - Lumen Exports pricing reply (first shown 5 Nov, 3.4 days) and partner drafts
  d-2201/d-2202 (5 Nov, 3.4 days).
- Briefing words above DETAILS (average): not recorded in this run's sources.
- Question for you: was the briefing read time this week ≤ 10 min? Reply y/n.

8. ADVISOR UPDATE (DRAFT - not sent) - Doc "Clearline advisor update 2026-11-08 (DRAFT)": <Doc link>
   Hi <name>,
   Week 2 of Clearline's founding-pilot push: 0 of 5 paid pilots targeted by 28 Nov, and no offers yet.
   118 first emails so far, 5 replies, 4 calls held, 2 with a strong problem.
   Both strong calls match stablecoin receipts by hand: one exports wallet history to a spreadsheet and
   posts manual journals in Xero (two days at month-end); the other keys them into QuickBooks every
   Friday (half a day).
   Missed: one of my first emails got a company's funding round wrong, so I'm tightening fact checks.
   This week: make the first two founding-pilot offers.
   One ask: do you know a finance lead at a company that receives USDT or USDC for invoices? A 15-minute
   intro would help.
   Aashmiin
   (No advisor's help on this kind of ask is on record, so you choose who gets it. Nothing here
   mentions customers, logos or automatic posting.)

9. DECISIONS
None new. 2 approvals waiting > 24 h, top of tomorrow's briefing:
1. [MONEY] Lumen Exports pricing reply - recommend: keep US$300/30 days (Decisions log 2026-10-29). WAITING 3d.
2. [SEND] Partner drafts d-2201/d-2202 - recommend yes after a skim. WAITING 3d.

Reply: "1 yes, 2 edit: ...", "y" for read time. HOLD = tomorrow's first emails only. PAUSE = everything.
```

## Spot checks rows (WOULD WRITE, Spot checks tab)
| date | lead_id | email_subject | checked_fact | source_url | factual_error | notes |
|---|---|---|---|---|---|---|
| 2026-11-08 | L-0931 | Quick question about stablecoin payments | Coral Bay now accepts USDC from Asian buyers for bulk seafood orders (14 Sep 2026) | https://coralbay.example.com/news/usdc | no | Page: "14 Sep 2026 - ... now accepts USDC from buyers in Asia for bulk seafood orders." Under 12 months. Fact is 14 words; 20 with the bracketed source. |
| 2026-11-08 | L-0953 | Quick question about stablecoin payments | Pricing page lists USDC as a payment option since October 2026 | https://polarledger.example.com/usdc | no | Page: "Pay in EUR or USDC (added October 2026)." 13 words. |
| 2026-11-08 | L-0881 | Quick question about stablecoin payments | Quayside's Series A in June 2026 | https://quayside.example.com/news/funding | yes | Page: "June 2026: Quayside Shipping closes US$3m seed round." Seed, not Series A. RISK logged; to research-intern + revops-crm-agent. |
| 2026-11-08 | L-0950 | Quick question about stablecoin payments | Saffron started taking USDC from Gulf clients (blog, March 2025) | https://saffronfreight.example.com/blog/crypto | no | True per page, but over 12 months old when sent (rule breach, not a factual error). |
| 2026-11-08 | L-0957 | Quick question about stablecoin payments | Payments page says overseas wholesale buyers can pay in USDT | https://dunmore.example.com/payments | couldn't check | 404 Not Found. Not a pass. |
| 2026-11-08 | L-0961 | Quick question about stablecoin payments | Invoicing FAQ (updated Aug 2026): clients can pay in USDC on Base or Ethereum | https://vela.example.com/crypto-invoices | no | Page matches. 16 words. |
| 2026-11-08 | L-0870 | Quick question about stablecoin payments | August 2026 newsletter: invoices Hong Kong buyers in USDT | https://anchorpoint.example.com/newsletter-aug | couldn't check | Timeout. |
| 2026-11-08 | L-0874 | Quick question about stablecoin payments | Wholesale page: roasters can pay in USDC | https://brisa.example.com/wholesale | couldn't check | Timeout. |
| 2026-11-08 | L-0899 | Quick question about stablecoin payments | 2026 annual note: USDT settlement with Asian suppliers | https://ferrovia.example.com/annual-2026 | couldn't check | Timeout. |
| 2026-11-08 | L-0905 | Quick question about stablecoin payments | Careers page: pays contractors in USDC | https://lantern.example.com/careers | couldn't check | Timeout. |
(The email_subject for the 4 leads outside the Approval Queue fixture is assumed to be the standard D0 subject [ASSUMPTION].)

## ACTIONS I WOULD TAKE
| # | Tool | Target | Content |
|---|---|---|---|
| 1 | Gmail (send) | aashmiin@gmail.com only | The weekly report above. |
| 2 | Google Docs (create in her Drive) | "Clearline advisor update 2026-11-08 (DRAFT)" | The advisor text above, with `<name>` left for her. No recipient. Not sent. |
| 3 | Sheets (append) | Spot checks | The 10 rows above. |
| 4 | Sheets (append) | Log | `... | chief-of-staff | RISK: spot check factual error | L-0881 | RISK: first line said "Series A", source says seed (https://quayside.example.com/news/funding). Also L-0950 first line from Mar 2025 (> 12 months). 5 of 10 couldn't check. - medium` |
| 5 | Sheets (append) | Log | `... | chief-of-staff | note | L-0881 | to: research-intern, revops-crm-agent: spot check 8 Nov: L-0881 factual error (Series A vs seed), L-0950 over 12 months. Please fix the first-line check; funding claims only from a source opened that run. Also: unsourced estimates (~40 interested, ~US$6,000 pipeline, "best segment" on n=3) were not used; please label or drop such notes.` |
| 6 | Sheets (append) | Risks | `First-line facts wrong or stale in sent emails | Medium [ASSUMPTION] | Medium: credibility with prospects | Guard 12-month check (gtm-os, this week); funding claims only from a source opened that run; weekly spot check; raised 2026-11-08, Log 17:4x | research-intern` |
| 7 | Sheets (write) | Goals & metrics "Current (live)" | First emails 118, Replies 5, Calls held 4, Strong 2, Pilots offered 0, Pilots paid 0, Cash 0, Bounce 1.5% (from gtm.cli/tabs); conflict noted in Log. |
| 8 | Sheets (append) | Log | `2026-11-08 17:4x | chief-of-staff | weekly report sent | | spot check 10 checked, 1 errors, 5 couldn't check (+1 over 12 months) | advisor draft <Doc link> | decisions within 24h 2/10 (20%); waiting >24h 2` |
| - | Not done | Settings WEEK1_SPOTCHECK_PASSED | Stays FALSE; not raised, and not even proposed (1 error). |

## Notes
- n < 10 is shown as counts. I did not use the employees' estimates (40 companies, US$6,000, "best segment"); I left them out and said why.
- Calls booked (gtm.cli 6 vs Calls tab 5) is named as a conflict, not resolved silently.
- The 24-h metric is computed from `decisions_metric.csv` timestamps: within 24 h are Northwind 12.7 h and D1 12.7 h. Over 24 h: post 36.7 h, Tron 48.7 h, Harbourline 24.7 h, #42 24.8 h, secret 24.4 h, advisor 97 h. Lumen and the partner drafts are still open.
- The advisor draft has honest zeros, one general ask, and no named recipient. Nothing was sent.
- Coral Bay's first line is 20 words including the bracketed citation and 14 words for the fact itself. I passed it and noted the length.
