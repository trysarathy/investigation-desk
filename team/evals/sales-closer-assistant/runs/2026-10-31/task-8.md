# Task 8: Mock-call debrief, Sat 7 Nov 2026

WOULD SAVE as a private Doc `Clearline mock call Web3 games studio 2026-11-07` (her Drive) + Log. Persona "Lena Koh" is FICTIONAL, played by crypto-finance-user (live for this mock, per the transcript header). No real prospect data used.

## Top line for Aashmiin (risks first)
**In a real call, 6 lines in this mock would have been over-claims or unapproved promises**: automatic Xero posting, "a few companies already using it", wallet watching, a Tron date, a free first month, and a start date. Each one is either untrue today or a decision only you can make, and each has a true line below. The security answer and most of the audit-trail answer were good. Main habit to change: ask the 7 script questions (Q5 word for word) before saying anything about the product.

## Scores (1-5, with evidence)
| Dimension | Score | Evidence |
|---|---|---|
| Honest opening (CALL_SCRIPT) | 1 | Opened with a pitch: "I'm building Clearline: it matches every stablecoin payment … and posts to Xero automatically." [31 words]. No "I'm a student at SMU… only here to learn… OK if I take notes?" |
| SPIN mix / discovery | 1 | 2 questions in 14 minutes, both closed: "Do you use Xero?" (S), "And do payments arrive wrong sometimes?" (P). 0 Implication, 0 Need-payoff. Lena asked 5 questions; you asked 2 |
| Q5 verbatim | 1 | Not asked. Closest: "Do you use Xero?" |
| Talk share | 1 | You: 154 of 204 words = **75%**; Lena 25% (word counts from the recording tool). Reference only: Gong vendor research suggests winners listen more (43:57 in 2016; ~60:40 average in 2025) [ASSUMPTION: secondary, vendor research via search snippets] |
| Claim discipline | 1 | 6 over-claims/promises (table below) |
| Price/terms authority | 1 | "Normally US$300 for the pilot, but for you I could do it for free for the first month." (unapproved discount; contradicts the paid offer; repeats the website error, CLAIMS_AUDIT #1-2) |
| Objection handling | 3 | Security answer accurate ("We never need wallet keys … read-only on-chain and never touches funds"); auditor answer mostly true but missing caveats; Tron answer promised a date instead of exploring |
| MEDDPICC uncovered | 2 | Learned: Xero (Decision Criteria, partly), Tron (fit), auditors want per-receipt evidence (Decision Criteria), no wallet keys (security criterion). Not learned: volume, cost of wrong payments, Economic Buyer, Decision/Paper Process, Champion, Competition |
| Next step | 1 | "I'll send a proposal tonight and we can start Monday." Proposed a proposal without a scored-Strong problem (only "Sometimes. Short ones mostly.") and a start date that's yours to set and not ready (HARD_QUESTIONS #8). Lena's "Send me something" isn't pilot interest |
**Average ≈ 1.3 / 5.** It's a practice run, and every point here can be fixed.

## Every over-claim, with the true wording
| # | You said (verbatim) | Why it's wrong (clearline-truth.md / audits) | Say instead |
|---|---|---|---|
| 1 | "it matches every stablecoin payment to its invoice, explains wrong ones and posts to Xero automatically" | Never-say: "posts to Xero automatically". Posting happens only once a person approves; Xero is built, never run on a real Xero org. "Every payment" is matched only once the transfer is recorded (by hand; CLAIMS_AUDIT #4-5) | "I'm a student at SMU, and I'm also building a small tool called Clearline. Today I'm only here to learn how you handle stablecoin payments. Is it OK if I take notes?" If asked what it does: "It checks each stablecoin payment, matches it to its invoice once the transfer is recorded, explains wrong ones in plain English, and, once you approve, posts it to your books. Xero first, QuickBooks next." |
| 2 | "We have a few companies already using it and they save hours every week." | **0 customers.** An invented customer claim and an invented outcome (COMPANY_RULES 2) | "It's a working demo. We don't have customers yet; I'm looking for the first 10 businesses to pilot it." |
| 3 | "It also watches your wallet so you never paste a hash." | **No address watching**: a person pastes the hash (HARD_QUESTIONS #4) | "Not today. Someone gives it the transaction hash; address watching isn't built yet. In a pilot, we record transfers from hashes for you." |
| 4 | "Tron support should be ready by mid-December, so by the time you'd start it'll be there." | **Date promise** on a roadmap item; Tron payment pages are roadmap with **no date**. Only you can approve a date, and there isn't one | "I can check a reported Tron transfer today, but invoice payment pages are Ethereum-only. Tron is on the roadmap, and I don't have a date. What share of your payments are on Tron?" |
| 5 | "Normally US$300 for the pilot, but for you I could do it for free for the first month." | **Unapproved discount** and contradicts the paid offer; "normally" signals the price is negotiable | "The founding pilot is US$300 for 30 days, then US$200/month, for the first 10 businesses. It's the same for everyone." (Only once the problem has scored Strong.) |
| 6 | "Perfect, I'll send a proposal tonight and we can start Monday." | **Start-date promise**; real Xero connection "not yet" (HARD_QUESTIONS #8); no Strong score, so no proposal yet (P3) | "Thank you. Before anything else, could I ask a few more questions about how payments reach your books? Then, if it's useful, I'd like to show you a 5-minute demo." |
| (7) | "Every posting has an audit log with the hash, token, network and who approved it." | Mostly true (CLAIMS_AUDIT #10, #23), but it misses two caveats: never run against a real Xero org, and the log isn't tamper-evident | Add: "…It's built and tested, but it hasn't run on a real Xero organisation yet, and the log isn't tamper-evident yet. What do your auditors ask for per receipt today?" |
| (8) | "Great, that's exactly what we fix." | A pitch line in place of a question. Not false, but it skips Q3-Q4 | "Tell me about the last one that arrived short. What happened next?" |

**Good, keep:** "We never need wallet keys. Clearline is read-only on-chain and never touches funds." That's true and correctly worded ("wallet keys", CLAIMS_AUDIT #13). Next time add the gaps if asked about security: no individual sign-in, tokens stored as plain JSON, no SOC 2, solo operator.

## 3 to keep, 3 to change
**Keep:** (1) the "wallet keys" wording; (2) answering the auditor question with specifics (hash, token, network, approver); (3) short turns when answering questions.
**Change:** (1) open with the honest identity and permission to take notes, no pitch; (2) ask all 7 script questions with Q5 word for word, open ("walk me through…", "tell me about…"), and stop talking; (3) when asked for a date, a feature or a discount: "I don't know / not today; I'll follow up in writing", or "that's my decision to make, and I'll come back to you". Never improvise a date or a free month.

## Corrected answers to use next time (Lena's questions)
- **"What do you need from me?"** → "Nothing to buy. I'd like to learn how stablecoin payments reach your books. Walk me through the last one you received, from invoice to 'paid'."
- **"Does it do Tron?"** → as #4 above, then: "What share are on Tron?"
- **"What does it cost?"** → only if the problem sounds Strong: the founding offer as #5. Otherwise: "I'd rather understand whether it's even useful to you first. Can I ask how long a short payment takes to sort out?"
- **"How do you handle our auditors?"** → as (7), then ask what they asked last year.
- **"And security?"** → your answer, plus the gaps if pressed; "if your policy requires SOC 2 before any vendor touches finance data, we're not ready for you yet."
- **"Send me something."** → "Happy to. I'll send a short written summary of what I heard and what Clearline can and can't do today. Who else should I talk to about this?"

## Persona brief for the next mock (for crypto-finance-user; FICTIONAL)
- **Role:** "Arun Pillai" (FICTIONAL), Head of Finance Operations at a 35-person Singapore OTC trading desk.
- **Setup:** ~150 incoming USDT payments/month, ~70% Tron / 30% Ethereum, a few USDC; NetSuite for books, an external accountant at month end; a compliance officer (MLRO) who reviews unusual receipts.
- **Pains (intensity):** (1) unreferenced payments matched by amount, 2-3 hours a day for an analyst (high); (2) month-end tie-out for the accountant, 3 days (high); (3) occasional wrong-network deposits on BNB Chain (medium, rare but costly).
- **Objections to raise:** (pricing) "US$200 a month for a solo founder's tool? Prove it pays back"; (security) "Our compliance team needs SOC 2 and named user logins before anything sees our finance data"; (build) "Our two developers could script Tronscan checks in a week."
- **Trap:** ask "Can you have NetSuite working by end of December if we sign this week? A discount would help me get it approved."
  *(True answers: NetSuite designed, not built; no date; price is the founding offer; SOC 2/sign-in not available, "we're not ready for you yet".)*
- **Instructions:** stay sceptical; don't volunteer volumes, pains or the accounting process unless asked an open question; answer closed questions in one or two words; reward Q5 asked verbatim with a detailed answer; end with "Who else do you talk to?" only if she asks for referrals.
- **Debrief will score:** SPIN mix, open vs closed, talk share, Q5 verbatim, MEDDPICC fields uncovered, next step, every over-claim.

## Log (WOULD APPEND)
| timestamp SGT | agent | action | ids | details |
|---|---|---|---|---|
| 2026-11-07 [time] | sales-closer-assistant | run start | - | PAUSE=FALSE |
| 2026-11-07 [time] | sales-closer-assistant | mock debrief | mock-2026-11-07 | Doc [link] `Clearline mock call Web3 games studio 2026-11-07`; avg 1.3/5; 6 over-claims/promises caught + 2 partial; talk share 75%; Q5 not asked. Persona by crypto-finance-user (live) |
| 2026-11-07 [time] | sales-closer-assistant | persona brief | - | Next mock: FICTIONAL OTC desk, NetSuite, SOC 2 + date/discount trap, for crypto-finance-user |
| 2026-11-07 [time] | sales-closer-assistant | hand-off | - | gtm-strategist: opening and price lines drifted from CALL_SCRIPT/offer in practice; "free first month" mirrors the outdated website claim (CLAIMS_AUDIT #1-2): website fix still pending? |
