/**
 * The single "working today / not built yet / out of scope" disclosure. Every page that states the product's
 * stage reads it from here, so the wording cannot drift. Checked against rc3/clearline-app @ cf8732e
 * (docs/release/RELEASE_MANIFEST_V2.md "Known limitations", docs/clearline/ENGINE_API.md, src/lib/clearline), and the console
 * features shipped at rc3/clearline-app @ 7e521f5 and fa303fd (acceptance: AcceptDifference.tsx, exceptions.ts
 * ACCEPTED_OVERAGE_BPS, MAX_APPROVED_OVERAGE_BPS, MAX_LATE_ACCEPTANCE_DAYS), each covered end to end by tests/browser/clearline-journey.spec.ts.
 * rc4 (rc4/clearline-app @ a132340): Accounting Bridge (docs/clearline/ACCOUNTING_BRIDGE.md, console Control › Accounting),
 * audit history and the accounting outcome on each investigation (journey steps 7, 15–17), and the Connect adapter
 * framework (docs/clearline/CONNECT_ADAPTERS.md; engine and tests only, not in the console or the sample workspace).
 * Not built: docs/strategy/CLEARLINE_PRODUCT_STRATEGY_RC4.md §3 (BUILD NEXT / RESEARCH FIRST) and §4 (AI, design only).
 * Rule: an item is "working" only if the released engine and console can demonstrate it today; an engine-only
 * capability says so in its own text.
 */
export type DisclosureItem = { area: string; text: string };

/** Works today in the public sandbox: fictional data, test mode, nothing persisted server-side. */
export const WORKING_TODAY: DisclosureItem[] = [
  { area: "Connect", text: "Create a payment intent with an idempotency key, request indicative quotes from three fictional providers (ineligible routes shown with the reason), prepare it as maker and approve it as a different person, then submit it to a sandbox adapter." },
  { area: "Connect", text: "Ingest signed sandbox provider events: duplicates ignored, late events never move a payment backwards, bad signatures rejected, contradictions raised as exceptions." },
  { area: "Control", text: "Investigate a payment with three separate statuses (execution, settlement evidence, reconciliation), a sourced evidence timeline, what is still unknown and who owns the next step." },
  { area: "Control", text: "Reconcile fictional statement lines by trusted reference, amount, currency and value-date window; anything else becomes an exception in the queue with a due date set by severity, and a person assigns its owner." },
  { area: "Control", text: "Record compliance holds, which move on only when the partner reports a release and the assigned reviewer records a decision; show a liquidity view net of restricted, safeguarded and committed amounts, and synthetic Base Sepolia observations against a 12-confirmation finality threshold." },
  { area: "Control", text: "Filter and search Payments, Investigations and Exceptions, with the filters kept in the URL, and assign owners to exceptions and cases through the engine." },
  { area: "Accounting", text: "In Control › Accounting, under sandbox posting rules: propose balanced double-entry journal entries, one currency each, only from independent evidence (a matched bank statement line or a final chain transfer); approve each as a different person; map the accounts to your chart of accounts by posting role; keep accounting periods open or closed; and export the journal (each approved entry once) and an accounting-ready reconciliation file (CSV or JSON, marked fictional), each with an id derived from its content. \"Posted\" is recorded only when a person types their own ledger's reference. Clearline posts nothing." },
  { area: "Accounting", text: "A returned payout never shows the supplier as paid. A provider's completion report on its own gives no entry, and a receipt that matches only by amount never produces one." },
  { area: "Audit", text: "Audit history for the whole workspace and for each payment, filterable by payment and person, and an Accounting outcome section on every investigation." },
  { area: "Connect adapters", text: "In the engine and its tests, not yet in the console or the sample: a provider adapter framework with three fictional providers. It keeps each provider's raw status verbatim, treats provider reports as claims and never as independent evidence, raises a status reversal as a contradiction with an owner, verifies webhooks with pluggable schemes, key rotation and a replay window, orders events by the provider's own version instead of arrival, and polls when webhooks are lost." },
  { area: "Acceptance", text: "Accept a bank debit that carries the payment's reference but disagrees with it, so the case can close: an over-amount of up to 1% by one person, above 1% and up to 50% only with a second, different person's approval, or a late value date up to 60 days after submission. A currency mismatch is never accepted." },
  { area: "Case report", text: "From a payment's investigation page, view the engine's synthetic case report in place, marked fictional, and download it as JSON or CSV." },
  { area: "Reset", text: "Reset one guided case to its starting state, leaving the other cases and anything you created untouched; it refuses, with the reason, if one of your records depends on that case. The whole workspace can also be reset." },
  { area: "Roles", text: "Switch between simulated roles (operator, approver, compliance reviewer, viewer) to see maker-checker and reviewer rules. Every switch is labelled \"Simulated role — not sign-in or access control\"." },
  { area: "Funding Desk", text: "Follow a supplier payout to its advance, treasury approval and repayment through a tested projection, and open the Funding Desk workflow from Treasury & Funding." },
  { area: "Developers", text: "A stateless v1 test API with an OpenAPI 3.1 document and a public example key. The case report and the per-case reset are console features; no v1 endpoint exposes them. Accounting Bridge actions go through the generic POST /actions; its exports are engine functions with no endpoint of their own." },
];

/** Not built yet. Nothing here is available, in the sandbox or anywhere else. */
export const NOT_BUILT: DisclosureItem[] = [
  { area: "Connections", text: "No licensed provider, bank or wallet is connected. Every provider, quote, webhook, balance and statement in the sandbox is fictional." },
  { area: "Real providers", text: "Connect's adapters run against fictional providers only. Connecting a real provider needs founder approval, a security review and a review of that provider's own documentation first." },
  { area: "Bank statements", text: "No real bank statement is ingested. Statement lines in the sandbox are fictional inputs." },
  { area: "Accounting systems", text: "No accounting system is connected and Clearline posts to no ledger. Ledger adapters (Xero first, then NetSuite) are planned, not built. Today the bridge exports a generic CSV journal file." },
  { area: "AI assistance", text: "AI-drafted investigation summaries and suggestions are designed, not built. The design limits AI to drafting text for a person; it would never set evidence, amounts, entries or approvals." },
  { area: "Chain reads", text: "No real chain is read. Base Sepolia observations in the sandbox are synthetic." },
  { area: "Accounts and storage", text: "No user accounts, authentication or server-side storage. The test API is stateless and the console keeps its workspace in your browser." },
  { area: "Onchain design", text: "Safe payout proposals and evidence fingerprints are a design only. No code exists for them." },
  { area: "Your own data", text: "Uploads are disabled. Evaluating real historical cases needs agreed data terms and a security review first." },
];

/** Not something Clearline does, now or in the current plan. */
export const OUT_OF_SCOPE = "Clearline does not execute payouts with real money, hold funds or keys, use real banking or wallet credentials, lend or make credit decisions, make compliance decisions, or post entries to a ledger by itself.";
