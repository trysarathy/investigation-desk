import { ButtonLink, ContactBand, ExtLink, PageHero, Section } from "@/components/Shared";
import { ExecStatus, ReconStatus, SettlementStatus, type ExecState } from "@/components/Status";
import { TableWrap } from "@/components/Tables";
import { API_DOCS_URL, OPENAPI_URL, PRODUCT_DEMO_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Developers",
  "Clearline sandbox engine test API (/api/clearline/test/v1): stateless quickstart, endpoints, the execution / settlement / reconciliation status model, signed sandbox webhooks and limitations. Fictional data only.",
  "/developers",
);

const BASE = PRODUCT_DEMO_URL + "/api/clearline/test/v1";

const quickstart = `BASE=${BASE}

curl -X POST "$BASE/intents" \\
  -H "Authorization: Bearer cl_test_demo" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: quickstart-0001" \\
  -d '{"input":{"internalReference":"INV-2026-137","amountMinor":4821537,
       "sourceCurrency":"SGD","destinationCurrency":"PHP","purpose":"Supplier invoice",
       "beneficiaryRef":"BEN-ALPHA-01","beneficiaryName":"Supplier Alpha (fictional)",
       "destinationCountry":"PH","requestedExecutionDate":"2026-11-16"}}'`;

const intentResponse = `HTTP/1.1 201 Created

{
  "data": {
    "id": "pi_…",
    "internalReference": "INV-2026-137",
    "amountMinor": 4821537,
    "sourceCurrency": "SGD", "destinationCurrency": "PHP",
    "status": {
      "execution": "created",
      "settlement": "none",
      "settlementScope": "none",
      "reconciliation": "not_started"
    },
    …
  },
  "outcome": "applied",
  "audit": [ … ],
  "workspace": { … },      // send this back on your next request
  "mode": "synthetic",
  "persisted": false,
  "disclaimer": "TEST MODE · fictional sandbox data. …"
}`;

const flow = `# Statelessness: pass the workspace you got back; omit it to start from the sample.
curl -X POST "$BASE/intents/pi_…/quotes"            -d '{"workspace": {…}}'
curl -X POST "$BASE/instructions"                   -d '{"workspace": {…}, "intentId": "pi_…", "quoteId": "qt_…"}'
curl -X POST "$BASE/instructions/ins_…/approve" \\
  -H "X-Clearline-Actor: usr_daniel"                 -d '{"workspace": {…}}'   # checker ≠ maker, else 403
curl -X POST "$BASE/instructions/ins_…/submit"       -d '{"workspace": {…}}'
curl -X POST "$BASE/events/simulate"                -d '{"workspace": {…}, "intentId": "pi_…"}'
curl -X POST "$BASE/reconciliation/statement-lines" -d '{"workspace": {…}, "line": {…}}'
# (auth and content-type headers omitted for brevity)`;

const verify = `// Reference verifier, as documented for POST /webhooks/verify
import { verifySandboxWebhook, sandboxWebhookSecret } from "@/lib/clearline";

const result = verifySandboxWebhook(
  rawBody,                                        // exact bytes, before JSON parsing
  req.headers.get("x-sandbox-signature") ?? "",   // t=<unix s>,v1=<hex HMAC-SHA256>
  sandboxWebhookSecret("prv_northline"),          // public sandbox secret
  Math.floor(Date.now() / 1000),                  // 300 s tolerance
);
if (!result.valid) return new Response(result.reason, { status: 401 });
// reason: malformed_header | timestamp_outside_tolerance | signature_mismatch`;

