# Pilot test results

**Tested source:** `trysarathy/investigation-desk`, branch `pilot-operating-desk`, commit **`d5ace26`** (later commits:
docs only). Recorded 6 Nov 2026. Everything synthetic; payouts manual-evidence or sandbox. Readiness: **locally
verified** (not hosted, not verified with any provider's data).

## Suites run at d5ace26
| Suite | Covers | Result |
|---|---|---|
| `python3 -m unittest discover -s tests/pilot` | domain, commands, API, auth, capacity races (threads + processes), routes, sandbox, imports, connector, export, backup/restore, §13 v2 tests, scenario tests A ×2 / G / H, challenger round 1 (40) and round 2 (24), integration regressions | **227 OK** |
| `node tests/browser/pilot.cjs` | UI owner's journey + §13 screens (intake refs, blockers by kind, decision record, replay, duplicate banner, overdue, report), keyboard-only command, 1366/390 | **136/136** |
| `node tests/browser/pilot_brief_scenarios.cjs` | scenario A exact (USD 12,400 / SGD 16,800, fee 60) and different amounts (USD 7,315.55 / SGD 9,912.47) in a CLI-provisioned blank org, two users, restarts, export reconstruction; evidence-clears vs cash-blocks contrast; reviewer decline; replay | **29/29** |
| `node tests/browser/pilot_lead_journey.cjs` | unscripted Tamarind case across three restarts, sandbox timeout → query → credit, failed payout recovery, wrong-currency return | **56/56** |
| Pilot-mode container (`clearline-pilot:d5ace26`) | CLI provisioning in a blank org, scenario A over HTTP with a real `docker restart` mid-journey, operator self-approval refused, backup → restore into a separate empty volume → identical case, exposure, 16 events, identities | **passed (manual run in this session)** |
| Mentor demo regressions (not pilot coverage) | `python3 -m unittest discover -s tests` 208 OK; deployed demo files at `clearline-funding-desk@5c61373`: `lifecycle.cjs` 596/596 (earlier run), deep link `#reference/sf201b297698f` opens build 5e2df82 with no errors (rechecked 6 Nov) | passed |

Known flake: the UI suite once hit a 10 s wait timeout (1 of 5 runs, earlier build); no wrong value was ever observed.

## Independent challenger
- Round 1 (on 3a70135, 40 tests): 2 material + 4 minor, fixed in d94177e (post-close provider events; exception close
  with held cash; per-org case ids; 422s; cancelled-before-payout).
- Round 2 (on 495629c, 24 tests): 4 material + 6 minor, fixed in d5ace26 — a second invoice cleared a potential
  duplicate; a late duplicate didn't block approval; a wrong-currency/amount invoice satisfied the invoice policy;
  repayment allocation followed current rather than approved terms; plus approved terms shown on reserved cases, money
  named as the binding constraint with missing evidence, per-org evidence ids and per-case event ids, future replay
  422, other-currency balance and importer-scoped evidence no longer satisfying policy. Resisted: replay leakage,
  client-set known_at, cross-org duplicate inference, import/race bypass, version reuse, re-request after decline,
  measurement on closed cases, default declaration rules, upgrade from d94177e mid-lifecycle.
- Not re-challenged after d5ace26 (fixes verified by the challenger's own tests, not by a third round).

## Implemented but not verified
- Hosting: no hosting account or credentials in this session; HTTPS termination untested.
- A real payout-provider connector (only manual evidence and the signed sandbox exist).
- Reservation expiry runs lazily on reads/commands (no background timer).
- One server process with SQLite (no horizontal scaling); long-running operation, scheduled and off-site backups.
- Any real baseline: every pilot report is "not measured" or "synthetic".
