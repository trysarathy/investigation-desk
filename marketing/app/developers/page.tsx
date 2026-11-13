import { ButtonLink, ContactBand, ExtLink, PageHero, Section } from "@/components/Shared";
import { ExecStatus, EvidenceStatus, ReconStatus, type ExecState } from "@/components/Status";
import { TableWrap } from "@/components/Tables";
import { API_DOCS_URL, PRODUCT_DEMO_URL } from "@/lib/site";
import { pageMeta } from "@/lib/meta";

export const metadata = pageMeta(
  "Developers",
  "Clearline Connect test-mode quickstart: sample requests, the execution / evidence / reconciliation status model, webhook signing semantics and current limitations. Fictional data only.",
  "/developers",
);

const BASE = PRODUCT_DEMO_URL + "/api/clearline/test";

const quickstart = `BASE=${BASE}

curl -X POST "$BASE/intents" \\
  -H "Authorization: Bearer cl_test_demo" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":"48215.37","currency":"SGD","destinationCurrency":"PHP",
       "beneficiary":"Supplier Alpha","purpose":"Invoice","reference":"INV-2026-137"}'`;

const intentResponse = `HTTP/1.1 201 Created
X-Clearline-Mode: synthetic-test-only

{
  "data": {
    "id": "pi_test_…",
    "reference": "INV-2026-137",
    "amountMinor": 4821537,
    "from": "SGD", "to": "PHP",
    "status": "created",
    "provider": "Unassigned",
    "timeline": [{ "state": "created", "label": "Payment intent created",
                   "source": "Clearline test mode", "evidence": "Synthetic request accepted" }]
  },
  "mode": "synthetic",
  "persisted": false
}`;

const quotesReq = `curl -X POST "$BASE/quotes" \\
  -H "Authorization: Bearer cl_test_demo" -H "Content-Type: application/json" \\
  -d '{"amountMinor":4821537,"currency":"SGD","destinationCurrency":"PHP","kycTier":2}'

# → 3 eligible sandbox routes + 1 excluded route with "reason": "KYC tier 3 required"`;

const transitionReq = `curl -X POST "$BASE/transitions" \\
  -H "Authorization: Bearer cl_test_demo" -H "Content-Type: application/json" \\
  -d '{"payment": { …the full payment object from the previous response… }, "to": "quoted"}'

# 200 → { "data": {…}, "persisted": false, "partnerExecuted": false }
# 422 → { "error": { "type": "invalid_request",
#                    "message": "Invalid payment transition: created to completed",
#                    "help": "Use fictional test data. See /clearline/docs." } }`;

const webhookReq = `curl -X POST "$BASE/webhooks" \\
  -H "Authorization: Bearer cl_test_demo" -H "Content-Type: application/json" \\
  -d '{"type":"payout.completed","paymentId":"pi_test_8f3k2"}'

{
  "data": { "id": "evt_test_…", "type": "payout.completed", "createdAt": "…",
            "data": { "object": "synthetic_event", "paymentId": "pi_test_8f3k2" } },
  "payload": "<exact JSON string that was signed>",
  "signature": "t=1763017200,v1=5f0c…",
  "delivery": { "attempt": 1, "result": "synthetic_200", "retries": 0 },
  "persisted": false
}`;

const verify = `// Verify a Clearline test signature (Node 18+)
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(payload: string, header: string, secret: string, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(",").map(p => p.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(t + "." + payload).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}`;

const execRows: [ExecState, string, string][] = [
  ["created", "Intent accepted; nothing priced or sent.", "quoted, failed"],
  ["quoted", "Eligible routes priced.", "approved, failed"],
  ["approved", "A person approved a route.", "submitted, on_hold, failed"],
  ["submitted", "Instruction handed to the provider.", "in_transit, on_hold, failed"],
  ["in_transit", "Provider reports the payout in progress.", "completed, returned, on_hold, failed"],
  ["on_hold", "Provider paused it, e.g. a document request.", "submitted, in_transit, returned, failed"],
  ["completed", "Provider reports completion. Terminal.", "none"],
  ["returned", "Provider reports funds returned. Terminal.", "none"],
  ["failed", "Provider or validation failure. Terminal.", "none"],
];

