# Pilot test results

Source: `trysarathy/investigation-desk`, branch `pilot-operating-desk`, code at `d94177e` (later commits: screenshots/docs
only). Recorded 5 Nov 2026 in the build session. **Everything is synthetic; payouts are manual-evidence or sandbox.**

## What was run against the new pilot logic
| Suite | What it exercises | Result |
|---|---|---|
| `python3 -m unittest discover -s tests/pilot` | domain, commands, API, auth, capacity races (threads + OS processes), routes, sandbox, imports, connector, export, backup/restore, **challenger (40, real server + DB)**, integration-owner regressions (2) | **183 OK** |
| `node tests/browser/pilot.cjs` | UI owner's journey on the real server (Kestrel/Lindqvist invoice), decline, keyboard path, stale version, correction, hand-off, CSV import, viewer, other org, 1366/390 layouts | **77/77** (3 of 4 runs; one run hit a 10 s wait timeout — timing flake, not a wrong value) |
| `node tests/browser/pilot_lead_journey.cjs` | integration owner's **unscripted** invoice (Tamarind/Ostrava, USD 37,820.40 / SGD 51,276.15), two users, **three server restarts** across Mon 30 Nov → Tue 1 Dec → Mon 7 Dec, sandbox timeout → query → credit, partial + final repayment, close, export reproduction, failed-payout recovery, wrong-currency return | **56/56** |
| Container (`deploy/pilot/Dockerfile`, `PILOT_ENV=pilot`) | random initial passwords, dev passwords refused, Secure/HttpOnly/SameSite=Strict cookie, security headers, minimal health, case persists across `docker restart`, other org 404, **backup → restore into a separate empty volume → same case at the same version**, corrupt backup refused | passed (manual run, recorded in this session) |

Not pilot coverage (regressions only): the mentor demo engine suites (`python3 -m unittest discover -s tests`, 208 OK)
and the demo browser suite on the deployed files (`lifecycle.cjs` on `clearline-funding-desk@5c61373`, 596/596; deep
link `#reference/sf201b297698f` opens the Friday decision, build 5e2df82).

## Independent challenger (attacked the running server and DB boundary)
Material, fixed in `d94177e` with tests: (1) provider events after close were acknowledged and dropped → now recorded,
the case goes to **post-close review** in the queue, and a reviewer can reopen and authorise reinstruction; (2) an
exception close could strand a payer's held cash → refused until held cash is returned/resolved and the payout
outcome is final. Minor, fixed: per-org case numbering (`CL-2026-HL-00001`), 422 instead of 500 for oversized amounts
and out-of-range times, `cancelled_before_payout` refused once a payout exists.
Resisted (33 tests): cross-org read/search/export/evidence/commands/sandbox by exact id (404, nothing leaks), CSRF on
every mutation, session fixation, viewer mutations, operator→reviewer commands (403), four-eyes, 8 concurrent
approvals from separate processes (exactly 5 fit the SGD 500,000.00 limit), concurrent draw/instruct/match (exactly
one each), replayed/forged/out-of-order provider events, no second payout after a timeout, duplicate bank refs, client
`known_at` ignored, stale/absent/other-currency balances → unknown, cutoff edges, malformed amounts, wrong currency and
excess held and returnable, reverse match, XSS/CSV injection in exports, evidence type checks, size limits, live
backup → restore into a separate DB reconciling every view, export and table hash.

## Implemented but not verified
- Hosting on a real platform (no account or credentials in this session) and HTTPS in front of the container.
- A real payout provider connector (only the sandbox and manual evidence route exist).
- Reservation expiry runs lazily on reads/commands, not on a background timer.
- Multi-process serving (one server process by design with SQLite).
- Long-running operation (weeks of data), backup scheduling and off-site backup storage.
