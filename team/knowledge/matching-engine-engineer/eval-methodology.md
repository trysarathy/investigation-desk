# Evaluation methodology: how strong eval teams do it, and our rules

## Sources (opened or not)
| Source | Status | What we take from it |
|---|---|---|
| scikit-learn "Common pitfalls" (doc source on GitHub, `doc/common_pitfalls.rst`, sections "Data leakage", "How to avoid data leakage") | [VERIFIED: https://github.com/scikit-learn/scikit-learn/blob/main/doc/common_pitfalls.rst opened 2026-11-01 as raw text; scikit-learn.org itself blocked] | Quote: "A common cause is not keeping the test and train data subsets separate. Test data should never be used to make choices about the model." Also: leakage gives "overly optimistic performance estimates"; "Always split the data into train and test subsets first, particularly before any preprocessing steps." |
| scikit-learn model evaluation (precision/recall) | [VERIFIED: https://github.com/scikit-learn/scikit-learn/blob/main/doc/modules/model_evaluation.rst opened 2026-11-01] | precision = tp/(tp+fp), recall = tp/(tp+fn); threshold choice moves the precision-recall trade-off |
| statsmodels `proportion_confint` | [VERIFIED: https://raw.githubusercontent.com/statsmodels/statsmodels/main/statsmodels/stats/proportion.py opened 2026-11-01] | Wilson formula (lines 296-305); notes that Clopper-Pearson ("beta") "has coverage at least 1-alpha, but is in general conservative" |
| Geifman & El-Yaniv, "Selective Classification for Deep Neural Networks" (arXiv 1705.08500) | [VERIFIED: https://arxiv.org/abs/1705.08500 abstract opened 2026-11-01] | Reject option: let the user set a risk level and abstain as needed to meet it, trading coverage. Our version: fix FMR ≈ 0, accept the abstain rate that costs |
| Stripe, "Reconcile cash balance" (customer balance / bank transfers) | [VERIFIED: https://docs.stripe.com/payments/customer-balance/reconciliation opened 2026-11-01] | Stripe first matches a transfer reference to "a single invoice that has a matching invoice number", then a single PaymentIntent reference; only then searches for a group of 1-5 invoices "awaiting the exact amount", with tie-break rules; and offers a manual mode where "Stripe doesn't automatically apply any funds". Note: the funds are already tied to one customer by that customer's virtual bank account. **Our spec is deliberately stricter: amount alone never auto-links** (`docs/SPEC.md:17`). Don't copy Stripe's amount-combination step without Aashmiin's approval |
| Stripe payout reconciliation report | [VERIFIED: https://docs.stripe.com/reports/payout-reconciliation opened 2026-11-01] | Reconcile each bank payout to the batch of transactions it settles — match on the provider's identifiers, not amounts |
| Google "Rules of Machine Learning" | [ASSUMPTION: not opened, developers.google.com blocked 2026-11-01] | Commonly cited for "start with simple heuristics", "metrics first", and testing on data later in time than the training data. Do not quote it until opened |
| Modern Treasury reconciliation docs | [ASSUMPTION: not opened, host blocked 2026-11-01] | — |
| Tsuchiya et al., "Blockchain Address Poisoning" (arXiv 2501.16681) | [VERIFIED: https://arxiv.org/abs/2501.16681 page opened 2026-11-01 (title); figures copied from crypto-protocol-engineer: `[VERIFIED: crypto-protocol-engineer 2026-10-31, https://arxiv.org/abs/2501.16681]`] | see `lookalike-poisoning.md` |

## Our rules (derived from the above; these are ours, not quotes)
1. **Split first, at intake, by rule, before the product ever runs on a case.** Split assignment is
   deterministic and recorded in the case (`split: tuning|holdout`, `split_rule`, `split_at`); a case
   never moves.
2. **Group, then split.** Transfers from the same sender, the same invoice book or the same
   transaction go to the same side, or the held-out set leaks through near-duplicates.
3. **Stratify by case type.** Each of the seven case types must have cases on both sides; report every
   metric per case type with its own n. An overall number hides the case that matters (look-alike).
4. **Prefer time-ordered held-out**: held-out transfers are newer than every tuning transfer (the
   existing sets already do this), so the score predicts tomorrow, not yesterday.
5. **The held-out set never tunes anything.** No threshold, weight, rule, label or fixture is changed
   because of a held-out result. If a held-out failure reveals a bug: log it, fix it using a *new*
   tuning case that reproduces the bug, and retire that held-out case into tuning only after the next
   fresh held-out set exists. Report the held-out result from before the fix.
6. **Every look is logged** (date SGT, who, code SHA, why, result summary) in the look log in
   `docs/MATCHING_EVALS.md`. More than one look per change cycle = say so next to the number.
7. **Labels come from outside the product.** Never label a case with the product's own output. Labels
   come from chain facts read independently (explorer API, second RPC, issuer events) plus the invoice
   record. Unknowable cases are labelled `needs_person`, not guessed.
8. **Small n:** Wilson intervals; zero-event upper bounds; no decimals that the n can't support
   (n = 12 → whole percentages at most).
9. **Before/after on every change:** run the tuning set and (if the change is final) the held-out set
   once; publish both with n in `docs/MATCHING_EVALS.md`.
10. **Same task, same name:** "deposit diagnosis" and "invoice matching" are reported in separate
    tables.
