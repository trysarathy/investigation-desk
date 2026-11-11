# Clearline — guided demo-day funding case

**Proposed route:** /mentor-demo/guided

**Status:** fictional browser-only demonstration on a separate, unmerged branch. The existing /mentor-demo work queue remains available. No bank API, transfer, escrow, blockchain, production approval, real customer record, or persistent audit storage is present. Refresh resets the local simulation.

## Demo narrative (approximately 4–5 minutes)

1. **The funding gap:** Redwood Wholesale proposes a SGD 100,000 advance to pay Harbor Machinery; initial owed is SGD 0 because no supplier payout has been recorded yet.
2. **Five checks:** show uniqueness of invoice, customer exposure/credit limit, earlier overdue advances, agreed terms, and free cash. Free cash = SGD 490,000 balance − SGD 130,000 provider-classified safeguarded − SGD 45,000 pending − SGD 65,000 buffer = SGD 250,000. Classification is a provider input; Clearline does not decide the legal status of funds.
3. **Named treasury decision:** Maya (operator) clicks Prepare. Switch simulated role to Daniel (Treasury). Enter or keep a decision reason and approve. Viewer and operator roles cannot approve. This is a role *simulation*, not real authentication.
4. **Record supplier payout:** switch simulated role back to Maya. Record evidence of the supplier payout, replayed at 10 November 2026. The customer now owes SGD 100,000. Clearline never transfers the money.
5. **Partial repayment:** record SGD 40,000 received on 14 November against the invoice. The receivable falls to SGD 60,000.
6. **Deadline:** the due date remains 17 November 2026, even though a partial receipt was recorded.
7. **Exception:** advance replay to 19 November. The outstanding SGD 60,000 is overdue; see the exception card.
8. **Evidence:** inspect the chronological case history with named actors, dates and evidence details; download fictional JSON and show SHA-256 digest. A digest checks bytes, not permission or independent audit.

**Design principles:** allow the mentor to reason about each step. Every action has an explicit actor; no automatic approval; payout and repayment are separate events; both the work queue and guided route remain available; simulation disclosure is sticky.

## Before presenting

- Open the new Vercel branch preview when (and only when) its deployment reports ready. Do **not** assume the existing production URL includes this route.
- Open /mentor-demo/guided on HTTPS, then test from Step 1 to Step 8 with simulated role changes.
- Download evidence only from HTTPS (the browser Web Crypto SHA-256 API needs a secure context).
- Test 1280 px and a phone width. Don't claim cross-browser/a11y acceptance unless measured.
- Keep /mentor-demo as a fallback if the new preview is delayed or fails.
- Never describe this as a working custody, escrow or blockchain system; its intended product is operational control.

## Engineering checks

Run:
npx vitest run tests/funding/mentor-demo.test.ts tests/funding/guided-advance.test.ts
npx tsc --noEmit
npx next build

The branch CI results—not this file—are the source of truth for whether checks actually pass. No merge, deployment to production, or customer communication is authorized by this document.
