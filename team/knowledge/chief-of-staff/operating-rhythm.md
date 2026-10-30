# Operating rhythm (all times SGT, UTC+8)

Internal sources: `company/NIGHT_SHIFT.md`, `AGENTS.md`, `company/MANAGE_IN_30_MINUTES.md`, Org chart tab
(read 2026-10-29), `prompts/RULES.md` on `gtm-os` [VERIFIED I1-I3]. External practice: S1, S5, S10, S12.

## Why a fixed rhythm
- Every company runs on cadences, and each cadence is reviewed at the next level down (strategy yearly,
  goals quarterly, etc.) [VERIFIED S1]. For Clearline the useful levels are **day, week, month**; the
  30-day goal (to 28 Nov 2026) is the "quarter" for now.
- 37signals asks every person "What did you work on today?" each afternoon and "What will you be
  working on this week?" each Monday; teams write a **kickoff** before a cycle and a **heartbeat**
  after it [VERIFIED S10]. Our equivalents: the 18:27 end-of-day (today), the Monday plan (kickoff),
  the Friday ship review + Sunday report (heartbeat).
- PostHog starts every planning round with a written reflection on the last period before setting new
  goals [VERIFIED S12]. So the Monday plan always opens with last week's result vs target.
- GitLab's Chief of Staff makes sure meeting preparation is "complete and correct" and that "action
  points coming out of meetings ... are implemented" [VERIFIED S4]. Here that means: every decision she
  makes is recorded and routed the same day, and checked the next morning.

## Her time budget (the constraint everything is designed around)
60 minutes of admin a day in total [her brief]. Calls with prospects are her real job and are not in it.
| Block | Minutes | What |
|---|---|---|
| Morning (after 07:27) | 20 | Briefing (≤ 10 min read) + reply with approvals and the 3 decisions; merge green PRs |
| Daytime | 15 | LinkedIn pack by hand; 3-5 lines of notes per call in the Calls tab |
| Evening (after 18:27) | 10 | End-of-day; skim tomorrow's first emails; HOLD if needed |
| Buffer | 15 | Mon plan (10), Fri merges (10-15), Sun report (10) use the buffer on those days |
[GUESS] split; the total is hers. Anything that would push a day over 60 minutes is cut, batched to the
weekly run, or turned into a default with a clear "reply only if you disagree" (never for gated items).

## Daily timeline (weekday)
| Time | Who | Produces | Goes to | CoS uses it for |
|---|---|---|---|---|
| 22:53 | qa-security-engineer (task still named "...(qa-tester)") | `Clearline product health <date>` email: GREEN/RED first line, per-branch counts, fix PRs; Log rows; roadmap `bug` rows | Aashmiin; CoS | Tests section; RED main → top of briefing; merge recommendations |
| 23:27 | crypto-protocol-engineer ("...(lead-engineer)") | PRs; roadmap → `in review`; 3-line Log note (shipped / blocked / needs decision) | Log; GitHub | Overnight line; `needs decision` rows → decisions |
| 00:27 | research-intern ("...(research-analyst)") | 30-50 Targets, LinkedIn list, `Research watch` (≤ 5 items), Risks rows for regulation | Sheet; Log | Overnight line; regulation items → Risks/decisions |
| 01:27 Mon-Fri | revops-crm-agent ("...(sdr, night)") | LinkedIn pack email; follow-up check | Aashmiin | "LinkedIn today" pointer with counts |
| hourly :49 | revops-crm-agent ("Clearline sender") | Guarded sends (9:00-17:00 recipient time), reply handling, Touches rows | Prospects; Sheet | Replies needing her; bounce/complaint alerts |
| 02:27 Mon-Fri | content-marketer | Post draft; `Clearline content to approve` | Aashmiin | Approval item [POST] |
| 03:27 | devops (→ devops-engineer wk 2) | "Deploys" Log row; fix PRs; `RISK:` for production down | Log | Top of briefing if red/production down |
| 07:07 Mon-Fri | ae-assistant (→ sales-closer-assistant wk 2) | Call prep Docs `Clearline call prep <company> <date>` | Drive | Calls section links |
| **07:27** | **chief-of-staff** | **Briefing + approval queue** | **Aashmiin** | - |
| 10:51 Mon-Fri | revops-crm-agent (partners) | Partner DRAFTS in Gmail | Aashmiin | Approval item [SEND] next morning |
| 11:13 / 15:13 / 19:13 Mon-Fri | research-intern | Leads (50-70/day target) | Sheet | Numbers |
| 18:07 Mon-Fri | ae-assistant / sales-closer-assistant | Calls tab summaries, follow-up and proposal DRAFTS | Sheet; Gmail drafts | End-of-day "drafts to send"; Friday call notes → roadmap |
| 18:24 Mon-Fri | revops-crm-agent | `Clearline evening summary`: next sending day's first emails IN FULL (Approval Queue rows) | Aashmiin | The queue in the end-of-day |
| **18:27 Mon-Fri** | **chief-of-staff** | **End-of-day** (proposed) | **Aashmiin** | - |

