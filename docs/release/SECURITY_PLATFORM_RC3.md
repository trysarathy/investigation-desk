# Platform security, release candidate 3: L3, R2, deployment configuration

- **Branch:** `rc3/wip-platform`, on top of `cf8732e`.
- **Commits:**

  | SHA | Change |
  |---|---|
  | `c9ed556` | L3: bounded request bodies for the test API, with the gates enforced in the route |
  | `c800a4d` | R2: nonce Content-Security-Policy |
  | `6bb1c8a` | Fail-fast deployment configuration check |
  | `e95ef25` | Real-server Playwright proof |
  | (this file) | Documentation |

- **Date and environment:** 13 Nov 2026, on a local production build (`next build` + `next start`), Linux with 4 CPUs, Chromium 1194. All data is fictional.
- **What this does not cover:** hosted measurements. I deployed nothing and did not verify the host's own request-size limit (Vercel).

## 1. L3: bounded request bodies for `/api/clearline/test/**`

### Cause

Next copies the body of every POST that the middleware matcher covers. It copies up to `middlewareClientMaxBodySize`, which is 21 MB because the legacy uploads need it, and then reads and discards the rest. This happens before the route's 512 KB streamed limit runs.

### Change

- **Matcher.** `src/middleware.ts` now excludes two kinds of path:
  - `/api/clearline/test/v1/<segments>`
  - `/api/clearline/test/<segment>`

  The exclusion applies only when every segment matches `[A-Za-z0-9_-]+`: no dots, no `%`, and no empty segments. Such a path can only be served by the v1 catch-all or by the retired legacy route. Next tests the matcher against both the raw and the decoded pathname, and an encoded or dotted path fails both. Those paths still go through the middleware.

- **Gates.** The gates are now one pure function, `deploymentGate()` + `gateResponse()`, used by the middleware. `src/app/api/clearline/test/gate.ts` calls the same function in both test-API routes before any body byte is read. It runs for every method: PUT, PATCH, DELETE and OPTIONS are now exported, because otherwise Next would answer 405 or its automatic OPTIONS before any gate. The gates are:
  - the customer-preview allow-list;
  - the console and mentor pass-through;
  - the funding-only 404;
  - Basic auth.

- **v1 route.**
  - A `Content-Length` over 512 KB gets 422 before anything is read.
  - A chunked body is cut off at 512 KB.
  - Every early refusal sends `Connection: close`, so the server stops receiving instead of reading and discarding the rest.

- **Legacy route.** It still returns 410, or 422 for invalid input. It now reads at most 48 KB: 12,000 characters × 4 UTF-8 bytes, which keeps the old 12,000-character contract. It no longer uses `req.text()`.

- **Middleware copy limit.** In a customer-preview deployment (`CLEARLINE_CUSTOMER_PREVIEW=1`), `middlewareClientMaxBodySize` is 64 KB. Nothing that the preview lets through the middleware reads a body: there are no server actions, and the test API is now outside the matcher. Other deployments keep 21 MB (`REQUEST_MAX_BYTES`) for the legacy uploads.

### Evidence

All measurements use a real `next start` with `CLEARLINE_CUSTOMER_PREVIEW=1`. I measured the server's RSS from `/proc/<pid>/status`, sampled every 5 ms, as QA did. The before measurements are from `cf8732e`, built from a `git archive` snapshot.

| Request | Before (cf8732e) | After (rc3) |
|---|---|---|
| 20 MB chunked POST `/api/clearline/test/v1/liquidity` | 422, whole body received. RSS 183.8 → peak 254.7 MB (+70.9); later runs +42.4, +39.9, +39.9 | 422 + `Connection: close`. The server stopped receiving after 3.8–5.5 MB. RSS +0.1 to +0.2 MB |
| 50 MB chunked POST to the same route | 422, whole body received. RSS 236.1 → peak 319.0 MB (+82.9) | 422. RSS +0.4 to +0.9 MB |
| 20 / 50 MB chunked POST `/api/clearline/test/v1/intents` | not measured | 422. RSS +1.2 MB |
| 20 / 50 MB chunked POST to the legacy route `/api/clearline/test/intents` | not measured | 422. RSS +0.0 to +0.3 MB |
| Declared `Content-Length: 20 MB` | 422 | 422 at once, nothing read |
| 20 MB chunked POST to a console page `/clearline` (through the middleware) | 200. RSS +40.2, +41.8, +32.4, +3.7 MB, climbing to 297 MB | 200. Next logs "Request body exceeded 64KB". The first large body after start grows the heap once by about 19–25 MB. After that, each costs +1.6 to +4.8 MB |

