# Fixture t3: error and empty messages on the owned screens (real strings from origin/main @ 0c7d9f1)

| # | Where (file) | When | Text shown today |
|---|---|---|---|
| 1 | components/books/ApprovePosting.tsx | server answered not-OK with no `error` field (e.g. 500) | `Failed (500).` |
| 2 | components/requests/RequestActions.tsx `call()` | same, for a decision (Mark paid, Accept as settled, …) | `Failed (500).` |
| 3 | components/books/ImportInvoices.tsx | fetch threw (server down) | `The server didn't answer.` |
| 4 | api/requests/[id]/action/route.ts → shown by DecisionPanel | body not JSON | `Send JSON.` |
| 5 | app/requests/all/page.tsx | a filter with no rows (e.g. "Needs attention" when there are none) | `Nothing here.` |
| 6 | components/books/ApprovePosting.tsx | success | `Posted 2 line(s) to the demo books.` |
| 7 | components/requests/RequestActions.tsx | Mark paid etc. pressed with an empty note | `Add a note first: it's kept with the decision.` (and focus moves to the note box) |
| 8 | components/books/ApprovePosting.tsx | fetch threw | `The server didn't answer. Nothing was posted.` |

After a successful Approve, the Approve button disappears and keyboard focus falls to `<body>` (measured 2 of 2 runs).
Messages 1-3 render in a `<div className="muted" role="status">` (1, red text) or `<span role="status">` (3).

Task: as frontend-product-engineer, rewrite the ones that need it, say which you keep and why, where
each message should appear and how it is announced, and anything else in this list you'd change.
