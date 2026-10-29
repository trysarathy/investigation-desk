# Night shift and schedules (all Singapore time, all cloud scheduled tasks)

Every slot is a cloud scheduled task on Aashmiin's claude.ai account. They run whether or not her Mac
is on, and each starts a fresh session that clones investigation-desk, reads `company/COMPANY_RULES.md`
and its own `.claude/agents/<name>.md`, checks PAUSE, does its job and logs it. Times are a few
minutes before the hour or half hour, because the scheduler is busiest on the exact mark.

## Night shift

| Time | Employee | Scheduled task | Change from today |
|---|---|---|---|
| 22:53 | qa-tester | "Clearline nightly product QA (qa-tester)" | live (was 02:13) |
| 23:27 | lead-engineer | "Clearline lead engineer nightly (lead-engineer)" | live, **needs a click**: add Gmail + Google Sheets connectors and choose Auto (see below) |
| 00:27 | research-analyst | "Clearline nightly LinkedIn + targets builder (research-analyst)" | live (was 01:37); adds competitor/regulation watch |
| 01:27 | sdr | "Clearline LinkedIn daily pack (sdr, night)" + follow-up check | live (was 07:49 weekdays), Mon-Fri |
| every hour at :49 | sdr | "Clearline sender" | unchanged: sends only 9:00-17:00 in each recipient's time zone, so US/EU follow-ups go out overnight SGT within the caps |
| 02:27 | content-marketer (week 2) | "Clearline marketing daily" | still 10:37 weekdays; moves when content-marketer is hired |
| 03:27 | devops (week 2) | "Clearline devops nightly" | created in week 2 |
| 07:27 | chief-of-staff | "Clearline daily briefing (chief-of-staff)" | live (was 08:24 weekdays), every day |

## Daytime and weekly (unchanged)

| Time | Employee | Scheduled task |
|---|---|---|
| Weekdays 10:51 | sdr (partners) | "Clearline partnerships daily" |
| Weekdays 11:13, 15:13, 19:13 | research-analyst | "Clearline lead research" |
| Weekdays 18:24 | sdr | "Clearline evening summary" |
| Mon 08:44 | chief-of-staff | "Clearline Monday plan" |
| Thu 16:29 | finance-admin (week 3; today the finance job) | "Clearline finance weekly" |
| Fri 17:13 | product-manager (week 2; today the product job) | "Clearline Friday ship review" |
| Sun 17:38 | chief-of-staff | "Clearline weekly wrap" |
| 1st of month 10:17 | chief-of-staff | "Clearline monthly update" |

## Approval mode and connectors

Every task above runs in **Auto** mode (no clicks) with the Gmail, Google Sheets/Drive/Docs/Calendar and
Notion connectors, except the new **lead-engineer** task: tasks created from a coding session get no
connectors and no mode. Open claude.ai → Scheduled tasks → "Clearline lead engineer nightly
(lead-engineer)" → Edit: add the Gmail and Google Sheets connectors and set the mode to Auto. Until then
it can't read the Product roadmap tab or check PAUSE in Gmail. The one-off
"Day-1 sending review + ramp decision" is tied to Aashmiin's MacBook Air: it runs only if the Mac is on.

## What never happens overnight

Emails to new people beyond the queue she saw at 18:24; anything to customers, mentors or investors;
payments, prices, contracts; merging to `main`; deleting data or branches. These wait in the 07:30
approval queue. A failure or anything risky stops that task only, is logged with `RISK:`, and leads
the briefing. PAUSE (Settings, or reply PAUSE to any Clearline email) stops everything.
