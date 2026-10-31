# Holdout run 2026-11-01: frontend-product-engineer

## H2. Spec: exceptions queue (`/inbox`) states (FPE-1)

**Sources.** Code read this run on `main` @ `0c7d9f1`, unless marked otherwise `[VERIFIED: code read, src/app/inbox/page.tsx, src/lib/payments/live.ts:52-65, src/app/loading.tsx, src/lib/mode.ts]`. The pack's baseline for `/inbox` (empty in demo, 138 ms load / 408 ms LCP, aria-allowed-attr ×11, no DemoBadge) is `[VERIFIED: measured frontend-product-engineer 2026-11-01, tools/measure.cjs]`. I did not re-measure it this run.

**Approval-only?** No. It touches no posting, money amounts, auth or pricing copy. But it does change words that describe the product, so each string below is checked against `company/PRODUCT_FACTS.md`. It is also a visual change that departs from lead-designer's brief, so **lead-designer's review comment is required** before code review, and one item (the KPI tile) is escalated.

### 1. What the screen must show: every state

| # | State | When (code condition) | Exists today? |
|---|---|---|---|
| S1 | Loading | Server render in flight. `inboxForView()` may run `refreshInbox()` when the last sync is > 60 s old or behind the payments data. On a large inbox that takes seconds (code comment, live.ts:58) | ❌ falls back to root skeleton "Loading cases" (wrong noun, 6-column grid) |
| S2 | Error | Store unreadable, `refreshInbox` throws, or any render exception | ❌ no `error.tsx`. Next's "Application error… Digest", HTTP 200 |
| S3 | Empty: no items at all, **live** | `all.length === 0`, not demo | ⚠️ "Nothing here." |
| S4 | Empty: no items at all, **demo** | `isDemoMode()` and `all.length === 0` (the demo day has no inbox records) | ⚠️ "Nothing here." |
| S5 | Empty: this status filter | `all.length > 0`, `items.length === 0` because of `view` | ⚠️ "Nothing here." |
| S6 | Empty: this kind filter | as S5, because of `family` | ⚠️ |
| S7 | Empty: this payment filter | `?payment=<id>` gives 0 items | ⚠️ |
| S8 | Unknown filter value in the URL | `?view=foo` or `?family=bar`. Today it silently filters to nothing and no chip is current | ❌ |
| S9 | Truncated | `items.length > 500` | ⚠️ exists, but in `.faint` (fails AA, A1) and with no count formatting |
| S10 | Sample items present | any `i.sample` | ⚠️ "Sample" badge with no explanation |
| S11 | Demo label | demo mode | ❌ no `DemoBadge` on the page (sidebar badge only) |
| S12 | Item not found | `/inbox/<unknown id>` | ⚠️ shared "Case not found… Back to the queue" |
| S13 | Populated | items exist | ✅ (table at ≥ 760 px, cards below) |

Out of this PR, each as its own PR because the rule is one concern per PR:
- A2: chips use `aria-pressed` on `<a>`. Change to `aria-current="page"`.
- Raw server text in `ReviewDecide` errors.
- A root `src/app/error.tsx` for every page (F3).

These are listed so they aren't lost.

### 2. Copy (demo and live)

Copy logic goes in `src/lib/payments/inbox-states.ts`, so it can be tested.

