# Task 8: PR #912, security headers (SECURITY_GAPS #5)

Authorship check: 1 commit by frontend-product-engineer; nothing names code-reviewer or my session. I may review it.

## 1. The comment I would post (`gh api repos/trysarathy/investigation-desk/issues/912/comments -X POST -F body=@$SP/cr-2026-11-01/pr-912-5e7c738.md`)

```
CODE REVIEW: APPROVE 5e7c738baaf4eae9c5e4fe5f21aaeac21e1fd4da

**Summary (plain English):** Every page and API response now tells browsers not to let other sites frame it
(so the payment page can't be used for clickjacking), not to guess file types, and to send only our domain
when a link is followed out. I ran the app and saw the headers on the payment page and the API. Approved; only
small optional notes. Not approval-only: security headers are config only (SECURITY_GAPS #5).

**Checks I ran at 5e7c738** (scratch checkout of base `security/hardening` @ b47b7f6 with the PR diff applied;
node_modules symlinked from a main checkout after confirming `package-lock.json` is byte-identical;
2026-11-01 ~04:40 SGT):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 21 files passed, 1 skipped; 565 passed, 57 skipped
- `npx next build`: exit 0
- Fix removed (`next.config.mjs` reverted), tests kept: the headers test fails on its own assertion
  (`next.config.mjs has no headers(): expected 'undefined' to be 'function'`) → the test proves the fix.
  The token-mode and rate-limit tests stay `it.fails` (2 left in the file), unchanged: acceptance (2) holds.
- Real server (`next start` on the build, temp `DESK_DATA_DIR`, demo mode default): `curl -sI` on `/`,
  `/pay/x`, `/requests`, `/api/requests` (405) and 8 demo `/pay/<publicId>` pages → every response has
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`; all `/pay/` pages returned 200.
- QR: not seen rendered: after "Load the demo day" none of the 8 demo requests had anything due, and the page
  shows a QR only when something is due. The QR is an inline SVG built on the server
  (`src/app/pay/[publicId]/page.tsx:47,112`), and this CSP sets only `frame-ancestors`, which can't affect it.
  I'm relying on the author's demo/real-mode check for the QR itself.
- Lint: couldn't run: no `lint` script on this branch.
- CI on 5e7c738: `ci` success (as reported in the PR; my run agrees)
- Size: +20/−2, 3 files: fine.

**Findings**
1. **note** `next.config.mjs:4-5`: `frame-ancestors 'none'` is the control ASVS 3.4.6 asks for; `X-Frame-Options`
   is obsolete per ASVS [VERIFIED: code-reviewer 2026-11-01, https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x12-V3-Web-Frontend-Security.md
   (pack entry; not re-opened tonight)] but harmless as a fallback for old browsers. Fine to keep.
2. **suggestion (non-blocking)** `tests/security-hardening.test.ts:51`: the test accepts `frame-ancestors 'self'`
   or `X-Frame-Options: SAMEORIGIN`. Not this PR's to change (it's QA's test), but a later tightening to
   `'none'`/`DENY` would stop a regression to same-origin framing; I'll mention it to qa-security-engineer.
3. **note** No script/style CSP yet: correct call (Next's inline scripts need nonces); the PR and CHANGELOG
   both say it's a later change. HSTS at the host: that's a deploy setting, so it needs Aashmiin when it's done.
4. **praise** Small, one concern, the CHANGELOG is plain English and true, and the comment in the config explains
   why the CSP is anti-framing only.

**Checklist** (team/playbooks/code-review.md): 1 ✓ 2 n/a 3 ✓ 4 ✓ 5 ✓ 6 ✓ (CHANGELOG accurate) 7 not approval-only
(security headers, config only, per SECURITY_GAPS #5) 8 ✓ 9 ✓

Next: qa-security-engineer tests this same sha (`QA: PASS/FAIL 5e7c738…`). (Merge gate note: `main`'s ruleset
still has no required `ci` check, and this PR targets `security/hardening`, so the merge gate's rules apply when
it moves on.)

— code-reviewer · https://claude.ai/code/session_01BBB · 2026-11-01 04:45 SGT
```

## 2. Commands run and results (scratch `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/t8`, deleted afterwards)
- `git clone --shared /home/user/ai-team t8`; fetched `origin/security/hardening`, detached → `b47b7f6083c291b975288e8f739ff7a7c961c4f0` (matches fixture). Lock md5 `aced0278…` = main-ro → symlinked `node_modules`. `git apply t8-pr-912.diff` → `next.config.mjs`, test modified, `CHANGELOG.md` added.
- `npx tsc --noEmit` → 0; `npx vitest run` → `21 passed | 1 skipped (22)`, `565 passed | 57 skipped (622)`; `grep -c it.fails tests/security-hardening.test.ts` → 2.
- `git checkout -- next.config.mjs` (fix removed) → `npx vitest run tests/security-hardening.test.ts` → `1 failed | 2 passed` (the 2 passing are the remaining `it.fails` cases); assertion quoted above. Restored.
- `npx next build` → 0. `DESK_DATA_DIR=<tmp> npx next start -p 3471`; `curl -sI` on the routes above → the 4 headers on every response. `POST /api/requests/demo {"kind":"reset"}` → `{"ok":true}`; 8 demo pay pages → 200 with the CSP, no QR (nothing due). Server stopped, temp data dir deleted.
- Not run: lint (no script), a browser framing test, the QR on a request with an amount due.

## 3. Log rows
| Timestamp (SGT) | Agent | Action | IDs | Details |
|---|---|---|---|---|
| 2026-11-01 04:45 | code-reviewer | PR #912 reviewed | APPROVE 5e7c738 | approval-only: no (security headers, config only, SECURITY_GAPS #5) · blocking: 0 · <comment url> · headers seen on /, /pay/*, /api/* from a real `next start`; QR not seen (no demo request with an amount due) |
| 2026-11-01 04:45 | code-reviewer | Note for qa-security-engineer | PR #912 · tests/security-hardening.test.ts:51 | Headers test also accepts `frame-ancestors 'self'` / `SAMEORIGIN`; consider tightening to `'none'`/`DENY`. Please check the QR on a pay page with an amount due when you test 5e7c738. |