The "After" figures are from the final run (`tests/platform/api-bounds.spec.ts`). The threshold is a peak growth of under 8 MB per request, and all 9 measured requests passed.

## 2. The gates still apply to the test API, in every mode

**Unit test:** `tests/platform/gates.test.ts`.
- **Differential check.** It compares the new middleware with a verbatim copy of the `cf8732e` middleware (`tests/platform/reference-middleware-cf8732e.ts`). The grid is 6 env modes × 5 credentials × 21 paths, and the status, body, Location, WWW-Authenticate, Cache-Control and console-layout flag must all be identical.
- **Route-level check.** For every refusal the old middleware would give on a test-API path, both routes give the identical answer, for GET, POST, PUT, PATCH, DELETE and OPTIONS. A gate refusal reads 0 body bytes.

**Real servers:** `tests/platform/gates.spec.ts`. One `next start` runs per mode.

| Mode | Test API answer, every method |
|---|---|
| `CLEARLINE_CUSTOMER_PREVIEW=1` | Allowed, as before: v1 health 200, POST without the key 401 JSON, PUT 405, OPTIONS 204, legacy 410. Everything outside the allow-list returns a plain 404 with `no-store`. |
| `CLEARLINE_FUNDING_ONLY=1` | Plain `Not found` 404, with or without the sandbox key |
| `PREVIEW_USER` + `PREVIEW_PASSWORD` | 401 Basic without credentials or with wrong ones. With the password, health is 200 and legacy is 410. |
| None set (full app) | v1 works, legacy 410 |

**Unchanged behaviour (not a regression):** in Basic-auth mode the v1 endpoints that need `Bearer cl_test_demo` cannot be used, because that key goes on the same `Authorization` header as the password. That was already true before rc3.

**Bypass probe.** I sent 18 encoded, dotted, case-changed and suffixed paths in each mode, for example:
- `/api/clearline/test/v1/%2e%2e/%2e%2e/%2e%2e/funding`
- `…/health.json`
- `/_next/data/x/api/clearline/test/y.json`
- `/API/…`
- `%00`

Results:
- In Basic-auth mode, every one returned 401 or a 308.
- In funding-only mode, every one returned 404 or 308.
- None reached the test API or the legacy shell outside its mode.

My first matcher (`api/clearline/test/v1/` as a prefix) failed this probe, and I narrowed it before committing.

**Security headers.** Every test-API response kind carries CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy and Permissions-Policy, and none carries `X-Powered-By`. The kinds checked were 200, 401, 404, 405, 204, HEAD, 410 and 422. These headers come from `next.config.mjs` `headers()`, which does not depend on the middleware.

## 3. R2: nonce Content-Security-Policy

### Headers

