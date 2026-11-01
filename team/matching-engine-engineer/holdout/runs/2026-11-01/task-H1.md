# H1. Held-out scorecard by case: matcher v0.10, matching held-out set v1, threshold 0.90

Run by matching-engine-engineer, 2026-11-01 SGT. Input: `fixtures/h1-heldout-results.csv` (EXAM
FIXTURE, fictional invoices) and `fixtures/h1-README.md`. **No new held-out run was made**: I scored the
stored results file. Reading a held-out result is still a look, so it is logged (section 5).
Counts and intervals [VERIFIED: computed 2026-11-01, python script over the CSV, Wilson 95% with
z = 1.959964 as in statsmodels `proportion_confint(method="wilson")`; zero-event exact one-sided 95%
upper = 1 − 0.05^(1/n)].

## 1. The table I would publish in `docs/MATCHING_EVALS.md`

**Invoice matching, held-out set v1 (frozen 2026-10-28), matcher v0.10, auto-match at confidence ≥ 0.90.
Scored rows: the 108 `human_verified` rows. The 12 `engine_v0.9_autolabel` rows are left out (section 2).
Code sha: not recorded in the results file. It has to be added before this row counts as final.
Sample invoices (fictional), so: "real transfers, sample invoices" only if the transfers are real.**

Definitions are the README's: precision = correct ÷ auto-matches; recall = correct ÷ transfers whose
`true_invoice ≠ NONE`; FMR (README) = false matches ÷ **all** transfers in the group (n); abstain =
`review` ÷ n. Clearline's own FMR in `metrics.md` uses a different denominator (false matches ÷
auto-matches), so I show it in its own column with a different name. The two must never be quoted
as the same number.

| Case type | n | Auto-matches | Correct | False | Review | No-match | Precision [95% Wilson] | Recall | FMR, README (FM ÷ n) [95% Wilson] | FM ÷ auto-matches (metrics.md FMR) [95% Wilson] | Abstain (review ÷ n) [95% Wilson] |
|---|---|---|---|---|---|---|---|---|---|---|---|
| exact | 40 | 36 | 35 | 1 | 3 | 1 | 35/36 = 97.2% [85.8-99.5%] | 35/40 = 87.5% | 1/40 = 2.5% [0.4-12.9%] | 1/36 = 2.8% [0.5-14.2%] | 3/40 = 7.5% [2.6-19.9%] |
| partial | 18 | 9 | 9 | 0 | 9 | 0 | 9/9 = 100% [70.1-100%] | 9/18 = 50.0% | 0/18 = 0% [0-17.6%]; 0-event upper 15.3% | 0/9 = 0% [0-29.9%] | 9/18 = 50.0% [29.0-71.0%] |
| overpayment | 12 | 8 | 7 | 1 | 4 | 0 | 7/8 = 87.5% [52.9-97.8%] | 7/12 = 58.3% | 1/12 = 8.3% [1.5-35.4%] | 1/8 = 12.5% [2.2-47.1%] | 4/12 = 33.3% [13.8-60.9%] |
| multiple invoices | 10 | 5 | 2 | **3** | 5 | 0 | 2/5 = 40.0% [11.8-76.9%] | 2/10 = 20.0% | **3/10 = 30.0% [10.8-60.3%]** | 3/5 = 60.0% [23.1-88.2%] | 5/10 = 50.0% [23.7-76.3%] |
| wrong token | 14 | 0 | 0 | 0 | 3 | 11 | — (0 auto-matches) | — (no matchable rows) | 0/14 = 0% [0-21.5%]; 0-event upper 19.3% | — | 3/14 = 21.4% [7.6-47.6%] |
| wrong network | 8 | 1 | 0 | **1** | 5 | 2 | 0/1 = 0% [0-79.3%] | — (no matchable rows) | **1/8 = 12.5% [2.2-47.1%]** | 1/1 [20.7-100%] | 5/8 = 62.5% [30.6-86.3%] |
| look-alike address | 6 | 0 | 0 | 0 | 2 | 4 | — (0 auto-matches) | — (no matchable rows) | 0/6 = 0% [0-39.0%]; 0-event upper 39.3% | — | 2/6 = 33.3% [9.7-70.0%] |
| **Overall** | **108** | **59** | **53** | **6** | **31** | **18** | **53/59 = 89.8% [79.5-95.3%]** | **53/80 = 66.3%** | **6/108 = 5.6% [2.6-11.6%]** | **6/59 = 10.2% [4.7-20.5%]** | **31/108 = 28.7% [21.0-37.9%]** |

