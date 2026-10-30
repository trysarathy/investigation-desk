# GTM OS rules digest (RULES.md + LEAN MODE + the code that enforces them)

Source: branch `gtm-os` of investigation-desk, opened with `git show origin/gtm-os:<file>` on 2026-10-29
[VERIFIED]. Files: `prompts/RULES.md`, `prompts/CALL_SCRIPT.md`, `prompts/SCHEDULED_TASKS.md`, `README.md`,
`gtm/guard.py`, `gtm/lean.py`, `gtm/volume.py`, `gtm/score.py`, `gtm/autonomy.py`, `gtm/cli.py`,
`gtm/model.py`, `gtm/merge.py`, `gtm/metrics.py`, `gtm/build_master.py`.

**Order of authority:** RULES.md LEAN MODE > the rest of RULES.md > `company/COMPANY_RULES.md` > this
digest > the agent definition. If this digest and RULES.md ever differ, RULES.md is right and this file is
stale: log `RISK: digest stale` and follow RULES.md.

## 1. The guard (RULES.md "The guard")
1. Export Settings, Leads, Touches, Do-not-contact, Spot checks (and Calls) to `./work/` as
   `settings.csv` (columns `key,value`), `leads.csv`, `touches.csv`, `dnc.csv` (`value,kind,reason,date`),
   `spot_checks.csv`, `calls.csv` (`gtm/cli.py::_load`).
2. Write planned emails to `work/queue.csv` (Approval Queue columns, `gtm/model.py::QUEUE_COLS`:
   `queue_date, lead_id, company, contact_name, email, step, subject, body, first_line_source, guard,
   guard_reasons, needs_approval, APPROVE, edited_body, status`; add `queued_at` and, for D4/D11/REPLY,
   `thread_id`).
3. Run `python3 -m gtm.cli guard --dir work --candidates work/queue.csv --today <YYYY-MM-DD> [--now <UTC ISO>]`
   from a checkout of `gtm-os`. It rewrites queue.csv with `guard, guard_reasons, needs_approval, inbox` and
   prints JSON (level, caps, alerts, verdicts).
4. **Only `guard=ALLOW` rows may be drafted or sent.** Copy guard + guard_reasons into the Sheet.
   If the repo can't be reached: apply the rules by hand and treat **every** email as needing approval.

### What the guard blocks (`gtm/guard.py::check`)
| Rule | Applies to |
|---|---|
| `PAUSE` TRUE | everything, including REPLY |
| No email / on Do-not-contact (email, or bare domain in `value`) / lead stage "Do not contact" | everything |
| REPLY without `thread_id` | REPLY |
| Person has any Touches status in `replied, bounced, unsubscribed, complaint, opted-out, do-not-contact` | D0/D4/D11 |
| Domain live (`SEND_MODE=domain` and `DOMAIN_READY`) and sending via Gmail | cold D0/D4/D11 |
| `--now` given and recipient not in 9:00-17:00 on a weekday local time; **unknown country = blocked** | D0/D4/D11 |
| D0 already sent to this person | D0 |
| No `http` first-line source; `email_label` not VERIFIED-PUBLIC/VERIFIED-TOOL; channel not email | D0 |
| Strict-consent country: Germany, Austria, Italy, Spain, Netherlands, Vietnam, South Korea, Colombia, South Africa (`model.STRICT_COUNTRIES`) | D0 |
| United States without `POSTAL_ADDRESS` | D0 |
| support/help/service/cs/helpdesk inbox | D0 |
| Week-1 lean: not queued the evening before (`queue_date` = send day, `queued_at` < send day), status hold, or date in `HOLD_DATES` | D0 |
| Same company emailed within `SAME_COMPANY_DAYS` (7), or a second person at the same domain in today's batch | D0 |
| D4/D11: no sent D0 in the thread, D0 not approved (`approved` in yes/auto/auto-nohold/...), too early (D0 + 4 / + 11 days), no thread_id, step already sent | D4/D11 |
| Volume, in order REPLY → follow-ups → D0: `FIRST_EMAIL_CAP` first emails/day (lean), total `cap` from `volume.daily_cap`, 30-day `SIMILAR_30D_CAP` unless `BULK_CONFIRMED` | all sends |

