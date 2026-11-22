# rc6 rule proofs — each rule's test fails without the rule

Test mode · illustrative data.

**Method.** Every rule check in `src/lib/clearline/merchant` is guarded by `active(ruleId)` from `rules.ts`, which is
`id.length > 0` (always true) in the product. For each rule, the proof edits that one line to
`export const active = (id: RuleId): boolean => id !== "<rule>";`, runs the named test file, records the result,
then restores the file (the script checks that the original `active` line is back). The rule's own unit test, named
`[<rule>] …`, must be among the failures. Assertions are vitest's first failing message, cut at 220 characters.

A `TypeError` result means that, without the rule, the engine cannot carry on (it reaches data the rule protects);
the test still fails, so no match is ever produced in that state.

## Phase 2: steps 1–4 (`tests/clearline/merchant/rules-steps1-4.test.ts`)

### `M1.identity.network_disabled`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M1.identity.network_disabled"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M1.identity.network_disabled] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 1, …(1) ]`

### `M1.identity.unknown_token`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M1.identity.unknown_token"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M1.identity.unknown_token] 
- Assertion: `TypeError: Cannot read properties of undefined (reading 'symbol')`

### `M1.identity.lookalike_token`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M1.identity.lookalike_token"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M1.identity.lookalike_token] 
- Assertion: `AssertionError: expected [ 'exception', 1, …(1) ] to deeply equal [ 'exception', 1, …(1) ]`

### `M1.finality.pending`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M1.finality.pending"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M1.finality.pending] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'suggested_for_review', 1, …(1) ]`

### `M2.reference.unattributed`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M2.reference.unattributed"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M2.reference.unattributed] 
- Assertion: `AssertionError: expected [] to deeply equal [ [ …(2) ] ]`

### `M2.reference.no_chain_transfer`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M2.reference.no_chain_transfer"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M2.reference.no_chain_transfer] 
- Assertion: `TypeError: Cannot read properties of undefined (reading 's')`

### `M2.reference.provider_ref_mismatch`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M2.reference.provider_ref_mismatch"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M2.reference.provider_ref_mismatch] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 2, …(1) ]`

