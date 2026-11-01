SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# Release test (P1): "Books v2" (FICTIONAL release fixture, merged 2026-11-06)

**Basis:** Calls rows used: 1 (fixture export `calls-export-2026-10-31.csv`), of which buyers: 0 (1 advisor, fractional CFO). Public sources used: 0 opened this run (live tools off; pack references only, labelled). Release tested: `fixtures/release-2026-11-06-books-v2.md`, Screens 1–7 only (desktop 1280×720 and phone 390×844 as described). App **not run**, per the task. Single simulated evaluator; every finding needs QA/PM confirmation.

**SETUP status:** PAUSE could not be read (live tools off) — WOULD READ: Settings `PAUSE`. Google account check not possible. Calls count taken from the fixture export.

## Scope
| Change (release notes) | Controller task touched |
|---|---|
| **Approve all ready** (bulk approve on `/books`) | T-b approve and post; T-f phone |
| Posting date = transfer's block date | T-d month-end cut-off |
| Success message after posting | T-b feedback |
| **Export audit CSV** with period filter | T-d month-end; T-e auditor evidence |
| Plan-changed refusal shows new plan inline | T-b |
| (always) | T-a "why is INV-x still open?" — only partly testable: `/books` "Never posted" section and Screen 6 |

QA summary line: `e2e 16/16 PASS (desktop 1280x720); phone layout not in this run`. So nothing on the phone has been checked by QA; my phone findings (Screen 5) are the only look at it.

## Controller checks (P1 step 6)
| Check | What the fixture shows | Verdict |
|---|---|---|
| Amounts and rounding | INV-1042: payment 4,950.00 + fee write-off 50.00 → 404 (Screen 1). Invoice total not shown, so I can't tie 4,950 + 50 to the invoice | Can't fully check |
| Period / date / time zone | Request page shows SGT receipt and UTC block time side by side (Screen 2) — good. Posting date uses the **UTC** block date: 2026-10-31 for a receipt at 1 Nov 01:10 SGT | **Issue** (CFU-20261031-4) |
| What posts, to which account | Payment → Wallet (USDC) 090; write-off → 404. On `/books` the write-off is hidden until the row is clicked | **Issue** (CFU-20261031-1) |
| Can it post twice | Plan-changed refusal blocks a stale approval (Screen 7); duplicate Kestrel transfer not posted (Screen 1). Bulk + single approve on the same request in two tabs not shown | Works for what's shown; double-click/two-tab not tested |
| Counterfeit / wrong network posts? | Orbit (counterfeit) and Meridian (wrong network) "Never posted", no approve button; Screen 6 shows both contracts | **Works** |
| Approver recorded | Yes, but a typed name pre-filled with the last one typed ("Priya") | **Issue** (CFU-20261031-2) |
| Auditor can trace | CSV has tx_hash, network, approver; no token contract, no line type, no account, no block time | **Issue** (CFU-20261031-5) |
| Over-claim on screen | Toast: "✓ 12 payments posted to Xero **automatically**" | **Issue + RISK** (CFU-20261031-6) |

## Score table (H1–H10, worst problem under each; 0 = none, 4 = catastrophe)
| # | Heuristic | Sev | Evidence |
|---|---|---|---|
| H1 | Visibility of system status | 3 | INV-1042's fee write-off only visible after clicking the row (Screen 1); toast lasts 4 s and says "12 payments" though 13 lines posted (Screen 3) |
| H2 | Match with the real world | 3 | "posted to Xero automatically" (Screen 3) describes a manual approval as automatic |
| H3 | User control and freedom | 2 | Bulk post has no confirmation step (Screen 1); no reversal path shown in the fixture (absence not confirmed) |
| H4 | Consistency and standards | 2 | "Approve and post" (per request) asks for one plan; "Approve all ready" posts 12 incl. a write-off with no plan shown; toast count ≠ line count |
| H5 | Error prevention | 4 | One unconfirmed click (desktop) or a sticky full-width tap (phone) posts 12 requests incl. an unseen write-off under a pre-filled name (Screens 1, 5) |
| H6 | Recognition rather than recall | 2 | Lines/accounts must be opened row by row to see what will post (Screen 1) |
| H7 | Flexibility and efficiency | 1 | Bulk approve is the right idea; no way to approve only single-line exact matches and leave write-offs for review (Screen 1) |
| H8 | Aesthetic and minimalist design | 1 | Phone: Lines column off-screen on load (Screen 5) |
| H9 | Recognise / diagnose / recover from errors | 0 | Plan-changed refusal shows new plan inline, nothing posts until re-approved, refusal logged (Screen 7); counterfeit explained with both contracts (Screen 6) |
| H10 | Help and documentation | 1 | No note on which cut-off rule the posting date uses or what the CSV contains [GUESS: persona judgement — fixture shows no help text either way] |

