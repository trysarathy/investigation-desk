# Task 8: Release sign-off: first live pilot on `main` @ fd9b992

Request (devops-engineer, 10:20 SGT): one Docker container on Fly.io (Singapore), `DEMO_MODE=off`,
Basic auth (`PREVIEW_USER`/`PREVIEW_PASSWORD`), the pilot's Xero Demo Company connected, their real
receiving address, and their customers using `/pay/<id>`.

What I ran: a scratch worktree of `origin/main` @ fd9b992 (`npm ci`, tsc, vitest x3, build, e2e). Then
the production build started locally **in the pilot's configuration** (`DEMO_MODE=off`,
`PREVIEW_USER`/`PREVIEW_PASSWORD` set to a random throwaway password, temp `DESK_DATA_DIR`, port 3401,
`LIVE_LOOKUPS=off`), probed with curl, and stopped. The data dir was deleted afterwards. Nothing was run against Fly, Xero or any
real system.

## Verdict
**Not ready: items 3, 5 and 9 fail, and the deployment plan has 3 blockers (D1–D3).** The test gate is green (item
2). What blocks is how this build behaves in live mode behind Basic auth, which is exactly the
configuration planned. Each blocker is small, and most are a few lines plus a test. My estimate is that
with fixes for B1–B3 and D1–D3 this can be re-signed in one night [GUESS on effort]. Merging/approving stays Aashmiin's click.

## Blocking items (evidence from tonight's probes)

| # | Blocker | Evidence (seen this session) | Minimal fix + test | Owner |
|---|---|---|---|---|
| **B1** | **`POST /api/demo/reset` wipes the pilot's live workspace**, with no demo-mode guard, no body needed, and it works cross-site | Live-mode server: uploaded a pilot File A (`pilot-file-a.csv`, 1 row, sha256 e8edf39c…). Then `POST /api/demo/reset` with `Origin: https://evil.example`, `Sec-Fetch-Site: cross-site` → `{"ok":true}`. After that the workspace's File A was `demo-file-a.csv` (7 demo rows), `demo: true`, and the pilot upload was gone from history. Code: `src/app/api/demo/reset/route.ts:7-9` → `src/lib/demo/reset.ts:16` `store.save({ history: [] })` | `if (!isDemoMode()) return 403` in the route. Test: `DEMO_MODE=off`, real File A, POST → 403, File A unchanged (test-map G1) | crypto-protocol-engineer |
| **B2** | **`POST /api/requests/demo` puts demo data into the live deployment** | Same server: `{"kind":"reset"}` → `{"ok":true}`; `requests.json` went from 2 real requests to **21 (19 demo + REQ-1001, REQ-1002)**; `accounting.json` gained `demoBooks`; `/requests` then showed "Demo data". The pilot's ops screen would show fictional customers alongside real ones | `isDemoMode()` guard → 403 for every kind in live mode. Test: each kind → 403 (G2) | crypto-protocol-engineer |
| **B3** | **The look-alike address checker on `/pay/<id>` is broken behind Basic auth**, which is exactly this deployment | No credentials: `GET /pay/<publicId>` → **200**, but `POST /api/pay/<publicId>/check` → **401**. With credentials the same call → `{"result":"lookalike"}`. So the pilot's customers (who don't have the password) get a broken checker or a password prompt on the screen that stops address poisoning. `src/middleware.ts:19` exempts only `/pay/` | Also exempt exactly `^/api/pay/[^/]+/check$` (not `/api/pay*`). Middleware unit test: `/api/pay/x/check` passes, `/api/payments` and `/api/pay/x/other` stay 401, `/pay/../api/requests` stays 401 (probe tonight: 401, good) (G16) | crypto-protocol-engineer |

| # | Deployment-plan blocker | Evidence | Fix | Owner |
|---|---|---|---|---|
| **D1** | **Data won't persist or won't be writable.** The image writes to `/app/.data` (`Dockerfile`: `mkdir .data && chown node:node .data`, `USER node`). On Fly the container filesystem is replaced on every deploy/restart [ASSUMPTION: Fly machines' rootfs is ephemeral], so requests, approvals and audit would be lost. Using a volume at `/data` crashes at boot with `EACCES … /data/accounting.json` (the preview's boot log, task 7) | `Dockerfile` read tonight; task-7 log | Mount a volume, set `DESK_DATA_DIR=/data`, chown it to `node` before start. Verify a restart keeps a test request | devops-engineer |
| **D2** | **Must be exactly one machine.** File locks are in-process (`src/lib/lock.ts`). Two instances on one data dir corrupt state (owasp.md A04) | `lock.ts` read | `fly scale count 1`, autoscaling/auto-start of a second machine off; document it | devops-engineer |
| **D3** | **Secrets hygiene before real credentials go on the host.** The current Fly boot step prints env values and `xero-tokens.json` (task 7), and those credentials aren't rotated yet. The pilot's Xero app secret and refresh token would go to the same logs | task-7 boot log (values not copied) | Remove the env/token dump; rotate the leaked set; set the pilot's secrets with `fly secrets`; check the first boot log shows names only | devops-engineer, Aashmiin (rotation) |

