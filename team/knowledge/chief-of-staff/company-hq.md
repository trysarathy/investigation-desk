# Company HQ (the Google Sheet)

Sheet id `1NhxrAIX-VfU2P43GbjYVtHk82LGpbRcwv6sVuNG6gdA`, title "Clearline Company HQ (GTM OS — Master)",
owner aashmiin@gmail.com. Headers below were **read live on 2026-10-29** [VERIFIED I1]. If a header has
changed when you run, trust the Sheet, log it, and fix this file. If the connection is a hatch.sg
account: STOP, change nothing, tell her.

The single source of truth (`team/MISSION.md`). GitLab's rule for KPIs fits every tab: name the
canonical source, and keep the formula next to the number [VERIFIED S8].

## Tabs
| Tab | What it's for | Who writes | Columns (live) | CoS reads/writes |
|---|---|---|---|---|
| Read me | Her quick guide | Her | free text | Read. **Stale:** still says 20 sends/day, 10 first emails; Settings say 75/50 |
| Goals & metrics | Strategy line, 30-day goal (to 28 Nov 2026: 5 paid pilots = US$1,500; 10 offered), metric table | CoS (current values; week targets after her OK) | Metric · Week N target · 30-day target · Current (live) · Owner agent · Where it comes from | R/W "Current", week targets on approval |
| Org chart | Who does what, schedule, status | CoS (status changes) | Employee · Mission · Weekly outputs · Tools · Schedule (SGT) · Metric owned · Aashmiin approves · Status | R/W status only, on recorded change |
| Settings | Switches: PAUSE, caps, HOLD_DATES, BOOKING_LINK, SEND_MODE, prices (PILOT_PRICE_USD 300, MONTHLY_PRICE_USD 200, FOUNDING_SLOTS 10, REVENUE_TARGET_30D_USD 1500) | Her; revops (HOLD_DATES); anyone (PAUSE→TRUE) | key · value | Read every run. Write only PAUSE→TRUE, add HOLD date, or a value she asked for in a reply |
| Leads | Email-ready leads | research-intern; revops (stage) | id, tier, score, stage, priority, company, domain, country, region, segment, buyer_or_vendor, website, evidence_url, contact_name, contact_role, email, email_label, linkedin_person, channel, first_line, first_line_source, first_line_date, compliance_note, check_before_sending, last_touch, next_action, next_action_date, notes | Read (pipeline) |
| Targets | Companies to research | research-intern | company, website, country, region, segment, tier, size_source, evidence_url, evidence_line, trigger, trigger_url, outreach_rule, day_added, status | Read |
| LinkedIn list | People she contacts by hand | research-intern; her (status) | day_added, name, role, company, country, linkedin_url, why_them (source), connection_note (<=280), followup_dm, status, date_sent, date_accepted, notes, tier | Read counts |
| Approval Queue | Emails waiting for her (first emails, sensitive replies) | revops-crm-agent | queue_date, lead_id, company, contact_name, email, step, subject, body, first_line_source, guard, guard_reasons, needs_approval, APPROVE (yes/no/edit), edited_body, status, queued_at, via | Read; write `APPROVE`/`edited_body` **only** to record her numbered reply |
| Touches | Every email | revops-crm-agent | date, lead_id, company, domain, email, channel, step, subject, status, thread_id, approved, notes, inbox | Read (metrics) |
| Calls | Calls booked/held, problem score, quotes | sales-closer-assistant (ae-assistant); her notes | date, lead_id, company, person, status, problem_score, pain_quotes, current_workaround, volume_per_month, next_step, notes_link | Read; Friday call notes → roadmap |
| Opportunities | Pilots offered → paid | sales-closer-assistant; finance | lead_id, company, stage, pilot_scope, started, next_step, next_step_date, notes, price_usd, offered_date, status (offered/accepted/invoiced/paid/declined), invoice_no, reason_in_their_words | Read (north star) |
| Customers | Paying customers | delivery-specialist (wk 3) | customer, contact, email, start_date, plan, status, networks, delivery_hours_this_month, xero_connected, month_end_report_sent, next_action, notes | Read |
| Product roadmap | Work orders for engineering | product-manager (wk 3) / CoS on Fridays until then; engineering (status) | item · why (revenue link) · status · PR / link · owner · target week · notes | Fri: add `proposed` rows, set `shipped` for merged; set `next` only on her recorded reply |
| Content calendar | Posts/pages | content-marketer | date, channel, title, angle, sources, status (idea/draft/approved/published), link, notes | Read |
| Partners | Accountants, auditors, Web3 services | revops-crm-agent | partner, type, country, contact, evidence url, status, referrals, intro via, next_action, notes | Read |
| Finance | Income and costs | finance job / finance-admin | date, item, type (income/cost), customer/vendor, amount_usd, invoice_no, status (invoiced/paid/overdue), method, notes | Read (cash) |
| Decisions log | What she decided and why | **CoS** (her replies); others propose `PENDING` | date · decision · why · decided by · revisit | R/W |
| Risks | Standing risks | **CoS**; anyone may add | risk · likelihood · impact · mitigation · owner | R/W |
| Log | One row per action, every employee | everyone | timestamp · agent · action · lead_id · details | Read all since last run; write own rows |
| Do-not-contact | Never email | revops | value, kind, reason, date | Never edit |
| Spot checks | Fact checks on sent first emails | CoS (Sunday) | date, lead_id, email_subject, checked_fact, source_url, factual_error, notes | Write Sunday |
| Dashboard | Formula view | formulas | Metric · Value | Read, but **verify** against source tabs (below) |

