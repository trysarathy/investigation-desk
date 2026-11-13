# Clearline — customer evaluation checklist

**Status:** synthetic product sample, not production payment infrastructure. **Audience:** design partners, mentors and prospective business users. **Date:** 2026-11-13 SGT.

## What to open

1. `/clearline/trial` — guided five-case walkthrough.
2. `/clearline` — Connect + Control console.
3. `/clearline/docs` — test-mode API reference.
4. `/clearline/control/funding` — funding exposure: the sandbox engine links a payment intent, supplier payout, advance,
   treasury approval (maker ≠ checker), repayment obligation and allocations through an explicit, tested **projection**
   (not a shared production ledger).
5. `/mentor-demo` — the original, more detailed Funding Desk prototype (self-contained).

## Walk through with a prospective provider (15–20 minutes)

- Start on the console; confirm the persistent **TEST MODE** label.
- Create a synthetic intent. Compare three eligible quotes and one ineligible provider with a reason.
- Select a route and advance the payment through allowed states. Check the event timeline and its source/provenance labels.
- Open Control reconciliation and see matched/unmatched references. A matching amount alone must never be treated as payment attribution.
- Inspect a returned payment, a compliance hold, and a synthetic Base Sepolia finality delay.
- Open liquidity and confirm restricted balances are subtracted from free cash, not presented as spendable.
- Open Funding exposure: SGD 50,000.00 advanced, SGD 30,000.00 repaid by reference, SGD 20,000.00 outstanding; an
  unreferenced SGD 20,000.00 receipt stays an exception and does not close the balance.
- Conclude on `/clearline/trial` with these questions: which exception is frequent; who owns it; what system is currently used; who would budget for a fix?

## Acceptable claims

**Built in the prototype:** a deterministic sandbox engine with one payment identity across Connect, Control and funding; three separate status
fields (execution, settlement evidence, reconciliation); fictional providers behind a typed adapter; signed sandbox
webhooks with duplicate/out-of-order/contradiction handling; reference-based reconciliation with explained exceptions;
liquidity with source and freshness; compliance holds that are never auto-released; Base Sepolia observation vs finality;
a tested funding-exposure projection; a stateless test API (`/api/clearline/test/v1`) and OpenAPI document.

**Not built for live use:** licensed provider routing, real bank payout instructions, production keys, persistent multi-tenant server state, webhook delivery/retries, actual settlement attestations, compliance decisions, real chain data (the Base Sepolia evidence is synthetic), a shared production funding/Connect ledger, enterprise SSO, real financial data import to this new console.

## What NOT to request from trial participants

No credentials, wallet private keys, real banking data, account numbers, identity documents, customer names or confidential case files in the public demo. Real-data trials need written data-handling terms, independent security review and jurisdiction-specific regulatory advice first.

## Release acceptance

- [ ] TypeScript passes at trial branch SHA.
- [ ] Unit tests pass at trial branch SHA.
- [ ] Next.js build passes at trial branch SHA.
- [ ] Desktop and mobile browser tests pass.
- [ ] Original Funding Desk regression tests pass.
- [ ] Vercel preview is READY and links checked.
- [ ] Security/privacy review by an independent person, including the known production-app issues in main.
- [ ] Founder approves the customer-facing link and trial language.

This release checklist never treats a test-only API as production payment readiness. There are no paying customers or established live execution partners.
