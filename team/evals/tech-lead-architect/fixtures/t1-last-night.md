# State at 21:17 SGT Mon 2 Nov 2026 (Day 2) — fixture

Branch rule on main (GET /repos/O/R/rules/branches/main): ["deletion","non_fast_forward","pull_request"]
Classic protection: 404. origin/main = 0c7d9f1 (unchanged since Day 1).

Last night's task file (tasks-2026-11-01.md) had: T1 D1.1 docs (tech-lead) → PR #50; T2 D1.2 baseline
(devops) → done, logged "npm ci/tsc/vitest/build exit 0 @ 0c7d9f1"; T3 D1.3 ruleset instructions
(devops) → Approval Queue row added; T4 D2.1 (accounting-integrations) → PR #51; T5 D2.2
(crypto-protocol) → PR #52; T6 D2.3 (matching-engine) → PR #53.

QA nightly (22:53 Sun) result: PR #52 ci failure: `tests/requests.test.ts > demo case g duplicate
> marks paid once` expected 1 received 2.

Decisions log: 2026-11-02 10:05 "Aashmiin: ADR 0002 approved as written. Will merge #51 after reading
it tonight or tomorrow." No decision yet on: ADR 0001, scenario source (ADR 0003 not written yet),
branch rule, Xero developer app (not created), posting-rules spec (account codes).

Approval Queue (open): "Branch rule: require ci" (Day 1); "ADR 0001" (Day 1); "ADR 0002" (now approved).
