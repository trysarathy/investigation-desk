# Financial invariants (rc5)

**The rules themselves are unchanged.** rc5 does not change any financial rule. The engine (`src/lib/clearline/**`) is untouched. Its invariant table with file:function and tests is `docs/clearline/ARCHITECTURE.md` §4 and §4b, and its 1,820 tests still pass.

**What rc5 adds** is proof that the rules hold through the **persisted, authenticated** path, and that the browser can no longer forge the inputs.

| # | Rule | Where it is enforced | Proof through the persisted path (rc5) |
|---|---|---|---|
| 1 | A provider "completed" is a claim, not settlement proof | engine `state.ts`, `derive.ts`; provider events stay `provider_claim` | Redwood test: provider `payout.completed` is recorded, settlement is never `verified` |
| 2 | Execution, settlement and reconciliation are separate | engine `StatusDimensions`; three separate DB columns | `payment_intents` columns; Redwood test asserts each |
| 3 | A returned payout never shows the supplier as paid | engine `investigation.ts:returnPosition` (`beneficiaryPaid: false`) | Redwood: debit 12,784.90 / return credit 12,784.90 / net 0.00 / unpaid — **still unpaid after the approved resolution** |
| 4 | An amount alone never matches | engine `reconciliation.ts` (amount-only → `RC_AMOUNT_ONLY_CANDIDATES`) | rc5/csv-import: imported amount-only line does not allocate |
| 5 | Unrelated receipts never settle obligations | engine §4 row 6 | engine tests; rc5/accounting-persist: no entry for the unrelated receipt |
| 6 | Accounting entries need independent evidence and balance | engine `accounting/derive.ts` | rc5/accounting-persist: balanced per currency (BigInt) from persisted rows; evidence ids exist in the same org |
| 7 | Proposed ≠ posted; exported ≠ accepted by a ledger | engine `record_posting` | rc5/accounting-persist |
| 8 | Maker ≠ checker | engine (accounting) + **approval_requests / decision trigger** (resolutions) | preparer refused (service, matrix, and DB trigger on direct insert); concurrent approvers → one decision |
| 9 | Conclusions cite evidence and a rule | `approval_requests.payload.evidenceRefs` (must exist in this org) + engine resolve guard | `EVIDENCE_NOT_FOUND`, `RETURN_NOT_ADDRESSED` tests |
| 10 | Late, duplicate or contradictory events never corrupt state | engine `events.ts`, Connect | rc5/adapter-conformance suite |
| 11 | Evidence cannot be forged through browser state | the pilot never accepts a workspace from the client; evidence enters only through engine actions run by the server for an authorised user, CSV import (provenance `csv_import`), or the fictional seed | API accepts only listed actions; rows are written only by the server |
| 12 | Corrections are traceable; nothing is deleted | `saveWorkspaceDiff` refuses deletions and audit shrinkage; append-only triggers | schema test: UPDATE/DELETE/TRUNCATE on audit refused even for the owner |
| 13 | Exact money | integer minor units; `bigint` columns with `≥ 0` checks | schema test: negative amount refused |
| 14 | Pending policy is not assumed approved | stablecoin posting rules carry `pendingSignOff` (rc5/accounting-persist) | — |

## Known limitation (founder decision): a confirmed imported statement is treated as bank evidence by the engine

The engine treats a bank statement line as independent evidence. A CSV import is a person's upload, not an authenticated bank feed. rc5 mitigates this in five ways:
- **Two people:** an upload is only *staged*; it becomes evidence only when a **different** person with the Approver role reviews the staged lines and confirms their SHA-256. The database refuses a self-confirmation or a confirmation by a non-approver.
- **Role separation:** only **Finance** may import, while Payment Ops investigates and an Approver decides.
- **Provenance:** every imported line is stored with `provenance = 'csv_import'` and its file's SHA-256, and is labelled as imported.
- **Matching:** matching still needs exact references.
- **Traceability:** every import is audited.

What remains is that a Finance user and an Approver acting together could import a fabricated line that carries the right reference. Removing that risk needs an authenticated bank feed (founder decision, real bank) or a second-person check on imports (a policy decision). See `RELEASE_READINESS_RC5.md`.
