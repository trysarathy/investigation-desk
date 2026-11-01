# Holdout run 2026-11-01: frontend-product-engineer

## H1. Rewrite five real error messages (FPE-3)

**Pre-flight (playbook §0).** In a real run I would read Settings `PAUSE` and run the PAUSE Gmail search first. Live tools are off for this written test, so I couldn't check PAUSE. Nothing was sent, pushed or edited.

**Sources.** I read the code this run in the read-only checkout of `main` @ `0c7d9f1` (2026-11-01). Each fact marked `[VERIFIED: code read]` below was opened this run at the file and line given. The rules come from `team/knowledge/frontend-product-engineer/error-messages.md`: say what happened and what to do next, say what did not change in the books, no codes, no "please" and no "sorry". They rest on GOV.UK error-message guidance `[VERIFIED: frontend-product-engineer 2026-11-01, https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/components/error-message/index.md]` and WCAG 3.3.1, 3.3.3 and 4.1.3 `[VERIFIED: frontend-product-engineer 2026-11-01, w3c/wcag source]`.

**The merge gate today.** As of 1 Nov the `main` ruleset has no required status check. So nothing auto-merges at 06:17 until Aashmiin adds "Require status checks: ci" (`company/OPERATING_MODEL.md` §2). Below, "gate-eligible" means it may go through the gate once that check exists and CI, `CODE REVIEW: APPROVE <sha>` and `QA: PASS <sha>` all hold. It does not mean "merged tonight".

### Summary
| # | Where | Tonight? |
|---|---|---|
| 1 | Posting failed (Xero, partial post) | **Approval-only.** Touches posting and the engine. |
| 2 | Xero token request failed | **Approval-only.** Auth, the Xero OAuth path. |
| 3 | Network drop after Approve | **Approval-only.** The posting component makes a statement about the books. Small fix, so it goes into the Approval Queue first. |
| 4 | Note required | **Gate-eligible.** Decision copy only. Not posting, money, auth or pricing. |
| 5 | TronGrid returned non-JSON | **Gate-eligible.** Read-only chain lookup copy. The retry logic belongs to crypto-protocol-engineer. |

