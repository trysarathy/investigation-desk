SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# Release test (P1): "Books v2" (merged 2026-11-06, FICTIONAL fixture)

**Basis:** Calls rows used: 0 (Calls tab: 1 row, an advisor, 0 buyers; not relevant to this test). Public sources used: 0 new; pack files `usability-methods.md`, `finance-ops-practice.md`, `clearline-product.md`. Release tested: fixture `fixtures/release-2026-11-06-books-v2.md`, screens 1–7 only (the task says not to run the app). Single simulated evaluator; findings need QA/PM confirmation.
**SETUP:** PAUSE could not be checked (live tools off; no Sheet access this run). Google account not checked for the same reason.

## Scope
Changes: Approve all ready (bulk) on `/books`; posting date = block date; success message; Export audit CSV with period filter; plan-changed refusal shows new plan inline. QA: `e2e 16/16 PASS (desktop 1280x720); phone layout not in this run`. So no one has tested the phone layout except this walkthrough.
Tasks walked: T-a (why is an invoice open / never posted), T-b (approve and post, incl. the fee write-off), T-d (month-end: what's in October), T-e (auditor evidence), T-f (phone).

## Score table (problem severity 0–4; 0 = no problem found)
| H | Heuristic | Sev | Evidence (fixture screen) |
|---|---|---|---|
| H1 | Visibility of system status | 3 | Screen 1: the 50.00 fee write-off on INV-1042 is only visible after clicking the row; the bulk list shows "Lines: 2" and nothing else |
| H2 | Match with the real world | 3 | Screen 3: toast "✓ 12 payments posted to Xero automatically" after a person clicked Approve. Untrue description of what happened, and a banned claim |
| H3 | User control and freedom | 2 | Screens 3/5: no undo or reversal shown after a 12-posting batch. Not confirmed absent; fixture doesn't show it |
| H4 | Consistency and standards | 2 | Screen 2 posting date is the UTC block date (2026-10-31), CSV column is `posted_at_sgt`, period picker says "This month" without a time zone. Three time bases on one page |
| H5 | Error prevention | 4 | Screen 1: Approve all ready (12), no confirmation, approver pre-filled "Priya". Screen 5: same button full-width and sticky on phone |
| H6 | Recognition rather than recall | 2 | Screen 1: to see what will post, I have to open each of 12 rows one by one |
| H7 | Flexibility and efficiency | 0 | The bulk approve is the efficiency I'd ask for. The problem is its safety (H5), not that it exists |
| H8 | Aesthetic and minimalist | 0 | No problem found on screens seen |
| H9 | Recognise and recover from errors | 0 | Screen 7: plan-changed refusal shows the new plan inline, nothing posts, log row "approval refused: plan changed". Screen 6: counterfeit explained with both contracts |
| H10 | Help and documentation | 1 | No text says which date rule (UTC block date vs SGT) is used for posting or the period filter |

**Release usability score: 1.7** (mean of ten; lower is better; single simulated evaluator).

## Top issues (ranked C-score → severity → frequency)

### 1. CFU-20261106-1: "Approve all ready" posts 12 entries, incl. a hidden fee write-off, in one click with no confirmation
- **Where:** T-b, `/books` desktop, Screen 1 → Screen 3.
- **Steps:** Load the demo day → `/books` → click **Approve all ready (12)**.
- **Expected:** a confirmation that lists what will post: count, total, every non-payment line (the 50.00 fee write-off to 404 on INV-1042), the approver, the posting dates. Or write-offs excluded from bulk and approved one by one.
- **Actual:** 12 postings go to Xero straight away, incl. a 50.00 write-off I never saw (it's behind a row click).
- **Heuristic:** H5, H1. **Severity 4. Close impact C4**: a write-off in the books that nobody looked at. As the simulated controller, a write-off is a decision, not a payment. I wouldn't let it ride in a batch.
- **Source:** fixture Screens 1, 3; posting rules in `clearline-product.md` (short accepted → separate fee write-off line).

### 2. CFU-20261106-2: On phone, "Approve all ready (12)" is a full-width sticky button at the bottom of the screen
- **Where:** T-f, `/books` at 390×844, Screen 5.
- **Steps:** Open `/books` on a phone → scroll the table.
- **Expected:** approval is desktop-only, or behind a confirmation. Never a sticky button where a thumb lands while scrolling.
- **Actual:** the bulk post button sits exactly where a scroll-tap lands. There's no confirmation (issue 1), the Lines column is off-screen and line detail is cut off at Account. So I could post 12 entries without seeing a single line.
- **Heuristic:** H5. **Severity 4. C4.** Phone not covered by QA (`phone layout not in this run`).
- **Source:** fixture Screen 5, QA summary line.

### 3. CFU-20261106-3: Approver field is pre-filled with the last name typed ("Priya")
- **Where:** T-b / T-e, `/books` Screen 1 → audit log Screen 3 → CSV Screen 4.
- **Steps:** a second person opens `/books` after Priya used it → clicks Approve all ready.
- **Expected:** the field is empty each time, or (better) the approver comes from a sign-in.
- **Actual:** the audit log and the audit CSV record "Priya" for postings someone else approved. The known gap (names typed, not verified, per `clearline-product.md`) gets worse: now the default is wrong, not just unverified.
- **Heuristic:** H5. **Severity 3. C4**: wrong approver in the audit file.
- **Source:** fixture Screens 1, 3, 4.

### 4. CFU-20261106-4: Posting date = UTC block date, so a 1 Nov SGT receipt goes into October, and the rule isn't stated
- **Where:** T-d, request page INV-1047, Screen 2; CSV Screen 4.
- **Steps:** open INV-1047 → In your books.
- **Input:** "Received: 1 Nov 2026, 01:10 SGT (block time 31 Oct 2026 17:10 UTC)".
- **Expected:** a posting date that follows the company's written cut-off rule, with the rule shown next to the date (`finance-ops-practice.md` §1: the books are in SGT and the tool must show which rule it used).
- **Actual:** dated 2026-10-31 with no note, and included in the October audit CSV. For a company that books in SGT, this receipt belongs to November. Any receipt between 00:00 and 07:59 SGT on the 1st lands in the wrong period.
- **Heuristic:** H4, H10. **Severity 3. C4**: wrong period. The release note ("posting date = block date") means this is by design. So it's a policy decision for product-manager, not a bug, but the screen has to say which rule it uses either way.
- **Source:** fixture Screen 2, Screen 4, release notes.

### 5. CFU-20261106-5: Audit CSV can't stand alone as evidence (no token contract, block time, posting date or approval time) and the period has no time zone
- **Where:** T-e, `/books` Export audit CSV, Screen 4.
- **Steps:** Export audit CSV → Period "This month" (October).
- **Expected:** for each posting: posting date, block time (UTC), token contract, network, tx hash, approver, approval time, plan key, plus the period's time zone stated.
- **Actual:** columns `posted_at_sgt, invoice, customer, amount_usd, tx_hash, network, approver`. No token contract (so I can't show the auditor it was real USDC and not a look-alike), no block time, no posting date (the filter uses posting date, but the file doesn't show it), no approval time. "This month" doesn't say SGT or UTC.
- **Heuristic:** H4. **Severity 2. C3**: I'd have to rebuild the evidence for a PBC sample by hand.
- **Source:** fixture Screen 4; `crypto-accounting-and-audit.md` §3 (what a controller asks for), `[GUESS: persona judgement]` on the exact column set.

## Other issues
| ID | Issue | Where / steps | Heur. | Sev | C | Source |
|---|---|---|---|---|---|---|
| CFU-20261106-6 | **Over-claim:** toast "✓ 12 payments posted to Xero automatically". A person approved them. The wording is banned (company rule 2) and would end up in a demo video or screenshot | Screen 3, after Approve all ready | H2 | 3 | C1 (numbers unaffected) | fixture Screen 3; COMPANY_RULES rule 2 → **`RISK:` row** |
| CFU-20261106-7 | Phone: line detail table cut off at "Account" column, so I can't see which account a line posts to | Screen 5, tap a row | H1 | 2 | C2 | fixture Screen 5 |
| CFU-20261106-8 | Phone: Ready-to-post table scrolls horizontally; "Lines" column off-screen on load | Screen 5 | H8/H1 | 2 | C1 | fixture Screen 5 |

The over-claim (6) ranks below the top 5 on C-score because it doesn't change a number. It is escalated separately as `RISK:` and should be fixed before any demo or screenshot uses this screen.

## What works
- **Never posted (3)** is right: counterfeit USDT (Orbit), wrong network (Meridian) and the Kestrel duplicate (waiting for a decision) have no approve button and a clear label. Screen 1.
- **Counterfeit evidence**: INV-1043 shows the token contract against Tether's side by side, and nothing posts. Screen 6.
- **Plan-changed refusal**: new plan shown inline, nothing posts until a second click, refusal logged. This is exactly what I want. Screen 7.
- **Request page time display**: INV-1047 shows both SGT received time and UTC block time. The data for a cut-off decision is there; only the rule is missing. Screen 2.
- **Posting line reference** carries tx, token, network and "par". Screen 2.
- **Audit log** records time (SGT), request, action, approver for every posting. Screen 3.
- CSV row count (14 October postings) is consistent with what posted. Screen 4.

## Not tested
- Anything not on the 7 fixture screens: reversal/undo after posting, whether the same plan can be posted twice (e.g. double-click on Approve all ready, or bulk + single approve on the same item), what actually landed in Xero, Xero error messages, settings, the sender's page.
- Phone: only `/books` (Screen 5). Request pages on phone not shown.
- The app was not run (task instruction); every observation is from the fixture.

## Value line
This release moves me the wrong way on "would I pay" until 1–4 are fixed. Bulk approve is the efficiency I'd want, but as built it can post a write-off and a wrong approver and a wrong-period date into my books. That's the one thing I'd buy this tool to prevent.

## Hand-offs
- qa-security-engineer + product-manager: CFU-20261106-1, -2, -3, -4 (C4) and -5 (C3). Reproduction steps above.
- product-manager: CFU-20261106-4 is a policy decision (block date UTC vs SGT company setting). It needs a written rule and a label on screen.
- lead-designer: CFU-20261106-2, -7, -8 (phone layout); confirmation dialog design for -1.
- chief-of-staff: CFU-20261106-6 over-claim (`RISK:`), and C4s, which go to the top of the 07:30 briefing.
- crypto-protocol-engineer: fix after QA confirms.

Source-tie rate: 8 issues + 10 heuristic lines + 7 "what works" items = 25 items, all tied to a fixture screen, the QA line or a pack file. One sub-claim (CSV column set in -5) is `[GUESS: persona judgement]` within an otherwise sourced item. **25/25 = 100%.**

## Log (live tools off)
WOULD WRITE: Log row (timestamp SGT, agent crypto-finance-user, action "release test Books v2", details "SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. release test books-v2: score 1.7, issues 8 (C4 4, C3 1, C2 1, C1 2), top5 [CFU-20261106-1..5], source-tie 100%. Report: team/feedback/crypto-finance-user/2026-11-06-release-books-v2.md").
WOULD WRITE: Log row "RISK: SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. Books v2 has four C4 issues (CFU-20261106-1..4: unconfirmed bulk posting incl. write-off; sticky phone bulk button; pre-filled approver; UTC posting date) and an over-claim toast 'posted to Xero automatically' (CFU-20261106-6). Fix before any real data or demo."
WOULD WRITE: Log note "for qa-security-engineer / product-manager: CFU-20261106-1..5 (severity, C-score and steps in report)."
