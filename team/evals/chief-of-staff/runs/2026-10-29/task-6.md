# Task 6 - Decision memo: sending domain + inboxes now, or keep personal Gmail? (Thu 5 Nov 2026, 21:05 request)

Sources: `facts.md` (Sheet/scripts as of 5 Nov 20:30; AGENTS.md prices; `prompts/RULES.md` domain-mode rules),
`request.md`. I would deliver this as a Google Doc and link it in tomorrow's briefing.

---

WOULD WRITE (Google Doc in her Drive): **"Clearline decision memo - sending domain 2026-11-05"**

## Recommendation
Buy the domain and 2 inboxes now and start warm-up only. Keep sending from your Gmail exactly as today.
Decide the switch on 28 Nov, or at once if Gmail warns you. I recommend this because warm-up takes 3
weeks before the domain can carry real volume, and the risk it insures against is losing your main
inbox. The cost is small [ASSUMPTION on prices]; your time is the real cost.

## Context and why now
- You send from aashmiin@gmail.com (`SEND_MODE` gmail_personal). Caps: 50 first / 75 total per day,
  a risk you accepted on 28 Oct, with "revisit: if any Gmail warning" (Decisions log).
- Actual volume is far below the caps: 18 sends per weekday on average over the last 5 weekdays; 104
  sends in 30 days; 61 first emails since 29 Oct. Bounce 1.6%, complaints 0. No Gmail warnings or limit
  notices so far (Touches, Gmail search, 5 Nov 20:30).
- Risks tab: "Personal Gmail flagged/locked at 50-75 cold emails/day - Medium [ASSUMPTION] - High: lose
  the main inbox". That inbox also holds mentor threads, prospect replies and every Clearline email.
- Domain mode can't send cold email in week 1. The ramp is 0 in week 1 (warm-up), 20/day in week 2,
  35/day in week 3 and 50/day from week 4, and each step needs bounce < 2%, no complaint and
  PLACEMENT_OK. Nothing sends until DOMAIN_READY (SPF, DKIM, DMARC) and UNSUBSCRIBE_READY. Once
  SEND_MODE = domain and DOMAIN_READY = TRUE, ALL cold email stops from your Gmail, and you import a
  daily CSV into the sending tool (`prompts/RULES.md`).
- So a domain bought now only reaches today's level (about 18-20/day) in its second week, around
  19-26 Nov [ASSUMPTION: 1-2 days to set up], and passes it in week 3, as the 30-day goal ends.
  It doesn't raise volume for the 28 Nov goal. It is insurance and future capacity.

## Options
| | A. Buy now, warm-up only (recommended) | B. Keep Gmail, buy on a trigger | C. Buy and switch as soon as ready |
|---|---|---|---|
| Cost [ASSUMPTION: AGENTS.md, "check current prices"] | Domain about US$12/yr + 2 inboxes about US$14/month + warm-up/sequencer about US$37/month = about US$63 first month, then about US$51/month | US$0 until a trigger | Same as A |
| Your time [GUESS] | About 1-2 h setup (DNS, Workspace, tool) this or next week; no daily import until you switch | 0 now; the same 1-2 h later, under pressure | Setup + daily CSV import (5-10 min/day) from about week 2 |
| Upside | If Gmail is flagged, a warmed domain is ready within weeks, not starting from zero | Saves money and setup time in the pilot-offer weeks | Gets cold email off your Gmail sooner |
| Risk | Paying for unused capacity if volume stays at 18/day | If Gmail warns or locks, about 3 weeks with little or no cold email, and inbox loss if it locks | Volume drops to 0-20/day for 1-2 weeks at the point you need replies |
| Reversibility | Two-way: cancel the subscriptions; about US$12 sunk | Two-way | Two-way, but the volume dip can't be undone |
| Time to undo | Minutes (cancel) | - | Switch SEND_MODE back (your call) |

