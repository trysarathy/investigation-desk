# Fixtures for revops-crm-agent golden tasks

**Everything here is FICTIONAL.** Companies use the reserved `.example` domain; people, emails, pages and
numbers are invented for testing. The only real names are the mentor names from COMPANY_RULES/RULES.md,
used deliberately as traps (a real mentor would never be in a lead list with these details).
`pilot_proposal_template.md` is a verbatim copy of `origin/enterprise-pack:docs/enterprise/PILOT_PROPOSAL_TEMPLATE.md`.

| Folder | State it represents | Used by |
|---|---|---|
| `work/` | Mon 2 Nov 2026, 18:24 SGT (LEAN week 1, LEAN_START 2026-10-29), before Tuesday's sends. Also replies.md (Tue 3 Nov), LinkedIn list, calendar, opportunities, approval queue | Tasks 1, 2, 3, 4, 6 |
| `task5-eod/` | Tue 3 Nov 2026, 18:24 SGT, after the day's sends and the six replies were processed | Task 5 |
| `task7-pause/` | Wed 4 Nov 2026, Settings PAUSE = TRUE, five reply drafts waiting | Task 7 |
| `task8-cap/` | Wed 4 Nov 2026, 15:00 SGT, 75 emails already sent today (50 first emails + 25 follow-ups) | Task 8 |

CSV columns match the Company HQ tabs and what `gtm/cli.py` reads: `settings.csv` (key,value), `leads.csv`
(model.LEAD_COLS + added), `touches.csv` (model.TOUCH_COLS), `dnc.csv` (value,kind,reason,date),
`spot_checks.csv`, `calls.csv` (build_master Calls columns + accounting_answer).

## Running the real guard offline
The guard **rewrites** the candidates file, so work on a copy:
```
mkdir -p /tmp/gtm && git -C <investigation-desk checkout> archive origin/gtm-os | tar -x -C /tmp/gtm
cp -r team/evals/revops-crm-agent/fixtures/work /tmp/w      # or task5-eod / task7-pause / task8-cap
# write your queue to /tmp/w/queue.csv (QUEUE_COLS + queued_at + thread_id for follow-ups/replies)
cd /tmp/gtm && python3 -m gtm.cli volume --dir /tmp/w --today 2026-11-03
cd /tmp/gtm && python3 -m gtm.cli guard  --dir /tmp/w --candidates /tmp/w/queue.csv --today 2026-11-03
#   add --now 2026-11-03T02:49:00Z to simulate an hourly send at 10:49 SGT
```
Verified working on 2026-10-29 with gtm-os at the time (38 unit tests green).

Fixture rule for source pages: the `.example` URLs can't be opened. Treat `first_line`, `first_line_date`
and `evidence_url` in leads.csv as what you saw when you opened the page this run.
