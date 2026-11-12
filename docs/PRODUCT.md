# Clearline product and prototype boundaries

## Positioning
Clearline is a proposed neutral intelligence and control layer for cross-border money movement. It tracks instructions, evidence, exceptions and operating decisions across partner payment rails. Clearline itself must not be presented as holding funds, granting credit, making compliance decisions or executing licensed payment services.

**Clearline Connect** (money-movement orchestration): the intended developer-first interface is payment intents, quotes, eligibility explanations, partner-executed payout instructions, webhooks, and a common state model.

**Clearline Control** (financial operations): reconciliation, funding exposure, liquidity, compliance holds, investigation, evidence and human next actions.

## Why the Payment page matters
Every payment is keyed by a Clearline payment ID and reference. The same record should join its instruction, route eligibility, quoted costs, approval, provider transitions, bank/chain evidence, webhook attempts and reconciliation status. An execution partner reporting completion is not the same as an independent bank or chain settlement proof.

## What has actually been implemented on this branch (2026-11-13)
- `/clearline` is a **client-side sandbox demonstration**, not a deployed payment service. It shows four seeded synthetic paths, offers synthetic intent creation, eligible route selection, simulated submission and event advancement. All values are fictional.
- It has read-only, synthetic Control views for reconciliation (reference plus amount), liquidity (illustrative balance formula), holds and investigations. They refer to the same payment list during that browser session.
- It includes a pure payment state machine in `src/lib/clearline/model.ts` and unit tests in `model.test.ts` covering every allowed and forbidden direct state transition. This is a prototype logic contract, not yet a durable API.
- The previous Funding Desk remains intact at `/mentor-demo`. Its synthetic advances, approvals and outstanding ledger **do not yet share records** with the new payment dataset; linking to it is not full funding integration.
- The earlier stablecoin investigation code remains in the repository but is not called by this view.
- State resets on refresh. There are no server-backed test-mode API endpoints, external payment requests, webhook delivery, webhook signature, retries, live network reads, persistence, per-user access control, financial advice, real provider integrations or settlement guarantees.

## Planned milestones and acceptance
M1: pure state machine, forbidden edge tests, one shared sandbox UI context.
M2: server-backed sandbox API with test-key authentication, idempotency and signed retried webhooks; real `/docs`.
M3: persistent payment-centric detail, evidence provenance and contradiction rules.
M4: imported sandbox reconciliation records and liquidity calculations with tested linkage.
M5: human-owned compliance queue and read-only investigation evidence mapping.
M6: adapt Funding Desk to a shared payment ID without changing its maker-checker rules.
M7: mobile, accessible keyboard behavior, empty/loading/error states and security review.
M8: independent QA, browser tests, policy review and customer-shareable preview.

The baseline funding and stablecoin capabilities are maintained on separate branches. Every PR remains draft until the founder approves it.