### `M3.currency.invoice_currency`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.currency.invoice_currency"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.currency.invoice_currency] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.currency.token_mismatch`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.currency.token_mismatch"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.currency.token_mismatch] 
- Assertion: `AssertionError: expected [ 'exception', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.direction.outbound`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.direction.outbound"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.direction.outbound] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.window.before_quote`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.window.before_quote"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.window.before_quote] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.window.after_expiry_no_requote`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.window.after_expiry_no_requote"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.window.after_expiry_no_requote] 
- Assertion: `AssertionError: expected [ 'matched', 5, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.quote.invoice_mismatch`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.quote.invoice_mismatch"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.quote.invoice_mismatch] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.provider.no_record`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.provider.no_record"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.provider.no_record] 
- Assertion: `TypeError: Cannot read properties of undefined (reading 'executedRate')`

### `M3.provider.received_mismatch`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.provider.received_mismatch"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.provider.received_mismatch] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.batch.unknown_batch`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.batch.unknown_batch"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.batch.unknown_batch] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

### `M3.batch.held_by_provider`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M3.batch.held_by_provider"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M3.batch.held_by_provider] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', …(3) ] to deeply equal [ 'exception', …(3) ]`

### `M4.provider.credit_mismatch`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.provider.credit_mismatch"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.provider.credit_mismatch] 
- Assertion: `AssertionError: expected [ [ 'sender_side_fee', …(2) ], …(1) ] to deep equally contain [ 'unexplained', …(2) ]`

### `M4.tolerance.sender_side_fee`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.sender_side_fee"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.tolerance.sender_side_fee] 
- Assertion: `AssertionError: expected [ 'underpayment' ] to deeply equal [ 'sender_side_fee' ]`

### `M4.tolerance.requote_after_expiry`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.requote_after_expiry"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.tolerance.requote_after_expiry] 
- Assertion: `AssertionError: expected [ [ 'rate_difference', -900n ] ] to deeply equal [ [ 'requote_after_expiry', -900n ] ]`

### `M4.tolerance.rate_difference`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.rate_difference"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.tolerance.rate_difference] 
- Assertion: `AssertionError: expected [ [ 'unexplained', -100n ] ] to deeply equal [ [ 'rate_difference', -100n ] ]`

### `M4.tolerance.underpayment`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.underpayment"`
- Result: Tests  3 failed | 28 passed (31)
- Failing: [M4.tolerance.sender_side_fee] [M4.tolerance.underpayment] [M4.tolerance.underpayment_beyond_band] 
- Assertion: `AssertionError: expected [ 'unexplained' ] to deeply equal [ 'underpayment' ]`

### `M4.tolerance.overpayment`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.overpayment"`
- Result: Tests  2 failed | 29 passed (31)
- Failing: [M4.tolerance.overpayment] [M4.tolerance.overpayment_beyond_band] 
- Assertion: `AssertionError: expected [ 'unexplained' ] to deeply equal [ 'overpayment' ]`

### `M4.match.no_difference`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.match.no_difference"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.match.no_difference] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'matched', 5, …(1) ]`

### `M4.tolerance.within_band`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.within_band"`
- Result: Tests  3 failed | 28 passed (31)
- Failing: [M4.tolerance.rate_difference] [M4.tolerance.within_band] [M4.tolerance.writeoff_threshold] 
- Assertion: `AssertionError: expected 'suggested_for_review' to be 'matched_with_difference' // Object.is equality`

### `M4.tolerance.writeoff_threshold`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.writeoff_threshold"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.tolerance.writeoff_threshold] 
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'suggested_for_review', 4, …(1) ]`

### `M4.tolerance.explained_outside_band`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.explained_outside_band"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.tolerance.explained_outside_band] 
- Assertion: `AssertionError: expected [ 'exception', 4, …(1) ] to deeply equal [ 'suggested_for_review', 4, …(1) ]`

### `M4.tolerance.underpayment_beyond_band`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.underpayment_beyond_band"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.tolerance.underpayment_beyond_band] 
- Assertion: `AssertionError: expected [ 'suggested_for_review', 4, …(1) ] to deeply equal [ 'exception', 4, …(1) ]`

### `M4.tolerance.overpayment_beyond_band`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.overpayment_beyond_band"`
- Result: Tests  1 failed | 30 passed (31)
- Failing: [M4.tolerance.overpayment_beyond_band] 
- Assertion: `AssertionError: expected [ 'suggested_for_review', 4, …(1) ] to deeply equal [ 'exception', 4, …(1) ]`

### `M4.tolerance.unexplained`

- Command: `npx vitest run tests/clearline/merchant/rules-steps1-4.test.ts` with `active = (id) => id !== "M4.tolerance.unexplained"`
- Result: Tests  2 failed | 29 passed (31)
- Failing: [M4.provider.credit_mismatch] [M4.tolerance.unexplained] 
- Assertion: `AssertionError: expected 'matched_with_difference' to be 'exception' // Object.is equality`

## Phase 3: step 5, grouping and bridge (`tests/clearline/merchant/rules-step5.test.ts`)

### `M5.bridge.timing_prior_batch`

- Command: `npx vitest run tests/clearline/merchant/rules-step5.test.ts` with `active = (id) => id !== "M5.bridge.timing_prior_batch"`
- Result: Tests  4 failed | 4 passed (8)
- Failing: [M5.batch.tied_verified] [M5.bridge.held_by_provider] [M5.bridge.timing_next_batch] [M5.bridge.timing_prior_batch] 
- Assertion: `TypeError: Cannot read properties of undefined (reading 'amountMinor')`

### `M5.bridge.timing_next_batch`

- Command: `npx vitest run tests/clearline/merchant/rules-step5.test.ts` with `active = (id) => id !== "M5.bridge.timing_next_batch"`
- Result: Tests  4 failed | 4 passed (8)
- Failing: [M5.batch.tied_verified] [M5.bridge.held_by_provider] [M5.bridge.timing_next_batch] [M5.bridge.timing_prior_batch] 
- Assertion: `AssertionError: expected false to be true // Object.is equality`

### `M5.bridge.held_by_provider`

- Command: `npx vitest run tests/clearline/merchant/rules-step5.test.ts` with `active = (id) => id !== "M5.bridge.held_by_provider"`
- Result: Tests  4 failed | 4 passed (8)
- Failing: [M5.batch.tied_verified] [M5.bridge.held_by_provider] [M5.bridge.timing_next_batch] [M5.bridge.timing_prior_batch] 
- Assertion: `AssertionError: expected false to be true // Object.is equality`

### `M5.batch.not_tied`

