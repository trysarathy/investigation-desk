# Clearline Control — threat model (v0, 21 Nov 2026)

**Status:** v0, written at the start of the pilot build. It describes the **current** controls (rc4 at `280fcd2`)
and the **required** control for the design-partner pilot. It is updated in every PR that changes a control. This is
not a certification and makes no compliance claim; no independent assessment has been done.

**Assets:** organisations' payment records and evidence; investigation conclusions; approval decisions; audit
history; accounting proposals and export files; user credentials and sessions.

**Trust boundaries:** browser ↔ app server; app server ↔ PostgreSQL; uploaded statement files ↔ parser; provider
webhooks ↔ verifier (fictional providers only); public sandbox ↔ pilot (must never share state).

| # | Threat | Current state (rc4) | Required for the pilot | PR |
|---|---|---|---|---|
| T1 | **Cross-tenant access** (org A reads/changes org B) | No tenancy: one workspace per browser (`types.ts` single `organization`) | org from session membership only; app filter + RLS + composite FKs; A↔B tests at SQL and HTTP level | 2, 3 |
| T2 | **Broken object-level authorisation** (guessing ids) | n/a (client-held) | every read/write by `(org_id, id)`; non-sequential public ids (UUID); 404 for other orgs' ids | 2, 4 |
| T3 | **Identity forgery / impersonation** | actor from picker or `x-clearline-actor` (`route.ts:97`) | actor = session user; header ignored on pilot routes, with a test | 3 |
| T4 | **Approval bypass** (self-approval, approving a changed proposal, races) | engine rule over client data (`accounting/actions.ts:approve`) | approval row bound to `(proposal_id, version, content_hash)`; DB check approver ≠ preparer; edit supersedes; serialisable/locked approve; race tests | 5 |
| T5 | **Forged evidence / editable workspace** | possible (QA rc4 M1; manifest limitation) | evidence created only by server actions or verified imports; client never submits a workspace on pilot routes | 4, 6 |
| T6 | **Audit tampering** | client-held `Workspace.audit` | append-only table; UPDATE/DELETE refused by trigger; app role has INSERT/SELECT only | 2 |
| T7 | **Replay / duplicate requests** | engine dedupes events; no HTTP idempotency | idempotency keys `(org_id, key)` with request fingerprint for every mutation | 4 |
| T8 | **Webhook tampering / replay** | HMAC on raw bytes, 300 s window, rotation; test keys only (`connect/verify.ts`) | unchanged until a real provider is approved; conformance suite | 8a |
| T9 | **Malicious upload** (size, zip/XML bombs, formula injection, malformed rows, duplicate file) | Clearline has no upload | size + row caps, streaming bounded parse, strict schema, SHA-256 duplicate detection, stored outside web root, formula-prefix escaping on export; malware scanning strategy documented (no paid scanner without approval) | 6 |
| T10 | **CSV injection** in exports | escaped with `'` (`accounting/exports.ts`; QA rc4) | keep; extend to new exports | 6, 7 |
| T11 | **SQL injection** | no database | parameterised queries only (Drizzle); no string-built SQL; lint rule/test | 2 |
| T12 | **XSS** | React escaping; nonce CSP + `strict-dynamic` (`middleware.ts`); QA rc4 XSS probes | keep; no `dangerouslySetInnerHTML` on pilot routes | 4, 8 |
| T13 | **CSRF** | none on Clearline (Funding Desk only) | SameSite cookies + CSRF token or origin check on every mutating request | 3 |
| T14 | **Session hijacking / fixation** | n/a | `HttpOnly; Secure; SameSite=Lax`, rotation at login, idle + absolute expiry, server-side revocation, logout everywhere | 3 |
| T15 | **Credential stuffing / brute force** | Funding Desk throttle only | per-account and per-IP login rate limits; generic errors; scrypt/argon2 via the library | 3 |
| T16 | **Secrets exposure** | none committed (`.env.example` only); sandbox keys public by design | secrets only in environment/secret store; deployment-config check extended to pilot vars; never in client bundles | 2, 3, 9 |
| T17 | **Race conditions / double processing** | pure engine; no concurrency | optimistic `version` checks; unique constraints; transaction tests with parallel clients | 4, 5 |
| T18 | **Vulnerable dependencies** | no scanning in CI | `npm audit --omit=dev` gate + Dependabot proposal (enabling GitHub settings is the founder's call) | 1b/9 |
| T19 | **Environment confusion** (demo data in pilot, pilot reachable publicly) | previews public (anonymous 200 on the rc4 preview) | pilot flag off by default; private staging with access control (founder approval); banners per environment | 9 |
| T20 | **Sensitive data in logs** | not assessed for Clearline (no server state) | structured logs with redaction of tokens, cookies, account numbers | 3, 4 |

**Out of scope until approved:** real providers, payment execution, real wallets/mainnet/keys, real customer data,
production hosting.
