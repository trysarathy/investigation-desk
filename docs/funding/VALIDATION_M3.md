# M3 validation

[VERIFIED — final command results] Local TypeScript compiler `tsc --noEmit` exited 0. Vitest exited 0: 657 passed, 57 skipped; 25 passing test files and one skipped file. `next build` exited 0. The focused funding/legacy-ledger run passed 85 tests, including all 19 existing PR80 replay tests and 22 new M3 cases.

[VERIFIED — regression coverage] Cases cover customerless unique references, unknown references, wrong account/currency/customer, ambiguous amount candidates, excess funds, pre-payout receipts, receipt and payout duplicate candidates, duplicate ID imports, first-import allocation identity, partial supplier delivery, remaining commitments, per-currency totals, write-off authorization and caps, backdated late imports after a write-off, historical visibility, matched repayment versus cash and preserved M2 decision snapshots.

[VERIFIED — reconciliation controls] The projection refuses negative outstanding principal, multiple allocations of one receipt, or any row where paid principal differs from repaid plus written off plus outstanding. Whole-store canonical validation continues to check source bytes, mappings and versioned event history.

[VERIFIED — scope limits] These are synthetic cases. There is no customer data, external payment or accounting write, manual exception-resolution interface or production sign-in in M3. The 57 existing real-record tests remain skipped. Earlier reviewer findings about chronology, duplicate identity and partial-disbursement wording were addressed before this final run; no browser screenshot is claimed.
