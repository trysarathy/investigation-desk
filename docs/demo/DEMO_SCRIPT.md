# Clearline demo: the 10-minute script

Labels: **[VERIFIED]** seen on the demo build or queried from the seeded demo database on the build machine;
**[ASSUMPTION]** reasoned, not tested. Every screen says **"Demo · fictional data"**, and so should you.

The demo follows the 13 steps of the presenter guide ("Presenter guide" next to the data label in the demo build;
the same steps are `src/lib/clearline/demo/guide.ts`, the journey test and the walkthrough video). Timings add up to
10 minutes; leave the questions for the end.

## Before you start (5 minutes before)

1. `npm run demo` (or, if it is already set up, `npm run demo:reset` with the app running). See `DEMO_RUNBOOK.md`.
2. Sign in as `finance@northwind.demo` with the demo password `npm run demo` printed (it is in `.demo/state.json`;
   never put it on a slide).
3. Browser at 1440 px wide (or full screen on a laptop). Open **Presenter guide**: each step has "Go there", which
   switches to the right demo login for you, and two or three talking points.
4. Anyone can use **Note feedback** on any screen during the session; afterwards `npm run demo:feedback` writes the
   notes to `docs/demo/FEEDBACK_<date>.md`. A reset keeps them (saved to `.demo/feedback/` first).
5. Fallback if anything misbehaves: `docs/demo/screenshots/` (one per step) and `docs/demo/walkthrough.webm` (the
   whole journey, recorded; not in git, make it with `npm run demo:video`).

## The talk track

| # | Time | Screen (as) | Do | Say (in your own words) |
|---|---|---|---|---|
| 1 | 0:00–0:30 | Overview (Finance) | Point at the five records | "One stablecoin payment leaves five records: the provider's, the chain transfer, the order, the settlement batch and the bank line. Clearline only reads them and shows where they agree. It never holds, sends or converts money. All of this is fictional." |
| 2 | 0:30–1:15 | Daily report, 7 Dec (Finance) | **Start demo**; pick NW-SG and 25 Nov; open the date list to show 8 Dec "(today, partial)" | "Any of the 30 days, on the merchant's clock, Singapore or Dubai. Each day says what is done and what still needs a person. Today, 8 Dec, is only partly in, and it says so." |
| 3 | 1:15–2:00 | Payments (Finance) | Filter exceptions on TRON USDT; search `BK-24823`, then its tx hash | "1,471 payments evaluated. Each has one of four results. Filter by anything Finance asks about; search by order, hash or deposit address." |
| 4 | 2:00–3:00 | Payment BK-24823 (Finance) | Scroll the five parts, the deciding step, the difference row, the timeline | "1,760 USDT arrived against a 2,000 USDT quote. The rule that decided is named: underpaid beyond the band. The difference is typed and priced: SGD −324.00 still owed. An amount alone never closes a match." |
| 5 | 3:00–4:00 | Exception EX-BK-24823 (Finance) | Assign to me, add a note, attach evidence, propose a resolution | "Every exception has an owner, a reason and a next step. Finance proposes; proposing is not approving." |
| 6 | 4:00–5:00 | Approvals (Approver) | Switch to the Approver; approve version 1; show the payment's audit naming both people | "The switcher signs in as the Approver: a real session, recorded as her. Finance could not approve her own proposal, not even through the switcher; the server and the database both refuse it." |
| 7 | 5:00–6:00 | Batch B-1125-SGD (Finance) | Walk the waterfall left to right; open the held bar | "From the merchant day's SGD 44,412.30 to the bank's SGD 40,228.68: timing, the held payment, the fee, a refund. Tied to the cent. BK-24871 is held by the provider, so it is an exception, not a silent difference." |
| 8 | 6:00–6:45 | Payment BK-25102 (Finance) | Show the two parts and the gap box | "Case 3: paid in two parts on two chains, USDT on TRON and USDC on Ethereum. The AED 14.16 left is explained: AED 12.86 underpayment and AED 1.30 rate difference, inside the band." |
| 9 | 6:45–7:30 | Month-end, NW-SG, Nov (Finance) | Point at confirmed-not-settled, exceptions by age, journals pending sign-off | "What finance needs at month-end. Journal proposals wait for sign-off: the posting rules are not signed off, so nothing is posted." |
| 10 | 7:30–8:00 | Accounting export (Finance) | Show the Xero and QuickBooks drafts, the evidence and month-end packs | "Drafts a person imports; evidence packs per payment. A Viewer cannot download them." |
| 11 | 8:00–9:00 | Uploads (Finance, then Approver) | Upload the three files in `demo-files/`; map the provider file once, save it as a template; the Approver confirms the statement; Reconcile now | "The provider's own layout, mapped once. Every row is validated before it counts. The bank statement needs a second person, and it is still 'imported, not bank-authenticated', so nothing closes on it. BK-39021 comes out as an exception." |
| 12 | 9:00–9:30 | Provider console (ops@providerp.demo) | Merchants, Pilot metrics | "The provider sees aggregates only, never a merchant's payments. 'Wrong' says not measured yet: there is no independent review to measure it against." |
| 13 | 9:30–10:00 | Settings (Finance) | Tolerance policy, theme preview | "Finance can read the tolerance policy but not change it. The provider's white-label theme, with the demo label on every screen." |

