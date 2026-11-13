# Clearline — customer evaluation checklist

**Status:** synthetic product sample, not production payment infrastructure. **Audience:** design partners, mentors and prospective business users. **Date:** 2026-11-13 SGT.

## What to open

1. `/clearline/trial` — guided five-case walkthrough.
2. `/clearline` — Connect + Control console.
3. `/clearline/docs` — test-mode API reference.
4. `/mentor-demo` — original Funding Desk. It remains self-contained; it is **not linked** to Connect's payment IDs.

## Walk through with a prospective provider (15–20 minutes)

- Start on the console; confirm the persistent **TEST MODE** label.
- Create a synthetic intent. Compare three eligible quotes and one ineligible provider with a reason.
- Select a route and advance the payment through allowed states. Check the event timeline and its source/provenance labels.
- Open Control reconciliation and see matched/unmatched references. A matching amount alone must never be treated as payment attribution.
- Inspect a returned payment, a compliance hold, and a synthetic Base Sepolia finality delay.
- Open liquidity and confirm restricted balances are subtracted from free cash, not presented as spendable.
- Open Funding Desk to review maker-checker approvals, outstanding advances and repayments.
- Conclude on `/clearline/trial` with these questions: which exception is frequent; who owns it; what system is currently used; who would budget for a fix?

## Acceptable claims

**Built in the prototype:** isolated synthetic Connect test API with strict validation and state transitions, fictional quotes, UI payment timeline and explanation, simulated webhook signing, illustrative Control views, separate Funding Desk module.

**Not built for live use:** licensed provider routing, real bank payout instructions, production keys, persistent multi-tenant server state, webhook delivery/retries, actual settlement attestations, compliance decisions, independent chain evidence integration into this console, shared funding/Connect ledger, enterprise SSO, real financial data import to this new console.

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
