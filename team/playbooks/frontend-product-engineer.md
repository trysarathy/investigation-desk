# Playbooks: frontend-product-engineer

`K = team/knowledge/frontend-product-engineer`. Repo: `trysarathy/investigation-desk`. Times SGT.
Scratch = the session scratchpad, never the shared worktree. Every playbook starts with §0 and ends with
Log rows: `<SGT timestamp> | frontend-product-engineer | <action> | <ids> | <details + links>`
(`RISK:` first in details when risky).

## §0 Pre-flight (every run, every task)
1. Read Company HQ Settings `PAUSE` and run the PAUSE Gmail search (company rule 1). PAUSE = TRUE → one
   Log row `stopped: PAUSE on` and stop. If the Google connection is a hatch.sg account: stop, change
   nothing, report it.
2. `git fetch origin`; work from a fresh `origin/main`. Baseline: `npm ci && npx tsc --noEmit && npx
   vitest run`. Red `main` → don't build on it; Log `RISK: main red` and hand to the build owner.
**Stop conditions (any playbook):** a request to hide/shrink a demo label or show demo data as real; to
change an amount, account, date or line the posting plan computes; to show "paid automatically" or any
claim not in PRODUCT_FACTS on a live screen; to merge outside OPERATING_MODEL §2; a secret or real
customer data in a screenshot or fixture. → stop that task, explain, offer the honest alternative,
Approval Queue row and `RISK:` Log row as the definition says; carry on with other assigned work.

---

## §1 Nightly build (trigger: 00:47 SGT scheduled task)
1. §0.
2. Open `team/plan/tasks-<today, SGT, YYYY-MM-DD>.md`. Collect tasks whose owner is
   `frontend-product-engineer`. **None, or no file → one Log row "no tasks assigned, exiting" and stop.**
   Don't pick roadmap rows yourself; don't "improve" unassigned screens.
3. For each assigned task in order (max 2 per night): restate it in one line + acceptance criteria in
   one line each. Can't? → `needs decision` row with the exact question; next task.
4. Classify: **approval-only?** (posting to Xero/QuickBooks, money amounts shown or sent, auth,
   permissions, pricing copy, customer data, deletions). Write the answer in the PR body now.
5. If the task needs design (new layout, component, token, copy tone) and there's no lead-designer spec
   linked → §5 step 1 (ask), don't invent.
6. Build per §2-§4 → open the PR per §6 → hand to code-reviewer and qa-security-engineer.
7. Update the Product roadmap row (`in review` + PR link); Log; summary row with the metric line.

## §2 Screen-quality fix (states, errors, reflow, ARIA, focus)
**Trigger:** an assigned task citing a finding (A1-A10 lead-designer, F1-F5 `K/baseline.md`) or a missing state.
1. Reproduce and capture **before**: `K/tools/measure.cjs` on the affected routes (and
   `reflow-dark.cjs`, `keyboard-flow.cjs`, `state-shot.cjs` as relevant). Save the output.
2. Tests first where logic exists: copy/selection logic → `src/lib` + vitest test failing first. Pure
   markup/CSS → the failing evidence is the measurement (e.g. `scrollWidth 743` at 390).
3. Smallest change using existing classes/components (`K/component-conventions.md`):
   - Missing error state → `src/app/<segment>/error.tsx` (`"use client"`, props `{ error, reset }` on our
     Next 15.5), copy from `K/error-messages.md`, a Try again button calling `reset()` and a link to a safe
     page; no raw error text on screen.
   - Missing/wrong not-found → segment `not-found.tsx` naming the thing ("request", not "case").
   - Loading → segment `loading.tsx` with a skeleton shaped like the page and `aria-label` naming it.
   - Empty → `<what's empty>. <why>. <one action>`.
   - Reflow → wrap the table in `.table-wrap` or use the `.wide-only` / `.narrow-only` cards pattern.
   - ARIA → native first (`aria-current="page"` on the active filter link, not `aria-pressed`).
   - Focus after an action → move focus to the result message (`tabIndex={-1}` + `ref.focus()`).
4. Re-measure **after** the same way; both widths; both themes for colour changes.
5. §6 PR.
**Stop if:** the fix needs a new token or a layout change → lead-designer spec first (§5).

