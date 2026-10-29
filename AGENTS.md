# Clearline: the team

Aashmiin Kaur is the founder and the only human. Everyone below is an AI employee: a Claude Code
subagent defined in `.claude/agents/<name>.md`, plus, for most of them, a cloud scheduled task that runs
it on a timetable. All of them read `company/COMPANY_RULES.md` first, write to the Company HQ Sheet,
log every action, stop on PAUSE, and never send anything to customers, mentors or investors, or touch
money, without your approval.

## Org chart

| Team | Employee | One-line job | Owns the metric | Status |
|---|---|---|---|---|
| Ops | **chief-of-staff** | Morning briefing + approval queue, Monday plan, Sunday report, decision log | Decisions made / items waiting > 24 h | Week 1 ✅ |
| Engineering | **lead-engineer** | Builds the top 1-2 roadmap items as small tested PRs | Roadmap items shipped per week | Week 1 ✅ |
| Engineering | **qa-tester** | Tests `main` + open PRs nightly, e2e demo flows, fixes small failures on a branch | Nights with `main` green | Week 1 ✅ |
| Research | **research-analyst** | Leads with evidence, targets, LinkedIn list, competitor/regulation watch | Qualified leads/day, spot-check accuracy | Week 1 ✅ |
| Sales | **sdr** | GTM OS: queue, guarded sends, follow-ups, replies, LinkedIn pack, partner drafts | Calls booked/week, reply rate | Week 1 ✅ |
| Product | **product-manager** | Call notes → specs and the roadmap; Friday ship review | Roadmap items with a customer quote | Week 2 ✅ |
| Sales | **ae-assistant** | Call prep, call summaries, proposals, follow-up drafts | Calls → pilots offered | Week 2 ✅ |
| Marketing | **content-marketer** | LinkedIn company posts, SEO pages, case studies (drafts) | Posts/pages approved per week | Week 2 ✅ |
| Engineering | **devops** | Builds, deployments (Vercel preview on `website`), config fixes | Deploys green | Week 2 ✅ |
| Design | designer | Screens, website, decks via artifacts | Assets shipped | Week 3 |
| Marketing | video-producer | Demo films/clips with the existing Remotion pipeline (`demo/video`, branch `demo-video`) | Clips approved | Week 3 |
| Customer | delivery-specialist | Runs paying customers' close packs and reconciliation, QA before sending | On-time, error-free deliveries | Week 3 |
| Ops | finance-admin | Invoices, revenue dashboard, costs, contract templates (drafts) | Cash collected, days to collect | Week 3 |
| Engineering | code-reviewer | Reviews every PR for correctness before you merge | Bugs caught before merge | Week 3 |
| Engineering | security-reviewer | Secrets, auth, data access, dependency review | Open security issues | Week 3 |

Until an employee is hired, the existing scheduled task that does that job keeps running under its
current name (see the night shift table). Nothing is switched off when the agent file arrives.

## How to give an employee work

1. **Write it in the Company HQ.** A row in the tab they read is a work order:
   - Product roadmap (lead-engineer, qa-tester): status `next`, priority 1-3, one-line goal, link to a
     spec or call note.
   - Settings (sdr): caps, PAUSE, HOLD_DATES, BOOKING_LINK.
   - Content calendar (content-marketer), Customers (delivery-specialist), Finance (finance-admin).
   They pick it up on their next run.
2. **Reply to the morning briefing email.** The chief-of-staff reads your replies at 07:30 the next
   day and records them in the Decisions log: "yes to 1, no to 2, ask lead-engineer to do X first".
   `PAUSE` stops everything; `HOLD` stops only tomorrow's first emails.
3. **Ask one directly, now.** In a Claude Code session on investigation-desk, say
   "Use the qa-tester agent to test PR #31" or "@research-analyst: is company X a fit?". The agent
   files are loaded automatically from `.claude/agents/`.