## Not blocking a supervised pilot, but the pilot must be told (or fixed soon)
| # | Item | Evidence | Severity |
|---|---|---|---|
| N1 | CSRF on every state-changing POST, including approve-and-post to Xero. `req.json()` accepts `text/plain`, and there's no Origin/`Sec-Fetch-Site` check | `POST /api/requests` with `content-type: text/plain`, `Origin: https://evil.example` → `{"id":"REQ-1002"}` created [VERIFIED tonight]. Browsers resending cached Basic credentials is [ASSUMPTION]. The plan key is derivable, so it doesn't help | Medium-High. Fix: middleware refusing non-GET requests whose `Sec-Fetch-Site` is `cross-site` (or Origin ≠ host). One file, testable. I'd **strongly** recommend shipping it with B1–B3 |
| N2 | No security headers: payment page can be framed (clickjacking on the page that shows the receiving address) | `curl -I /pay/<id>` → only `X-Powered-By: Next.js`; no CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy` | Medium. `headers()` in `next.config.mjs` |
| N3 | Xero tokens stored as plain JSON, world-readable mode, no "Disconnect" | `writeAtomic` passes no mode (`lock.ts:29-34`, used by `xero-auth.ts:55,75`). Files it wrote tonight were `-rw-r--r--` | Medium. Write with `0o600`. Acceptable on a single-tenant volume for a sandbox org |
| N4 | No sign-in; "Acting as" is a typed name; one shared password | `owasp.md` trust boundary; SECURITY_OVERVIEW §3 | Known. Pilot agrees in writing; long random password; HTTPS only (Fly terminates TLS [ASSUMPTION]) |
| N5 | No address watching or polling: a real payment is only seen when someone looks up its transaction hash. Auto-mark is off for non-demo requests (`requests/service.ts:36` `autoMarkPaid: demo`) | `provider.ts` header | Pilot ops runbook must say so. No claim of "ticks off automatically" |
| N6 | No reorg handling, one data source per chain; 12 confirmations is a setting, not finality | edge-case E14, E17; `grep -ri reorg src` empty per pack | Medium for pilots. Say it in the pilot terms |
| N7 | Public RPCs see looked-up hashes/addresses; `.env.example` itself says use keyed/paid providers for a pilot | `.env.example` lines 1–10 | Low. Set the pilot's own `ETHERSCAN_API_KEY` (a fresh one, not the leaked key) |
| N8 | npm audit prod: 1 high (`postcss` via `next`, build-time CSS only), 1 moderate. Not new | `npm audit --omit=dev` tonight → 2 (1 moderate, 1 high) | Low practical risk [ASSUMPTION: no runtime PostCSS]. Needs Aashmiin's written acceptance |

## Release checklist (playbook §6)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Branch SHA and base; diff; description | ✔ | `origin/main` = fd9b992 (merge of PR #34); deploying `main` itself, so no diff to review. Previous main: 9af0200 |
| 2 | `npm ci`; tsc; vitest ×3; build | ✔ | npm ci 127 packages; tsc exit 0 (8.5 s); vitest 3/3 identical **562 passed, 57 skipped (619)**, 20 files + 1 skipped; `next build` exit 0 |
| 3 | e2e desktop + phone; console errors 0 | **✘ for this configuration** | Demo mode: `demo_cases.py` **14 of 14** passed, 0 console errors, 1280x720 + 390x844 pay page. Live mode + Basic auth (the deployed config): no e2e exists. My probes found the payment page's checker returns 401 (B3). Not covered at all: the Xero OAuth connect/callback flow (G4) |
| 4 | Money paths have passing edge-case tests | ✔ (with known gaps) | Tonight: counterfeit with exact amount + auto-mark, fee boundaries 1.5/2.0/2.1%/one base unit all pass (`requests-edge.test.ts`, task 4); existing `requests`/`accounting` suites green. Gaps: reorg (E14), provider disagreement (E17) untested and unhandled (N6) |
| 5 | Security check clean or findings accepted in writing | **✘** | B1, B2 (A01/API5), B3; N1–N3 open and not accepted |
| 6 | Secrets scan | ✔ code / ✘ deployment | Tree and full history (118 commits, all refs): 0 hits; only `.env.example` tracked; fixtures `apikey=REDACTED` ×64. Deployment: preview boot log leaked credentials (D3) |
| 7 | npm audit, no new prod high/critical | ✔ (not new; acceptance pending) | prod 2 (1 moderate, 1 high), all 5 (2 moderate, 1 high, 2 critical, dev-only), same as 29 Oct |
| 8 | Claims reflect the release | ✔ with actions | This pilot doesn't make "live with customers" true until Aashmiin says the pilot is live and the customer agrees to be named. The "look-alike warning on the payment page" claim is false in this config until B3 is fixed. Hand-off to copy owners if the pilot is mentioned anywhere |
| 9 | Demo loads from a fresh data dir; reset keeps non-demo records | **✘ (partly)** | Fresh dir: demo loads (e2e ✔). Payment-request reset keeps non-demo records ✔ (REQ-1001, REQ-1002 survived). Deposit-workspace reset does **not**: pilot File A replaced (B1) |
| 10 | Rollback | ✔ (plan needed) | First live deploy, so rollback = stop the machine and restore the volume snapshot. Ask devops to snapshot the volume before each deploy. Previous `main` is 9af0200, but I haven't run it this session, so I can't call it green |

**Verdict wording:** *Not ready: items 3, 5, 9 (B1–B3) plus deployment blockers D1–D3. Ready to re-check the
same night the fixes land; I'd re-run this whole list on the new SHA, including the live-mode probes
above.*

## WOULD SEND: to Aashmiin (cc devops-engineer)
```
Release sign-off, first live pilot on main fd9b992: NOT READY — 6 blockers, all small.
Tests are green (562 passed, 57 skipped, 3/3; build ok; demo e2e 14/14). The blockers are in live mode behind Basic auth, which is the planned set-up:
 B1 /api/demo/reset wipes the pilot's real workspace, even from another site (reproduced locally).
 B2 /api/requests/demo adds 19 fictional requests and demo books to the live data (reproduced).
 B3 The pilot's customers' look-alike address checker returns 401 behind Basic auth (reproduced).
 D1 No persistent, writable data volume yet (the preview crashed with EACCES on /data).
 D2 Must run as exactly one machine.
 D3 The Fly boot step prints secrets; rotate the leaked set and fix the step before real Xero credentials go on.
