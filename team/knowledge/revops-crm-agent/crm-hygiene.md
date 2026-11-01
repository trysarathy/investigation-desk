# CRM hygiene: the Company HQ tabs revops-crm-agent owns

Sources [VERIFIED, opened 2026-10-29]: `company/COMPANY_RULES.md` (tab list, sheet id), `gtm/model.py`
(LEAD_COLS, TOUCH_COLS, DNC_COLS, QUEUE_COLS, LOG_COLS, STAGES), `gtm/build_master.py` (Calls,
Opportunities, Spot checks columns, Settings keys, Dashboard formulas), `gtm/merge.py` (dedupe).

Sheet: **Company HQ**, id `1NhxrAIX-VfU2P43GbjYVtHk82LGpbRcwv6sVuNG6gdA`, owner aashmiin@gmail.com. If the
Google connection is a hatch.sg account: STOP, change nothing, report it. The guard's column names are
the contract: **never rename, reorder or delete columns**; new columns go to the right, once, after
Aashmiin agrees (Decisions log). **Never delete rows** (deleting data = her approval); close them with a
stage/status instead. Append, then update in place by id.

## Leads (one row per person; `id` unique, e.g. L0123)
Columns (`model.LEAD_COLS`): `id, tier, score, stage, priority, company, domain, country, region, segment,
buyer_or_vendor, website, evidence_url, contact_name, contact_role, email, email_label, linkedin_person,
channel, first_line, first_line_source, first_line_date, compliance_note, check_before_sending, last_touch,
next_action, next_action_date, notes` (+ `added` date, read by metrics).
**Required before a first email:** company, domain (lower-case, no www), country (full English name as in
`lean.TZ_OFFSET`, e.g. "United Kingdom", "Hong Kong", "United Arab Emirates"), buyer_or_vendor, evidence_url,
contact_name, contact_role, email, email_label (VERIFIED-PUBLIC or VERIFIED-TOOL), channel = email,
first_line (≤ 18 words), first_line_source (http...), first_line_date (≤ 12 months old), tier/score from
`gtm.cli score`.
**Stages** (`model.STAGES`, in order): Mapped → Researched → Approved → In sequence → Replied → Call booked →
Call held → Strong / Weak / None → Design partner → Paying; or **Do not contact** (terminal).
Stage moves you make: Researched→In sequence (D0 sent); →Replied (any human reply); →Call booked (time agreed
in writing); →Do not contact (no / unsubscribe / complaint). Call held/Strong/Weak/None come from the call
notes (sales-closer-assistant/Aashmiin). Design partner/Paying only when Opportunities/Customers say so.
`email_label` values: VERIFIED-PUBLIC (seen on a public page), VERIFIED-TOOL (Apollo or another tool
verified it), GUESSED-PATTERN / UNVERIFIED (never sendable), BOUNCED (after a hard bounce).

## Targets (companies not yet with a named contact; research-intern appends)
`company, domain, country, segment, evidence_url, evidence_date, size_hint, why, status, added`. You promote
a Target to Leads only with a named person and sendable email (or to the LinkedIn list).

## LinkedIn list (research-intern appends; you prepare, she acts)
`id, person, role, company, country, linkedin_url, source_url, source_date, evidence, status,
last_action_date, notes`. Status: to connect → requested → connected → DM1 sent → DM2 sent → replied /
no reply / not a fit. **Aashmiin updates status after acting by hand**; you never touch LinkedIn.

## Approval Queue
`model.QUEUE_COLS`: `queue_date, lead_id, company, contact_name, email, step, subject, body,
first_line_source, guard, guard_reasons, needs_approval, APPROVE, edited_body, status` (+ `queued_at`,
`thread_id`, and for non-email items `item`, `notes`). Status: queued → sent / hold / blocked / rejected;
drafts for her: waiting → approved / rejected. APPROVE: yes / no / edit. Proposals, invoices, pricing
replies, complaint drafts, mentor items all appear here as `item` rows with a link to the Gmail/Docs draft.