const endpoints: [string, string, string][] = [
  ["GET", "/health", "Public. { mode: \"test\", canMoveMoney: false }"],
  ["GET", "/workspace", "The deterministic sample workspace"],
  ["GET · POST", "/intents", "List sample intents · create an intent (Idempotency-Key required)"],
  ["GET", "/intents/{intentId}", "One intent, including status.execution / settlement / settlementScope / reconciliation"],
  ["POST", "/intents/{intentId}/quotes", "Indicative sandbox quotes from every route, eligible and ineligible with reasons"],
  ["POST", "/intents/{intentId}/cancel", "Cancel with a reason, only before submission (created, quoted, approved); afterwards 409 invalid_transition"],
  ["GET · POST", "/instructions", "List · choose a route (creates an instruction; maker = actor)"],
  ["POST", "/instructions/{id}/approve · /reject · /submit", "Checker approval (must differ from maker), rejection, submission to the sandbox adapter"],
  ["GET", "/events", "Provider events with processingOutcome, provenance and signatureResult"],
  ["POST", "/events/simulate", "Next provider event; optional injection: timeout, duplicate, out_of_order, contradictory, bad_signature"],
  ["POST", "/events/webhook", "Ingest a signed sandbox webhook (X-Sandbox-Signature)"],
  ["POST", "/webhooks/verify", "Sample verifier; no workspace needed"],
  ["GET", "/reconciliation", "Statement lines and allocations"],
  ["POST", "/reconciliation/statement-lines", "Ingest a bank or provider settlement line and reconcile it"],
  ["GET", "/exceptions", "Unresolved exceptions, severity-ordered, each with an owner and a dueDate"],
  ["POST", "/exceptions/{id}/{assign|notes|evidence|resolve|reopen}", "Resolution only when its conditions are met; never allocates funds"],
  ["GET · POST", "/liquidity", "Liquidity view (sample, or for a supplied workspace / instant)"],
  ["GET · POST", "/funding-advances", "Funding projection · prepare an advance funding a supplier payout"],
  ["POST", "/funding-advances/{id}/decision", "Treasury decision (checker ≠ preparer)"],
  ["GET · POST", "/repayments", "Obligations and allocations · ingest a customer receipt (allocated only by repayment reference)"],
  ["GET · POST", "/investigations/{intentId}", "Investigation view: provider-reported vs independent evidence, unknowns, who acts, next actions"],
  ["POST", "/actions", "Apply any engine action"],
];

const errors: [string, string, string][] = [
  ["unauthenticated", "401", "Missing example bearer key"],
  ["unauthorized_actor · maker_checker_violation", "403", "Role not permitted, or the checker is the maker"],
  ["not_found · unknown_endpoint", "404", "Entity or endpoint does not exist"],
  ["idempotency_conflict · duplicate_statement_line · invalid_transition", "409", "Key reused with a different body; line already ingested; transition not allowed"],
  ["resolution_not_permitted · hold_requires_human_decision · quote_expired", "409", "Conditions not met; undecided compliance hold; quote past expiresAt"],
  ["invalid_amount · invalid_currency · currency_mismatch · invalid_field · quote_ineligible · precondition_failed", "422", "Malformed input, mixed currencies, ineligible route or a missing prior step"],
];

const execRows: [ExecState, string][] = [
  ["created", "quoted, cancelled, expired"],
  ["quoted", "quoted, approved, cancelled, expired"],
  ["approved", "submitted, cancelled, expired"],
  ["submitted", "in_transit, provider_reported_completed, awaiting_information, on_hold, failed, returned"],
  ["in_transit", "provider_reported_completed, awaiting_information, on_hold, failed, returned"],
  ["awaiting_information", "in_transit, on_hold, failed, cancelled (an operator cannot cancel after submission)"],
  ["on_hold", "in_transit only after the partner's release report and the reviewer's release; cancelled only by the reviewer's reject. Any other provider event is recorded as a contradiction and changes nothing"],
  ["provider_reported_completed", "returned"],
  ["failed", "terminal"], ["returned", "terminal"], ["cancelled", "terminal"], ["expired", "terminal"],
];

