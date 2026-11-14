# Code review: rc3 console (8ca3f36, plus the console part of dd52f88)

**Verdict: CHANGES REQUESTED 8ca3f36**

**In plain English:** the fixes do what they claim, and the new tests fail when the fixes are removed. One gap remains in the new settlement safety net. When the partner holds a payout and the bank debit has been matched, the console still shows a green "Settlement verified". On the Funding page, that green chip sits right next to the new notice "Partner holds the payout — supplier not paid". I reproduced this with a state the engine produces itself, not a hand-edited one. Nothing posts a wrong amount and no record is lost, so this is not a BLOCK. The rest are Minors and Nits. They include a confirmed double page load on a slow server (L1), with a concrete fix, and two backup paths that can lose the unreadable saved copy.

APPROVAL-ONLY: needs Aashmiin's merge. The commit touches the funding projection's public shape (`supplierPayout.onHold` and `hold`, plus openapi.yaml) and the engine reconciliation path (e4c90b0 is inside the 6c41f30..8ca3f36 range).

Reviewer: independent code reviewer. I did not write or suggest any of this code. The commits carry a `Co-Authored-By: Claude` trailer from the authoring session, not from me.

---

## What I ran (frozen copies only, nothing in /home/user/rel/* edited)

| Check | Where | Result |
|---|---|---|
| `git archive 8ca3f36` → `scratchpad/cr3`, node_modules symlinked | cr3 | ok |
| `npx tsc --noEmit` | cr3 | exit 0 |
| `npx vitest run` (full) | cr3 | 54 files passed, 1 skipped; 1137 passed, 57 skipped |
| `npx next build` | cr3 and mutant cr3m | both exit 0 |
| Playwright, full `tests/browser/clearline-console.spec.ts`, desktop + iPhone 13, retries 0, port 3584, chromium-1194 | cr3 | **74 passed, 4 skipped** |
| Mutation: `settlementTone` returns the base tone (safety net removed) | cr3m build | "defence in depth" test **fails** (`returned`: colour is rgb(20, 108, 67)) |
| Mutation: both `position: relative` rules removed (L2 fix removed) | cr3m build | overflow tests at 768 and 1024 **fail** (scrollWidth 888 > 768, 1144 > 1024: the same figures QA reported) |
| Mutation: the on_hold line in `supplierPaidBasis` removed (C1) | cr3m, vitest | C1 test **fails** |
| Mutation: the new `else openTerminalDebitException` removed (C2) | cr3m, vitest | C2 test **fails** |
| Probes (Playwright scripts in my scratch copy): on_hold + debit colours, L1 slow-RSC, CSS halves, landmark checker, invalid-text gate | cr3 build | results below |

Process note: my first mutant run passed every test, which looked wrong. The mutant server had failed with EADDRINUSE, because the frozen server was still on 3584 and the tests had run against it. I stopped that server, restarted on the mutant build and re-ran. The results above come from the correct server, which I confirmed by its working directory and served CSS. All my servers are stopped. I did not touch the other agents' servers on 3384 and in rc3-platform.

Not run: lint, axe (axe-core is not installed in this repo, so the axe half of the landmark test never runs; see m4), and screen-reader testing with a real AT. I checked the accessible names with Playwright `ariaSnapshot`.

---

## Findings

### Blocker
None.

### Major

**M1. The safety net misses `on_hold`: a held payout with a matched bank debit shows a green "Settlement verified" on three pages.**
- **Where:** `src/components/clearline/labels.tsx:114` (`NO_GREEN_SETTLEMENT` = returned, failed, cancelled, expired) and `:116-119` (`settlementTone`). This affects `pages/Investigation.tsx:192-193`, `pages/Payments.tsx:51` and `pages/Funding.tsx:42`.
- **Scenario (reproduced in the browser on the 8ca3f36 build, with engine-produced state):** take the sample `s3_hold` payout (pi_00060, on_hold). POST a matching bank debit through `/reconciliation/statement-lines`, then create an advance on it.
  - Engine result: `execution on_hold, settlement verified, settlementScope bank_statement`. The vitest C1 test asserts the same state.
  - Investigation page: the settlement card border is rgb(20, 108, 67), and the chip reads "Settlement verified" in rgb(20, 108, 67) (`--cl-success`).
  - Payments list: the chip is rgb(20, 108, 67).
  - Funding page: the settlement chip is rgb(20, 108, 67), directly before "Partner holds the payout — supplier not paid". The page says two opposite things in one line.
