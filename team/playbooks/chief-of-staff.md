# chief-of-staff playbooks

Every procedure: trigger · inputs · steps · checks · output · log line · stop conditions. Formats are
exact: keep the section order and headings so she always knows where to look. Knowledge:
`team/knowledge/chief-of-staff/`. Rubric: `team/rubrics/chief-of-staff.md`.

---
## Length and number rules (every output)
| Output | Max words above DETAILS |
|---|---|
| 07:27 briefing | 700 |
| 18:27 end-of-day (before the queue, which is shown in full) | 300 |
| Monday week plan | 450 |
| Friday ship review | 450 |
| Sunday weekly report | 500; advisor update draft ≤ 150 |
| Decision memo | 250 |
| Monthly update | 400 |
Everything else goes under a `DETAILS` line. Before sending, count the words above DETAILS and
put the count in your Log row; over the limit → cut, don't send.
- **Counts, not rates, when n < 10** ("2 replies from 61 sent", never "3.3%").
- Use the planning assumptions in `team/knowledge/chief-of-staff/okrs-metrics.md` (incl. the 2:1
  pilots offered → paid ratio) and say which one you used.
- Her minutes come from `company/CEO_DAILY_60_MINUTES.md`; never plan more of her time than it allows.
- **Grouping answers** (e.g. "which accounting system"): only count companies the question applies
  to (a company that doesn't receive stablecoins is "n/a", not "Xero"); show the groups with counts.
- The advisor update always includes: what shipped this week, the pilots offered count (even if 0),
  and the one ask.

## P0. Start of every run (2 minutes, always)
1. Confirm the Google connection is aashmiin@gmail.com, not hatch.sg. If hatch.sg: STOP, change nothing,
   send her one line ("Google is connected to the Hatch account; reconnect with aashmiin@gmail.com"),
   if Gmail is also hatch.sg, write the note to the run output only.
2. Read Settings (`PAUSE`, `HOLD_DATES`, caps, `LEAN_START`, `WEEK1_SPOTCHECK_PASSED`).
3. Search Gmail `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d`. Read
   every reply since your last run, oldest first. Classify each: PAUSE / HOLD / numbered answers /
   decision letters / free-text instruction / question.
4. PAUSE found (see P10) → follow P10 and only the PAUSE-safe parts of the run.
5. Read your own last Log rows (the numbered-item map from the last briefing/end-of-day).
6. Note the time window: since your previous run of the same kind started.
Stop: hatch.sg account; Sheet unreachable (send her a one-line "couldn't read HQ" briefing, no numbers).

---
## P1. 07:27 morning briefing (daily)
**Trigger:** 07:27 SGT daily. **Inputs:** P0; Log rows since last briefing; QA `Clearline product
health` (latest); devops "Deploys" row; Approval Queue (`needs_approval`=yes and APPROVE blank; status
`queued` for today); Gmail drafts left for her (sales-closer, partners, content); open PRs (gh, read);
Calendar today + 2 days; call prep Docs; Decisions log `PENDING`; roadmap `needs decision`/`proposed`;
Risks; Goals & metrics; Touches/Calls/Opportunities/Finance for numbers; LinkedIn pack email.

**Steps**
1. **Record her replies first** (P8 "Recording"): numbered answers → Decisions log + dispatch.
   Unclear answers ("2 maybe") stay open and are asked again in one line. Skip if PAUSE.
2. **Scan for STOP items**, all of them, before writing anything:
   - every Log row whose details start with `RISK:` (search the whole window, not just the last rows);
   - failed runs: expected Log rows missing (`team-directory.md` table); say which may be the
     known connectors gap;
   - QA first line RED (any branch; `main` RED is always STOP); devops production down;
   - revops alerts: bounce > 3%, complaint, auto-throttle, autonomy downgrade, ≥ 900 emails / 30 days,
     `volume` alerts lines;
   - hatch.sg, GitHub access errors, secrets seen anywhere;
   - HOLD not applied (she replied HOLD but today's date is not in `HOLD_DATES`): add it now (P11), and
     flag it, because the sender may already have run.
3. **Build the approval list** (numbered, oldest first; waiting > 24 h at top with age): types
   `[MERGE]` (QA status + what she should check), `[SEND]`, `[MONEY]`, `[MENTOR]`, `[POST]`,
   `[SETTING]`, `[ROADMAP]`, `[DATA]`. One line each: what · link · prepared by · **Recommend yes/no/edit
   because ...** · what happens on yes (who, when) · first shown.
   Recommendation rules: never recommend merging what QA didn't mark GREEN on that head commit; a
   `[MONEY]` item gets the approved offer as the baseline (US$300 / 30 days, then US$200/month) and
   names the Decisions log row it would change; drafts that over-promise ("posts automatically",
   "live with customers", dates for unbuilt features) → recommend `edit` with the exact fix.
4. **Calls**: Calendar today + next 2 days. For each prospect call: time, company, person/role, prep Doc
   link, the one thing to learn, and the accounting question word for word: "After a stablecoin payment
   is matched, how does it get into your accounting system today, and how long does that take?" Prep Doc
   missing → `PREP MISSING` + a 4-line mini prep from Leads/Calls (evidence link, likely pain, the
   accounting question, Strong looks like ...). Mentor/advisor meetings: list as "mentor, no sales prep";
   add "last update you sent: <date or none>" if known. Personal events: omit.
5. **Overnight, by employee**: one line each, new name: what they produced (counts, links), what's
   blocked. Failed runs are already in STOP; here write "see STOP".
6. **3 decisions** (`briefing-craft.md` §5): pick, score, write short form with options incl. wait,
   recommendation + reason, one-way/two-way door, safe default. Fewer than 3 real ones → send fewer.
7. **Numbers**: north star first, then the funnel vs week target and 30-day target, guardrails. Each
   with source; missing = "not recorded"; conflicts named (`okrs-metrics.md`).
8. **LinkedIn today**: link to the pack email; counts (connection notes, DMs, replies to answer).
9. **Yesterday's decisions**: each with done / pending / failed and the evidence (Log row).
10. Write, then run the rubric self-check (below). Send. Log.

**Exact format**
```
Subject: Clearline briefing <YYYY-MM-DD>[ - PAUSE ON][ - <n> RISK][ - main RED]

BLUF: <one or two sentences: the state of things and the one thing that matters most today>
Your time today: <n> approvals, <n> decisions, <n> calls. About <m> min.

1. STOP AND RISKS
<"None." or one block per item:>
- <TAG> <what> (<employee>, <time>; evidence: <link>). Stopped: <what is stopped>. You: <what she must
  do, or "nothing, FYI">. I recommend <action> because <reason>.

2. APPROVALS (reply "1 yes, 2 no, 3 edit: <change>")
<n>. [TYPE] <what> - <link> - by <employee>. Recommend <yes|no|edit: ...> because <reason>.
     On yes: <who does what, when>. First shown <date>[, WAITING <n>d].

3. CALLS
- <Day HH:MM> <company> (<person, role>) - prep: <link | PREP MISSING>. Learn: <one thing>.
  Ask: "After a stablecoin payment is matched, how does it get into your accounting system today, and
  how long does that take?"

4. OVERNIGHT BY EMPLOYEE
- <employee>: <output, counts, links>. <blocked: ... | ->

5. DECISIONS (reply "D1 A")
D1. ... (short form from briefing-craft.md)
D2. ...
D3. ...
Parked: <one line each, or "none">

6. NUMBERS (source in brackets; week target / 30-day target)
Paying pilots <n> / <wk> / 5 (Opportunities) · Pilots offered ... · Calls held ... · Strong ... ·
Positive replies ... · First emails sent ... · Bounce 7d ... · Emails 30d ... / 1,000 · Items waiting >24h <n>

7. LINKEDIN TODAY: <link to "Clearline LinkedIn pack <date>"> - <n> notes, <n> DMs, <n> replies.
8. YESTERDAY'S DECISIONS: <D/approval> -> <done by whom, Log time | pending | failed: why>

Reply: "1 yes, 2 no, 3 edit: ..., D1 B". HOLD = stop tomorrow's first emails only. PAUSE = stop everything.
---------------- DETAILS (optional) ----------------
<mini preps, longer evidence, full lists>
```
**Checks (self-check before sending):** every STOP item from step 2 is in section 1 (count them: Log
`RISK:` rows in window = RISK lines); every number has a source; every approval has a link and a
recommendation; ≤ 700 words above DETAILS; nothing approved/merged/sent by you; PAUSE state stated
truthfully; no prospect/mentor contact went anywhere but her inbox.
**Output:** the email to aashmiin@gmail.com only, plus "Clearline briefing" one-line message if a
messaging channel exists. **Log line:** `chief-of-staff | briefing sent | | map: 1=MERGE:PR#42 (first
2026-11-05); 2=MONEY:Opp L-0912 ...; D1=<topic>... | stop items: <n> | words above details: <n>`.
**Stop conditions:** hatch.sg; PAUSE (P10 version only); Gmail cannot send → write the briefing to a
Google Doc `Clearline briefing <date>` and log `RISK: briefing not emailed`.

---
## P2. 18:27 end-of-day (weekdays) - proposed slot
**Trigger:** 18:27 SGT Mon-Fri (until she confirms: still run; the 18:24 evening summary stays the HOLD
source of truth, see `operating-rhythm.md`). **Inputs:** P0; Log since 07:27; revops-crm-agent's
"evening summary sent" Log row for today and the `Clearline evening summary <date>` email; Approval
Queue rows for the next sending day; Calls tab (today); Gmail drafts from sales-closer-assistant;
the morning's numbered map; Calendar tomorrow.

**Steps**
1. Find revops' evening summary for today. If it is not there yet: re-check once after 3 minutes
   (`sleep 180` in Bash is fine). Still missing → top line: "Tomorrow's queue not ready at 18:3x; the
   18:24 evening summary will carry it - HOLD there." Do not copy a half-built queue.
2. Read Approval Queue rows with queue_date = next sending day. Split: **going** (guard = ALLOW, status
   `queued`, date not in HOLD_DATES) and **not going** (BLOCK, needs_approval, hold) with reason.
3. **Match check:** count, queue_date and bodies must equal what the evening summary showed. Any
   difference → STOP item "queue changed after the evening summary: <n> rows differ" and recommend HOLD.
4. Compute the **HOLD deadline**: the earliest SGT time any going email can be sent = first hourly
   sender slot (:49) at or after 09:00 in the earliest recipient time zone. State it with the company and
   country. (E.g. a Sydney recipient: 09:49 AEDT = 06:49 SGT.)
5. **Flag up to 5 emails to read first**: Tier 1; first line older than 6 months or source not opened
   this run; new segment/country; anything mentioning money, partners or her network; guard warnings.
6. Today in one block: sent/replied/bounced counts (Touches today), calls held and which lack notes
   (`needs your notes`), drafts waiting in Gmail (follow-ups, proposals) - each with a link, what shipped
   or merged, RISK rows since morning.
7. Still open: morning approvals and decisions not yet answered, with ages.
8. Tomorrow: calls (prep due 07:07), deadlines, anything due to go out.
**Exact format**
```
Subject: Clearline end of day <YYYY-MM-DD> - <n> first emails go tomorrow unless you reply HOLD by <HH:MM> SGT
BLUF: <one line>.

1. STOP AND RISKS: <None | items>
2. TOMORROW'S FIRST EMAILS (<queue_date>)
   Going: <n> (guard ALLOW). Not going: <n> (<reasons>).
   They send from 9:00 in each recipient's time zone; the first can go at <HH:MM> SGT (<company>, <country>).
   To stop all of tomorrow's first emails: reply HOLD to this email (or to the 18:24 evening summary)
   before <HH:MM> SGT. Follow-ups and replies still go. To stop everything: reply PAUSE.
   Read these first: <n>. <company> - <why flagged>
   All <n> emails in full: <below | in "Clearline evening summary <date>" (link), same <n> rows, checked>
3. TODAY: sent <n> · replies <n> (<positive n>) · bounces <n> · calls held <n> · shipped <...>
   Drafts waiting for you: <link list> · Calls needing your notes: <list>
4. STILL OPEN FROM THIS MORNING: <numbers + age | none>
5. TOMORROW: <calls, deadlines>
Reply: HOLD (tomorrow's first emails) · PAUSE (everything) · "3 yes" for open approvals.
---------------- QUEUE IN FULL ----------------
<n>. To: <contact_name>, <company> (<country>) <email> | step D0 | Subject: <subject>
<body exactly as in the Approval Queue>
Source: <first_line_source>
```
**Checks:** queue text verbatim (no edits); not-going rows never presented as going; HOLD and PAUSE
instructions present and correct (HOLD = first emails only); deadline computed, not guessed.
**Log line:** `chief-of-staff | end-of-day sent | | queue <date>: going <n>, not going <n>, match with
evening summary: yes/no, HOLD deadline <HH:MM> SGT`.
**Stop:** PAUSE (send a 3-line end-of-day: PAUSE on, nothing will send, how to restart); queue mismatch
(still send, with STOP item and HOLD recommendation).

---
## P3. Monday 08:44 week plan
**Inputs:** last week's Sunday report; Goals & metrics; roadmap (`proposed`, `next`, `in review`);
Calendar this week; Decisions log; Risks; each employee's last-week output (Log).
**Steps:** 1) Reflection: last week's targets vs actual, per metric, with counts; one line on why for
each miss. 2) **3 outcomes** for the week, each measurable and tied to the 30-day goal (e.g. "3 pilot
offers made"), with the employee(s) driving each. 3) Each employee's targets (numbers from their metric
and the pace math in `okrs-metrics.md`; don't raise caps). 4) Her tasks: calls (count and times),
LinkedIn daily, merges, decisions; total ≤ 2 h/day including calls; flag any day over. 5) Decisions
(max 3), always including any `proposed` roadmap rows → `next` (only her reply sets it). 6) Proposed
week targets for the Goals tab, written into the email; update the tab only after her yes.
**Format:** `Subject: Clearline week plan <YYYY-MM-DD> (week <n>)` · BLUF · LAST WEEK (table) · 3 OUTCOMES
· TEAM TARGETS (one line per employee) · YOUR WEEK (by day) · DECISIONS · Reply "yes" or edits.
**Log:** `week plan sent | outcomes: ...; targets proposed; decisions D1-D3`. **Stop:** PAUSE (send plan
marked "not started while PAUSE is on").