Notes that ship with the table:
- **6 false matches in 59 auto-matches.** That is an incident-level result. The target is 0.
- **The README's definitions count some auto-matches as "correct" that Clearline's spec does not allow.**
  `docs/SPEC.md` "Matching" says anything ambiguous goes to review, and `metrics.md` counts an
  auto-match on a case labelled "needs a person" as an unauthorised match (FM). Under that stricter
  reading, all 9 partial auto-matches, the 7 correct overpayment auto-matches and the 2 correct
  multiple-invoice auto-matches are unauthorised too. That gives **24 of 59 auto-matches the system was
  not allowed to make (40.7% [29.1-53.4%])**, and only 35/59 (59.3% [46.6-70.9%]) were allowed and
  right. Each of those 9 partial auto-matches marks a short invoice as paid.
- Small n everywhere. No case-type row reaches the playbook's minimum for a stable figure. The
  look-alike row (n = 6) is consistent with a true false-match rate up to 39%, and wrong network (n = 8)
  up to 47%. "0 false matches" on wrong token and look-alike means 0 of 14 and 0 of 6, not "safe".
- The `no_match` column is shown separately. For wrong-token and look-alike rows it is the correct
  outcome (refusing to match). The README's abstain rate counts `review` only.
- Precision and FMR here are for this held-out set and threshold only. They are not "matching accuracy"
  and they are not deposit diagnosis. They must not be combined with the tuning set (n = 400).
- No auto-match had confidence below 0.90, and no review or no-match had confidence of 0.90 or more.
  The file is consistent with the stated threshold [VERIFIED: computed 2026-11-01].

## 2. Which rows I counted and why

**Counted: the 108 rows with `label_source = human_verified`.** Two people labelled each one from the
block explorer and the invoice record, a third settled disagreements, and the labels were made before
the engine ran (README, labelling log 2026-10-27/28). These are labels independent of the product.

**Excluded: the 12 rows with `label_source = engine_v0.9_autolabel`** (HO-022, 025, 034, 038, 062, 089,
091, 097, 101, 104, 110, 117: 8 exact, 4 partial). They are out for three separate reasons:
1. **Labelled from product output.** The script copied engine v0.9's chosen invoice into
   `true_invoice`, and no person checked it. Scoring v0.10 against v0.9's answers measures how much
   the two engine versions agree, not whether either one is right. It is circular, and our rules
   forbid it (eval rule 7, playbook §1.3.1).
2. **Added after the freeze.** The set froze on 2026-10-28 and these rows were added 2026-10-29, "to
   top up". A frozen held-out set that gains rows is no longer the set that was frozen.
3. **They inflate the result.** All 12 agree with the engine by construction. With them included,
   precision would read 65/71 = 91.5% and recall 65/92 = 70.7%, which flatters v0.10 for no real
   reason.

What happens to them: they are quarantined, not deleted (no deletion of data). They are re-labelled
by two people from the explorer and the invoice record. Because they arrived after the v1 freeze,
they go to the tuning set or the next held-out version by the §1.4 split rule, never back into v1. I
would put a `RISK:` Log row on the top-up script, which wrote product output into a held-out label
column.

No row moved between splits. No label was edited.

## 3. Where the matcher is unsafe today, and what I would change next

**Unsafe, in order of harm:**
1. **Multiple invoices: 3 false matches in 5 auto-matches (FMR 3/10, n = 10).** HO-036, HO-070 and
   HO-109 each had one transfer paying two invoices, and the engine linked it to only one, at
   confidence 0.90-0.93. The other two auto-matches (both invoices linked) were right, but under our
   spec no multiple-invoice case may auto-match at all. The expected abstain rate on this row is
   100%. Today it is 50%.
2. **Wrong network: a payment that can't pay any invoice was matched** (HO-037, confidence 0.92,
   `true_invoice = NONE`). This was a flag-worthy transfer counted as payment, so the books would show
   revenue that did not arrive on the invoice's network.
3. **Exact and overpayment: wrong invoice, high confidence** (HO-053 matched to INV-1518 instead of
   INV-1018, at 0.94; HO-114 matched to INV-1565 instead of INV-1065, at 0.93). Both wrong invoice IDs
   differ from the true one by one digit. That suggests fuzzy matching on the invoice reference
   [ASSUMPTION: inferred from the IDs only, root cause not yet read in code]. This would book revenue
   to the wrong customer.