## What the data says and how good it is
- 6 weekdays of sending, 61 first emails, 2 replies (1 positive), 0 warnings. That is thin: it says the
  current pace is safe so far, not that 50/day would be.
- The Gmail-lock likelihood ("Medium") is an [ASSUMPTION] on the Risks tab, not measured.
- Prices are [ASSUMPTION] from AGENTS.md and not checked this run. Finance shows no costs and no
  budget recorded, so this would be Clearline's first recorded spend.
- Leads are not the constraint: 171 qualified unsent, plus 50-70 added per weekday.

## Who was consulted
Settings, Touches, Leads, Finance, Risks and the Decisions log (via facts as of 5 Nov 20:30); AGENTS.md
(prices); `prompts/RULES.md` on gtm-os (domain-mode rules). No employee was asked to act.

## What happens on each answer
- A: you buy the domain, 2 Workspace inboxes and the warm-up tool (I can't buy anything). devops
  writes a step-by-step for SPF/DKIM/DMARC, for you to apply. DOMAIN_READY stays FALSE until the checks
  pass. Your Gmail sending is unchanged. I add a Decisions log row and an update to the Risks
  mitigation, and finance-admin logs the costs in Finance. The switch is a separate decision on 28 Nov.
- B: nothing is bought. I add a Decisions log row with the triggers: any Gmail warning or limit
  notice; bounce 7d > 2%; or a plan to send more than 35/day. On any trigger, it becomes a DECIDE item
  in the next briefing (or a RISK email if Gmail locks).
- C: as A, plus revops-crm-agent prepares SEND_MODE = domain for when DOMAIN_READY = TRUE. It needs
  your yes again at that point, because it stops all cold email from Gmail.

## Revisit trigger
28 Nov goal review (volume plan for December), or the first Gmail warning, whichever comes first.

---

## Short-form DECIDE item for tomorrow's briefing (Fri 6 Nov 07:27)
```
D1. Buy the sending domain + 2 inboxes now? (by Mon; two-way door) - memo: <Doc link>
Why now: warm-up takes 3 weeks; Gmail: 18/day, 0 warnings.
A. Buy, warm up only, keep Gmail - about US$63 first month [ASSUMPTION].
B. Keep Gmail; buy on first warning - US$0, but about 3 weeks without cold email then.
C. Buy and switch when ready - volume dips for 1-2 weeks.
I recommend A: cheap insurance for your main inbox. Data: thin (6 days).
Reply `D1 A`. No reply = nothing bought.
```

## ACTIONS I WOULD TAKE
| # | Tool | Target | Content |
|---|---|---|---|
| 1 | Google Docs (create in her Drive) | "Clearline decision memo - sending domain 2026-11-05" | The memo above. |
| 2 | Sheets (append) | Decisions log | `2026-11-05 | PENDING: Sending domain + inboxes now (A warm-up only / B on trigger / C switch when ready) | Her question 5 Nov 21:05; memo <Doc link> | Aashmiin (waiting) | 28 Nov or first Gmail warning` |
| 3 | Gmail | - | Nothing sent tonight; the DECIDE item goes in the 6 Nov 07:27 briefing, which she asked for ("I'll decide tomorrow morning"). |
| 4 | Sheets (append) | Log | `2026-11-05 21:2x | chief-of-staff | decision memo created | | sending domain memo <Doc link>; D1 in briefing 2026-11-06` |

## Notes
- I don't buy, sign up or change `SEND_MODE`/caps; all of that is hers. The memo's default (no reply) changes nothing.
- Every number is from facts.md; prices are labelled [ASSUMPTION], as AGENTS.md labels them. Setup time and timeline are [GUESS]/[ASSUMPTION].
- Cost sums: 12 + 2×7 + 37 = 63 for the first month; 14 + 37 = 51/month after (domain yearly). These are sums of assumed prices, labelled as such.
- I flagged that domain mode adds a daily CSV import to her 60-minute budget once she switches, which is why the switch is a separate decision.