Step 11 takes the longest live (mapping 24 columns). If time is short, show the mapped template on a second upload,
or play that part of `walkthrough.webm`. After step 11 the data is no longer the seeded state: **Reset demo** (or
`npm run demo:reset`) before the next audience.

## Numbers you can quote (from the seeded demo database)

Queried on the build machine right after `npm run demo:reset` [VERIFIED]:

| What | Number |
|---|---|
| Orders | 1,500 (NW-SG 909, NW-SG-USD 235, NW-AE 356); 29 unpaid, not evaluated |
| Payments evaluated | 1,471 |
| Matched | 1,154 (78.45%), all by M5.batch.tied_verified: the five records agree and the batch is tied to a verified bank line |
| Matched with difference | 178 (12.1%), all M4.tolerance.within_band |
| Suggested for review | 25 (1.7%): explained outside the band 16, not final yet 6, above the write-off threshold 3 |
| Exception | 114 (7.7%): batch not tied 84, underpaid beyond the band 10, overpaid beyond the band 8, unknown batch 3, no chain transfer 3, unexplained 3, held by the provider 2, look-alike token 1 |
| Differences on the current results | sender-side fee 59, underpayment 48, rate difference 45, overpayment 40, re-quote after expiry 29, partial payment open 9, unexplained 3 |
| Open exceptions | 114, every one with an owner, a reason, a next step and an assigned person |
| Write-off proposals | 178: 154 not yet prepared, 14 awaiting the Approver, 10 approved |
| Journal proposals | 1,564, all pending sign-off of the posting rules (1,563 proposed, 1 superseded) |
| Reconciliation runs | 90 (30 days × 3 entities) |
| Case 1 | BK-24817/24823/24830/24836 in B-1124-001, net SGD 5,961.24, tied |
| Case 2 | B-1125-SGD: 44,412.30 → −2,970.00 → −1,200.00 (BK-24871 held) → +1,620.00 → 41,862.30 gross → −418.62 fee → −1,215.00 refund → 40,228.68 |
| Case 3 | BK-25102: AED 14.16 open = AED 12.86 underpayment + AED 1.30 rate difference |
| After the live upload (NW-SG) | review 14 → 103, exception 87 → 22, matched 697 and with difference 97 unchanged (`demo-files/expected-outcomes.json`) |

The query (read-only, on the demo database):

```sql
select decision, count(*), round(100.0 * count(*) / sum(count(*)) over (), 2) from match_records group by 1 order by 2 desc;
select decision, rule_id, count(*) from match_records group by 1, 2 order by 1, 3 desc;
```

**Do not present these shares as accuracy.** They describe a generated month whose answers are known in advance (the
generator decides how many payments are short, late, held or odd). They show the rules at work, not how often
Clearline is right on a real merchant's data.

