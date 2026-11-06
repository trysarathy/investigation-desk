# What is owed after supplier payout

[VERIFIED — `funding/ledger.ts`] The ledger derives debt from actual imported payout evidence. An approval without a payout is a commitment, not money owed. It keeps paid principal, matched repayment, written-off principal and undisbursed commitments separate. Totals are per currency; SGD and USD are never added together. This milestone models principal only, without inferred fees, interest or FX conversion.

## Matching and exceptions

Reference matching comes first: advance ID or unique invoice reference. A blank customer is allowed only for a unique reference match. A nonblank conflicting customer, wrong currency or wrong provider account prevents allocation. With no reference, matching requires a known customer, the same account and currency, and one exact eligible outstanding amount. An unknown explicit reference never falls back to amount.

Only payouts that had happened and were known by the receipt's evidence time are eligible. One receipt can allocate to one advance only, capped to eligible principal. Excess remains held. A pre-payout receipt cannot settle future principal. Uncertain matches remain exceptions; manual reconciliation is not implemented here.

[VERIFIED — shared code] `advances/allocation.ts` extracts PR80's exact capped-allocation operation. Both the earlier PR80 replay and the new funding ledger use it; PR80's existing CSV exporter and tests remain in place.

Duplicate receipt IDs are recorded by the importer without adding another receipt. For different IDs, a matching account/currency/customer/reference/amount/effective-time fingerprint quarantines the later imported candidate. Payout fingerprints similarly use account/currency/transaction reference/amount/effective time. The first imported representative stays stable, even if a later ID sorts earlier. These are **possible duplicates**, not proof: two legitimate indistinguishable payments will need better source identifiers and review. No record is deleted.

The exceptions include overdue principal, partial repayment, unmatched or excess receipts, over-limit exposure, duplicate receipts, duplicate payouts and missing local approval evidence. Partial supplier delivery is explicit and never described as full supplier payment. If a drawn portion is repaid while a commitment remains, the row stays open as `drawn_repaid_commitment_open` rather than terminal `repaid`. A written-off drawn portion with a remaining commitment has its own open state.

## Write-offs and chronology

[VERIFIED — `review.ts`] Only a configured approver can record a positive write-off, with a reason, capped to current outstanding principal. It is not a repayment and does not add cash. Written-off exposure does not automatically restore a customer's limit.

Receipt allocation follows evidence availability. A receipt imported after a committed write-off cannot be moved before it by supplying older timestamps: the write-off's recorded import position is a barrier. Later receipts against written-off principal remain held for recovery review. Rebuilding a ledger must never subtract the same debt as both repayment and write-off.

[VERIFIED — compatibility] New workflow events carry policy version 3. Existing M2 decisions without that tag replay through frozen `review-v2.ts`, preserving their original check snapshots. New commands always use current policy; callers cannot select the legacy policy. Existing decisions are not silently reinterpreted as if later repayment rules had existed.

## Limits to take into a pilot

[ASSUMPTION — evidence contract] CSV rows assert supplier delivery and receipt into a provider-controlled account; Clearline does not verify these with a bank. The provider must supply complete records and stable transaction identifiers. Known times are source assertions. Replay should use the recorded input/event prefix, not silently mix a later export into an earlier decision.

[VERIFIED — conservative controls] Matched repayment restores credit headroom, but never usable cash without a fresh balance. Approved residual commitments remain reserved after partial payouts. No funding instruction, bank connection, automatic credit decision, accounting entry, UI or alert delivery is included in M3.
