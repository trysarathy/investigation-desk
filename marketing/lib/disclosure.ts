/**
 * The single "working today / not built yet / out of scope" disclosure. Every page that states the product's
 * stage reads it from here, so the wording cannot drift. Checked against rc3/clearline-app @ cf8732e
 * (docs/release/RELEASE_MANIFEST_V2.md "Known limitations", docs/clearline/ENGINE_API.md, src/lib/clearline).
 * Rule: an item is "working" only if the released engine and console can demonstrate it today.
 */
export type DisclosureItem = { area: string; text: string };

/** Works today in the public sandbox: fictional data, test mode, nothing persisted server-side. */
export const WORKING_TODAY: DisclosureItem[] = [
  { area: "Connect", text: "Create a payment intent with an idempotency key, request indicative quotes from three fictional providers (ineligible routes shown with the reason), prepare it as maker and approve it as a different person, then submit it to a sandbox adapter." },
  { area: "Connect", text: "Ingest signed sandbox provider events: duplicates ignored, late events never move a payment backwards, bad signatures rejected, contradictions raised as exceptions." },
  { area: "Control", text: "Investigate a payment with three separate statuses (execution, settlement evidence, reconciliation), a sourced evidence timeline, what is still unknown and who owns the next step." },
  { area: "Control", text: "Reconcile fictional statement lines by trusted reference, amount, currency and value-date window; anything else becomes an exception with an owner and a due date." },
  { area: "Control", text: "Record compliance holds, which move on only when the partner reports a release and the assigned reviewer records a decision; show a liquidity view net of restricted, safeguarded and committed amounts, and synthetic Base Sepolia observations against a 12-confirmation finality threshold." },
  { area: "Funding Desk", text: "Follow a supplier payout to its advance, treasury approval and repayment through a tested projection, and open the interactive Funding Desk demo." },
  { area: "Developers", text: "A stateless v1 test API with an OpenAPI 3.1 document and a public example key." },
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
