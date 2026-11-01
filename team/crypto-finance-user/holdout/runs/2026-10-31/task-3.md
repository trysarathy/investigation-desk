SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

# H3: Mock discovery call. "Ravi" (fictional) against the founder's talk track (P4)

**Basis:** Calls rows used: 0 (the Calls tab was not read; live tools are off. Per the pack it has 1 row, an advisor, 0 buyers). Sources: `objections-bank.md` (O-numbers), `docs/enterprise/OBJECTIONS.md` (branch `enterprise-pack`, read this run), `demo/WHAT_TO_SAY.md`, `docs/ACCOUNTING_SYNC.md`, `demo/results/results.md`, `demo/DEMO_SCRIPT.md`, `clearline-product.md` (all `[INTERNAL]`). `prompts/CALL_SCRIPT.md` on `gtm-os` was not opened.
**Frame:** I'm playing a simulated controller. Nothing I say is a customer view. "Ravi Menon" and Larkspur Remit are fictional, from the fixture. The founder's lines are her planned lines from the fixture, used as given.

## Hidden buyer card (shared after the call)
| Field | Content | Source |
|---|---|---|
| Segment | Remittance firm, about 140 inbound USDT/USDC a month, direct to company wallets, Xero, Big 4 auditor | Fixture |
| Push | Direct-to-wallet receipts with no checkout means matching and exceptions are manual | Fixture + `persona.md` B1–B3 [VERIFIED vendor pages] |
| Pull | Exceptions explained, approve-then-post into Xero with a tx-hash reference | [INTERNAL: ACCOUNTING_SYNC.md] |
| Anxiety | Vendor touching finance data without SOC 2; auditor challenge; solo founder | Fixture (CFO's SOC 2 rule); O1, O6, O8 |
| Habit | Spreadsheet plus explorer plus Xero bank rec | `persona.md` A2 [ASSUMPTION: secondary] |
| Must-haves | (1) nothing posts without our approver; (2) auditor-traceable lines; (3) USDT on the chains we use | [GUESS: persona judgement] |
| **Deal-breaker** | **No SOC 2 → CFO won't let any vendor touch finance data** | Fixture |

## (A) The call (15 exchanges)
1. **Founder:** Thanks for the time, Ravi. Clearline posts every stablecoin payment to Xero automatically, so your team never touches it.
   **Ravi:** Automatically? Nothing goes into our ledger without one of my people approving it. Who approves in your setup? *(O1, over-promise)*
2. **Founder:** We integrate with Xero, QuickBooks and NetSuite today.
   **Ravi:** Our group entity is moving to NetSuite next year. Is NetSuite live? Can I talk to someone using it? *(O14, O15)*
3. **Founder:** We tested on 111 real transactions and got every one right, so you'll get zero false alarms.
   **Ravi:** 111 is a small number. We do 140 in a month. Were those payments like ours, matched to invoices and posted, or something else? And who picked the test set? *(O2)*
4. **Founder:** Our users save about 20 minutes on every exception.
   **Ravi:** Your users: which companies? Measured how? I'd need that before I take it to my CFO. *(O15, over-promise)*
5. **Founder:** Security-wise we're enterprise-grade; SOC 2 is in progress.
   **Ravi:** My CFO's rule is simple: no SOC 2, no vendor touches finance data. When is the report, which auditor, Type I or II? Do you have SSO and roles today? *(O1, deal-breaker)*
6. **Founder:** Teams like yours tell us this is the biggest headache in their close.
   **Ravi:** Which teams? Remittance firms? How many have you spoken to? *(O15)*
7. **Founder:** The pilot is free, so there's no risk to you.
   **Ravi:** Free isn't my risk. My risk is giving write access to my Xero and data access to an unaudited vendor. What exactly would you hold? *(O1)*
8. **Ravi (Mom-Test trap):** Honestly, the exception screen looks great. This could be really useful.
   **Founder:** *(scoring point: does she treat this as a buying signal, or ask about his last exception?)*
9. **Ravi:** Most of our customers pay USDT on Tron. Do you handle that? *(O12)*
10. **Ravi:** If a customer is short by 30 USDT after exchange fees, what happens? Can I set a rule that anything under 10 dollars auto-closes to fees? *(O13, Stripe-style tolerance; teardowns T1/T2)*
11. **Ravi:** Our Big 4 auditor asked last year for wallet ownership. How does your tool help with existence and ownership? *(O8)*
12. **Ravi:** At month end I tie the wallet balance to the Xero bank account. Can you give me a roll-forward per wallet for October? *(O10)*
13. **Ravi:** Your log says "approved by Priya". Prove it was Priya. *(O11)*
14. **Ravi:** You're one person. If you're unavailable during my close, what happens? *(O6)*
15. **Ravi:** Bitwave and Request Finance already sync to Xero. Why you? And what does it cost after the pilot? *(O4, O5)*

## (B) Debrief: her talk-track lines, scored
Over-promises first. "Honest answer" means what the company's own documents support.

| # | Her line | Verdict | Why (source) | Say instead |
|---|---|---|---|---|
| 1 | "Posts every stablecoin payment to Xero automatically, so your team never touches it." | **False / over-promise (company rule 2 names this exact phrase)** | Posting happens only after a person clicks *Approve*. Xero is built and in testing, not live with anyone. Wrong-network and counterfeit payments are never posted [INTERNAL: ACCOUNTING_SYNC.md; COMPANY_RULES rule 2] | "Clearline prepares the exact Xero entries. Once your approver clicks approve, it posts them. Xero is built and in testing on Xero's Demo Company." |
| 2 | "We integrate with Xero, QuickBooks and NetSuite today." | **False** | QuickBooks: "built against documented shapes; not yet run on a sandbox". NetSuite: "Interface designed, not built" [INTERNAL: ACCOUNTING_SYNC.md] | "Xero first, QuickBooks next. NetSuite is designed, not built, and I won't give you a date." |
| 3 | "Tested on 111 real transactions… every one right, so you'll get zero false alarms." | **Misleading / over-promise** | The 111 = 59 in the main set (43/59 before fixes, 59/59 after fixing on that same set) + 52 held-out (52/52). That's the **older investigation desk** (deposit diagnosis), not invoice matching or posting. "False alarms" was 0 of 12 normal payments per set [INTERNAL: demo/results/results.md; DEMO_SCRIPT.md]. "Zero for you" is an extrapolation | "On 52 real transfers we collected after the last fix, the diagnosis was right on all 52. That's a small set, and it's ours, not yours. I'd like to measure it on a month of your payments." |
| 4 | "Our users save about 20 minutes on every exception." | **False (no users; not measured)** | 0 customers. "20 min per exception" is a demo estimate, not measured [INTERNAL: WHAT_TO_SAY.md] | "We haven't measured time saved yet. How long did your last wrong payment take, start to finish?" |
| 5 | "Enterprise-grade; SOC 2 is in progress." | **False / risky** | No sign-in or roles, data and Xero tokens in plain JSON, no SOC 2, no pen test, one-person operation. Nothing in the company docs shows a SOC 2 engagement under way [INTERNAL: OBJECTIONS.md "Gaps today"] | "No SOC 2, no pen test, no SSO yet. If your CFO needs SOC 2 before any vendor touches finance data, we're not ready for you yet. We can talk about self-hosting, but I'd rather be straight." |
| 6 | "Teams like yours tell us this is the biggest headache in their close." | **False (invented social proof)** | The Calls tab has 1 row, an advisor, not a buyer; 0 buyer interviews [pack README] | Don't claim it. Ask: "When did the last payment arrive wrong? What did it cost your team?" |
| 7 | "The pilot is free, so there's no risk to you." | **Wrong on price and on risk** | OBJECTIONS.md: pilot **US$300** for 30 days, then US$200/month, and it says the "free" on the website is out of date. WHAT_TO_SAY.md says "We haven't set pricing." **The internal docs disagree: flag for Aashmiin to decide, don't resolve here.** Risk isn't only price: data access and Xero write access | Pick one approved answer before the call. On risk: "Read-only on-chain. Writes only after your approver clicks. Here are our gaps." |

**Scored as over-promises: 7 of 7 planned lines.** Lines 1, 2, 4, 5 and 6 are false against the company's own documents. Lines 3 and 7 are misleading or inconsistent.

### What the talk track is missing
- **Mom Test:** no question about Ravi's past (his last exception, his last close, his last audit). Exchange 8 is the trap: if she replies "Great, shall we start the pilot?", that's treating a compliment as a signal.
- **Next step with a date:** none planned. Ask for a month of his payment data and a 30-minute follow-up with a date.

### Ravi's objections she cannot answer today (honest "not yet")
| Objection | Status today | Source |
|---|---|---|
| SOC 2 / SSO (the deal-breaker) | None. "We're not ready for you yet" | OBJECTIONS.md |
| Tron USDT (ex. 9) | Receiving is Ethereum only. Tron is detected as wrong network | WHAT_TO_SAY.md |
| Tolerance rule (ex. 10) | No tolerance setting. Every short payment needs a person | `finance-ops-practice.md` §3; task-1 CFU-20261031-3 |
| Wallet ownership for the auditor (ex. 11) | Not something Clearline provides | `crypto-accounting-and-audit.md` §3 |
| Per-wallet roll-forward (ex. 12) | Not built (task-2, item 5) | Observed this run |
| Prove the approver (ex. 13) | Names are typed, not verified | WHAT_TO_SAY.md |
| Reference customer (ex. 2, 6) | None: 0 customers | Pack README |
She **can** answer honestly: approve-before-post and the audit trail (ex. 1, 7), short-payment handling (ex. 10, partly), solo-founder risk (ex. 14: self-host, no custody, 30-day term), and competitors (ex. 15: "if Bitwave works for you, keep it").

### Three things to change before the real call
1. Delete lines 1, 2, 4 and 6. Replace 1 and 2 with the "once you approve / Xero first, QuickBooks next" wording above.
2. Lead with the SOC 2 gap yourself. With this CFO it decides the call, and it's better heard from you in minute 2 than discovered in week 3.
3. Get one approved pricing line from Aashmiin's decision (US$300 pilot vs "not set") and reconcile `WHAT_TO_SAY.md` and `OBJECTIONS.md`.

**Objection most likely to end it:** SOC 2 (the CFO's stated rule). It can't be answered today, only disclosed honestly.

## Source-tie rate
Items: 7 line verdicts + 7 cannot-answer rows + 7 buyer-card rows = 21. Sourced: 20. `[GUESS]`: 1 (must-haves). **≈ 95%.**

## Hand-offs and log (live tools off)
- WOULD WRITE (Log): `2026-10-31 15:05 SGT | crypto-finance-user | mock call (remittance, Xero, fictional "Ravi") | SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND. objections 15, over-promises 7 of 7 lines, top fix: drop "automatically/integrates/our users" and disclose SOC 2 first. Report team/crypto-finance-user/holdout/runs/2026-10-31/task-3.md`
- WOULD WRITE (Log): `for sales-closer-assistant: H3 scorecard; pricing conflict OBJECTIONS.md (US$300) vs WHAT_TO_SAY.md ("not set") needs Aashmiin's decision.`
