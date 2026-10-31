SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# Release test (P1): "Repeat events + audit CSV columns" (merged 2026-11-13, FICTIONAL fixture)

**Basis:** Calls rows used: 0 (Calls tab: 1 row, advisor, 0 buyers; not relevant). Public sources: 0 new; pack files `usability-methods.md`, `finance-ops-practice.md`, `crypto-accounting-and-audit.md`, `clearline-product.md`. Release tested: fixture `fixtures/release-2026-11-13-repeat-events.md`, screens 1–4 (app not run, per task). Single simulated evaluator.
**SETUP:** PAUSE not checked (live tools off).

**To product-manager, before the ship review:** you asked for my usual top 5. There isn't one this week. **No severity-3/4 or C3/C4 issues found in the tasks tested**, and I found no lower-severity issues worth a ticket either. I'm not padding the list. Two things to confirm are under "Not tested".

## Scope
- Repeat event delivered twice → logged once as "repeat ignored".
- Audit CSV: new columns `token_contract`, `posting_date_sgt`, `block_time_utc`, `approved_at_sgt`. Period filter in SGT, stated on the page.
- QA: `e2e 16/16 PASS desktop; phone 390x844 PASS (no horizontal scroll)`.
Tasks walked: T-a (INV-1046 state after a repeat), T-d (October period and cut-off), T-e (auditor evidence from the CSV), T-f (phone).

## Score table
| H | Heuristic | Sev | Evidence |
|---|---|---|---|
| H1 | Visibility of system status | 0 | Screen 1: grey "Repeat of event #3 ignored (counts once)"; amount, status and plan unchanged |
| H2 | Match with real world | 0 | "Periods are in Singapore time (SGT). Block times are shown in UTC." Plain words, matches how I'd write the policy |
| H3 | User control and freedom | 0 | No new control surfaces in this release; none tested |
| H4 | Consistency and standards | 0 | Screen 4 plan date 2026-11-01 "Dated in SGT (company setting)" matches the SGT period filter (Screen 2) |
| H5 | Error prevention | 0 | Screen 1: repeat event can't create a second posting; In your books still "1 payment, 1 overpayment marked To refund — waiting for a decision" |
| H6 | Recognition rather than recall | 0 | CSV row carries contract, network, hash, approver and plan key, so no cross-referencing needed |
| H7 | Flexibility and efficiency | 0 | No problem found |
| H8 | Aesthetic and minimalist | 0 | Screen 3: repeat line wraps to two lines, readable |
| H9 | Errors | 0 | No error states in scope |
| H10 | Help and documentation | 0 | Header note: "Approver names are typed, not signed in. Sign-in comes before real data." Honest about the known gap |

**Release usability score: 0.0** for the screens in scope (single simulated evaluator; covers 4 screens only, not the product).

## Top issues
**None.** No severity-3/4 or C3/C4 issues found in the tasks tested. No minor issues raised either.

Known gap, not new and not counted as an issue: approver names are typed, not authenticated (`clearline-product.md` known gaps). This release now **discloses** it on the export page, which is the right move.

## What works
- **Duplicate event handling (T-a):** delivering event #3 again changes nothing except one log line. Status, amount and the posting plan are unchanged, so no double posting. Screen 1. This is the C4 risk I'd worry about most, and it's handled.
- **Cut-off (T-d):** INV-1047 (31 Oct 17:10 UTC = 1 Nov 01:10 SGT) is now dated 2026-11-01 with "Dated in SGT (company setting)". That shows the rule and puts the date in the right period for an SGT book. Screen 4. This fixes what I'd have raised on the Books v2 release.
- **Audit CSV (T-e):** `posting_date_sgt, block_time_utc, invoice, customer, amount_usd, token, token_contract, network, tx_hash, approver, approved_at_sgt, plan_key`. The sample row has the full USDC contract `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`, "Priya (typed)" (honest), approval time and plan key. For a PBC sample, that's the row I'd hand the auditor for occurrence and accuracy. It doesn't prove wallet ownership, and it doesn't claim to (`crypto-accounting-and-audit.md` §3). Screen 2.
- **Period label:** "October 2026 (SGT)", with the time-zone rule stated above the button. Screen 2.
- **Phone (T-f):** no horizontal scroll; activity log readable; export desktop-only with the text "Exports are available on desktop." Clear, and nothing destructive on the phone screen shown. Screen 3; QA phone PASS.

## Not tested (please confirm before the ship review; not raised as issues)
1. **Full hash in the file.** The fixture shows `tx_hash` as `0x0000…41aa` and `plan_key` as `p_8f2…`. I can't tell whether that's the fixture abbreviating or the CSV truncating. If the CSV truncates, it would be a C3 (evidence untraceable). QA: open the exported file and check the hash is 66 characters.
2. **Re-dating of items already posted under the previous rule.** If any receipt was already posted to Xero with the old UTC block date (e.g. under Books v2's rule), does this release leave it alone, re-date it, or re-post it? Fixture Screen 4 shows a posting *plan* for INV-1047, so I assume it isn't posted yet. Not shown either way.
3. Any October export run before this release will differ from one run after (receipts at 00:00–07:59 SGT on 1 Nov move out of October). This isn't a defect, but if a close was already signed off on the old basis, the change needs a note in the close file. `[GUESS: persona judgement]`
4. Anything outside the 4 screens: posting to Xero, approval flow, settings for the "company setting" date rule.

## Value line
This release moves "would I pay" slightly towards yes. Cut-off in my time zone and an audit row that stands on its own are exactly the period-end basics I'd test first. The bigger blockers (sign-in, period/roll-forward view, chains) are untouched.

## Hand-offs
- product-manager / chief-of-staff ship review: "simulated release test: no material issues; 2 checks for QA (hash length in CSV; previously posted items under the old date rule)".
- qa-security-engineer: Not-tested items 1 and 2.
- No `RISK:` row: no over-claim seen ("typed, not signed in" is an honest disclosure).

Source-tie rate: 10 heuristic lines + 5 what-works items + 4 not-tested items = 19 items; 18 tied to a fixture screen or pack file, 1 `[GUESS: persona judgement]` (not-tested 3). **18/19 = 95%.**

## Log (live tools off)
WOULD WRITE: Log row (agent crypto-finance-user, action "release test repeat-events", details "SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. release test repeat-events: score 0.0, issues 0 (C4 0, C3 0, C2 0, C1 0), top5 [], source-tie 95%. 2 QA checks: CSV hash length; re-dating of already-posted items. Report: team/feedback/crypto-finance-user/2026-11-13-release-repeat-events.md").
WOULD WRITE: Log note "for qa-security-engineer: SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. Please confirm CSV tx_hash is full length and how previously posted receipts behave under the SGT date rule (repeat-events release)."
