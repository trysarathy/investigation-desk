# Task 1: the Books page on a phone (plan tasks-2026-11-02 row 3, baseline F1)

Run as: frontend-product-engineer, golden-task run. Live tools off: no Sheet, no GitHub writes, no build,
no server. Everything marked "not run" is what I would run; no number below was measured by me this run.

## §0 pre-flight (would do)
PAUSE check (Settings + Gmail search) → assumed FALSE per tester instructions. Task is assigned to me in
`team/plan/tasks-2026-11-02.md` row 3, so it is in scope.

## Restated task + acceptance
- Task: make `/books` usable on a phone.
- AC1: `document.documentElement.scrollWidth === clientWidth` on `/books` at 320×800 and 390×844 (today 743 / 743).
- AC2: each audit-log entry's text is readable at 390: the text block gets the full row width (≥ ~300 px at 390), not ~40 px; no 2-D scroll (WCAG 2.2 SC 1.4.10 Reflow).
- AC3: nothing else changes at 1280 (same columns, same amounts, same `data-testid`s); 1280 page width stays 1280.

## Diagnosis: route → file → component → root cause
Route `/books` → `src/app/books/page.tsx` (server component; owned screen 5, Xero entry preview's
`/books` half). [VERIFIED: code read, `main-ro` @ 0c7d9f1, 2026-11-01]

**Root cause 1 (the 743 px page width): the demo invoices table is not inside `.table-wrap`.**
`<table className="table" style={{ width: "100%" }} data-testid="demo-invoices">` sits directly in
`<section className="panel">`. `.table td` has `white-space: nowrap` (globals.css:172), so 7 columns
(Invoice, Customer "Northwind…", Total, Paid, Written off, Due, Status) need ~743 px and nothing lets
the table scroll on its own, so the whole document widens to 743 px at both 390 and 320. Every other
list page wraps tables as `<div className="table-wrap"><table className="table">…` (`.table-wrap
{ overflow-x: auto; }`, globals.css:177) — this one forgot (component-conventions.md "Tables" row
already names this as F1).

**Root cause 2 (one word per line in the audit log): a fixed 3-column grid with no phone breakpoint.**
Each `<li>` has inline `gridTemplateColumns: "150px 110px minmax(0,1fr)"`, `gap: 12`, padding 16 px each
side. Fixed cost = 150 + 110 + 2×12 + 2×16 = 316 px before the text column. At 390 the panel content
box is ~390 − 2×16 (`.page` padding at ≤ 760 px, globals.css:259) − borders ≈ 356 px, leaving ≈ 40 px
for the text — matching the fixture's "about 40 px wide" and the 17,746 px page height. It is inline
style, so the existing 760 px media query can't reach it. (A secondary contributor: the page is already
743 px wide from cause 1, but even at 390 with cause 1 fixed the grid leaves ~40 px.)

Also seen, not fixed in this PR (one concern per PR): the time stamp is `.faint` (`--text-3`, lead-designer
A1, fails 4.5:1); the "Simulated books…" demo line is `.faint` too — A1's token fix covers both.

## The fix (smallest change, existing patterns only; < 20 changed lines)

```diff
--- a/src/app/books/page.tsx
+++ b/src/app/books/page.tsx
@@ demo invoices
         <section className="panel">
           <div className="panel-h"><h2>{books.orgName}</h2><span className="faint">Simulated books: fictional company, no connection to any real accounting system</span></div>
-          <table className="table" style={{ width: "100%" }} data-testid="demo-invoices">
+          <div className="table-wrap">
+          <table className="table" style={{ width: "100%" }} data-testid="demo-invoices">
             …unchanged thead/tbody…
           </table>
+          </div>
         </section>
@@ audit log
-            <li key={e.id} style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "150px 110px minmax(0,1fr)", gap: 12, fontSize: 13 }}>
+            <li key={e.id} className="audit-row">
               <span className="faint">{friendlyTime(e.at)}</span>
               <span><span className="badge">{KIND[e.kind]}</span></span>
               <span>…unchanged…</span>
             </li>
```

