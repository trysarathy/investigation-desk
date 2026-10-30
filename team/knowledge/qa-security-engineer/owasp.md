# OWASP mapped to Clearline

How the OWASP Top 10 (2021) and the OWASP API Security Top 10 (2023) apply to this app: a Next.js 15
App Router app (`next` 15.5.28), 25 route handlers in `src/app/api`, one optional Basic-auth
middleware, JSON files in a data directory, outbound calls to chain APIs, Xero and (optionally)
Anthropic. Read against `origin/main` @ `fd9b992`, 29 Oct 2026. "Today" = what the code does now
[VERIFIED by reading the file named]. Severity is for a **live pilot deployment** (`DEMO_MODE=off`);
the shared demo preview (`DEMO_MODE=1`, fictional data) is lower.

Note: OWASP has published a **2025** Top 10 (A01 Broken Access Control, A02 Security
Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06
Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security
Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions) [VERIFIED, OWASP/Top10 repo
`2025/docs/en/index.md`]. Aashmiin's brief asks for 2021; the mapping below is 2021 with the 2025
category in brackets. 2025 A10 "Mishandling of Exceptional Conditions" is exactly our "never conclude
on a missing fact" rule, so outage tests count as security tests.

## The trust boundary in one paragraph
There is **no sign-in, no roles, no per-user identity** (`docs/enterprise/SECURITY_OVERVIEW.md` §3 on
`enterprise-pack`; `src/components/ActingAs.tsx`: "Acting as" is a typed name in `localStorage`). The
only gate is optional shared HTTP Basic auth (`src/middleware.ts`, `PREVIEW_USER`/`PREVIEW_PASSWORD`),
skipped for `/pay/*`. So on a live deployment **anyone who can reach the URL (or the shared password)
can do everything**, including approve postings to Xero and wipe data. Every finding below sits on
top of that known, documented gap; the fix for most is "real auth (week 5 in the spec) + CSRF
defence", and until then: one deployment per pilot, Basic auth with a long random password, an IP
allow-list at the host.

## OWASP Top 10 (2021)

