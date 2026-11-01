# Knowledge pack: matching-engine-engineer

Last refreshed: **2026-11-01 SGT** · Refresh owner: matching-engine-engineer (monthly with the golden-task
re-run, and in the same PR as any change that makes a file untrue). Built by reading the code on
`origin/main` **0c7d9f1** (read-only checkout), the repo's labelled real-data files and results, running
`npx vitest run` on that checkout, and opening the external sources named in each file.

Labels (company rule 2): **[VERIFIED: <url or file> opened 2026-11-01]** = I opened the primary source
(the code file, the dataset, the official docs) while writing; **[VERIFIED: computed 2026-11-01]** = a
number I computed this run from the named data; **[ASSUMPTION]** = reasonable, not checked;
**[ASSUMPTION: secondary, <source>]** = only a secondary source; **[GUESS]** = estimate. When you reuse a
fact from this pack, copy its label with who opened it and when, e.g.
`[VERIFIED: matching-engine-engineer 2026-11-01, src/lib/requests/lifecycle.ts:118]`. Never
`[VERIFIED per pack]`.

| File | Use it for |
|---|---|
| `matching-code-today.md` | Every place matching or a "confidence" is decided today, with file:line: deposit engine (High/Medium/D99), payment-request attribution and the auto-mark rule, three-way payments matching, the two hand-made scores (`similarity`, `suggestMatches`). What auto-links and what never does. Read before touching any of it. |
| `datasets.md` | What labelled real data exists (`tests/real_cases.json` n=59, `tests/real_cases_holdout.json` n=52), how it was collected and labelled, how the split was made, what "52 of 52" actually measured, and why it is **not** an invoice-matching number. |
| `metrics.md` | Exact definitions: false-match rate, auto-match precision, recall on exact cases, abstain rate, coverage; the confusion table for a selective (abstaining) matcher; Wilson interval and zero-event bounds with worked numbers; the "never a number without n" rules. |
| `eval-methodology.md` | Leakage, held-out discipline and the look log, stratification by case, grouping by sender/invoice book, small-n reporting, risk-coverage thinking, benchmark sources (scikit-learn, statsmodels, selective classification, Stripe reconciliation) with labels. |
| `case-taxonomy.md` | The seven matching cases (exact, partial, overpayment, multiple invoices, wrong token, wrong network, look-alike address) plus the extra ones the code handles, each mapped to the D-catalogue code, the request `review`/`ProblemKind`, the expected action, and whether real labelled data exists. |
| `lookalike-poisoning.md` | Look-alike address and poisoning patterns as they affect matching; the **three different look-alike rules** in spec and code; what the request path does not check. |

## Could not open on 2026-11-01 (session network allowlist)
`developers.google.com` (Google "Rules of ML"), `scikit-learn.org` (read the same page from the
scikit-learn GitHub source instead), `en.wikipedia.org`, `docs.moderntreasury.com`,
`moderntreasury.com`, `martin.zinkevich.org`. Nothing from these is stated as fact in this pack; where a
practice is commonly attributed to them it is labelled [ASSUMPTION: not opened]. First job when access
allows: open Rules of ML and a Modern Treasury reconciliation page and relabel.

## Refresh checklist
1. `git log <last-sha>..origin/main -- src/lib/engine src/lib/requests src/lib/payments src/lib/catalogue.ts src/lib/address.ts`:
   update `matching-code-today.md` line numbers and behaviour.
2. Re-run `npx vitest run` on a clean checkout; update the counts in `datasets.md` and `docs/MATCHING_EVALS.md`.
3. Re-count the datasets (cases, categories, splits); check no case moved between splits.
4. Re-try the blocked hosts above.