export default function Developers() {
  return (
    <main id="main">
      <PageHero eyebrow="Developers · test mode" title={<>One payment lifecycle. <em>Three separate statuses.</em></>}
        stages={["synthetic", "none"]}
        actions={<><ButtonLink href="#quickstart" main>Start the quickstart</ButtonLink><ButtonLink href={API_DOCS_URL} variant="secondary">API reference in the console</ButtonLink></>}>
        <p>The test API at <code className="inline">/api/clearline/test/v1</code> exposes the sandbox engine statelessly: send the <code className="inline">workspace</code> you hold, or omit it to start from the five-scenario sample. Nothing is persisted and no money moves. The example key <code className="inline">cl_test_demo</code> is public and is not a credential.</p>
      </PageHero>

      <Section id="quickstart" tone="white" eyebrow="Quickstart" title="Create an intent in one request"
        intro={<p>Send <code className="inline">Authorization: Bearer cl_test_demo</code>, <code className="inline">Content-Type: application/json</code> and an <code className="inline">Idempotency-Key</code>. Amounts are integer minor units (USDC has 6 decimals). Same key and same body returns the original intent; same key and a different body returns 409.</p>}>
        <div className="grid-2">
          <div><p className="code-title">Request</p><pre className="code" tabIndex={0} aria-label="Create intent request">{quickstart}</pre></div>
          <div><p className="code-title">Response (abridged)</p><pre className="code" tabIndex={0} aria-label="Create intent response">{intentResponse}</pre></div>
        </div>
        <p className="code-title" style={{ marginTop: 32 }}>Then: quote, choose, approve, submit, simulate, reconcile</p>
        <pre className="code" tabIndex={0} aria-label="Full flow sketch">{flow}</pre>
        <p className="note" style={{ marginTop: 24 }}><b>Maker-checker here is a workflow rule, not an authentication boundary.</b> The public test API is stateless and uses a public example key, so any caller can choose any simulated actor with <code className="inline">X-Clearline-Actor</code>, and nothing is stored server-side. The engine enforces separation of duties for honest callers (a maker approving their own instruction gets 403 <code className="inline">maker_checker_violation</code>), but it cannot stop someone from claiming to be a different actor. A real deployment would need authenticated users and server-side state.</p>
        <p className="caption" style={{ marginTop: 12 }}>Actors are fictional: <code className="inline">usr_maya</code> (operator, default maker), <code className="inline">usr_daniel</code> (approver, default checker), <code className="inline">usr_priya</code> (compliance), <code className="inline">usr_sam</code>, <code className="inline">usr_alex</code> (viewer). Select one with <code className="inline">X-Clearline-Actor</code>.</p>
      </Section>

      <Section id="endpoints" eyebrow="Endpoints" title="Everything under /api/clearline/test/v1"
        intro={<p>Every successful POST returns <code className="inline">data</code>, <code className="inline">outcome</code>, the appended <code className="inline">audit</code> events, the new <code className="inline">workspace</code> and <code className="inline">persisted: false</code>. GET endpoints read the sample workspace. The full contract is the <ExtLink href={OPENAPI_URL}>OpenAPI 3.1 document</ExtLink>.</p>}>
        <TableWrap label="Test API endpoints" caption="As described in the OpenAPI 3.1 document served at /clearline/docs/openapi.yaml. The earlier unversioned test endpoints are retired and return 410 endpoint_retired; use /v1.">
          <thead><tr><th scope="col">Method</th><th scope="col">Path</th><th scope="col">What it does</th></tr></thead>
          <tbody>{endpoints.map(([m, p, d]) => <tr key={p + m}><td className="mono">{m}</td><td className="mono">{p}</td><td>{d}</td></tr>)}</tbody>
        </TableWrap>
        <h3 className="h3" style={{ margin: "40px 0 12px" }}>Errors</h3>
        <TableWrap label="Error codes" caption={`Errors are { "error": { "code", "message", "help", "field?", "entityId?" } }.`}>
          <thead><tr><th scope="col">code</th><th scope="col">HTTP</th><th scope="col">Meaning</th></tr></thead>
          <tbody>{errors.map(([c, h, m]) => <tr key={c}><td className="mono">{c}</td><td className="mono">{h}</td><td>{m}</td></tr>)}</tbody>
        </TableWrap>
      </Section>

      <Section id="status-model" tone="white" eyebrow="Status model" title="execution, settlement, reconciliation"
        intro={<><p>Every payment intent carries <code className="inline">status: {"{"} execution, settlement, settlementScope, reconciliation {"}"}</code>. There is no combined status. A provider&rsquo;s &ldquo;completed&rdquo; sets execution to <code className="inline">provider_reported_completed</code> and never, on its own, sets settlement <code className="inline">verified</code> or reconciliation <code className="inline">matched</code>.</p>
          <p>When a bank-statement debit is matched to the payout by its trusted reference, amount, currency and value-date window, settlement becomes <code className="inline">verified</code> with scope <code className="inline">bank_statement</code> and reconciliation becomes <code className="inline">matched</code>. That evidences the payout leaving your account. <b>The beneficiary&rsquo;s credit can still be unknown</b>, and the investigation view says so.</p>
          <p>Returned payouts also carry <code className="inline">returnStatus</code>: <code className="inline">provider_reported</code> when the provider reports the return, then <code className="inline">confirmed_by_statement</code> once a return line with the trusted reference is allocated (<code className="inline">RC_RETURN_CONFIRMS_PROVIDER_RETURN</code>). Reconciliation is <code className="inline">exception</code> from the moment of the return and stays so until a person resolves the <code className="inline">returned_payout</code> exception, because the supplier is still unpaid.</p>
          <p>Chain evidence (synthetic testnet) applies only to a USDC payout on the Base Sepolia route that is <code className="inline">submitted</code>, <code className="inline">in_transit</code> or <code className="inline">provider_reported_completed</code>; anything else is refused with <code className="inline">precondition_failed</code>. The transfer must go to the beneficiary wallet for the exact expected amount, and one transaction hash can evidence only one payout. A wrong wallet, wrong amount, reused hash or second hash raises <code className="inline">contradictory_evidence</code> and changes no status. Finality sets settlement only; reconciliation becomes <code className="inline">matched</code> only when the provider reported the same transaction hash.</p></>}>
        <h3 className="h3" style={{ marginBottom: 12 }}>execution (ExecutionState)</h3>
        <TableWrap label="Execution states and allowed transitions" caption="EXECUTION_TRANSITIONS in the engine. Anything else is rejected with invalid_transition.">
          <thead><tr><th scope="col">State</th><th scope="col">Allowed next</th></tr></thead>
          <tbody>{execRows.map(([s, n]) => <tr key={s}><td><ExecStatus state={s} /></td><td className="mono">{n}</td></tr>)}</tbody>
        </TableWrap>
        <div className="grid-2" style={{ marginTop: 40 }}>
          <div>
            <h3 className="h3" style={{ marginBottom: 12 }}>settlement (SettlementEvidenceState)</h3>
            <TableWrap label="Settlement evidence states" caption="settlementScope says what was evidenced: provider_report, bank_statement or onchain_transfer. An on-chain transfer never proves a bank credit.">
              <thead><tr><th scope="col">State</th><th scope="col">Meaning</th></tr></thead>
              <tbody>
                <tr><td><SettlementStatus state="none" /></td><td>No settlement evidence recorded.</td></tr>
                <tr><td><SettlementStatus state="observed" /></td><td>Some evidence exists but does not settle the question: a chain transfer at 0 confirmations, a bank line covering only part of the amount, or a provider settlement report (scope <code className="inline">provider_report</code>). A provider settlement report is never allocated and never reconciles on its own (<code className="inline">RC_PROVIDER_REPORT_ONLY</code>, outcome <code className="inline">recorded_provider_report</code>); a later bank line allocates and verifies.</td></tr>
                <tr><td><SettlementStatus state="pending_finality" /></td><td>Confirmations are accumulating below the threshold (12 on the testnet route).</td></tr>
                <tr><td><SettlementStatus state="verified" scope="bank_statement" /></td><td>A full-amount bank-statement match (scope <code className="inline">bank_statement</code>), or a synthetic Base Sepolia transfer past the 12-confirmation finality threshold (scope <code className="inline">onchain_transfer</code>). The scope limits what it proves.</td></tr>
                <tr><td><SettlementStatus state="contradicted" /></td><td>Sources disagree, e.g. a return line against a completed report or a chain amount that differs. A <code className="inline">contradictory_evidence</code> exception is raised.</td></tr>
              </tbody>
            </TableWrap>
          </div>
          <div>
            <h3 className="h3" style={{ marginBottom: 12 }}>reconciliation (ReconciliationState)</h3>
            <TableWrap label="Reconciliation states" caption="Amount alone is never treated as attribution.">
              <thead><tr><th scope="col">State</th><th scope="col">Meaning</th></tr></thead>
              <tbody>
                <tr><td><ReconStatus state="not_started" /></td><td>Nothing submitted to reconcile yet.</td></tr>
                <tr><td><ReconStatus state="pending" /></td><td>Submitted; no allocated statement line yet.</td></tr>
                <tr><td><ReconStatus state="matched" /></td><td>A line was allocated on trusted reference, amount, currency and value-date window.</td></tr>
                <tr><td><ReconStatus state="partially_matched" /></td><td>The reference agrees but the amount covers only part; the remainder stays outstanding.</td></tr>
                <tr><td><ReconStatus state="exception" /></td><td>Something disagrees, or the provider reported a return. Each exception has an owner and a due date. A return stays an exception even after a statement line confirms it, until a person resolves it.</td></tr>
              </tbody>
            </TableWrap>
          </div>
        </div>
      </Section>

      <Section id="webhooks" eyebrow="Webhooks" title="Signed sandbox events, verified on raw bytes"
        intro={<p><code className="inline">POST /events/webhook</code> ingests a signed sandbox webhook. Header <code className="inline">X-Sandbox-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256(secret, t + &quot;.&quot; + rawBody)&gt;</code>, 300-second tolerance, constant-time compare.</p>}>
        <div className="grid-2">
          <div><p className="code-title">Verify a signature</p><pre className="code" tabIndex={0} aria-label="Signature verification example">{verify}</pre></div>
          <ul className="bullets">
            <li>Invalid signatures are recorded with <code className="inline">processingOutcome: rejected_signature</code> and never applied.</li>
            <li>Duplicates are deduplicated by provider and event id (<code className="inline">duplicate_ignored</code>).</li>
            <li>A late, out-of-order event is stored without moving the payment backwards (<code className="inline">stored_late_no_regression</code>).</li>
            <li>A contradictory event raises an exception (<code className="inline">contradictory_exception_raised</code>); a missing event can time out (<code className="inline">timeout_exception_raised</code>).</li>
            <li><code className="inline">payout.completed</code> means <code className="inline">provider_reported_completed</code>: a provider claim, not settlement.</li>
            <li>Sandbox secrets are public (<code className="inline">test_whsec_&lt;providerId&gt;_public_example</code>) and protect nothing.</li>
          </ul>
        </div>
      </Section>

      <Section id="limitations" tone="canvas" eyebrow="Limitations" title="What the test API does not do">
        <div className="grid-2">
          <ul className="bullets">
            <li>Sandbox only: fictional providers (Northline, Harbour FX, Tidewater). No provider, bank or wallet calls. No money movement, custody or keys.</li>
            <li>No persistence: nothing is stored server-side. Your client holds the workspace; the console keeps it in browser storage.</li>
            <li>Quotes are indicative and not executable. Liquidity classifications are an illustrative policy, not regulatory ones.</li>
          </ul>
          <ul className="bullets">
            <li>No real outbound webhooks, endpoint registration, secret rotation, replay protection or delivery retries.</li>
            <li>No real settlement evidence: statement lines and chain observations are fictional inputs you supply.</li>
            <li>No credit, lending or compliance decisions. A held payout leaves the hold only through people: the partner reports the release and the assigned compliance reviewer records a release decision, or the reviewer rejects it. No provider event alone moves it. Do not send real data.</li>
            <li>Request limits: bodies up to 512 KB (else 422 <code className="inline">invalid_json</code>), at most 1,000 items per workspace collection (audit 10,000; else 400), and workspace nesting no deeper than 32 levels.</li>
          </ul>
        </div>
        <p style={{ marginTop: 24 }}><ExtLink href={API_DOCS_URL}>Open the API reference in the console</ExtLink> · <ExtLink href={OPENAPI_URL}>OpenAPI 3.1 document (openapi.yaml)</ExtLink></p>
      </Section>

      <ContactBand title="Building payment operations tooling? Compare notes." />
    </main>
  );
}
