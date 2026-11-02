# Script: treasury / payments / cross-border payouts

Use with `SCRIPT_CORE.md`. Replaces the core's story block. Who: treasury, head of payments or the founder
who funds cross-border payouts (remittance, marketplace, payroll, exporter/importer paying suppliers).
DRAFT, 2026-11-02.
Main hypotheses: **H3 (research only)** and **H2**; H1 lightly. Matt's point: pre-funding in cross-border
payments is a real pain: we test whether it is, for whom, and how big, **in their numbers**. We say nothing
about Clearline doing pre-funding: it doesn't, and H3 has no product intent this sprint.

| # | Question | Tests | Supports if they say… | Refutes if they say… |
|---|---|---|---|---|
| 1 | "Walk me through the last cross-border payout run you funded: where did the money sit before it went out, and for how long?" | H3 | Money parked days ahead in a foreign account/partner; named amount and days | Paid same day from home account; no pre-funding |
| 2 | "Last month, roughly how much was sitting pre-funded at any one time, and in which corridors?" | H3 | A number they know (their number only) | "Don't track it" / immaterial |
| 3 | "What did that pre-funding cost you last quarter: interest, FX spread, a credit line, a missed opportunity?" | H3 | Named cost lines; someone has calculated it | No cost they can name |
| 4 | "Have you used or tested stablecoins for any part of this? Tell me what happened, including what went wrong." | H3/H2 | Pilot run, with friction (on/off-ramp, compliance, accounting) | Never considered; or tried and it was irrelevant |
| 5 | "When you last moved money via stablecoins, how did you get from fiat to USDC/USDT and back? Who did you use?" | H3/H2 | OTC desk/exchange named; spreads; settlement times | — (context; note names for intros) |
| 6 | "What currency is your company's reporting in? How did last month's stablecoin balances and conversions get valued and booked?" | H2 | Non-USD books; manual FX; lot tracking by hand | USD books; instant conversion |
| 7 | "Tell me about the last time an incoming or outgoing stablecoin transfer was delayed, short or on the wrong network. What happened?" | H1/H4 | Dated story, cost, who fixed it | Never |
| 8 | "Who needs to know the moment money lands, so they can act (pay out, release, rebalance)? How do they find out today?" | H1 | Manual checks, chat messages, delays | Automated notifications already trusted |
| 9 | "What have you tried to reduce pre-funding (banks, PSPs, netting, credit lines, stablecoins)? Why that, and how did it go?" | H3 | Active search for alternatives; budget spent | Satisfied with bank/PSP |
| 10 | "Which of these was the biggest headache for your team last month?" | all | One pain, with numbers | None |
| 11 | "Who else should I speak to: a PSP, an OTC desk, a peer who has the same problem?" | advance | Intros | — |

H3 note for the log: every H3 row is **research**; it goes to gtm-strategist and research-intern, not to
product-manager as a roadmap ask, unless Aashmiin decides otherwise.
