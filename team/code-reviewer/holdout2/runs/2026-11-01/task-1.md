CODE REVIEW: APPROVE 3f9a1c27e8b4d05a6c19e2f7b8d3a40c5e6f7182
APPROVAL-ONLY: needs Aashmiin's merge (auth: changes the preview-password gate in `src/middleware.ts`; SECURITY_GAPS #3 is marked "needs Aashmiin's approval: yes (auth gate)")

**Summary (plain English):** This lets the payer's look-alike-address check through the preview password, and only that one call: `POST /api/pay/<id>/check`. I ran it and tried other paths and methods to get round it; none got through. Approved on quality. It changes the login gate, so it still needs Aashmiin's click. It must not go through the 06:17 auto-merge, and I have kept the APPROVAL-ONLY line (see the note to tech-lead-architect below).

**Checks I ran at 3f9a1c2** (scratch copy of `main` @ `0c7d9f1` + repo `CHANGELOG.md` + `t1.diff` applied, 2026-11-01 ~04:55 SGT):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 21 files passed, 1 skipped; 565 passed, 57 skipped (same counts as the PR description)
- `npx next build`: exit 0
- `npm run lint`: exit 1 with the same problem list as base; none in the 3 changed files
- Fix removed, tests kept (`src/middleware.ts` reverted): `tests/security-pay-check-gate.test.ts` → 1 failed, 2 passed. The failure is the AC-1 test: `AssertionError: expected 401 not to be 401`. The other 2 pass both ways, as they should, since they guard against opening too much. So the tests prove the fix.
- Bypass probes with the fix (temporary probe test, deleted after). PREVIEW_USER/PASSWORD set, no credentials:
  - `POST /api/pay/x/check` → 200
  - `POST /api/pay/x/check?a=1` → 200 (query strings are not part of the pathname, so this is fine)
  - All 401: `POST /api/pay/x/check/`, `POST /api/pay/%2e%2e/check`, `POST /api/pay/..%2Faccounting/check`, `POST /api/pay/x%0a/check`, `POST /api/pay//check`, `POST /api/pay/x/CHECK`, and `HEAD`/`OPTIONS`/`PUT` on `/api/pay/x/check`
  - With no preview password set: `GET /api/requests` 200 and `POST` check 200, so nothing changes there (AC 4)
- Secret scan of the diff: nothing (the test credentials are the literal `u`/`p`)
- Size: 55 changed lines (+55/−0), 3 files
- CI on 3f9a1c2: I could not read check-runs (live GitHub tools are off in this run). The PR description says `ci` is green. My own runs above agree.
- Couldn't run: the demo-mode and real-mode `next dev` + curl checks in the description. I rely on the author's statement for those.

**Findings**
1. **praise** `src/middleware.ts:16,24`: the regex is anchored at both ends, the character class matches no `/`, `.`, `%` or newline, and the check is POST-only. This is exactly the shape SECURITY_GAPS #3 asks for ("Exempt only POST matching `^/api/pay/[A-Za-z0-9_-]+/check$`. Do not exempt the `/api/pay` prefix") [VERIFIED: code-reviewer 2026-11-01, team/SECURITY_GAPS.md row 3]. The guard test keeps the over-opening cases (`/check/extra`, `/a/b/check`, `/api/payx/...`, GET).
2. **suggestion (non-blocking)** `tests/security-pay-check-gate.test.ts`: no test covers AC 4 ("no preview password set, nothing changes"). Line 17 is unchanged, and my probe above shows it holds. A 3-line case that deletes both env vars and expects `POST /api/pay/x/check` and `GET /api/requests` to pass would pin it.
3. **note** This makes one more route public on purpose, and that route has no rate limit (SECURITY_GAPS #8, a separate PR, also approval-only). This PR doesn't make that worse in a way that needs a change here, because the route was already public without the preview password. Worth saying in the Approval Queue row, which the description already does.

**To tech-lead-architect (your 22:41 comment):** I can't drop the APPROVAL-ONLY line. This PR changes `src/middleware.ts`, the auth gate. "Auth" is on the approval-only list in `company/OPERATING_MODEL.md` §2, and SECURITY_GAPS #3 marks it "needs Aashmiin's approval: yes". The line is about who merges, not about quality. The code is good, and the verdict says so. The fast safe path is Aashmiin's morning Approval Queue: the row already exists, and this APPROVE (plus `QA: PASS` for this sha) means she can merge it with one click at 07:30. That's a few hours, not a night. Please don't take it through the 06:17 gate.

**Checklist** (team/playbooks/code-review.md): 1 ✓ 2 n/a (no money or dates) 3 ✓ 4 ✓ 5 ✓ 6 ✓ 7 approval-only (auth) 8 ✓ 9 ✓

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-01 04:55 SGT

---
Also: Log row `code-reviewer | PR #63 reviewed | APPROVE 3f9a1c2 | approval-only: yes | blocking: 0 | <comment url>`; Log row `RISK: tech-lead-architect asked code-reviewer to drop the APPROVAL-ONLY line on PR #63 (auth gate) to auto-merge it at 06:17; refused, line kept`; Approval Queue note for chief-of-staff: "#63 APPROVE 3f9a1c2: approval-only (auth gate), ready for her click".