Overnight window for the briefing = everything logged since the previous briefing run started.
Weekend: QA, engineering, research, devops and the briefing run daily; revops LinkedIn pack, content,
call prep, partners, research daytime runs and the end-of-day are weekdays only.

## Weekly and monthly
| When | Run | Owner | Content | She does |
|---|---|---|---|---|
| Mon 08:44 | Week plan | chief-of-staff | Last week vs target; 3 outcomes; each employee's targets; her tasks (≤ 2 h/day incl. calls, per Risks tab); decisions | Reply yes / edits |
| Thu 16:29 | Finance weekly | finance job (finance-admin wk 3) | Finance tab, invoice drafts | Approve invoices |
| Fri 17:13 | Ship review | **chief-of-staff until product-manager is rebuilt (wk 3)** | PRs opened/merged/open; QA status; merge order; roadmap statuses; call notes → `proposed` rows; next week's build proposal | Merge; reply on `proposed` → `next` |
| Sun 17:38 | Weekly report + spot check + advisor update draft | chief-of-staff | Numbers vs targets, funnel, spot check, pipeline, decisions metric, advisor draft | Read; edit/send the advisor update herself |
| 1st 10:17 | Monthly update draft | chief-of-staff | Investor-style update (Doc) | Edit; send herself if she wants |

## Who reports what to whom (the chain)
call (her) → sales-closer-assistant summary + quotes (Calls tab) → (Fri) chief-of-staff / later
product-manager: `proposed` roadmap row → her decision → `next` → crypto-protocol-engineer PR →
qa-security-engineer verifies overnight → she merges → roadmap `shipped` → content-and-video-producer
announces → revops-crm-agent uses it in outreach → research-intern finds more companies with that pain.
Risks: anyone logs `RISK:` → chief-of-staff puts it first. Decisions: only her replies.

## 18:24 evening summary vs 18:27 end-of-day (open question for her)
**Today:** revops-crm-agent's 18:24 `Clearline evening summary` carries every queued first email in full;
week-1 lean mode says they go out from 9:00 recipient time **unless she replies HOLD to that summary**
[VERIFIED I2]. **New:** her brief asks the 18:30 end-of-day to include (or link) that queue in full with
the HOLD/PAUSE instructions.

Conflicts to manage:
1. **Race.** 18:27 starts 3 minutes after 18:24; the revops run may still be queueing. If the end-of-day
   copies the queue before revops finishes, she could approve-by-silence emails she never saw.
2. **Two emails, one HOLD.** HOLD is read by searching her replies to subject `Clearline` (RULES.md
   kill-switch section), so a HOLD on either email works only if both say which date it holds.
3. **"What she saw is what she approved."** The end-of-day must show exactly the rows revops showed:
   same queue_date, same count, same bodies. A different count is a RISK, not a rounding issue.
4. **Duplicate reading time.** Two evening emails with the same 50 bodies doubles her evening load.

Options (her decision; see playbook "End-of-day"):
- A. Keep both; end-of-day **links** the 18:24 summary and repeats only count + flagged emails. Cheapest
  change; two emails.
- B. **Recommended:** end-of-day becomes the single evening email (18:27 or later), revops writes the
  queue to the Approval Queue and Log by 18:24 but stops emailing; the end-of-day shows the queue in
  full and is the HOLD channel. One email, one place to HOLD. Needs revops' scheduled task prompt
  changed and a dry run on one evening.
- C. Move end-of-day to 18:41 to remove the race while keeping both emails.
Until she decides: run A, never start before revops' "evening summary sent" Log row exists for
today, and if it doesn't exist by the time you run, say so at the top and point her to the 18:24 email.
