# Objections bank for the sceptical-buyer mock call

SIMULATED FEEDBACK — NOT EVIDENCE OF CUSTOMER DEMAND

Each objection is something **a controller might ask**. None is a quote from a customer. Source tags
show where the objection comes from; the honest answer lives in `docs/enterprise/OBJECTIONS.md`
(branch `enterprise-pack`) and `demo/WHAT_TO_SAY.md`, and the mock call scores Aashmiin against those.

| # | Objection (as the simulated buyer would put it) | Source | What a strong honest answer contains |
|---|---|---|---|
| O1 | "What happens to security? You'd have our ledger write access." | [INTERNAL: OBJECTIONS.md "What about security?"] | Read-only on-chain; writes only after a person approves a plan; gaps stated: no individual sign-in, plain-JSON storage, no SOC 2, no pen test; self-host option; "if you need SOC 2 first, we're not ready" |
| O2 | "We'll build it ourselves; it's an explorer and a spreadsheet." | [INTERNAL: OBJECTIONS.md] | Edge cases (counterfeit, freezes, multi-transfer tx, poisoning, short after fees, correct posting); honest that building can make sense; cheap pilot |
| O3 | "Our gateway already flags partially paid." | [INTERNAL: OBJECTIONS.md]; NOWPayments statuses [VERIFIED, teardowns.md T1] | Where gateways are enough (checkout payments); Clearline for payments that skip the checkout and for posting; "not yet" on gateway report import; asks what share skips checkout |
| O4 | "Bitwave / Request Finance / Cryptio do this and sync to NetSuite." | [INTERNAL: OBJECTIONS.md] | True, partly; they're broader and more mature; difference is a hypothesis (small team, wrong payments explained and posted); "keep it if it works" |
| O5 | "US$200 a month for 15 payments? No." | [INTERNAL: OBJECTIONS.md pricing, ROI_CALCULATOR] | Below ~20–25 payments/month may not pay back [GUESS]; ask volumes; pilot terms; never invent ROI |
| O6 | "You're a solo student founder. What if you disappear?" | [INTERNAL: OBJECTIONS.md] | True; no SLA; self-host, no custody, 30-day term, deletion, escrow on request |
| O7 | "Why not put Stripe on the invoice and avoid wrong payments?" | Stripe stablecoin docs [VERIFIED, teardowns.md T2] | If your customers pay USDC through Stripe, you may not need Clearline for those; USDT, Tron, direct B2B transfers are where it helps; ask how customers pay today |
| O8 | "How does this help my auditor with existence and ownership?" | PCAOB/AICPA themes [ASSUMPTION: secondary, crypto-accounting-and-audit.md §3] | It doesn't prove ownership; it gives per-payment occurrence/accuracy evidence (tx hash, contract, network, approver); reproducible verdicts; no audit claims |
| O9 | "Is USDC cash? Which account do you post it to?" | ASU 2023-08 scope [ASSUMPTION: secondary, Ledgible] | Clearline posts to the account the company chooses; classification is the company's and auditor's call; no advice |
| O10 | "Can it tie the wallet balance to Xero at month end?" | finance-ops-practice.md §1, §4 [GUESS: persona judgement] | Honest status of any period/roll-forward feature; "not yet" if absent |
| O11 | "Who approved this posting? Your log says 'Priya' — prove it was Priya." | [INTERNAL: WHAT_TO_SAY.md, no sign-in yet] | "Not yet": names typed, not verified; sign-in and roles before real data |
| O12 | "Customers pay us on Tron. Do you support it?" | [INTERNAL: WHAT_TO_SAY.md "Which chains"] | Today Ethereum for receiving; Tron detected as wrong network; "tell us which networks you use" |
| O13 | "Why not just tell customers to add the fee and write off small differences?" | SurferCloud notice [ASSUMPTION: secondary, teardowns.md T4] | Fair for tiny shortfalls; the cost is the unexplained ones and the posting; a tolerance setting (if built) |
| O14 | "We're on NetSuite." | [INTERNAL: ACCOUNTING_SYNC.md: designed, not built] | "Not built yet"; Xero first, QuickBooks next; no date promises |
| O15 | "Send me a reference customer." | [INTERNAL: 0 customers] | "We have none yet; you'd be one of the first, which is why the pilot is cheap" — never a fake reference |

**Red flags to score as over-promising in the mock call:** any date for a feature; "posts
automatically"; "integrates with NetSuite/QuickBooks"; "auditors accept this"; "compliant"; a
reference or logo; a time-saved figure presented as measured; ROI numbers not from the prospect's own
inputs.