- **Why it matters:** the design rule (labels.tsx:12-13) is "green only for evidenced success". The engine says the opposite here: UK_DEBITED_FUNDS_HELD_BY_PARTNER reads "Money left the account … The supplier has not been paid". It is the same class of defect as N1/M2 in the earlier reviews.
- **Likely also affected (not reproduced):** `awaiting_information` with a matched debit. `recomputeDimensions` (derive.ts:46-57) sets `verified` from bank or chain evidence whatever the execution state.
- **Fix (in words):** never use the green tone for settlement while the payout is on hold or waiting for information, as well as when it is terminal. Build the list from the engine's own `TERMINAL_FOR_SETTLEMENT_REPORT` plus `on_hold` and `awaiting_information` rather than a second hand-kept copy (see n1). Add `on_hold` to the browser test with an engine-produced state (the debit on `s3_hold`, as in my probe), so the test covers a state that really happens.
- **Downgrade check (the other direction):** a genuinely evidenced success is never downgraded. `settlementTone` changes only `ok` and only for the four terminal states. The engine never pairs those with `verified`: returned gives none or contradicted (derive.ts:31-43, C2), and the others give a contradiction. The control case in the test (s1_success stays green) passes.

### Minor

**m1. L1 confirmed: on a slow server, the Link fallback replaces a navigation that is still in flight with a full page load. That load can also lose work.**
- **Where:** `src/components/clearline/Link.tsx:15` (`NAV_FALLBACK_MS = 2500`) and `:33-45`.
- **Reproduced:** a Playwright route delayed the RSC request for `/clearline/payments` by 4 s, then I clicked the nav link. Result: 1 RSC request **and 1 extra document load**. The fallback fired at 2.5 s while the client navigation was still waiting, so the page loaded twice.
- **Where it loses data:** the comment at Link.tsx:9-10 says "Nothing is lost: the workspace is saved … on every change". That is false in two states:
  1. **Storage unavailable** (blocked or private mode, `storage: "unavailable"`). `persist` cannot write, so a full load starts again from `sampleWorkspace()` (workspace.tsx:80, 93-101). Every in-memory change is gone.
  2. **The unreadable-copy notice is showing** (`holdWrites`, workspace.tsx:88-105). Changes are deliberately not saved. The notice says so, but a click that only meant to move between pages discards them.

  I did not reproduce either path end to end. The full-load mechanism is confirmed, and the reset-on-load follows from the code above.
- **Proposed fix (in words), so a click is never swallowed and a slow server is not loaded twice:** decide from what the router actually did, not from a fixed clock.
  1. On click, note the target path and the time. Watch Resource Timing (a PerformanceObserver on `resource` entries) for the RSC fetch of that target path, meaning a fetch entry whose URL has the target pathname and the `_rsc` parameter. A resource entry appears only once the response has fully arrived.
  2. **Swallowed case** (the bug the fallback exists for, "fetched the route but never committed"): the RSC response for the target has arrived, and the URL has still not changed a short grace period later (about 1 s). Then do the full load at once.
  3. **Slow-server case:** no RSC response has arrived yet. Keep waiting, and do not full-load until a hard cap (about 15 s) has passed. The cap keeps the "never swallowed" guarantee even if the fetch hangs.
  4. Never fall back silently while storage is unavailable or the unreadable-copy notice is showing. Either skip the fallback there, or show a one-line notice ("This page is taking long to load. Load it fully? Unsaved changes in this tab will be lost.") with a button.

  A simpler alternative: Next 15.5 exports `useLinkStatus`. While the link reports pending, a request is in flight, so the full load should wait until the hard cap.
- **Tests to add:** (a) RSC delayed 4 s, so expect zero document loads and the URL committed. (b) RSC response stalled forever or never committed, so expect exactly one full load (the existing "never swallowed" test). (c) Storage blocked plus a slow RSC, so expect no silent reload.

**m2. "Replace it with the sample (keeps a backup in this browser)" can lose the unreadable copy without a backup.**
- **Where:** `src/components/clearline/workspace.tsx:138`. The return value of `write(BACKUP_KEY, raw)` is ignored. Line 139 then clears `holdWrites`, and `persist(next)` at :144 overwrites `KEY` with the sample.
- **Scenario:** an unreadable saved copy of about 3 MB, with a localStorage quota of about 5 MB. Writing a second 3 MB copy to `BACKUP_KEY` throws QuotaExceeded, which `write` turns into `false`. The smaller sample then saves over `KEY`. The only copy is gone, and the button promised a backup.
- **Fix (in words):** when the backup write fails, do not overwrite the saved copy. Keep holding writes and tell the person the backup could not be made, pointing to "Download the unreadable copy" first.

