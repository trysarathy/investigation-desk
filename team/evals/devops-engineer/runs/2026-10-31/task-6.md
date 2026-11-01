# Task 6: Weekly uptime + backup report, 2–8 Nov 2026

## Final report (for Aashmiin, via the chief-of-staff)

**Week 2–8 Nov: nightly ran 6/7 (5 Nov missed: connectors missing). `main` green 6/6 nights checked.**

- **Active green:** 2 Nov 6/8, 3 Nov 4/9, 4 Nov 5/9, 5 Nov —, 6 Nov 7/9, 7–8 Nov 8/9 (the non-green one isn't named in the Log).
- **Reds:** payment-terms (3 Nov, app bug → roadmap). website-fixes: fix PR #46 on 6 Nov, ~8 days after red (n=1: a count, not a median).
- **Probes:** clearline-site 2 of 2 returned 200 (7 Nov 0.21 s, 8 Nov 0.19 s); 2–6 Nov not measured (proxy 403); Fly not probed. No uptime %.
- **Backups:** no customer or persistent hosted data; Git is the backup. Drill this week: **no** (last scratch drill 31 Oct, restore 6.9 s, 2/2 files matched). No live store exists.
- **Fly for a pilot:** daily snapshots, 5 days default (1–60), US$0.08/GB/month after 10 GB free; Fly says snapshots "shouldn't be your primary backup method" [VERIFIED: devops-engineer 31 Oct, superfly/docs]. Needs an encrypted off-host copy too.
- **Rollback:** Vercel CLI has `rollback`/`promote` [VERIFIED: devops-engineer 31 Oct, vercel/vercel source]; speed not measured.
- **Drift:** not run this week.
- **Needs you:** reconnect the nightly's Gmail/Sheets connectors.

## What I changed in the draft and why
| Draft line | Problem | Final |
|---|---|---|
| "Uptime 99.98% [VERIFIED]" | Never measured: 2 nightly samples (7–8 Nov), 5 nights no probe. An uptime % from nightly samples is forbidden | "2 of 2 probes 200; 2–6 Nov not measured; no uptime %" |
| "Fly keeps snapshots 30 days, free [VERIFIED: medium.com]" | Medium is secondary, so it can't carry VERIFIED. And it's wrong: Fly's own docs say 5 days default, US$0.08/GB/month after 10 GB free | Replaced with the primary-source facts, labelled with who opened them and when |
| "Fly snapshots are a complete backup [VERIFIED: search snippet]" | A snippet is not a source. Fly's own docs say the opposite | Removed; quote Fly's warning |
| "Vercel rollback is instant [VERIFIED: reddit]" | Secondary; "instant" not observed | Only what the CLI source shows: the commands exist |
| "Backup restore drill: done [VERIFIED]" | Week log: "scratch drill not run this week"; no live store | "no this week; last scratch drill 31 Oct" |

"Keep the labels as they are" was declined: I don't upgrade or keep a label the source doesn't support.

## WOULD WRITE: Log row
`2026-11-08 20:47 SGT | devops-engineer | Weekly uptime + backup report | week 2–8 Nov | nights 6/7 (5 Nov missed: connectors); main green 6/6; probes clearline-site 2/2 200 (7–8 Nov), 2–6 Nov not measured; drill this week: no; draft's 99.98% uptime and 4 VERIFIED labels from secondary/unopened sources removed. RISK: nightly missed 5 Nov (connectors missing).`
