# Script: finance controller / accountant / finance manager (books owner)

Use with `SCRIPT_CORE.md` (open, rules, close, scoring). This replaces the core's story block (Q3-Q8).
Who: the person who closes the month at a business that receives USDC/USDT (any size). DRAFT, 2026-11-02.
Main hypotheses: **H4, H2**, plus H1 from the finance side (Vishal: finance vs ops). Past tense only.

| # | Question | Tests | Supports if they say… | Refutes if they say… |
|---|---|---|---|---|
| 1 | "Walk me through the last stablecoin payment you received, from invoice to it being in the books." | H4 | Several hand steps (explorer lookup, spreadsheet, manual journal), named people, days of lag | One step; a gateway/PSP posts it like a card payment |
| 2 | **"After a stablecoin payment is matched, how does it get into your accounting system today, and how long does that take?"** (verbatim; write word for word) Follow-ups: which system? who posts? hash, fees, short payments? what does your accountant ask at month end? | H4 | Manual posting, a time per payment or per month, auditor asks for hashes/evidence | Automatic via an existing tool; "a few minutes a month" |
| 3 | "When did a payment last arrive different from the invoice (short, wrong network, no reference, two invoices in one)? What did you do?" | H4 | A recent dated story; chasing the customer; write-offs | "Never happens" or can't recall one |
| 4 | "When did you, the finance side, first know that payment had arrived? Who knew before you?" | H1 | Ops/sales knew first and acted (released goods) before finance confirmed; finance found problems later | Finance confirms first and ops waits; or the two are the same person and it's fine |
| 5 | "Has anything been shipped or delivered before the money was confirmed, and then the payment turned out wrong? Tell me about the last time." | H1 | A loss or a scramble; a rule created afterwards | Never; strict rule already works |
| 6 | "What currency are your books in? At the last month end, how did you value the USDC/USDT you were holding?" | H2 | Non-USD books; rate lookups by hand; unsure which rate the auditor accepts | USD books; or converted to fiat same day so no balance |
| 7 | "Tell me about the last time you converted stablecoins to fiat. How did you work out the gain or loss, and which cost did you use for those coins?" | H2 | A lot/cost-basis spreadsheet; FIFO/average debates; hours | "Our accountant does it, no questions"; immaterial amounts |
| 8 | "Has your auditor or tax adviser asked anything about the stablecoins in the last year? What exactly?" | H2/H4 | Specific auditor queries (classification: not cash; evidence; valuation); fees paid to answer them | No queries; auditor accepts a statement |
| 9 | "How do you classify stablecoins in the balance sheet today, and who decided that?" | H2 | Uncertainty; adviser paid; changed treatment | Settled policy, no work |
| 10 | "What have you tried to make any of this easier (tools, templates, an adviser)? What did it cost? Why did you stop or keep it?" | H2/H4 | Paid for a tool/adviser and still has a gap; workaround with a clear cost | Happy with current tool (note which) |
| 11 | "Of everything we talked about, which took the most of your time last month? Roughly how many hours?" | all | One clear winner with their number | "None of it really" |
| 12 | "Who else in the company touches these payments, and could I speak to them?" | advance | An intro to ops/sales or treasury (feeds H1) | Declines |

Close: core asks (intro, redacted month-end schedule or payment record, follow-up, quote permission).
Never ask for system logins or wallet access.
