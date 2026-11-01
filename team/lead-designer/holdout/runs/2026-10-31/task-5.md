# T5. "Posted to Xero ✓ — Undo" toast: review + component design

lead-designer · 31 Oct 2026 (SGT) · product `origin/main` @ `8decb27` · roadmap row "Books: posting confirmation toast"

**PAUSE (G19):** not checked: live tools are off in this run. Nothing sent, pushed or opened.

**One line for the product-manager:** the problem is real (I reproduced it: after "Approve and post",
the success message disappears and keyboard focus drops to `<body>`), but the toast as specced would
promise an Undo the product cannot do, name Xero when the demo posts to "the demo books", fail
contrast at 2.28:1, and break three SPEC §9 rules. I designed an in-panel confirmation instead and
built it in a scratch copy to prove it works (screenshots below).

## What I found (evidence from this run)

Scratch worktree `/tmp/claude-0/ld-ho` at `8decb27`, `next build` + `next start` in demo mode,
request `DEMO-1042` ("Ready to post"), Playwright, Enter on `[data-testid=approve-posting]`:
- 300 ms after: no `role=status` text yet. 3.8 s after: badge "Posted", **0 status messages, focus
  on `BODY`**. Cause: `ApprovePosting.tsx:24` sets the message, then `refreshAfterChange(router)`
  re-renders `BooksPanel`, which only renders `ApprovePosting` while `plan.status === "ready"`
  (`BooksPanel.tsx:71`), so the component, its message and the focused button are all removed.
  Shots: `t-5/before-ready-390.png`, `t-5/before-posted-390.png`.

## Review of the spec

| # | Spec item | Problem (measured / cited) | Decision |
|---|---|---|---|
| S1 | **Undo within 8 s reverses the posting** | The adapter interface has `listOpenInvoices()` and `post()` only (`src/lib/accounting/types.ts:190-198`: "Nothing else writes to the books"). No void, delete or reversal in `src/lib/accounting/` (grep: none). An Undo button would be a false claim. A reversal is also a **second write to the books**, so by company rule 3 it needs its own approval, not a timed shortcut | **Refused in the UI.** Hand to crypto-protocol-engineer if wanted (void/credit-note design, Xero test); product-manager decides scope |
| S2 | "Posted to Xero ✓" | Demo posts to "the demo books" (`service.ts:73`); Xero is **in testing** (PRODUCT_FACTS). Hard-coding "Xero" over-claims in every demo | Name the real destination from `where` (`BooksPanel.tsx:53`) |
| S3 | `#22c55e` bg, white text | **2.28:1** (needs 4.5); new hex not in the system (G14); default Tailwind green-500 (anti-template list) | Existing tokens: `--green` on `--green-soft` 4.79 light / 7.44 dark |
| S4 | Soft drop shadow, 12px radius | SPEC §9: "1 px borders instead of shadows, 6 px radius" | 1px border, `--radius` 6px |
| S5 | Slide-up 300 ms | No `prefers-reduced-motion` handling in the CSS given | No motion at all (0 animations measured) |
| S6 | Auto-dismiss 8 s | The only proof a write to the books happened vanishes on a timer; a timed Undo would be 2.2.1 Timing Adjustable (A) | Stays until the page changes; it is the record |
| S7 | Fixed bottom-right / full-width bottom on phone | At 390 a fixed bar covers content and can hide the focused control (2.4.11 AA); away from the panel it confirms | Inline, top of the "In your books" panel |
| S8 | Move focus onto the toast | Moving focus to a transient element that then disappears is disorienting. **But** here the pressed button is removed, so focus must go somewhere | Focus moves to the confirmation **only** when it replaces the button just pressed (one-shot `sessionStorage` flag) |
| S9 | "✓" as the signal, "Posted to Xero ✓  — Undo" copy | Status must be text + icon + colour (SPEC §9); em-dash copy | "✓" is `aria-hidden`, text says it |

## The component (built and rendered in the scratch copy)

**Copy:** `✓ Posted to {where} · {n} lines · approved by {name}, {time}` + `Audit log` link.
Demo renders: "Posted to the demo books · 2 lines · approved by Mei Tan (Finance ops), Today 23:42 SGT".

**States:** ready (unchanged: button + "Approving as…") → posting (button "Posting…", disabled:
existing) → **posted** (this notice, server-rendered from the last `posted` audit entry, so it survives
refresh and reloads) → error (unchanged: red text in `role=status`, "Nothing was posted"). Long names
wrap (`overflow-wrap: anywhere`); 1 line → "1 line".