## Touches (one row per email event)
`model.TOUCH_COLS`: `date, lead_id, company, domain, email, channel, step, subject, status, thread_id,
approved, notes, inbox`. Steps: D0, D4, D11, REPLY (ours), inbound (theirs), bounce. Status: drafted,
queued, sent, replied, bounced, unsubscribed, complaint, out of office. `approved`: yes (she approved), auto
(follow-up/auto reply), auto-nohold (week-1 queue, no HOLD). Notes for replies start with the class;
positive replies start with "positive" (the Dashboard counts them). Always store the Gmail `thread_id`.

## Calls (from `build_master.py`)
`date, lead_id, company, person, status (booked/held/no-show/cancelled), problem_score (Strong/Weak/None),
pain_quotes, current_workaround, volume_per_month, next_step, notes_link` + `accounting_answer` (RULES.md:
Q5 answer word for word). You add the `booked` row when a time is agreed in writing.

## Opportunities
Base (`build_master.py`): `lead_id, company, stage, pilot_scope, started, next_step, next_step_date, notes`.
Extension used by this role (add once, to the right, with her OK): `opp_id, contact, value_usd, currency,
proposal_status (not drafted/drafted/approved/sent/accepted), invoice_status (not drafted/drafted/approved/
sent/paid/overdue)`. Stages: Call booked → Call held → Pilot offered → Pilot agreed (verbal) → Proposal sent
→ Pilot signed/paid → Pilot live → Converted (monthly) / Lost (reason). **Pipeline value** = sum of
value_usd for open opportunities (pilot US$300 + first year at US$200/month only when she says the buyer
intends to continue; otherwise just the pilot). Never invent a value.

## Customers (0 today)
`company, lead_id, start_date, plan, mrr_usd, billing_contact, invoice_day, status, notes`. A row appears only
after a pilot invoice is **paid** (seen on her statement or confirmed by her). Never list a customer
publicly without written permission.

## Do-not-contact
`model.DNC_COLS`: `value, kind (email/domain), reason, date`. A bare domain in `value` blocks the whole
company (guard). Add **the same day** for: "no"/not interested, unsubscribe, complaint (domain if they say
"anyone at"), bounces you can't fix, mentors/SMU/investors/warm network/QRE-QCDAO people found in lead lists.
Never remove a row (only Aashmiin may).

## Log
`timestamp (SGT), agent (= revops-crm-agent), action, lead_id, details` (links, guard output summary).
One row per action; `RISK:` prefix for anything failed or risky.

## Dedupe rules (`gtm/merge.py`)
- New leads are dropped if their **email** or **company domain** (from domain/website/email) is already in
  Leads, or (no domain) the company name matches. One row per domain in a batch: higher `priority` kept,
  blanks filled from the other. Run `python3 -m gtm.cli merge --dir work --incoming new.csv` before
  appending; it writes `new_leads_clean.csv`, scored and staged Researched.
- Two **people** at one company may both exist in Leads (added deliberately), but only one gets a first
  email within `SAME_COMPANY_DAYS` (7); the other gets `next_action_date` = first send + 7 days or later.
- The same person appearing in Leads and the LinkedIn list is fine (different channels); note it in both.
- Normalise: lower-case emails and domains, strip "www.", full country names, ISO dates (YYYY-MM-DD).

## Daily hygiene checks (end of each evening run)
1. Every sent email has a Touches row with thread_id; every reply has a class; no lead "In sequence" whose
   Touches show a stop status.
2. Every DNC event today has a DNC row.
3. No lead with stage ≥ Replied and an empty `next_action`/`next_action_date`.
4. No Opportunity with a `next_step_date` in the past.
5. Approval Queue: nothing `waiting` > 24 h without being in today's summary.
Report counts of fixes in the evening summary.