**Release usability score: 1.9 / 4** (mean of the ten; lower is better; single simulated evaluator).

## Top issues (5, ranked by C-score → severity → frequency)

| Rank | ID | Title | C | Sev | Heuristic |
|---|---|---|---|---|---|
| 1 | CFU-20261031-1 | Bulk approve posts a hidden fee write-off with no confirmation | C4 | 4 | H5, H1 |
| 2 | CFU-20261031-2 | Approver name pre-filled with the previous person's name | C4 | 4 | H5 |
| 3 | CFU-20261031-3 | Phone: sticky full-width "Approve all ready (12)" reachable by mistake | C4 | 4 | H5 |
| 4 | CFU-20261031-4 | Posting date = UTC block date; crosses the SGT month-end | C4 | 3 | H2 |
| 5 | CFU-20261031-5 | Audit CSV can't show what was posted to which account, or which token | C3 | 3 | H1, H10 |

### 1. CFU-20261031-1 — Bulk approve posts a hidden fee write-off with no confirmation (C4, Sev 4)
- **Task/step:** T-b, `/books` → Approve all ready.
- **Steps:** Load the demo day → `/books` → look at "Ready to post (12)" without clicking rows → click **Approve all ready (12)**.
- **Expected:** before posting, a summary of what will post: 12 requests, 13 lines, **one fee write-off of 50.00 to 404 (Brightline INV-1042)**, approver name; confirm or cancel. Ideally write-off lines are excluded from bulk and need their own approval.
- **Actual:** no confirmation dialog; the 50.00 write-off is only visible after opening the row; it posts with the others. Toast then says "12 payments posted", which hides that a write-off line was also posted (Screen 3).
- **Why a controller cares:** accepting a short payment is a decision (chase, write off, leave open). Here it gets made by one click on a list that doesn't show it. That's a write-off I'd have to explain at review with no record that anyone looked at it.
- **Source:** Screens 1 and 3. Posting rule "Short accepted → payment + separate fee write-off" [INTERNAL: clearline-product.md / docs/ACCOUNTING_SYNC.md]. Short-payment decision as a real choice: NOWPayments "Partially Paid … wait … or reach out" [ASSUMPTION: secondary, pack note of nowpayments.io page opened 2026-10-31; not re-opened this run].
- **Owner:** qa-security-engineer (reproduce), product-manager (acceptance criteria), lead-designer (confirm dialog).

### 2. CFU-20261031-2 — Approver pre-filled with the last name typed (C4, Sev 4)
- **Task/step:** T-b / T-e, `/books` approver field.
- **Steps:** Approve something as "Priya" → as a different person, open `/books` → field already says "Priya" → click Approve all ready.
- **Expected:** empty approver field (or a signed-in user); approval refused until a name is entered.
- **Actual:** "Your name" pre-filled "Priya"; audit log records 12 rows with approver "Priya" (Screen 3) whoever clicked.
- **Why:** the audit log is the control evidence for "a person approved". A pre-filled name makes it wrong by default, on top of the known gap that names are typed, not verified [INTERNAL: clearline-product.md "Known gaps"]. An auditor sampling these postings would get a false approver.
- **Source:** Screens 1 and 3.
- **Owner:** qa-security-engineer, product-manager.

