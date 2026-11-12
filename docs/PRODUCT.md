# Clearline — Product specification (November 2026)

## The system

**Clearline is a proposed neutral coordination and financial-control layer for cross-border money movement.** Banks, stablecoin issuers, payment providers and local payout partners operate their own systems. Clearline aims to coordinate eligible partner instructions and explain what happened, using independent evidence wherever available.

There are two tightly linked products:

**Connect** is the proposed developer-first payment orchestration API. A customer creates a payment intent, requests eligible fiat/stablecoin quotes, chooses a route, authorizes a partner-executed instruction, and consumes signed status webhooks. Actual execution is performed by an appropriately authorized third-party provider; Clearline does not take custody of customer money in the proposed design. This does **not** establish that a payment-services licence is unnecessary.

**Control** is the operations console and API for reconciliation, outstanding-advance exposure, liquidity, partner compliance holds and case investigation. The centre is one **Payment page** with a lifecycle from intent to provider-reported completion, an evidence timeline, plain-English explanation, and a next human action. Reconciliation matches exact references, identifiers and currencies—not amounts alone. Settlement is not independently verified merely because a provider reported completion.

## Customer evaluation now

- Dedicated route: \`/clearline\` with a fictional workspace and developer documentation at \`/clearline/docs\`.
- Connect interface: draft a synthetic payment, compare three illustrated eligible routes and one ineligible route, choose a provider and advance through a strict sandbox state machine.
- Payment page: status, quote/provider identity, fictional events and evidence labels, explanation, last update and next action.
- Three failure scenarios: returned payout (beneficiary details), partner compliance hold (invoice requested), pending stablecoin finality (Base Sepolia testnet).
- Control: sample reconciliation exceptions and status-aware payment view; illustrative provider/currency balances and free-cash formula; a compliance hold queue; existing Funding Desk accessible at \`/mentor-demo\`.
- Developer experience: example test API endpoints and mock webhook signature generation; browser-local request log; search, filters, pagination, keyboard shortcuts.
- Design: #F5F6F4 off-white, #1B1F1D ink, #2E6B4F green, soft green / amber / red semantically. No generic gradients, fake customer logos or ROI claims.

## Boundary: what is real versus simulated

**Real code:** API handlers validate strict fictional test requests; pure payment-state transitions, quote eligibility, exact-reference matching and HMAC signing have tests. The test console lets users create fictional payment records in their own browser storage and drill into coherent related Control screens.

**Synthetic:** every provider name, account, corridor, quote, fee, FX rate, webhook delivery, payment, balance and payment status. No bank connectivity, no partner agreement, no actual provider authorization, no independently verified settlement. The test API is **stateless** and the public demo key is not a secret. Browser-local data is not a multi-tenant backend. The Funding Desk currently remains a **separate** self-contained fictional module with its own records, not linked to the new Connect ledger.

**Not built or not released:** real fiat/stablecoin routing, production keys, real webhook dispatch or retries, signed and verified provider status feeds, permissioned payout instructions, company identity/authentication in this new console, sanctions screening, encrypted customer data processing, production audit trails, independent security review, multi-provider cash management, ERP posting, financial data pilot.

Do not describe this prototype as live payments or production SaaS; it is an **interactive synthetic product sample** for research, mentoring and design-partner conversations.

## Next milestones

- M4: Control reconciliation and liquidity reconciled to a single approved synthetic ledger, not standalone mock balances.
- M5: independently verifiable provider/chain evidence contract, compliance hold queue with assignment/decision history.
- M6: integrate the existing Funding Desk data contract into Control without breaking the mentor demo.
- M7: real user tests, accessibility, responsive, empty states, keyboard/pagination.
- M8: verified deployment with launch acceptance screenshot and accurate preview link.

## Acceptance gates before any real data

Confirmed business sponsor; signed data processing pilot terms; licensed partner/legal analysis; trusted provider credentials and scoped read-only evidence imports; SSO/MFA; managed encrypted storage, tenant isolation, backups and logging; external security assessment; incident support and human approval controls. Unresolved items remain BLOCKED. No simulated green tests can satisfy a legal authorization or an independent audit.
