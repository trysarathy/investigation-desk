# Security checklist for every diff (mapped to SECURITY_GAPS and ASVS 5.0)

Run this on every PR, after the tests. qa-security-engineer does the deeper pass after you
(`QA: PASS/FAIL`); your job is to stop the obvious and the structural before it gets there.

Sources opened 2026-11-01: ASVS 5.0 chapters V1 (https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x10-V1-Encoding-and-Sanitization.md),
V3 (…/0x12-V3-Web-Frontend-Security.md), V8 (…/0x17-V8-Authorization.md), V13 (…/0x22-V13-Configuration.md);
OWASP CSRF Prevention Cheat Sheet (https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.md);
OWASP Secrets Management Cheat Sheet (…/cheatsheets/Secrets_Management_Cheat_Sheet.md);
OWASP CSV Injection page (https://raw.githubusercontent.com/OWASP/www-community/master/pages/attacks/CSV_Injection.md).
All [VERIFIED: <url> opened 2026-11-01] where quoted below.

## A. Always (any diff)
1. **Secrets.** Search the diff and every commit in the PR, not just the final tree:
   `git log -p origin/main..HEAD | grep -nEi '(secret|token|password|api[_-]?key|bearer|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}|xox[abp]-|sk_(live|test)_|0x[0-9a-fA-F]{64})'`.
   Test fixtures count. A "dummy" that looks real counts until the author shows it is generated
   (e.g. built from a fixed string in the test). Found one → **BLOCK** (`comment-format.md` §5). Never
   print it: describe type + length + file:line only, no characters of it. Company rule 4.
   Why rotation, not just deletion: a removed line stays in git history; OWASP recommends centralised
   "rotation and management of secrets" and revoking leaked credentials, which "remain usable until the
   backing service expires or revokes them". [VERIFIED: Secrets Management Cheat Sheet opened 2026-11-01]
   ASVS V13.3 is the secret-management section. [VERIFIED: ASVS V13 opened 2026-11-01]
2. **Custody / signing / money movement.** Any signing library, private-key or seed handling, write
   JSON-RPC method, refund-that-sends, sweep or gas top-up → **BLOCK** (company rule 3).
3. **New or changed route** (`src/app/api/**/route.ts`): same guards as its neighbours (demo-mode guard,
   preview gate, input validation, size limit `limits.ts`), state change only on POST, a test for the
   refusal. ASVS 3.5.3: sensitive functionality uses POST/PUT/PATCH/DELETE, "not methods defined by the
   HTTP specification as 'safe'", or strict `Sec-Fetch-*` validation. [VERIFIED: ASVS V3 opened 2026-11-01]
4. **Unknown is not negative** (chain/provider errors pause) and **no heuristic auto-links, credits,
   writes off or posts** anything.
5. **Logs and errors**: no tokens, full addresses with names, or file contents in thrown messages that
   reach the client. Xero errors are cut to 300 chars (`providers/xero.ts`); keep it that way.
6. **Dependencies**: a new package needs a one-line reason in the PR; never one that handles keys or
   signing; lockfile changes must match `package.json` changes.
7. **Tests not weakened**: no deleted cases, `.skip`, `.only`, loosened assertions or `it.fails` added to
   hide a red test. Deleting or weakening a test that guards a known security bug → **BLOCK**.

## B. Gap by gap: what a fix PR must contain (rows from `team/SECURITY_GAPS.md`, 31 Oct)
| Gap | Area | A fix PR must | Blocking if | Approval-only? (SECURITY_GAPS) | ASVS |
|---|---|---|---|---|---|
| #1 High | `api/demo/reset` wipes live data | Return 403 unless `isDemoMode()`; flip the `it.fails` in `tests/security-demo-reset.test.ts` (branch `security/demo-reset-guard`) to `it` | guard uses a string compare, or test still `.fails`, or other cases removed | **yes** (customer data) | V8 (authorization) |
| #2 High | CSRF + recomputable approval key | Middleware refuses non-GET `/api/*` unless `Sec-Fetch-Site: same-origin` or `Origin` matches host; require `Content-Type: application/json`; flip `tests/security-csrf.test.ts` | exempts by prefix, trusts `Referer` only, or allows `text/plain` | **yes** (auth) | 3.5.1, 3.5.3 |
| #3 Medium | preview gate blocks payer's check | Exempt only `POST ^/api/pay/[A-Za-z0-9_-]+/check$`; keep the guard test "everything else under /api still needs the preview password" | exempts `/api/pay` prefix or GET | **yes** (auth gate) | V8 |
| #4 Medium | demo guards: (a) `api/requests/demo` in live mode; (b) `demoModeOn` vs `isDemoMode` | (a) 403 unless `isDemoMode()`; (b) `demoModeOn` reuses `isDemoMode()`; flip both `it.fails`, keep the control test | a second switch survives, or the guard checks only `=== "off"` | **yes** (customer data) | V8 |
| #5 Medium | no security headers | `headers()` in `next.config.mjs` for `/:path*`: CSP `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`; flip the headers test only; payment page and QR still work | breaks `/pay/*` rendering, or sets a script CSP without nonces (breaks Next) | **no** (config only) | 3.4.4, 3.4.6 |
| #6 Medium | `xero-tokens.json` 0644 | `writeAtomic` takes a mode; tokens written `0o600`; flip the token-mode test | mode set after write (race), or applies 0600 to everything silently | **yes** (secrets) | V13 |
| #7 Low | CSV full-width / zero-width / BOM / `;` | Neutralise on a normalised **copy**; strip leading `​`-`‍`, `⁠`, `﻿`; add `;`; flip all 8 `it.fails` | any case deleted; output text rewritten; ASCII cases regress | **yes** (customer data in exports) | 1.2.10 |
| #8 Low | no rate limit on `/api/pay/<id>/check` | Per-IP + per-publicId bucket, 429; cap look-alike activity rows; flip the rate-limit test | limit keyed only on a client-supplied header with no fallback | **yes** (customer-facing access) | — |

Quotes used above:
- ASVS 1.2.10: "Verify that the application is protected against CSV and Formula Injection … special
  characters (including '=', '+', '-', '@', '\t' (tab), and '\0' (null character)) must be escaped with a
  single quote if they appear as the first character in a field value." [VERIFIED: ASVS V1 opened 2026-11-01]
- OWASP CSV Injection page also lists "Full-width (double-byte) variants of formula-initiating characters
  such as `＝`, `＋`, `－`, and `＠`" and separators such as `;`. [VERIFIED: www-community CSV_Injection.md opened 2026-11-01]
- ASVS 3.4.4: every response has `X-Content-Type-Options: nosniff`; 3.4.6: use CSP `frame-ancestors`;
  "X-Frame-Options … is obsolete and may not be relied upon". [VERIFIED: ASVS V3 opened 2026-11-01]
- OWASP CSRF cheat sheet: servers can use Fetch Metadata, "most importantly `Sec-Fetch-Site` — as a
  lightweight and reliable method to block obvious cross-site requests". [VERIFIED: CSRF cheat sheet opened 2026-11-01]

## C. A fix PR for a gap you think is wrong in SECURITY_GAPS
Don't edit `team/SECURITY_GAPS.md` (qa-security-engineer owns it). Say it in the comment as a `question`
or `note`, and add a Log row for qa-security-engineer.
