import type { Metadata } from "next";
import Link from "next/link";
import { Notice, PageHead, Panel, ui } from "@/components/clearline/ui";

export const metadata: Metadata = {
  title: "Connect API reference — Clearline test mode",
  description: "The developer API for fictional payment intents, routes and event timelines.",
};

const examples = [
  { title: "Create intent", path: "POST /api/clearline/test/intents", summary: "Draft a fictional payment instruction. No partner is contacted.", body: '{"amount":"48215.37","currency":"SGD","destinationCurrency":"PHP","beneficiary":"Supplier Alpha","purpose":"Invoice","reference":"INV-2026-137"}' },
  { title: "Request quotes", path: "POST /api/clearline/test/quotes", summary: "Three illustrated eligible routes and one excluded route with the reason.", body: '{"amountMinor":4821537,"currency":"SGD","destinationCurrency":"PHP","kycTier":2}' },
  { title: "Advance state", path: "POST /api/clearline/test/transitions", summary: "Include the complete synthetic payment object from the previous response and an allowed target state.", body: '{"payment":{"id":"pi_test_example","status":"created","timeline":[],"reference":"INV-2026-137","beneficiary":"Supplier Alpha","purpose":"Invoice","from":"SGD","to":"PHP","amountMinor":4821537,"scenario":"happy","provider":"Unassigned","createdAt":"2026-11-13T00:00:00Z"},"to":"quoted"}' },
  { title: "Create signed test event", path: "POST /api/clearline/test/webhooks", summary: "Returns a sample HMAC signature and simulated delivery outcome. Nothing is sent outside the server.", body: '{"type":"payout.completed","paymentId":"pi_test_example"}' },
];

const pre: React.CSSProperties = { background: "var(--cl-ink)", color: "#F5F1E8", borderRadius: 5, padding: 14, overflowX: "auto", fontSize: 12, lineHeight: 1.7, fontFamily: "var(--cl-font-mono)", margin: "8px 0 0", whiteSpace: "pre" };
const preLight: React.CSSProperties = { ...pre, background: "var(--cl-paper-2)", color: "var(--cl-ink)", border: "1px solid var(--cl-line)" };

export default function Docs() {
  return (
    <>
      <PageHead eyebrow="Connect / developer API reference" title="Build on one payment lifecycle."
        lede="Create a payment intent, compare eligible routes, simulate partner status updates and inspect the timeline. These endpoints are public synthetic examples, not a payment service." />
      <Notice><strong>No real execution.</strong> Do not send confidential customer or beneficiary details. The test key is public; requests are stateless, illustrative and not persisted on the server. The console workspace keeps its own state in your browser only.</Notice>
      <Panel title="Quickstart" id="quickstart">
        <div className={ui.panelBody}>
          <p style={{ margin: 0 }}>Send <code>Authorization: Bearer cl_test_demo</code> and <code>Content-Type: application/json</code>.</p>
          <pre style={pre} tabIndex={0} aria-label="Quickstart curl example">{'curl -X POST "$BASE/api/clearline/test/intents" \\\n -H "Authorization: Bearer cl_test_demo" \\\n -H "Content-Type: application/json" \\\n -d ' + "'" + examples[0].body + "'"}</pre>
        </div>
      </Panel>
      <Panel title="Payment states" id="states">
        <div className={ui.panelBody}>
          <pre style={preLight} tabIndex={0} aria-label="State diagram">{"created → quoted → approved → submitted → in_transit → completed\n                                      ↘ on_hold / failed / returned"}</pre>
          <p>Only the allowed transitions are accepted. A partner-reported completion is not independently verified settlement.</p>
        </div>
      </Panel>
      {examples.map((e, i) => (
        <Panel key={e.path} title={e.title} id={"ex" + i}>
          <div className={ui.panelBody}>
            <code className={ui.code}>{e.path}</code>
            <p className={ui.hint} style={{ fontSize: 13 }}>{e.summary}</p>
            <pre style={preLight} tabIndex={0} aria-label={e.title + " request body"}>{e.body}</pre>
          </div>
        </Panel>
      ))}
      <Panel title="Webhooks and errors" id="webhooks">
        <div className={ui.panelBody}>
          <p style={{ marginTop: 0 }}>Signature: HMAC-SHA256 of timestamp + &quot;.&quot; + exact payload, format <code>t=timestamp,v1=hex</code>. The example signing secret is public; no real outbound delivery, retry queue or replay protection is provided.</p>
          <p>401: missing test key. 404: unknown endpoint. 422: invalid fields or forbidden transition. Errors include a short message and a suggested fix.</p>
          <p className={ui.hint} style={{ fontSize: 13 }}>Clearline does not hold funds, make compliance decisions or perform payout execution in this preview. <Link href="/clearline">Back to the console</Link>.</p>
        </div>
      </Panel>
    </>
  );
}