**m3. One backup slot is shared by two features, and the error boundary misreports a quota failure.**
- **Where:** `workspace.tsx:18` (`BACKUP_KEY`), used by `workspace.tsx:138` and `ConsoleBoundary.tsx:31`.
- **Scenario 1:** the person replaces an unreadable copy, which writes the backup. Later the console crashes and they press "Reset saved workspace (keeps a backup)". The boundary writes the current workspace into the same key, and the first backup is overwritten without a word. The key is also named `unreadable-backup` but now holds a readable workspace.
- **Scenario 2:** the `setItem(BACKUP_KEY)` at ConsoleBoundary.tsx:31 throws QuotaExceeded. The catch at :36 says "Browser storage is blocked, so nothing was saved or reset. Reloading with the sample workspace." Nothing was removed, so the reload reads the same crashing workspace and the boundary appears again. The "sample workspace" part of the message is false, and the person has no way out in the UI.
- **Also:** no page offers to download or restore `BACKUP_KEY`, so "keeps a backup" can only be reached through devtools. ConsoleBoundary has no test at all; nothing checks its render, "Try again" or reset paths.
- **Fix (in words):** use a separate, timestamped backup key per event, or refuse to overwrite an existing backup without saying so. In the boundary, tell a quota failure apart from blocked storage. On quota failure, offer a download of the saved copy and an explicit "remove it without a backup" choice. Add a link on Settings to download or restore any backup. Add one browser test that makes the provider throw (for example a workspace that passes `parseWorkspace` but crashes a shell component) and checks the boundary, the reset and the backup.

**m4. The landmark test is weaker than its name. It would not have caught one of the original L4 duplicates, and its axe half never runs.**
- **Where:** `tests/browser/clearline-console.spec.ts:642-672` (`duplicateLandmarks`) and `:674-701`.
- **Gap 1:** `nameOf` takes `textContent` from `aria-labelledby` targets, which includes `aria-hidden` text. The Investigation panel heading is `<span aria-hidden>C</span>Evidence timeline`, so the checker computes "CEvidence timeline" where axe computes "Evidence timeline".
  - **Proven:** on the 8ca3f36 build I set the timeline region's label back to "Evidence timeline" on `/clearline/payments/pi_00027`. The checker returned `[]`. The same revert on Overview's "Needs attention" was caught.
- **Gap 2:** `axe-core` is not in node_modules (and not in package.json), so the test passes with only an annotation. The title "axe finds no violations" is not true of any CI run.
- **Gap 3:** the visibility filter checks only the element's own `display` and `visibility`, not hidden ancestors.
- **Fix (in words):** compute names while skipping `aria-hidden` subtrees and hidden ancestors, or use Playwright's accessibility snapshot for names. Either add axe-core as a pinned devDependency or rename the test so it does not claim an axe result.

**m5. (dd52f88) Dry-run gates no longer check what the person typed.**
- **Where:** `TargetActions.tsx:36-43`, `pages/Holds.tsx:21`, `pages/Investigation.tsx:145`, `pages/Connect.tsx:102`. These now preview the action with the fixed text "Dry run" instead of the input.
- **Reproduced:** on pi_00027 I typed the note `checked <b>bank</b>`. The "Add note" button was **enabled**. Clicking it gave "Add note — not applied … Note must be 1–1000 plain characters (invalid_field)". Before dd52f88 the button was disabled with that reason.
- **Impact:** UX only, because the engine still refuses on dispatch. But the console's own rule is "each [action] gated by an engine dry run", and the gate no longer reflects the real input. This was traded away for the m7 cache.
- **Fix (in words):** preview with the real text. The new cache already keys on the action, so unchanged text costs nothing. Alternatively, check the text with the engine's exported `safeNote`/`safeText` rules and their limits before enabling the button.

### Nit

