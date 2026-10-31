# Schedules (all Singapore time, all cloud scheduled tasks)

Every slot is a cloud scheduled task on Aashmiin's claude.ai account. They run whether or not her Mac
is on. Each one starts a fresh session that clones investigation-desk and reads
`company/COMPANY_RULES.md` plus its own definition, knowledge pack and playbook (from the `ai-team`
branch until that is merged). It then checks PAUSE, does its job and logs it. Times sit a few minutes
off the hour, because the scheduler is busiest on the exact mark.

**Click needed** means the task was created from a coding session, so it has no connectors and no
Auto mode. To fix it, open claude.ai → Scheduled tasks → the task → Edit. Add the connectors named
and set the mode to Auto. Every other task already has its connectors and runs in Auto.

## Night shift

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| 22:53 nightly | qa-security-engineer | "Clearline nightly QA + security" | live |
| 23:27 nightly | crypto-protocol-engineer | "Clearline nightly build" | **click needed**: Gmail, Google Sheets |
| 00:27 nightly | research-intern | "Clearline nightly targets + LinkedIn list + watch" | live |
| 01:27 Mon-Fri | revops-crm-agent | "Clearline LinkedIn daily pack + follow-up check" | live |
| 02:27 Mon-Fri | content-marketer (rebuilt in week 3) | "Clearline marketing daily" | live |
| 03:27 nightly | devops (→ devops-engineer once its golden tasks pass) | "Clearline devops nightly" | **click needed**: Gmail, Google Sheets |
| every hour at :49 | revops-crm-agent | "Clearline sender" | live. Sends only 9:00-17:00 in each recipient's time zone. First emails go out only if that evening's end-of-day email reached her |

## Day

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| 07:07 + 18:07 Mon-Fri | ae-assistant (rebuilt in week 2) | "Clearline AE assistant" | **click needed**: Gmail, Sheets, Calendar, Docs, Drive |
| 07:27 daily | chief-of-staff | "Clearline daily briefing" | live |
| 10:51 Mon-Fri | revops-crm-agent | "Clearline partnerships daily" (drafts only) | live |
| 11:13, 15:13, 19:13 Mon-Fri | research-intern | "Clearline lead research" | live |
| 18:13 Mon-Fri | revops-crm-agent, then chief-of-staff | "Clearline evening: queue + end of day". revops builds tomorrow's queue, then chief-of-staff sends ONE "Clearline end of day" email (about 18:27) with every queued email in full | live |

## Weekly and monthly

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| Mon 08:44 | chief-of-staff | "Clearline Monday plan" | live |
| Thu 16:29 | finance job (finance-admin in week 3) | "Clearline finance weekly" | live |
| Fri 17:13 | chief-of-staff (until product-manager is rebuilt) | "Clearline Friday ship review" | live |
| Sun 15:47 | research-intern | "Clearline weekly market brief" | **click needed**: Gmail, Sheets, Docs, Drive |
| Sun 17:38 | chief-of-staff | "Clearline weekly report + spot check + advisor draft" | live |
| Sun 20:47 | devops-engineer | "Clearline weekly uptime + backup report" | **proposed**: after golden tasks pass and Aashmiin approves |
| Sun 21:47 | qa-security-engineer | "Clearline weekly security review" | **click needed**: Gmail, Google Sheets |
| 1st 09:43 | research-intern | "Clearline monthly knowledge refresh + evals" (refreshes every pack, re-runs every golden task, opens a PR with the scores) | **click needed**: Gmail, Google Sheets |
| 1st 10:17 | chief-of-staff | "Clearline monthly update draft" | live |

## What never happens without her
Emails to new people beyond the queue she saw in the end-of-day email; anything to customers,
mentors, advisors or investors; payments, prices, proposals, invoices, contracts; posts in her name;
merging to `main`; deleting data or branches; unlocking more outreach. These wait in the 07:30
approval queue. A failure or anything risky stops that task only, is logged with `RISK:`, and leads
the briefing. PAUSE (Settings, or reply PAUSE to any Clearline email) stops everything.
