import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "@/components/clearline/Link";
import { Notice, PageHead, Panel, ui } from "@/components/clearline/ui";
import captured from "@/components/clearline/docs-examples.json";
import {
  SAMPLE_ACTORS,
  WEBHOOK_TOLERANCE_SECONDS,
  type EngineErrorCode,
  type ExecutionState,
  type ProcessingOutcome,
  type ReconciliationState,
  type SettlementEvidenceState,
  type SettlementScope,
} from "@/lib/clearline";

export const metadata: Metadata = {
  title: "Test API reference — Clearline test mode",
  description: "The stateless v1 test-mode API over the Clearline sandbox engine: fictional data, no money movement.",
};

/**
 * Exhaustive value tables. `all<T>()(rows)` fails to compile if a value of T is missing, so the
 * page cannot silently fall behind the engine's enums in src/lib/clearline/types.ts.
 */
const all = <T extends string>() => <R extends readonly (readonly [T, string])[]>(rows: R & ([T] extends [R[number][0]] ? unknown : "a value of the engine enum is missing")) => rows;

const EXECUTION = all<ExecutionState>()([
  ["created", "Intent recorded; nothing quoted yet."],
  ["quoted", "Indicative quotes requested."],
  ["approved", "A checker other than the maker approved the instruction."],
  ["submitted", "Instruction accepted by the sandbox provider."],
  ["in_transit", "Provider reports the payout is moving."],
  ["provider_reported_completed", "The provider says it completed. A claim, not settlement evidence."],
  ["awaiting_information", "The provider asked for more information."],
  ["on_hold", "Partner compliance hold. Only a recorded reviewer decision ends it."],
  ["failed", "Provider reports failure."],
  ["returned", "Provider reports the payout came back."],
  ["cancelled", "Cancelled before submission."],
  ["expired", "Quote or instruction expired on the simulated clock."],
] as const);

const SETTLEMENT = all<SettlementEvidenceState>()([
  ["none", "No settlement evidence."],
  ["observed", "Evidence seen but not final (e.g. a chain transfer below the finality threshold)."],
  ["pending_finality", "Waiting for the finality threshold."],
  ["verified", "Independent evidence matched. settlementScope says what it covers."],
  ["contradicted", "Evidence disagrees with the provider's report."],
] as const);

const SCOPE = all<SettlementScope>()([
  ["none", "Nothing evidenced yet."],
  ["provider_report", "Only the provider's own report."],
  ["bank_statement", "A bank statement line (evidences the payout debit, not the beneficiary's credit)."],
  ["onchain_transfer", "A synthetic Base Sepolia transfer. Never proof of a bank credit."],
] as const);

const RECON = all<ReconciliationState>()([
  ["not_started", "Not yet expected on a statement."],
  ["pending", "Expected; no statement line matched yet."],
  ["matched", "A statement line matched by trusted reference, amount, currency and window."],
  ["partially_matched", "Only part of the amount is matched."],
  ["exception", "Needs a person: a mismatch, contradiction or returned payout. See returnStatus for returns."],
] as const);

const OUTCOMES = all<ProcessingOutcome>()([
  ["applied", "Valid, in order and allowed: state changed."],
  ["recorded_no_state_change", "Valid but changes nothing (e.g. already in that state)."],
  ["duplicate_ignored", "Same (provider, event id) already processed. Recorded, ignored."],
  ["stored_late_no_regression", "Older sequence than one already applied. Stored; state never moves backwards."],
  ["contradictory_exception_raised", "Impossible transition or different amount. Both reports kept; an exception is opened."],
  ["rejected_signature", "Signature malformed, wrong, or outside the time window. Recorded, never applied."],
  ["rejected_unknown_payment", "Provider payment id not known in this workspace."],
] as const);

