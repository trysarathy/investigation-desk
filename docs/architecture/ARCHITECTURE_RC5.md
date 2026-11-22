# Clearline Control — architecture (rc5)

**Status, 22 Nov 2026.** This describes what is **built and tested locally** on fictional data. Nothing here is hosted. No real payment, bank, ledger or provider is connected. "Built" means code exists, with tests that ran in this session (`docs/release/TEST_RESULTS_RC5.md`).

## 1. Two products in one code base, never on one deployment

| Surface | Paths | Identity | Data | Who can reach it |
|---|---|---|---|---|
| **Public fictional demo** (unchanged rc4 sandbox) | `/clearline/**`, `/api/clearline/test/v1` | simulated "Acting as" picker (labelled) | browser localStorage, sample data | anyone (public previews) |
| **Clearline Control pilot** (new, private staging candidate) | `/control/**`, `/api/control/**`, `/api/auth/**` | real sign-in (Better Auth), server-side sessions | PostgreSQL 16, per organisation | only with `CLEARLINE_CONTROL_PILOT=1`; nothing hosted yet |

`src/middleware.ts:deploymentGate` enforces the separation:
- **A pilot deployment** serves only the pilot paths.
- **Every other deployment** returns 404 for them.

`next.config.mjs:deploymentConfigProblems` refuses a pilot that is combined with a demo mode, that lacks a strong secret, an origin or the runtime database login, or that points at the owner login.

## 2. Layers

```
Browser ──HTTPS──▶ Next.js (App Router)
                    │  src/middleware.ts        deployment gate + nonce CSP
                    │  src/app/api/auth/**      Better Auth endpoints (behind exact-Origin check)
                    │  src/app/api/control/**   JSON API  ─┐
                    │  src/app/control/**       pages     ─┤
                    ▼                                       ▼
   src/server/http.ts        Origin check (CSRF), error mapping (no internals leaked)
   src/server/auth.ts        session cookie → Principal (user id, name, email)
   src/server/tenant.ts      Principal + selected org → TenantContext (membership lookup), withTenant(tx)
   src/server/authz.ts       role → permission matrix; engine role mapping
   src/server/control.ts     investigation, maker-checker, reports, idempotency, audit
   src/server/imports.ts     CSV statement import: staged, confirmed by a second person
   src/server/accounting.ts  Accounting Bridge reads/exports (persisted, byte-identical re-render)
   src/server/signin-limit.ts per-account sign-in limit (PostgreSQL)
   src/server/engine-store.ts  rows ⇄ engine Workspace; runEngineAction
                    ▼
   src/lib/clearline/**      THE FINANCIAL ENGINE (unchanged in rc5): pure, deterministic rules
                    ▼
   PostgreSQL 16             RLS per org, append-only audit, maker-checker trigger (drizzle/0001_security.sql)
```

### Rules of the layering
- **No financial rule in route handlers or services.**
  - Services check permissions, then call the engine.
  - The engine decides matching, settlement, reconciliation, resolution guards, maker-checker on accounting, and posting.
  - Its 1,820 existing tests remain the oracle.
- **The actor is always the session user.**
  - `runEngineAction(tx, orgId, userId, action)` has no other actor parameter.
  - `x-clearline-actor` is a header of the public sandbox API only.
- **One transaction per request.**
  - `withTenant` sets `app.user_id` and `app.org_id` with `set_config(..., true)`, which is transaction-local and therefore safe with pooled connections.
  - Every engine action locks the organisation's `org_engine_state` row, which serialises that organisation's financial actions.

## 3. Persistence model

- **Authoritative rows.** The database rows are authoritative, and browser storage is not used by the pilot.
  - Each engine collection has a table (`docs/architecture/DATABASE_SCHEMA_RC5.md`).
  - Each row holds the engine record verbatim in `record jsonb`, plus extracted, constrained columns: amounts in `bigint` minor units, currency, status, owner, intent FK.
- **Action cycle:**
  1. Load the organisation's rows, under RLS, into an engine `Workspace`.
  2. Run the engine's own `parseWorkspaceValue` integrity checks. On failure the request is refused, never repaired silently.
  3. Run `applyAction` as the session user.
  4. Diff the result against what was loaded, and write the inserts and updates in the same transaction.
- **Refusals on save.**
  - A record that would disappear is refused.
  - So is a shorter audit history.
- **Audit.**
  - Engine audit events become `audit_events` rows with `source = 'engine'` and the acting user.
  - Control actions write `source = 'server'` rows: approvals, case details, exports, imports and memberships.
- **Actors.**
  - Engine actors are the organisation's active members, with their mapped engine role, plus the fictional historical actors of the seed.
  - Seed actors can never act: no session maps to them.

## 4. Maker-checker (server-enforced)

- **Requesting.**
  1. Payment Ops proposes a resolution.
  2. The service checks that every cited evidence id exists in this organisation and that the engine's `canResolveCase` / `canResolveException` allows it.
  3. It stores `approval_requests` with an immutable payload and a SHA-256 hash of the canonical payload.
  4. A newer version supersedes the pending one.
- **Deciding.**
  - An Approver decides, sending the hash they reviewed.
  - The service and the database trigger `check_approval_decision` both refuse:
    - the requester;
    - a non-approver or revoked member;
    - a closed request;
    - a different hash.
  - `approval_decisions` is unique per request. Two concurrent approvals produce exactly one decision (tested).
- **The payload binds content, not just ids:** each cited record's SHA-256 and the target's state. Cited evidence must concern the target's payment or be attached to it. On approval both are re-checked; any change → `EVIDENCE_CHANGED`.
- **The database binds the person:** decisions must be recorded for the signed-in user (`app_user_id()`); requests are created pending only and become approved/rejected only with a matching decision.
- **On approval** the engine's `resolve` runs as the approver and re-checks the evidence at that moment.
- **Statement imports** use the same two-person rule: staged by Finance, confirmed by a different Approver who states the staged lines' SHA-256.

## 5. What is not built (and must not be claimed)

- Hosted staging.
- SSO or MFA.
- Member administration in the UI (CLI only); CSV upload and Accounting Bridge screens (services and tests exist; the pages say "Coming in a following change").
- Real provider connections, payment execution, or real ledger posting.
- MT940 and camt.053 import.
- Malware scanning (CSV is parsed as text in memory).
- Backups beyond the documented `pg_dump` procedure.
- Any compliance certification.
