# Goals and metrics for a pre-revenue startup

## Principles
- **One north star, defined with a formula and a canonical source.** GitLab names one north star and puts
  the canonical source and formula next to every KPI [VERIFIED S8]. Ours: **paying founding pilots**.
- **Reflect before you set.** Every plan opens with last period's result vs target [VERIFIED S12].
- **Lead with what moves the needle**: PostHog asks "What single thing would move the needle the most?"
  [VERIFIED S12]. At 0 customers, that is almost always: more strong-problem calls → more pilot offers.
- **Growth and trends over cumulative totals**; acknowledge thin data [VERIFIED S2]. With n < 10, report
  counts, not rates or "what's working" (house rule, from the old weekly wrap).
- **Never drop a metric because it looks bad**: "Removing things because you can't hit your milestones is bad" [VERIFIED S17, 2026-10-31].

## The goal (Goals & metrics tab, read 2026-10-29) [VERIFIED I1]
30-day goal to **28 Nov 2026: 5 paid founding pilots = US$1,500 cash collected; 10 pilots offered.**
Offer: Founding pilot US$300 for 30 days, then US$200/month, first 10 businesses (Settings
PILOT_PRICE_USD 300, MONTHLY_PRICE_USD 200, FOUNDING_SLOTS 10; Decisions log 2026-10-29).
Next-platform unlock: 3 customers using verified profiles + first wallet/exchange willing to test the
lookup API (strategy, not a weekly metric).

Week-1 targets (to 4 Nov) on the tab: qualified leads 150, first emails 50, replies 3, calls held 3,
strong calls 1, pilots offered 1, pilots paid 0, cash 0, MRR 0, partner conversations 2, content 2,
bounce < 2%. The tab's "Current (live)" column is typed, not formula-driven: recompute (below).

## The funnel and exact formulas
| # | Metric | Formula (canonical source) | Owner |
|---|---|---|---|
| ★ | **Paying pilots** | Opportunities rows with status = `paid` (cross-check: Finance rows type `income`, status `paid`, same invoice_no). Leads stage `Paying` is a secondary check; mismatch = flag | Aashmiin + finance |
| 1 | Qualified leads (unsent) | Leads tier 1/2, email_label VERIFIED-*, with no D0 Touches row | research-intern |
| 2 | First emails sent | Unique emails in Touches with step `D0` and status in sent/replied/bounced/complaint/unsubscribed (`gtm/metrics.py`) | revops-crm-agent |
| 3 | Reply % / positive % | replied ÷ (2); positive = notes start with "positive" (`gtm/metrics.py`) | revops-crm-agent |
| 4 | Calls booked | Calls status `booked` + `held` (Dashboard formula) | revops → her |
| 5 | Calls held | Calls status `held` | Aashmiin |
| 6 | Strong-problem calls | Calls problem_score `Strong` | Aashmiin |
| 7 | Pilots offered | Opportunities with offered_date set (status offered/accepted/invoiced/paid/declined) | Aashmiin + sales-closer-assistant |
| 8 | Pilots accepted | status accepted/invoiced/paid | - |
| 9 | Cash collected | Σ Finance amount_usd where type income and status paid | finance |
| 10 | MRR committed | Customers rows plan = monthly, status ≠ churned × MONTHLY_PRICE_USD [ASSUMPTION: the tab has no price column; confirm the definition with her] | finance |
Guardrails (must hold while chasing the funnel):
| Metric | Formula | Limit |
|---|---|---|
| Bounce % (7 d and all-time) | bounced ÷ first emails (Touches) | < 2% (auto-throttle > 3%) |
| Complaints | Touches status complaint | 0 |
| Emails in last 30 days | Touches status sent, date ≥ today-29 | alert 900; stop 1,000 (bulk line) |
| Spot-check factual errors | Spot checks factual_error = yes | 0 |
| Nights with `main` green | QA product health first line GREEN | every night |
| Decisions within 24 h; items waiting > 24 h | Decisions log vs briefing Log map | ≥ 80%; 0 |
Prefer `python3 -m gtm.cli metrics --dir work` output when the repo is reachable; otherwise compute from
the tabs with the formulas above and say "computed from tabs".

## Conversion and pace (Sunday report, Monday plan)
- Stage conversion = next ÷ previous, shown **with both counts** ("2 of 9 calls Strong"). Rates only
  where the denominator ≥ 10; below that, counts only.
- Pace to goal: remaining = target − current; days left to 28 Nov; required per week = remaining ÷ weeks
  left. Say on track / behind with the numbers, e.g. "Pilots paid 0 of 5, 23 days left (3.3 weeks): need 1.5/week".
- Working backwards (the planning chain, [GUESS] until there is data): 5 paid ← ~10 offered (the tab's
  own 2:1 assumption) ← Strong calls ← calls held ← positive replies ← first emails. Replace each
  assumed ratio with the observed one as soon as its denominator ≥ 10, and say which you used.

## Decision rule after 10 calls (Dashboard tab)
≥ 4 Strong → offer pilots · 2-3 → narrow the segment · ≤ 1 → rethink. When Calls held reaches 10, this
becomes a DECIDE item in the next briefing with the counts.

## How to state a number
`Calls held: 2 (Calls tab, 07:20)`; missing: `MRR committed: not recorded (Customers tab empty)`;
conflict: `First emails sent: 16 by Touches; Dashboard shows 0 - formula issue, flagged`.
Never: "about", "roughly", "~" on a count that exists; projections in a results table; a number with no
source.