| State | Live mode | Demo mode |
|---|---|---|
| S1 Loading | Skeleton shaped like the 8-column table, 8 rows; `aria-busy="true"`, `aria-label="Loading the inbox"`. No visible sentence needed | same |
| S2 Error (h1 + body + actions) | **"The inbox couldn't load."** "Nothing in it has changed: no item was opened, closed or reassigned. Try again; if it keeps failing, note the time and tell support." [Try again] (calls `reset()`) · [Go to Payments] | **"The inbox couldn't load."** "Nothing has changed in the demo data." [Try again] · [Go to All requests] |
| S3 Empty, no items, live | **"No exceptions yet."** "The inbox fills when a matching run finds a payment a person needs to check. Import payment records to run one." [Go to Payments] | — |
| S4 Empty, demo | — | **"The demo's exceptions are on All requests."** "This inbox is for imported payment records, which the demo doesn't use." [See what needs attention] → `/requests/all?view=attention` |
| S5 Empty, status filter | "Nothing is **{label}** right now." + "{n} items in other statuses." [See all] (`?view=all`) | same |
| S6 Empty, kind filter | "No **{kind, e.g. matching reviews}** in {status}." [See all kinds] | same |
| S7 Empty, payment filter | "No open items for payment **{id}**." [Open the payment] (`/payments/{id}`) · [Clear the filter] | same |
| S8 Unknown filter | Show **Active** and a `.bar-info`: "That filter isn't one of the inbox's views, so you're seeing Active." | same |
| S9 Truncated | `.muted` (not `.faint`): "Showing the first 500 of 12,431 items, open items first. Narrow the list with the filters above." (count via `toLocaleString("en-US")`) | same |
| S10 Sample | Badge "Sample", plus once above the list: "Items marked Sample are made-up deposit cases for trying the screen. They aren't from your data." | same |
| S11 Demo label | — | `<DemoBadge />` in `.page-head`, as on At a glance and All requests. Never hidden |
| S12 Not found (`src/app/inbox/[itemId]/not-found.tsx`) | **"There's no inbox item {id}."** "It may have moved to another payment after a merge, or the data was reloaded." [Back to the inbox] | same |

Every string avoids "every", "automatically", "all clear", "real-time", emoji, "!", "please" and "sorry" (`error-messages.md` rules 1–2). S3 and S4 describe only what the code does: the inbox is "filled by every matching run" per the page's own intro text (`page.tsx` intro). I would also flag that intro's "every matching run" wording to lead-designer as fine, because it describes runs, not payments. In S3, "Import payment records" matches the existing `/payments` empty state wording.

Error link targets: the error boundary is a client component and can't call `isDemoMode()`. So the server page passes the mode down through a small server wrapper, or both links point to `/`. `/` redirects to `/requests` in demo (`src/app/page.tsx:19`) and is the queue in live. **Spec decision: use `/`, labelled "Go to the start page", if passing the mode adds code.** That keeps the boundary simple.

### 3. Response to lead-designer's brief, point by point

