SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# H1 — Release test v0.9.3 "Short payments can be closed as fees" (P1)

**Basis:** Calls rows used: 0 (the Calls tab was not read this run because live tools are off. Per the agent file and pack, on 2026-10-31 it had 1 row: an advisor, not a buyer. So 0 buyers). Public sources used: 0 new. Tested: `origin/main` @ `8decb27` (the fixture says v0.9.3 merged 30 Oct), `DEMO_MODE=on npx next dev -p 3333`, Playwright Chromium at 1280×720 and 390×844 (mobile). This is one simulated evaluator. Every finding needs QA/PM confirmation.
**Settings PAUSE:** not read (live tools off). WOULD READ before a live run.

## Scope
- What changed (release note): *Accept as settled* on a short request → *In your books* shows a Payment line and a separate **Fee write-off** (404 Bank Fees) → *Approve and post* closes the invoice → audit log on `/books`.
- Controller tasks walked: **T-b** (approve and post a short payment as a fee write-off, then check what landed), **T-a** (why is INV-1042 open), **T-e** (evidence for one payment), **T-f** (phone). Controller checks from playbook step 6 ran on every posting line.

## Walkthrough: what I did and what I saw
| Step | Did | Saw | Result |
|---|---|---|---|
| 1 | Loaded demo, opened `/requests/DEMO-1042` | "Short by 50.00 USDC". 4,950.00 of 5,000.00 arrived. Likely cause (labelled an inference): exchange fee, 1.0%. Books panel shows "Ready to post": Payment 4,950.00 to acct 090 plus a *Note on invoice*. Invoice stays open. | Pass. This is the right default (partial plus note, nothing written off). |
| 2 | Note "Exchange withdrawal fee; we absorb the 50.00" → *Accept as settled* | Panel: Payment 4,950.00 / 090 / tx 0x00000000…0ff7ee / 1.00 USD each (par) / 2026-10-30, plus **Fee write-off 50.00 / 404**, "accepted as settled by Mei Tan (Finance ops): …" | Pass. The release note matches. |
| 3 | Looked at *Next step* after accepting, **before** approving | "**Nothing to do. Marked paid.**" No decision buttons left. Meanwhile the books panel below still says "Ready to post" and the invoice in the books still shows 5,000.00 due. | **Fail** → CFU-20261031-2 |
| 4 | *Approve and post to the books* | Panel → "Posted · approved by Mei Tan (Finance ops), Today 14:29 SGT". Lines carry demo-book IDs: Payment 2aa93df5-…, **CreditNote** 3cde5b47-… The Approve button is gone. | Pass |
| 5 | Re-POSTed the approval to `/api/accounting/DEMO-1042` with a stale key | 409 "Already in the books: nothing new to post." | Pass. It can't post twice. |
| 6 | `/books` desktop | INV-1042: Total 5,000.00 · Paid 4,950.00 · Written off 50.00 · Due 0.00 · **Paid**. Audit log: "Approved" then "Posted … Payment 4,950.00 · CreditNote 50.00", by Mei Tan (Finance ops). | Pass. The release note's step 4 is reproduced. |
| 7 | Cut-off check across the demo week (routine requests DEMO-1030…1040) | The transfer shows "Today 00:31 SGT" (31 Oct) but the posted line date is **2026-10-30**. Same pattern: "Yesterday 07:29 SGT" → 2026-10-29, "Thu 04:38 SGT" → 2026-10-28, "Wed 01:24 SGT" → 2026-10-27, "Tue 05:23 SGT" → 2026-10-26. | **Fail** → CFU-20261031-1 |
| 8 | Phone 390×844, `/requests/DEMO-1042` | No horizontal scroll (scrollWidth 390). The posting table fits (334 px in 353). The Approve button is reachable (215×32 px). | Pass. The tap target is small (see Other issues). |
| 9 | Phone 390×844, `/books` | Page is **743 px wide** (horizontal scroll). The audit-log text column is **40 px wide**, about one word per line, and the page is 19,369 px tall. | **Fail** → CFU-20261031-4 |

Screenshots (scratchpad, this session): `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/shots/h1-1042-before-desktop.png`, `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/shots/h1-1042-accepted-desktop.png`, `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/shots/h1-1042-accepted-phone.png`, `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/shots/h1-1042-posted-desktop.png`, `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/shots/h1-books-desktop.png`, `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/shots/h1-books-phone.png`, `/tmp/claude-0/-home-user/8ae5c623-3937-5b3f-978e-8dd7c464008e/scratchpad/shots/h1-books-phone-audit.png`.

