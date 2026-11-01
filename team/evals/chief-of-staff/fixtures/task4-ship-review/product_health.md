# Gmail fixture (FICTIONAL): "Clearline product health 2026-11-05" (qa-tester, Thu 5 Nov 23:21)
RED: main still has the 2 rounding failures from #38 (fix is #42, not merged yet).
- #42 qa-fix -> main: GREEN 3/3 (unchanged). Merge first.
- #41 month-end report at head 7a1d0b2: GREEN 3/3, e2e ok.
- #40 Tron requests at head 2b7c4aa: RED - 1 failing (trc20 memo parsing), a different test from last night.
- #43 Xero retry: draft, not tested.
- #44 remove demo seed: vitest GREEN 3/3, but the e2e demo flow FAILS ("load demo day" button missing; the PR removes it on purpose).