**Before** (every route):
```
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

**After**, on every page through the middleware (`/clearline/*`, `/mentor-demo`, the legacy desk, the funding desk). The nonce is fresh per request: 128 bits, base64.
```
default-src 'self'; script-src 'self' 'nonce-+FpV10anOc5fzeRSs5GyAg==' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

**After**, on the static fallback. This covers the test API, static files, and the middleware's own 401, 404 and redirect responses.
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; … (rest identical)
```

The middleware's header replaces the static one; I checked that exactly one CSP header is sent. A unit test checks that the two policies agree on every directive except `script-src`. Dev mode adds `'unsafe-eval'` and `ws: wss:` for React Refresh.

### How the nonce reaches the scripts

- **Next's own scripts.** The middleware sets the nonce in the request's `Content-Security-Policy` header. Next reads it there and puts `nonce=` on its bootstrap, inline flight and chunk scripts. 0 `<script>` tags on `/clearline` lack it.
- **The theme script.** The root layout's inline theme script reads `x-nonce`. The middleware always overwrites `x-nonce`, so a client-sent value is ignored (unit-tested).
- **Dynamic rendering.** No change was needed. Every page was already dynamic (`ƒ`) at `cf8732e`, because the root layout calls `headers()`.

### Why style-src keeps 'unsafe-inline'

The console and the mentor demo use 91 React `style={…}` props, and React renders them as `style="…"` attributes in the server HTML. A nonce cannot authorise style attributes, so removing `'unsafe-inline'` would break the layout. Style injection cannot run script, and `script-src` no longer allows inline script.

### Routes left on the old policy

**None.** Every page took the nonce policy with 0 violations, including the legacy desk and the funding desk.

### Browser evidence

From `tests/platform/csp.spec.ts`, run on the production build at desktop 1440×900 and on iPhone 13:

| Check | Result (each viewport) |
|---|---|
| 22 console documents: 15 console pages including `/clearline/docs` and `/clearline/trial`, the 5 sample payments, a moved URL after its 308, and a 404 | 0 CSP violations, 0 console errors, 0 page errors |
| Guided trial: cases 01, 03 and 05, then a new payment through create → quote → maker/checker → submit → event → investigation | 0 / 0 / 0 |
| Client navigation from Overview to Payments | Same document (a window marker survives), hydrated |
| `/clearline/docs` and the mentor demo lifecycle (`/mentor-demo`) | 0 / 0 / 0 |
| Full app, 12 legacy and console documents; the theme script must set `data-theme="dark"` | 0 / 0 / 0. The theme script ran with its nonce |
| Funding-only `/funding` | 0 / 0 / 0 |

**Injected markup** (`<script>` + `<img onerror>` added to the served HTML of `/clearline/payments`):
- **Before** (`cf8732e`): both ran, and 0 violations were reported.
- **After:** neither ran. Two violations were reported: `script-src-elem:inline` and `script-src-attr:inline`. The page still hydrated.

**Not tested at runtime:**
- `eval`: Chrome exempts DevTools-driven code (Playwright's `page.evaluate`) from CSP. The header shows that `script-src` has no `'unsafe-eval'`.
- A `<script>` created by already-running script: `'strict-dynamic'` trusts it by design (CSP3), so it needs prior script execution to exploit.

### Existing suites against this build, on port 3284

- The console suite (a scratch copy of `playwright.clearline.config.ts`, `--retries=0 --trace off`): 76 passed, 4 skipped.
- The mentor suite (a scratch copy of `playwright.mentor.config.ts`): 6 passed.

### Cost of dynamic rendering

There is no new cost, because the pages were already dynamic. I measured the median TTFB over 100 local requests after warm-up, alternating the two builds twice:

| Page | Before (cf8732e) | After (rc3) |
|---|---|---|
| `/clearline` | 30.4 / 29.4 ms | 37.2 / 31.6 ms |
| `/clearline/payments` | 33.3 / 32.9 ms | 42.3 / 33.2 ms |
| `/mentor-demo` | 6.1 / 6.0 ms | 8.5 / 6.6 ms |

In the steadier second round the difference is +0.3 to +2.2 ms. The first round's larger gap is within the run-to-run noise: an earlier before-run measured `/clearline` at 51.1 ms.

## 4. Fail-fast deployment configuration

`next.config.mjs` runs `assertDeploymentConfig(process.env)` every time Next loads it, which covers `next build`, `next start` and `next dev`. It throws one error that lists every problem. It reads only variables the app already reads, invents no modes, and never prints a secret's value.

| Refused | Why |
|---|---|
| `CLEARLINE_CUSTOMER_PREVIEW` or `CLEARLINE_FUNDING_ONLY` set to anything other than `"1"` (empty counts as unset) | The code tests `=== "1"`, so `"true"` silently means OFF and exposes the full app |
| Both set to `"1"` | They are separate deployments |
| Only one of `PREVIEW_USER` / `PREVIEW_PASSWORD` set | The gate is then silently off |
| `PREVIEW_PASSWORD` shorter than 12 characters | Weak password |
| `PREVIEW_*` set together with preview or funding-only mode | Those modes bypass the password gate (middleware order), so it protects nothing |
| `QBO_ENV=production` | Live QuickBooks posting; QuickBooks is not offered and its adapter is untested |
| In a customer preview: `DEMO_MODE` off/0/false/no/live, or any of `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `QBO_ACCESS_TOKEN`, `QBO_REALM_ID` | The preview is fictional-only |

The Clearline engine itself has no env var that enables live execution.

**Release URLs.** `clearline-release.json` is wired into `next.config.mjs`. A test asserts that the `env` block equals `resolveReleaseUrls(process.env, clearline-release.json)`. An invalid URL override already fails at config load.

**Tests.**
- Unit: `tests/platform/config.test.ts`.
- Real server (`gates.spec.ts`): `next start` with `CLEARLINE_CUSTOMER_PREVIEW=true`, with a short password, and with Xero credentials in a preview. Each exits non-zero with the message, and the secret values are absent from the output.

**On Vercel**, the check runs at build time, and a failed build leaves the previous deployment live.

**Founder action before the next deploy:** check that the trial and preview projects do not set `PREVIEW_*` alongside `CLEARLINE_CUSTOMER_PREVIEW=1`, and do not set a non-`"1"` mode value. I could not see the Vercel env from here. If they do, the next build will stop with the message above.

## 5. Residual risks

1. **Draining a page POST.**
   - **What remains:** a POST with a large body to any page still behind the middleware is read and discarded by Next. Next strips `Connection` from middleware responses, so the middleware cannot cut the read short. In the preview the copy is 64 KB and RSS settles at a plateau, as measured above. The cost is bandwidth and CPU time per request, not retained memory.
   - **Outside the preview:** the full app, funding-only and Basic-auth deployments still copy up to 21 MB (×2 buffers) per POST, because the legacy uploads need it.
   - **Full fix:** this needs the owners of `src/app/api/uploads/**` and the other upload routes. Move them out of the matcher with in-route gates, as done here, then lower the limit everywhere.
2. **Host limits.** The host's own request-size limit and slow-loris protection are not verified (Vercel).
3. **Dot-segment gate mismatch (pre-existing, unchanged by rc3, Low).**
   - **Cause:** the middleware sees the WHATWG-normalised pathname, but Next routes the raw one.
   - **Examples:**
     - Basic-auth mode: `/books/%2e%2e/pay/x` is gated as `/pay/x` (exempt) and renders the 404 page in the legacy shell without credentials.
     - Funding-only mode: `…/%2e%2e/funding` renders the funding layout's 404.
   - **Bound:** it only ever yields a 404 page. That shell is already public through the `/pay/<id>` exemption. No page or API other than a 404 is reachable.
   - **Fix:** this needs the raw path in the middleware, which Next does not expose, or a not-found page that renders no shell. That fix belongs to the owner of `src/app/not-found.tsx` and `src/components/Shell`.
4. **`'strict-dynamic'`** trusts scripts created by already-trusted scripts. An XSS sink inside our own JavaScript (for example `innerHTML` with a script) is not stopped by CSP. QA's earlier 212-field XSS sweep found none.
5. **`style-src 'unsafe-inline'`** remains (section 3).
6. **Not run:** `tests/browser/funding.spec.ts`. Its server script hard-codes ports 3000/3001, and `tests/browser/**` is outside my ownership. I covered funding-only mode with a page-load CSP check only.

## 6. How to run

```sh
npx tsc --noEmit
npx vitest run                                     # includes tests/platform/*.test.ts
npx next build
npx playwright test -c playwright.platform.config.ts --retries=0 --trace off   # port 3284, starts its own servers
```
