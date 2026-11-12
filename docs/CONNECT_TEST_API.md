# Connect sandbox API

**Test mode only.** No provider calls, bank account operations, signing authority, customer data or money movement. This API returns **stateless, synthetic responses**: it does not store a payment across requests. The linked browser console uses local browser storage for its test-mode workflow.

Base URL: \`/api/clearline/test\`

Send \`Authorization: Bearer cl_test_demo\` and \`Content-Type: application/json\`. This example key is public and **not a credential**. Never send real customer or beneficiary personal data.

## 1. Create a fictional payment intent

\`\`\`sh
curl -X POST "$BASE/api/clearline/test/intents" \
 -H 'Authorization: Bearer cl_test_demo' -H 'Content-Type: application/json' \
 -d '{"amount":"48215.37","currency":"SGD","destinationCurrency":"PHP","beneficiary":"Supplier Alpha","purpose":"Invoice","reference":"INV-2026-137"}'
\`\`\`

Returns \`201\`, \`data.id\` (\`pi_test_...\`), \`data.status: created\`, and \`persisted:false\`.

## 2. Get synthetic quote comparisons

\`\`\`sh
curl -X POST "$BASE/api/clearline/test/quotes" \
 -H 'Authorization: Bearer cl_test_demo' -H 'Content-Type: application/json' \
 -d '{"amountMinor":4821537,"currency":"SGD","destinationCurrency":"PHP","kycTier":2}'
\`\`\`

Returns three eligible sandbox routes (two fiat, one Base Sepolia testnet) and one excluded route with a reason. FX rates, fees and ETA are fixed illustrations, **not executable offers**.

## 3. Apply a state transition

\`\`\`sh
curl -X POST "$BASE/api/clearline/test/transitions" \
 -H 'Authorization: Bearer cl_test_demo' -H 'Content-Type: application/json' \
 -d '{"payment":{"...":"Full previous synthetic payment object"},"to":"quoted"}'
\`\`\`

This is a pure stateless validation of a supplied fictional payment object. Allowed path: \`created → quoted → approved → submitted → in_transit → completed\`. Additional paths permit \`failed\`, \`returned\` and \`on_hold\`. Illegal transitions return HTTP 422. Every event is a **simulated status**, not independent evidence of settlement.

## 4. Trigger a test webhook

\`\`\`sh
curl -X POST "$BASE/api/clearline/test/webhooks" \
 -H 'Authorization: Bearer cl_test_demo' -H 'Content-Type: application/json' \
 -d '{"type":"payout.completed","paymentId":"pi_test_8f3k2"}'
\`\`\`

Returns \`payload\`, \`signature\`, and a simulated delivery receipt. Signature format: \`t=<unix seconds>,v1=<hex HMAC-SHA256 of t + "." + payload>\`. The example signing secret is publicly known and protects **nothing**. The production design needs per-endpoint secrets, rotation, timestamp-tolerance enforcement, constant-time compare, retry queues, deduplication and real delivery logs.

## State model

\`\`\`
created ─→ quoted ─→ approved ─→ submitted ─→ in_transit ─→ completed
  │         │          │             │               ├────→ returned
  └→ failed ←──────────┘             ├→ on_hold      └────→ failed
                                          └→ on_hold → review → resume / fail
\`\`\`

No Clearline funds custody or financial execution. Partner status reports are never labeled as independent settlement verification.

## Error format

HTTP 401: missing example bearer key. HTTP 404: unknown endpoint. HTTP 422: invalid fields, state transition or non-fictional input. Every error includes a short \`error.message\` and \`error.help\`.

TypeScript:

\`\`\`ts
const response = await fetch("/api/clearline/test/quotes", {
  method: "POST",
  headers: { authorization: "Bearer cl_test_demo", "content-type": "application/json" },
  body: JSON.stringify({ amountMinor: 4821537, currency: "SGD", destinationCurrency: "PHP", kycTier: 2 }),
});
if (!response.ok) throw new Error((await response.json()).error.message);
const { data: quotes } = await response.json();
\`\`\`

**The sample \`BASE\` must be a reachable approved preview URL.** This documentation does not imply that a deployment or a live payment partner exists.
