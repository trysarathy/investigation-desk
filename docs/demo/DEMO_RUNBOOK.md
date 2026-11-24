# Demo runbook: `npm run demo` (local, offline, fictional)

Labels: **[VERIFIED]** run on the build machine or read in the code; **[ASSUMPTION]** reasoned, not tested.

The demo is the Clearline pilot app with one fictional provider, **Provider P (demo)**, and one fictional merchant,
**Northwind Travel (demo)**, labelled **"Demo · fictional data"** on every screen. Every name, address, hash, account
and amount is fictional; the only real values are the public USDT (TRON, Ethereum) and USDC (Ethereum) contract
addresses. It runs on one machine with no network at build or run time.

A **demo build** is a `next build` made with `CLEARLINE_DEMO_BUILD=1`. Only a demo build contains the demo's
conveniences (recorded chain data for a demo organisation, the reset route and the "Reset demo" button); a real build
cannot turn them on at run time (see "Demo build vs real build").

## Prerequisites

| Need | Version | Notes |
|---|---|---|
| Node.js | 22 (CI uses 22.22.0; the Dockerfile `node:22-slim`) | there is no `.nvmrc`; `npm ci` once, as for any checkout |
| PostgreSQL 16 | **either** Docker Desktop (the default: `docker-compose.demo.yml` runs `postgres:16`), **or** a local PostgreSQL 16 server and its superuser URL in `CLEARLINE_DEMO_PG_URL` | the demo makes its own database (`clearline_demo`) and logins |
| Disk | about 1 GB | the build (`.next-demo/`) and the database |
| Ports | 3100 (app) and 54330 (Docker PostgreSQL), both on 127.0.0.1 | `CLEARLINE_DEMO_PORT`, `CLEARLINE_DEMO_PG_PORT` change them |

## Commands

```bash
npm ci                    # once per checkout (the demo never installs anything itself)
npm run demo              # set up (first time), build, start; prints the URL, logins and password
npm run demo -- --fresh   # start over: drop the demo databases and the demo build, seed and build again
                          # (`npm run demo --fresh` works too: npm passes it as npm_config_fresh)
npm run demo -- --no-start  # everything except starting the app
npm run demo:reset        # back to the seeded state, timed (the app may keep running)
npm run demo:files        # rewrite demo-files/ (they are committed; only needed after changing the demo world)
```

With a local PostgreSQL 16 instead of Docker:

```bash
CLEARLINE_DEMO_PG_URL='postgres://postgres:<superuser password>@127.0.0.1:5432/postgres' npm run demo
```

## What `npm run demo` does

| Step | What happens | Skipped on a re-run when |
|---|---|---|
| (a) PostgreSQL | `CLEARLINE_DEMO_PG_URL` if set; else the server saved in `.demo/state.json`; else a server answering on 127.0.0.1:54330 that accepts the saved Docker password; else `docker compose -f docker-compose.demo.yml up -d --wait` (postgres:16, named volume `clearline-demo-pg`, health check) | — (checked every time) [ASSUMPTION for the Docker path: the build machine had the Docker CLI but no daemon, so only the "Docker is not running" stop was run; the timings below used a local PostgreSQL 16 through `CLEARLINE_DEMO_PG_URL`] |
| (b) database and logins | `clearline_demo`, and the owner, runtime and jobs logins with random passwords saved in `.demo/state.json` (mode 0600, git-ignored) | they exist. On a server that already has these logins, the demo uses them only if they accept the saved passwords (or the server trusts local connections); it never changes them unless `--reset-role-passwords` |
| (c) migrations | `drizzle-kit migrate` as the owner (0000–0031) | — (idempotent, about 2 s) |
| recorded chain file | `.demo/chain-recording.json`: every demo transfer (the 30 days and the demo-files day) | — (rewritten, deterministic) |
| (d) seed | the demo world, one day at a time, with a reconciliation per entity after each day (below) | seeded |
| (e) template | `clearline_demo_template`, a copy of the seeded database for `npm run demo:reset` | made |
| (f) demo build | `next build` with `CLEARLINE_DEMO_BUILD=1 CLEARLINE_CONTROL_PILOT=1` into `.next-demo/` (output in `.demo/build.log`), then the bundle check `--marker demo --expect present` | the same commit was built and the check passes (a dirty tree always rebuilds) |
| (g) start | `next start -H 127.0.0.1 -p 3100` with the recorded chain file, uploads in `.demo/uploads` (encrypted with a key from the state file) and the reset settings | `--no-start` |

