# Code review: rc3 console final (cf8732e..e023174)

**Verdict: APPROVE e023174, conditional on the browser suites you are running now being green.** I could not run them (see "What I did not run").

**In plain English:**
- Every finding from my earlier review (M1, m1–m5) is fixed, and the new browser tests are written so they would catch each one coming back.
- Every action button I found is checked by the engine against what the person actually typed. A success message appears only when the engine recorded the change.
- I found no way to inject script through the URL filters, and the case report is always marked fictional.
- Four Minor issues remain, none of them a wrong amount or a lost record:
  1. If the pre-update backup cannot be written, the original saved workspace can still be overwritten on the next action, while the notice says it is unchanged.
  2. An over-amount that is still waiting for its second approval shows as plain "Resolved" in the exception queues.
  3. Backups pile up with no way to delete them, so they use up browser storage.
  4. axe still never runs, because axe-core is not installed.

APPROVAL-ONLY: needs Aashmiin's merge. The range includes engine changes (acceptance policy, load migration, reset) and the funding/report output shapes.

Reviewer: independent code reviewer. I did not write or suggest any of this code. My earlier review findings are referenced by their labels only.

---

## What I ran

Everything ran on a frozen copy at `scratchpad/cr4` (`git archive e023174`, node_modules symlinked, no build because disk is tight). I removed my earlier cr3 and cr3m copies first to free space. Nothing under /home/user/rel was edited.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` (full) | 72 files passed, 1 skipped; **1498 passed**, 57 skipped |
| Mutant 1: CSV formula guard off (`report.ts` `cell()` prefix line removed) | `rc3-case-report.test.ts`: 5 tests **fail** (`=cmd`, tab, `-`, `+`, `@`) |
| Mutant 2: CSV FICTIONAL marking row removed | `rc3-case-report.test.ts`: 1 test **fails** (marking row first) |
| Mutant 3: `canResetScenario` always allowed (per-case reset refusal off) | `rc3-reset-scenario` and `rc3-reset-fixtures`: 4 tests **fail** |
| Mutant 4: M1 fix off (`NO_GREEN_SETTLEMENT` without `on_hold`/`awaiting_information`) | My throwaway unit test of `settlementTone`/`settlementQualifier` **fails**; it passes on e023174. The repo's own M1 tests are browser tests, which I could not run. |
| `writeBackup` unit probe (throwaway test, in-memory storage with a quota) | Never overwrites an earlier backup; returns null on quota (as designed). Two backups in the same millisecond collide on one timestamped key (Nit n4). |

All mutations were restored and checked with `diff -q`. The throwaway tests and config were deleted.

**What I did not run:** `next build`, Playwright (journey, console and qa-rc3 specs), lint and axe. I reviewed the browser tests by reading them. I judge them strong in design: for example, "slow server → zero document loads" would fail on the v2 fallback. But I have not seen them pass or fail. **Please send me (or attach to the release notes) your browser-suite results for e023174.** For the browser mutation checks, the cheapest high-value ones are:
- Remove `on_hold` from `NO_GREEN_SETTLEMENT`: the journey test "M1: a held payout…" should fail.
- Make `InFlightProbe` report nothing: "a slow server response … loads the page once" should fail.
- Make `setFullLoadGuard` always return null: "m1: with browser storage blocked…" should fail.
- Preview with a constant text in `TargetActions`: "m5: action gates check what the person typed" should fail.

---

## Earlier findings: status

| Finding | Status at e023174 | Evidence |
|---|---|---|
| **M1** held payout shows green | **Fixed** | `labels.tsx:124` is built from the engine's `TERMINAL_FOR_SETTLEMENT_REPORT` plus `on_hold` and `awaiting_information`. A words qualifier (`settlementQualifier`, :130-140) says "supplier not paid (partner hold)", so the meaning no longer rests on colour. A unit mutant was killed. Browser tests are at journey spec :1047 (engine-produced `on_hold`+`verified`) and :1084. |
| **m1** L1 double load and silent reload | **Fixed** | `navguard.ts` does a full load only if nothing is in flight after 2.5 s (`useLinkStatus` / `useTransition`), or the navigation has stalled for 10 s. When a full load would lose work it asks the person (`setFullLoadGuard`, `workspace.tsx:170-175`; `NavStuck` in AppShell). The popstate listener leak (old n5) and the dropped object-href `query` (old n6) are also fixed. |
| **m2** backup failure ignored on replace | **Fixed** | `workspace.tsx:209-217` refuses and explains, and AppShell offers an explicit "Replace without a backup". The same pattern recurs in the migration path, though; see m-A below. |
| **m3** shared backup slot / misreported quota | **Fixed** | Separate keys; `writeBackup` never overwrites an earlier backup. The boundary tells blocked storage apart from a failed backup and offers download, then removal. Settings lists, downloads and restores backups. Browser tests are at journey :819, :830, :863 and :889. |
| **m4** landmark checker and axe | **Half fixed** | The checker now skips `aria-hidden` text and hidden ancestors (`clearline-console.spec.ts:645-655`). axe is still not installed, so every "axe finds no violations" test only adds an annotation. See m-D. |
| **m5** gates ignore typed text | **Fixed** | `useSettled` (Action.tsx:29-37) feeds the real text into every dry run: TargetActions, AcceptDifference, Holds, Connect reject and Investigation cancel. The "Dry run" text is used only when the field is empty, and then the separate "give a reason first" gate applies. Browser test at journey :1096. |
| Nits n1, n2, n4, n7, n8 | Fixed | The list is derived from the engine; unknown values are handled; the scroll wrappers are `role="group"`; the Funding hold notice shows whenever a hold exists; the M1 browser test uses engine-produced state. |

---

## Findings

### Blocker
None.

### Major
None.

### Minor

**m-A. If the pre-migration backup cannot be written, the original saved workspace is overwritten on the person's first action, while the notice says the saved copy is unchanged.**
- **Where:** `src/components/clearline/workspace.tsx:154-158` and `:177-180`. In AppShell, the `MigrationNotice` text is used when `saved` is false.
- **Scenario:**
  1. Browser storage is nearly full (backups accumulate; see m-C).
  2. A workspace saved by an earlier version loads. `writeBackup(MIGRATION_BACKUP_KEY, raw)` returns null, so `saved` is false and the notice says "the saved copy is unchanged and it will be updated again next time".
  3. `holdWrites` is not set, so the person's first action calls `persist`, which writes the migrated workspace over `KEY`. The original is replaced with no backup, contrary to the notice.
  4. If the main write then also fails, the console silently flips to "storage unavailable".
- **Fix (in words):** when the pre-migration backup fails, either hold writes, as the unreadable-copy path does, until the person downloads the original or explicitly continues without a backup, or change the notice to say plainly that the next change will replace the original. Add a browser test that throws QuotaExceeded on the backup key with a v2 fixture and checks that the original survives one action.

**m-B. An over-amount accepted above 1% that still waits for its second approval shows as plain "Resolved" in the queues.**
- **Where:** `pages/Exceptions.tsx:34` (the "Open" view filters on `status !== "resolved"`) and `:73`/`:88` (a bare `ExcChip`). Overview "Needs attention" and Investigations do the same. Nothing outside the payment page reads `resolution.acceptedDifference.secondApproval` (grep: only AcceptDifference.tsx and Investigation.tsx:370).
- **Scenario:** Maya accepts a 3% over-amount. The engine marks the exception `resolved` with `secondApproval.required`. The exception leaves the "Open and reopened" queue and shows "Resolved".
  - The only place the pending approval appears is the payment's case section.
  - A second approver scanning the queues never sees it, and the queue reads as if the acceptance were complete.
  - The case stays blocked (`SECOND_APPROVAL_REQUIRED`), so no wrong state is recorded. This is a visibility and honesty gap, not wrong data.
- **Fix (in words):** wherever an exception status is shown, render a resolved exception whose second approval is still pending as "Resolved — second approval pending" (warning tone). Keep it in the open queue, or add a "Waiting for approval" view, and count it in Overview "Needs attention".

**m-C. Backups have no delete, no total and no limit, so they eat the localStorage quota and then make later saves fail.**
- **Where:** `workspace.tsx:34-43` (`writeBackup` adds a timestamped full copy whenever the slot holds different content) and `pages/Settings.tsx:57-66` (download and restore only).
- **Scenario:** a person restores a backup three times and later replaces an unreadable copy. Each step stores another full workspace. With a 5 MB quota and a 1 MB workspace, the main save (`persist`) starts failing, the console shows storage unavailable, and m-A becomes reachable.
- **Fix (in words):** in Settings, show each backup's size and the total, and offer "Delete" per backup (after download). Optionally keep at most N backups per kind and say so where a backup is written.

**m-D. (carried over from m4) axe never runs in this repo.**
- **Where:** `tests/browser/clearline-journey.spec.ts:72-84` and `:992-1018`, and the console spec. `axe-core` is not in package.json or node_modules (checked). The tests that claim "axe finds no violations" pass with an annotation unless `CLEARLINE_AXE_PATH` is set.
- **Note:** running axe over CDP (`page.evaluate`) is the right way to get past the nonce CSP, but it has no effect while axe-core is absent.
- **Fix (in words):** add axe-core as a pinned devDependency (license MPL-2.0, test-only), or make these tests fail when axe is missing in CI. Alternatively, rename them so they do not claim an axe result.

### Nit

- **n1.** `filters.tsx:106-111` (`useSearchText`): pressing Back within 300 ms of typing in search lets the pending debounce fire. It replaces the history entry Back just restored with the typed text, so Back appears not to work. On a URL change, cancel the pending debounce and adopt the URL value.
- **n2.** The gate is up to 200 ms stale (`useSettled`). Typing invalid text and submitting within 200 ms can submit with an enabled button. The engine still refuses and the message is honest, so the risk is only a brief mismatch. Acceptable; noted.
- **n3.** Download filenames embed workspace ids (`CaseReport.tsx:41`, `Reports.tsx` `${id}.txt`, Settings `${b.key}.json` with `:` in the ISO time). Ids are only checked as non-empty strings by `parseWorkspace`, so a hand-edited workspace can put `/`, `\` or control characters in a name. Browsers sanitise these, so the risk is low. Restrict filenames to `[A-Za-z0-9._-]`.
- **n4.** `writeBackup` uses the wall-clock ISO time for the second and later keys. Two backups of the same kind within one millisecond collide on one key, and the second overwrites the first (proved with a fixed clock). Add a counter suffix when the key exists.
- **n5.** `Link.tsx:36-44`: if the clicked link unmounts while its navigation is in flight, its cleanup reports "not in flight". After 2.5 s the guard may then do the full load the fix is meant to avoid. This is rare, because nav links stay mounted.
- **n6.** "Reset to sample", "Start empty workspace" (`Settings.tsx:49-50`) and "Reset the whole workspace" (`Trial.tsx:55,66`) wipe a valid workspace in one click, with no confirmation and no backup. The messages are honest, but the backup machinery already exists. Per-case reset (`ResetCase.tsx`) is engine-gated, shows the refusal reason under the button and reports what it replaced, so it is fine, though it also has no confirmation.
- **n7.** Two forms are not dry-run gated: create intent (`Connect.tsx:61`) and ingest statement line (`Reconciliation.tsx:120`). They validate and report per field on submit, and nothing is created on refusal (browser tests at :739 and :760). This is consistent with the design, but these are the only primary actions without a dry run.
- **n8.** a11y: the filter summary (`filters.tsx:68`, `role="status"`) is announced on every filtering keystroke. Consider announcing only after the debounce. `Reports.tsx:42` `aria-controls` points to an id that exists only while the report is expanded, which is harmless.

---

## Focus questions answered

- **Action gating and honest messages.** Every `ActionButton` I found previews the real input: TargetActions (note, info, evidence including name and reference, resolve, reopen), AcceptDifference (probes both flag sets with the typed note), AcceptanceStatus (as the chosen approver), OwnerControl, Holds (documents, reviewer, decision), Connect (approve and reject as the checker), Investigation cancel, SimulateEvent and ResetCase (`canResetScenario`).
  - `useRun`, `act()`, ResetCase and Settings' advance-clock all say "recorded by the engine" only when `r.ok`.
  - Exceptions: n7.
- **Acceptance UI.** "Accepted by …" renders only from `resolution.acceptedDifference`, which the engine writes, and reopening deletes it (`actions.ts:746`).
  - A second approval shows as pending until `approvedBy` is set.
  - Currency mismatch is offered only so the engine's refusal can be shown, and the button stays disabled.
  - The gap is the queues (m-B).
  - "Simulated role — not sign-in or access control" appears on the global "Acting as" select (with `aria-describedby`), the Connect checker and the second-approval approver, through Field hint and `aria-describedby`. Those are all the acting-role selectors. Owner, reviewer and filter selects pick a person or value, not who is acting.
- **Migration notice and backups.** The original is backed up before the migrated workspace is saved, and the replace and boundary paths refuse when the backup fails. Exceptions: m-A (migration path) and m-C (storage growth).
- **URL filters.** Query values are only used in comparisons, React text (including "Unrecognised: …") and `URLSearchParams` built on the router's own pathname. There is no `dangerouslySetInnerHTML` or `innerHTML` in the console (grep), and no query value reaches an `href` path, so there is no XSS or open-redirect path.
  - Back/Forward: a select change is one history entry, and the queue of pending changes is cleared on any other URL. Exception: n1.
- **Case report.** The fictional marking is in the in-page view (`CaseReport.tsx:72`), the JSON (`marking` field) and the CSV (row 2, mutation-checked). The .txt case file starts with `ENGINE_DISCLAIMER` ("TEST MODE · fictional sandbox data").
  - The CSV formula guard is mutation-checked, and newlines are folded.
  - Filenames: n3.
- **Per-case reset.** Gated by the engine, the refusal code and reason are shown, a success message gives the counts, and nothing is reset without a message. Confirmation: n6.
- **Accessibility.** Scroll wrappers are now `role="group"`, so no landmarks are doubled. There is an "On this page" nav, a polite pending status with `aria-busy` on `main`, and a labelled `details` owner editor. Report boxes are focusable groups. The landmark checker is fixed. Exception: axe (m-D).

## Summary

APPROVE e023174, conditional on green browser suites. M1 and m1–m5 are verified fixed. There are no Blockers and no Majors. The four Minors are: (A) the migration backup-failure path can overwrite the original on the first action; (B) a pending second approval shows as "Resolved" in the queues; (C) backups grow without a delete; (D) axe still never runs. There are eight Nits. tsc is clean and vitest passes 1498 tests. Four mutants (CSV guard, fictional marking, reset refusal, M1 tone) are each killed. Browser tests were not run by me because of the disk limits; please share your suite results, and ideally run the four browser mutations listed above.

---

## Final check (0fd7861)

**Verdict: APPROVE 0fd7861.** A and B hold on every path that matters. The fix for C has one ordering bug: pruning can delete a newer backup and keep an older one (C1 below). It is Minor and should be fixed before anyone relies on "the newest 3 are kept". I report it below with a reproduction. APPROVAL-ONLY: needs Aashmiin's merge.

**What I ran:**
- **Frozen copy:** `scratchpad/cr5`, from `git archive 0fd7861`, with no build. The cr4 copy was removed for disk space.
- **tsc:** exit 0.
- **vitest:** 1498 passed, 57 skipped. This commit changes no engine files.
- **Unit probes:** a throwaway vitest file with an in-memory localStorage that enforces a quota, plus a controlled clock. It tested `writeBackup`, `listBackups`, `awaitingSecondApproval` and `needsAttention`. It has since been deleted.
- **Owner's results:** 198 passed, 6 skipped, 0 failed, three runs in a row, with all four browser mutations killed on desktop and mobile. I accept this as their report; I did not see it run.

### A: writes held when the pre-migration backup fails. Verified.
- **Where it is set:** `workspace.tsx`. On load, if the backup or the save fails, `holdWrites` is set and `migrations.held` is true.
- **`dispatch` and per-case reset:** both go through `persist`, which returns early while held.
- **Whole reset (Settings and Trial):** first retries the migration backup. If that fails, it refuses with the reason and replaces nothing. It writes the before-reset backup only when writes are not held, and the migration backup covers the held case.
- **Settings restore:** backs up the current saved copy (still the untouched original) before writing, and refuses if that backup fails.
- **Error boundary:** reads the saved copy (the original), backs it up, then removes it. A failed backup removes nothing.
- **Leaving the page:** the full-load guard now also asks while a migration is held.
- **Ways out:** "Dismiss" does nothing while held. "Continue without saving" keeps writes held and says so. "Replace the original … (no backup)" is explicit.
- **Actor choice:** still written to its own key, which is harmless.

### B: "Accepted — awaiting second approval". Verified, with one remaining place.
- **Where it shows:** the amber chip appears in the Exceptions table and cards, in Overview (its own metric, inside "Needs attention", linking to `?view=awaiting`), on the payment page (exception list, evidence timeline chip, open count) and in the Payments open-exception count.
- **Queues:** the Resolved view excludes these exceptions, and the new "Awaiting approval (n)" view lists them.
- **Helpers:** `awaitingSecondApproval` and `needsAttention` gave the right answers in my probe, including false once `approvedBy` is set.
- **Remaining place (Nit):** the synthetic case report still shows "Resolved" for such an exception.
  - In the page view: `CaseReport.tsx:123`, `label("exceptionStatus", e.status)`.
  - In the JSON and CSV exports from the engine: `report.ts:184,242` write `status: resolved` with no pending flag.
  - The case itself stays open and blocked, so nothing wrong is recorded.
  - Fix (in words): show the same amber wording in the report view, and add the second-approval state to the report's exception row (engine change, so approval-only).

### C: pruning and the counter suffix.
- **Counter suffix: verified.** Three backups of one kind in the same millisecond got three distinct keys, and all three values were kept (`workspace.tsx:45`).
- **No pruning after a failed write: verified.** With 3 backups and a quota failure on the 4th, `writeBackup` returned null and all 3 survived. Pruning runs only after `setItem` succeeds (`:47-48`).
- **C1 (Minor). Pruning can remove a newer backup and keep an older one.**
  - **Where:** `workspace.tsx:57-67`. Line 63 always sorts the un-suffixed key (`base`) as the oldest. After pruning has removed `base`, the next backup of that kind is written to `base` again (`:42-44` choose `base` whenever it is empty), so the newest backup now sits in the slot the sort treats as oldest.
  - **Reproduced:** six writes of one kind, v1 to v6, with distinct times. The newest 3 should be v4, v5, v6. **Kept: v3, v4, v6. v5 was deleted.**
  - **Trace:** v5 lands in the empty `base` and survives its own prune only because it is the key just written. The v6 write then prunes `base` (v5) and v2 as the "oldest two".
  - **Why it matters:** a backup's content can be the only remaining copy of that workspace, for example an earlier unreadable original. Settings promises "The newest 3 of each kind are kept".
  - **Test gap:** the journey test (spec :1500) seeds `base` as genuinely the oldest and writes only 4, so it does not reach this case.
  - **Fix (in words):** once any backup of a kind exists, always write new backups under a timestamped key, never back into the bare slot. Or sort by actual write time (for example, record the time inside every key, treating the bare slot's time as its own). Add a test with at least 5 writes of one kind that checks exactly the newest 3 remain.
- **Delete:** Settings now shows sizes and a total, and deletes only after a confirmation. `deleteBackup` refuses keys outside the backup prefixes.

### Nits from the final review
- **Fixed:**
  - n3: download names are limited to `[A-Za-z0-9._-]`, leading dots are replaced, and names are capped at 120 characters.
  - n4: same-millisecond collisions (counter suffix, verified).
  - n6: whole resets keep a before-reset backup, and the message says so. This is best effort: if that backup fails, the reset still proceeds and the message just omits the backup sentence. Saying "no backup could be kept" explicitly would be clearer.
  - n8: the filter summary is now announced through a separate polite status region about 700 ms after typing stops.
- **Not addressed, still Nits:** n1 (Back racing the search debounce), n2, n5 and n7.

### Summary
APPROVE 0fd7861.
- **A** is verified on every write path: dispatch, per-case reset, whole reset, restore, error boundary, and full-load navigation.
- **B** is verified everywhere in the console UI except the synthetic case report (Nit).
- **C:** the counter suffix and "no pruning after a failed write" are verified. One Minor remains: pruning can delete the second-newest backup and keep an older one (reproduced, v5 lost).
- **Checks:** tsc clean, vitest 1498 passed. The owner reports their browser suite as 198 passed, 0 failed, three runs in a row.

---

## Last check (02aae80, c3ad58d, 511842f; frozen at merge ef3e59f)

**Verdict: CHANGES REQUESTED ef3e59f, for one line.** The C1 fix is correct in normal use, but it adds a loop that never ends if the device clock has gone backwards since an earlier backup of the same kind. The case-report status fix is correct and tested. APPROVAL-ONLY: needs Aashmiin's merge (engine report shape, CHANGE 14).

**What I ran** (frozen copy at `scratchpad/cr6`, no build):
- **tsc:** exit 0.
- **vitest:** 1503 passed, 57 skipped.
- **Unit probes:** a throwaway test of `writeBackup` against an in-memory storage with a controlled clock, since deleted.
- **One engine mutation:** described under "Case report" below.

### C1: re-run of the six-write reproduction
- **Six writes, v1 to v6:** v4, v5 and v6 remain, exactly the newest 3. Each write's own key held its value right after writing, so the backup just written is never removed. The new rule (`workspace.tsx:41-55`) only uses the bare slot when a kind has no backups, and otherwise writes a timestamped key that sorts after every existing one.
- **Ten writes in the same millisecond:** w8, w9 and w10 remain, so the counter suffix sorts correctly.

**Major (new): the console freezes if an earlier backup's timestamp is later than the current clock.**
- **Where:** `workspace.tsx:52`.
- **Why the loop never ends:** the loop keeps adding a counter while the candidate key is not after the last existing key. If the last key carries a later time than now, every candidate `${stamp}-NNN` still starts with the earlier stamp, so it always sorts before the last key and the condition never becomes false.
- **Reproduced:** with one backup keyed `…unreadable-backup.2026-12-01T…` and the clock at 2026-11-14, `writeBackup` made more than 100,000 storage reads before my guard stopped it. In a browser there is no guard, so the tab hangs.
- **How this happens in practice:** any backup written while the clock was ahead, followed by a backup of the same kind after the clock is corrected (a manual clock change, or a fixed test clock).
- **Why it matters:** `writeBackup` runs in the hydration effect (migration backup), in resets, in the error boundary and in restore. A hang there freezes the console on load, and the error boundary cannot catch a loop that never returns. No data is lost: the loop runs before any write.
- **Fix (in words):** when the current timestamp does not sort after the last existing key, build the new key from the last key itself (the last key plus a counter suffix), and give the loop a hard upper bound. Add a unit or browser test that seeds a future-dated backup and writes one more.

### Case report: "Accepted — awaiting second approval"
- **Engine (511842f):** `exceptions[].status` is `accepted_awaiting_second_approval` only when the exception is resolved and its acceptance's second approval is pending. Otherwise it is the exception's own status, with `engineStatus` kept and an `acceptance` block added. The CSV label uses `statusLabel`, and an `exception_acceptance` row names the person who accepted and the approver.
- **Reopen:** reopening clears `acceptedDifference`, so the report shows `reopened` with no acceptance (test at `rc3-case-report.test.ts:333`).
- **Mutation:** with the status forced back to the exception's own status, the "above 1% and not yet approved … (JSON and CSV)" test fails. I restored the file and checked it with diff.
- **On screen (c3ad58d):** `CaseReport.tsx` now shows the engine's `status` and `statusLabel` (amber when awaiting), the raw status value, and the acceptance text. The earlier lookup into the workspace is gone, so the screen, JSON and CSV all read from one source.

### Summary
CHANGES REQUESTED ef3e59f.
- C1 now keeps exactly the newest 3 backups, and the one just written is never removed (six-write and same-millisecond reproductions both pass).
- The report shows the awaiting status in JSON, CSV and on screen, a reopen withdraws it, and the test fails under mutation.
- Blocking: the key loop at `workspace.tsx:52` never ends when an existing backup is dated later than the current clock (reproduced). Building the key from the last key, with a bounded loop, fixes it. Everything else is approved.

---

## Freeze fix check (fa303fd)

**Verdict: APPROVE fa303fd.** The loop that never ended is gone. Pruning keeps exactly the newest 3 in every case I tried, including a clock that stays behind for 200 writes and then jumps forward, backward and in between. APPROVAL-ONLY: needs Aashmiin's merge (the release as a whole). This fix was written by the integration lead; I reviewed it independently and wrote none of it.

**What I ran:**
- **Frozen copy:** `scratchpad/cr7`, from `git archive fa303fd`, no build.
- **tsc:** exit 0.
- **vitest:** 1503 passed, 57 skipped.
- **Throwaway harness, rerun and then deleted:** an in-memory localStorage with a guard against runaway reads, plus a controlled clock. Results:
  - Six writes, v1 to v6: v4, v5 and v6 remain. Every write's key holds its own value straight after writing.
  - Ten writes in the same millisecond: w8, w9 and w10 remain.
  - A bare slot plus a backup dated 2026-12-01, with the clock at 2026-11-14 for **200 writes**: no hang (well under the read guard), every write succeeds, and exactly b198, b199 and b200 remain, in write order.
  - The clock then moved to 2026-12-02, to 2026-12-01T00:00:00.500Z (between the future key and the next day), and back to 2026-11-01 for two writes: c2, c3 and c4 remain, which is the newest 3.
  - Mixed key shapes: a bare key, a timestamp, a timestamp with `-002`, then two keys extended with `~` after the clock moved back, then a timestamp equal to an earlier one. The newest 3 remain in order.

**Is the `~` ordering sound for every key shape?** Yes.
- Keys are sorted with the bare slot first, then by plain string comparison (`keysOf`).
- A new key is always strictly after the newest existing key. Either the current timestamp already sorts after it, or the new key is the newest key plus `~`, which sorts after it because a string extended by one character sorts after itself.
- The bare slot is used only when a kind has no backups. Since 02aae80, a key freed by pruning is never reused.
- A key ending `-NNN` sorts before the same key plus `~`, because `-` (0x2D) comes before `~` (0x7E).
- So key order equals write order, and pruning (oldest first, never the key just written) keeps exactly the newest 3.

**Does the key keep growing while the clock stays behind?** Yes: one `~` per write (200 writes made the longest key the base length plus 225 characters). Only the newest 3 keys exist at a time, and the growth stops once the clock passes the future date. **Nit:** Settings shows the key's tail as the backup's time, which then reads `…Z~~~~`. Consider showing "saved after a later-dated backup" instead.

**Is returning null at the cap safe on every caller?** The cap cannot be reached in practice.
- Whenever the current timestamp does not sort after the newest key, the `~` branch takes over and produces a key nobody has written. When the timestamp does sort after the newest key, no existing key equals it.
- So the counter loop body never runs. I tried to force the cap with 1,000 counter keys in one millisecond: the `~` branch wrote `…-999~` instead of returning null.
- If it ever did return null, every caller treats that as "backup not written":
  - **Loading an updated workspace:** writes stay held and the person chooses.
  - **Replacing an unreadable copy, or a whole reset while writes are held:** refused, with the reason given (the text says "storage full or blocked", which would be slightly wrong but safe).
  - **Error boundary:** nothing is removed, and download, then remove, is offered.
  - **Settings restore:** refused.
  - **One exception (Nit, carried over from n6):** an ordinary whole reset treats the before-reset backup as best effort, so on null it still resets. The message only omits the "kept as a backup" sentence. That is the same as on a quota failure and is honest, but not a refusal.

**Summary:** APPROVE fa303fd. My blocking finding is resolved, pruning is correct for every key shape and clock movement I tried, and the cap is unreachable and safe. Two Nits remain: the display of keys ending in `~`, and the best-effort backup on ordinary whole resets.