/** HTTP status per error code, as mapped in src/app/api/clearline/test/v1/[...path]/route.ts. */
type HttpCode = EngineErrorCode | "unauthenticated" | "unknown_endpoint" | "invalid_json";
const ERRORS = ([
  ["unauthenticated", 401, "Missing or wrong example key."],
  ["webhook_signature_invalid", 401, "Reserved. A bad webhook signature is recorded with processingOutcome rejected_signature and HTTP 200, not returned as an error."],
  ["unauthorized_actor", 403, "Unknown actor, or the role may not perform this action."],
  ["maker_checker_violation", 403, "The checker is the maker (instruction, advance, hold documents). Checked before the role."],
  ["not_found", 404, "The entity does not exist in the workspace you sent."],
  ["unknown_endpoint", 404, "No such path or operation."],
  ["idempotency_conflict", 409, "The idempotency key was already used with a different body."],
  ["duplicate_statement_line", 409, "Same (source, accountRef, lineId) already ingested."],
  ["invalid_transition", 409, "Execution, case or hold transition not allowed."],
  ["resolution_not_permitted", 409, "Resolution conditions not met; the message starts with the reason code (e.g. OWNER_REQUIRED)."],
  ["hold_requires_human_decision", 409, "A case with an undecided compliance hold cannot be resolved."],
  ["quote_expired", 409, "The quote is past expiresAt on the simulated clock."],
  ["invalid_amount", 422, "Not a positive safe integer of minor units."],
  ["invalid_currency", 422, "Unsupported currency."],
  ["currency_mismatch", 422, "The operation would combine currencies."],
  ["invalid_field", 422, "Missing or malformed field, or the workspace failed validation."],
  ["invalid_json", 422, "Not application/json, not a JSON object, or over 2 MB."],
  ["quote_ineligible", 422, "Route not eligible; the reason is in the message."],
  ["precondition_failed", 422, "A required earlier step is missing (e.g. simulate before submit)."],
  ["unsupported_token_or_network", 422, "Reserved. Chain ingestion records these as exceptions and never counts them."],
] as const) satisfies readonly (readonly [HttpCode, number, string])[];
// Exhaustiveness for the error catalogue.
const _errorsComplete: [HttpCode] extends [(typeof ERRORS)[number][0]] ? true : never = true;
void _errorsComplete;

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/health", "Public. Mode and the fact that it cannot move money."],
  ["GET", "/workspace", "The deterministic sample workspace."],
  ["GET", "/intents, /intents/{id}", "Sample intents."],
  ["GET", "/instructions, /routes, /events", "Sample instructions, routes, provider events."],
  ["GET", "/reconciliation, /exceptions", "Statement lines and allocations; unresolved exceptions."],
  ["GET", "/liquidity, /funding-advances, /repayments", "Sample liquidity, funding projection, obligations."],
  ["GET / POST", "/investigations/{intentId}", "Investigation view (GET: sample; POST: your workspace)."],
  ["POST", "/intents", "Create an intent. Idempotency key required (header or body)."],
  ["POST", "/intents/{id}/quotes, /intents/{id}/cancel", "Request indicative quotes; cancel."],
  ["POST", "/instructions", "Choose a route (the maker)."],
  ["POST", "/instructions/{id}/approve | reject | submit", "Checker decision; submit to the sandbox provider."],
  ["POST", "/events/simulate", "Next provider event, optional failure injection."],
  ["POST", "/events/webhook", "Ingest a signed sandbox webhook."],
  ["POST", "/webhooks/verify", "Sample verifier; no workspace needed."],
  ["POST", "/reconciliation/statement-lines, /repayments", "Ingest a statement line; a repayment credit."],
  ["POST", "/exceptions/{id}/assign | notes | evidence | resolve | reopen", "Work an exception."],
  ["POST", "/funding-advances, /funding-advances/{id}/decision", "Record an advance; checker decision."],
  ["POST", "/liquidity", "Liquidity for your workspace at `at`."],
  ["POST", "/actions", "Any engine action ({ action: { type, … } })."],
];

type Example = (typeof captured.examples)[number];
const ex = (id: string): Example => {
  const e = captured.examples.find((x) => x.id === id);
  if (!e) throw new Error(`docs example ${id} missing; re-run scripts/clearline-docs-examples.mjs`);
  return e;
};

const pre: React.CSSProperties = { background: "var(--cl-ink)", color: "var(--cl-on-ink)", borderRadius: 6, padding: 14, overflowX: "auto", fontSize: 12, lineHeight: 1.6, fontFamily: "var(--cl-font-mono)", margin: "8px 0 0", whiteSpace: "pre", maxHeight: 420 };
const preLight: React.CSSProperties = { ...pre, background: "var(--cl-sand)", color: "var(--cl-ink)", border: "1px solid var(--cl-line)" };

function Pre({ label, dark, children }: { label: string; dark?: boolean; children: string }) {
  return <pre style={dark ? pre : preLight} tabIndex={0} role="region" aria-label={label}>{children}</pre>;
}

