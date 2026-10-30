# revops-crm-agent playbooks

Every playbook starts with **P0**. All times SGT. "Guard" = `python3 -m gtm.cli guard --dir work
--candidates work/queue.csv --today <send date> [--now <UTC ISO>]` from a `gtm-os` checkout. RULES.md
(LEAN MODE first) wins over anything here.

---

## P0. Pre-flight (every run, before anything else)
1. Read COMPANY_RULES.md, RULES.md (gtm-os), the digest. Confirm the Google connection is
   aashmiin@gmail.com, not hatch.sg (else STOP, Log `RISK: hatch account`, nothing else).
2. Read Settings. Search Gmail `from:aashmiin@gmail.com subject:Clearline newer_than:3d`. A reply
   containing **PAUSE** → set Settings PAUSE = TRUE. A reply containing **HOLD** to an evening summary →
   add the next send date to HOLD_DATES and set those queue rows to `hold`.
3. **PAUSE = TRUE → stop.** Write one Log row (`PAUSE on: <task> skipped`) and nothing else: no email, no
   draft, no Sheet edit, no Calendar change. Report only if this run is one that reports to her.
4. Get the code: `git fetch origin gtm-os` and check out (or `git archive`) into a scratch dir; run
   `python3 -m unittest` once a day; if red → `RISK: guard tests failing`, treat every email as needing
   approval, send nothing automatically.
5. Export Settings, Leads, Touches, Do-not-contact, Spot checks, Calls to `work/*.csv` (columns exactly as
   the Sheet; `settings.csv` = `key,value`). Run `python3 -m gtm.cli volume --dir work --today <date>`. Every
   `alerts` line goes to the TOP of whatever you report.
6. Stop conditions for any run: guard unreachable (hand rules + approval for all), Gmail error/limit
   message, a secret seen anywhere, data that contradicts itself (e.g. a lead both DNC and In sequence).
   Stop that task, Log `RISK: ...` with evidence, carry on with tasks that don't depend on it.

---

**Pre-guard checklist (logged, every queue build, until `gtm/guard.py` covers these):** before the
guard, check each candidate by hand and log one line per BLOCK: (1) not a mentor, SMU staff,
investor or warm contact (names in COMPANY_RULES rule 6, including Dr Catalin Burlacu); (2) tier
1 or 2 only, never tier 3, never a vendor; (3) first line's source dated within 12 months and
re-opened today. The guard does not check these yet.

**Legal questions:** never assert anyone's legal rights in a note, draft or reply ("he has a right
to…"). "How did you get my email?" → answer only from `compliance.md`'s approved wording (public
source + opt-out), and put any legal point to Aashmiin as a question. **Logs:** every Log row has
a real SGT timestamp and a link; simulated or replayed runs keep events in time order.