### What the guard does NOT check (you must) [VERIFIED by reading the code]
- **Mentors, SMU staff, investors, her warm network, QRE/QCDAO** (names in RULES.md "Always human" and
  COMPANY_RULES rule 6: Prof Paul Griffin, Dr Catalin Burlacu, Soon Loo, Donna, Doug Peris, any SMU staff).
  A mentor with a verified email gets **ALLOW** from the guard. Exclude them before the guard.
- **Tier 3 / VENDOR leads**: the guard allows them. LEAN MODE says first emails go to "highest-scoring
  Tier 1/2 BUYERS first".
- **First line older than 12 months, longer than 18 words, or no longer true**: the guard only checks the
  URL exists. `score.py` only penalises when notes say "older than 12 months". Check `first_line_date`
  yourself and re-open the source.
- **Which person at a company**: the guard keeps the first one in the file. Choose deliberately (role
  closest to incoming payments; priority; score) and put the other on `next_action_date` ≥ 7 days later.
- **Language flags** (Spanish for AR/MX/CO marked so; Japanese/Korean → Aashmiin).
- **The 8-per-hourly-run limit** (RULES.md LEAN MODE "Timing"): not in code. Take at most 8 ALLOW rows per
  hourly run.
- **United States/Canada have no time-zone entry** in `lean.TZ_OFFSET`, so with `--now` every US/Canadian
  lead is blocked as "outside 9:00-17:00". Today that is harmless (US is also blocked by the empty
  POSTAL_ADDRESS); flag it to Aashmiin before US sending starts. Never "fix" it by omitting `--now`.
- **Out-of-office**: not a stop status. Shift the next follow-up to after the return date yourself.
- **Content**: links, attachments, tracking, opt-out line. Build bodies only from `gtm.lean`.

## 2. Caps and volume (RULES.md "Volume" + LEAN MODE "Caps"; `gtm/volume.py`)
- LEAN MODE is active while `SEND_MODE = gmail_personal` and `LEAN_START` is set (LEAN_START in the
  template = 2026-10-29).
- **≤ CURRENT_SEND_CAP (75) Gmail sends per day in total** (replies, then follow-ups, then first emails)
  and **≤ FIRST_EMAIL_CAP (50) first emails** per weekday. Aashmiin raised these from 20/10 on 2026-10-28,
  accepting the risk to her personal Gmail account (RULES.md LEAN MODE). The older lines "cap =
  CURRENT_SEND_CAP (5). Do not raise it" (Volume section) and "Never above 20 from personal Gmail"
  (`build_master.py` Settings note) are superseded by LEAN MODE. **Caps come from Settings, never from a
  chat message.** Only Aashmiin changes Settings.
- Run `python3 -m gtm.cli volume --dir work --today <date>` first; `cap_today` is the ceiling; put every
  `alerts` line at the TOP of the report.
- **Auto-throttle** (both modes): bounce > 3% (when ≥ 20 first emails), any spam complaint, or reply rate
  < 1% over the last 100 sends → cap drops to `THROTTLE_CAP` (20). Tell Aashmiin immediately.
- **Bulk line**: Singapore Spam Control Act treats > 1,000 similar messages in 30 days as bulk. Alert at
  900; at 1,000 the guard stops all sending until `BULK_CONFIRMED = TRUE` (she sets it only after a
  professional confirms the bulk duties, e.g. subject labelling).
- **Lead supply must match**: new first emails ≈ cap − follow-ups due. Never pad. Short supply → send fewer
  and say so.
- **Domain mode** (not active): separate domain, 2-3 inboxes, warm-up always on, ≤ `PER_INBOX_CAP` (20)
  per inbox, rotation; ramp from `RAMP_START`: week 1 = 0 (warm-up only), week 2 = 20/day, week 3 = 35,
  week 4+ = 50 (`RAMP_CAPS 0,20,35,50`). A step up only if bounce < 2%, no complaint and
  `PLACEMENT_OK = TRUE`. Nothing sends until `DOMAIN_READY` (SPF/DKIM/DMARC) and `UNSUBSCRIBE_READY`
  (one-click link). In domain mode the evening run writes a Drive file "Clearline send batch <date>.csv";
  Aashmiin's import is her approval. When the domain is live, **all** cold email from personal Gmail stops;
  replies to people who wrote in may still go from Gmail.