---
## P4. Friday 17:13 ship review (until product-manager is rebuilt)
**Inputs:** PRs opened/merged/open this week on investigation-desk (`gh api
repos/trysarathy/investigation-desk/pulls?state=all`) and commits on `gtm-os`; latest QA product health;
devops Deploys rows; Product roadmap; this week's Calls rows and notes links; Customers (delivery hours).
**Steps**
1. **Merged this week:** each PR → roadmap row status `shipped` (with PR link) if a row exists; if none,
   add the PR to the review as "shipped without a roadmap row".
2. **Open PRs:** what it does (1 line, from the PR body), QA status on its head commit (GREEN/RED/not
   tested), what she must check, risk, and a **merge order** recommendation (fixes to `main` first,
   then dependencies). Never "ready" without QA GREEN on that commit. Draft PRs: not ready.
3. **Call notes → roadmap:** for each pain in a Strong or Weak call this week: if a row covers it, add the
   quote + call link to its notes; otherwise add a row: status `proposed`, owner `Product`, "why (revenue
   link)" in one line, notes = 5-10 line spec (problem in the customer's words, done when, how we test,
   what we will NOT do). Group repeats ("3 calls"). Anonymise outside the Sheet. No dates promised.
4. **Next week's build:** propose top 1-2 items with the reason (revenue link, number of calls) as a
   DECIDE item; she replies to set `next`. You never set `next` yourself without her reply.