```diff
--- a/src/app/globals.css
+++ b/src/app/globals.css
@@ after .table-wrap (line 177)
 .table-wrap { overflow-x: auto; }
+/* Books audit log: time | kind | text on wide screens; on a phone time + kind share a line and the text gets the full width. */
+.audit-row { padding: 8px 16px; border-top: 1px solid var(--border); display: grid; grid-template-columns: 150px 110px minmax(0, 1fr); gap: 12px; font-size: 13px; }
+.audit-row > :last-child { overflow-wrap: anywhere; }
@@ inside the existing @media (max-width: 760px) block
   .kv { grid-template-columns: 1fr; }
+  .audit-row { grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; }
+  .audit-row > :last-child { grid-column: 1 / -1; }
   .wide-only { display: none; }
```
Why this shape: the 1280 layout is byte-for-byte the same values moved from inline style to a class
(AC3); the phone layout reuses the existing 760 px breakpoint and the same stacking idea the `.timeline
li` and `.kv` rules already use at ≤ 760 px. No new token, colour or component. `overflow-wrap: anywhere`
stops a long hash or ID in a reason from re-creating overflow. Table on phone: the table scrolls inside
its own panel (the house pattern); a card layout (`.wide-only`/`.narrow-only`) would be a bigger visual
change and needs a lead-designer spec — I'd offer it as a follow-up, not do it here.

Amounts: untouched. Every figure still comes from `formatUsdc()` on lib data; no column, value or order changes.

## Approval-only?
**No.** It changes layout/CSS only on `/books`: no posting rule or posting action, no amount or line
(values and `formatUsdc` calls unchanged), no auth, permissions, pricing copy, customer data, secrets or
deletions (OPERATING_MODEL §2 list). It still needs the full definition of done (lead-designer review
comment because it is visual, `CODE REVIEW: APPROVE <head>`, `QA: PASS <head>`), and per OPERATING_MODEL
§2 nothing auto-merges while the ruleset lacks the `ci` required status check (state as of 1 Nov) — so
if that is still true at 06:17, it waits for Aashmiin's click.

## Tests / what the e2e needs
- No lib logic changes, so no vitest test; the failing-first evidence is the measurement (`scrollWidth 743` at 390/320).
- **The e2e does not cover `/books` today.** `tests/e2e/demo_cases.py` `no_overflow()` visits only
  `/requests`, `/requests/all`, `/requests/DEMO-1042/1043/1044/1047` at the desktop size and only the
  `/pay/...` page at 390 [VERIFIED: code read `tests/e2e/demo_cases.py:200-213`]. That is why F1 shipped.
  Add (same PR, ~10 lines):
  ```python
          for path in ["/requests", "/requests/all", "/requests/DEMO-1042", "/requests/DEMO-1043", "/requests/DEMO-1044", "/requests/DEMO-1047", "/books"]:
  ...
          for vw in (390, 320):
              p = browser.new_page(viewport={"width": vw, "height": 844})
              go(p, BASE + "/books"); p.wait_for_selector("[data-testid=audit-log] li")
              w = p.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
              if w > 1: bad.append((f"/books {vw}", w))
              tw = p.evaluate("document.querySelector('[data-testid=audit-log] li > :last-child').getBoundingClientRect().width")
              if tw < 240: bad.append((f"/books audit text {vw}", tw))
              p.screenshot(path=str(OUT / f"books-{vw}.png"), full_page=True); p.close()
  ```
  Keep `data-testid="demo-invoices"` and `data-testid="audit-log"` exactly (the e2e uses them; I don't
  rename either). Whole `demo_cases.py` must still pass.

## Proof plan (exact commands; NOT RUN here)
Per `measuring.md` §1, base `0c7d9f1` and branch head in the same session:
```bash
SC=<scratchpad>; for SHA in 0c7d9f1 <head>; do
  rm -rf $SC/build && mkdir -p $SC/build $SC/desk && git -C <repo> archive $SHA | tar -x -C $SC/build
  (cd $SC/build && npm ci && DEMO_MODE=on AI_EXPLANATIONS=off ./node_modules/.bin/next build)
  (cd $SC/build && DEMO_MODE=on AI_EXPLANATIONS=off DESK_DATA_DIR=$SC/desk ./node_modules/.bin/next start -p 3300 &)
  curl -s -X POST -H 'content-type: application/json' -d '{"kind":"reset"}' http://127.0.0.1:3300/api/requests/demo
  AXE=$SC/tools/node_modules/axe-core/axe.min.js NODE_PATH=$(npm root -g) node K/tools/measure.cjs http://127.0.0.1:3300 $SC/out-$SHA 5 /books /requests
  CPU=4 TIMING_ONLY=1 OUTFILE=measure-cpu4.json NODE_PATH=$(npm root -g) node K/tools/measure.cjs http://127.0.0.1:3300 $SC/out-$SHA 5 /books /requests
  AXE=… NODE_PATH=$(npm root -g) node K/tools/reflow-dark.cjs http://127.0.0.1:3300 /books   # 320 scrollWidth + dark contrast
  kill <PID>
done
BASE=http://127.0.0.1:3300 python tests/e2e/demo_cases.py     # on the head build
npx tsc --noEmit && npx vitest run && npx next build && npm run lint
```
Then open the 390 and 320 full-page PNGs myself (crop with PIL) and check the audit text reads as lines,
the invoice table scrolls inside its panel, and the DemoBadge and "Simulated books…" line are visible.