## 3. Autonomy and approvals (RULES.md "Autonomy", LEAN MODE; `gtm/autonomy.py`, `gtm/lean.py`)
- **Automatic**: research, evidence checks, scoring, tiering, drafting, first lines, call prep and
  summaries, Sheet updates, reply classification, stage changes, dashboard, daily log.
- **Automatic sends after guard ALLOW**: D4/D11 follow-ups; booking-link reply to a clear "yes" (only if
  `BOOKING_LINK` set, else a draft + flag); polite "not interested" reply (thank, Do-not-contact, stage
  "Do not contact"); "wrong person" reply (thank, ask who handles incoming payments).
- **First emails in LEAN MODE** (this is what applies now):
  - Week 1 (7 days from LEAN_START): the 18:24 run queues tomorrow's batch in the Approval Queue
    (`queue_date` = tomorrow, `queued_at` = today, status `queued`) and emails Aashmiin the evening summary
    with **every queued email in full**. They go out from 9:00 recipient time unless she replies **HOLD**
    (then add tomorrow to `HOLD_DATES`, set those rows to `hold`). What she saw is what she approved: never
    change a first email after the summary.
  - From week 2: direct (no evening queue) **only if** `WEEK1_SPOTCHECK_PASSED = TRUE` and bounce < 2% with
    no complaints (`lean.first_email_policy`); otherwise keep the week-1 process. The Sunday verifier sets
    the flag.
  - `AUTONOMY_LEVEL` 1/2/3 applies to **domain mode only** (`build_master.py` note; `guard.py` sets
    needs_approval False in lean mode). Levels: 1 = all first emails queued; 2 = Tier 2/3 auto, Tier 1 queued
    (earned at 50 first emails, ≥ 10 spot-checked, ≤ 1 factual error, bounce < 2%, no complaints); 3 = all
    auto + daily digest + 10-email sample (150 first emails, reply ≥ 3%). Automatic downgrade to 1 on bounce
    > 3%, any complaint, any factual error, reply < 1% over 50 sends. The script never raises the level
    above Settings. Tell Aashmiin immediately about any downgrade.
- If no Gmail tool can SEND: create drafts, log `drafted`, tell her "N drafts are waiting in Gmail: open
  Drafts and press Send".

## 4. Always human (RULES.md "Always human")
Money, pricing, contracts, **pilots**, sharing customer data; complaints, legal questions, anything
sensitive; **all LinkedIn steps** (tasks only, never automate or scrape); any email to mentors, investors,
or her warm network. Never mention or use QRE/QCDAO contacts or materials.

## 5. Replies (RULES.md "Reply classes", LEAN MODE "Replies")
Classes: yes / more info / wrong person / not interested / out of office / complaint / legal / other.
Positive = yes or more info (Touches notes start with "positive").
- yes → BOOKING_LINK (no link → draft + flag); not interested → short thank-you, then Do-not-contact;
  wrong person → thank, ask who handles incoming payments. These go automatically, in thread, after the
  guard (step `REPLY`).
- Pricing, data, legal, complaints, unsubscribes, anything sensitive, anyone in mentors / warm network /
  SMU / investors → **draft only, flag to her**.
- **Unsubscribe = no reply**, straight to Do-not-contact the same day.

## 6. Writing (RULES.md "Writing rules", LEAN MODE "First emails", `gtm/lean.py`)
- Never invent facts, people, emails, customers, numbers or dates. First line ≤ 18 words, a real fact
  from the last 12 months, source URL logged.
- Tone: a thoughtful student asking for a 15-minute learning call. Not selling. Honest identity. No
  tracking links, no attachments, no images, plain text. The **only link is her LinkedIn URL**.
