# rc6 plan — Merchant Reconciliation for stablecoin payment providers

**Base.** `rc5/docs-final` at `0a3dab0` (PR #125), merged with `rc5/adapter-conformance` at `e2f3577` (#120). The merge is commit `95383b6`. Nothing is merged into `main`. Every PR is a stacked draft.

**Status of the inputs.**
- The founder's prompt arrived. It fixes the product, the hard rules, the domain model, the five matching steps, and every figure of the three cases.
- Documents A–F did **not** arrive with the message, and no copy was found in Drive or Gmail. Consequences:
  - Journal entries are **derived** from the case figures and marked [ASSUMPTION] until they are checked against Document A.
  - `docs/LEGAL_QUESTIONS.md` stays a stub until Document C+D arrives.
  - Screen details follow the prompt, not Documents B, E or F.

## Phases and PRs (stacked in this order)

| # | Branch | Content | Depends on |
|---|---|---|---|
| 0 | `rc6/plan` | this plan; merge of #120 | — |
| 1 | `rc6/merchant-schema` | provider → merchant → entity tenancy (merchant = rc5 organisation, provider = organisation of kind `provider`); new tables; RLS; provider aggregate access only via a SECURITY DEFINER function, or full access by explicit grant; roles `provider_admin`, `provider_ops` | 0 |
| 2 | `rc6/match-core` | pure engine `src/lib/clearline/merchant/`: steps 1–4 (identity, reference, checks, explained tolerance); Case 1 fixtures and tests | 0 (pure) |
| 3 | `rc6/match-bridge` | step 5 grouping and the batch bridge; Case 2 | 2 |
| 4 | `rc6/match-partials` | partial payments across chains and links; Case 3 | 3 |
| 5 | `rc6/merchant-journals` | journal proposals from match results (all **pending sign-off**); clearing nets to zero | 4 |
| 6 | `rc6/merchant-ingest` | provider export, settlement report, chain (recorded fixtures; live mode off) and FX adapters; extended conformance | 5, 1 |
| 7 | `rc6/merchant-ui` | merchant screens 1–9 behind rc5 auth; white-label theme | 6 |
| 8 | `rc6/provider-console` | screens 10–12 | 7 |
| 9 | `rc6/cases-demo` | public `/clearline/cases` (no login), CSV and PDF downloads | 5 |
| 10 | `rc6/reconstruct` | local Case Reconstruction CLI plus a pilot screen | 6 |
| 11 | `rc6/docs` | docs and final test record | all |

**Parallel work.**
- Phase 1 (schema) runs alongside phases 2–5 (pure engine).
- Phase 9 can start as soon as phase 5 lands.
- Each parallel worktree gets its own test database.
- Every suite is run on the combined stack before each push.

## Engine decisions

1. **A new pure module, beside the rc5 payout engine.** rc6 does not change the meaning of any existing engine status. Inbound merchant payments are a different object from rc5's provider payouts.
2. **Money:** integer minor units in BigInt. Token amounts are base units with their decimals (USDT on TRON 6, USDC on Ethereum 6). Rates are exact decimal strings.
   - Fiat is computed as `round_half_even?`. To be confirmed. **[ASSUMPTION] half-up to the entity currency's minor unit**, which reproduces every figure in the prompt: 1,348.65; 2,376.00; 955.80; 1,341.00; 60.21; 418.62; 7,333.34; 12.86.
3. **Token identity:** by `(network, contract)` from `network_config`. Seeded contracts:
   - USDT TRON `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`;
   - USDC Ethereum `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.

   A symbol never identifies a token.
4. **Step order is fixed, and every result records its deciding step and rule ID:** identity → reference → checks → explained tolerance → grouping.
5. **Tolerance:** `band = min(pct × invoice, abs)`. The default is 0.5% and 5.00 in the entity currency, per the prompt [ASSUMPTION; editable].
   - **Conflict:** under this default, Case 3's band is AED 5.00, which is below its 14.16 gap. That gives `suggested_for_review`, not the expected `matched_with_difference`.
   - **Resolution:** the Case 3 entity's fixture policy is explicitly configured with an absolute cap of AED 100.00, so its band is 91.83. This is labelled [ASSUMPTION], and a test documents the outcome under the default.
   - **Founder decision:** "smaller" vs "larger", or a per-entity policy.
6. **Imported bank lines** (`source = csv_import`, even once confirmed) are labelled "imported, not bank-authenticated" and **cannot alone make settlement verified**. A merchant-policy flag, `allow_imported_bank_lines_as_verified`, defaults to off. This rc5 decision stays with the founder.

## Risks

- **Document A unavailable:** the journal patterns may differ from the founder's. They are derived, marked [ASSUMPTION], and to be reconciled.
- **Case 2 fixture:** it needs 33 + 2 individual fictional orders whose totals tie exactly. These are generated deterministically, with the totals asserted.
- **Scope:** 11 phases. If resources run out, the order above keeps a coherent milestone after phase 5 (engine plus cases) and after phase 7 (usable pilot).
- **Rounding rule and the Case 3 fee:** the prompt gives no fee for the Case 3 batches. The fixture uses fee 0 [ASSUMPTION].
