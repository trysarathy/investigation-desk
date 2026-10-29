# Clearline's AI team

You (Aashmiin) are the face of the brand: you get deals and close them. Your human advisors are your
board. Everything else is done by 14 AI employees. Each one is a Claude agent with a job description,
a researched knowledge pack, step-by-step playbooks, a quality rubric and a set of test tasks it must
pass (4/5 or better) before it is scheduled. The full standard is in `team/BUILD_STANDARD.md`.

**Single source of truth:** the Company HQ Google Sheet. Every employee reads it, writes its work there,
and logs every action in the Log tab.

## The org chart

```
                                   Aashmiin (CEO: brand, deals, closing)
                                   advisors = board
                                              │
                                       chief-of-staff
                         (runs the rhythm, briefs you, keeps HQ, holds the approval queue)
     ┌──────────────────┬──────────────────┬───┴──────────────┬───────────────────┬──────────────────┐
 ENGINEERING     PRODUCT & CUSTOMER   DESIGN & BRAND   RESEARCH & STRATEGY  REVENUE OPERATIONS   OPERATIONS
 crypto-protocol-  crypto-finance-user  lead-designer    research-intern      revops-crm-agent     finance-admin
  engineer (lead)  product-manager      content-and-     gtm-strategist       sales-closer-
 qa-security-      delivery-specialist   video-producer                        assistant
  engineer
 devops-engineer
```

## Who does what

| Employee | In plain English | Owns this number | Built |
|---|---|---|---|
| **chief-of-staff** | Your right hand. 07:30 briefing (overnight work, approvals, today's calls with prep, 3 decisions), 18:30 end of day, Monday plan, Friday ship review, Sunday report and the advisor update draft. Keeps Goals, Pipeline, Roadmap, Decisions and Risks current. | Decisions made within 24 h | Week 1 |
| **research-intern** | Finds and checks facts: market, competitors, regulation (GENIUS Act, MiCA, Hong Kong, MAS, India), funding news, company research, lead evidence. Labels every claim. Weekly "what changed in our market". Keeps everyone's knowledge pack fresh. | Qualified leads per day; spot-check accuracy | Week 1 |
| **crypto-protocol-engineer** | Tech lead. Builds Clearline features from the roadmap as small, tested PRs; the expert on chains, tokens, finality, address poisoning and issuer freezes. | Roadmap items shipped per week | Week 1 |
| **qa-security-engineer** | Tests everything nightly, including the nasty cases (short, over, duplicate, counterfeit, wrong network, reorgs, outages). Reviews security. Keeps the claims audit honest. Never lets failing code through. | Nights with `main` green | Week 1 |
| **revops-crm-agent** | Runs the pipeline: leads, scoring, personalised emails within the caps, follow-ups, replies, meeting booking, the CRM, your daily LinkedIn list, proposal and invoice drafts, payment tracking. | Meetings booked per week | Week 1 |
| gtm-strategist | ICP, positioning, messaging, pricing hypotheses, channels, enterprise vs mid-market, partners, the weekly experiment plan and what to scale or kill. | Experiments run and decided | Week 2 |
| crypto-finance-user | Plays an experienced finance manager at a crypto company: tests each release as a real user, gives blunt feedback, plays the sceptical buyer in mock calls. | Release usability score | Week 2 |
| sales-closer-assistant | Preps you for every call (account, people, objections, demo path), writes the follow-up and mutual action plan, keeps deals moving. Never negotiates or signs. | Calls → pilots | Week 2 |
| lead-designer | Product UI, website, decks, white paper layouts, brand system, at Stripe/Linear standard, desktop and phone, accessible. | Screens shipped at standard | Week 2 |
| devops-engineer | Builds, deployments (website and product), monitoring, backups, uptime. | Deploys green | Week 2 |
| product-manager | Turns calls, feedback and research into specs and a ranked roadmap with acceptance criteria. Protects focus: one wedge at a time. | Roadmap items with customer evidence | Week 3 |
| delivery-specialist | Runs paying pilots: data intake, reconciliation and close packs, QA before anything goes out. | On-time, error-free deliveries | Week 3 |
| content-and-video-producer | LinkedIn posts in your voice (for you to approve), company posts, SEO pages, case studies, demo films. | Posts approved per week | Week 3 |
| finance-admin | Invoices, payment tracking, costs, revenue dashboard (MRR, pipeline value), bookkeeping records, contract templates. | Cash collected | Week 3 |

**Until a role is rebuilt, its predecessor keeps working:** devops (→ devops-engineer),
ae-assistant (→ sales-closer-assistant), content-marketer (→ content-and-video-producer),
product-manager (rebuilt in week 3), and the "Clearline finance weekly" task (→ finance-admin).

## How you give them work
- **Reply to any Clearline email** (briefing, end of day, ship review). The chief-of-staff reads replies
  and routes them. "PAUSE" stops everything; "HOLD" stops tomorrow's first emails.
- **Add a row** in Company HQ: Product roadmap (to build), Decisions log (to decide), Targets (to research).
- **Ask directly** in a Claude Code session: "Use the research-intern to…" (the definitions live in
  `.claude/agents/`).

## The hand-off chain
sales call → sales-closer-assistant summary → product-manager spec → crypto-protocol-engineer build →
qa-security-engineer verify → crypto-finance-user test → content-and-video-producer announce →
revops-crm-agent uses it in outreach.

## Always yours to approve
Anything to customers, investors, advisors or mentors; pricing, proposals, contracts and invoices
before they're sent; posts in your name; merging to `main`; spending money; deleting data; first-time
outreach beyond the level you've unlocked. These wait in the 07:30 approval queue.

## What they need from you
1. **15 minutes at 07:30**: approve or reject the queue, answer the 3 decisions.
2. **Call notes** after each call (a few lines in the Calls tab), so the follow-up and the roadmap are real.
3. **Merges**: the PRs the Friday ship review says are ready.
4. **LinkedIn by hand**: the daily list of notes and DMs (they never touch LinkedIn).
5. **Connectors and Auto mode** on scheduled tasks when the briefing says one is missing.

Daily routine: `company/CEO_DAILY_60_MINUTES.md`. Rules: `company/COMPANY_RULES.md`. Schedules:
`company/NIGHT_SHIFT.md`.
