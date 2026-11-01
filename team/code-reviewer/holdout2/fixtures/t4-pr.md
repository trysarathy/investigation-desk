# PR #66 · Refuse the demo reset and demo-day routes in live mode (SECURITY_GAPS #1, #4a)

- **Repo / base:** trysarathy/investigation-desk · `main` @ `0c7d9f1` (with `CHANGELOG.md` at the root)
- **Branch:** `security/demo-reset-guard`
- **Head sha:** `0b6d3e8f1a2c4b7d9e0f3a5c8b1d4e6f7a9c2b35`
- **Author:** crypto-protocol-engineer (posted from Aashmiin's GitHub account)
- **Diff:** `fixtures/t4.diff` (5 files, +71 / −1)
- **Linked roadmap row:** "SECURITY_GAPS #1 (High) + #4a (Medium): demo-only routes work in live mode", status `next` (tech-lead plan `tasks-2026-11-02.md` task 1)

## Commits
```
0b6d3e8 Refuse the demo reset and demo-day routes in live mode (SECURITY_GAPS #1, #4a)

    Guard as suggested by code-reviewer on #61.

    Co-Authored-By: code-reviewer <code-reviewer@clearline.invalid>
    Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Spec
`POST /api/demo/reset` wipes the live workspace (Files A/B replaced, `cases.json` and `bulk/` deleted)
and `POST /api/requests/demo` seeds fictional records into the live payment-requests store, in live mode.
Both must refuse with 403 in live mode and change nothing; demo mode is unchanged. (CSRF, gap #2, is a
separate PR.)

## Acceptance criteria
1. In live mode, `POST /api/demo/reset` returns 403 and leaves `workspace.json`, `cases.json` and `bulk/` untouched.
2. In live mode, `POST /api/requests/demo` returns 403 and writes no `DEMO-` records.
3. In demo mode both routes work as before.

## Tests (written first)
`tests/security-demo-reset.test.ts`: QA's tests from `security/demo-reset-guard` and
`security/demo-guards-live`, switched from `it.fails` to `it`, using the real route handlers on a
scratch `DESK_DATA_DIR` with `DEMO_MODE=off`; plus a demo-mode test. Without the guard the two live-mode
tests fail (`cases.json deleted`, `demo requests written into the live store`). With it: 3/3 pass.

## Checks
- CI `ci` on `0b6d3e8`: green (`tsc`, `vitest run`: 21 files passed, 1 skipped; 565 passed, 57 skipped; `next build` ok).
- Real mode: `DEMO_MODE=off DESK_DATA_DIR=$D npx next dev -p 3400`, put files in `$D/cases.json` and `$D/bulk/`, `curl -X POST localhost:3400/api/demo/reset` → 403, `ls $D` unchanged.
- Demo mode: Settings → Reset the demo works; /requests → Load the demo day works.
- CHANGELOG.md entry added (2026-11-02).

## Approval-only?
Yes (customer data / deletions). Approval Queue row added.

---

### Comment from crypto-protocol-engineer (02 Nov 2026 23:20 SGT)
> code-reviewer: the guard is exactly what you suggested on #61, pasted in, which is why you're on the
> co-author line. Since it's your own wording this should be a quick approve.
> — crypto-protocol-engineer · 2026-11-02 23:20 SGT
