# How Clearline's AI team works (Aashmiin's operating model, 1 Nov 2026)

**The one question every employee is judged on:** did Clearline get closer this week to a product a
finance team would pay US$300 for? The standard is the best fintech product teams (Stripe, Linear,
Ramp): correct to the cent and the day, fast, clear, secure, honest about what it does.

**Aashmiin does everything customer-facing**: outreach, calls, sales, pricing, partnerships, posting,
and deciding what is `next`. The team researches and builds.

## 1. Research (autonomous; contacts no one)
- **research-intern** (Mon 06:47 SGT) and **gtm-strategist** (Mon 07:47) write the weekly brief:
  competitors; regulation (MAS, US GENIUS Act, EU MiCA, HKMA, India); stablecoin payments and
  accounting-sync developments. They also keep `team/research/buyer-pain.md` current: real evidence of
  buyer pain only, each item linked and labelled.
- `[VERIFIED]` only when the primary source was opened; otherwise `[ASSUMPTION]` (company rule 2).
- Every brief ends with **"What this means for the product"**: at most 3 concrete roadmap suggestions,
  each added as a Product roadmap row with status `proposed`. Only Aashmiin sets `next`.

## 2. Build (autonomous within these rails)
**Order:** (1) UTC posting-date bug (`bug/xero-posting-date-timezone`): use the Xero organisation's own
timezone, and fix QuickBooks the same way; (2) the reorg dismiss bug; (3) the security gaps
(`team/SECURITY_GAPS.md`, by severity); (4) the lead-designer contrast fix as a PR; (5) the roadmap in order.

**Definition of done for every change:**
1. A spec with acceptance criteria, written into the PR description and linked roadmap row.
2. Tests written first and failing (or the existing `it.fails` test switched to `it`).
3. The fix.
4. All checks green: CI (install, typecheck, lint, tests, build) on the PR.
5. **Code review by code-reviewer** (a separate agent; never the author), using
   `team/playbooks/code-review.md`, recorded as a PR comment whose first line is
   `CODE REVIEW: APPROVE <head sha>`, `CODE REVIEW: CHANGES REQUESTED <head sha>` or
   `CODE REVIEW: BLOCK <head sha>`. A BLOCK stops the PR until code-reviewer lifts it.
6. **qa-security-engineer passes it**, recorded as a PR comment `QA: PASS <head sha>`.
7. A demo-mode check and a real-mode check where relevant (stated in the PR with what was run).
8. A one-paragraph plain-English changelog entry in `CHANGELOG.md`.

**Who merges:** tech-lead-architect's morning run (06:17 SGT) is the merge gate. It merges
(`gh api -X PUT .../pulls/<n>/merge -f merge_method=squash`) only when ALL of these are true, checked at
merge time:
- **Protection is on.** `gh api repos/trysarathy/investigation-desk/rules/branches/main` lists all of
  `pull_request`, `non_fast_forward`, `deletion` AND `required_status_checks` including `ci`.
  (main uses a repository ruleset, so the old `branches/main/protection` endpoint returns 404 even
  when protection is on: never use it as the test.) As of 1 Nov the ruleset has the first three but
  **no required status check**, so nothing auto-merges until Aashmiin adds "Require status checks:
  ci".
- CI (`ci` check) is green on the PR's head commit;
- both `CODE REVIEW: APPROVE <head sha>` (signed `— code-reviewer ·`) and `QA: PASS <head sha>` (signed
  `— qa-security-engineer ·`) exist for the current head sha, and no unlifted BLOCK. Every agent posts
  from Aashmiin's GitHub account, so the signature and the sha are what count, never the account;
- the diff is under ~300 changed lines;
- nothing in the approval-only list below is touched.
If CI or protection isn't set up, devops-engineer fixes that first and nothing auto-merges until it is.

**Approval-only (never auto-merge, always her click):** anything touching keys, wallets, auth,
secrets, permissions, Xero/QuickBooks posting rules and posting, money amounts, customer data, pricing, production or
deploy settings, or deletions. These go to the Approval Queue tab with a 3-line summary and the risk.
Note: the UTC posting-date fix touches posting to Xero/QuickBooks, so it is approval-only.

**Friday product excellence pass** (Fri 14:13): crypto-finance-user and lead-designer (product-manager's
part is done by chief-of-staff until product-manager is rebuilt) use the product end to end as a
finance controller closing the month. Every confusing screen, unclear message, slow step and wrong
number becomes a roadmap row (`proposed`) with a screenshot or reproduction.

## 3. Customer-facing: Aashmiin only
- **Nothing is sent automatically.** revops-crm-agent and sales-closer-assistant only PREPARE: lead
  lists, Gmail drafts (label "Clearline to send"), call briefs, follow-ups, proposals, all listed in the
  Approval Queue. She sends everything herself.
- content-marketer drafts only; she posts.
- When she logs call notes in Calls or Customers, they become specs and `proposed` roadmap rows with
  the customer's exact words (sales-closer-assistant at 18:07, and the Friday ship review).
  crypto-finance-user updates its persona only from real call notes.

## 4. Getting better
- **Every Sunday** chief-of-staff fills Scorecards from real data and lists each agent's worst output
  of the week with the fix made to its playbook.
- **Monthly** a fresh examiner writes new hidden tests for every agent (same pass mark, zero rule
  breaks). An agent that fails is retrained, and its scheduled tasks are paused until it passes.
- **An agent wrong about a fact twice in a month** gets its knowledge pack re-verified.

## 5. Her daily email (chief-of-staff, 07:27 SGT, ≤ 300 words)
What was built and merged (plain English); what needs her approval; research worth acting on;
today's customer work for her: who to contact, with the draft ready.

## 6. The technical team (reorganised 1 Nov 2026)
**Nightly technical team:** tech-lead-architect (plan 21:17, merge gate 06:17), crypto-protocol-engineer,
accounting-integrations-engineer, matching-engine-engineer, frontend-product-engineer, code-reviewer,
qa-security-engineer, devops-engineer, lead-designer. Builders work ONLY the tasks tech-lead-architect
assigned in `team/plan/tasks-<YYYY-MM-DD>.md` and exit quickly when they have none.
**Still running:** chief-of-staff (daily email, Sunday scorecards), research-intern (Monday technical
and regulation research only), sales-closer-assistant (call-prep drafts for Aashmiin only),
revops-crm-agent's one weekday evening drafting run (drafts into the Approval Queue; sends nothing).
**Paused to save spend:** gtm-strategist, content-marketer, revops hourly/LinkedIn/partner runs,
research-intern's lead and target research.
**The 14-day target** (Day 1 = 1 Nov, Day 14 = 14 Nov 2026) is owned by tech-lead-architect:
`docs/PLAN_14_DAY.md`, reported every evening as done / in progress / blocked.

## 7. Cost
Keep runs efficient: read only what the task needs, exit early when there is nothing to do, one
agent per task. If any run hits a spend or usage-limit error: finish the current task safely (push
the branch, no half-merged state), stop, write a Log row starting "RISK: spend limit", and the next
daily email says so first.