What it prints at the end [VERIFIED]:

```
Clearline demo — Demo · fictional data
  URL       http://127.0.0.1:3100/control/sign-in
  Logins    finance@northwind.demo   (Finance: uploads, reconciles, prepares write-offs)
            approver@northwind.demo  (Approver: approves what Finance prepared)
            viewer@northwind.demo    (Viewer: read only)
            admin@northwind.demo     (Admin: settings, members)
            ops@providerp.demo       (Provider ops at Provider P (demo))
  Password  demo-…                   (shared by every demo login; fictional, local, in .demo/state.json)
```

The shared demo password is generated once per install (20 characters) and is the only secret ever printed. Other
passwords, the auth secret and the upload key stay in `.demo/state.json`.

### Time on the build machine [VERIFIED]

`npm run demo -- --fresh` from an empty database, local PostgreSQL 16 through `CLEARLINE_DEMO_PG_URL`, Linux container,
Node 22.23.5 (`npm run demo --fresh` at commit "the reset route no longer closes the app's pool"):

| Step | Time |
|---|---|
| (a) PostgreSQL found | 27 ms |
| (b) database and logins | 0.1 s |
| (c) migrations 0000–0031 | 1.3 s |
| (d) seed: 30 days, 90 reconciliation runs | 55.0 s |
| (e) template | 0.3 s |
| (f) demo build | 78.6 s |
| total until the app was ready on 127.0.0.1 | 139 s (the script's own total, without starting the app: 137.4 s) |
| `npm run demo:reset` (app running) | 0.23–0.47 s, printed by the command (target < 30 s) |
| "Reset demo" button (the route) | 0.53 s |

A re-run without `--fresh` on a clean tree skips the seed, the template and the build: about 2 s to start.

## The demo world

- **Dates.** The demo's "today" is **Tuesday 2026-12-08** (`src/lib/clearline/demo/clock.ts`). The data covers the 30
  days 2026-11-08 … 2026-12-07; `demo-files/` holds the files of 2026-12-08. Chain verification for the demo
  organisation reads at 2026-12-08 10:00 SGT whatever the machine's date, and the seed runs on a simulated clock, so
  runs, exceptions and proposals carry demo dates and the data never ages. [ASSUMPTION] What a presenter does during
  the demo (an approval, a new run) is stamped with the machine's clock.
- **Entities.** Singapore SGD book `NW-SG` (Xero; account `NW-SGD-OPS-DEMO-01`), the Singapore company's USD account as
  its USD book `NW-SG-USD` (Xero; `NW-USD-OPS-DEMO-02`), and UAE `NW-AE` (AED, QuickBooks; `NW-AED-OPS-DEMO-03`). There is
  no table of bank accounts: an entity has one functional currency, and the account a batch or statement names is a
  text reference, so the USD account is a second entity row in USD (as rc6 Case 2 and the synthetic month preset do).
- **Payments.** 1,500 orders across TRON and Ethereum, USDT and USDC (seeded synthetic generator, seed 20,261,207):
  daily settlement batches with a 1% fee, refunds netted in later batches, timing items across the provider and
  merchant days, held payments (BK-24871 and one more), under- and overpayments, re-quotes after expiry, partial
  payments across chains, exchange senders and wallet hops (facts only; no screening decisions).
- **The three documented cases**, with their own amounts, ids and dates: Case 1 (BK-24817/24823/24830/24836, batch
  B-1124-001 net 5,961.24) and Case 2 (B-1125-SGD: 44,412.30 → 40,228.68, BK-24871 held) in `NW-SG`; Case 2's USD
  payments in `NW-SG-USD`; Case 3 (BK-25102, AED 14.16) in `NW-AE`. Generated payments avoid the cases' days in those
  books, because the bridge runs per merchant day.
- **Bank lines** are a simulated bank feed (source `seed_fictional`, provenance "Demo bank feed (simulated,
  fictional)"), as the rc6 sample seed does. The imported-bank-line flag is **off** for every entity; a statement
  uploaded during the demo is "imported, not bank-authenticated" and never verifies a settlement.

### What the seed holds [VERIFIED, `npm run demo -- --fresh` on the build machine]

| Rows | Count |
|---|---|
| orders (invoices) | 1,500 (NW-SG 909, NW-SG-USD 235, NW-AE 356) |
| provider payment records | 1,488 |
| chain facts (source `chain_client`, from the recorded file, with evidence) | 1,486 |
| payment links (partial payments) | 54 |
| settlement batches / refund lines | 89 / 8 |
| bank lines (simulated demo feed) | 94 |
| reconciliation runs | 90 (30 days × 3 entities, each at 09:00 SGT the next morning) |
| journal proposals (pending sign-off) | 1,564 (1,563 proposed, 1 superseded) |
| write-off proposals | 178: 154 proposed, 14 awaiting the Approver, 10 approved |
| open exceptions | 114, each with an owner team, reason, next step and an assigned person (finance@northwind.demo) |

Decisions of the 1,471 evaluated payments (29 orders are unpaid and not evaluated):

| Decision | Count | Share | Rules |
|---|---|---|---|
| matched | 1,154 | 78.4% | M5.batch.tied_verified 1,154 |
| matched with difference | 178 | 12.1% | M4.tolerance.within_band 178 |
| suggested for review | 25 | 1.7% | explained outside the band 16, not final yet 6, above the write-off threshold 3 |
| exception | 114 | 7.7% | batch not tied yet 84 (the bank credit for the last batches is due on the demo day or later, and Case 1 shares a provider day with Case 2's prior batch), underpaid beyond the band 10, overpaid beyond the band 8, unknown batch 3, unexplained 3, no chain transfer 3, held by the provider 2, look-alike token 1 |

Differences by type: sender-side fee 59, underpayment 48, rate difference 45, overpayment 40, re-quote after expiry 29,
partial payment open 9, unexplained 3.

[ASSUMPTION] Case 1's batch (B-1124-001) and Case 2's prior batch (B-1124-SGD) share provider day 24 Nov in the same
SGD book. The bridge runs per merchant day, so B-1124-SGD shows Case 1's four payments as unexplained and does not
tie (3 exceptions). Case 1's 5,961.24 and Case 2's 44,412.30 → 40,228.68 bridges are exact and tied.

## Reset

- `npm run demo:reset` ends every session on `clearline_demo`, drops it and creates it again from
  `clearline_demo_template` (owned by the schema owner), clears `.demo/uploads`, and prints the time (target < 30 s).
  A running app recovers by itself: its pool drops the ended connections and opens new ones.
- **"Reset demo" button** (top of every merchant and provider page, next to the data label): shown only in a demo
  build and only for a demo organisation. **Any signed-in member of a demo organisation may use it, whatever the role**
  [ASSUMPTION: every demo login belongs to a presenter, and the data is fictional]. It calls
  `POST /api/control/demo/reset` (exact Origin, session, demo organisation; a member of a live or sample organisation
  gets 404, and in a real build the route is 404 for everyone). The seeded state has no sign-in sessions, so after a
  reset everyone signs in again.

## Role switcher (demo build only)

Next to the data label and "Reset demo", a demo build shows **"Sign in as"** with the five demo logins. Switching
**signs in as that seeded user**: the server creates a real session for them (as a password sign-in does) and ends
the presenter's current one (`POST /api/control/demo/switch`, `src/server/demo-switch.ts`). There is no impersonation
flag, so whatever happens next is recorded as that user, and every rule still applies: Finance can propose, an Approver
approves, and Finance signing in again through the switcher still cannot approve her own proposal (the server and the
database's maker-checker check refuse it). Each switch is written to the audit history. [VERIFIED by
`tests/control/demo-switch.test.ts` and the demo journey]

Who may switch: a signed-in member whose organisations are **all** demo organisations, to a user whose organisations
are all demo organisations too. Anyone else gets 404, and in a real build the route is 404 for everyone and its code is
not in the bundle (the demo controls are imported only inside the build-constant branch, `src/components/merchant/DemoBar.tsx`).

## The demo journey in the browser (`playwright.demo.config.ts`)

```bash
CLEARLINE_DEMO_PG_URL=… npx playwright test -c playwright.demo.config.ts               # both specs, 1440 px and iPhone
CLEARLINE_DEMO_PG_URL=… npx playwright test -c playwright.demo.config.ts journey.spec.ts --project=desktop
```

The web server (`scripts/demo/e2e-server.ts`) runs `npm run demo -- --no-start` (sets up, seeds and builds what is
missing, with this checkout's `.demo/state.json`) and starts the demo build on `CLEARLINE_DEMO_E2E_PORT` (default 3402).
Each spec resets the demo database first, so do not present from the same checkout while it runs.

- `tests/e2e-demo/journey.spec.ts`: the 13 steps (overview, daily report, payments filters and search, BK-24823,
  its exception, the switcher and the self-approval refusals, the B-1125-SGD waterfall, BK-25102, month-end, exports
  and the Viewer refusal, the upload of `demo-files/` checked against `expected-outcomes.json`, the provider console,
  settings), with axe (WCAG 2.2 AA) at 1280 px and 390 px, no horizontal scroll, no console error and no 5xx on
  every page it visits.
- `tests/e2e-demo/pages.spec.ts`: every journey page, the median of 5 loads (must be under 1 s; written to
  `test-results/demo-page-times-<project>.json`) and axe.

## Demo build vs real build

| | Real build (`next build`) | Demo build (`CLEARLINE_DEMO_BUILD=1 next build`) |
|---|---|---|
| Recorded chain data (`CLEARLINE_CHAIN_RECORDING`) | refused at start and per call (unless a test build) | honoured only for an organisation whose data mode is `demo`; refused for live and sample ones |
| Live chain reads, ledger pull | as configured | refused at start (offline) |
| `POST /api/control/demo/reset`, "Reset demo" | 404 / not rendered; the code is not in the bundle | present |
| `POST /api/control/demo/switch`, "Sign in as" (role switcher) | 404 / not rendered; the code is not in the bundle | present, for members of demo organisations only |
| Data mode `demo` (migration 0031) | the label still shows; nothing else changes | as left |
| Check | `node scripts/build/check-chain-recording.mjs --marker demo --expect absent` | `NEXT_DIST_DIR=.next-demo node scripts/build/check-chain-recording.mjs --marker demo --expect present` |

`CLEARLINE_DEMO_BUILD` is read only by `next build` (next.config.mjs inlines it like `CLEARLINE_TEST_BUILD`); setting it
when a real build starts changes nothing. A demo build also needs `CLEARLINE_CONTROL_PILOT=1` and refuses
`CLEARLINE_TEST_BUILD=1`, `CLEARLINE_CHAIN_LIVE=1` and `CLEARLINE_LEDGER_PULL=1`. Never deploy a demo build.

## demo-files/ (the demo day, 2026-12-08)

| File | What it is | How to bring it in (Finance unless noted) |
|---|---|---|
| `northwind-sg-bookings-2026-12-08.xlsx` | the day's 24 bookings (order list), sheet "Bookings" | Uploads → entity `NW-SG`, type "Orders or invoices"; map Booking → Order ID, Book → Entity, Amount due, Currency, State (open), Booked (SGT) → Issued at (format "08-Dec-2026", +08:00) |
| `provider-p-payments-2026-12-08.csv` | Provider P's export in a layout Clearline has no template for (own headers and order, "08-Dec-2026 08:12:33" Singapore times), with quote terms and each payment's credit and fee | type "Provider export"; map every column (the mapping used by the test is in `expected-outcomes.json`, "mappings"); status words COMPLETE → paid, SHORT → underpaid, REPRICED → re-quoted |
| `northwind-sgd-statement-2026-12-08.camt053.xml` | the SGD account's camt.053 for the day: the bank credits for batches B-SGD-20261205 (a day late) and B-SGD-20261207 | type "Bank statement" (no mapping); **an Approver confirms it** (a second person) |
| `expected-outcomes.json` | what those uploads and one "Reconcile now" for `NW-SG` give (decisions, rules, batches), written by `tests/control/demo.test.ts` | — |

What the three files give after upload, confirmation (the statement by an Approver) and "Reconcile now" for `NW-SG`
[VERIFIED, recorded in `expected-outcomes.json` by `tests/control/demo.test.ts`]:

- 24 + 24 rows accepted, 2 statement lines (source `file_import`: imported, not bank-authenticated).
- The two statement lines tie batches B-SGD-20261205 and B-SGD-20261207 to the cent, but **settlement is not verified**
  (the imported-bank-line flag stays off): their 65 payments move from "exception: batch not tied" to "suggested for
  review: M5.bank.imported_not_verified". Nothing closes on an imported statement.
- The 24 new payments are verified against the recorded chain data with their quote terms. 23 wait for settlement
  (no payout yet: "suggested for review: M5.grouping.proposed_needs_confirmation"), and BK-39021, underpaid by 6%, is an
  exception (M4.tolerance.underpayment_beyond_band) with an owner, reason and next step.
- NW-SG decisions before → after: matched 697 → 697, with difference 97 → 97, review 14 → 103, exception 87 → 22.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Port 3100 is already in use` | an earlier `npm run demo` still runs (its pid is in `.demo/server.pid`), or another app uses the port: stop it, or `CLEARLINE_DEMO_PORT=3110 npm run demo` |
| `Port 54330 is in use by something the demo cannot sign in to` | another PostgreSQL (or service) is on 54330: stop it, or `CLEARLINE_DEMO_PG_PORT=54331`, or point `CLEARLINE_DEMO_PG_URL` at it |
| `Docker is not running (or not installed)` | start Docker Desktop and run again, or use a local PostgreSQL 16 with `CLEARLINE_DEMO_PG_URL` |
| `The login clearline_owner already exists … with a password this demo does not know` | the server already hosts another Clearline database; the demo never changes those passwords. Use the Docker default (its own server) or another server. Only if nothing else uses that server: `npm run demo -- --reset-role-passwords` |
| `npm run demo:reset` failed half-way | run `npm run demo`: when the demo database is missing it is recreated from the template; if the template is missing too, it seeds again |
| Stale state (`.demo/` from an older version, a deleted Docker volume, odd data) | `npm run demo -- --fresh`; if the state file itself is broken, delete `.demo/` (and `docker compose -f docker-compose.demo.yml down -v` for the Docker volume) and run `npm run demo` |
| `next build failed; see .demo/build.log` | read the log; a build needs no network, so a failure is a code or dependency problem (`npm ci`) |
| The app shows "Your data" or "Test mode" instead of "Demo · fictional data" | you are signed in to a different organisation, or the app was built without `CLEARLINE_DEMO_BUILD=1` (use `npm run demo`, not `next start` on `.next`) |
| Signed out after a reset | expected: the seeded state has no sessions. Sign in again with the same demo password |

## How "offline" was checked

[VERIFIED] The final `npm run demo --fresh` above ran with every Node process (npm, the tsx script and its seed,
drizzle-kit, `next build` and its 8 workers, the bundle check, `next start`) preloading a guard
(`NODE_OPTIONS=--require net-guard.cjs`, kept outside the repository) that logs and refuses every TCP connection, DNS
lookup and `fetch` to anything but the loopback interface, and with `HTTPS_PROXY`/`HTTP_PROXY` pointing at a dead port
(127.0.0.1:9). The app was then driven over HTTP on 127.0.0.1: sign-in for Finance, Viewer and Provider ops; the daily
report, payments, exceptions, batches, runs, approvals, uploads and provider pages; "Reconcile now" for NW-SG (chain
verification against `.demo/chain-recording.json` inside the demo build); the reset route; sign-in again; and
`npm run demo:reset` with the app running. The guard was loaded by all 15 processes and logged **zero** outbound
connections, DNS lookups or fetches. A sanity run of the same guard on a script that calls `fetch`, `https.get` and
`dns.lookup` logged and refused all three, so the guard does see such calls.

Fonts were already local (`@fontsource/inter` and `@fontsource/jetbrains-mono`, OFL, bundled into `.next-demo/static/media`);
there is no `next/font/google`, CDN script or stylesheet, and the Content-Security-Policy allows only `'self'`. The
server bundle still contains a few third-party URL strings from libraries (Next's AMP runtime URL, Better Auth's
provider avatars, an API-reference CDN link); no demo page loads them, and the run above made no request to any of
them.
