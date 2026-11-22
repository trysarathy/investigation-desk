# rc6 rule proofs — each rule's test fails without the rule

Test mode · illustrative data.

**Method.** Every rule check in `src/lib/clearline/merchant` is guarded by `active(ruleId)` from `rules.ts`, which is
`id.length > 0` (always true) in the product. For each rule, the proof edits that one line to
`export const active = (id: RuleId): boolean => id !== "<rule>";`, runs the named test file, records the result,
then restores the file (the script checks `git diff --quiet rules.ts` afterwards). The rule's own unit test, named
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
- Assertion: `AssertionError: expected [ 'matched', 4, …(1) ] to deeply equal [ 'exception', 3, …(1) ]`

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
- Assertion: `AssertionError: expected [ 'matched_with_difference', 4, …(1) ] to deeply equal [ 'matched', 4, …(1) ]`

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