## PR body (playbook §6)
```
Branch: ui/books-phone-reflow-20261102   (from fresh origin/main)

## What and why
/books was 743 px wide on a phone (390 and 320) and its audit log showed one word per line (baseline F1,
plan tasks-2026-11-02 row 3; roadmap row: <link>). Cause 1: the demo invoices table wasn't inside
.table-wrap, so with nowrap cells it widened the whole page. Cause 2: the audit log used an inline
150px/110px/1fr grid with no phone breakpoint, leaving ~40 px for the text. Fix: wrap the table in the
house .table-wrap; move the audit row grid into an .audit-row class that, at ≤ 760 px, puts time + kind
on one line and gives the text the full width.

## Acceptance criteria
- [ ] /books scrollWidth == clientWidth at 320 and 390 (was 743)
- [ ] audit-log text column ≥ 240 px at 390 and 320; no one-word-per-line
- [ ] 1280 layout unchanged (same columns, widths, amounts, test ids); page width 1280

## Approval-only?
No — layout/CSS only; no posting, amounts, auth, pricing copy, customer data or deletions touched.
Amounts still come from formatUsdc() unchanged.

## Tests
No lib change → no vitest test. Failing-first evidence: measured scrollWidth 743 at 390/320 on base.
e2e: demo_cases.py now checks /books for horizontal scroll at 1280, 390 and 320 and the audit text width.
Result: <not run yet — paste output>.

## Load time   (median of 5, local prod build, demo day, 1280×800, base 0c7d9f1 head <sha>)
| Route | Before load / LCP | After load / LCP | 4× CPU after | 
|---|---|---|---|
| /books | <ms> / <ms> | <ms> / <ms> | <ms> / <ms> |
| /requests | <ms> / <ms> | <ms> / <ms> | <ms> / <ms> |
(Not measured yet. Reference only: pack baseline 2026-11-01 /books 147 / 408 ms, which I did not re-run.)

## Accessibility
axe serious/critical at 1280 and 390, before → after: <counts by id>; pre-existing listed separately
(A1 colour-contrast on .faint, A5 link-in-text-block). Reflow 320/390: <scrollWidth before → after>.
Keyboard: no controls added; Tab order through invoice links and audit-log request links unchanged
<checked: y/n>; a scrollable .table-wrap must still let keyboard users reach every cell link (links are
focusable inside it). Contrast: no colour pair changed. Not checked: screen reader, 200 % zoom.

## States
Unchanged: empty audit log "Nothing posted yet."; no new state.

## Screenshots
books-1280-before/after.png, books-390-before/after.png, books-320-before/after.png — from the running
build this run, demo data, DemoBadge and "Simulated books: fictional company…" visible and uncropped.

## Copy check
No strings changed.

## Checks
npx tsc --noEmit · npx vitest run (<n> passed) · npx next build · npm run lint — <not run yet>

## Changelog
"The Books page now fits on a phone: the demo invoice table scrolls inside its own panel and each audit
log entry shows its text across the full width instead of one word per line."
```
Hand-off: lead-designer review comment (390/320 screenshots) → code-reviewer → qa-security-engineer.

## Company HQ (would write; not run)
- Product roadmap row "Books page usable on a phone (F1)": status `in review`, PR link.
- Log: `2026-11-02 <hh:mm> | frontend-product-engineer | opened ui PR | #<n> @ <sha> | /books reflow F1: load <ms>/<ms> (not yet measured), axe new <n>, a11y open 1H/4M/3L; approval-only: n`.
- After merge: re-measure `/books` and update `baseline.md` (F1 stays open until `/requests/DEMO-1047`,
  `/requests/DEMO-1042` and `/payments` reflow failures are fixed too — this PR fixes only `/books`).