### 3. CFU-20261031-3 — Phone: sticky full-width bulk-approve button (C4, Sev 4)
- **Task/step:** T-f, phone 390×844, `/books`.
- **Steps:** open `/books` on a phone → scroll the table → the bottom of the screen is a full-width sticky **Approve all ready (12)** → one tap posts (no confirmation, per Screen 1).
- **Expected:** on phone, bulk approve hidden or behind a confirmation summary; or approval desktop-only, said plainly.
- **Actual:** the most dangerous action on the page is the largest tap target and always under the thumb, while the "Lines" column is off-screen and line detail is cut off at "Account" (Screen 5) — I can't see what will post but I can post it.
- **Source:** Screen 5; QA line says phone layout was not tested.
- **Owner:** lead-designer, qa-security-engineer (add phone run).

### 4. CFU-20261031-4 — Posting date uses the UTC block date; crosses SGT month-end (C4, Sev 3)
- **Task/step:** T-d month-end cut-off, request page INV-1047.
- **Steps:** open INV-1047 → "Received: 1 Nov 2026, 01:10 SGT (block time 31 Oct 2026 17:10 UTC)" → posting plan date **2026-10-31**.
- **Expected:** the posting date follows the company's written cut-off rule (books in SGT [INTERNAL: COMPANY_RULES "Time"]), the rule is shown on the line, and the controller can set it. Whether October or November is right is the company's policy call — confirm with your auditor / professional review.
- **Actual:** posted to October (UTC date) with no statement of which rule was used. It also lands in the October audit CSV (Screen 4). After 6 Nov, October may already be closed/locked; a back-dated posting into a closed period either moves a closed number or gets refused by the ledger [GUESS: persona judgement — not shown in fixture; check on the Xero Demo Company].
- **Source:** Screens 2 and 4; cut-off example in finance-ops-practice.md §1 [GUESS: persona judgement, pack].
- **Owner:** product-manager (setting + display), crypto-protocol-engineer.

### 5. CFU-20261031-5 — Audit CSV can't show line type, account or token (C3, Sev 3)
- **Task/step:** T-e / T-d, Export audit CSV (October).
- **Steps:** `/books` → Export audit CSV → Period = October → open file.
- **Expected:** one row per posted line with: line type (payment / fee write-off / overpayment), account code, token and **token contract**, network, tx hash, block time (UTC) and posting date, amount in token and USD, rate source ("par"), approver, approval time, plan id.
- **Actual:** columns `posted_at_sgt, invoice, customer, amount_usd, tx_hash, network, approver`; 14 rows. No token or contract, no account, no line type — so the 50.00 write-off can't be told apart from a payment (or may not be in the file at all; can't tell if rows are per line or per request). The column is "posted_at_sgt" while the period filter uses the posting (UTC block) date, so the same file mixes two clocks.
- **Why:** it's the start of a close package, but I can't tie it to the ledger by account or answer an auditor's "which token, which contract" without going back to the screens.
- **Source:** Screen 4; auditor-evidence list in crypto-accounting-and-audit.md §3 [GUESS: persona judgement, pack].
- **Owner:** product-manager, crypto-protocol-engineer.

## Other issues
| ID | Title | C | Sev | Steps / evidence | Owner |
|---|---|---|---|---|---|
| CFU-20261031-6 | **Toast says "posted to Xero automatically"** — over-claim; contradicts "posts only after a person clicks Approve" | C1 | 3 | Screen 3, after Approve all ready. Company rule 2 forbids "posts to Xero automatically" [INTERNAL: COMPANY_RULES, PRODUCT_FACTS]. Ranked by C-score it sits below the top 5 (no wrong number), but it is a **RISK** and must be fixed before any demo or screenshot leaves the building. Suggested text: "12 approved by <name> and posted to Xero (Demo Company): 12 payments, 1 fee write-off." | lead-designer, chief-of-staff (RISK) |
| CFU-20261031-7 | Phone line detail cut off at "Account" | C2 | 3 | Screen 5: tap a row → table ends at Account; can't check the account before approving on phone | lead-designer |
| CFU-20261031-8 | Duplicate "Waiting for a decision" has no visible way to decide on `/books` | C2 | 2 | Screen 1: Kestrel second transfer shows label only, no action. The decision may live on the request page (not in fixture) — confirm before fixing | product-manager |
| CFU-20261031-9 | Export period defaults to "This month" | C1 | 1 | Screen 1: on 6 Nov "This month" = November; closing October needs a manual change. Default to last closed month [GUESS: persona judgement] | lead-designer |