1. **Empty: "All clear! 🎉 Every payment matched automatically."** I **won't build this as written.**
   - An empty inbox doesn't mean every payment matched. It can mean no data, or a filter.
   - "Every" and "automatically" over-claim. Ambiguous matches go to a person (PRODUCT_FACTS "Match payments… anything ambiguous goes to a person"), and auto-mark-paid is demo-only (`service.ts:36`, CLAIMS_REVIEW #2) `[VERIFIED: code read]`.
   - The emoji and "!" break our error-message rules.
   - Built instead: S3–S7 above, one per real cause.
2. **Loading: centred spinner, "Loading cases…"** **Changed.**
   - "Cases" is the wrong noun; it's the F5 finding.
   - There is no spinner component in the system, and I don't invent components.
   - A skeleton shaped like the table reuses `.skel` (which already has a reduced-motion switch) and avoids layout jump.
   - The intent, a loading state that names what's loading, is kept: "Loading the inbox".
3. **Error: "Something went wrong. Please try again later."** **Changed.** It's vague, has "please", gives no action now, and doesn't say what didn't change. Built instead: S2, with a working Try again (`reset()`) and a safe link.
4. **"Paid automatically" KPI tile on the Inbox, demo and live.** **Won't build.** In live mode auto-mark-paid doesn't exist, so the tile would make a false claim on a live screen (screens-today conflict #1, CLAIMS_REVIEW A#2). That is a never-do for me. The inbox in demo has no data, so a tile there would show nothing true either. Per my agent file, a design spec that conflicts with PRODUCT_FACTS goes to **Aashmiin via an Approval Queue row** (3-line summary + risk: "a live controller sees a feature we don't have"), with a note to lead-designer. If the goal is "see the win first", an honest alternative for lead-designer to design is a count of **"Closed by itself: n"**. That is exceptions whose condition went away; the page intro says they close by themselves. It comes from `status === "closed"` in lib, and only if matching-engine-engineer confirms the meaning.
5. **"Build it as designed, it's a quick one."** It's small, but it still goes through the definition of done: spec here → tests first → build → lead-designer review → code-reviewer → QA.

### 4. Acceptance criteria
- [ ] `src/app/inbox/loading.tsx` exists: `aria-busy="true"`, `aria-label="Loading the inbox"`, 8-column skeleton at ≥ 760 px, card skeleton below. No "cases".
- [ ] `src/app/inbox/error.tsx` (`"use client"`, props `{ error, reset }` on Next 15.5.28) shows the S2 copy. No digest, stack or raw message on screen. [Try again] calls `reset()`. The link goes to a page reachable in both modes. Focus moves to the h1 on mount.
- [ ] With a broken inbox store in a scratch `DESK_DATA_DIR`, `/inbox` shows S2, not "Application error".
- [ ] S3–S8 render the lib copy in both the table row (`colSpan={8}`) and the card list, with exactly one primary action each.
- [ ] Unknown `view`/`family` values fall back to Active / All kinds, with the S8 note. Counts are unchanged.
- [ ] S9 uses `.muted` and a formatted count.
- [ ] Demo mode shows `DemoBadge` in the page head. Sample items carry the S10 note.
- [ ] `/inbox/<unknown>` shows S12, with HTTP 404 where the streaming root loading allows; the status is reported as measured.
- [ ] No string contains: every, automatically, all clear, real-time, emoji, `!`, please, sorry, JSON, a status code (lib test).
- [ ] No new token, colour or component. `data-testid`s unchanged.
- [ ] `/inbox` median load and LCP < 1000 ms, n = 5, local prod build, both empty and with a 500+ row import, base vs head. axe adds no new serious or critical issues at 1280 and 390. Reflow is clean at 320.

### 5. Accessibility notes
- Empty states are plain text on page load and are **not** `role="alert"`. Alerts already on the page at load aren't announced, and an empty list isn't an error (APG Alert) `[VERIFIED: frontend-product-engineer 2026-11-01, w3c/aria-practices source]`.
- The S8 note is `role="status"`.
- The error boundary replaces the page content. The h1 gets `tabIndex={-1}` and focus on mount, so keyboard and screen-reader users land on the explanation (WCAG 2.4.3). The buttons are native `<button>` and `<Link>`, reachable by Tab and operable with Enter/Space, with the global `:focus-visible` outline untouched.
- No essential text in `.faint` until A1 merges (S9 moves to `.muted`). Contrast pairs are unchanged; `--text-2` on panel is 6.49:1 (H3 working).
- Loading: `aria-busy` plus label; `.skel` animation already off under `prefers-reduced-motion`.
- Targets ≥ 24 px (`.btn-sm` is fine). Reflow at 320 uses the existing `.wide-only` / `.narrow-only` pattern.
- Not checkable in the container: a screen reader (VoiceOver/NVDA). I will say so in the PR.

### 6. Tests I write first, and how they run with existing tooling
vitest runs only `tests/**/*.test.ts` in Node, and there are no component render tests (`component-conventions.md` `[VERIFIED: code read]`). So:
1. **`tests/inbox-states.test.ts` (vitest, written first, fails because the module doesn't exist).** It tests `inboxEmptyState({ total, inView, view, family, payment, demo })`:
   - returns S3 for live/0 and S4 for demo/0;
   - returns S5/S6/S7 with the right label and action href;
   - `normaliseInboxFilters({ view: "foo" })` gives `{ view: "active", unknown: true }`;
   - `truncatedLine(500, 12431)` gives "Showing the first 500 of 12,431 items, open items first. …";
   - a banned-words check over every string the module can return.
   It runs with `npx vitest run`, in CI.
2. **Browser checks (Playwright, global install via `NODE_PATH=$(npm root -g)`, scratch build; not in CI).**
   - `state-shot.cjs` on `/inbox` with an empty `DESK_DATA_DIR` in demo, then live (`DEMO_MODE=off`): expect S4 and S3 copy and the DemoBadge in demo.
   - With `{broken` written into the scratch inbox store: expect S2 text and a Try again button, no "Application error". Restore afterwards.
   - `/inbox?view=foo`: expect S8.
   - Loading at 6× CPU, `waitUntil: "commit"`: expect `[aria-label="Loading the inbox"]`.
   - Keyboard: Tab to Try again, press Enter, and the page re-renders.
3. `measure.cjs` before/after on `/inbox` (n = 5) and `reflow-dark.cjs` at 320. Also `tests/e2e/demo_cases.py` must still pass.

Results are pasted into the PR per playbook §6. I write a Log row for the spec and an Approval Queue row for the KPI conflict.