**Tokens (all existing; ratios from `contrast.mjs`):**

| Part | Light | Dark |
|---|---|---|
| Text `--green` on `--green-soft` | `#1f7a3d`/`#e9f5ec` **4.79:1** | `#5cc98a`/`#15291e` **7.44:1** |
| Link `--text`, underlined | `#17181c`/`#e9f5ec` 15.83:1 | `#ececee`/`#15291e` 13.01:1 |
| Focus ring `--focus` on green-soft | `#3b5bdb` 5.06:1 | `#8aa0f5` 6.16:1 |
| Border | `--green` 35% (same recipe as `.bar-amber`/`.bar-red`, `globals.css:161-162`) | same |

**Measured in the build (Playwright, light + dark, 1280 + 390):** focus lands on
`posted-notice` with a 2px `--focus` outline in all four; 0 running animations; no horizontal scroll
(390/390, 1280/1280); "Audit log" target 55×24 (passes 2.5.8; it is a secondary link). Shots:
`t-5/after-posted-{light,dark}-{390,1280}.png`.

**TSX/CSS:** full diff in `t-5/proposed.diff` (14 lines changed + one 30-line file). In short:
- new `src/components/books/PostedNotice.tsx`: `<div role="status" tabIndex={-1} className="bar bar-paid posted-notice">`,
  focuses itself once if `sessionStorage["clearline.justPosted"] === requestId`, then clears the flag;
- `BooksPanel.tsx`: render it at the top of `.panel-b` when `plan.status === "posted" && lastPosted`;
- `ApprovePosting.tsx`: set the flag on `r.ok`;
- `globals.css`: `.bar-paid { background: var(--green-soft); color: var(--green); border-color:
  color-mix(in srgb, var(--green) 35%, transparent); }` + layout rules. No new hex. `npx tsc --noEmit`
  passed and `next build` passed in scratch; `vitest` not run yet.

**WOULD OPEN PR:** `design/books-posted-notice-20261031` off `origin/main` → `main` (Aashmiin merges).
Title "Books: lasting posted confirmation (no toast, no undo)". Body: the problem + repro above, S1-S9,
before/after at 1280 + 390 light/dark, ratio table, checklist, code gates (`tsc`, `vitest`, `next
build` counts to paste), "Undo is not in this PR: the product cannot reverse a posting". Also update
`brand-system.md` (components list: `.bar-paid`) in the same PR. Follow-ups noticed: `service.ts:73`
prints the raw provider id ("xero", lower case) in the message; the panel's own "audit log" link sits
in `.faint` text without an underline (A5 pattern).

## Reply to the product-manager (draft)

> Thanks: you found a real gap. Today the success message vanishes the moment the panel refreshes and
> keyboard focus is lost. I've designed a fix that keeps a confirmation in the panel instead of a
> toast: "✓ Posted to the demo books · 2 lines · approved by …, time · Audit log", in our green tokens
> (4.79:1 light, 7.44:1 dark), no shadow, no motion, and focus moves to it only because the button it
> replaces is gone. Three things I changed from the spec: (1) **No Undo**: the books adapter can only
> post, not reverse (`types.ts:193-198`); a reversal is a new write that needs its own approval, so if
> you want it, it's a spec for crypto-protocol-engineer, not a button. (2) It names where it posted
> (demo books today; Xero is still in testing). (3) No auto-dismiss: it's the record a write happened.
> `#22c55e` with white text is 2.28:1, so it can't ship. Screenshots and diff in the PR when you agree.

Log rows drafted: `review | T5 spec | 9 issues, 1 refused (Undo); PR plan`, and roadmap row note
"design: in-panel notice, undo out of scope pending engineering".

## Checklist
G1-G4 pass. G5 pass (refused "Undo" and "Xero" claims). G6, G7 pass (above). G8 pass (4/4). G9 pass.
G10 pass (text + ✓ + colour). G11 pass (0 animations). G12 pass. G13 pass (`role=status`). G14-G16
pass (existing tokens only). G17 before + after attached. G18 PR plan only. G19 not checked.
**Could not check:** screen-reader announcement wording (no SR in container), 200% zoom, the real
Xero path (not connected; in testing), `vitest` on the change.
