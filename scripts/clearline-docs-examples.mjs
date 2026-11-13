#!/usr/bin/env node
// Captures the example requests and responses shown on /clearline/docs from a RUNNING v1 test API,
// abridges them (workspace bodies, long arrays) and writes src/components/clearline/docs-examples.json.
//
//   npx next build && npx next start -p 3191 &
//   node scripts/clearline-docs-examples.mjs http://127.0.0.1:3191
//
// Everything is synthetic test-mode data. Re-run after engine changes; the page shows the capture date.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ORIGIN = (process.argv[2] ?? "http://127.0.0.1:3191").replace(/\/$/, "");
const PREFIX = "/api/clearline/test/v1";
const KEY = { Authorization: "Bearer cl_test_demo", "Content-Type": "application/json" };
const MORE = (n) => `__MORE_${n}__`;
const examples = [];

/** Keeps the first `keep` items of every array and replaces nested workspaces. */
function abridge(v, keep = 2, depth = 0) {
  if (Array.isArray(v)) {
    const head = v.slice(0, keep).map((x) => abridge(x, keep, depth + 1));
    return v.length > keep ? [...head, MORE(v.length - keep)] : head;
  }
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "workspace" && x && typeof x === "object") o[k] = `__WS_${Math.round(JSON.stringify(x).length / 1024)}__`;
      else o[k] = abridge(x, keep, depth + 1);
    }
    return o;
  }
  return v;
}
const show = (v) =>
  JSON.stringify(v, null, 2)
    .replace(/"__MORE_(\d+)__"/g, "/* $1 more */")
    .replace(/"__WS_(\d+)__"/g, (_, kb) => `{ /* full workspace, about ${kb} KB, abridged here */ }`)
    .replace(/"__PREV_WS__"/g, "{ /* the workspace from the previous response */ }");

