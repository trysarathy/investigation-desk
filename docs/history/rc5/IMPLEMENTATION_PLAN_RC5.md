# Clearline Control pilot build — gap matrix and implementation plan (rc5)

Companion to `ENGINEERING_AUDIT_RC5.md`. Target: a **controlled enterprise design-partner pilot** on fictional
data, with every financial operation in simulation. Not production. Nothing here authorises real data, real
providers, payment execution, spending or merging into `main`.

## 1. Readiness gap matrix

Status: ✅ exists and tested · 🟡 partial / sandbox only · ❌ missing. "PR" is the plan step that closes it.

| Requirement (mandate part) | Status at 280fcd2 | Evidence | PR |
|---|---|---|---|
| Green CI baseline (12) | ❌ browser job red (axe not installed), lint job red (331 errors) | run 43730455949; `CI_BASELINE_RC5.md` | 1 |
| Financial-correctness rules 1–14 (6) | ✅ in the engine; 🟡 not enforced server-side | `ARCHITECTURE.md` §4/§4b | 4–7 keep them; each gets a server-path test |
| Redwood return case: −12,784.90 / +12,784.90 / net 0.00 / supplier unpaid (6) | 🟡 the mechanism exists (`investigation.ts:returnPosition`); this exact fictional case is not in the sample | — | 4 (fixture + test) |
| Server-side persistence (4) | ❌ | audit §E | 2 |
| Tenant ownership, FKs, uniqueness, RLS (4) | ❌ | audit §F "Tenancy" | 2 |
| Org A cannot access org B — tests (4) | ❌ | — | 2 (DB/RLS), 3 (HTTP) |
| Authentication, sessions, expiry, revocation (5) | ❌ for Clearline | audit §F | 3 |
| Roles: Org Admin, Payment Ops, Finance, Approver, Viewer (5) | 🟡 engine roles operator/approver/compliance/viewer over client-chosen ids | `tx.ts:requireRole` | 3 (mapping table) |
| No header impersonation (5) | ❌ `x-clearline-actor` is trusted by the v1 sandbox | `route.ts:97` | 3 (pilot API ignores it; test proves it) |
| Maker-checker bound to an immutable version; edit invalidates; race-safe (5) | 🟡 engine-level only | `accounting/actions.ts:approve` | 5 |
| Investigation workflow persisted: owner, priority, status, next action, due date, evidence refs (3) | 🟡 engine has cases/exceptions; no priority/due-date persistence | `exceptions.ts` | 4 |
| Append-only audit (5, 11) | 🟡 client-held | `Workspace.audit` | 2 (table + trigger), 4 |
| Statement ingestion: one format, limits, CSV injection, duplicate file (7) | ❌ for Clearline | audit §G.6 | 6 |
| Adapter conformance suite (8) | 🟡 Connect tests cover most cases on fictional adapters | `CONNECT_ADAPTERS.md` §13 | 8a (packaged as a suite every adapter must pass) |
| Base Sepolia evidence rules (9) | ✅ synthetic | `chain.ts`, §4 row 5 | kept; no real RPC without approval |
| Accounting Bridge persistence (7) | ❌ | — | 7 |
| CSRF, rate limits, idempotency, secure cookies (11) | ❌ for Clearline | audit §F | 3 (CSRF, cookies, login rate limit), 4 (idempotency) |
| Dependency scanning (11) | ❌ | no workflow, no dependabot | 1 (proposed workflow; enabling GitHub settings is the founder's) |
| Threat model (11) | ❌ | — | 1 (initial), updated each PR |
| Editorial UI on the persisted slice (10) | 🟡 rc4 console look (Midnight & Electric Blue) | `tokens.css` | 8 |
| Environments: local / public demo / private staging / production off (13) | 🟡 local + public previews only | audit "Deployment facts" | 9 (design + founder approval for any hosting) |
| Backup, retention, restore runbook (4) | ❌ | — | 2 (design), 9 (drill) |
| Investigation metrics, no ROI claims (16) | ❌ | — | 4 (event timestamps), 8 (display) |

## 2. Architecture decisions for the pilot

Recorded as proposed in `docs/adr/0004-clearline-control-persistent-backend.md`. Summary:

- **Same Next.js app, new authenticated surface.** Pilot routes under `/control/**` and an API under
  `/api/control/**`, enabled only when `CLEARLINE_CONTROL_PILOT=1`. The public fictional sandbox
  (`/clearline/**`, `/api/clearline/test/v1`) stays as it is and never shares a session or database with the pilot.
- **PostgreSQL 16, Drizzle ORM + drizzle-kit SQL migrations, `pg` driver, Zod at every boundary.** Drizzle keeps
  migrations as reviewable SQL (needed for RLS policies, triggers and check constraints) and has no binary engine.
- **Tenancy.** Every tenant table has `org_id NOT NULL` + FK; composite FKs `(org_id, id)` so a child cannot point
  at another org's parent; RLS `USING (org_id = current_setting('app.org_id')::uuid)` with `FORCE ROW LEVEL
  SECURITY`; the app connects as a non-owner role; each request runs in a transaction that sets `app.org_id` from
  the **authenticated membership**, never from input.
- **Authentication.** An established library with database sessions (candidate: Better Auth with the Drizzle
  adapter, email + password, optional TOTP; to be confirmed in PR 3 against: DB-backed revocable sessions,
  `HttpOnly; Secure; SameSite=Lax` cookies, CSRF protection, rate limiting, maintained releases ≥ 2 weeks old,
  licence). Roles live in our `memberships` table, not in the library.
- **Engine on the server.** Persisted rows → engine records → `applyAction` → diff + audit rows written in the
  same transaction, with optimistic concurrency (`version` column). The engine's tests remain the oracle.
- **Money.** `bigint` minor units in the database; currency precision from a `currencies` reference table
  (SGD/USD/EUR/PHP 2, USDC 6); `CHECK (amount_minor >= 0)` where direction is a separate column.
- **Testing.** Vitest against a real local PostgreSQL 16 (installed in this container; a `postgres:16` service
  container in GitHub Actions). Playwright against `next start` with a seeded database.

## 3. PR sequence (each small, draft, never into `main`)

Each PR is based on the previous one (stacked on `rc4/clearline-app`). Each ends with the Part 15 report.

| # | Branch | Content | Acceptance | Needs founder approval before? |
|---|---|---|---|---|
| 1 | `rc5/audit-and-ci` | This audit + plan + ADR (proposed) + threat model v0 + runbook for local checks; **CI fix: pin axe-core and make every axe test run (and fail if axe is missing)**; stale Chromium fallback | browser suite green locally with axe actually running; vitest/tsc/build green | No |
| 1b | `rc5/lint-baseline` | Make the lint job green without disabling rules: `prefer-const` auto-fixes in tests (288+), real fixes for the 5 app errors, ignore non-product `team/**` knowledge scripts in the lint config (with reason) | `npm run lint` exit 0; no test assertion changed (diff check) | No |
| 2 | `rc5/db-foundations` | Drizzle schema + SQL migrations for orgs, users, memberships, roles, payment intents, provider events, settlement evidence, reconciliation records, exceptions/investigations, notes, approval requests/decisions, funding obligations, repayment allocations, accounting proposals, export records, audit events, idempotency records; RLS; append-only audit trigger; seed (fictional); backup/retention design doc | migration up from empty; cross-tenant tests at the SQL level (RLS denies, composite FK denies); audit UPDATE/DELETE refused | No (local Postgres; CI service container uses existing GitHub Actions minutes) |
| 3 | `rc5/authn-authz` | Auth library, login/logout, DB sessions with expiry + revocation, CSRF, login rate limit, role checks from membership, `x-clearline-actor` ignored on pilot routes; auth audit events | org A ↔ B HTTP tests; header impersonation test; expired/revoked session tests; viewer cannot mutate | No (unless the chosen library needs a paid service — then stop) |
| 4 | `rc5/investigation-workflow` | Persisted payments, evidence timeline, contradictions, investigations (owner, priority, status, next action, due date, evidence refs), notes, Redwood fixture, idempotency keys | survives refresh, logout/login and server restart (Playwright with restart); Redwood numbers exact | No |
| 5 | `rc5/maker-checker` | Proposed resolution with immutable versions; second-user approval; edit invalidates approvals; concurrency (two approvers, approve-vs-edit race) | race tests with parallel transactions; preparer ≠ approver enforced in DB and code | No (but enforcing an existing rule only; changing a policy such as the ≤1% single-person acceptance is the founder's decision — still pending) |
| 6 | `rc5/statement-ingestion` | camt.053 (ISO 20022 XML) *or* CSV — choose CSV first (narrowest, existing strict reader) unless the founder prefers camt.053; size/row limits, schema validation, CSV-injection-safe storage and export, SHA-256 duplicate-file detection, import audit, "imported" ≠ "independently authenticated" evidence class; malware-scan strategy documented (no paid scanner) | malformed-file and limit tests; duplicate file refused; import attributed to org | No |
| 7 | `rc5/accounting-persistence` | Accounting proposals and export records persisted; content-hash idempotent exports from DB | export byte-identical on re-run; posted only via recorded reference | Posting-rule sign-off still pending (rules stay labelled sandbox) |
| 8 | `rc5/control-ui` | Editorial UI (warm white / ink / oxblood / verified green) for Work Queue, Payments, Investigation, Evidence Timeline, Reconciliation, Funding Exposure, Accounting Bridge, Audit History, Org Settings; demo visibly fictional; no dead buttons | axe 0, keyboard, 320–1440 no overflow, every button has a tested result | No |
| 8a | `rc5/adapter-conformance` | Conformance suite every Connect adapter must pass (duplicates, out-of-order, replay, bad signature, contradictions, timeouts, idempotency collisions, malformed, regressions, unknown status, partial failure) on raw bytes | suite runs against the three fictional adapters | No |
| 9 | `rc5/staging-readiness` | Environment design (local / public demo / private staging / production disabled), runbooks (backup/restore drill on local Postgres, incident, key rotation), dependency scanning workflow, staging checklist | docs + drill evidence | **Yes** — any hosted database, paid plan, domain, access-permission change or deployment-protection change |

## 4. Stop-and-ask points

Before: paying for infrastructure (a hosted Postgres for staging is the first likely one); accessing real
financial information; connecting a real provider; enabling execution; changing a domain (clearlineconnect.org);
merging into `main`; promoting a release; changing financial-control policies (posting rules, ≤1% acceptance by one
person).

## 5. Open founder decisions carried from rc4

Posting-rule sign-off (stablecoin route), beachhead, pricing, whether ≤1% acceptances need a second person,
promotion/splitting/merging of rc4, and which public site clearlineconnect.org should serve.
