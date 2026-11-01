# Error messages, empty states and status messages (patterns for this product)

Rules come from GOV.UK error-message guidance [VERIFIED: https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/error-message/index.md opened 2026-11-01],
WCAG 3.3.1 / 3.3.3 / 4.1.3 (`standards.md` S4) and the product's own best existing lines. NN/g's
guidelines were not opened this run [ASSUMPTION: not opened].

## The five rules
1. **Say what happened, then what to do next**, in one or two short sentences. "Set "Acting as" first:
   every posting records who approved it." is the model: cause + action + why.
2. **Plain English, the controller's words.** No HTTP codes, digests, stack text, `observationKey`,
   `JSON`, "invalid", "forbidden", "please", "sorry", "oops", exclamation marks (GOV.UK list).
3. **Say what did NOT happen when money or books are involved.** "The server didn't answer. Nothing was
   posted." Always state whether anything changed in the books, the invoice status or the customer.
4. **Put it where the eye is, and announce it.** Field errors next to the field (and focus the field, as
   `DecisionPanel` does for an empty note). Action results in a `role="status"` region (success) or
   `role="alert"` (failure inserted after the action). Don't make them disappear on a timer (APG Alert).
5. **Keep the user's input.** Never clear the note, address or amount when showing an error (GOV.UK).

## Existing messages: keep / fix (from `src/`, read 2026-11-01)

| Where | Today | Verdict | Write instead |
|---|---|---|---|
| `RequestActions.tsx` empty note | "Add a note first: it's kept with the decision." + focus to note | Keep (model) | — |
| `RequestActions.tsx` / `ApprovePosting.tsx` network catch | "The server didn't answer. Nothing changed." / "…Nothing was posted." | Keep (model) | — |
| `RequestActions.tsx` `call()`, `ApprovePosting.tsx`, `ImportInvoices.tsx` fallback | "Failed (500)." / "Failed." | **Fix** | "That didn't save, and nothing changed. Reload the page and try again; if it happens again, note the request ID (DEMO-1042) for support." (for posting: "Nothing was posted to the books.") |
| `ImportInvoices.tsx` catch | "The server didn't answer." | Fix (half) | add "No requests were made. Try again in a minute." |
| API `"Send JSON."`, `"Unknown decision."`, `"\"observationKey\" must be text."` | developer text that can reach the UI via `j.error` | Fix at the UI edge | map unknown server errors to the generic plain line above; keep the developer text in the server log |
| One API route returns `(e as Error).message` | raw exception text | Fix | never show raw exception text; log it |
| `/api/accounting/[id]` plan changed | (server refuses and the page shows the new plan) | Keep, and say it: "The amounts changed since you opened this page (a transfer arrived). Check the new lines below, then approve again." |
| Whole-page server error | Next default "Application error: a server-side exception has occurred… Digest: …" | **Fix** with `src/app/error.tsx` (+ segment ones) | "This page couldn't load. Your data hasn't changed. Try again" [button → `reset()`] "or go to At a glance." |
| Unknown request / payment | "Case not found. There is no case with that ID in this workspace. Back to the queue" | Fix (per segment `not-found.tsx`) | "There's no request DEMO-9999 in this workspace. It may have been removed when the demo was reloaded. Go to All requests." |
| Empty filter | "Nothing here." | Fix | "No requests need attention right now." + link "See all requests" (per filter) |
| Loading | skeleton `aria-label="Loading cases"` on every route | Fix | per-route `loading.tsx` naming the thing: "Loading requests", "Loading the books" |

## Empty-state pattern (copy shape)
`<what's empty, in their words>. <why, if not obvious>. <one primary action>` — e.g. At a glance today:
"No payment requests yet" + "Load the demo…" + [Load the demo day] [New request]. Every owned list needs
one; in live mode never offer a demo action that would mix fictional data into real data without
saying so.

## Status and success messages
- Name what changed and where: "Posted 2 lines to the demo books." (not "line(s)"; pluralise properly).
- Name who: "Approving as Mei Tan (Finance ops). Recorded in the audit log." (keep).
- After an action that removes the button, **move focus to the result message** (`tabIndex={-1}` +
  `.focus()`), so keyboard users aren't dropped to `<body>` (baseline F2).

## Words we never use on a product screen (company rule 2 + CLAIMS_REVIEW)
"posts automatically", "paid automatically" (outside demo, labelled), "every payment", "real-time",
"guaranteed", "compliant", "audit-ready", "zero errors". Auto-mark-paid exists **only in demo**.
