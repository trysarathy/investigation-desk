# QA report: Clearline demo, overnight pass

**Date:** 29 Oct 2026 (runs between 01:20 and 02:10 SGT)
**Branch:** `qa-polish`, from `accounting-fixes` at `f49e81f`
**Server:** `DEMO_MODE=on DESK_DATA_DIR=<fresh temp folder> npx next start -p 3400`, production build, headless Chromium (Playwright), local machine

Every result below is one I saw in a run. Nothing is marked pass on inference.

## Results

| Check | Before fixes | After fixes |
| --- | --- | --- |
| Typecheck (`tsc --noEmit`) | Pass | Pass |
| Unit tests, run 1 (`vitest run`) | Pass: 562 passed, 57 skipped | Pass: 573 passed, 57 skipped |
| Unit tests, run 2 | Pass: 562 passed, 57 skipped | Pass: 573 passed, 57 skipped |
| Unit tests, run 3 | Pass: 562 passed, 57 skipped | Pass: 573 passed, 57 skipped |
| Production build (`next build`) | Pass | Pass |
| End-to-end script, run 1 (`npm run qa`) | Fail: 100 of 111 on the first full run (11 failures: 5 from real layout bugs, 2 from the not-found check, which led to the wording fix, and 4 from mistakes in the new script itself) | Pass: 113 of 113 |
| End-to-end script, run 2 | | Pass: 113 of 113 |
| End-to-end script, run 3 | | Pass: 113 of 113 |

The 57 skipped unit tests are `tests/real-record.test.ts`. It records real chain responses over the network and only runs with `RECORD_REAL=1`. It was skipped before this pass too.

### Pages (each at 1280×800 and 390×844)

Pages checked: `/` (it redirects to `/requests` in demo mode), `/requests`, `/requests/all`, `/requests/new`, all 19 `/requests/DEMO-*` pages, all 19 `/pay/<publicId>` pages, the unidentified-payment page `/requests/payments/<key>`, `/books`, `/payments`, `/inbox`, `/settings` and `/bulk`. That is 48 pages and 96 page loads per run.

For each page load the script records the HTTP status, console errors and warnings, uncaught exceptions, failed network requests, load time, horizontal overflow at 390 px and an empty page.

| Check | Result after fixes |
| --- | --- |
| HTTP status | 200 on every page |
| Console errors and warnings | None |
| Uncaught exceptions | None |
| Failed network requests | None (Next.js cancels link prefetches when a page closes; those aborts are ignored) |
| Horizontal overflow at 390 px | None |
| Empty pages | None |
| Unknown request or sender link | A clear not-found page. The HTTP status is still 200: see known issues |

### Load times

Measured from navigation to the `load` event, on a warm local server (the script fetches each route once first). The budget was 2 s.

| Run | Median | Slowest |
| --- | --- | --- |
| Run 1 | 163 ms | 225 ms |
| Run 2 | 158 ms | 268 ms |
| Run 3 | 165 ms | 238 ms |

The slowest pages in run 3 were `/requests/DEMO-0988` (238 ms), `/books` at phone width (234 ms) and `/requests/DEMO-1032` at phone width (227 ms). These are local timings. A hosted preview will be slower by however long the network takes.

### Demo flows (played through the UI)