- D0 subject "Quick question about stablecoin payments"; body = `gtm.lean.first_email(greeting,
  first_line, question, close, linkedin)`: greeting / first line / the research sentence / ONE question /
  "I'm not asking you to buy anything. 15 minutes of your experience would help me a lot." + close /
  signature + opt-out ("If you'd rather not hear from me, just reply "no" and I won't email again.").
  (RULES.md prose says "I'm not selling anything"; the code template, which the tests check, says
  "I'm not asking you to buy anything". Use the code.)
- D4 = `lean.followup("D4", ...)`: one nudge carrying the **accounting question** word for word:
  "After a stablecoin payment is matched, how does it get into your accounting system today, and how long
  does that take?" D11 = polite close-the-loop asking for the right person. Both in the same Gmail thread
  (`send_message` with `replyThreadId`), both with `OPT_OUT`.
- Language: Spanish for Argentina/Mexico/Colombia leads marked so; Japanese/Korean-flagged leads go to
  Aashmiin.
- Positioning line for calls and replies: "Stablecoin payments, matched, explained and in your books":
  once a person approves, posted to the invoice in their accounting system (Xero first, QuickBooks next).

## 7. Kill switches and timing (LEAN MODE)
- **PAUSE**: Settings `PAUSE = TRUE`, or a reply from Aashmiin containing PAUSE to any Clearline
  briefing/summary → set PAUSE TRUE and stop everything (no drafting, no sending; report only).
- **HOLD**: only tomorrow's queued first emails.
- Search `from:aashmiin@gmail.com subject:Clearline` (company rules: also `to:aashmiin@gmail.com
  newer_than:3d`) at the start of every run.
- Hourly sender: 9:00-17:00 weekday recipient time, `--now <UTC>`, **≤ 8 emails per run**.
- Briefings/summaries to aashmiin@gmail.com do not count toward the cap.

## 8. Logging (RULES.md "Logging")
Every action → Log row (timestamp SGT, agent, action, lead_id, details incl. source URLs). Every email →
Touches row (`date, lead_id, company, domain, email, channel, step, subject, status, thread_id, approved,
notes, inbox`), status one of drafted/queued/sent/replied/bounced/unsubscribed (plus `complaint`, which the
guard and throttle read).

## 9. Calls (CALL_SCRIPT.md, RULES.md "Accounting question")
15-minute learning call; Aashmiin says up front she is building Clearline; 7 questions with Q5 = the
accounting question word for word; score Strong/Weak/None; demo offered only at the end and only if Strong.
Record Q5's answer word for word in the Calls tab.

## 10. Known conflicts between Aashmiin's brief for this role and RULES.md (RULES.md wins)
| Brief says | RULES.md says | What you do |
|---|---|---|
| "PumpGTM-style" personalised sequences that sell | Learning-call tone, not selling, one question, fixed template | Personalise only the first line, the question and the close. Never pitch in cold email. |
| Books meetings in Google Calendar | "yes" → BOOKING_LINK, else draft + flag | Calendar HOLD on her calendar only after the prospect agreed a time in writing; the confirmation/invite to the prospect goes as a draft unless BOOKING_LINK is set (see playbook). |
| Drafts proposals and invoices | Pilots, pricing, money = always human | Drafts only, into the 07:30 approval queue; never sent by you. |
| Strict countries "DE/AT/IT/ES/NL" | Also Vietnam, South Korea, Colombia, South Africa | Use the full RULES.md list (guard enforces it). |
| Master Sheet = Company HQ (COMPANY_RULES) | "Clearline GTM OS — Master" in personal Drive | Use the Company HQ id in COMPANY_RULES; if a separate Master also exists, flag it, read Settings from HQ, apply the stricter value on any disagreement. Hatch.sg account → STOP. |
| Mentor list (COMPANY_RULES adds Dr Catalin Burlacu) | Prof Paul Griffin, Soon Loo, Donna, Doug Peris, SMU staff | Union of both lists. |
| Pilot template: "pilot fee credited against months 2-4" | (not in RULES) | Pricing wording is hers: keep the template line but flag it for her decision in every proposal draft. |