export default function Developers() {
  return (
    <main id="main">
      <PageHero eyebrow="Developers · test mode" title={<>One payment lifecycle. <em>Honest about evidence.</em></>}
        stages={["synthetic", "none"]}
        actions={<><ButtonLink href="#quickstart" main>Start the quickstart</ButtonLink><ButtonLink href={API_DOCS_URL} variant="secondary">API reference in the product</ButtonLink></>}>
        <p>The Connect test API creates fictional payment intents, prices sandbox routes, validates state transitions and signs test webhook events. It is stateless and moves no money. The example key <code className="inline">cl_test_demo</code> is public and is not a credential.</p>
      </PageHero>

      <Section id="quickstart" tone="white" eyebrow="Quickstart" title="Create an intent in one request"
        intro={<p>Send <code className="inline">Authorization: Bearer cl_test_demo</code> and <code className="inline">Content-Type: application/json</code>. Use fictional names and references only.</p>}>
        <div className="grid-2">
          <div><p className="code-title">Request</p><pre className="code" tabIndex={0} aria-label="Create intent request">{quickstart}</pre></div>
          <div><p className="code-title">Response</p><pre className="code" tabIndex={0} aria-label="Create intent response">{intentResponse}</pre></div>
        </div>
        <p className="caption" style={{ marginTop: 12 }}>Also available: <code className="inline">GET /health</code> returns <code className="inline">{`{"mode":"test","canMoveMoney":false}`}</code>; <code className="inline">GET /payments</code> returns the five read-only sample payments.</p>
      </Section>

      <Section eyebrow="Sample requests" title="Quotes, transitions and test webhooks">
        <div className="grid-2">
          <div><p className="code-title">POST /quotes</p><pre className="code" tabIndex={0} aria-label="Quotes request">{quotesReq}</pre></div>
          <div><p className="code-title">POST /transitions</p><pre className="code" tabIndex={0} aria-label="Transition request">{transitionReq}</pre></div>
        </div>
        <TableWrap label="Error codes" caption="Every error includes error.message and error.help.">
          <thead><tr><th scope="col">HTTP</th><th scope="col">When</th></tr></thead>
          <tbody>
            <tr><td className="mono">401</td><td>Missing test key or JSON content type.</td></tr>
            <tr><td className="mono">404</td><td>Unknown endpoint.</td></tr>
            <tr><td className="mono">422</td><td>Invalid fields, a forbidden state transition, a payload over 12 KB or non-fictional input.</td></tr>
          </tbody>
        </TableWrap>
      </Section>

      <Section id="status-model" tone="white" eyebrow="Status model" title="Three statuses, never merged"
        intro={<><p>A payment carries three independent statuses. <code className="inline">provider_reported_completed</code> means a provider said so. <code className="inline">settlement_evidence_verified</code> means independent evidence (a statement line, a settlement export, a final chain transaction) supports it. <code className="inline">reconciled</code> means the instruction, the evidence and the ledger agree by reference.</p><p>Today the test API returns the execution <code className="inline">status</code> only, and its <code className="inline">completed</code> is provider-reported. The evidence and reconciliation statuses are part of the record model shown in the console; they are not yet API fields.</p></>}>
        <h3 className="h3" style={{ marginBottom: 12 }}>Execution status</h3>
        <TableWrap label="Execution states" caption="Allowed transitions are enforced; anything else returns 422.">
          <thead><tr><th scope="col">State</th><th scope="col">Meaning</th><th scope="col">Allowed next</th></tr></thead>
          <tbody>{execRows.map(([s, m, n]) => <tr key={s}><td><ExecStatus state={s} /></td><td>{m}</td><td className="mono">{n}</td></tr>)}</tbody>
        </TableWrap>
        <div className="grid-2" style={{ marginTop: 40 }}>
          <div>
            <h3 className="h3" style={{ marginBottom: 12 }}>Evidence status</h3>
            <TableWrap label="Evidence states" caption="The sandbox never reaches settlement_evidence_verified: it has no independent evidence.">
              <thead><tr><th scope="col">State</th><th scope="col">Meaning</th></tr></thead>
              <tbody>
                <tr><td><EvidenceStatus state="none" /></td><td>No completion claim yet.</td></tr>
                <tr><td><EvidenceStatus state="provider_reported_completed" /></td><td>A provider event says completed. Not proof of settlement or beneficiary credit.</td></tr>
                <tr><td><EvidenceStatus state="settlement_evidence_verified" /></td><td>Independent settlement evidence is attached and checked against the reference.</td></tr>
              </tbody>
            </TableWrap>
          </div>
          <div>
            <h3 className="h3" style={{ marginBottom: 12 }}>Reconciliation status</h3>
            <TableWrap label="Reconciliation states" caption="Matching on amount alone is never accepted.">
              <thead><tr><th scope="col">State</th><th scope="col">Meaning</th></tr></thead>
              <tbody>
                <tr><td><ReconStatus state="unreconciled" /></td><td>No source line considered yet.</td></tr>
                <tr><td><ReconStatus state="matched" /></td><td>Reference, payment ID, currency and amount agree; evidence not yet verified.</td></tr>
                <tr><td><ReconStatus state="exception" /></td><td>Something disagrees; needs an owner.</td></tr>
                <tr><td><ReconStatus state="reconciled" /></td><td>Matched, with verified settlement evidence attached.</td></tr>
              </tbody>
            </TableWrap>
          </div>
        </div>
      </Section>

      <Section id="webhooks" eyebrow="Webhooks" title="Events report what a source said"
        intro={<p>Event types: <code className="inline">intent.created</code>, <code className="inline">quote.accepted</code>, <code className="inline">payout.submitted</code>, <code className="inline">payout.completed</code>, <code className="inline">payout.failed</code>, <code className="inline">payout.returned</code>. A <code className="inline">payout.completed</code> event is provider-reported. Treat it as <code className="inline">provider_reported_completed</code>, never as settlement.</p>}>
        <div className="grid-2">
          <div><p className="code-title">POST /webhooks (signed test event)</p><pre className="code" tabIndex={0} aria-label="Webhook request and response">{webhookReq}</pre></div>
          <div><p className="code-title">Verify the signature</p><pre className="code" tabIndex={0} aria-label="Signature verification example">{verify}</pre></div>
        </div>
        <ul className="bullets" style={{ marginTop: 24, maxWidth: "68ch" }}>
          <li>Signature header format: <code className="inline">t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256 of t + &quot;.&quot; + payload&gt;</code>.</li>
          <li>Sign and verify the exact payload string, not re-serialised JSON.</li>
          <li>The test signing secret is public (<code className="inline">test_webhook_secret_example_only</code>) and protects nothing.</li>
          <li>Design guidance for consumers: deduplicate on event <code className="inline">id</code>, tolerate out-of-order delivery, and read the payment record as the source of truth.</li>
        </ul>
      </Section>

      <Section id="limitations" tone="bluegrey" eyebrow="Limitations" title="What the test API does not do">
        <div className="grid-2">
          <ul className="bullets">
            <li>No provider, bank or wallet calls. No money movement. No signing authority.</li>
            <li>Stateless: nothing is persisted between requests. The browser console keeps its own test state locally.</li>
            <li>Rates, fees and ETAs are fixed illustrations, not executable offers.</li>
          </ul>
          <ul className="bullets">
            <li>No real webhook delivery, retry queue, endpoint registration or secret rotation.</li>
            <li>Evidence and reconciliation statuses are not yet returned by the API.</li>
            <li>Do not send real customer or beneficiary data. The example key is public.</li>
          </ul>
        </div>
        <p style={{ marginTop: 24 }}><ExtLink href={API_DOCS_URL}>Open the API reference served by the product</ExtLink></p>
      </Section>

      <ContactBand title="Building payment operations tooling? Compare notes." />
    </main>
  );
}