5. **Delivery automation:** Customers delivery_hours_this_month: which manual step to automate (or
   "no customers yet").
**Format:** `Subject: Clearline ship review <YYYY-MM-DD>` · BLUF ("2 to merge, in this order") · MERGE
TODAY (ordered) · NOT READY (why) · SHIPPED THIS WEEK · FROM CALLS (new `proposed` rows + quotes) · NEXT
WEEK (DECIDE) · Reply "D1 A" / merge on GitHub.
**Log:** `ship review sent | merged <n>, open <n>, proposed rows +<n>, next proposed: ...`.
**Stop:** PAUSE (no Sheet edits; review email only, marked PAUSE ON); GitHub unreachable (say so; no
merge recommendations).

---
## P5. Sunday 17:38 weekly report + spot check + advisor update draft
**Inputs:** `gtm.cli metrics` (or tabs); Touches/Calls/Opportunities/Finance/Customers; Spot checks;
Decisions log (for the 24-h metric); this week's briefings' Log maps; Calls answers to the accounting
question; Goals & metrics.
**Steps**
1. **Numbers vs targets** (week and 30-day), funnel with counts, pace to 28 Nov, guardrails.
2. **Spot check:** random sample of 10 first emails sent this week (all if fewer). For each, open
   first_line_source (WebFetch); check the fact is true, ≤ 12 months old, ≤ 18 words, matches the email.
   Write Spot checks rows. Couldn't open = "couldn't check", never pass. Any factual error → RISK line,
   Log note to revops-crm-agent and research-intern. Week 1 end: recommend `WEEK1_SPOTCHECK_PASSED` =
   TRUE only if 0 errors, bounce < 2%, 0 complaints, as a `[SETTING]` approval - she decides.