## §3 Measuring load time (before you write "< 1 s")
Procedure: `K/measuring.md` §1 (scratch copy at the exact commit, `npm ci`, `next build`, `next start`
with `DEMO_MODE=on AI_EXPLANATIONS=off DESK_DATA_DIR=<scratch>`, reset the demo, `measure.cjs ... 5
<routes>`, then `CPU=4 TIMING_ONLY=1`).
**Checks:** n = 5, median reported, base and head measured in the same session, routes = every owned
screen the diff touches + `/requests`. **Pass:** median load and LCP < 1000 ms at 1× CPU.
**Write it as:** a table (route, TTFB, load, LCP, max, 4× CPU) + one line of setup + commit SHAs.
**Stop if:** you couldn't build or start the server → say "load time not measured: <error>", never estimate.
**Lists:** if the diff touches `/payments`, `/inbox` or `/requests/all` rendering, also measure with a
large data set (or say it wasn't).

## §4 Accessibility check
1. axe (from `measure.cjs`) at 1280 and 390: 0 serious/critical **introduced** by the diff; list the
   pre-existing ones (e.g. A1) separately, by count before → after.
2. Keyboard: Tab through every control the diff adds or changes; Enter/Space operate them; Esc closes
   dialogs; focus visible on each; no trap; where focus lands after the action. For flows on the
   decision panel or Approve: `keyboard-flow.cjs` (reset the demo after).
3. Contrast for any colour pair touched: `lead-designer/tools/contrast.mjs`, both themes.
4. Reflow at 320 and 390 (`reflow-dark.cjs`). Targets ≥ 24 px.
5. Status messages: success in `role="status"`, inserted failure in `role="alert"`, never only colour.
6. Write what you could not check (screen reader, 200 % zoom).
**Never** write "AA" or "accessible" for the screen as a whole unless every Gate in
`lead-designer/review-checklist.md` B is ticked with evidence from this run; say "no new axe violations;
A1 still open" instead.

## §5 Working with lead-designer (design spec in → build → designer review)
1. **Spec in.** For anything visual beyond an existing pattern, ask lead-designer for a spec (Approval
   Queue is not needed; a note on the roadmap row / plan task): purpose, states (empty/loading/error/
   long values/0 and 1 items), copy, tokens/components to use, 1280 and 390 layout, acceptance checks.
   Don't start the visual part without it; you may start the lib/test part.
2. **Build** strictly to the spec with existing tokens/components. Where the spec and PRODUCT_FACTS
   disagree (e.g. a mock showing "Paid automatically" in live mode), PRODUCT_FACTS wins: build the true
   version, flag the conflict to lead-designer and Aashmiin.
3. **Designer review.** Post the PR with screenshots at 1280 and 390 (before/after, light and dark if
   colour changed) and ask lead-designer for a review comment against `review-checklist.md`. Fix their
   findings in the same PR. Their comment is required before you request code review for anything
   visual; it does not replace `CODE REVIEW: APPROVE` or `QA: PASS`.
4. Token or component change → lead-designer updates `brand-system.md` / `tokens.dtcg.json` in the same PR.

## §6 The PR (template) and screenshot evidence
Branch `ui/<slug>-<YYYYMMDD>`; commits as `Aashmiin Kaur <aashmiin@gmail.com>` with the Co-Authored-By
and session lines; never push `main`. Body:
```
## What and why            <one paragraph; roadmap row / plan task link>
## Acceptance criteria      <checklist>
## Approval-only?           yes/no — <which item: posting, money amounts, auth, pricing copy…>
## Tests                    <failing-first output for lib changes; e2e demo_cases.py result>
## Load time                <table: route | before load/LCP | after load/LCP | 4× CPU>  median of 5, local prod build, demo day, 1280×800, base <sha> head <sha>
## Accessibility            axe serious/critical before → after (by id); keyboard pass notes; contrast pairs; reflow 320/390; not checked: <…>
## States                   empty / loading / error / not-found: screenshot links
## Screenshots              1280 + 390, before + after, demo label visible in every demo screenshot
## Copy check               every changed string vs company/PRODUCT_FACTS.md (quote the row)
## Checks                   npx tsc --noEmit · npx vitest run (n passed) · npx next build · npm run lint
## Changelog                <plain-English line added to CHANGELOG.md>
```
**Screenshot rules:** taken from the running build this run; filenames `<route>-<width>-<before|after>.png`;
demo data only; the demo badge/labels must be visible and unedited; no real addresses or customer
data; crop only to focus, never to remove a label.
**Merge:** only per OPERATING_MODEL §2 at merge time (protection on, CI green on head, `CODE REVIEW:
APPROVE <sha>` and `QA: PASS` for that head from other agents, < ~300 lines, not approval-only). Else
Approval Queue row: 3-line summary + risk; Aashmiin merges.

## §7 Screen-quality checklist (paste into every PR that touches an owned screen)
- [ ] Load: median load and LCP < 1000 ms (n = 5, method §3), numbers in the PR
- [ ] axe: 0 new serious/critical at 1280 and 390; pre-existing listed
- [ ] Contrast ≥ 4.5:1 text / 3:1 UI for every pair touched, both themes
- [ ] Keyboard: every new control reachable, operable, visible focus, no trap, focus lands sensibly after actions
- [ ] Reflow: no 2-D scroll at 320 and 390
- [ ] States: empty, loading, error, not-found exist and say what to do next
- [ ] Errors: plain English, what happened + what to do + what did not change; announced
- [ ] Demo: labelled on every demo screen and screenshot; no fake data presented as real
- [ ] Copy matches PRODUCT_FACTS (no "paid automatically" in live, no "posts automatically", no "every")
- [ ] Amounts/lines come from `src/lib` untouched; approval-only flagged if posting/money/auth/pricing touched
- [ ] lead-designer review comment (visual changes); e2e `demo_cases.py` passes; tsc/vitest/build/lint green
**Log:** `ui PR #n @ <sha> | <screen> | load <ms>/<ms>, axe new 0, a11y open H/M/L; approval-only: <y/n>`.

## §8 Weekly metric
Sunday before 17:38: re-run `measure.cjs` on all owned routes on `main`, recount Gates per screen
(`K/baseline.md` §3), update `baseline.md` and send the line to chief-of-staff: `screens at standard
n/5 (±), a11y issues open H/M/L (±), PRs awaiting merge`.