## What works
- **Counterfeit and wrong network never post** and say why; Screen 6 shows Tether's contract next to the fake one. Exactly what I'd want before anything touches the ledger.
- **Plan-changed refusal** (Screen 7): new plan inline, nothing posts until re-approved, and the refusal is in the audit log. Good control.
- **Duplicate** is held as an overpayment line waiting for a decision, not posted as a second payment (Screen 1).
- **Request page shows both clocks** (SGT received, UTC block time) and a traceable reference (tx, token, network, "par") on the line (Screen 2). The data to fix CFU-…-4 is already on screen.
- **Audit log** records time (SGT), request, action and approver for each posting (Screen 3); the CSV export with a period filter is the right direction for month-end.
- Header says "Xero (Demo Company)" — honest about which ledger.

## Not tested
- App not run; everything above is from the fixture's screens. No real Xero Demo Company check of what landed (line count, account, date, reference text).
- Whether bulk approve re-checks each plan key (plan-changed protection) for all 12, or only the per-request button does.
- Double-click / two-tab double posting; reversal or undo after posting; Xero lock-date behaviour on back-dated October postings.
- What the CSV holds per row (line vs request) and whether the write-off is in it.
- Invoice totals (to tie 4,950 + 50 to INV-1042); rounding on any non-round amount.
- T-a and T-c beyond the "Never posted" section; how the Kestrel decision is made.
- Phone: only Screen 5 described; no tap-target sizes, no other pages.

## Value line
As the simulated controller, this release moves me slightly toward "yes" on the evidence side (period export, plan-changed control) and further from it on controls: a one-click bulk post that includes an unseen write-off under someone else's name is something I'd have to explain to my auditor, so until CFU-…-1/2/3 are fixed I'd keep using the per-request button and wouldn't count bulk approve as time saved. [GUESS: persona judgement]

## Source-tie rate
Feedback items = 9 issues + 10 heuristic lines = 19. Tied to a fixture screen, QA line or labelled pack/internal source: 18. Persona-only: 1 (H10). **Source-tie rate 95%.** (Several items also carry persona judgement on impact; that is labelled where used.)

## Hand-offs and Log (live tools off)
WOULD WRITE: Log row — `2026-10-31 SGT | crypto-finance-user | release test Books v2 | CFU-20261031-1…9 | SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. release test books-v2: score 1.9, issues 9 (C4 4, C3 1, C2 2, C1 2), top5 [CFU-20261031-1, -2, -3, -4, -5], source-tie 95%. Report team/evals/crypto-finance-user/runs/2026-10-31-retest/task-1.md`

WOULD WRITE: Log row — `SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. RISK: Books v2 toast "12 payments posted to Xero automatically" over-claims (rule 2); also four C4 issues (CFU-20261031-1..4) could put a wrong write-off, wrong approver or wrong period in the books. for chief-of-staff: top of 07:30 briefing.`

WOULD WRITE: Log row — `SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. for qa-security-engineer / product-manager: CFU-20261031-1 (Sev 4, C4) bulk approve posts hidden fee write-off, no confirm — Screen 1→3 steps in report; CFU-20261031-2 (Sev 4, C4) approver pre-filled "Priya"; CFU-20261031-3 (Sev 4, C4) phone sticky Approve all — QA phone run missing; CFU-20261031-4 (Sev 3, C4) posting date UTC vs SGT cut-off, INV-1047; CFU-20261031-5 (Sev 3, C3) audit CSV lacks line type/account/token contract.`

WOULD WRITE: Log row — `SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. for lead-designer: CFU-20261031-3, -6 (toast wording), -7, -9 (phone layout, copy, default period).`

WOULD WRITE: Log row — `SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. for crypto-protocol-engineer: CFU-20261031-4, -5 after QA confirms.`

No Product roadmap rows (product-manager owns those).