- **n1.** `labels.tsx:114`: `NO_GREEN_SETTLEMENT` is a hand-kept copy of `TERMINAL_FOR_SETTLEMENT_REPORT`. `state.ts:28-34` says that list is "The ONE list used by …". Derive the console list from it so the two cannot drift.
- **n2.** `labels.tsx:122`: `SETTLEMENT[v][0]` throws for a value not in the map, whereas `chipFrom` handles unknown values gracefully. It cannot be reached today, because `parseWorkspace` validates the settlement enum (serialize.ts:65-66), but the old code was total and the new code is not.
- **n3.** The downgrade changes colour only. The text and the screen-reader name still say "Settlement verified" (ariaSnapshot: "Evidence status: Settlement verified , API value verified"). That is acceptable for engine-unreachable terminal states. Once M1 covers `on_hold`, a short qualifier in the label, such as "debit verified, partner holds payout", would stop the meaning depending on colour.
- **n4.** Every scroll wrapper is now a second `region` landmark inside its panel's `section` region. On Payments: "Test mode notice", "Payments" and "Payments (scrollable table)". The suffix is announced even when the table does not scroll. A non-landmark wrapper (role `group` with the same name, still focusable for keyboard scrolling) would satisfy `scrollable-region-focusable` without doubling the landmarks or needing unique names.
- **n5.** `Link.tsx:40`: each `ensureNavigation` adds a popstate listener. Re-arming clears only the timer, so stale listeners accumulate until a popstate happens. It is harmless today because they all cancel the single pending timer, but it is a leak.
- **n6.** `Link.tsx:20`: a `UrlObject` href ignores `query`, so the fallback would load the URL without its query. No console link uses an object href today.
- **n7.** `Funding.tsx:43`: the notice is shown only when `onHold` is true, while `supplierPayout.hold` is set whenever an undecided hold exists. If those ever disagree, the API exposes a hold the page does not show. Consider rendering the hold whenever `hold` is present.
- **n8.** `clearline-console.spec.ts:741`: `if (d.ok())` lets a failed approval pass silently. The Funding test's `supplier-paid-basis … "none"` assertion (`:746`) does not test C1, because `s3_hold` has no debit, so the basis is "none" either way. The vitest C1 test covers it, but adding a debit to this e2e would make it prove the on-screen claim.
- **n9.** L2 CSS: each half alone is enough. I injected a stylesheet on the 8ca3f36 build so only `.tableWrap` or only `.chip` stayed positioned, and both gave no overflow at 768 and 1024. The mutation test catches only the removal of both. That is fine; the halves are belt and braces. Side effects I checked:
  - Positioned chips paint above non-positioned siblings, but the only overlays are the sticky banner (z-index 30, still above) and the sidebar (no overlap).
  - On mobile, `.stack thead { position:absolute; left:-9999px }` now sits inside the scroll box, and negative overflow is not scrollable.
  - The full overflow suite passes at 1440, iPhone 13, 768 and 1024.
  - The visually hidden text is still in the accessibility tree.

---

## Focus areas: what I concluded

- **Settlement safety net:** correct for the four terminal states and never downgrades a real success. It misses `on_hold` (M1, reproduced) and probably `awaiting_information`. The test fails without the fix (mutation-checked) but only covers hand-edited states.
- **Funding partner-hold notice:** correct text, link (`/clearline/holds#<hold id>` matches `Panel id={h.id}` in Holds.tsx:28) and test. It is undermined by the green chip beside it (M1). Small gating nit (n7).
- **Positioning and overflow:** the fix works, and the tests fail without it (mutation-checked: 888 and 1144 px, the same as QA). I found no harmful side effects (n9).
- **Landmarks and a11y:** names are now unique on every page by the checker. The checker has a blind spot (m4), and axe never runs. The hidden "API value" text is still announced (ariaSnapshot checked). Landmarks are doubled (n4).
- **Engine dry-run cache (dd52f88):** the key is complete. The actor id and the full action are in it, and everything else the engine reads (`at`, roles, clock) comes from the workspace object, which is the WeakMap key. `applyAction` copies through `Tx` and never mutates its input, and gate code only reads results, so cached results cannot go stale. A workspace change makes a new object and so a new cache. Cache misses from key order or `undefined` fields only cost time. The real regression is the switch to placeholder text (m5).
- **Link fallback (L1):** the double load is confirmed, and storage-blocked mode adds a data-loss path. The fix is in m1.
- **Workspace recovery:** while undecided, the saved copy is untouched (existing e2e covers that). Data-loss paths are in m2 (backup failure ignored) and m3 (shared key, overwrite, misreported quota).
- **Error boundary:** placement is right. It wraps the provider and shell, needs no context and leaves `error.tsx` for page errors. It is untested, and the quota and storage messaging is wrong (m3).
- **Test strength:** the safety net, L2, C1 and C2 tests all fail with their fix removed. The weak spots are m4 (landmarks and axe), n8 (Funding e2e does not exercise C1) and M1 (no on_hold case).

## Summary

CHANGES REQUESTED 8ca3f36. There is one Major: a held payout with a matched debit renders green "Settlement verified" on the Investigation, Payments and Funding pages, next to "supplier not paid". It is reproduced with engine state, and the fix is to add on_hold and awaiting_information to the no-green list and test it. There are five Minors: L1 double load confirmed with a fix proposed, two backup data-loss paths, a weak landmark checker with axe never run, and gates that ignore typed text. There are nine Nits. tsc is clean, vitest passes 1137 tests, the build succeeds, and Playwright passes 74 with 4 skipped. Mutation checks prove that the safety-net, L2, C1 and C2 tests each fail without their fix.