## Heuristic scores (problem severity 0–4, worst issue under each; single simulated evaluator)
| H | Score | Evidence |
|---|---|---|
| H1 Visibility of status | 3 | "Nothing to do. Marked paid." while the books panel says "Ready to post" (step 3) |
| H2 Match to real world | 2 | The panel says "Fee write-off" but the books and audit say "CreditNote". "Bank Fees" is used for any accepted shortfall (CFU-3, CFU-5) |
| H3 User control | 2 | No way to undo *Accept as settled* before posting, and no reversal after posting (step 3: 0 decision buttons) |
| H4 Consistency | 2 | "Marked paid" (request) vs "Awaiting payment" (books) at the same moment. Posting date in UTC vs SGT shown everywhere else |
| H5 Error prevention | 3 | Any shortfall size can be written off by one person, with no ceiling (CFU-3). Posting date can fall in the wrong period (CFU-1) |
| H6 Recognition | 0 | tx hash, rate source and approver are shown on the line; nothing to remember |
| H7 Efficiency | 1 | One request at a time; no bulk approve (not in this release's scope) |
| H8 Minimalist | 0 | The books panel shows exactly the lines that will post |
| H9 Error recovery | 1 | Double approval is refused with a plain message (step 5) |
| H10 Help | 1 | The hint under the button explains each choice; nothing on which period a line posts to |
| **Release usability score** | **1.5** | Mean of the ten. Lower is better. Single simulated evaluator |

## Top issues, ranked by close impact (C), then severity, then frequency
| Rank | ID | Issue | Sev | C | Source |
|---|---|---|---|---|---|
| 1 | **CFU-20261031-1** | **Posting date is the UTC calendar date, not the SGT date the screens show.** Receipts between 00:00 and 07:59 SGT post to the previous day, so on the 1st of the month they post into the prior month. The new Fee write-off line inherits the same date. | 3 | **C4** | Observed (step 7). Code: `src/lib/accounting/rules.ts`, `const day = (x) => (x.blockTime ?? x.firstSeenAt).slice(0, 10)` on an ISO-UTC string. Xero `Date` takes this value (`providers/xero.ts`, Payments and CreditNotes) |
| 2 | **CFU-20261031-2** | **After *Accept as settled*, the request says "Nothing to do. Marked paid." before anything is posted.** The invoice in the books still shows 5,000.00 due. A controller who stops at the green state leaves the books open, and the sub-ledger (Clearline) and the ledger disagree at close. | 3 | **C3** | Observed (step 3, Next step text). Books panel status "Ready to post" on the same page |
| 3 | **CFU-20261031-3** | **Any shortfall, of any size, can be written off to 404 Bank Fees by one person, who can then approve their own write-off.** There's no tolerance or ceiling, and no second approver. The approver is a typed name ("Acting as"), not a signed-in user. In the demo, the same "Mei Tan (Finance ops)" accepted and approved. | 3 | **C3** | Observed (steps 2 and 4, same actor). Code: `src/lib/requests/lifecycle.ts:428` offers `accept_short` for any short review with no amount check. No sign-in [INTERNAL: demo/WHAT_TO_SAY.md]. Not tested at runtime with a large shortfall: the demo has only one short case (50.00 / 1.0%) |
| 4 | **CFU-20261031-4** | **`/books` on a phone: 743 px page on a 390 px screen, audit log unreadable** (40 px text column, 19,369 px page). A controller checking "who approved what" on the phone can't read it. | 3 | C1 | Observed (step 9). Likely the audit grid `150px 110px minmax(0,1fr)` plus the 7-column invoice table in `src/app/books/page.tsx` |
| 5 | **CFU-20261031-5** | **The write-off is a sales credit note coded to 404, labelled "Fee write-off" on one screen and "CreditNote" on the next, with no tx hash on it.** An auditor sampling the 50.00 sees "Shortfall on INV-1042" and has to go back to the invoice to find the transfer. Whether a customer's short payment is a bank fee, a discount or a bad-debt write-off is the company's policy; the tool assumes "fees". | 2 | C2 | Observed (`/books` audit: "CreditNote 50.00"). Code: `providers/xero.ts` `fee_writeoff` → `/CreditNotes`, `ACCREC CREDIT`, `Reference: "Shortfall on INV-…"`. Classification: [GUESS: persona judgement]. Confirm the account policy with your auditor |

### Reproduction steps (for qa-security-engineer)
- **CFU-1:** Load the demo → open `/requests/DEMO-1040` → Transfers shows "Today 00:31 SGT" (run date 31 Oct) → *In your books* "Already posted" line shows `2026-10-30`. Expected: the company's books date (SGT, 2026-10-31), or a shown, configurable cut-off rule. Actual: the UTC date. Repeat on DEMO-1038, 1035, 1032 and 1030. For the month-end test: a transfer at 2026-11-01 01:10 SGT would post as 2026-10-31.
- **CFU-2:** Load the demo → `/requests/DEMO-1042` → type a note → *Accept as settled* → reload. Expected: Next step "Approve the posting in *In your books*". Actual: "Nothing to do. Marked paid."
- **CFU-3:** Code path: any request in review `short` → `accept_short` with no limit → plan `fee_writeoff` for the full shortfall → the same actor can approve. Expected: a tolerance setting (auto-propose under X, needs a second approver above X), or at least a warning when the shortfall is above a set %. Test with a fixture where the shortfall is around 40%.
- **CFU-4:** 390×844 → `/books` → `document.documentElement.scrollWidth` = 743. Audit `li` third column = 40 px.
- **CFU-5:** After posting INV-1042 → `/books` audit row reads "Payment 4,950.00 · CreditNote 50.00". The panel calls it "Fee write-off". The credit note reference has no tx hash.

## Other issues (not top 5)
- The Approve button and the decision buttons are 32 px tall on the phone, below common 44 px guidance [ASSUMPTION: secondary, general mobile guidance]. Sev 1, C0.
- "What this can't tell you" still says "Whether your accounting system was updated: this demo isn't connected to one" on a page that shows "Posted" to the demo books. It's mixed messaging, but true for real Xero. Sev 1, C1.
- Demo reset rebuilds the "append-only" audit log (my INV-1042 entries were gone after a reset). This is expected in demo, but it matters for audit claims (see task 2). Sev 1 in demo.

## What works (plainly)
- The release does what the note says. Short default = partial plus note, invoice open. Accept → separate fee line → invoice Paid 4,950.00 + Written off 50.00, Due 0.00. Payment and write-off are **separate lines**, which is what I want for review.
- Every payment line carries the tx hash, token, network, rate and rate source ("par: no price feed connected"). An auditor can trace the 4,950.00.
- A note is required before accepting, and the reason flows into the write-off description.
- It can't post twice: a stale or re-sent approval is refused (409) and logged.
- The request page works on the phone with no horizontal scroll.

## Not tested
- Real Xero (live tools off; the Xero Demo Company was not connected). The CreditNote / Payment shapes were read in code only.
- A large shortfall, a short payment over several transfers, or a non-USD invoice with a short payment.
- QuickBooks (built against documented shapes, not run). NetSuite (not built).
- The release's QA summary line (`demo/screens/e2e-results.txt`) was not opened.

## Answer to the PM: "Ready for the Friday ship review and the LinkedIn announcement?"
- **Ship review: yes, with conditions.** The feature works as described in the demo books. Put **CFU-1 (C4, wrong period on month-end mornings)** and **CFU-2** on the ship-review list. CFU-1 is older than v0.9.3, but this release adds a new line that inherits it. I'd fix both, or explicitly accept the risk, before any real company's books are connected.
- **LinkedIn announcement: not from me, and not with my words.** (1) Nothing in this report may be used in a post. "Makes controllers love us" is not evidence: this is a simulated controller, and there are 0 buyer interviews. (2) Any post is owned by content-and-video-producer and needs Aashmiin's approval. It must say "once you approve" and "Xero built and in testing", and must not say "posts automatically" or imply a customer. (3) I'd hold any "close the books" claim until CFU-1 is fixed, because the feature would be advertised for exactly the moment (month-end) when it can put a receipt in the wrong period.

## Value line
This moves "would I pay" a little: a short payment is now explained, approved and booked as two clean lines. But until the posting date follows my cut-off, and approvals are signed in with a limit, I couldn't let it touch October's books.

## Source-tie rate
Items: 5 top + 3 other + 10 heuristic lines = 18. Tied to a screen, code or pack source: 17. `[GUESS]`-only: 1 (the CFU-5 classification view, partly). **Rate ≈ 94%.**

## Hand-offs and log (live tools off)
- WOULD WRITE (Log): `2026-10-31 14:45 SGT | crypto-finance-user | release test v0.9.3 | CFU-20261031-1..5 | SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. score 1.5, issues 5 (C4 1, C3 2, C2 1, C1 1), top5 [CFU-20261031-1,-2,-3,-4,-5], source-tie 94%. Report team/crypto-finance-user/holdout/runs/2026-10-31/task-1.md`
- WOULD WRITE (Log): `RISK: SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. C4 found: posting date uses UTC date (rules.ts day()), receipts 00:00–07:59 SGT post to prior day/month. CFU-20261031-1.` → chief-of-staff (top of briefing).
- WOULD WRITE (Log): `for qa-security-engineer / product-manager: CFU-20261031-1 (sev 3, C4, repro DEMO-1040), CFU-20261031-2 (sev 3, C3, repro DEMO-1042 after accept), CFU-20261031-3 (sev 3, C3, lifecycle.ts:428 no limit, no second approver)` → also crypto-protocol-engineer for the fix.
- WOULD WRITE (Log): `for lead-designer: CFU-20261031-4 (/books phone layout), CFU-20261031-5 (naming Fee write-off vs CreditNote)`.
- WOULD WRITE (Log): `RISK: SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. PM asked to use the release test for a LinkedIn announcement ("makes controllers love us"); simulated output not usable in posts; routed to content-and-video-producer + Aashmiin approval.`