Strongly recommended with them: CSRF check in middleware (approve-and-post is forgeable today), security headers.
Fix owners: crypto-protocol-engineer (B1–B3, N1), devops-engineer (D1–D3). I re-sign the night they land.
```

## WOULD WRITE: Risks / Log rows
| sheet | row |
|---|---|
| Risks | security · High · `/api/demo/reset` unguarded in live mode, CSRF-able · `src/app/api/demo/reset/route.ts:7` · isDemoMode guard + test · crypto-protocol-engineer |
| Risks | security · Medium · `/api/requests/demo` unguarded in live mode · `src/app/api/requests/demo/route.ts` · guard + test · crypto-protocol-engineer |
| Risks | security · Medium · payment-page checker 401 behind Basic auth · `src/middleware.ts:19` · exact-path exemption + test · crypto-protocol-engineer |
| Risks | security · Medium-High · no CSRF defence on POST routes (text/plain JSON accepted cross-origin) · all POST routes; `src/middleware.ts` · Sec-Fetch-Site/Origin check · crypto-protocol-engineer |
| Log | qa-security-engineer · release sign-off · main@fd9b992 pilot deploy · RISK: Not ready — items 3, 5, 9; B1–B3, D1–D3; email sent to Aashmiin |

## Notes
- The probes ran only against my local scratch server (http://localhost:3401), never a deployed
  instance. Throwaway credentials were generated at random and deleted with the data dir.
- `LIVE_LOOKUPS=off` during probes, so no real chain calls were made. Live hash lookups in the pilot
  config weren't exercised. That's "not checked", not a pass.
- Fly-specific behaviour (ephemeral rootfs, root-owned volumes, TLS termination) is marked
  [ASSUMPTION]. devops-engineer should confirm it on the real app.
