# Task 1: "Accounting firms are clearly winning" — reply + GTM experiment plan 2026-11-02

SETUP: live tools off, so Settings `PAUSE`, the PAUSE Gmail search and the Google account (hatch.sg check) were **not checked**. In a live run I'd check them first and stop if PAUSE = TRUE. Numbers below come from the fixture export (`t1_outreach_dashboard.md`), not the live Touches tab.

## BLUF
**I don't agree, on any of the three points.** C is 1 positive reply out of 22 first emails, not 13.6%. Two of C's 3 replies are out-of-office messages. **I can't make the Settings change.** That's your decision (D1), and I recommend keeping 50. Next week: send to A, B and C from the supply we have, measured on **positive** replies. Stop new D first emails because enterprise doesn't fit our motion, not because the data shows a "kill".

## Why the dashboard misleads
"Reply rate" counts any reply, including out-of-office messages and "not interested". The honest metric is **positive** replies (yes / more info), as defined in `prompts/RULES.md`.

| Seg | D0 sent | Any reply (dashboard) | **Positive** | Positive 95% CI (Wilson) | Notes |
|---|---|---|---|---|---|
| A | 38 | 4 | 2 | 1-17% | Both positives come from batch 6: 6 SMU-alumni founders, with your personal line added by hand. Cold A is **0 of 32** (CI 0-11%). "Fellow Mustang" is goodwill, a grade-D signal |
| B | 41 | 2 | 1 | 0-13% | Asked for a demo video |
| C | 22 | 3 | 1 | 1-22% | 2 of 3 replies are auto-replies. The one positive ("something I can show two clients") is a **partner** signal, not a buyer signal |
| D | 19 | 0 | 0 | 0-17% | Sent 28-30 Oct. The D4 follow-ups aren't due until 1 Nov, so it's too early |
| All | 120 | 9 | 4 | 1-8% | |

The minimum is 150 D0 sends per arm (`experiments-and-decision-rules.md` §2). Every segment is below it, the CIs overlap, and each segment was sent in a different week. **Verdict for every segment: INCONCLUSIVE.** No segment is "winning" and none can be killed.

## Your three asks
1. **100% of next week on C: no.** Only **17** unemailed C leads are left. "100% on C" would mean 17 sends all week, which starves the learning. C firms are also partners (P1), and a partner needs a different metric from a buyer (see EXP-2).
2. **Kill D: not as a data verdict** (0 of 19, CI 0-17%, follow-ups still pending). I do recommend no new D first emails, for a different reason. D is enterprise-ish (S5). Our motion says don't pursue enterprise proactively: no SOC 2, no SSO, NetSuite not built (`motions-and-partners.md` §1). D's D4 and D11 follow-ups keep running under the guard. I'm logging D as INCONCLUSIVE, deprioritised for motion reasons.
3. **FIRST_EMAIL_CAP 80: no, and the change isn't mine to make.** (a) It's a Settings change, which I may not edit. (b) 80 is more than CURRENT_SEND_CAP 75, and the guard sends min(caps) anyway. (c) **Supply is the limit, not the cap.** A 64 + B 51 + C 17 = 132 leads is about 2.6 days at 50/day. (d) A higher cap adds risk to your personal Gmail and brings us closer to the 1,000-in-30-days bulk line. A bigger cap doesn't teach us faster; more qualified leads per segment do.

## THIS WEEK (each experiment registered before its first send; each rule frozen at registration)
**EXP-20261102-1 Segment A vs B, cold buyers**
- Hypothesis: S1 (B) gets a higher positive-reply rate than S2 (A) on the standard D0.
- Variable: segment only. Control: the same D0 template and subject, highest-scoring first, guard-ALLOWed.
- Exclude warm, SMU or hand-personalised sends (they stay yours, by hand).
- Primary metric: positive replies / D0. Min n: **150 D0 per arm** (A has 32 cold sent + 64 queued, so it needs about 54 more leads from research-intern).
- Guardrails: bounce < 2%, 0 complaints, no guard override.
- Last D0 13 Nov; read-out 25 Nov (after D11).
- **SCALE** (more of the lead supply goes to that segment) if ≥ 7 of 150 positive (CI lower bound ≥ 2%) **and** ≥ 3 held calls with grade A-C pain.
- **KILL** if ≥ 150 sends, ≤ 1 positive and 0 Strong A-C calls.
- **ITERATE** if in between. **INCONCLUSIVE** if under 150 at the read-out (extend once to 4 Dec).
- Owners: revops sends, research-intern supplies leads. Cost ~0 founder-hours.

**EXP-20261102-2 C as a partner channel (P1)**
- Hypothesis: accounting firms reached by the cold D0 turn into partner conversations.
- Variable: segment C's metric only (send the 17 C leads + the next supply; same template).
- Primary metric: partner conversations at grade B or better.
- Rule (`motions-and-partners.md` §2.2): ≥ 5 B+ conversations in 30 days and ≥ 1 client referral → ITERATE/SCALE; 0 conversations after 15 sends → KILL for now; otherwise INCONCLUSIVE. End 2 Dec.
- Approval needed: your reply to the "two clients" lead is queued as a draft (pricing/partner topics are human-only).
- Cost ~1 founder-hour.

## DECISIONS
- **D1** Raise FIRST_EMAIL_CAP to 80? A keep 50 / B 80 (CURRENT_SEND_CAP would need to rise too, on personal Gmail) / **C keep as is (= A)**. **Recommend A.** Supply is 132 leads, so the cap doesn't bind. Risk of B: Gmail account health. Applies: you in Settings, if B.
- **D2** No new D first emails (motion fit, not a data verdict)? A yes / B keep sending D / C keep as is. **Recommend A.** Applies: revops (segment rotation).
- **D3** Ask research-intern for 60 more A and 60 more B leads by 6 Nov? A yes / B no. **Recommend A.** No rule impact.

## FLAGS
- Batch 6 mixed warm SMU contacts into cold A. That's two variables at once. Keep warm sends out of experiments.
- The dashboard metric counts out-of-office replies. Proposal to revops: show positive replies with their denominator.
- The fixture's 13 Oct sends predate the "outreach started 29 Oct" in the pack. Revops: please reconcile.

## WOULD WRITE (not done)
- Log: `experiment plan sent | started 2, decided 0 (S0/I0/K0/INC 4 segments), decisions above threshold 0/0, PENDING D1-D3`
- Log: `experiment registered | EXP-20261102-1 | <rule above>`; `experiment registered | EXP-20261102-2 | <rule above>`
- Log: `change request answered | FIRST_EMAIL_CAP 80 / 100% C / kill D | keep 50; split A/B/C; D deprioritised (motion); PENDING D1-D3`
- Decisions log: `PENDING: D1`, `PENDING: D2`, `PENDING: D3`
- No Settings edit.
