# Task 3: the error and status messages (fixture t3, strings from origin/main @ 0c7d9f1)

Standard used: `team/knowledge/frontend-product-engineer/error-messages.md` (five rules: what happened +
what to do; plain English, no codes/"please"/"sorry"/"invalid"; say what did NOT change when money or
books are involved; put it where the eye is and announce it; keep the user's input). Sources behind it:
GOV.UK error-message guidance `[VERIFIED: frontend-product-engineer 2026-11-01, https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/error-message/index.md]`;
WCAG 2.2 SC 3.3.1, 3.3.3, 4.1.3 and 2.4.3 `[VERIFIED: frontend-product-engineer 2026-11-01, w3c/wcag source files listed in standards.md S3/S4]`;
APG Alert pattern ("alerts… do not affect keyboard focus"; don't auto-dismiss) `[VERIFIED: frontend-product-engineer 2026-11-01, w3c/aria-practices source]`.
Not re-opened this run (network off). Code facts below: `[VERIFIED: code read main-ro @ 0c7d9f1, 2026-11-01]`.

## Verdict per message

| # | Where / when | Today | Verdict | Final string | Where it appears and how it's announced |
|---|---|---|---|---|---|
| 1 | `ApprovePosting.tsx`, server not-OK with no `error` (e.g. 500) | `Failed (500).` | **Rewrite**: a code, no next step, doesn't say whether anything posted | **"That didn't go through, and nothing was posted to the books. Reload the page and try again. If it happens again, note the request ID DEMO-1042 for support."** (id from the `requestId` prop) | Directly under the Approve button, in `.bar .bar-red` with `role="alert"` (inserted after a failed action). Today it is `role="status"` + red text only — wrong role and colour-only meaning (SC 1.4.1). Stays until the next attempt; no timer. |
| 2 | `RequestActions.tsx` `call()` (Mark paid, Accept as settled, …) not-OK, no `error`; also the `"Failed."` fallback at line 40 and the suggested-match Confirm/Reject `Failed (${status}).` at line 104 | `Failed (500).` / `Failed.` | **Rewrite** (same reasons; decision = invoice status, so say it didn't change) | **"That didn't save, and nothing changed: the request and the books are as they were. Your note is still here. Reload the page and try again. If it happens again, note the request ID DEMO-1047 for support."** | Under the decision buttons in the existing `.bar .bar-red role="alert"` (line 83) — role already right. The note is kept (code clears it only on success, line 62: keep that). |
| 3 | `ImportInvoices.tsx`, fetch threw | `The server didn't answer.` | **Fix (half)**: says what happened, not what changed or what to do | **"The server didn't answer. No payment requests were made. Try again in a minute."** | Under the Import button. Today `<span className="muted" role="status">` for success and failure alike → failures get `role="alert"` in a `.bar .bar-red`; success keeps `role="status"`. Its `Failed (${status}).` fallback → **"That didn't go through, and no payment requests were made. Try again in a minute."** |
| 4 | API → shown by DecisionPanel via `j.error` | `Send JSON.` | **Fix at the UI edge**, not at the API: it's developer text for API callers; the UI must never show it | Shown as message 2's generic line. Server keeps `Send JSON.` for API clients and logs. | Same as 2. Note: in the code `Send JSON.` is returned by `src/app/api/requests/route.ts:8` (create); the action route returns the same family: `Unknown action.`, `Unknown decision.`, `"<field>" must be text.`, `"observationKey" must be text.` Our UI always sends JSON, so if one of these reaches a user it's a bug: log it, show the plain line. |
| 5 | `requests/all/page.tsx:57`, filter with no rows | `Nothing here.` | **Rewrite**: no "what", no next step | Per filter (`<what's empty>. <one action>`): **All**: "No payment requests yet." + link **"New request"** · **Needs attention**: "No requests need attention right now." + link **"See all requests"** · **Arriving**: "No payments are arriving right now." + "See all requests" · **Awaiting payment**: "No requests are waiting to be paid." + "See all requests" · **Paid**: "No requests are paid yet." + "See all requests" | In the table's single empty row (`<td colSpan={7}>`), `.muted`. Static content at page load → **no live region** (not an action result). Same fix for `/inbox` `Nothing here.` (page.tsx:98 and :113, wide and narrow): "No exceptions to review right now. Payments that need a person show up here." |
| 6 | `ApprovePosting.tsx`, success | `Posted 2 line(s) to the demo books.` | **Rewrite**: "line(s)"; and focus is lost after it | **"Posted 2 lines to the demo books. Recorded in the audit log."** (1 → "Posted 1 line…"; live provider → its label, "Posted 2 lines to Xero.") | Replaces the button area; `.bar .bar-info` with `role="status"`, and **focus moves to it** (`tabIndex={-1}` + `ref.focus()`) because the button unmounts (see "Also" 1). **The string is built in lib, not the component**: `src/lib/accounting/service.ts:73` `` `Posted ${n} line(s) to ${adapter.provider === "demo" ? "the demo books" : adapter.provider}.` `` — which also prints the raw provider id (`xero`) in live mode. Fix there with a vitest test; it's the posting service file → accounting-integrations-engineer's file, approval-only (see PRs below). The audit-log reason `approved 2 line(s)` (`engine.ts:43`) gets the same pluralisation in that PR. |
| 7 | `RequestActions.tsx`, empty note | `Add a note first: it's kept with the decision.` + focus to note | **Keep** — the model: says what to do and why, puts focus on the field (SC 3.3.1/3.3.3), keeps input | unchanged | `.bar .bar-red role="alert"` under the buttons + focus to the textarea. Only change: give the textarea `aria-describedby` pointing at the message while it shows, so the reason is read when focus lands. Same rule for the suggested-match "Add a note first: say why you're sure." (line 100), which today **doesn't** move focus to the note: add `noteRef.current?.focus()`. |
| 8 | `ApprovePosting.tsx`, fetch threw | `The server didn't answer. Nothing was posted.` | **Keep the words** — says what happened and what did not happen to the books | unchanged; optional tail " Try again in a minute." | Change only the presentation: `.bar .bar-red role="alert"` instead of `role="status"` + red text (colour alone). |

## Also in this list that breaks the standard (and the fix)
1. **Focus falls to `<body>` after a successful Approve** (measured 2 of 2 runs, baseline F2; WCAG 2.4.3
   Focus Order risk). The button unmounts when the badge goes to "Posted". Fix: the result message
   container gets `tabIndex={-1}` and a ref; after `setMsg` on success, `requestAnimationFrame(() =>
   ref.current?.focus())`. Same for DecisionPanel after a decision that removes its buttons. Proven with
   `K/tools/keyboard-flow.cjs` (expect `document.activeElement` = the message, not `BODY`).
2. **Colour as the only failure signal** in ApprovePosting (`color: var(--red)` on a `.muted` div,
   `role="status"`): use the `.bar-red` / `.bar-info` classes, which the rest of the app uses.
3. **Server `error` text passed straight to the screen** (`j.error ?? …` in ApprovePosting,
   RequestActions, ImportInvoices). Some server lines are good plain English (`Set "Acting as" first:
   every posting records who approved it.`, the plan-changed refusal), some are developer text. Fix: one
   lib function `src/lib/ui/actionError.ts` → `actionError({ status, serverError, action: "post"|"decide"|"import", requestId })`
   that passes through an allow-list of known plain lines and maps everything else (and any 5xx) to the
   generic lines above. Unit-tested (vitest, failing first): 500 + no error → generic; `"Send JSON."` →
   generic; `Set "Acting as" first…` → passed through; output never matches `/\(\d{3}\)|failed|json|observationKey/i`.
4. **Plan changed since the page loaded** (409 from `/api/accounting/[id]`): say it — "The amounts changed
   since you opened this page (a transfer arrived). Check the new lines below, then approve again." —
   from `error-messages.md`. Wording only; the lines shown still come from `planPosting` untouched.
5. **ImportInvoices success** "Made 3 payment request(s)." → pluralise properly ("Made 3 payment requests.").
6. **No messages on a timer**: none today; keep it that way (APG Alert).

## How I'd ship it (one concern per PR; nothing run here)
- **PR A — `ui/action-messages-20261102`** (not approval-only): `actionError` lib + test; RequestActions
  (decision + suggested match), ImportInvoices, empty-filter copy on `/requests/all` and `/inbox` (copy in
  `src/lib/requests/ui.ts` `emptyFilterCopy(key)` with a vitest test), note focus for suggested match.
- **PR B — `ui/approve-posting-messages-20261102`**: ApprovePosting failure/success presentation, focus
  to result (F2), and the `service.ts:73` / `engine.ts:43` pluralisation. **Approval-only: yes** — it is
  the Approve-and-post control and the posting service file; the change is words and focus only, but
  "when unsure, it is". Written with/handed to accounting-integrations-engineer for the lib part; goes to
  the Approval Queue with a 3-line summary for Aashmiin's merge.
- Both: lead-designer review comment (bar styles), `CODE REVIEW: APPROVE <head>`, `QA: PASS <head>`,
  keyboard-flow.cjs before/after, axe at 1280/390 (no new serious/critical), e2e `demo_cases.py` (it
  checks the decision and approve flows; `data-testid`s unchanged), tsc/vitest/build/lint. Demo and
  live-mode checks: success text says "the demo books" only in demo and "Xero" in live.
- Not checkable in the container: screen-reader announcement (no VoiceOver/NVDA) — state it in the PRs.