So **tonight's PR = messages 4 and 5 (copy part)**. That is one PR, `ui/plain-errors-20261102`, and well under 300 lines. Messages 1–3 are prepared as a separate PR, labelled `APPROVAL-ONLY: needs Aashmiin's merge`, with an Approval Queue row.

---

### 1. `Posting failed: Xero PUT /Payments failed (400): {...}`

**What is true at that moment** `[VERIFIED: code read engine.ts:46-55, types.ts:185, rules.ts:219-221]`:
- The engine catches the error.
- If `PartialPostError.posted` is non-empty, it writes those lines to the audit log as posted.
- The next plan drops lines already posted (`postedFor`/`todo`), and Xero calls carry the idempotency key (`xero.ts:66`). So a retry does not post a posted line again.
- The UI only gets the string `Posting failed: <msg>`. It does not get the count.

**(a) New copy (under the Approve button, `role="alert"`).** There are two variants. The number of lines and their names come from the server; amounts come only from `formatUsdc` in lib, never from the component.
- Some lines reached Xero:
  > "Xero accepted 1 of 2 lines, then refused the rest. In Xero now: Payment. Not posted: Fee write-off. Xero's reason: the payment is more than the amount still owed on this invoice. Check the invoice in Xero (it may already be part-paid), then reload this page: only the lines that didn't post will be shown to approve. Nothing will be posted twice."
- No lines reached Xero:
  > "Xero refused this posting, so nothing was posted. Xero's reason: the payment is more than the amount still owed on this invoice. Check the invoice in Xero, then reload this page and approve again."
- If Xero's reason can't be read:
  > "Xero refused this posting. Nothing was posted. Reload this page to see the current lines; if it fails again, note request DEMO-1042 and the time for support."

**(b) Operator / log detail (never on screen):**
- HTTP method, path and status (`PUT /Payments`, 400).
- Xero `ErrorNumber`, `Type` and the raw `Elements[].ValidationErrors[]` JSON.
- The 300-character body, the idempotency key, and the posted and failed line kinds.

Today these already go to the audit `failed` entry (`reason: msg`). They stay there and in the server log. Xero's body can contain contact or invoice data, so it must not be copied into Log rows, PRs or screenshots (company rule 4 and the customer-data rule).

**(c) Code changes needed for the copy to be true:**
1. `engine.ts`: return a structured error to the route instead of a string. For example `{ code: "provider_refused", postedCount, total, postedKinds, notPostedKinds, providerReason }`.
2. `xero.ts:69`: throw a typed `ProviderError` that keeps the parsed `ValidationErrors[].Message` (an allow-listed, plain field) apart from the raw body.
3. Add a lib mapper `postingErrorCopy()` in `src/lib/accounting/` that builds the sentence, with a vitest test written first. It must cover the partial, none and unreadable cases and plurals ("1 line" / "2 lines").
4. `ApprovePosting.tsx:24`: render the message in `role="alert"`, never fall back to `Failed (${status}).`, call `refreshAfterChange(router)` (already called), and move focus to the message (F2).

These changes belong to accounting-integrations-engineer (engine and adapter) and to me (component and copy). One more point: Xero is "built, in testing" and live posting to a customer's Xero is switched on only after the sandbox tests pass (PRODUCT_FACTS). Today this message is mainly reached in the sandbox and the Demo Company.

**(d)** **Approval-only.** It changes the posting engine's error path and the posting UI ("Xero/QuickBooks posting rules and posting", OPERATING_MODEL §2). It needs an Approval Queue row and Aashmiin's merge.

---

### 2. `Xero token request failed (400).`

**What is true** `[VERIFIED: code read xero-auth.ts:37-43; api/accounting/xero/callback/route.ts:13-19]`:
- The body is deliberately not echoed.
- The callback returns this text as **raw JSON** with status 502 (`{ "error": "Xero token request failed (400)." }`). So after Xero's sign-in page, the controller lands on a bare JSON page with no way back.
- The same function also runs on token refresh, later, during an Approve.

**(a) New copy:**
- While connecting (shown on `/books` after a redirect, `role="alert"`):
  > "Xero didn't finish connecting, so Clearline isn't linked to your Xero organisation yet. The sign-in link from Xero may have expired or been used already. Nothing was posted. Choose Connect Xero to sign in again."
- On refresh, later (under Approve, or as a Books banner):
  > "Clearline's sign-in to Xero has expired. Nothing was posted. Reconnect Xero on the Books page, then come back and approve."

"May have" stays hedged. A 400 "usually" means an expired or reused code, but the code doesn't know which `[ASSUMPTION: examiner note, not confirmed against Xero's OAuth docs this run]`.

**(b) Operator detail:**
- Stage (code exchange or refresh), HTTP status, timestamp and tenant id if known.
- **Never the body or any token.** The existing comment says why.
- These go to the server log and an audit entry `kind: "connect_failed"`.

**(c) Code changes:**
1. The callback route catches the error and `NextResponse.redirect("/books?xero=connect_failed")` instead of returning JSON. `/books` reads the param and shows the copy above. The same goes for the state-mismatch branch, line 13.
2. `tokenRequest` throws a typed `XeroAuthError { stage, status }`, so the UI can choose "connecting" or "expired" without string-matching.
3. The refresh path maps to the "expired" copy.
4. A vitest test on the mapper is written first.

**(d)** **Approval-only.** It touches auth and the OAuth callback (OPERATING_MODEL §2 "auth"). It also changes what the Books page says about the Xero connection, next to posting.

---

### 3. "The server didn't answer. Nothing was posted."

**What is true** `[VERIFIED: code read ApprovePosting.tsx:26-28]`: the `catch` runs when `fetch` throws. The browser doesn't know whether the server got the request. **"Nothing was posted" may be false.** The server could have posted and the reply could have been lost. That breaks rule 3 of `error-messages.md`: say what did not change only when you know it. The pack's table listed this line as "keep (model)". That entry is wrong for this case, and I would correct it in `error-messages.md`.

**(a) New copy (`role="alert"`, focus moved to it):**
> "We lost the connection before the books answered, so we can't tell yet whether this was posted. Reload the page to see the status in "In your books" before you approve again. Approving again can't post the same lines twice."

**(b) Operator detail:** the `fetch` error name (`TypeError`/`AbortError`), the request id and the plan key go to the console only. No UI.

**(c) Code changes:**
- After the catch, call `refreshAfterChange(router)` (today it is called only on a response). The panel then shows "Posted" or "Ready to post" from the server.
- Optionally, poll once.
- The "can't post twice" sentence is true because a posted plan is refused with "Already in the books" (`engine.ts:34-35`), lines already posted drop out of the next plan (`rules.ts:219-221`), and Xero gets the idempotency key `[VERIFIED: code read]`. A vitest test must prove a second approval after a successful post returns the refusal. It is written first, in `tests/accounting.test.ts`.

**(d)** **Approval-only.** The diff is copy plus one refresh call, but it sits in the posting component and is a statement about what is in the books. The rule is "when unsure whether it's approval-only, it is". It goes to the Approval Queue as a small PR. It is not merged by the gate.

---

### 4. "A note is required (it may be empty only when acknowledging)."

**What is true** `[VERIFIED: code read action/route.ts:21; lifecycle.ts:442; RequestActions.tsx:58]`:
- The route returns this only when `note` **isn't a string**, which means a malformed request.
- An **empty** note is caught first by `DecisionPanel` ("Add a note first: it's kept with the decision." plus focus on the note).
- If it gets past that, `lifecycle.ts:442` returns a third wording: "Say why: a note is required for this decision."
- "Acknowledging" is internal vocabulary. The button the user sees is "Mark paid".
- So there are three strings for one rule.

**(a) New copy (one string, next to the note field, note focused, the user's text kept):**
> "Add a note before you record this decision: it's kept with the decision in the audit log. Only "Mark paid" can be recorded without a note."

**(b) Operator detail:** for the malformed-request case (note not a string), the route logs `decide: note missing or not text` server-side. The UI never shows "acknowledging" or field names.

**(c) Code changes:**
- Add one constant `NOTE_REQUIRED` in `src/lib/requests/` and use it from the route, from `lifecycle.ts:442` and from `DecisionPanel`.
- Write a vitest test first in `tests/requests.test.ts`: `decide(..., { kind: "request_balance", note: "  " })` returns `NOTE_REQUIRED`, and `acknowledge` with an empty note succeeds.
- `DecisionPanel` already focuses the textarea. The message gets `role="alert"`.
- Check that the e2e `demo_cases.py` still passes. It reads `next-step` and `decide-*`, and those don't change.

**(d)** **Gate-eligible tonight.** It is copy and validation wording for decisions. It is not posting, money amounts, auth or pricing. It still needs CI, code-reviewer, `QA: PASS`, and the required status check being on.

---

### 5. "TronGrid returned non-JSON"

**What is true** `[VERIFIED: code read tron.ts:20-27; http.ts:118-134; investigate.ts:87-101; evidence.ts:51,61; view.ts:103]`:
- The classifier marks the reply `retryable: false`, so the HTTP client throws without retrying.
- `lookupOne` turns it into an `error` lookup and never "not found".
- The engine **pauses**. The controller sees "Check paused on Tron", and the evidence detail reads `Tron: error (TronGrid: TronGrid returned non-JSON)`.
- The paused next step says "The check re-runs automatically". I could not confirm what re-runs a paused request check, or when `[ASSUMPTION: not traced this run]`.

**(a) New copy (evidence detail and next step):**
> "Tron's data service (TronGrid) sent back a page we couldn't read, often a sign it's down or limiting requests. This payment hasn't been checked on Tron yet, so no verdict is given and nothing on this invoice has changed. Check again in a few minutes."

Add a **Check again** button if a re-check action exists for that screen. Keep "The check re-runs automatically" only once the re-run is verified (see c).

**(b) Operator detail:** source `trongrid`, HTTP status, the response `sha256` and `fetchedAt` (already saved in the raw response by `http.ts:124-131`), and the first bytes of the body type (`text/html`). This goes to the raw-response store and the log, not to the screen.

**(c) Code changes:**
1. In lib (`src/lib/engine/evidence.ts`, or a `chainErrorCopy()` helper), map raw lookup error strings to plain copy. A vitest test comes first: the `TronGrid returned non-JSON`, `Etherscan returned non-JSON` and `RPC returned non-JSON` inputs give the plain line, and the output contains no "JSON" or HTTP codes.
2. crypto-protocol-engineer decides whether an HTML or garbled reply should be `retryable: true`. Outage and rate-limit pages are usually temporary `[ASSUMPTION]`, so I would ask for a roadmap row to them. Until then, the copy must not promise an automatic re-run that doesn't happen.

**(d)** **Gate-eligible tonight** for the copy mapping. It is read-only chain lookup display: no keys, posting, money or auth. The retry change is crypto-protocol-engineer's own PR and not mine to make.

### Log rows I would write
- `2026-11-02 01:xx SGT | frontend-product-engineer | FPE-3 PR opened (msgs 4, 5) | ui/plain-errors-20261102 | gate-eligible once ci is a required check`
- `... | FPE-3 msgs 1-3 prepared as approval-only PR | Approval Queue row | posting + auth; 3-line summary + risk "a wrong message about what's in the books leads a controller to double-enter or skip a line"`
- `... | needs decision | crypto-protocol-engineer | should non-JSON TronGrid replies be retryable?`