- Command: `npx vitest run tests/clearline/merchant/rules-step5.test.ts` with `active = (id) => id !== "M5.batch.not_tied"`
- Result: Tests  1 failed | 7 passed (8)
- Failing: [M5.batch.not_tied] 
- Assertion: `AssertionError: expected [ 'suggested_for_review', 5, …(2) ] to deeply equal [ 'exception', 5, …(2) ]`

### `M5.bank.imported_not_verified`

- Command: `npx vitest run tests/clearline/merchant/rules-step5.test.ts` with `active = (id) => id !== "M5.bank.imported_not_verified"`
- Result: Tests  1 failed | 7 passed (8)
- Failing: [M5.bank.imported_not_verified] 
- Assertion: `AssertionError: expected { …(15) } to match object { tied: true, …(2) }`

### `M5.grouping.proposed_needs_confirmation`

- Command: `npx vitest run tests/clearline/merchant/rules-step5.test.ts` with `active = (id) => id !== "M5.grouping.proposed_needs_confirmation"`
- Result: Tests  1 failed | 7 passed (8)
- Failing: [M5.grouping.proposed_needs_confirmation] 
- Assertion: `AssertionError: expected [] to deeply equal [ 'proposed_needs_confirmation' ]`

### `M5.batch.tied_verified`

- Command: `npx vitest run tests/clearline/merchant/rules-step5.test.ts` with `active = (id) => id !== "M5.batch.tied_verified"`
- Result: Tests  1 failed | 7 passed (8)
- Failing: [M5.batch.tied_verified] 
- Assertion: `AssertionError: expected [ 'matched', 4, …(1) ] to deeply equal [ 'matched', 5, …(1) ]`

## Phase 4: partials and multi-chain (`tests/clearline/merchant/rules-partials.test.ts`)

### `M4.partial.balance_link_open`

- Command: `npx vitest run tests/clearline/merchant/rules-partials.test.ts` with `active = (id) => id !== "M4.partial.balance_link_open"`
- Result: Tests  2 failed | 3 passed (5)
- Failing: USDT sent to the USDC balance-link address on another network never attaches to the order [M4.partial.balance_link_open] 
- Assertion: `AssertionError: expected [ [ 'underpayment', …(2) ], …(1) ] to deeply equal [ [ 'partial_payment_open', …(2) ] ]`

## Phase 5: journal proposals (`tests/clearline/merchant/journal.test.ts`)

### `J.confirmation.chain_evidenced`

- Command: `npx vitest run tests/clearline/merchant/journal.test.ts` with `active = (id) => id !== "J.confirmation.chain_evidenced"`
- Result: Tests  1 failed | 23 passed (24)
- Failing: [J.confirmation.chain_evidenced] 
- Assertion: `AssertionError: expected true to be false // Object.is equality`

### `J.confirmation.overpayment_liability`

- Command: `npx vitest run tests/clearline/merchant/journal.test.ts` with `active = (id) => id !== "J.confirmation.overpayment_liability"`
- Result: Tests  2 failed | 22 passed (24)
- Failing: AR: BK-24823 still has 324.00 open; BK-24817 closes only with the approved write-off; BK-24836 keeps 9.00 open for review [J.confirmation.overpayment_liability] 
- Assertion: `AssertionError: expected [ [ 'debit', …(2) ], …(1) ] to deeply equal [ [ 'debit', …(2) ], …(2) ]`

### `J.writeoff.on_approval`

- Command: `npx vitest run tests/clearline/merchant/journal.test.ts` with `active = (id) => id !== "J.writeoff.on_approval"`
- Result: Tests  3 failed | 21 passed (24)
- Failing: AR: BK-24823 still has 324.00 open; BK-24817 closes only with the approved write-off; BK-24836 keeps 9.00 open for review [J.writeoff.on_approval] two confirmations (11,017.50 and 7,333.34), then the 14.16 write-off split 12.86 shortfall / 1.30 rate difference 
- Assertion: `TypeError: Cannot read properties of undefined (reading 'lines')`

### `J.settlement.verified_batch`

- Command: `npx vitest run tests/clearline/merchant/journal.test.ts` with `active = (id) => id !== "J.settlement.verified_batch"`
- Result: Tests  1 failed | 23 passed (24)
- Failing: [J.settlement.verified_batch] 
- Assertion: `AssertionError: expected true to be false // Object.is equality`