4. **Change a schedule.** claude.ai → Scheduled tasks (or ask any session: "move the 23:30 lead
   engineer task to 22:00").

## How they work together

```
call (you) → ae-assistant: summary + quotes → product-manager: roadmap row + spec
  → lead-engineer: PR with tests → qa-tester: verifies overnight → you merge
  → product-manager marks it shipped → content-marketer: announcement draft
  → sdr: uses it in outreach and follow-ups → research-analyst: finds more companies with that pain
```
- **Leads**: research-analyst → Leads/Targets/LinkedIn list → sdr (evening queue, LinkedIn pack).
- **Bugs**: qa-tester → Product roadmap (`bug`) → lead-engineer → qa-tester → you.
- **Risks**: anyone logs `RISK:` → chief-of-staff puts it at the top of the briefing.
- **Customers** (once paying): delivery-specialist prepares the close pack → qa-tester-style check by a
  second agent → you approve → it's sent. finance-admin invoices from the Opportunities tab.

## The weekly cycle

| When (SGT) | What | Who | You |
|---|---|---|---|
| Mon 08:44 | Week plan: 3 outcomes, each employee's targets, your tasks, 3 decisions | chief-of-staff | Approve or edit by replying |
| Daily 23:00-07:30 | Night shift (below) | engineering, research, sales, marketing | Nothing |
| Daily 07:30 | Briefing + approval queue | chief-of-staff | 15 minutes |
| Weekdays | Sends, replies, research, LinkedIn pack, partners | sdr, research-analyst | Your calls; LinkedIn by hand |
| Weekdays 18:07 | Call summaries, follow-up and proposal drafts | ae-assistant | Send the drafts you like |
| Weekdays 18:24 | Evening summary with tomorrow's emails in full | sdr | Skim; reply HOLD if needed |
| Fri 17:13 | Ship review: PRs, what to merge, next week's build | product-manager | Merge |
| Sun 17:38 | Weekly report + spot check + mentor update draft | chief-of-staff | Read |
| 1st of month | Investor-style update draft | chief-of-staff | Edit and send yourself |

## Night shift (cloud scheduled tasks, not tied to your Mac)

Exact times are in `company/NIGHT_SHIFT.md`, with the scheduled task behind each slot and which ones
still need a click from you. In short: 23:00 qa-tester, 23:30 lead-engineer, 00:30 research-analyst,
01:30 sdr (LinkedIn pack + follow-up check), 02:30 content-marketer, 03:30 devops, 07:07 ae-assistant
(call prep), 07:30 chief-of-staff briefing. Follow-ups to the US/EU keep sending overnight from the hourly sender,
inside each recipient's 9:00-17:00 and the daily caps.

Overnight, nobody: emails new people beyond the queue you saw; writes to customers, mentors or
investors; pays, signs or quotes; merges to `main`; deletes data. Those wait for your 07:30 approval.

## Tools: what each employee uses

| Need | Claude tool | Employees |
|---|---|---|
| Code, tests, PRs | Claude Code (cloud), `gh` REST API | lead-engineer, qa-tester, devops, code/security-reviewer |
| Company HQ | Google Sheets connector | all |
| Email (send/draft/search) | Gmail connector, always through the guard | sdr, chief-of-staff (to you only), finance-admin (drafts) |
| Calls | Google Calendar connector | chief-of-staff, ae-assistant |
| Docs (SEO drafts, updates, invoices) | Google Drive/Docs connectors | content-marketer, chief-of-staff, finance-admin |
| Notes from calls | Notion connector (if you keep notes there) | ae-assistant, product-manager |
| Web research | WebSearch/WebFetch | research-analyst, content-marketer |
| Sales playbooks | Sales plugin (call-prep, call-summary, account-research, draft-outreach), Sales Follow-Up plugin | ae-assistant, sdr (drafts only; the guard still decides) |
| Marketing playbooks | Marketing plugin (content-creation, seo-audit, brand-review, competitive-brief) | content-marketer, research-analyst |
| Screens, decks, pages | Artifacts | designer |
| Films | Existing Remotion pipeline in `demo/video` (on the `demo-video` branch until PR #20 merges) | video-producer |

Apollo: its connector failed to connect from cloud sessions when this was set up (proxy refused).
Research works without it from public pages; leads are labelled VERIFIED-PUBLIC.

## Outside paid tools (only where Claude genuinely can't do the job)

| Tool | Why Claude can't | Cost [ASSUMPTION: check current prices] | When |
|---|---|---|---|
| A separate sending domain + 2-3 Google Workspace inboxes + a warm-up/sequencing tool (e.g. Instantly) | Going past ~75 emails/day safely needs warmed inboxes, rotation and a one-click unsubscribe header. The Gmail connector sends from one personal account and can't warm inboxes | Domain ~US$12/yr; Workspace ~US$7/inbox/month; sequencer ~US$37/month | Only when you decide to grow beyond personal-Gmail volume (RULES.md "domain mode") |
| Vercel Pro | Vercel's free Hobby plan is for non-commercial use; a company marketing site may need Pro [ASSUMPTION] | ~US$20/month | When the website goes public under the company name |

Everything else (research, writing, coding, testing, briefings, invoices as drafts, decks, films) runs
on your Claude plan.
