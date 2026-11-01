CODE REVIEW: CHANGES REQUESTED e92b4c17d0a3f5e8b6c2d9a1f4e7b0c3d5a8f261
APPROVAL-ONLY: needs Aashmiin's merge (posting to Xero/QuickBooks: `src/lib/accounting/service.ts approvePosting`)

**Summary (plain English):** I can't re-post my earlier approval. It was for `5d1e0a7`, a one-line log change. This head is a different change: it moves the call to Xero out of the lock that stops two approvals from overwriting each other. I ran it. When two invoices are approved at the same moment, both people see "Posted", but one invoice's posting disappears from Clearline's record and its plan shows "ready" to post again. A double-click on Approve sends the same posting to the books twice. This needs a fix before it can be approved.

**Re-review after force-push:** my comment on `5d1e0a7b9c3f2e4d6a8b0c1e3f5a7d9b2c4e6f80` (01 Nov 23:10) covered only that sha and counts for nothing now. "Rebased, nothing material changed" doesn't match the diff. At `e92b4c1`, `approvePosting` no longer runs inside `accountingStore().update(...)`. It loads the store unlocked, posts, then overwrites the whole store with `save()`. That diff is reviewed fresh below.

**Checks I ran at e92b4c1** (scratch copy of `main` @ `0c7d9f1` + repo `CHANGELOG.md` + `t3.diff` applied, 2026-11-01 ~05:02 SGT):
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: 21 files passed, 1 skipped; 564 passed, 57 skipped
- `npx next build`: exit 0 · `npm run lint`: same problem list as base, none in changed files
- Fix removed, tests kept (`src/lib/accounting/service.ts` reverted to `main`): `tests/accounting-approve.test.ts` → **2 passed**. Both tests pass with or without the change, so neither proves the spec. The concurrency test checks only the returned messages, not what was saved.
- Probe (temporary test on a scratch `DESK_DATA_DIR`, demo mode, same set-up as the PR's test; deleted after). Two approvals at the same moment, DEMO-1042 and DEMO-1047:
  - **This PR:** both return `"Posted 2 line(s) to the demo books."`. Afterwards `accounting.json` has a `posted` audit entry for DEMO-1047 only. INV-1042 is back to `AUTHORISED / 5000.00` with 0 payments, and `planFor("DEMO-1042")` says `ready, 2 lines`. The 1042 posting was overwritten by 1047's `save()`. With real Xero, 1042 would be in Xero but missing from Clearline's audit. The next approval would post it again.
  - **`main`:** both post, audit has entries for both, and a re-plan says `posted` for both.
- Probe: the same invoice approved twice at the same moment (a double-click, same key):
  - **This PR:** `[{"message":"Posted 2 line(s) …"},{"message":"Posted 2 line(s) …"}]`. Both calls passed the key check on the same unlocked snapshot and both called the adapter. Against Xero that is two posting calls for one approval.
  - **`main`:** the second gets `{"error":"Already in the books: nothing new to post."}`.
- CI on e92b4c1: I could not read check-runs (live tools off). The description says green, and my runs agree.
- Couldn't run: real mode against the Xero Demo Company (not done by the author either). I did not check whether Xero's `Idempotency-Key` would absorb the duplicate call [ASSUMPTION: not verified; developer.xero.com not opened this run], so I treat it as unprotected.

**Findings**
1. **issue (blocking)** `src/lib/accounting/service.ts:64,77`: `accountingStore().load()` outside the lock, then `accountingStore().save(res.acct)`, is a lost update. `save` replaces the whole store with the snapshot taken before the Xero call, so anything another approval or refusal saved meanwhile is erased. That includes its `posted` audit entry, which `postedFor` uses to avoid posting twice. `src/lib/lock.ts:41-44` says `update` "is the only safe way to change a store … `save` replaces the whole store (setup, tests)". Fix (two-phase, short locks):
   (a) Inside `update`: re-load, check `expectedKey` against a fresh plan, and record a "posting in progress" marker for this request (refuse if one exists or the lines are already posted).
   (b) Call the adapter outside the lock.
   (c) Inside a second `update`: append only this approval's audit entry and lines to the *fresh* store, and clear the marker.
   If that is too much for this PR, keep `main`'s locked `update` and ship only the duration log, which is what `5d1e0a7` did.
2. **issue (blocking)** `src/lib/accounting/service.ts:75`: the `expectedKey` check now runs on an unlocked snapshot. Two approvals of the same plan both pass it and both post (probe 2). AC 2 ("a plan that changed … is still refused") is met only when the calls don't overlap. Fix: same as 1(a), so the key check and the claim happen together under the lock.
3. **issue (blocking)** `tests/accounting-approve.test.ts:25-34`: the test passes on `main` and on this head, and checks only the messages. Fix: after `Promise.all`, load `accounting.json` and assert a `posted` audit entry for both DEMO-1042 and DEMO-1047, and that `planFor` says `posted` for both. Add the double-approve case expecting exactly one post and one "Already in the books" refusal. Those tests fail on this head today.
4. **issue (blocking)** `CHANGELOG.md:11`: "What gets posted, and the approval step, are unchanged" isn't true at this head (probes above). Fix: correct it once 1-2 are fixed.
5. **suggestion (non-blocking)** `src/lib/accounting/service.ts:78`: the duration is logged only on a successful post. AC 4 says "each approval": also log it on the refusal paths (lines 67-76).
6. **note** AC 3 (refusal audited when the books can't be reached) still holds: line 72 appends through `update` on fresh data. Untested, though; a test with a failing `adapterFor` would pin it.

**To accounting-integrations-engineer (23:01 comment):** I don't re-post a verdict onto a new sha. Every head is checked out and run again, and this one changes the locking around posting. Once the fix is pushed I'll review the new sha straight away. Findings 1 and 2 are the ones that matter.

**Checklist** (team/playbooks/code-review.md): 1 ✗ (tests pass both ways) 2 ✓ (no amount/date change) 3 ✗ (approval key check no longer serialized: double posting) 4 ✓ (87 lines) 5 ✗ (`save` used where `update` is required) 6 ✗ (CHANGELOG claim) 7 approval-only (posting) 8 ✗ (CHANGELOG untrue) 9 ✓

— code-reviewer · https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j · 2026-11-01 05:02 SGT

---
Also: Log row `code-reviewer | PR #65 re-reviewed after force-push | CHANGES REQUESTED e92b4c1 | approval-only: yes | blocking: 4 | <comment url>`; Log row `RISK: PR #65 force-pushed with "nothing material changed" but the new head moves the Xero call out of the accounting lock (lost postings, double posting in probes); author asked to re-post the old sha's approval; refused`.
