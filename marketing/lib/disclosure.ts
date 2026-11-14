/**
 * The single "working today / not built yet / out of scope" disclosure. Every page that states the product's
 * stage reads it from here, so the wording cannot drift. Checked against rc3/clearline-app @ cf8732e
 * (docs/release/RELEASE_MANIFEST_V2.md "Known limitations", docs/clearline/ENGINE_API.md, src/lib/clearline), and the console
 * features shipped at rc3/clearline-app @ 7e521f5 and fa303fd (acceptance: AcceptDifference.tsx, exceptions.ts
 * ACCEPTED_OVERAGE_BPS, MAX_APPROVED_OVERAGE_BPS, MAX_LATE_ACCEPTANCE_DAYS), each covered end to end by tests/browser/clearline-journey.spec.ts.
 * Rule: an item is "working" only if the released engine and console can demonstrate it today.
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
  { area: "Acceptance", text: "Accept a bank debit that carries the payment's reference but disagrees with it, so the case can close: an over-amount of up to 1% by one person, above 1% and up to 50% only with a second, different person's approval, or a late value date up to 60 days after submission. A currency mismatch is never accepted." },
  { area: "Case report", text: "From a payment's investigation page, view the engine's synthetic case report in place, marked fictional, and download it as JSON or CSV." },
  { area: "Reset", text: "Reset one guided case to its starting state, leaving the other cases and anything you created untouched; it refuses, with the reason, if one of your records depends on that case. The whole workspace can also be reset." },
  { area: "Roles", text: "Switch between simulated roles (operator, approver, compliance reviewer, viewer) to see maker-checker and reviewer rules. Every switch is labelled \"Simulated role — not sign-in or access control\"." },
  { area: "Funding Desk", text: "Follow a supplier payout to its advance, treasury approval and repayment through a tested projection, and open the Funding Desk workflow from Treasury & Funding." },
  { area: "Developers", text: "A stateless v1 test API with an OpenAPI 3.1 document and a public example key. The case report and the per-case reset are console features; no v1 endpoint exposes them." },
];

/** Not built yet. Nothing here is available, in the sandbox or anywhere else. */
export const NOT_BUILT: DisclosureItem[] = [
  { area: "Connections", text: "No licensed provider, bank or wallet is connected. Every provider, quote, webhook, balance and statement in the sandbox is fictional." },
  { area: "Chain reads", text: "No real chain is read. Base Sepolia observations in the sandbox are synthetic." },
  { area: "Accounts and storage", text: "No user accounts, authentication or server-side storage. The test API is stateless and the console keeps its workspace in your browser." },
  { area: "Onchain design", text: "Safe payout proposals and evidence fingerprints are a design only. No code exists for them." },
  { area: "Your own data", text: "Uploads are disabled. Evaluating real historical cases needs agreed data terms and a security review first." },
];

/** Not something Clearline does, now or in the current plan. */
export const OUT_OF_SCOPE = "Clearline does not execute payouts with real money, hold funds or keys, use real banking or wallet credentials, lend or make credit decisions, or make compliance decisions.";
