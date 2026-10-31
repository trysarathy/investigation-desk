# Test map: what the tests cover, how to run them, where the gaps are

Written 29 Oct 2026 from reading `tests/` and `src/` on `origin/main` at `fd9b992` (merge of PR #34)
and running the suite in a scratch export of that commit. Every count below was printed by a command
run that day [VERIFIED: run log]. Counts change with every merge: **never copy these numbers into a
report; run the suite and copy tonight's.**

## 1. How to run

Always in a scratch copy, never in the shared worktree (a stray `.data/` or `node_modules` there is a
commit risk, and other sessions share it):

```bash
S=<scratch dir>/<branch>-$(date +%Y%m%d)
mkdir -p "$S" && git -C /home/user/ai-team archive origin/<branch> | tar -x -C "$S"
cd "$S" && npm ci --no-audit --no-fund          # lockfile-exact; fails if package.json and lock disagree
npx tsc --noEmit                                 # typecheck (about 9 s)
for i in 1 2 3; do npx vitest run > vitest-$i.log 2>&1; echo "run $i exit $?"; grep -E "Test Files|Tests " vitest-$i.log; done
npx vitest run --reporter=json --outputFile=vitest.json   # per-file counts, for the report
npx next build                                   # production build
```

`git archive` exports the committed tree only: no `.env`, no `.data/`, no local edits, which is what
a reviewer and CI would see.

### Unit/integration (vitest)
- Config: `vitest.config.mts` includes `tests/**/*.test.ts`; aliases `@` → `src`, and `server-only` →
  `tests/stubs/server-only.ts` so server modules import in tests.
- `tests/real-record.test.ts` (57 tests) is **skipped unless `RECORD_REAL=1`**: it records real chain
  responses over the network. It is always "skipped", never "passed"; report it as skipped.
- No test needs the network, keys or a server otherwise. Route tests call the route's `POST`/`GET`
  directly with `DESK_DATA_DIR` set to a temp folder.

### End-to-end
| Branch | How | Notes |
|---|---|---|
| `qa-polish` (PR #31, not merged at `fd9b992`) | `npm run qa` = `node scripts/qa.mjs`: tsc, vitest, build, a live-mode server that creates one non-demo request, then a demo-mode server and `tests/e2e/qa_flows.mjs` (Playwright, Chromium) | Visits every page at 1280x800 and 390x844 (status, console errors, exceptions, failed requests, load time, phone overflow), plays demo cases a–g, the new-request form and the demo reset. `QA_PORT` (default 3400), `QA_SKIP_BUILD=1`, `SHOTS=<dir>`. Exit 0 only if every check passed |
| `main` | `tests/e2e/demo_cases.py` (Python Playwright): `npm run build && DESK_DATA_DIR=<tmp> npx next start -p 3300`, then `python3 tests/e2e/demo_cases.py <out_dir>` | Needs the Python `playwright` package; in the cloud session on 29 Oct it was **not installed** (Node Playwright 1.56.1 and Chromium were, at `/opt/pw-browsers`). If you can't run it, say so; do not mark e2e green |
| either, by hand | `DEMO_MODE=on`, load the demo day, play Acme's payment (send, mine, advance 12), approve under "In your books", check `/books` shows the posting and the audit entry | Fallback only; report as "manual e2e" with what you clicked |

Playwright from Node in this environment: `NODE_PATH=$(npm root -g) node ...` or the script's own
fallback to the global install (`qa_flows.mjs` does this).

### Results seen on 29 Oct 2026 [VERIFIED: commands run in scratch exports]
| Branch @ commit | tsc | vitest x3 | build | e2e |
|---|---|---|---|---|
| `main` @ `fd9b992` | pass (8.6 s) | 3 of 3 identical: 20 files passed, 1 skipped; **562 passed, 57 skipped** (619); 6.5–12.3 s | pass | not run on `main` (Python Playwright missing) |
| `qa-polish` @ `12abf33` | pass | 1 run: 21 files passed, 1 skipped; **573 passed, 57 skipped** (630) | pass | `npm run qa` exit 0: **113 of 113** e2e checks, median page load 130 ms, max 237 ms |

## 2. What each test file covers (main @ fd9b992, counts from the JSON reporter)

| File | Tests | Module(s) under test | What it proves |
|---|---|---|---|
| `engine.test.ts` | 145 | `src/lib/engine/*`, `catalogue.ts`, `normalise.ts`, `decimal.ts` | One fixture per diagnosis code D01–D18 + D99; rule precedence (D02 only for creditable deposits, D05 vs D06, D07b never outranks D07, D16, exact-match ledger verdicts); contradiction (D02 → D12); chain down → paused; prompt injection in ledger notes; reply templates never promise credit; input normalisation; decimals; look-alike matching; missing facts never match a rule |
| `real-cases.test.ts` | 62 | engine on recorded real chain responses (`tests/fixtures/real/*.json`) | 59 real public transactions with independently proven answers; chain rate-limited (429) or down (502) → paused, never "not found" or "failed" |
| `live.test.ts` | 55 | `chain/sources.ts`, fetchers, week-3 rules on recorded data | Data source per chain; Etherscan rate-limit body; D01 with every chain answering; D04 found on Polygon; D06 on BNB Chain against the declared contract; D09 freeze reads on Tron and Ethereum |
| `ai.test.ts` | 33 | `src/lib/ai/*` | Validator rejects invented numbers, addresses, banned words; template fallback; what is sent (customer IDs removed); prompt injection through chain data; paused case never calls the AI |
| `chain.test.ts` | 28 | `chain/http.ts`, `evm.ts`, `tron.ts`, `abi.ts` | Retries/backoff, rate-limit spacing, key redaction in stored URLs, SHA-256 of raw bodies, cache; ABI decoding; selectors computed; public JSON-RPC; D07b sender history; a failed freeze call never lets D12 through |
| `inbox.test.ts` | 31 | `payments/inbox.ts`, `exceptions.ts`, `workflow.ts`, `settings.ts` | Payout ledger import; exception rules (amount mismatch exact, duplicate record ≠ duplicate payment); inbox statuses; resolving reviews; route settings |
| `payments.test.ts` | 24 | `payments/mapping.ts`, `match.ts`, `store.ts` | CSV column mapping and versions; three-way matching on recorded chain data; duplicate provider rows; unknowns |
| `accounting.test.ts` | 23 | `accounting/rules.ts`, `engine.ts`, `providers/xero.ts`, `quickbooks.ts`, `demo.ts` | Posting rules for exact, short (open or accepted), over, duplicate, wrong network (never), counterfeit (never), no reference (waits for a person), confirming (waits); USD/par limits; idempotency, plan-key approval, partial failure; Xero/QBO request shapes (mocked fetch, never live) |
| `requests.test.ts` | 23 | `requests/lifecycle.ts`, `present.ts`, `provider.ts`, `store.ts`, `demo.ts` | Request lifecycle; auto-mark never on short/counterfeit/ambiguous; same transfer counts once; confirmations never go backwards; paid twice reopens; two requests on one address never decided by amount; demo vs real isolation; demo cases a–g; corrupt file stops writes; EIP-681 base units; prepayment timing |
| `polish.test.ts` | 22 | `ai/anthropic.ts`, demo workspace, `demo/reset.ts` | AI model default/override; reporting customer; demo files valid; demo reset clears cases and bulk runs |
| `csv.test.ts` | 20 | `csv/parse.ts`, `csv/files.ts`, `workspace/store.ts` | Malformed CSV rejected row by row; missing columns; invalid UTF-8; BOM; EIP-55 checksum on File A; SHA-256 re-upload no-op; bulk CSV cap 1,000 |
| `payments-review.test.ts` | 20 | `payments/match.ts`, `presets.ts` | Returns and fees via `relates_to`; conflicting instruction content; cross-chain lookups; `due_by`; epoch timestamps; BVNK preset |
| `inbox-review.test.ts` | 15 | `payments/*`, `audit.ts`, `csv/cell.ts` | Audit log; evidence pack wrapping; contradiction timing; **CSV writer neutralises formulas but keeps signed amounts** |
| `ledger.test.ts` | 14 | engine ledger join | Ledger join on real data; rejected upload rows → unknown facts (cap Medium); customer inference |
| `qa-fixes.test.ts` | 12 | stores, `lock.ts`, import route, `limits.ts`, `format.ts` | 20 concurrent writes lose nothing; **5,000 rows in under 10 s (wall-clock: the slowest file, 5.6 s; a flake candidate on a slow runner)**; body cap = route limit; 413 before the body is read |
| `inbox-rereview.test.ts` | 11 | import/clear routes, workflow | Merges and closes; File A missing; ledger direction; missing chain keys |
| `payments-redirects.test.ts` | 7 | `payments/match.ts` | Retired payment IDs redirect; fees and returns by merchant reference |
| `export.test.ts` | 6 | `payments/export.ts`, `pdf.ts` | Reconciled export rows; formula neutralising; evidence pack renders whatever characters it holds |
| `real-rules.test.ts` | 6 | `engine/rules.ts` helpers | `claimedSymbol`, look-alike first 3 + last 4, poisoning dust |
| `bulk.test.ts` | 5 | `bulk/run.ts`, `bulk/export.ts` | Bulk run on real data; export CSV |
| `real-record.test.ts` | 57 skipped | network recorder | Skipped unless `RECORD_REAL=1` |

Route handlers imported by tests (6 of 25): `inbox/[itemId]/action`, `payments/clear`,
`payments/export.csv`, `payments/imports/[kind]`, `payments/match`, `uploads/[kind]`.

## 3. Gaps (what no test covers today)

Severity is for a live pilot deployment. "Untested" means no test file imports it or asserts it.

| # | Gap | Where | Severity | Proposed test |
|---|---|---|---|---|
| G1 | **`POST /api/demo/reset` has no demo-mode guard.** In live mode it replaces the workspace (`store.save({ history: [] })`, then demo Files A/B, `demo: true`) and deletes `cases.json` and `bulk/`. Unauthenticated unless Basic auth is on, and CSRF-able (no body needed) | `src/app/api/demo/reset/route.ts`, `src/lib/demo/reset.ts` | **High** | With `DEMO_MODE=off` and a real File A uploaded, POST the route: expect 403 and File A unchanged |
| G2 | `POST /api/requests/demo` (reset/send/mine/advance/redeliver) has no `isDemoMode()` guard; reset keeps non-demo records but rebuilds the demo books in live mode | `src/app/api/requests/demo/route.ts`, `requests/service.ts` `demoAction` | Medium | Live mode: every kind → 403 |
| G3 | No test of `middleware.ts` (Basic auth gate, `/pay/` bypass, constant-time compare, malformed header) | `src/middleware.ts` | Medium | Call `middleware()` with no/wrong/right credentials and `/pay/x`; prefix tricks like `/pay` vs `/payments` |
| G4 | No test of the Xero OAuth routes (state cookie mismatch → 400, no tokens written; error body never echoes the token response) or `xero-auth.ts` refresh rotation under the lock | `src/app/api/accounting/xero/*`, `providers/xero-auth.ts` | Medium | Mock fetch: wrong state → 400 and no `xero-tokens.json`; two concurrent `accessToken()` calls → one refresh |
| G5 | `POST /api/accounting/[id]` (approve and post) route untested: actor required, key required, 409 on changed plan | `src/app/api/accounting/[id]/route.ts` | Medium | Route-level test mirroring the engine tests |
| G6 | No **reorg / dropped transaction** handling or test: confirmations only rise; a transfer later removed from the chain is never un-counted | `requests/lifecycle.ts` `ingest`, no `reorg` anywhere in `src/` (`grep -ri reorg src` empty) | Medium (High once address watching exists) | Event with lower block number / disappearing hash after `matched` |
| G7 | No property-based tests: amounts, decimals, addresses are tested by examples only | `decimal.ts`, `payments/money.ts`, `lifecycle.ts` `toBaseUnits`/`percentOf`, `address.ts` | Medium | `fuzzing.md` |
| G8 | CSV writer misses OWASP's full-width `＝ ＋ － ＠` and does not quote cells containing `;` (formula after a semicolon in `;`-separated locales) | `src/lib/csv/cell.ts` | Low–Medium | `csvCell("＝1+1")` starts with `'`; `csvCell("a;=1+1")` is quoted |
| G9 | Sender address checker: a poisoned address matching first 3 + last 3 hex (not 4) is "different", not "look-alike", and is not kept as evidence | `requests/lifecycle.ts` `compareAddress` | Low | Probe: `compareAddress(0x+3 same+…+3 same)` returned `"different"` on 29 Oct |
| G10 | Homoglyph "USDC" (e.g. Cyrillic) from a non-official contract is labelled `wrong_token`, not `counterfeit` (still never counts; label is less precise) | `transferIssue` | Low | Assert blocked + wording |
| G11 | No test that state-changing API routes reject cross-site requests (no CSRF defence exists; JSON routes parse `text/plain` bodies) | all `POST` routes | Medium | See `owasp.md` A01 |
| G12 | No security headers (CSP, frame-ancestors, nosniff) and no test | `next.config.mjs` | Low–Medium | Build, start, `curl -I` the payment page |
| G13 | Bulk job: `runBulk(...).then(...)` has no `.catch`: a throw leaves the job "running" forever and logs an unhandled rejection | `src/app/api/bulk/route.ts` | Low | Deps that throw → job ends `failed` |
| G14 | No cross-provider consistency check (one source per chain; a lying or stale RPC is believed) | `chain/sources.ts` | Medium for pilots | Two sources disagree → paused, not a verdict |
| G15 | `main` has no `npm run qa`; e2e lives on `qa-polish` (PR #31) until merged | `package.json` | Process | Merge PR #31 or port the script |
| G16 | **With Basic auth on, the public payment page's address checker is blocked.** `middleware.ts` exempts only paths starting `/pay/`; the checker posts to `/api/pay/<id>/check`, which gets 401. Probe on 29 Oct: `/pay/abc` → passes, `/api/pay/abc/check` → **401**. A customer on a password-protected preview gets a password prompt or a broken checker, on the one screen that stops address poisoning | `src/middleware.ts`, `src/components/requests/AddressChecker.tsx` | **Medium** (functional + the "look-alike warning" claim) | Middleware unit test: with `PREVIEW_USER` set, `/api/pay/x/check` passes and `/api/payments` still 401; e2e run with `PREVIEW_USER` set |
| G17 | Public, unauthenticated `POST /api/pay/<id>/check` appends an activity line for every look-alike pasted and rewrites `requests.json` under the lock each time: no rate limit, unbounded growth | `requests/service.ts` `checkSenderAddress`, `lifecycle.ts` `recordAddressCheck` | Low–Medium (API4) | 10,000 look-alike posts → activity bounded, latency bounded |

When a gap is closed, move it to section 2 with the test file, and re-date this file.
