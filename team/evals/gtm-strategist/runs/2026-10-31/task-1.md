# Task 1 — GTM experiment plan 2026-11-02 (PROPOSED, for chief-of-staff's 08:44 Monday plan)

SETUP: Settings PAUSE = FALSE (`fixtures/common_settings.csv`). The live PAUSE Gmail search and the hatch.sg check were not run (tools are off for this test). Data: `fixtures/t1/*` only.

---

**WOULD WRITE (Log row + input to chief-of-staff):**

## GTM experiment plan 2026-11-02
**BLUF:** Nothing can be decided yet. EXP-1 and EXP-3 ended below their minimum n, so both are INCONCLUSIVE and each is extended once. Bounce is 6/255 (2.4%), above the 2% guardrail. No new channel test this week: 3 of 3 middle-ring slots are in use. I'm registering 2 non-channel experiments. Held calls are 5 of the 20-call goal, with 18 days left.

### LAST WEEK DECIDED
| ID | Rule (as registered) | n | Result | Verdict |
|---|---|---|---|---|
| EXP-20261028-1 S1 vs S3 | min 150 D0/arm; SCALE S1 if S1 CI-low > S3 CI-high | S1 120, S3 95 (both < 150) | S1 4/120 (CI 1-8%); S3 1/95 (CI 0-6%); CIs overlap | **INCONCLUSIVE**: extend once to 2026-11-15, as registered. Needs +30 S1 and +55 S3 D0 |
| EXP-20261028-3 partner drafts | min 15 sent; KILL if 0 replies after 15 | 10 sent (< 15) | 1 reply, 1 positive (1/10, CI 2-40%); not yet a graded conversation | **INCONCLUSIVE**: extend once to 2026-11-15, same rule. Needs 5 more drafts she approves |
| EXP-20261028-2 LinkedIn | ends 2026-11-18 | — | not past end date | running |

### SEGMENT / CHANNEL BOARD (week = cumulative)
| | D0 | Positive (CI) | Held | Strong with A-C evidence | Volume/mo |
|---|---|---|---|---|---|
| S1 email | 120 | 4 (1-8%) | 3 | 2/3 (21-94%): Nodewell B, Gridlane C | 60, 35, 8 |
| S2 email | 40 | 1 (0-13%) | 1 | **0/1**: the tab says Strong, but the notes are D-only. Regraded | 6 |
| S3 email | 95 | 1 (0-6%) | 1 | 0/1 (gateway) | 400 |
| P1 partner | 10 | 1 (2-40%) | 0 | — | — |
| LinkedIn S1 | 40 notes | 14 accepted (22-50%); 2 conversations (1-17%) | 0 known | — | — |
Offers 0, paid 0. Q5 answers: Xero 2, QuickBooks 1, spreadsheet 1, gateway 1. Every segment: n too small.

### THIS WEEK (registered; rules frozen at registration)
1. **EXP-20261102-1 Founding-offer acceptance (H1)**: Hypothesis: a paid pilot at US$300 gets ≥ 2 of 5 acceptances from Strong S1 calls with ≥ 25 receipts/month. Variable: none on price. List-price offers only, made after a demo on their own data. Primary metric: paid / offered (Opportunities). Min n: 5 offers. End: 2026-11-30. Rule: SCALE if ≥ 2 of 5 paid. KILL-review if 0 of 5 paid and ≥ 3 cite price. Otherwise INCONCLUSIVE. Guardrails: no discount offered, no over-promise. Cost: about 1 h per demo. Approval: she approves each offer (rule 6).
2. **EXP-20261102-2 Beachhead H-B1 (S1)**: The rule is `icp-and-segments.md` §4, frozen as written. Confirm only if all hold: ≥ 8 held S1 calls, ≥ 50% Strong (A-C), ≥ 3 wrong-payment stories, ≥ 1 paid. Kill if ≥ 8 held and ≤ 2 Strong. End: 2026-11-30. Cost: 0 extra hours.

### DECISIONS
- **D1** Should we make founding offers to Strong S1 calls (EXP-20261102-1)? A: yes, after a demo on their own data. B: wait until 20 calls. C: keep as is (no offers). I recommend A, because 0 offers means questions 4 and 5 can't be answered. Risk: demand stays unmeasured until offers go out. Applies: ae-assistant drafts, she approves each one.
- **D2** Should we extend EXP-3 with 5 more partner drafts? A: approve 5 drafts this week. B: stop at INCONCLUSIVE. C: keep as is. I recommend A, because 10 is below the minimum of 15. Applies: revops-crm-agent drafts, she sends.
- **D3** Should we fix the website's "Free during the pilot" (CLAIMS_AUDIT row 1, FALSE)? A: use the audit's replacement line. B: "pricing on request". C: keep as is. I recommend A before any offer goes out. Applies: lead-designer/content.

### FLAGS
- Bounce is 6/255 (2.4%) overall and 3/95 in S3. That is below the 3% throttle but above the 2% guardrail. revops should check email verification.
- Brightloom's grade mismatch (tab says Strong, notes are D-only) goes to sales-closer-assistant.
- Data gaps: Calls has no source channel, so I can't attribute calls to EXP-2. LinkedIn founder hours aren't logged, so EXP-2's kill rule can't be computed.
- 1 unsubscribe → Do-not-contact the same day.
- The criteria for the SPEC 20 Nov kill date are not in the repo. I'll ask chief-of-staff.

---

**WOULD WRITE — Log rows (Log tab, append):**
```
2026-11-02 07:47 | gtm-strategist | experiment decided | EXP-20261028-1 | INCONCLUSIVE: S1 120 / S3 95 D0 < min 150/arm; S1 4/120 (CI 1-8%), S3 1/95 (CI 0-6%); extended once to 2026-11-15 per registered rule
2026-11-02 07:47 | gtm-strategist | experiment decided | EXP-20261028-3 | INCONCLUSIVE: 10 sent < min 15; 1 positive reply (1/10, CI 2-40%); extended once to 2026-11-15, rule unchanged
2026-11-02 07:47 | gtm-strategist | experiment registered | EXP-20261102-1 | H1 offer acceptance, S1 Strong, >=25 receipts/mo, list price; min 5 offers; end 2026-11-30; SCALE >=2/5 paid; KILL-review 0/5 paid with >=3 citing price; else INCONCLUSIVE; starts only after D1 yes
2026-11-02 07:47 | gtm-strategist | experiment registered | EXP-20261102-2 | Beachhead H-B1 (S1); rule = icp-and-segments.md §4 verbatim; end 2026-11-30
2026-11-02 07:47 | gtm-strategist | experiment plan sent | started 2, decided 2 (S0/I0/K0/INC2), decisions above threshold 0/0, PENDING D1-D3
2026-11-02 07:47 | gtm-strategist | flag | — | bounce 6/255 (2.4%) > 2% guardrail; S3 3/95; Brightloom grade D mismatch → sales-closer-assistant; Calls lacks source channel
```
**WOULD WRITE — Decisions log:** `PENDING: D1 founding offers to Strong S1 (EXP-20261102-1)`, `PENDING: D2 5 more partner drafts (EXP-20261028-3)`, `PENDING: D3 website free-pilot claims fix`.