function ExampleBlock({ id }: { id: string }) {
  const e = ex(id);
  const req = [`${e.method} ${e.path}`, ...e.headers, ...(e.request ? ["", e.request] : [])].join("\n");
  return (
    <div style={{ marginTop: 16 }} data-testid={`example-${e.id}`}>
      <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>{e.title}</h3>
      <Pre label={`${e.title}: request`} dark>{req}</Pre>
      <p className={ui.hint} style={{ margin: "8px 0 0" }}>Response <strong>HTTP {e.status}</strong> (abridged)</p>
      <Pre label={`${e.title}: response`}>{e.response}</Pre>
      {e.note && <p className={ui.hint} style={{ margin: "6px 0 0" }}><code className={ui.code}>{e.note}</code></p>}
    </div>
  );
}

function ValueTable({ caption, rows }: { caption: string; rows: readonly (readonly [string, string])[] }) {
  return (
    <div className={ui.tableWrap} role="region" tabIndex={0} aria-label={caption}>
      <table className={ui.table}>
        <caption className={ui.hint} style={{ captionSide: "bottom", textAlign: "left", padding: "6px 10px" }}>{caption}</caption>
        <thead><tr><th scope="col">Value</th><th scope="col">Meaning</th></tr></thead>
        <tbody>{rows.map(([v, m]) => <tr key={v}><td><code className={ui.code}>{v}</code></td><td>{m}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

const Body = ({ children }: { children: ReactNode }) => <div className={ui.panelBody}>{children}</div>;
const P = ({ children }: { children: ReactNode }) => <p style={{ margin: "0 0 10px", maxWidth: "68ch" }}>{children}</p>;

export default function Docs() {
  return (
    <>
      <PageHead eyebrow="Connect / developer API reference" title="Test-mode API v1"
        lede={<>The same engine the console runs, over HTTP at <code className={ui.code}>/api/clearline/test/v1</code>. Fictional organisations, providers and amounts. Nothing moves money and nothing is stored on the server.</>}
        actions={<a className={ui.btn} href="/clearline/docs/openapi.yaml">OpenAPI 3.1 (YAML)</a>} />
      <Notice><strong>Test mode only.</strong> The key <code className={ui.code}>cl_test_demo</code> is a public example, not a credential. Do not send real customer, beneficiary or bank details. Clearline does not hold funds, execute payouts, or make compliance or credit decisions.</Notice>

      <Panel title="Quickstart" id="quickstart">
        <Body>
          <P>Every request except <code className={ui.code}>/health</code> sends <code className={ui.code}>Authorization: Bearer cl_test_demo</code>; POSTs also send <code className={ui.code}>Content-Type: application/json</code>.</P>
          <Pre label="Quickstart curl" dark>{`BASE=https://<this-site>/api/clearline/test/v1
curl -s "$BASE/health"
curl -s -X POST "$BASE/intents" \\
  -H "Authorization: Bearer cl_test_demo" \\
  -H "Content-Type: application/json" \\
  -d '{"input":{"internalReference":"INV-DOCS-0001","amountMinor":1250000,"sourceCurrency":"SGD","destinationCurrency":"PHP","purpose":"Supplier invoice","beneficiaryRef":"ben_docs_1","beneficiaryName":"Example Supplier (fictional)","destinationCountry":"PH","requestedExecutionDate":"2026-11-14","idempotencyKey":"docs-example-0001"}}'`}</Pre>
          <ExampleBlock id="health" />
        </Body>
      </Panel>

      <Panel title="Stateless: you hold the workspace" id="stateless">
        <Body>
          <P>The server keeps nothing (<code className={ui.code}>persisted: false</code>). The whole sandbox state is one JSON object, the <em>workspace</em>. Every POST accepts an optional <code className={ui.code}>workspace</code>; omit it to start from the deterministic sample. Every successful POST returns <code className={ui.code}>data</code>, <code className={ui.code}>outcome</code>, the <code className={ui.code}>audit</code> events it appended and the new <code className={ui.code}>workspace</code>, which you send with the next request. GET endpoints always read the sample.</P>
          <P><strong>Actor.</strong> <code className={ui.code}>X-Clearline-Actor</code> (or body <code className={ui.code}>actorId</code>) picks a fictional user. Defaults: <code className={ui.code}>usr_maya</code> for maker actions, <code className={ui.code}>usr_daniel</code> for approvals and advance decisions. Sample actors: {SAMPLE_ACTORS.map((a, i) => <span key={a.id}>{i ? ", " : ""}<code className={ui.code}>{a.id}</code> ({a.role})</span>)}.</P>
          <P><strong>Clock.</strong> Body <code className={ui.code}>at</code> (ISO-8601) is the simulated instant of the action; it defaults to <code className={ui.code}>workspace.asOf</code> and may not be earlier. The wall clock is never read.</P>
          <P><strong>Amounts.</strong> Integer minor units (<code className={ui.code}>amountMinor</code>) with a currency code. Different currencies are never added together.</P>
          <P><strong>Idempotency.</strong> <code className={ui.code}>POST /intents</code> needs a key (<code className={ui.code}>Idempotency-Key</code> header or <code className={ui.code}>input.idempotencyKey</code>). Same key and body: HTTP 200, <code className={ui.code}>outcome: idempotent_replay</code>, the original intent. Same key, different body: HTTP 409.</P>
        </Body>
      </Panel>

      <Panel title="Three status fields, never one badge" id="status">
        <Body>
          <P>Each intent carries <code className={ui.code}>status: {"{ execution, settlement, settlementScope, reconciliation }"}</code>. A provider &ldquo;completed&rdquo; only sets <code className={ui.code}>execution</code>; it never sets settlement <code className={ui.code}>verified</code> or reconciliation <code className={ui.code}>matched</code>. For returned payouts, <code className={ui.code}>returnStatus</code> is <code className={ui.code}>provider_reported</code> or <code className={ui.code}>confirmed_by_statement</code>, and reconciliation stays <code className={ui.code}>exception</code> until a person resolves it, because the supplier is still unpaid.</P>
          <h3 style={{ fontSize: 14 }}>execution</h3>
          <ValueTable caption="ExecutionState values (src/lib/clearline/types.ts)" rows={EXECUTION} />
          <h3 style={{ fontSize: 14 }}>settlement and settlementScope</h3>
          <ValueTable caption="SettlementEvidenceState values" rows={SETTLEMENT} />
          <ValueTable caption="SettlementScope values: what the evidence covers" rows={SCOPE} />
          <h3 style={{ fontSize: 14 }}>reconciliation</h3>
          <ValueTable caption="ReconciliationState values" rows={RECON} />
        </Body>
      </Panel>

      <Panel title="Walkthrough: intent to provider event" id="walkthrough">
        <Body>
          <P>Real responses from this API, captured {captured.capturedAt} at revision <code className={ui.code}>{captured.revision}</code> with <code className={ui.code}>scripts/clearline-docs-examples.mjs</code>. Workspaces and long arrays are abridged; IDs depend on the sample and will differ.</P>
          <ExampleBlock id="create-intent" />
          <ExampleBlock id="replay" />
          <ExampleBlock id="conflict" />
          <ExampleBlock id="quotes" />
          <ExampleBlock id="choose-route" />
          <ExampleBlock id="self-approve" />
          <ExampleBlock id="approve" />
          <ExampleBlock id="submit" />
          <ExampleBlock id="simulate" />
        </Body>
      </Panel>

      <Panel title="Webhooks" id="webhooks">
        <Body>
          <P><strong>Header.</strong> <code className={ui.code}>X-Sandbox-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256(secret, t + &quot;.&quot; + rawBody)&gt;</code>, compared in constant time. Send the exact signed bytes as <code className={ui.code}>rawBody</code> (a JSON string). Sandbox secrets are public (<code className={ui.code}>test_whsec_&lt;providerId&gt;_public_example</code>) and protect nothing.</P>
          <P><strong>Window.</strong> <code className={ui.code}>t</code> must be within {WEBHOOK_TOLERANCE_SECONDS} s of the action&apos;s simulated instant (<code className={ui.code}>at</code>, default <code className={ui.code}>workspace.asOf</code>), not the wall clock.</P>
          <P><strong>Bad deliveries are recorded, not refused.</strong> For a known provider, every delivery returns HTTP 200 and is recorded as a provider event with a <code className={ui.code}>processingOutcome</code>; rejected ones are kept for the audit trail but never change state. Dedupe is by <code className={ui.code}>(provider, event id)</code>. An event with an older <code className={ui.code}>sequence</code> than one already applied is stored without moving the state backwards.</P>
          <ValueTable caption="ProcessingOutcome values" rows={OUTCOMES} />
          <ExampleBlock id="webhook" />
          <ExampleBlock id="webhook-duplicate" />
          <ExampleBlock id="webhook-late" />
          <ExampleBlock id="webhook-bad-signature" />
          <ExampleBlock id="webhook-stale" />
          <h3 style={{ fontSize: 14, marginTop: 20 }}>Verifying on your side</h3>
          <Pre label="Verifier reference (TypeScript)" dark>{`import { verifySandboxWebhook, sandboxWebhookSecret } from "@/lib/clearline";
// Verify the raw bytes before parsing JSON.
const result = verifySandboxWebhook(rawBody, req.headers.get("x-sandbox-signature") ?? "",
  sandboxWebhookSecret("prv_northline"), Math.floor(Date.now() / 1000));
if (!result.valid) return new Response(result.reason, { status: 401 });
// reason: malformed_header | timestamp_outside_tolerance | signature_mismatch`}</Pre>
          <ExampleBlock id="verify" />
          <ExampleBlock id="verify-stale" />
        </Body>
      </Panel>

      <Panel title="Investigation" id="investigation">
        <Body>
          <P>What was requested, what the provider claims, what independent evidence shows, what is unknown or contradictory, what is outstanding and who acts, each with an explanation code.</P>
          <ExampleBlock id="investigation" />
        </Body>
      </Panel>

      <Panel title="Errors" id="errors">
        <Body>
          <P>Shape: <code className={ui.code}>{'{ "error": { "code", "message", "help", "field?", "entityId?" } }'}</code>.</P>
          <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Error code catalogue">
            <table className={ui.table}>
              <caption className={ui.hint} style={{ captionSide: "bottom", textAlign: "left", padding: "6px 10px" }}>Error codes and HTTP statuses, from the v1 route handler.</caption>
              <thead><tr><th scope="col">code</th><th scope="col" className={ui.r}>HTTP</th><th scope="col">Meaning</th></tr></thead>
              <tbody>{ERRORS.map(([c, s, m]) => <tr key={c}><td><code className={ui.code}>{c}</code></td><td className={`${ui.r} ${ui.num}`}>{s}</td><td>{m}</td></tr>)}</tbody>
            </table>
          </div>
          <ExampleBlock id="no-key" />
          <ExampleBlock id="unknown" />
          <ExampleBlock id="bad-amount" />
        </Body>
      </Panel>

      <Panel title="Endpoints" id="endpoints">
        <div className={ui.tableWrap} role="region" tabIndex={0} aria-label="Endpoint index">
          <table className={ui.table}>
            <caption className={ui.hint} style={{ captionSide: "bottom", textAlign: "left", padding: "6px 10px" }}>All paths are under /api/clearline/test/v1. Full schemas: <a href="/clearline/docs/openapi.yaml">openapi.yaml</a>.</caption>
            <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">Purpose</th></tr></thead>
            <tbody>{ENDPOINTS.map(([m, p, d]) => <tr key={m + p}><td className={ui.num}>{m}</td><td><code className={ui.code}>{p}</code></td><td>{d}</td></tr>)}</tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Limitations" id="limitations">
        <Body>
          <ul style={{ margin: 0, paddingLeft: 18, maxWidth: "68ch" }}>
            <li>No real provider, bank, wallet or chain is connected. Quotes are indicative and not executable.</li>
            <li>No server state: concurrent clients holding different workspaces never see each other&apos;s changes.</li>
            <li>No outbound webhooks, retries or delivery queue; you post deliveries in. Secrets are public; there is no rotation or per-endpoint secret.</li>
            <li>Bodies are limited to 2 MB; the full workspace is about 80–100 KB.</li>
            <li>Sample IDs are deterministic but change if the sample changes. Find scenarios by <code className={ui.code}>intent.scenario</code>.</li>
            <li>The example key is shared by everyone. There are no accounts, rate limits or service-level commitments.</li>
          </ul>
        </Body>
      </Panel>

      <Panel title="Legacy endpoints" id="legacy">
        <Body>
          <P>The earlier unversioned endpoints <code className={ui.code}>/api/clearline/test/{"{intents,quotes,transitions,webhooks,payments,health}"}</code> are still served for existing links. They run on the older prototype model (single status field, no workspace) and are not documented here. Use v1.</P>
          <p className={ui.hint} style={{ margin: 0 }}><Link href="/clearline">Back to the console</Link></p>
        </Body>
      </Panel>
    </>
  );
}