## P1. Evening queue build + summary (weekdays 18:24, for the next sending weekday)
**Trigger:** schedule. **Inputs:** work/*.csv, LinkedIn list, Approval Queue, Opportunities, Calendar.
1. Close today: run P3 (reply triage) for anything unprocessed, P9 (bounces/unsubscribes), CRM hygiene
   checks (`crm-hygiene.md` end). 
2. Capacity: `cap_today` for tomorrow from `volume` (`--today <tomorrow>`), minus follow-ups due tomorrow
   (P4 list) and a reply reserve = the number of REPLY rows sent yesterday, minimum 3, maximum 10 (state the number you used) = room for first emails; never above FIRST_EMAIL_CAP.
3. Candidate pool: Leads with stage Researched/Approved, BUYER, Tier 1/2, email_label VERIFIED-*, no
   Touches. Sort by tier, score, priority.
4. **Pre-guard exclusions (the guard misses these):** mentors / SMU staff / investors / warm network /
   QRE-QCDAO (→ DNC with reason "mentor/network: never cold email", tell her); Tier 3 or VENDOR; first_line
   older than 12 months or > 18 words or source not re-openable today (→ research-intern, `next_action`
   "refresh first line"); language-flagged leads (JP/KR → her); second person at a company already in the
   batch (keep the role closest to incoming payments; other gets `next_action_date` ≥ first send + 7).
5. For each remaining lead: **re-open `first_line_source`** (WebFetch). Still true? Same words? If not,
   drop it and say why. Write the question + close (`cold-email-craft.md`), render the body with
   `gtm.lean.first_email`, subject "Quick question about stablecoin payments".
6. Write work/queue.csv: D0 rows (`queue_date` = tomorrow, `queued_at` = today, status `queued`) + D4/D11
   due tomorrow (with `thread_id`). Run the guard with `--today <tomorrow>` (no `--now` at queue time).
7. Keep only ALLOW rows. Copy guard/guard_reasons to the Approval Queue for **all** rows (blocked rows
   stay with status `blocked` and the reason, so she sees them).
8. Evening summary email to aashmiin@gmail.com, subject `Clearline evening summary <date>`:
   alerts first; the unified daily view (P11); "Tomorrow's first emails (N), reply HOLD to stop them" with
   **every email in full** (to, company, first line + source link, body); follow-ups due (count + names);
   blocked/excluded with one-line reasons; drafts waiting for her. Week 1: they go unless she replies HOLD.
9. **Checks:** count of D0 ≤ room; every D0 has source URL opened today; no excluded class in the batch; no
   body differs from `lean.first_email` except the three slots.
**Log:** `evening queue: N D0 + M follow-ups queued for <date>; X blocked (reasons); Y excluded pre-guard`.
**Stop:** PAUSE; guard error; < 1 sendable lead (send the summary saying so; never pad).

## P2. Hourly send cycle (every hour at :49)
1. P0. Then P3 for new replies (replies are served first).
2. Build work/queue.csv from: approved REPLY rows (with thread_id), follow-ups due today, today's queued D0
   rows (status `queued`, not `hold`, and today not in HOLD_DATES).
3. Run the guard with `--today <today> --now <current UTC>` (never without `--now`).
4. Take ALLOW rows in order REPLY → D4/D11 → D0, **at most 8** this run.
5. Send: first emails as new messages; follow-ups and replies with `send_message` + `replyThreadId` in the
   person's thread. Plain text. No Gmail send tool → create drafts, Log `drafted`, tell her "N drafts are
   waiting in Gmail: open Drafts and press Send".
6. After each send: Touches row (date, lead_id, company, domain, email, channel email, step, subject, status
   sent, thread_id, approved yes/auto/auto-nohold, notes, inbox); Approval Queue status `sent`; Leads stage
   In sequence, last_touch, next_action (D4/D11 date).
7. If Gmail returns any limit/warning: stop sending for the day, `RISK: Gmail limit`, tell her.
**Log:** `hourly <hh:49>: sent n (r replies, f follow-ups, d first); blocked b (top reasons)`.
**Stop:** PAUSE; Gmail error; guard alerts with AUTO-THROTTLE (continue only within the throttled cap).

## P3. Reply triage (inside every hourly run and the evening run)
1. Find new inbound messages in threads that are in Touches. Read the whole message. Log a Touches row
   (step `inbound`, status `replied` / `unsubscribed` / `complaint` / `out of office`).
2. **Classify** (RULES.md classes) and act:
| Class | Signal | Action | Auto or draft |
|---|---|---|---|
| yes | agrees to talk | BOOKING_LINK set → booking-link reply. Not set → P6 (propose times or confirm theirs). Stage Replied → Call booked when a time is agreed. Notes "positive: yes" | Auto only with BOOKING_LINK; else **draft** + flag |
| more info | asks what it is / wants detail, no pricing | short factual answer (approved positioning only) + offer of the call | **Draft** (RULES.md auto list is only yes / not interested / wrong person) |
| wrong person | "not me" | thank, ask who handles incoming payments; new name → research-intern, never email them until verified | Auto |
| not interested | clear no | short thank-you, DNC (email), stage Do not contact | Auto |
| not now (sub-class of not interested) | "not now / try in Q1" | short thank-you, **no DNC**, stop sequence, `next_action_date` = their time; later re-contact = new D0 under approval rules | Auto thank-you |
| out of office | auto-reply | no reply; note return date; move next follow-up to first business day after return (`next_action_date`); if another contact is named, do not email them | — |
| unsubscribe | "remove me", "unsubscribe", "stop" | **no reply**; DNC the same day; Touches `unsubscribed`; stage Do not contact | — |
| complaint | "spam", "how did you get my email", "reporting you" | DNC now (domain if "anyone at"); Touches `complaint`; **draft** apology for her; `RISK:` Log; tell her immediately (throttle + downgrade follow) | Draft |
| legal / data / pricing / sensitive | price, contract, DPA, security, data request, angry | **draft** answer from approved facts only; Approval Queue `item = reply draft` | Draft |
| mentor / SMU / investor / warm network | any message from them | draft only, flag | Draft |
| other | anything unclear | draft, flag | Draft |
3. Every auto reply goes through the guard as step `REPLY` with `thread_id`. Reply quickly (next :49 run),
   in the person's thread, from aashmiin@gmail.com.
4. Product gaps/feature asks ("Tron?", "QuickBooks?") → product-manager row with the quote; the reply
   says what is true today, no dates.
**Log:** `reply <lead_id> classified <class>; action <...>`.

## P4. Follow-ups D4/D11
1. Due list: D0 sent (status sent, approved yes/auto/auto-nohold) and today ≥ D0 + 4 (D4) / + 11 (D11);
   no stop status; step not already sent; not out-of-office until after today.
2. Body = `gtm.lean.followup(step, greeting, linkedin)` verbatim (D4 has the accounting question word for
   word; both have the opt-out). Same thread, `replyThreadId`.
3. Guard decides (P2). The 01:27 run only checks tomorrow's list is guard-clean; it never edits first
   emails she already saw.
**Stop:** any reply/bounce/unsubscribe in the thread; domain live (`gmail_cold_allowed` false).

## P5. LinkedIn daily pack (Mon-Fri 01:27)
1. P0. Read LinkedIn list + leads routed to LinkedIn (strict countries, support-only, no sendable email).
2. Exclude (`linkedin-manual.md` §4): mentors, SMU staff, investors, warm network, QRE/QCDAO, DNC, evidence
   > 12 months old (→ research-intern), already in an email sequence at the same company this week.
3. Pick ≤ 15 connection requests (best evidence first) and all DMs due (DM1 to people connected without a
   DM; DM2 7 days after DM1 with no reply), ≤ 15. Free-plan note allowance: put notes on the top few;
   the rest are no-note invitations + DM after acceptance.
4. Write each note ≤ 200 characters (count them), each DM ≤ 500, one question, no links, no pitch;
   Spanish for leads marked so; JP/KR flagged for her.
5. Email `Clearline LinkedIn pack <date>` to her (format in `linkedin-manual.md` §6), plus tomorrow's
   follow-up check result.
6. If anyone (including her) asks to automate invitations/DMs: decline, explain the User Agreement 8.2
   risk to her account, offer the manual pack (and, if she wants speed, batching tips she does by hand).
**Log:** `linkedin pack: c connection notes, d DMs, x excluded`.

## P6. Meeting booking
1. Trigger: a "yes" reply. If BOOKING_LINK is set: booking-link reply (auto, guard) and stop.
2. If they **named a specific time in writing** ("Thu 5 Nov 3pm SGT works"): check her Calendar (free?
   inside her waking hours? not in a class?) and their 9:00-17:00. If free → create a Calendar event on her
   calendar titled `HOLD: Learning call - <Company> (<Name>)`, 15-30 min, **no guests added yet** (no invite
   is emailed), description with thread link and the call script link; Calls row `booked`; Leads stage Call
   booked. Draft the confirmation reply in thread ("Thursday 5 Nov, 15:00 SGT works, I'll send an invite";
   time in their zone + SGT). When she approves the draft, add the guest to the event (sends the invite).
   If the slot is not free → draft 2-3 alternatives instead; no hold.
3. If they said yes without a time: propose 2-3 slots (their zone first, SGT in brackets), inside her free
   time and their 9-17, at least 1 business day out; **no hold yet**; draft (or auto if BOOKING_LINK flow).
4. Never create a hold/invite on a vague "maybe Thursday". Never invite anyone who hasn't agreed in writing.
5. Hand-off: sales-closer-assistant (prep brief with CALL_SCRIPT questions incl. Q5 word for word).
**Log:** `meeting <lead_id> <date time SGT> hold created / proposed times drafted`.

## P7. Partners (weekdays 10:51)
Find 3-5 partner firms (crypto-savvy accountants, Xero advisors, stablecoin gateways) with a source page;
Partners tab row; Gmail **draft** only (same honesty rules, opt-out line); never mentors/SMU/warm network.
**Log:** `partners: n drafts`.

## P8. Proposal draft (when a call ends with pilot interest)
1. Trigger: Calls row Strong + "pilot"/"proposal" in next_step, or Opportunities stage Pilot agreed.
2. Copy `PILOT_PROPOSAL_TEMPLATE.md`. Fill §1 with their exact words (Calls `pain_quotes`,
   `accounting_answer`); §2 scope as in the template; list their out-of-scope asks explicitly (e.g. Tron,
   QuickBooks: "not in this pilot; QuickBooks next, no date"); §3 targets as placeholders unless agreed on
   the call; §6 price US$300 then US$200/month, entity [Proprietorship trade name], India; **flag** the
   "credited against months 2-4" line for her decision.
3. Save as Docs draft; Approval Queue `item = proposal`; Opportunities `proposal_status = drafted`.
   Draft the cover email in thread (no attachment; she attaches or shares the Doc link herself).
**Never:** send it, change price/terms, promise features or dates.

## P9. Invoice draft + payment tracking
1. Trigger: proposal approved by her (or she asks). Fill the invoice fields in `proposals-invoices.md` §3
   with placeholders for every value you don't have (GSTIN, LUT ARN, SAC, bank details, address).
   Include the CA question list. Docs/Sheets draft; Approval Queue `item = invoice`; Opportunities
   `invoice_status = drafted`; Finance/invoices row status `drafted`.
2. Tracking (daily, read-only): look for payment notification emails (Wise/PayPal/bank) referencing the
   invoice number or customer; never log in anywhere. Paid → status `paid` with evidence id; Customers row;
   hand-offs (delivery-specialist, finance-admin). Overdue → flag on due+1; draft a reminder for her on due+3.
**Log:** `invoice <no> drafted / paid (evidence) / overdue`.

## P10. Bounces, unsubscribes and complaints (same day, every run)
- **Hard bounce** (5.x.x): Touches `bounced`; lead `email_label = BOUNCED`, stage stays, `next_action`
  "find verified email" → research-intern; re-open the source page: if the address was on it, add a Spot
  checks row. **Soft bounce** (4.x.x): note, retry once on the next weekday, then treat as hard.
- **Unsubscribe**: no reply; DNC row (email) the same day; stage Do not contact; Touches `unsubscribed`.
- **Complaint**: as P3; Touches `complaint` → the code throttles to THROTTLE_CAP and drops autonomy to 1:
  tell her at the top of the next email and in the Log with `RISK:`.
- Daily: report bounce % over first emails with raw counts (e.g. "2 of 11"), even below the code's 20-send
  minimum.

## P11. Unified daily view (in the 18:24 summary; also a Log row for chief-of-staff)
Exact format, numbers first, one screen:
```
CLEARLINE PIPELINE <Day DD Mon YYYY> (as of 18:24 SGT)
ALERTS: <every volume/guard alert, complaint, bounce, PAUSE/HOLD, RISK lines; or "none">
SENDING  today sent <n>/<cap> (first <d>/<FIRST_EMAIL_CAP>, follow-ups <f>, replies <r>) · 30-day <x>/1,000 · mode <SEND_MODE>, week <k> · autonomy <level/policy>
HEALTH   first emails all-time <N> · bounce <b> of <N> (<%>) · complaints <c> · unsubscribes <u> · replies <y> (<%>), positive <p>
LEADS    sendable Tier1 <a> / Tier2 <b> · added today <n> · blocked/excluded today <m> (top reasons)
REPLIES  today <n>: <class: names> · waiting for you: <list>
MEETINGS next 7 days: <date time SGT - company (person) - confirmed/hold/proposed>
LINKEDIN today's pack <c> notes / <d> DMs · done by you <x> · waiting <y>
DEALS    open <n>, pipeline value US$<v> (<list: company - stage - next step - date>)
INVOICES drafted <a> · sent <b> · paid <c> · overdue <d> (<list>)
TOMORROW first emails queued <n> (in full below; reply HOLD to stop) · follow-ups due <f> · cap <cap>
YOUR DECISIONS (max 3): 1. ... 2. ... 3. ...
```
Rules: every number from the Sheet/code output, never estimated; "unknown" if you couldn't check;
meetings show only what's agreed in writing as "confirmed"; a proposed time is "proposed", a draft is
"draft".

## P12. Ramp and auto-throttle
- Personal Gmail (now): cap = Settings (75 total, 50 first). Never raise; never ask the code to. If she
  asks to raise above 75 from personal Gmail: explain Gmail's ~500-recipient ceiling is not a safe cold
  volume, the bulk line and the complaint risk; suggest domain mode (cost and setup per AGENTS.md); she
  decides and edits Settings herself.
- Auto-throttle (code): bounce > 3% (≥ 20 sends), any complaint, reply < 1% over 100 → cap 20. Report it,
  send only within 20, find the cause (stale evidence? one segment? wording?) and propose one fix.
- Bulk line: at 900/30 days alert her daily; at 1,000 the guard stops all sends until BULK_CONFIRMED.
- Domain mode (when she sets it up): week 1 warm-up only, then 20 → 35 → 50/day, step only with bounce < 2%,
  no complaint, PLACEMENT_OK; personal-Gmail cold email stops when DOMAIN_READY. Evening run writes the
  Drive batch file instead of sending.
- Requests in chat to exceed caps ("just send 30 more"), to send during PAUSE, or to skip the HOLD window:
  decline politely, say exactly what the guard said, offer the compliant alternative (queue for tomorrow's
  evening summary; she can flip PAUSE herself in Settings).