## Likely questions, honest answers

**"How accurate is it?"** We do not have an accuracy figure yet. Everything here is fictional data with planted
answers, and no independent party has reviewed the results; that is why the provider's pilot metrics say "Wrong: not
measured yet". What we can show is that each decision names the rule that made it and the records behind it, so a
reviewer can check any one of them.

**"What does auto-match mean?"** "Matched" only when the chain transfer, the provider's record, the order, the
settlement batch and a verified bank line all agree (rule M5.batch.tied_verified). An amount that happens to be right
never closes a match on its own. Anything less becomes "matched with difference", "suggested for review" or an
exception, each with its reason.

**"Why 'matched with difference' and not just 'matched'?"** The money arrived and the gap is explained and small:
typed (sender-side fee, rate difference, underpayment…) and priced in the entity's currency, inside the tolerance
band (the larger of 50 bps and the entity's minimum, SGD 5.00 for NW-SG). It still needs a write-off that Finance
prepares and an Approver approves. Clearline does not write anything off by itself.

**"Who can approve?"** Only an Approver, and never the person who prepared it (maker-checker, enforced by the server
and again by the database). The demo shows Finance being refused on her own write-off, also after switching users.

**"Is it secure?"** Each organisation's rows are separated by row-level security in PostgreSQL; roles decide what each
person sees and does; the second-person rule is in the database; every change needs a same-origin request and a
session; the app is read-only towards money and holds no keys. The demo conveniences (reset, switcher, guide,
feedback, recorded chain data) exist only in a demo build and are checked absent from a real build. It has **not**
been independently reviewed or penetration-tested.

**"Is the chain data live?"** No. In the demo it is a recorded file of fictional transfers; the demo build refuses
live chain reads and runs offline. The token contract addresses (USDT on TRON and Ethereum, USDC on Ethereum) are the
real public ones; every transaction hash, address and amount is made up.

**"Does it post to Xero / QuickBooks?"** No. It produces journal drafts and an export a person imports. The posting
rules are waiting for sign-off, so every journal proposal says "pending sign-off".

**"Why don't you show it hosted, or in Docker?"** The demo runs on one machine, offline, against a local PostgreSQL.
Hosting is not set up for it, and the Docker path (`docker-compose.demo.yml`) has not been run end to end on the
build machine (no Docker daemon there); the timings in the runbook used a local PostgreSQL 16.

**"The time on what I just did looks odd."** The seeded month runs on the demo calendar (today is 8 Dec 2026). What
you do live (an approval, an upload, a run) is stamped with this computer's real clock, so it can sort before the
seeded data.

**"Can I use my own data?"** Not in this demo build: it is for fictional data only. A pilot with real provider files
is a separate setup.

## What is real and what is fictional

| Real | Fictional |
|---|---|
| The app: the matching rules, tolerances, the second-person rule, row-level security, the upload pipeline (mapping, validation, confirmation), the exports, all running as they would for a customer | Northwind Travel (demo), Provider P (demo), every person, login, email, address and bank account |
| The public USDT (TRON, Ethereum) and USDC (Ethereum) token contract addresses | Every transaction hash, wallet address, block, amount, order, quote, batch and bank line |
| PostgreSQL 16, and the database checks (maker-checker, append-only audit) | The 30-day month (a seeded generator) and the three documented cases |
| The reconciliation runs are computed by the engine at seed time and when you click "Reconcile now" | The chain data (a recorded file; no network) and the "Demo bank feed (simulated, fictional)" |

## What the demo does not show yet

- **Real provider data.** Nothing here comes from a real provider, merchant, bank or chain read.
- **Hosting.** It runs on the presenter's machine only; there is no hosted demo.
- **Independent review.** No outside review of the results, the security or the accounting; "Wrong: not measured yet".
- **Posting.** The posting rules await sign-off; journals are drafts pending sign-off and nothing is posted to a ledger.
- **Bank-authenticated statements.** An uploaded statement is "imported, not bank-authenticated" and never verifies a
  settlement (the imported-bank-line flag is off for every entity).
