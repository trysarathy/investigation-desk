# Advance review and named decisions

[VERIFIED — `review.ts` and `store.ts`] M2 supplies a pure review function and a local transactional service. It adds no HTTP endpoint. An operator prepares one advance; a different configured approver records approve or decline with a reason. Approval reruns all five checks while holding the store's writer lease and refuses a stale expected revision. A passing check is evidence for a person, never an automatic credit decision.

## Checks and conservative accounting

- Invoice: required; NFKC/case/space-normalized reference must be unique for that customer in supplied non-declined proposals and committed cases. An actual payout blocks funding the same advance again.
- Limit: includes approved commitments and actual imported payouts even without local approval. Approval plus payout counts once, with excess payout amounts counted conservatively. Unmatched receipts do not reduce exposure in M2.
- Overdue: earlier due committed advances block approval. A receipt is not repayment until a later matching milestone records it.
- Terms: customer terms must be present and customer status active.
- Cash: requires a complete four-bucket, consistent account/currency snapshot known at review time, at most 24 hours old. Gross balance minus safeguarded portions, pending payouts and buffer gives classified free cash. Subtract remaining locally approved commitments and actual payouts at or after the snapshot. A partial payout leaves its undisbursed portion reserved. Undrawn facilities never count as cash.

[ASSUMPTION — pilot policy] The 24-hour freshness rule is a configurable policy candidate, not a regulatory rule. Provider classifications require confirmation with counsel. Pending payout portions may already include a local reservation: M2 still deducts it, so overlap can cause a false refusal rather than a false pass. The check's reason states this conservatism. A provider-specific reconciliation contract is required before reducing this deduction. Account balances are provider assertions, not bank-verified data.

## Evidence and replay boundary

[VERIFIED — canonical validation] Imported files retain their original mapping and bytes. Each workflow event records its position in the import history, timestamp, base revision, actor, action and full check snapshot. Stored decisions derive from those events. Load/write rebuild the imports and events in order and compare the result; service updates cannot change history prefixes. Checksums do not protect against someone replacing the entire deployment file and all history.

[VERIFIED — historical query guard] A direct review against a store containing later workflow events is rejected. Historical replay must construct the earlier event/import prefix first. This prevents later approval/decline state from leaking into an earlier review. M8 will expose the historical replay entry point. Historical CSV known times remain provider assertions.

[VERIFIED — M1 compatibility] An M1 store without an events field can migrate only if users and decisions are empty and every advance is proposed; the entire imported state is then validated against its retained CSVs. This does not accept a missing history for already decided cases.

## Security boundary

[VERIFIED — implementation limitation] User initialization is a trusted local deployment operation, allowed once before workflow actions. It is not sign-in, identity verification or production authorization. No HTTP routes expose this service. M7 must authenticate users and bind actor IDs server-side; a browser must never supply its own role or roster. Roles are operator, approver and viewer; an operator cannot decide, and a viewer cannot prepare or decide.

[VERIFIED — deferred work] Repayment matching, write-offs, accounting exports and a customer-facing UI remain outside M2. Approval is an internal record and does not send an instruction or move money.

[ASSUMPTION — operational limit] The supplied payout date is a planned date, not a verified bank cutoff or capacity reservation. M2 does not promise beneficiary delivery by that time. A provider must supply its actual route and cutoff rules before treating this as a release decision.