| ID | Category | Where it applies here | Today | Gap / action | Sev |
|---|---|---|---|---|---|
| A01 | Broken Access Control [2025 A01] | All 25 routes; `middleware.ts`; demo vs live guards | No authz; Basic auth optional; `/pay/*` exempt by prefix | (1) **`POST /api/demo/reset` wipes the live workspace** (no `demoModeOn`/`isDemoMode` guard; `src/app/api/demo/reset/route.ts` → `resetDemoWorkspace` saves `{history: []}`, deletes `cases.json`, `bulk/`). (2) `POST /api/requests/demo` unguarded in live mode. (3) **CSRF**: no token, no Origin/`Sec-Fetch-Site` check on any POST; JSON routes use `req.json()`, which parses a `text/plain` body, so a cross-site `<form enctype="text/plain">` can post JSON-shaped data; multipart uploads (`/api/uploads/[kind]`, `/api/payments/imports/[kind]`) are form-postable as-is. Browsers resend cached Basic credentials [ASSUMPTION: standard browser behaviour; verify per browser], so Basic auth does not stop CSRF. Next.js gives Server Actions an Origin/Host check but route handlers get none [VERIFIED, Next.js data-security guide]. (4) Two "demo" switches disagree: `isDemoMode()` (on unless `DEMO_MODE=off`) vs `demoModeOn()` (only `DEMO_MODE=1`): with `DEMO_MODE=on` uploads are **accepted** | High |
| A02 | Cryptographic Failures [2025 A04] | Data dir; Xero tokens; TLS | Plain JSON at rest; `xero-tokens.json` written by `writeAtomic` with default mode (no `0600`); app serves HTTP, TLS from host; outbound HTTPS | Encrypt tokens with a host-managed key, `chmod 600`, "Disconnect" that revokes. Basic auth over plain HTTP leaks the password: require HTTPS in front | Medium |
| A03 | Injection [2025 A05] | CSV exports, PDF, AI prompt, URLs to chain APIs | `csvCell` prefixes `= + - @ \t \r` with `'` and quotes `, " \n \r`; React escapes output; two `dangerouslySetInnerHTML` (QR SVG from validated EIP-681 data; static theme script); AI output validated against evidence; hashes normalised to hex before URL building | **CSV**: OWASP also lists full-width `＝ ＋ － ＠` and warns about separators such as `;` starting a new cell [VERIFIED, OWASP CSV Injection]; `csvCell("a;=1+1")` is emitted unquoted (probe, 29 Oct). Prompt injection: covered by tests (`ai.test.ts`, `engine.test.ts`) | Low–Med |
| A04 | Insecure Design [2025 A06] | Approve-and-post; auto-mark; attribution | Good: plan key must match (`accounting/[id]` 400 without key); never-post kinds; never by amount alone | `approveAndPost` accepts a missing key at engine level (whitepaper audit P11): keep the route test (test-map G5). Single process only (`lock.ts`): two instances on one data dir corrupt state | Medium |
| A05 | Security Misconfiguration [2025 A02] | `next.config.mjs`, Dockerfile, env | No security headers; demo defaults on; Docker runs as `node` user (good); `AI_EXPLANATIONS=off` in image | Add `headers()` with CSP (`frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, HSTS at the host [VERIFIED, Next.js `headers` docs; OWASP HTTP Headers cheat sheet]. Payment page can be framed today (clickjacking on the page that shows the receiving address) | Medium |
| A06 | Vulnerable and Outdated Components [2025 A03] | `package-lock.json` | `npm audit` 29 Oct: prod 1 high (`postcss` via `next`), dev 2 critical (`tinypool` via `vitest`), 2 moderate | See `secrets-and-supply-chain.md`. `next` 15.5.28 is past the CVE-2025-29927 middleware-bypass fix (15.2.3) [VERIFIED, GHSA-f82v-jwr5-mffw] | Medium |
| A07 | Identification and Authentication Failures [2025 A07] | Basic auth; "Acting as" | Constant-time compare (`same()`); one shared password, no lockout, no MFA; actor self-declared | Known (security overview §3). Add: never call self-declared actor "identity" in any claim. Basic auth blocks the customer's address checker (test-map G16) — a fix must exempt exactly `/api/pay/<id>/check`, not `/api/pay*` broadly | High (known) |
| A08 | Software and Data Integrity Failures [2025 A08] | Audit log; lockfile; data files | Audit app-level append-only, not tamper-evident; `npm ci` in Docker | Hash-chain audit entries (roadmap); `npm audit signatures` in CI | Low–Med |
| A09 | Security Logging and Monitoring Failures [2025 A09] | `audit.jsonl`, Xero audit | Exports, imports, inbox actions, approvals logged with actor, time, IP | IP comes from `X-Forwarded-For` first hop (`payments/live.ts` `whoFrom`): client-spoofable unless the proxy overwrites it. No alerting. Logging Cheat Sheet: don't log secrets/tokens; log auth and access-control failures [VERIFIED, OWASP Logging cheat sheet]; 401s are not logged | Low–Med |
| A10 | Server-Side Request Forgery [API7] | `chain/sources.ts`, `http.ts`, Xero, Anthropic | All outbound hosts are constants (`EVM_SOURCES`, `KEYLESS_RPC`, TronGrid, Blockscout, Xero URLs); user input reaches URLs only as a normalised 64-hex hash or a chain-derived address | **Not exploitable today.** Becomes live the moment anyone adds a configurable RPC URL (env, Settings, a customer's "own node"). Rule for review: allowlist scheme `https` + exact host, no redirects followed to new hosts, block private/link-local IPs after DNS resolution [VERIFIED, OWASP SSRF cheat sheet] | Low now |

## OWASP API Security Top 10 (2023)

| ID | Category | Clearline routes | Today | Action | Sev |
|---|---|---|---|---|---|
| API1 | Broken Object Level Authorization | `/api/requests/[id]/action`, `/api/accounting/[id]`, `/api/inbox/[itemId]/*`, `/api/bulk/[id]`, `/api/pay/[publicId]/check` | Single tenant, no users: every object reachable by ID. Request IDs are sequential (`REQ-1001`); `publicId` is 72 random bits (`randomBytes(9)`); bulk job IDs are UUIDs | Fine for one-tenant pilots; the day a second tenant shares a deployment this is critical. Cross-tenant tests are a spec §7 pre-pilot gate | Low now / Crit multi-tenant |
| API2 | Broken Authentication | `middleware.ts`, Xero OAuth | Basic auth optional; OAuth `state` = 128-bit random, httpOnly SameSite=Lax cookie, 10 min, compared on callback | Compare state in constant time (minor); test the callback (test-map G4) | Medium |
| API3 | Broken Object Property Level Authorization | `/api/payments/mappings` (whole mapping body), `/api/inbox/routes` (`routes` array cast with `as RouteSetting[]`) | Validated downstream (`saveMappingVersion`, `saveRoutes` return errors) | Check that unknown properties are dropped, not stored (mass assignment) | Low |
| API4 | Unrestricted Resource Consumption | Uploads (20 MB, `limits.ts`; bulk 2 MB/1,000 rows); `/api/payments/match` POST; `/api/pay/[id]/check` | Content-Length pre-check + `middlewareClientMaxBodySize` 21 MB; no rate limits anywhere | Public checker writes the whole `requests.json` per call and appends activity per look-alike (test-map G17); `/api/payments/match` POST re-runs chain lookups on demand (spends public-RPC quota). Rate-limit at the host or in middleware | Medium |
| API5 | Broken Function Level Authorization | Admin-like functions: `/api/payments/clear`, `/api/demo/reset`, uploads, Xero connect, approve-and-post | Anyone with access can call all; spec §7 role table (Analyst/Lead/Admin) not built | Roles (week 5). Until then: demo-only routes must refuse in live mode (A01 items 1–2) | High |
| API6 | Unrestricted Access to Sensitive Business Flows | Approve-and-post to Xero; mark paid; confirm unidentified payment | Plan-key approval; never-post kinds; actor required | CSRF (A01-3) is the realistic abuse path. The plan key is **not a secret**: `idempotencyKeyFor` (`accounting/rules.ts`) is sha256 of request ID + line kinds, amounts, `chain:hash:logIndex` and account codes, all derivable by someone who knows the request and the transaction. It detects a changed plan; it does not stop a forged approval. Real defence = CSRF check + auth | Medium |
| API7 | Server Side Request Forgery | As A10 | Constant hosts | As A10 | Low now |
| API8 | Security Misconfiguration | Headers, error bodies, CORS | No CORS headers set (browser same-origin default); Xero callback returns `(e as Error).message` (messages are our own; token response body never echoed, `xero-auth.ts`) | Headers as A05 | Medium |
| API9 | Improper Inventory Management | 25 routes, two demo switches, deposit-investigation pages hidden but reachable by URL in demo mode (`mode.ts`) | No route inventory | Keep the route table below current; every new route gets: guard, validation, size limit, test | Low |
| API10 | Unsafe Consumption of APIs | Chain APIs, Xero, Anthropic | Chain amounts that aren't plain decimals → unknown fact; classify-body for 200-with-error; 15 s timeout; retries | One source per chain is believed (edge-case E17); Xero responses trusted for invoice amounts/currency (USD-only rule helps) | Medium |

## Route inventory (security view)

| Route | Method | Guard today | Writes | Notes |
|---|---|---|---|---|
| `accounting/[id]` | POST | actor + plan key | Xero/demo books, audit | CSRF target (key is derivable, not secret) |
| `accounting/import` | POST | actor, EVM address | requests, accounting | |
| `accounting/xero/connect` | GET | demo-mode refuse, configured | state cookie | GET that starts OAuth |
| `accounting/xero/callback` | GET | state cookie match | `xero-tokens.json` | Tokens plain JSON |
| `bulk` | POST | 2 MB, workspace present | job (memory + file) | No `.catch` on background run |
| `bulk/[id]`, `bulk/[id]/cases` | GET/POST | none | cases | |
| `demo/bulk.csv` | GET | none | – | |
| **`demo/reset`** | POST | **none** | **workspace, cases, bulk** | **High: guard it** |
| `inbox/[itemId]/action`, `inbox/resolve`, `inbox/routes` | POST | actor checks downstream | inbox, audit | |
| `inbox/[itemId]/evidence.pdf` | GET | actor (query) | audit | GET with side effect (audit row) |
| `pay/[publicId]/check` | POST | public by design | requests (checks, activity) | Blocked by Basic auth (G16); no rate limit (G17) |
| `payments/clear` | POST | `DEMO_MODE=1` refuse | deletes records | Live: anyone can clear |
| `payments/export.csv` | GET | actor (query) | audit | CSV injection surface |
| `payments/imports/[kind]` | POST | `DEMO_MODE=1` refuse, 20 MB | records | |
| `payments/mappings` | GET/POST | `DEMO_MODE=1` refuse | mappings | |
| `payments/match`, `payments/resolve` | GET/POST | none | job | |
| `requests`, `requests/[id]/action`, `requests/payments/confirm` | POST | actor, validation | requests | |
| `requests/demo` | POST | **none** (kind allowlist only) | requests, demo books | Medium: guard it |
| `uploads/[kind]` | POST | `DEMO_MODE=1` refuse, 20 MB | workspace | |

## Topic notes the brief asked for
- **File upload limits**: 20 MB per file (`UPLOAD_MAX_BYTES`), request 21 MB, enforced before reading
  when Content-Length is honest and by Next's body cap otherwise (`next.config.mjs`), with a test that
  the two match (`qa-fixes.test.ts` P3). Parsed as strict UTF-8 CSV only; never executed or served
  back. OWASP File Upload cheat sheet points still open: file names are user input (we slice to 200
  and React-escape them; never use them in paths), and no malware scanning is needed because files
  are parsed, not stored as files [VERIFIED, OWASP File Upload cheat sheet; ASSUMPTION on need].
- **CSV injection in exports**: one writer (`src/lib/csv/cell.ts`) used by the reconciled export and
  bulk export; tested (`export.test.ts`, `inbox-review.test.ts`). Gaps: full-width characters and `;`.
  OWASP also notes the `'` prefix is not reliable in Excel after save-and-reopen [VERIFIED].
- **SSRF via RPC URLs**: constants today; see A10. Review trigger: any diff touching `sources.ts`,
  `KEYLESS_RPC`, `.env.example` RPC lines, or adding `fetch(` with a non-constant URL.
- **Secrets handling**: env only (`.env*` git-ignored, `.env.example` empty values); Etherscan key
  redacted from stored URLs (`http.ts` `redact`, test in `chain.test.ts`); TronGrid key in a header
  that is never stored; recorded fixtures show `apikey=REDACTED` (64 occurrences, 0 real keys, grep on
  29 Oct). Xero token request errors never echo the body (`xero-auth.ts`).
- **OAuth (Xero) token storage**: `xero-tokens.json` in the data dir, plain JSON, default file mode,
  never sent to the browser; refresh under a file lock because Xero rotates the refresh token
  (comment in `xero-auth.ts`); access tokens last 30 minutes (`expires_in: 1800`) [VERIFIED, XeroAPI
  xero-node README]; the README also refers to a "< 60 days refresh token" [VERIFIED, same]. Scopes
  requested: `accounting.transactions accounting.contacts.read` + OIDC + `offline_access` — broader
  than reading invoices and posting payments needs (whitepaper audit P12). No revoke/disconnect.
- **Logging PII**: `audit.jsonl` holds actor names and IPs (personal data under PDPA [ASSUMPTION]),
  `requests.json` holds customer references and look-alike addresses; validators refuse emails in
  actor names, customer refs and Files A/B. AI gets evidence with customer IDs scrubbed
  (`ai/explain.ts` `aiInput`). No `console.log` of request bodies in `src/` (grep, 29 Oct).

## Sources (all accessed 2026-10-29; owasp.org itself was outside this session's allowed network, so
the OWASP GitHub sources of the same pages were read)
- OWASP Top 10 2021 index: https://github.com/OWASP/Top10/blob/master/2021/docs/en/index.md [VERIFIED]
- OWASP Top 10 2025 index: https://github.com/OWASP/Top10/blob/master/2025/docs/en/index.md [VERIFIED]
- OWASP API Security Top 10 2023: https://github.com/OWASP/API-Security/blob/master/editions/2023/en/0x11-t10.md [VERIFIED]
- OWASP CSV Injection: https://github.com/OWASP/www-community/blob/master/pages/attacks/CSV_Injection.md [VERIFIED]
- OWASP SSRF Prevention Cheat Sheet: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.md [VERIFIED]
- OWASP CSRF Prevention Cheat Sheet (Fetch Metadata, custom headers): https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md [VERIFIED]
- OWASP HTTP Headers Cheat Sheet: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/HTTP_Headers_Cheat_Sheet.md [VERIFIED]
- OWASP File Upload Cheat Sheet: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/File_Upload_Cheat_Sheet.md [VERIFIED]
- OWASP Logging Cheat Sheet: https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/Logging_Cheat_Sheet.md [VERIFIED]
- Next.js `headers` config: https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.mdx [VERIFIED]
- Next.js data security (Server Actions Origin/Host check): https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/data-security.mdx [VERIFIED]
- CVE-2025-29927 Next.js middleware bypass, fixed in 15.2.3: https://github.com/advisories/GHSA-f82v-jwr5-mffw [VERIFIED]
- Xero token lifetime and scopes example: https://github.com/XeroAPI/xero-node/blob/master/README.md [VERIFIED]
