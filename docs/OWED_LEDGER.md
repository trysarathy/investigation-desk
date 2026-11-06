# Still-owed ledger: synthetic replay

[VERIFIED — `src/lib/advances/ledger.ts`, `scripts/owed-ledger.ts`] This command reads two CSV files and writes open advances and exceptions. It makes no bank calls, books entries or credit decisions. No dashboard is added.

Run from the repository root after `npm ci` (Node 20+):

```sh
npm run owed-ledger -- --synthetic-only fixtures/advances/payouts.csv fixtures/advances/bank.csv 2026-11-21T00:00:00Z /tmp/clearline-owed-demo
```

Choose a new output directory for each run. Outputs are `open-advances.csv` and `exceptions.csv`, readable in a spreadsheet or mapped into an ERP's import. This is **not** an ERP connector or a certified accounting subledger. Use only fictional data; the command's acknowledgement cannot detect private data supplied by an operator.

[VERIFIED — fixture and regression test] The sample leaves SYN-A owing SGD 35,532.50 and closes SYN-B. It reports three exceptions: importer paid but provider not fully repaid, overdue, partial repayment. The importer receiving SGD 135,532.50 does not repay the provider; only the separate SGD 100,000 receipt does.

## Input contract

Copy the exact headers from `fixtures/advances/`. Amounts are nonnegative decimal strings with up to two decimal places, limited to SGD and USD. Times must be valid UTC seconds (`...Z`). Inputs are UTF-8, comma-separated, RFC4180 quoting; row errors reject the complete run. Identical event IDs deduplicate; conflicting duplicates reject the run.

[ASSUMPTION — pilot mapping contract] Each payout row represents an **already drawn advance**, not an ordinary customer-funded payout. Principal and fee are contractual receivables in the same currency. `provider_account` is the verified receiving-account identifier from the provider's own mapping. A CSV alone cannot prove that account ownership, authorisation, credit terms, or supplier delivery. Resolve that mapping with the operator before any real pilot.

[ASSUMPTION — pilot mapping contract] Bank rows describe booked, incoming, non-reversed receipts only. `provider_repayment` requires an exact advance ID, provider receiving account and currency. `importer_receipt` is evidence that the importer received its own customer cash; it cannot reduce the advance. Unknown references, wrong accounts/currencies and excess amounts remain exceptions. This version does not handle reversals, interest accrual, FX conversion or allocation across multiple advances.

[VERIFIED — replay implementation] An event must have both occurred and become known by the explicit as-of time. Future evidence is excluded. Repayments before the advance are exceptions. Overpayments cannot make a receivable negative; excess remains unapplied. Outstanding = principal + contractual fee − applied repayments. This version reports the combined balance, without asserting a principal/fee allocation order. An advance is overdue strictly after its due timestamp.

Every output row is labelled SYNTHETIC ONLY, carries the as-of time and source line references; matched bank rows also include event IDs. Keep both source files with the exports: references are not cryptographic proof or independent bank verification. CSV formula prefixes are escaped. Validation completes before outputs are staged; both files publish through one directory rename. Existing populated exports are not overwritten.

## Check

```sh
npx vitest run tests/advances/ledger.test.ts
npx tsc --noEmit
npx vitest run
npx next build
```

[ASSUMPTION — next validation] Replay five redacted cases only after an agreed data-handling process and provider mapping. Compare every remaining balance and exception with the operator's sheet. No willingness to pay, time saved or accuracy on customer data is established by this synthetic fixture.