Status words for Product roadmap (from crypto-protocol-engineer's file): `proposed`, `needs decision`,
`todo`, `next`, `bug`, `building`, `PR open`, `in review`, `shipped`, `blocked`.

## Known data issues (29 Oct 2026) [VERIFIED I1]
1. **Dashboard vs Goals disagree:** Dashboard "First emails sent" = 0; Goals "Current (live)" = 16.
   Rule: recompute from Touches (step D0, status sent/replied/bounced) and report that, naming the
   mismatch, until it's fixed. Never pick one silently.
2. Settings has `MASTER_REPO` twice (clearline-gtm and closetrace branch gtm); the Decisions log
   (2026-10-29) says GTM code is on closetrace `gtm` because clearline-gtm isn't reachable;
   `company/COMPANY_RULES.md` says `gtm-os` of investigation-desk. Flag as a cleanup decision.
3. Read me is stale on caps (see above).
4. Decisions log has no `options` column and Risks has no `date`/`status`/`review` column: formats below
   fit them into the existing columns. Adding columns is her call (propose once, as a decision).

## Approval queue mechanics (two layers)
1. **The Approval Queue tab** holds *emails only* (revops-crm-agent's rows). In LEAN MODE week 1, the
   next sending day's first emails are queued the evening before (queue_date = tomorrow, status
   `queued`) and **go out from 9:00 recipient time unless she replies HOLD** to the evening email.
   Sensitive replies (pricing, legal, complaints, mentors, warm network) sit here as drafts with
   `needs_approval` = yes until she says yes [VERIFIED I2].
2. **The briefing's approval list** is wider: it numbers every item waiting for her from all sources:
   `[MERGE]` PRs (QA status), `[SEND]` Gmail drafts to prospects/partners, `[MONEY]` prices, discounts,
   proposals, invoices, `[MENTOR]` advisor/investor drafts, `[POST]` content, `[SETTING]` caps/autonomy/
   paid tools, `[ROADMAP]` `proposed`→`next`, `[DATA]` deletions.
- **Numbering:** 1..n each briefing; the Log row for the briefing stores the map
  `1=<type>:<id/link>; 2=...` and each item's first-shown date, so her reply "1 yes, 2 no, 3 edit: X"
  is unambiguous next morning even if the list changed.
- **Recording:** for each answered item: a Decisions log row (decision text, her words quoted in "why"
  with the reply time, decided by "Aashmiin (email reply HH:MM)"), then the action: Approval Queue
  `APPROVE`=yes/no/edit (+ `edited_body`), roadmap status, or a Log note `to: <employee>`. Merges stay
  hers on GitHub; you never merge.
- **Age:** age = now - first-shown. > 24 h → item moves to the top of approvals marked `WAITING 2d`;
  > 7 days → named with its owner and a recommendation to drop or decide.

## HOLD and PAUSE
| Word | Scope | Who acts | What you do |
|---|---|---|---|
| `HOLD` (reply to the evening summary / end-of-day) | Only the next sending day's queued **first emails** | revops-crm-agent adds the date to `HOLD_DATES`, sets rows `hold` | If revops hasn't, add the date to `HOLD_DATES` (safety direction), log it, and confirm in the briefing; never change the row bodies |
| `PAUSE` (reply to any Clearline email, or Settings PAUSE = TRUE) | **Everything**: no email, no PRs, no Sheet edits except one Log row | whoever sees it first sets PAUSE = TRUE | Set PAUSE = TRUE if not set; one Log row; the briefing still goes (to her only) with `PAUSE ON` at the top; record nothing else; say how to restart: she sets Settings PAUSE = FALSE herself |
PAUSE detection: search `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d`
for "PAUSE". If PAUSE is FALSE but such a reply exists, check the Log: if a row shows PAUSE was set TRUE
after that reply and it is FALSE now, she restarted - do not re-pause; otherwise set it TRUE.
"Pause" inside a normal sentence ("pause the Tron work") is a scoped instruction, not the kill switch:
treat the unambiguous word `PAUSE` alone or in caps as the kill switch; if unclear, set PAUSE = TRUE
(safe side) and ask her in the briefing.

## Decisions log format (existing columns)
| date | decision | why | decided by | revisit |
|---|---|---|---|---|
| 2026-11-05 | D1: Keep founding pilot at US$300 for Lumen Exports; offer a smaller scope, not a discount | Options: A discount to US$150, B hold price + narrower scope, C decline. Her reply 07:51: "D1 B". Rationale: price decided 29 Oct, revisit after 5 offers | Aashmiin (email reply 07:51) | After 5 offers |
Pending items: decision text starts `PENDING:` and "decided by" says who is waiting. Approvals get rows
too ("Approved #3: send follow-up draft to Northwind"), so the 24-hour metric can be computed.

## Risks format (existing columns)
| risk | likelihood | impact | mitigation | owner |
|---|---|---|---|---|
Write likelihood/impact as `Low/Medium/High` + a label `[ASSUMPTION]`/`[GUESS]`; put the date raised and
the Log row link at the end of the mitigation cell (`raised 2026-11-05, Log 07:12`). Close a risk by
appending `CLOSED <date>: <why>` to the mitigation, never by deleting the row. New standing risks come from
repeated `RISK:` rows, regulation items from research-intern, or a decision she makes.

## Log row format (yours)
`timestamp SGT | chief-of-staff | <action> | <lead_id or blank> | <details with links>`; actions:
`briefing sent`, `end-of-day sent`, `week plan sent`, `ship review sent`, `weekly report sent`,
`monthly draft created`, `decision recorded`, `dispatched`, `PAUSE set TRUE`, `HOLD date added`, `RISK: ...`.
