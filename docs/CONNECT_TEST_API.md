# Connect sandbox API (legacy) — RETIRED

**Status (2026-11-13):** retired. The unversioned endpoints `/api/clearline/test/{intents,quotes,transitions,webhooks,payments,health}` no longer execute anything. They ran on an old prototype engine (floating-point amounts, USDC with 2 decimals, a weaker webhook verifier) that has been removed.

| Request | Response |
|---|---|
| Invalid under the old contract (e.g. an unsupported currency, extra intent fields, an impossible transition) | **422** `invalid_request`, with `error.replacement: "/api/clearline/test/v1"` |
| Any other request (any method) | **410 Gone** `endpoint_retired`, with `error.replacement: "/api/clearline/test/v1"` |

## Use the v1 test API instead

- **Base URL:** `/api/clearline/test/v1`
- **Reference:** `docs/clearline/openapi.yaml` (OpenAPI 3.1), `docs/clearline/ENGINE_API.md`, and the in-app reference at `/clearline/docs`.
- **Auth:** `Authorization: Bearer cl_test_demo`. This is a public example key, not a credential.
- **Stateless:** send the `workspace` returned by the previous call, or omit it to start from the fictional sample.

The v1 API runs on the unified engine in `src/lib/clearline`: integer minor units (USDC uses 6 decimals), separate status dimensions, signed sandbox webhooks with a time tolerance, reconciliation only by trusted reference, and holds that a provider event never releases. Maker/checker in this stateless API demonstrates the rule; it is not an access control.

**Test mode only.** No provider calls, bank operations, signing authority, customer data or money movement.