| Flow | Result |
| --- | --- |
| a. Acme: send, mine, advance 12 blocks, marked paid automatically, approve posting, Posted | Pass. One Payment line posted |
| b. Brightline (short): ask for the balance, accept the short payment, plan shows the fee write-off line, approve | Pass. Payment and Fee write-off posted |
| c. Orbit (counterfeit): Mark paid is locked, dismiss the transfer, Never posted, no approve button | Pass |
| d. Meridian (wrong network): accept_other_network is offered and accepted, Never posted, no approve button | Pass |
| e. Kite (unidentified): open the suggested payment, confirm the match with a note, Ready to post, approve | Pass. One Payment line posted |
| f. Fernhill sender page (phone width): look-alike address stopped, the real address accepted, "0x123" explained as invalid, ops page shows Scam stopped | Pass |
| g. Kestrel (duplicate): record the refund, approve | Pass. One Payment line and one Overpayment line |
| The same event delivered again still counts once (Acme) | Pass |
| Books page after the flows: the audit log shows the postings, no overflow on a phone | Pass |
| A decision shows on the page within 4 s, 8 tries in a row | Pass. Slowest try in each run: 2.3 s, 1.4 s and 2.9 s (the refresh fallback). Before the fix: up to 10 s or more |
| New request through the form, then its sender page (phone) | Pass |
| Reload demo day (two clicks): cases back to their start states, the request made during the demo removed, a non-demo request kept | Pass |

The non-demo request is a real check. `npm run qa` starts the app in live mode first, creates one ordinary request through the API, then restarts it in demo mode on the same data. The script checks that request before and after the demo reload.

## Bugs found and fixed (9)