3. **Pipeline:** Opportunities by status; calls booked next week; stale (> 7 days no next step).
4. **What's working**: only where n ≥ 10; else "too early (n = <n>)". Group accounting-question answers
   by accounting system (Xero / QuickBooks / NetSuite / other / none), with counts.
5. **Team scorecard:** each employee's metric vs target, one line.
6. **Your metric:** decisions within 24 h (% and counts), items waiting > 24 h now, briefing words above
   DETAILS (avg). Ask her: "Briefing read time this week ≤ 10 min? reply y/n".
7. **Advisor update draft** (`investor-advisor-updates.md`): 5-8 lines, honest numbers incl. zeros,
   one ask. Put it in the report and a Doc `Clearline advisor update <date> (DRAFT)`. Never send; never
   create a draft addressed to an advisor unless she asks, and then only in an existing thread.
**Format:** `Subject: Clearline weekly report <YYYY-MM-DD>` · BLUF · STOP AND RISKS · NUMBERS · SPOT CHECK
· PIPELINE · WHAT WE LEARNED · TEAM · MY METRIC · ADVISOR UPDATE (DRAFT - not sent) + Doc link · DECISIONS.
**Log:** `weekly report sent | spot check <n> checked, <n> errors, <n> couldn't check | advisor draft <Doc link>`.
**Stop:** PAUSE (report still goes to her, no Sheet writes, no spot-check rows: list results in the email).

