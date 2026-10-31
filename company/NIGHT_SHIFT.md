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
| 22:53 nightly | qa-security-engineer | "Clearline nightly QA + security" (also posts `QA: PASS/FAIL` on reviewed PRs) | live |
| 23:27 nightly | crypto-protocol-engineer | "Clearline nightly build" (work order, definition of done, auto-merge rails) | **click needed**: Gmail, Google Sheets, Auto |
| 00:27 nightly | research-intern | "Clearline nightly targets + LinkedIn list + watch" | live |
| 01:27 Mon-Fri | revops-crm-agent | "Clearline LinkedIn daily pack + follow-up check" (drafts only) | live |
| 02:27 Mon-Fri | content-marketer | "Clearline marketing daily" (drafts only; claims rule) | live |
| 03:27 nightly | devops-engineer | "Clearline nightly deploy check" (CI + branch protection + deploys) | **click needed**: Gmail, Google Sheets, Auto |
| 05:47 daily | crypto-finance-user | "Clearline release test as a finance user" (acts only if main changed) | **click needed**: Google Sheets, Auto |
| every hour at :49 | revops-crm-agent | "Clearline sender": **PREPARE ONLY** since 1 Nov. Gmail drafts labelled "Clearline to send" + Approval Queue rows; sends nothing | live |

## Day

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| 07:07 + 18:07 Mon-Fri | sales-closer-assistant (replaced ae-assistant) | "Clearline call prep + after-call drafts" | **click needed**: Gmail, Sheets, Calendar, Docs, Drive, Auto |
| 07:27 daily | chief-of-staff | "Clearline daily" email (≤ 300 words: built/merged, needs approval, research, today's customer work) | live |
| 10:51 Mon-Fri | revops-crm-agent | "Clearline partnerships daily" (drafts only) | live |
| 11:13, 15:13, 19:13 Mon-Fri | research-intern | "Clearline lead research" | live |
| 18:13 Mon-Fri | revops-crm-agent, then chief-of-staff | "Clearline evening: prepare tomorrow's outreach + end of day" (drafts only) | live |

## Weekly and monthly

| Time | Employee | Scheduled task | Status |
|---|---|---|---|
| Mon 06:47 | research-intern | "Clearline weekly research brief" (ends with "What this means for the product") | **click needed**: Gmail, Sheets, Docs, Drive, Auto |
| Mon 07:47 | gtm-strategist | "Clearline weekly market brief" | **click needed**: Gmail, Sheets, Docs, Drive, Auto |
| Mon 08:44 | chief-of-staff | "Clearline Monday plan" | live |
| Thu 14:47 | lead-designer | "Clearline design review" | **click needed**: Sheets, Gmail, Auto |
| Thu 16:29 | finance job | "Clearline finance weekly" | live |
| Fri 14:13 | crypto-finance-user + lead-designer + chief-of-staff | "Clearline Friday product excellence pass" | **click needed**: Sheets, Gmail, Auto |
| Fri 17:13 | chief-of-staff | "Clearline Friday ship review" (call notes → specs + roadmap rows) | live |
| Sun 17:38 | chief-of-staff | "Clearline weekly report + scorecards + worst outputs" | live |
| Sun 20:47 | devops-engineer | "Clearline weekly uptime + backup report" | **click needed**: Gmail, Sheets, Auto |
| Sun 21:47 | qa-security-engineer | "Clearline weekly security review" | **click needed**: Gmail, Google Sheets |
| 1st 09:43 | research-intern + fresh examiners | "Clearline monthly knowledge refresh + fresh hidden tests" (failing agents paused until re-tested) | **click needed**: Gmail, Google Sheets, Auto |
| 1st 10:17 | chief-of-staff | "Clearline monthly update draft" | live |

## What never happens without her
Nothing customer-facing is sent automatically: every email, follow-up, proposal and post is a draft
she sends herself. Never without her: anything to customers, mentors, advisors or investors;
payments, prices, proposals, invoices, contracts; posts in her name; merging anything on the
approval-only list (`company/OPERATING_MODEL.md` §2: keys, wallets, auth, secrets, permissions,
posting to Xero/QuickBooks, money amounts, customer data, pricing, production/deploy settings,
deletions); deleting data or branches. A failure or anything risky stops that task only, is logged
with `RISK:`, and leads the daily email. PAUSE (Settings, or reply PAUSE to any Clearline email)
stops everything.
