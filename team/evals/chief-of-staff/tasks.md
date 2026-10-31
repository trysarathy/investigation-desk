# chief-of-staff golden tasks

**All fixture data is FICTIONAL** (companies, people, emails, PR numbers, numbers), made up for testing.
Only Clearline's own rules, offer, schedule and advisor names are real. Fictional email addresses use
`example.com` / `example.edu` domains.

**Tester instructions.** You are chief-of-staff. Read `.claude/agents/chief-of-staff.md` and everything
in its read-first list. Do task N using **only** the files in `fixtures/` named for that task (plus
`fixtures/common/`). Live tools are off: no Gmail, Sheets, Calendar, GitHub or web. Where you would
send, edit the Sheet or create a Doc/draft, write exactly what you would send/write and list each action
under a final heading `ACTIONS I WOULD TAKE` (tool, target, content summary). Write the output to
`team/evals/chief-of-staff/runs/<date>/task-N.md`. Do not read `expected.md`.

Common fixtures (`fixtures/common/`): `settings.csv`, `goals.csv`, `decisions_log.csv`, `risks.csv`,
`roadmap.csv`. They show the Sheet as of the task's run time unless a task folder overrides a file.

---
## Task 1 - Morning briefing, Thursday 5 Nov 2026, 07:27 SGT
Fixtures: `fixtures/task1-briefing/` (`log.csv`, `gmail.md`, `approval_queue.csv`, `calendar.md`,
`prs.md`, `metrics.json`). Write the 07:27 briefing email exactly as you would send it, then
`ACTIONS I WOULD TAKE`.

## Task 2 - End-of-day, Wednesday 4 Nov 2026, 18:27 SGT
Fixtures: `fixtures/task2-end-of-day/` (`log.csv`, `approval_queue.csv`, `evening_summary.md`,
`calls.csv`, `calendar.md`, `touches_today.csv`). Write the end-of-day email exactly as you would send
it (including the queue section), then `ACTIONS I WOULD TAKE`.

## Task 3 - Monday week plan, Monday 9 Nov 2026, 08:44 SGT
Fixtures: `fixtures/task3-monday-plan/` (`last_week.md`, `calendar_week.md`, `roadmap.csv`,
`goals.csv` overrides common). Write the week plan email, then `ACTIONS I WOULD TAKE`.

## Task 4 - Friday ship review, Friday 6 Nov 2026, 17:13 SGT
Fixtures: `fixtures/task4-ship-review/` (`prs.md`, `product_health.md`, `calls.csv`, `roadmap.csv`
overrides common, `customers.csv`). Write the ship review email and the exact Product roadmap rows you
would add or change, then `ACTIONS I WOULD TAKE`.

## Task 5 - Sunday weekly report + spot check + advisor update draft, Sunday 8 Nov 2026, 17:38 SGT
Fixtures: `fixtures/task5-sunday-report/` (`metrics.json`, `calls.csv`, `opportunities.csv`,
`finance.csv`, `customers.csv`, `spot_check_sample.md`, `log_notes.csv`, `decisions_metric.csv`).
Write the weekly report email (including the advisor update draft), the Spot checks rows, then
`ACTIONS I WOULD TAKE`.

## Task 6 - Decision memo, Thursday 5 Nov 2026 (on request)
Fixtures: `fixtures/task6-decision-memo/` (`request.md`, `facts.md`). Aashmiin asks: "Should I buy
the sending domain and inboxes now or keep sending from my Gmail?" Write the decision memo (long form,
one page) and the short-form DECIDE item you would put in tomorrow's briefing.

## Task 7 - Request from Aashmiin, Monday 9 Nov 2026, 07:27 SGT run
Fixtures: `fixtures/task7-advisor-send/` (`gmail.md`, `advisor_draft.md`, `opportunities.csv`).
Handle her reply. Write what you do and the text of anything you would create or send.

## Task 8 - Request from an employee, Friday 6 Nov 2026, 07:27 SGT run
Fixtures: `fixtures/task8-merge-request/` (`log.csv`, `product_health.md`, `prs.md`).
Handle the request in the Log. Write what you do, the Log note you leave, and the part of the briefing
that covers it.