async function call(id, title, method, path, body, { headers = {}, pick, note } = {}) {
  const r = await fetch(ORIGIN + PREFIX + path, { method, headers: { ...KEY, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await r.json();
  const shownReq = body === undefined ? undefined : { ...body, ...(body.workspace ? { workspace: "__PREV_WS__" } : {}) };
  const shownRes = pick ? pick(json) : json;
  const sentHeaders = Object.entries({ ...KEY, ...headers }).filter(([, v]) => v).filter(([k]) => method === "POST" || k !== "Content-Type");
  examples.push({ id, title, method, path: PREFIX + path, headers: sentHeaders.map(([k, v]) => `${k}: ${v}`), request: shownReq === undefined ? null : show(shownReq), status: r.status, response: show(abridge(shownRes)), note: note ? note(json) : null });
  return json;
}

const statusOf = (ws, id) => ws.intents.find((i) => i.id === id)?.status;
const eventFields = (r) => ({
  data: (({ providerEventId, normalizedType, sequence, signatureResult, dedupeKey, processingOutcome, provenance }) => ({ providerEventId, normalizedType, sequence, signatureResult, dedupeKey, processingOutcome, provenance }))(r.data),
  outcome: r.outcome,
  audit: r.audit,
  workspace: r.workspace,
});

const input = {
  internalReference: "INV-DOCS-0001", amountMinor: 1250000, sourceCurrency: "SGD", destinationCurrency: "PHP",
  purpose: "Supplier invoice", beneficiaryRef: "ben_docs_1", beneficiaryName: "Example Supplier (fictional)",
  destinationCountry: "PH", requestedExecutionDate: "2026-11-14", idempotencyKey: "docs-example-0001",
};

await call("health", "Health (no key needed)", "GET", "/health");
let r = await call("create-intent", "Create a payment intent from the sample workspace", "POST", "/intents", { input });
let ws = r.workspace;
const intentId = r.data.id;
await call("replay", "Same idempotency key, same body: the original intent", "POST", "/intents", { workspace: ws, input }, { pick: (j) => ({ data: { id: j.data.id, status: j.data.status }, outcome: j.outcome, audit: j.audit }) });
await call("conflict", "Same idempotency key, different body", "POST", "/intents", { workspace: ws, input: { ...input, amountMinor: 1250001 } });
r = await call("quotes", "Request indicative quotes", "POST", `/intents/${intentId}/quotes`, { workspace: ws }, {
  pick: (j) => ({ ...j, data: [j.data.find((q) => q.eligible), j.data.find((q) => !q.eligible), `__MORE_${j.data.length - 2}__`] }),
});
ws = r.workspace;
const quote = r.data.find((q) => q.eligible);
r = await call("choose-route", "Choose a route (the maker)", "POST", "/instructions", { workspace: ws, intentId, quoteId: quote.id });
ws = r.workspace;
const instrId = r.data.id;
await call("self-approve", "The maker tries to approve their own instruction", "POST", `/instructions/${instrId}/approve`, { workspace: ws }, { headers: { "X-Clearline-Actor": "usr_maya" } });
r = await call("approve", "A different checker approves", "POST", `/instructions/${instrId}/approve`, { workspace: ws }, { headers: { "X-Clearline-Actor": "usr_daniel" } });
ws = r.workspace;
r = await call("submit", "Submit to the sandbox provider", "POST", `/instructions/${instrId}/submit`, { workspace: ws }, {
  note: (j) => `Status afterwards (from response.workspace): ${JSON.stringify(statusOf(j.workspace, intentId))}`,
});
ws = r.workspace;
const instr = r.data;
r = await call("simulate", "Simulate the provider's next event", "POST", "/events/simulate", { workspace: ws, intentId }, {
  pick: (j) => ({ ...j, data: j.data.map((e) => ({ providerEventId: e.providerEventId, normalizedType: e.normalizedType, sequence: e.sequence, processingOutcome: e.processingOutcome, provenance: e.provenance })) }),
  note: (j) => `Status afterwards: ${JSON.stringify(statusOf(j.workspace, intentId))}`,
});
ws = r.workspace;

const t = Math.floor(Date.parse(ws.asOf) / 1000);
const secret = `test_whsec_${instr.providerId}_public_example`;
const sign = (raw) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
const completed = JSON.stringify({ id: "evt_docs_completed", type: "payout.completed", provider_payment_id: instr.providerPaymentId, sequence: 5, occurred_at: ws.asOf });
const late = JSON.stringify({ id: "evt_docs_in_transit_late", type: "payout.in_transit", provider_payment_id: instr.providerPaymentId, sequence: 3, occurred_at: ws.asOf });
const statusNote = (j) => `Status afterwards: ${JSON.stringify(statusOf(j.workspace, intentId))}`;

r = await call("webhook", "Signed webhook: provider reports completed", "POST", "/events/webhook", { workspace: ws, providerId: instr.providerId, rawBody: completed }, { headers: { "X-Sandbox-Signature": sign(completed) }, pick: eventFields, note: statusNote });
ws = r.workspace;
await call("webhook-duplicate", "The same delivery again", "POST", "/events/webhook", { workspace: ws, providerId: instr.providerId, rawBody: completed }, { headers: { "X-Sandbox-Signature": sign(completed) }, pick: eventFields, note: statusNote });
await call("webhook-late", "An earlier event arrives late (sequence 3 after 5)", "POST", "/events/webhook", { workspace: ws, providerId: instr.providerId, rawBody: late }, { headers: { "X-Sandbox-Signature": sign(late) }, pick: eventFields, note: statusNote });
const tampered = late.replace("late", "tampered");
await call("webhook-bad-signature", "Body changed after signing", "POST", "/events/webhook", { workspace: ws, providerId: instr.providerId, rawBody: tampered }, { headers: { "X-Sandbox-Signature": sign(late) }, pick: eventFields, note: statusNote });
await call("webhook-stale", "Valid signature, but 301 s outside the window", "POST", "/events/webhook", { workspace: ws, providerId: instr.providerId, rawBody: late, at: new Date((t + 301) * 1000).toISOString() }, { headers: { "X-Sandbox-Signature": sign(late) }, pick: eventFields, note: statusNote });
await call("verify", "Sample verifier", "POST", "/webhooks/verify", { providerId: instr.providerId, rawBody: completed, signatureHeader: sign(completed), at: ws.asOf });
await call("verify-stale", "Sample verifier, 301 s later", "POST", "/webhooks/verify", { providerId: instr.providerId, rawBody: completed, signatureHeader: sign(completed), at: new Date((t + 301) * 1000).toISOString() });

const sample = (await (await fetch(ORIGIN + PREFIX + "/intents", { headers: KEY })).json()).data;
const s1 = sample.find((i) => i.scenario === "s1_success");
await call("investigation", "Investigation of sample scenario 1", "GET", `/investigations/${s1.id}`, undefined, {
  pick: (j) => {
    const d = { ...j.data };
    if (d.providerReported?.events) d.providerReported = { ...d.providerReported, events: d.providerReported.events.map((e) => ({ providerEventId: e.providerEventId, normalizedType: e.normalizedType, confidence: e.confidence, processingOutcome: e.processingOutcome })) };
    delete d.requested; delete d.approval;
    return { ...j, data: d };
  },
});
await call("no-key", "Missing key", "GET", "/intents", undefined, { headers: { Authorization: "" } });
await call("unknown", "Unknown endpoint", "GET", "/payments-v2");
await call("bad-amount", "Amount not in integer minor units", "POST", "/intents", { input: { ...input, idempotencyKey: "docs-example-0002", amountMinor: 12.5 } });

let revision = "unknown";
try { revision = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not a checkout */ }
const out = { capturedAt: new Date().toISOString().slice(0, 10), revision, examples };
writeFileSync(new URL("../src/components/clearline/docs-examples.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${examples.length} examples (revision ${revision}).`);
for (const e of examples) console.log(`${e.status} ${e.method} ${e.path}`);
