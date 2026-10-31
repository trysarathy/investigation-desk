# Schedules (all Singapore time, all cloud scheduled tasks)

Every slot is a cloud scheduled task on Aashmiin's claude.ai account. They run whether or not her Mac
is on. Each one starts a fresh session that clones investigation-desk and reads
`company/COMPANY_RULES.md` plus its own definition, knowledge pack and playbook (from the `ai-team`
branch until that is merged). It then checks PAUSE, does its job and logs it. Times sit a few minutes
off the hour, because the scheduler is busiest on the exact mark.

**Click needed** means the task was created from a coding session, so it has no connectors and no
Auto mode. To fix it, open claude.ai → Scheduled tasks → the task → Edit. Add the connectors named
and set the mode to Auto. Every other task already has its connectors and runs in Auto.

## Technical night (reorganised 1 Nov 2026)

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| 21:17 daily | tech-lead-architect | "Clearline nightly plan + evening progress": PR-sized tasks on branch `plan`, 14-day progress email | **click needed**: Gmail, Sheets, Auto |
| 22:47 daily | lead-designer | "Clearline nightly design tasks + Thursday review" | **click needed**: Sheets, Gmail, Auto |
| 23:27 daily | crypto-protocol-engineer | "Clearline nightly build" (assigned tasks only) | **click needed**: Gmail, Sheets, Auto |
| 23:47 daily | accounting-integrations-engineer | "Clearline nightly build (accounting-integrations-engineer)" | **click needed**: Sheets, Auto |
| 00:17 daily | matching-engine-engineer | "Clearline nightly build (matching-engine-engineer)" | **click needed**: Sheets, Auto |
| 00:47 daily | frontend-product-engineer | "Clearline nightly build (frontend-product-engineer)" | **click needed**: Sheets, Auto |
| 02:47 daily | code-reviewer | (created once its fresh hidden test passes) | not scheduled |
| 03:27 daily | devops-engineer | "Clearline nightly deploy check" (ruleset + CI) | **click needed**: Gmail, Sheets, Auto |
| 04:17 daily | qa-security-engineer | "Clearline nightly QA on PRs + product health" | live |
| 05:47 daily | crypto-finance-user | "Clearline release test as a finance user" (only if main changed) | **click needed**: Sheets, Auto |
| 06:17 daily | tech-lead-architect | "Clearline morning integration check + merge gate" | **click needed**: Gmail, Sheets, Auto |

Builders work only the tasks in `team/plan/tasks-<date>.md` and exit fast when they have none. Nothing
merges until main's ruleset requires the `ci` check AND code-reviewer is live.

## Day

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| 07:07 + 18:07 Mon-Fri | sales-closer-assistant | "Clearline call prep + after-call drafts" | **click needed**: Gmail, Sheets, Calendar, Docs, Drive, Auto |
| 07:27 daily | chief-of-staff | "Clearline daily" email | live |
| 18:13 Mon-Fri | revops-crm-agent, then chief-of-staff | "Clearline evening: prepare tomorrow's outreach + end of day" (drafts only) | live |

## Weekly and monthly

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| Mon 06:47 | research-intern | "Clearline weekly technical + regulation research" | **click needed**: Gmail, Sheets, Docs, Drive, Auto |
| Mon 08:44 | chief-of-staff | "Clearline Monday plan" | live |
| Thu 16:29 | finance job | "Clearline finance weekly" | live |
| Fri 14:13 | crypto-finance-user + lead-designer + chief-of-staff | "Clearline Friday product excellence pass" | **click needed**: Sheets, Gmail, Auto |
| Fri 17:13 | chief-of-staff | "Clearline Friday ship review" | live |
| Sun 17:38 | chief-of-staff | "Clearline weekly report + scorecards + worst outputs" | live |
| Sun 20:47 | devops-engineer | "Clearline weekly uptime + backup report" | **click needed**: Gmail, Sheets, Auto |
| Sun 21:47 | qa-security-engineer | "Clearline weekly security review" | **click needed**: Gmail, Google Sheets |
| 1st 09:43 | research-intern + fresh examiners | "Clearline monthly knowledge refresh + fresh hidden tests" | **click needed**: Gmail, Google Sheets, Auto |
| 1st 10:17 | chief-of-staff | "Clearline monthly update draft" | live |

## Paused 1 Nov (to save spend)
gtm-strategist (market brief), content-marketer (daily drafts), revops-crm-agent's hourly drafter,
LinkedIn pack and partner runs, research-intern's nightly targets and daytime lead research.

## What never happens without her
Nothing customer-facing is sent automatically: every email, follow-up, proposal and post is a draft
she sends herself. Never without her: anything to customers, mentors, advisors or investors;
payments, prices, proposals, invoices, contracts; posts in her name; merging anything on the
approval-only list (`company/OPERATING_MODEL.md` §2: keys, wallets, auth, secrets, permissions,
Xero/QuickBooks posting rules, money amounts, customer data, pricing, production/deploy settings,
deletions); deleting data or branches. A failure, a spend-limit stop or anything risky stops that
task only, is logged with `RISK:`, and leads the daily email. PAUSE stops everything.
