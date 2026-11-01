# How the best accounting-integration engineers work (benchmark)

**Source situation on 2026-11-01:** stripe.com, moderntreasury.com, developer.xero.com and developer.intuit.com
were **blocked**. Nothing here is from an opened page except where marked [VERIFIED]; the rest is
`[ASSUMPTION: secondary, search summary]`.

## Stripe, "Ledger: Stripe's system for tracking and validating money movement" (Ilya Ganelin, 16 Feb 2024)
URL: https://stripe.com/blog/ledger-stripe-system-for-tracking-and-validating-money-movement (blocked).
- An **immutable log of events**; double-entry so every movement is fully accounted for (credits = debits),
  which gives a mechanical proof of correctness; money movement modelled as balances moving between states;
  Ledger feeds a Data Quality platform claiming > 99.9999% explainability of money movement
  [ASSUMPTION: secondary, search summary of the post and fintechwrapup.com].
- What we take: (1) our audit log is append-only ✓; (2) every posted line must be explainable from a source
  event (tx hash + logIndex + rate source) ✓; (3) add **automated balance checks**: Xero wallet balance vs
  on-chain balance per wallet, daily, any difference = a finding (not built).

## Modern Treasury, "Accounting for Developers, Part I"
URL: https://www.moderntreasury.com/journal/accounting-for-developers-part-i (blocked).
- Debit-normal accounts (assets, expenses) vs credit-normal (liabilities, equity, revenue); a debit increases a
  debit-normal account and decreases a credit-normal one [ASSUMPTION: secondary, search summary of
  docs.moderntreasury.com "Debits and Credits" and a mirror of Part I].
- What we take: write every rule as balanced lines with account normality stated, so a non-engineer
  (Aashmiin, the customer's accountant) can check it.

## Xero / Intuit integration practice (from what was opened)
- Use the idempotency mechanism on every write (Xero `Idempotency-Key`, QBO `requestid`) [VERIFIED for Xero:
  Xero OpenAPI 19.1.0 opened 2026-11-01; QBO ASSUMPTION: secondary].
- Store tokens per connection in a secure datastore and refresh before calls [VERIFIED: xero-node README opened
  2026-11-01]; always use the newest refresh token [VERIFIED: intuit/oauth-jsclient README opened 2026-11-01].
- Keep client secrets in environment variables [VERIFIED: xero-node README "store them using a secure ENV
  variable strategy", opened 2026-11-01].

## Practices this employee follows (synthesis)
1. **Spec in accounting language first**, signed by the accountable person, then code. Posting rules are never
   auto-merged.
2. **Correct to the cent and the day**: exact decimal strings; explicit rounding direction per line; explicit
   timezone per date.
3. **Idempotent, replayable, read-back on ambiguity**: deterministic keys; unknown outcome = read back before
   retrying.
4. **Sandbox only** until sign-off: Xero Demo Company (guard on `IsDemoCompany`), QBO sandbox company.
5. **Reconcile, don't trust**: daily three-way check (on-chain balance, Clearline's posted lines, the books).
6. **Never change history silently**: corrections are new, approved entries; deletions are approval-only.
7. **Secrets never in logs**: redact `Authorization`, token bodies, `refresh_token`, client secret.
