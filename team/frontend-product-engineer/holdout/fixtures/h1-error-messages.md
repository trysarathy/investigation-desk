# H1 fixture: five error messages a finance controller can see today

Copied from `main` (read-only snapshot, 31 Oct 2026). Line numbers are from that snapshot. The "who sees
it" and "what the code knows" columns were written by the examiner from reading the code around each line.

| # | File:line | Message today | Who sees it, when | What the code knows at that moment |
|---|---|---|---|---|
| 1 | `src/lib/accounting/engine.ts:55` | `` `Posting failed: ${msg}` `` where `msg` is often `` `Xero ${method} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}` `` (from `src/lib/accounting/providers/xero.ts:69`), e.g. `Posting failed: Xero PUT /Payments failed (400): {"ErrorNumber":10,"Type":"ValidationException","Message":"A validation exception occurred","Elements":[{"ValidationErrors":[{"Message":"Payment amount exceeds the amount outstanding on this document"}]...` | Controller, right after clicking "Approve" on the Xero entry preview (shown under the button by `components/books/ApprovePosting.tsx`) | The engine catches a `PartialPostError`: lines that reached Xero before the failure are recorded as posted ("Part of the plan posted before a failure: n of m line(s)") and a retry never posts them again (idempotency key). So *some* lines may already be in Xero. |
| 2 | `src/lib/accounting/providers/xero-auth.ts:42` | `` `Xero token request failed (${res.status}).` `` (e.g. "Xero token request failed (400).") | Controller, after coming back from Xero's sign-in page while connecting Xero on the Books page, or later when a token refresh fails | The body is deliberately not echoed ("it may contain secrets"). A 400 here usually means the sign-in code expired or was used twice; nothing was posted. |
| 3 | `src/components/books/ApprovePosting.tsx:27` | "The server didn't answer. Nothing was posted." | Controller, when the `fetch` to `/api/accounting/<id>` throws (network drop, timeout, tab offline) after clicking Approve | The browser never got a response. It does not know whether the server received the request. |
| 4 | `src/app/api/requests/[id]/action/route.ts:21` | "A note is required (it may be empty only when acknowledging)." | Controller, on a payment request, after clicking a decision button (e.g. "I've asked for the balance", refund, accept) with the note box empty | The only action that allows an empty note is "acknowledge", whose button label is "Mark paid". |
| 5 | `src/lib/chain/tron.ts:25` | "TronGrid returned non-JSON" | Controller, on a payment's match explanation, when the Tron lookup gets an HTML/garbled reply (TronGrid outage or rate-limit page) | `retryable: false` is set for this case. Elsewhere (`src/lib/view.ts:103`) a paused check shows "Wait for the chain API to recover. The check re-runs automatically." |

## The work order (from tech-lead-architect's plan, `team/plan/tasks-2026-11-02.md`, item FPE-3)
> Rewrite these five so a finance controller knows what happened and what to do next. Give the new
> string, where it goes, and what else (if anything) has to change in code for the message to be true.
> Say which of these you can ship in tonight's PR and which can't.