4. **Partial and overpayment are auto-matched at all** (9 of 18 partial, 8 of 12 overpayment). Even
   when the invoice is right, the system is deciding something only a person may decide: accepting a
   short payment, or keeping or refunding an excess.
5. **The confidence score does not separate right from wrong.** Every false match scored 0.90-0.94,
   inside the range of correct matches (0.91-0.99). No threshold between 0.90 and 0.95 removes them
   without also removing correct exact matches, so a threshold change is the wrong tool. The fix
   has to be hard rules applied before the score.

**What I would change (stricter only; normal review, never auto-merge without both reviews):**
- Gate A, network and token before score: a transfer whose chain or token contract isn't the
  invoice's goes to `flag` and can never reach scoring.
- Gate B, ambiguity: if two or more open invoices could own the transfer, or the transfer amount
  equals the sum of two or more open invoices, the result is `review`, whatever the score. This is
  the `attribute()` "≥ 2 open → ambiguous" rule (`src/lib/requests/lifecycle.ts:143-146`, main
  0c7d9f1 [VERIFIED: opened 2026-11-01]) applied to v0.10.
- Gate C, amount: auto-match only when confirmed genuine transfers equal the invoice amount exactly,
  as exact decimals. Short or over goes to `review` (as `deriveRequest()` does today, `review:
  "short"` / `"over"`).
- Gate D, reference: an invoice reference links only on an exact string match. A near-match (one
  digit off) may rank a candidate but never links. A near-miss on the reference counts against an
  automatic link, not for it.

**How I would test it (tuning side only):**
1. Write new tuning cases that reproduce each pattern, built from real transfers with sample invoices
   and two labellers: one transfer paying two invoices; the right token on another network; an
   invoice ID one digit off at the right amount; a short and an over payment on a single open invoice.
   I would never copy, inspect for tuning, or edit the held-out rows.
2. Failing tests first (e.g. `M-MULTI-0xx` expects `review` and fails today).
3. Run the tuning harness before and after, per case type. Acceptance: 0 auto-matches on multiple
   invoices, wrong network, wrong token and look-alike; 0 on partial and overpayment; no new false
   match anywhere on tuning; and the drop in exact recall stated with its n.
4. Then one logged held-out look as the final check. The held-out v1 number published is this one
   (the result before the fix), not a re-scored one. Because HO-036/037/053/070/109/114 have now been
   examined as failures, I would also say next to any future v1 figure that v1 has been looked at
   twice, and plan a fresh held-out v2 for the release decision.
5. Update `docs/MATCHING_EVALS.md` in the same PR (before/after, n, Wilson), and log an incident entry
   (playbook §5) for the 6 held-out false matches: case type, root cause, fix PR.

Hand-offs: crypto-protocol-engineer for the wrong-network gate; code-reviewer and qa-security-engineer
for the PR.

## 4. Log rows I would write (Company HQ Log; not written, live tools off)
- `2026-11-01 SGT | matching-engine-engineer | held-out look | matching held-out v1 | scored stored v0.10 results (no new run); 108 human-verified rows; 12 autolabel rows excluded`
- `... | RISK: 6 false matches in 59 auto-matches on matching held-out v1 (v0.10, thr 0.90): multiple_invoices 3, wrong_network 1, exact 1, overpayment 1. Do not enable auto-match on v0.10.`
- `... | RISK: 12 held-out rows labelled by copying engine v0.9 output, added after the 2026-10-28 freeze; quarantined from metrics`
- Summary: `task: H1; PR: none; FMR held-out 6/59 auto-matches (n=108, 95% Wilson 4.7-20.5%); abstain 31/108; recall exact 35/40; held-out looks: 1 (read of stored results); blocked: code sha missing from results file`

## 5. Look-log row (for `docs/MATCHING_EVALS.md` §5 and `tests/matching/HOLDOUT_LOOKS.md`)
| When (SGT) | Who | Set | Code sha | Reason | Result |
|---|---|---|---|---|---|
| 2026-11-01 | matching-engine-engineer | matching held-out v1 (n = 120 rows; 108 scored) | v0.10, sha not recorded | publish held-out scorecard (report); stored results read, no re-run, nothing tuned | 6 FM / 59 auto-matches; abstain 31/108; 12 autolabel rows excluded |
