# Clearline engineering audit (rc5 start, 21 Nov 2026)

**Scope.** I read what is on `rc4/clearline-app` at **`280fcd2`** (software; tested commit `dc4d39a` + docs), with
`main` at `b83f38e`, `rc4/clearline-site` at `a509eb9`, `pilot-operating-desk` at `c2bcfce`. Every statement below
points to a file, function, test, configuration or deployment I opened in this session. "Not found" means I
searched and found nothing; it is not a guess that the thing is absent elsewhere.

**Who:** the founding-CTO session (AI), with one read-only inventory subagent whose claims I spot-checked
(package.json dependencies, `workspace.tsx` localStorage, the v1 route's bearer key and actor header,
`tx.ts:requireRole`). Not an independent review.

**One-line verdict.** The engine is a carefully tested, deterministic, pure-TypeScript financial-correctness core.
The *product around it* is a single-visitor browser sandbox: no server-side state, no authentication, no
tenancy. Turning rc4 into a controlled design-partner pilot is mostly new backend work around a reused engine,
not a rewrite.

---

## A. What is implemented

| Area | Where | Evidence it works |
|---|---|---|
| Canonical payment model: intents, provider events, statement lines, chain observations, exceptions/cases, holds, decisions, advances/obligations, audit | `src/lib/clearline/types.ts` (1079 lines) | type-checked (`npx tsc --noEmit` clean at dc4d39a, manifest) |
| Pure deterministic action engine `applyAction(ws, action, {actorId, at})` → new workspace + audit, or typed `EngineError` | `src/lib/clearline/actions.ts`, `tx.ts` | `tests/clearline/*.test.ts` (45 test files); vitest **1820 passed, 57 skipped** at dc4d39a (`RELEASE_MANIFEST_RC4.md`) |
| Three separate status dimensions: execution / settlement (+scope) / reconciliation | `state.ts`, `derive.ts:recomputeDimensions`, `investigation.ts` | `ARCHITECTURE.md` §4 rows 2, 3a–3c with tests |
| Reference-only matching; amount-only → `RC_AMOUNT_ONLY_CANDIDATES`; ambiguity preserved | `reconciliation.ts:reconcileLine`, `reconcileIncoming` | `reconciliation.test.ts`, `rc3-invariants-proof.test.ts` |
| Return distinction (outgoing, returned, net zero, beneficiary unpaid) | `investigation.ts:investigate` → `returnPosition` | `ARCHITECTURE.md` §4 row 3c (R-1) |
| Exceptions / investigations with resolution guards; reopen on contradicting evidence; acceptance ≤1% / ≤50% with second person | `exceptions.ts:canResolveException`, `canResolveCase` | §4 rows 7, 8a, 8b |
| Webhook ingestion: signature over raw body, 300 s replay window, dedupe, order-independent contradictions | `events.ts`, `webhooks.ts`, `connect/verify.ts` | `CONNECT_ADAPTERS.md` §13; QA rc4 §3 "Connect" |
| Connect adapter framework (3 fictional providers, pluggable verification schemes, simulated polling, outbound idempotency) | `src/lib/clearline/connect/*` | `CODE_REVIEW_RC4_CONNECT.md` APPROVE; QA rc4 |
| Synthetic Base Sepolia chain evidence: chain id 84532, allowlisted synthetic token, 6 dp, 12-confirmation finality, reorg handling, one payout per hash | `chain.ts` | §4 row 5 |
| Accounting Bridge: balanced proposals only from independent evidence, maker≠checker, CoA mapping, periods, content-hashed idempotent exports, "posted" only via `record_posting` | `src/lib/clearline/accounting/*` | §4b rows 10a–10l, 20 mutants killed; `CODE_REVIEW_RC4_ACCOUNTING.md` APPROVE CHANGE 20 |
| Funding projection (50,000 / 30,000 / 20,000) | `funding.ts` | §4 row 6 |
| Load-time validation and migration of stored workspaces | `serialize.ts:parseWorkspace` / `crossCheck`, `migrate.ts`, `accounting/validate.ts` | `rc3-migration-property.test.ts`, `rc4-load-labels.test.ts` |
| Console (Control, Connect, Accounting, Audit, Trial pages) | `src/app/clearline/**`, `src/components/clearline/**` | browser suite 261 passed / 7 skipped at dc4d39a (manifest; today's result in `docs/release/CI_BASELINE_RC5.md`) |
| Stateless test-mode HTTP API | `src/app/api/clearline/test/v1/[...path]/route.ts` | `tests/clearline/api.test.ts` |
| Nonce CSP + security headers, deployment allow-list, config fail-fast | `src/middleware.ts:deploymentGate`, `next.config.mjs:deploymentConfigProblems` | QA rc4 §3 "Security" |
| Integer money | `money.ts` (`MAX_AMOUNT_MINOR = 1e15`, BigInt in `applyBpsFloor`, `convertMinor`, `withinTotal`); decimals SGD/USD/PHP/EUR 2, USDC 6 | `ARCHITECTURE.md` §4 row 1 |

## B. What is simulated

- **Providers:** three fictional providers, deterministic simulators, no network (`adapters.ts:SandboxAdapter`,
  `connect/simulator.ts`). Webhook secrets are public `test_whsec_*` strings (`webhooks.ts` says it "protects
  NOTHING"; `connect/verify.ts:assertSandboxKeyring` accepts only `test_` keys).
- **Bank statements:** structured JSON lines typed in or posted one at a time (`actions.ts:ingestStatement`); no
  bank file, no bank connection.
- **Chain evidence:** synthetic observations (`chain.ts`); no RPC, no real contract.
- **Roles and approval:** an "Acting as" picker (`src/components/clearline/ActorSelect.tsx`, label
  `nav.ts:SIMULATED_ROLE_NOTE` = "Simulated role — not sign-in or access control"). Maker≠checker is a workflow
  rule over client-chosen actor ids, not access control (documented in `ACCOUNTING_BRIDGE.md` §3, QA rc4 Low).
- **Accounting:** no ledger is connected; exports are files; "posted" is a person's statement.
- **Funding:** a projection, not a ledger (`funding.ts`).

## C. What is frontend-only

- The entire Clearline console. State is React state in `workspace.tsx:WorkspaceProvider`
  (`useState(() => sampleWorkspace())`), every action runs in the browser (`applyAction(...)` at
  `workspace.tsx:248`), and there is **no `fetch(` in `src/components/clearline` or `src/app/clearline`**.
- Persistence = `window.localStorage` keys `clearline.console.workspace.v1`, `clearline.console.actor.v1` and five
  backup kinds (`workspace.tsx:16–28`); a mapping draft in sessionStorage (`AccountingSetup.tsx:18`).
- Consequence: the authoritative record is whatever the visitor's browser holds. QA rc4 M1 and the manifest's
  "Known limitations" both state that a well-formed forged record cannot be detected without server state.

## D. What has a real server

| Server code | What it does | State |
|---|---|---|
| Clearline v1 test API (`route.ts` above) | Runs the same engine on a workspace **posted in each request**; returns the new workspace | Stateless; fixed public key `Bearer cl_test_demo` (line 57); actor from `x-clearline-actor` header or `body.actorId` (line 97) |
| Funding Desk API (`src/app/api/funding/route.ts`, `src/lib/funding/server.ts`) | Separate product: real scrypt login, CSRF, origin check | Private JSON files in `CLEARLINE_FUNDING_DIR` |
| Legacy investigation-desk API routes (`src/app/api/**` except clearline/funding) | Older stablecoin app: uploads, payments, accounting sync, Xero OAuth | JSON files under `DESK_DATA_DIR` / `.data` |
| `pilot-operating-desk` branch (`funding-replay/pilot/*.py`, not in this branch) | Python stdlib HTTP server, multi-org case desk | SQLite WAL; `fly.toml` designed, **not deployed** (its README) |

None of these serves or stores Clearline Control data.

## E. What persists

| Data | Store | Survives refresh | Survives other browser / device | Survives server restart | Shared between users |
|---|---|---|---|---|---|
| Clearline workspace | browser localStorage | yes | **no** | n/a (no server copy) | **no** |
| Clearline v1 API calls | nothing | — | — | — | — |
| Funding Desk records | JSON files, 0600, atomic rename, in-process lock + `.writer` lease (`funding/private.ts`, `funding/store.ts`) | yes | yes | yes | yes, single process |
| Funding Desk sessions | in-memory `Map` (`funding/server.ts`) | — | — | **no** (lost on restart) | — |
| Legacy desk data | JSON files, `lock.ts:withLock` (in-process only: "run one server process per data directory") | yes | yes | yes | single process |

On Vercel serverless, file stores are not durable; no Clearline deployment uses them.

**Database client in package.json: none** (dependencies: `@anthropic-ai/sdk`, fontsource, `@noble/hashes`, next,
pdf-lib, qrcode, react, react-dom, server-only). No `DATABASE_URL` is read anywhere in `src/`.

## F. Security controls that actually exist

| Control | Exists? | Where | Note |
|---|---|---|---|
| Authentication for Clearline | **No** | — | console says "Sandbox only: there is no login" (`ActorSelect.tsx`) |
| Authentication elsewhere | Funding Desk only | `funding/server.ts:hashPassword/verifyPassword/login` (scrypt, timing-safe) | sessions in memory, 8 h |
| Authorisation | Role check against the workspace's own actor list | `tx.ts:requireRole` | caller supplies the list ⇒ not access control |
| Tenancy | **No** | `orgId` on `PaymentIntent`/`FundingAdvance` (`types.ts:135,699`), one `organization` per workspace; engine comparison only in `scenarios.ts:185` (org unchanged on reset); the console uses it only to key a mapping draft (`AccountingSetup.tsx:29`) | |
| CSP / headers | Yes | `src/middleware.ts` (nonce + `strict-dynamic`), `next.config.mjs` (XFO DENY, nosniff, Referrer-Policy, Permissions-Policy, no X-Powered-By) | styles keep `'unsafe-inline'` |
| Body limits | Yes | `clearline/bodylimit.ts:readBodyLimited` (streamed reader; the 512 KB cap is `MAX_BODY_BYTES` in the v1 `route.ts:33`), `lib/limits.ts`, `next.config.mjs:middlewareBodyLimit` | |
| Deployment-config fail-fast | Yes | `next.config.mjs:assertDeploymentConfig` | 9 bad configs refused (QA rc4) |
| Route allow-list for the trial | Yes | `middleware.ts:deploymentGate` with `CLEARLINE_CUSTOMER_PREVIEW=1` | |
| Webhook signature on raw bytes, replay window, key rotation | Yes (sandbox) | `connect/verify.ts`, `webhooks.ts` | HMAC in `sha256.ts`; test keys only |
| CSV-injection protection on exports | Yes | `accounting/exports.ts` (prefix `'`) | QA rc4 §3 |
| Rate limiting | Funding login only | `funding/server.ts:login` | Clearline docs state "no rate limits" (`src/app/clearline/docs/page.tsx:295`) |
| CSRF | Funding Desk only | `x-csrf-token` + `assertOrigin` | legacy `/api/*` and the Clearline test API have none |
| Dependency scanning | **No** | `.github/workflows/*` have no audit/CodeQL/dependabot; no `.github/dependabot.yml` | |
| Secrets in source | None found | only `.env.example` (empty values); `.gitignore` ignores `.env*` | public sandbox strings by design |
| Audit trail | Yes, but client-held | `Workspace.audit`, appended by every action | editable by whoever holds the workspace |

## G. What is missing for an enterprise design-partner pilot

1. **Authoritative server-side store** (Postgres) with tenant ownership, constraints, migrations, transactions,
   RLS, backup/retention. Nothing exists (§E).
2. **Authentication and sessions** for Clearline (established library, secure cookies, expiry, revocation), and
   **authorisation** from server-side membership and role, never from a client header (`route.ts:97`) or picker.
3. **Tenant isolation** with tests proving org A cannot read or change org B.
4. **Server-enforced maker-checker** bound to an immutable proposal version; edits invalidate approvals;
   concurrency cannot bypass it (today: `accounting/actions.ts:approve` over a client-held workspace).
5. **Append-only audit** the client cannot edit.
6. **Statement file ingestion** (one format) with limits, validation, duplicate-file detection, import audit.
   MT940/camt.053/BAI2: not found.
7. **CSRF, rate limits, idempotency keys** on every mutating endpoint.
8. **Dependency scanning and a green CI baseline** (at 280fcd2: lint job red, browser job red — `docs/release/CI_BASELINE_RC5.md`).
9. **Environment separation**: no private staging with real auth and a database exists; previews are public.
10. **Operational docs**: backup/restore, incident, key rotation runbooks — none for Clearline.

## H. What to reuse

- **The engine, unchanged in behaviour:** `src/lib/clearline/**` (actions, derive, reconciliation, exceptions,
  investigation, chain, connect, accounting, money, labels). It is pure and deterministic, so it can run on the
  server inside a database transaction over rows loaded for one organisation. Its 1,800+ tests are the
  financial-correctness regression suite and must keep passing.
- **The invariant catalogue** (`ARCHITECTURE.md` §4/§4b) as the acceptance list for Part 6.
- **Connect verification** (`connect/verify.ts`) and its conformance tests as the base of the adapter suite.
- **Console components and labels** (`src/components/clearline/**`, `labels.ts`) for the UI, rewired to the API.
- **Security patterns already proven here:** the nonce CSP middleware; `deploymentConfigProblems`; the Funding
  Desk's login throttle, cookie flags and CSRF/origin checks (`funding/server.ts`, `api/funding/route.ts`); the
  pilot branch's append-only triggers, per-org case numbering and idempotency table (`migrations/0001_init.sql`) as
  design references. These are patterns; the code is a different runtime (Python/SQLite) or an in-memory store.
- **The legacy strict CSV reader** `src/lib/csv/parse.ts` (RFC 4180) as a starting point for statement import.

## I. What to refactor

- **Workspace-as-a-value → per-org persisted records.** Keep `applyAction`'s contract; add a repository layer that
  loads an org's records, runs the action, and writes the diff plus audit rows in one transaction. Short term this
  can persist the engine's workspace JSON per org with a version column (optimistic concurrency) while tables are
  introduced entity by entity; it must not stay that way for approvals and audit, which need their own rows.
- **Actor identity:** `ctx.actorId` must come from the authenticated session's membership, never from
  `x-clearline-actor`, `body.actorId` or the picker. The picker stays only on the public demo.
- **Approvals:** bind `approve_*` to `(proposal_id, version, content_hash)`; enforce approver ≠ preparer in the
  database as well as in `accounting/actions.ts`.
- **Console data flow:** replace localStorage as the source of truth with server reads/writes in the pilot build;
  keep the localStorage sandbox only for the public fictional demo.
- **The v1 test API** stays a stateless sandbox; the pilot gets a separate authenticated API, so the two cannot be
  confused.

## J. What not to build yet

Live provider connections, payment execution, real wallets/mainnet/keys, posting to a real ledger, SSO/SAML
(design for it; email + password + optional TOTP first), AI features (no approved model provider), a general
ledger, auto-posting, amount-only auto-matching (`CLEARLINE_PRODUCT_STRATEGY_RC4.md` §3 DO NOT BUILD), MT940 and
BAI2 alongside the first format, multi-region, and any compliance claim.

---

## Conflicts between repository instructions and the current mandate

Reported as required; in each case I follow the more restrictive rule.

1. **Positioning.** `company/COMPANY_RULES.md` describes a stablecoin invoice-matching tool; `AGENTS.md` (founder
   brief 6 Nov) describes an advance-review desk; the 21 Nov mandate defines Clearline Control (investigation,
   evidence, reconciliation, approvals, accounting export) with Connect as the instruction layer;
   clearlineconnect.org still serves "Every advance. Traceable. Explainable. Controlled.". I build to the mandate
   and change no governance file (`AGENTS.md`, `PRODUCT_FACTS.md` need founder approval).
2. **Merging.** `COMPANY_RULES.md` allows auto-merge under `OPERATING_MODEL.md` §2; `AGENTS.md` and the mandate
   forbid merging in this sprint. I merge nothing.
3. **Deployments.** `AGENTS.md`: "never publish a deployment in this sprint". Every push builds Vercel previews
   automatically (manifest, "Governance"). I keep pushes few, and create no new project, domain or production
   promotion.

## Deployment facts (Part 13, anonymous requests on 21 Nov 2026)

| URL | Result | What it serves |
|---|---|---|
| clearline-customer-trial-git-rc4-clearline-app-sarathyv2.vercel.app/clearline | 200, nonce CSP present | rc4 preview, **publicly reachable without Vercel authentication** |
| clearline-customer-trial.vercel.app/clearline | 200, **no CSP header** | production = an older release (pre-rc3 nonce CSP) |
| clearline-marketing.vercel.app | 200 | marketing site ("Know what happened to every payment.") |
| clearlineconnect.org | 200 (www → 308 apex); A record 216.198.79.1; served by Vercel | an older site ("Every advance. Traceable. …"); HSTS without `includeSubDomains` |

Not checked (no access from this session): Vercel project settings, deployment protection, environment
variables per environment, and which project the domain is attached to. Those need the founder's Vercel
dashboard; I changed nothing.
