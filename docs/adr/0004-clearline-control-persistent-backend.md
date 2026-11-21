# 4. Clearline Control pilot: persistent, authenticated backend around the existing engine

Date: 2026-11-21 (SGT)

## Status

**Proposed.** Written by the founding-CTO session for the 21 Nov 2026 mandate. It adds no paid infrastructure; it
is confirmed or changed piece by piece in PRs 2 (database) and 3 (authentication) of
`docs/architecture/IMPLEMENTATION_PLAN_RC5.md`. Hosting a staging database is a separate decision that needs the
founder's approval (spending).

## Context

- The Clearline console keeps its only copy of the data in the visitor's browser (`workspace.tsx`, localStorage),
  and the v1 API is stateless (`src/app/api/clearline/test/v1/[...path]/route.ts`). Approver identity comes from a
  picker or the `x-clearline-actor` header. See `docs/architecture/ENGINEERING_AUDIT_RC5.md` §C–F.
- The engine (`src/lib/clearline/**`) is pure and deterministic: `(workspace, action, {actorId, at})` → new
  workspace + audit, or a typed refusal. It has 1,800+ tests and is the most valuable asset.
- The mandate fixes the stack: TypeScript, Next.js, PostgreSQL, Prisma or Drizzle, Zod, Vitest, Playwright, an
  established authentication library, and "extend an existing backend or identity system if one exists".
- Existing identity systems: the Funding Desk's scrypt login (`src/lib/funding/server.ts`), with in-memory
  sessions lost on restart and users in a JSON file; and the `pilot-operating-desk` branch's Python/SQLite server.
  Neither is a Next.js + Postgres identity system with revocable database sessions; both are reused as **design
  references** (throttling, cookie flags, CSRF/origin checks, append-only triggers, per-org numbering), not as code.

## Decision (proposed)

1. **One Next.js app, two separated surfaces.** The public fictional sandbox stays at `/clearline/**` and
   `/api/clearline/test/v1`. The pilot is new: `/control/**` and `/api/control/**`, served only when
   `CLEARLINE_CONTROL_PILOT=1` and a `DATABASE_URL` is configured. No session, cookie or table is shared.
2. **PostgreSQL 16 + Drizzle ORM** (`drizzle-orm`, `drizzle-kit`, `pg`). Migrations are committed SQL so that RLS
   policies, triggers and check constraints are reviewed as SQL.
3. **Tenancy enforced three times:** application queries filter by the session's org; Postgres RLS with
   `FORCE ROW LEVEL SECURITY` and `current_setting('app.org_id')` set per transaction from the authenticated
   membership; composite foreign keys `(org_id, id)` so no row can reference another org's row.
4. **The engine runs on the server.** A repository loads one org's records, maps them to engine records, calls
   `applyAction` with the session's actor, and writes changed rows plus audit rows in one transaction with a
   `version` check. Approval and audit rows are first-class tables (append-only by trigger), never only JSON.
5. **Authentication through an established library** with database-backed, revocable sessions. Roles (Org Admin,
   Payment Ops, Finance, Approver, Viewer) and their mapping to engine roles live in Clearline's own
   `memberships` table. The library is chosen in PR 3 against written criteria (maintained, releases ≥ 2 weeks old,
   DB sessions, CSRF, rate limiting, no paid service, licence).
6. **Money** is `bigint` minor units with a `currencies` precision table; never floating point.

## Consequences

- The engine's behaviour and tests stay the financial oracle; new code is mostly persistence, identity and HTTP.
- Two code paths (sandbox and pilot) must never be confused: separate routes, flags and UI banners; a test proves
  the pilot ignores `x-clearline-actor`.
- Local development and CI need PostgreSQL (installed locally; a `postgres:16` service container in GitHub
  Actions). A hosted staging database is a later, approval-only step.
- Serverless hosting with a connection-pooled Postgres works with this design; the single-process file stores of
  the legacy app are not used.