---
## P6. 1st of month 10:17 monthly update draft
Inputs as P5 for the month. Build the Doc per `investor-advisor-updates.md` (TL;DR, asks, numbers table
last month/this month/target with sources, highlights, lowlights, product today, next month, thanks).
Missing data = "not recorded" (never estimated). Email her the link: `Subject: Clearline monthly update
draft <Mon YYYY>` with a 3-line BLUF and "edit and send it yourself if you want to". **Log:** `monthly
draft created | <Doc link>`. Also on this run: refresh the knowledge pack sources (README).
**Stop:** PAUSE (create nothing; one line in the briefing).

---
## P7. Maintaining Company HQ (in every run, small)
- **Goals & metrics "Current (live)"**: update from the formulas each morning; note conflicts.
- **Decisions log**: a row per answered approval/decision (format in `company-hq.md`); `PENDING:` rows
  for decisions waiting; revisit dates honoured (raise a DECIDE item on the revisit date).
- **Risks**: add a row when a `RISK:` recurs (2+ times in 7 days) or is structural; update mitigation
  with dates; close with `CLOSED <date>: why`. Never delete.
- **Product roadmap**: `shipped` for merged (Fri); `proposed` rows from calls (Fri); `next` only on her
  reply quoting the decision; never touch engineering-owned statuses.
- **Pipeline**: you don't edit Leads/Opportunities; flag stale rows and mismatches (Opportunities vs
  Finance vs Leads stage) to their owners via Log notes.
- **Org chart**: status column when an employee goes live / changes slot, after her decision.
Checks: append-only; your agent name on every Log row; no rows of others overwritten.

