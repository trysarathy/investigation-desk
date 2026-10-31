# Metric definitions (use these words exactly)

## The task being measured
**Invoice matching:** input = one observed transfer + the business's open invoices (requests) and
history. Output = one of: `auto_match(invoice)` (system links it without a person), `review(candidates)`
(abstain: a person decides), `no_match` (unidentified; may carry suggestions), `flag(problem)` (it can't
pay any invoice: wrong network/token, counterfeit, failed). Label = what a careful person with full
information decides: the true invoice (or none), and the **expected action** under the spec (an exact
identifier allows auto-match; anything ambiguous must go to a person, `docs/SPEC.md:17`).

Deposit **diagnosis** (D-codes) is a different task. Never put the two in one number.

## Confusion table for a matcher that can abstain
| | label: auto-matchable to X | label: needs a person / none / flag |
|---|---|---|
| system auto-matches to X (the true invoice) | **TP** | **FM** (unauthorised: the system decided what only a person may, e.g. marked an overpaid invoice paid) |
| system auto-matches to Y ≠ X | **FM** (false match) | **FM** (false match) |
| system abstains (review / no_match) | **miss** (cheap: a person does it) | **TN-abstain** (correct) |
| system flags correctly | — | correct flag |

## Definitions
- **False-match rate (FMR)** = wrong auto-matches ÷ all auto-matches (= 1 − auto-match precision).
  Always also give the raw count `k wrong of m auto-matches`, and **n of the set**. Target 0.
- **False matches per case** = wrong auto-matches ÷ all cases in the set (n). Report beside FMR.
- **Auto-match precision** = TP ÷ all auto-matches. (scikit-learn: precision = tp / (tp + fp), "the
  ability of the classifier not to label as positive a sample that is negative"
  [VERIFIED: https://github.com/scikit-learn/scikit-learn/blob/main/doc/modules/model_evaluation.rst opened 2026-11-01, raw file lines 938-1062].)
- **Recall on exact cases** = TP ÷ cases labelled `exact` (auto-matchable). (recall = tp / (tp + fn),
  same source.) Low recall costs a person's minute; it is the metric we trade away first.
- **Abstain rate** = cases sent to a person (review + no_match with candidates) ÷ all cases, also per
  case type. Not a failure metric by itself: on `multiple invoices` and `look-alike` the right abstain
  rate is 100%.
- **Coverage** = 1 − abstain rate; **selective risk** = FMR at that coverage. Selective classification
  ("reject option") trades coverage for lower risk at a set risk level
  [VERIFIED: https://arxiv.org/abs/1705.08500 abstract opened 2026-11-01].
- **Flag accuracy** (wrong token / wrong network / counterfeit / failed) = correct flags ÷ cases with that
  label.

## Small-n reporting
- **Never a number without n**, e.g. "0 false matches in 31 auto-matches (n = 60 cases)".
- Give a **95% Wilson score interval** for every proportion when n < 1000. Formula, as implemented in
  statsmodels `proportion_confint(method="wilson")`: with z = 1.96, p̂ = k/n,
  centre = (p̂ + z²/2n) / (1 + z²/n), half-width = z·√(p̂(1−p̂)/n + z²/4n²) / (1 + z²/n)
  [VERIFIED: https://raw.githubusercontent.com/statsmodels/statsmodels/main/statsmodels/stats/proportion.py opened 2026-11-01, lines 296-305;
  the original Wilson 1927 paper was not opened]. Wilson is not Wald: never p̂ ± 1.96·√(p̂(1−p̂)/n),
  which gives a zero-width interval at 0/n or n/n.
- **Zero events:** 0 false matches in m auto-matches does not mean the rate is 0. Exact one-sided 95%
  upper bound = 1 − 0.05^(1/m) (≈ 3/m, the "rule of three" [ASSUMPTION: textbook rule, source not opened];
  the exact formula is computed here).

Worked numbers [VERIFIED: computed 2026-11-01, python, z = 1.959964]:
| k / n | Wilson 95% | exact one-sided 95% upper (0 events) |
|---|---|---|
| 52/52 | 93.1%-100% | — |
| 57/57 | 93.7%-100% | — |
| 0/52 | 0%-6.9% | 5.6% |
| 0/12 | 0%-24.2% | 22.1% |
| 12/12 | 75.8%-100% | — |
| 11/12 | 64.6%-98.5% | — |
| 0/24 | 0%-13.8% | 11.7% |

So "99% accurate" on 12/12 is false precision: the data are consistent with 76%. To claim an FMR upper
bound under 1% at 95% with zero errors you need about 300 auto-matches (1 − 0.05^(1/300) ≈ 0.99%).

## Words that are banned in our reports
"accuracy" for anything that isn't the stated task; "100%" or "zero false matches" without n and the
interval; "on real data" when the invoices are fictional (say "real transfers, sample invoices"); a
combined tuned + held-out number ("111/111").