| # | Bug | Severity | Fix | Regression test |
| --- | --- | --- | --- | --- |
| 1 | **Decisions looked ignored for 4 to 10+ seconds.** In about one click in four, Next's `router.refresh()` fetched the updated page but never showed it. Clicking "I've asked for the balance" left the page unchanged until a background refresh caught up, sometimes after more than 10 s. The root cause inside Next.js was not found (see known issues). | High: a presenter would click again or think it broke | `refreshAfterChange` now has a fallback. The root layout stamps every server render. If no refresh has landed 2.5 s after a change, the page reloads. It is turned off where a reload would lose something: the sender's address-check result, and the steps of the Acme payment playback (the end of the playback still has it) | e2e: "a decision shows on the page within 4 s (8 tries)" |
| 2 | **`/books` at phone width was 743 px wide**: the demo invoices table pushed the whole page sideways | Medium | The table scrolls inside its panel | vitest and e2e overflow check |
| 3 | **The Books audit log was unreadable on a phone**: three fixed columns left about 40 px for the text, one word per line | Medium | The audit log stacks on narrow screens: time and badge on one line, the detail full width below | vitest and e2e |
| 4 | **Kestrel (case g) at phone width was 400 px wide**: the posting-lines table overflowed | Medium | Posting lines scroll inside the panel | vitest and e2e |
| 5 | **Meridian (case d) at phone width was 548 px wide**: the customer's email holds a 64-character transaction hash that couldn't wrap | Medium | Customer messages wrap long unbroken text | vitest and e2e |
| 6 | **Any page could flash 489 px wide on a phone while loading**: the loading skeleton was the old case-queue table with fixed columns, labelled "Loading cases" | Low | A plain skeleton with flexible columns, labelled "Loading" | vitest |
| 7 | **Not-found pages talked about "cases" and "the queue"**, which are hidden in demo mode. A customer opening a bad payment link saw "Case not found" and an operator button, "Back to the queue". | Medium (customer-facing) | A not-found page for operators ("Not found", back to At a glance) and a separate one for sender links ("This payment link isn't valid": don't pay, ask the business for a new link). The sender version has no operator links | vitest and e2e (both pages, at phone width) |
| 8 | **Contradictory wording on every request page.** "What this can't tell you" said "this demo isn't connected to one [an accounting system]", directly under the "In your books" panel | Medium (a sharp customer would spot it) | The line now shows only when the request isn't linked to an invoice in the books, and is reworded | vitest |
| 9 | **Inconsistent wording and formatting** | Low | Each item below | vitest |

Bug 9 covers these small fixes:

- The audit log said "Mei Tan (Finance ops): Mei Tan (Finance ops) approved 1 line(s)". The name now appears once, and it says "1 line" or "2 lines".
- "Request made" entries wrote "1250.00 USD due". They now write "1,250.00 USD due", like every other page.
- The approve message names the accounting system properly ("Xero", not "xero").
- The books panel shortened a transaction hash as `0x000000…b01a` while the transfer list and the reply used `0x00000000…69b01a`. One transfer now reads the same everywhere.
- The unidentified-payment page said "Kite Analytics' INV-1045" in the heading but "Kite Analytics's message" in the link. One rule is now used for both.
- `/payments` overflowed by 17 px at phone width because the mapping drop-down was too wide. It now shrinks to fit.

## Known issues NOT fixed

| Issue | Severity | Why it's left |
| --- | --- | --- |
| **The refresh stall's root cause is unknown.** Bug 1 is mitigated, not cured. When the fallback fires, the whole page reloads after about 2.5 s: an on-screen message such as "Posted 1 line to the demo books" or "Delivered again" disappears (the panel itself still shows the result), and the scroll position may reset. A background refresh can also be lost, so a status change may take 8 s rather than 4 s to appear. | Medium | Finding the cause needs a deeper look at Next 15.5 and React 19 transition commits. Worth a focused session before a hosted demo. |
| **A missing record returns HTTP 200, not 404.** The not-found page is shown correctly, but because the root and sender pages have loading screens, Next streams the response and can't change the status. | Low | Invisible to people. Fixing it means removing the loading screens. |
| **Older pages are still reachable by URL in demo mode** (`/payments`, `/inbox`, `/bulk`, `/settings`, `/cases/...`). They show the older deposit-investigation product ("Demo workspace", "File A / File B"). With `DEMO_MODE=on` (the default), the upload and import buttons there still work: only `DEMO_MODE=1` turns them off, even though the sidebar says "Demo mode · offline, fictional data". | Medium for a shared preview, low for a live demo | Changing which flag blocks uploads changes hosting behaviour. That's a product decision: on a shared preview, set `DEMO_MODE=1`, or decide that `on` should block uploads too. |
| **Short payment (case b) can be posted before a decision.** Before anyone decides, the books panel is already "Ready to post" (a partial payment plus a note) with an Approve button, while the next step asks the person to decide first. Approving early is safe: the fee write-off posts later. But a presenter could click it out of order. | Low | This is how the posting rules are designed, and a wording or design question rather than a bug. |
| **Units are missing on two figures.** On request pages, "Requested" shows "5,000.00 USDC", but "Received" and "Outstanding" show the number only. | Low (cosmetic) | Left alone to avoid layout churn. A one-line change if wanted. |
| **The `/books` audit log is long.** It has over 40 demo entries and no paging, so it's a long scroll on a phone. | Low | It's readable now. Paging would be a feature. |
| **Not covered by this pass:** dark mode; live mode beyond creating one request; real Xero or QuickBooks connections; browsers other than Chromium; a hosted, non-local server. | n/a | Out of scope tonight. |

## Screenshots

`demo/screenshots/qa/` holds one full-page desktop screenshot of every page, taken after the fixes (48 files). It also holds three phone screenshots taken before the fixes, named `BEFORE_*_overflow.png`, showing the overflow bugs. The final run produced no problem screenshots. When a check fails, the script saves `*_PROBLEM.png` there (or wherever `SHOTS` points).

## How to re-run

The full pass in one command: typecheck, unit tests, build, then a fresh demo server and the end-to-end script. It exits non-zero on any failure, so a nightly task can run it.

```
npm run qa
```

Each suite on its own:

```
npm run typecheck                                   # tsc --noEmit
npm test                                            # vitest run
npm run build                                       # next build
BASE=http://localhost:3400 npm run test:e2e         # against a demo server you started yourself
```

Options:

- `QA_SKIP_BUILD=1 npm run qa` reuses the current build.
- `QA_PORT=3500` changes the port (`QA_PORT+1` is used briefly for the live-mode step).
- `SHOTS=demo/screenshots/qa` saves screenshots.

The e2e script writes its full results, every page with its load time, to `tests/e2e/qa_results.json`. That file is git-ignored.

Playwright is used from the machine's global install. Nothing is added to `package.json`.