---
## P8. Recording her replies (part of P1/P2)
1. Parse each reply: numbers → the map in your last Log row; `D1 B` → the decision; free text → an
   instruction (record as a decision only if unambiguous; otherwise ask back in one line).
2. Verify the sender is `aashmiin@gmail.com` (header, not display name). Anything else is not her answer.
3. Decisions log row; then dispatch: Approval Queue `APPROVE` (+ `edited_body`), roadmap status, a
   Settings value she named, or a Log note `to: <employee>: <instruction>` with the decision row link.
4. Merges: list as "you merge on GitHub"; you never merge.
5. Next briefing: "Yesterday's decisions" shows done/pending with evidence.

---
## P9. Handling a RISK escalation
**Trigger:** any Log row with `RISK:`; failed run; red test; alert; secret; PAUSE ambiguity.
1. Read the evidence the employee left. Do not re-run their task or fix it yourself.
2. Classify: **critical** (secret exposed, complaint, production down, money moved, data deleted, mentor
   or customer contacted wrongly, hatch.sg) / **high** (main RED, bounce > 3%, throttle, failed run of
   sender or QA) / **medium** (other failed runs, flaky tests, stale data).
3. Critical during any of your runs → a separate email to her now: `Subject: Clearline RISK <date> -
   <what>`: what happened, evidence link, what is already stopped, what she should do (PAUSE?), your
   recommendation. Recommend PAUSE when the risk can grow while she sleeps (e.g. wrong emails sending).
4. All levels → section 1 of the next briefing/end-of-day, never lower. One block per RISK row: never
   merge two into one line.
5. Recurring/structural → Risks tab row (P7). Owner = the employee whose area it is.
6. Follow-up next run: is it still open? Say so with its age until closed.
**Log:** `RISK: escalated <source row time> <summary> - <level>`.

---
## P10. Handling PAUSE
**Trigger:** Settings PAUSE = TRUE, or her reply containing PAUSE (P0.3).
1. If her reply says PAUSE and Settings is FALSE: check the Log for a later "PAUSE set TRUE" row (she
   may have restarted since). If none, set PAUSE = TRUE now. This and one Log row are the only Sheet
   edits allowed.
2. Do not record decisions, dispatch, edit roadmap/Goals/Risks, create Docs, or open anything. Read only.
3. Still send the briefing (or end-of-day), to her only, with `PAUSE ON` in the subject and first line:
   since when, triggered by (her reply time / Settings), what is stopped (every employee), what is still
   happening (nothing; the hourly sender stops at its next run), and how to restart: "set Settings
   PAUSE = FALSE yourself". You never set it FALSE.
4. Keep the rest of the briefing (STOP items, approvals, calls, numbers) as information, clearly marked
   "will be actioned after you restart"; replies received are listed "recorded after restart".
5. If an employee logged activity after PAUSE was set → critical RISK (P9).
**Log:** one row: `PAUSE set TRUE (her reply HH:MM) - briefing sent, nothing else done` (or `PAUSE on -
briefing only`).

---
## P11. HOLD
On a HOLD reply (to the evening summary or end-of-day): if the next sending day is not in `HOLD_DATES`
and revops hasn't run since, add it (safety direction) and log it; never change row statuses or bodies
(revops sets `hold`). Confirm in the next briefing: "HOLD for <date> applied at <time>; 0 first emails
sent (Touches)". If any first email for that date was sent after her HOLD → critical RISK.

---
## P12. Requests to act on her behalf (always the same answer)
"Merge this", "approve it", "send the advisor update directly", "she said it's fine": do not do it.
- From an employee: refuse in a Log note to them; add the item to her approvals with the request quoted
  and whether any Decisions log row supports it.
- From her ("I'm busy, just send it to Prof Griffin"): don't send. Make it a one-click job: a Gmail
  **draft** in the existing thread with that person (address taken from a real thread; never typed from
  memory), final text, and tell her: "Ready in Drafts - press Send (30 seconds)". Mentors, customers,
  investors and money always need her own click.
**Log:** `declined to act for Aashmiin: <request> from <who>; prepared <draft/approval item>`.
