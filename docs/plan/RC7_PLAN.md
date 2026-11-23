# rc7 plan: from demo to working software (real data, any provider)

Stacked on `rc6/docs` (#138). Nothing is merged. Each phase is one or more draft PRs of about 400 lines where possible. PAUSE is checked before each push.

## Founder decisions applied (from the rc7 prompt)

| # | Decision | How rc7 applies it |
|---|---|---|
| 1 | Tolerance per entity: the **larger** of 0.5% or a fixed amount, SGD 5 / USD 5 / AED 20 | `merchant_policy.tolerance_combine = 'larger'` with per-currency defaults. The write-off threshold defaults to the same fixed amount [ASSUMPTION]. Case 3 is `matched_with_difference` |
| 2 | Imported bank statements stay "imported, not bank-authenticated"; the flag stays OFF | Unchanged from rc6. MT940 and camt.053 uploads are imports too |
| 3 | Providers invite Viewers only | Unchanged (migration 0014) |
| 4 | Hosting | **Not filled in the prompt ("[choose one]"), so treated as (a): no paid hosting.** Everything runs locally with real files. Phase 4 is a written proposal only |
| 5 | Live chain data on free tiers; keys in `.env.local` set by the founder | TronGrid and Ethereum JSON-RPC readers, gated by `CLEARLINE_CHAIN_LIVE=1`. CI uses recordings only. `npm run chain:smoke` is manual |
| 6 | Retention: 90 days by default, configurable per merchant | Upload files and derived data are deleted on schedule, with a test that nothing remains |
| 7 | Close #112 and #113 with a pointer to their replacements | Done in Phase 0 |

## Phases

| Phase | PRs | Content |
|---|---|---|
| 0 | `rc7/plan`, `rc7/doc-a-tolerance` | This plan; legal questions from Document C+D; the `merchant-e2e` CI job; tolerance decision; journals reconciled with Document A, including Case 3 fees of 1% |
| 1 | parse → bank formats → mapping → uploads → normalise → upload UI → ledger import → synthetic data | Upload any CSV, XLSX or JSON export; CSV, XLSX, MT940 or camt.053 statements; column mapping with reusable templates; validation report; provenance; two-person confirmation |
| 2 | chain readers → chain integration | TronGrid and Ethereum readers; "chain data unavailable" never matches; evidence on every fact |
| 3 | runs and jobs → rule versions → setup → notifications → exports → admin and deletion → benchmark | Software operations |
| 4 | — | Proposal only (decision 4 not given) |
| 5 | blind test | A format the code has never seen, 2,000 payments, through the UI |
| docs | `rc7/docs` | Architecture, threat model, supported formats, test results, runbook |

## Engine boundary
- **The engine stays unchanged:** it is pure and deterministic (`src/lib/clearline/merchant/`). Everything new feeds it the same `ReconcileInput`.
- **Nothing keys on the case fixtures:** the code never depends on the cases' IDs, amounts or layout. The three cases remain acceptance tests.
