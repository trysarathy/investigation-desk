# OWASP ASVS 4.0.3 Level 2: requirement-by-requirement map (Clearline v1)

Status: **self-assessment draft, v1 phase 5.1, branch `v1/e1-hardening` (base 7525f91).** This is an engineering map
of where each Level 2 requirement is handled, so gaps can be planned. **It is not a certification, an audit, a
penetration test or a compliance claim**, and must not be presented as one. No third party has reviewed it.

## How to read this

- **Scope:** Clearline Control (the authenticated pilot: `/control`, `/api/control`, `/api/auth`), its jobs worker and
  CLIs, plus the public synthetic surfaces that share the build (`/clearline` console + test API, `/mentor-demo`,
  legacy desk, funding desk) where a requirement touches them. Hosting (TLS termination, WAF, backups, OS patching) is
  outside the repository and marked as such.
- **Requirement list:** every requirement that applies at Level 2 in ASVS 4.0.3 (L1 + L2; L3-only items omitted),
  chapters V1 to V14. Requirement text is **paraphrased**. [ASSUMPTION] The ID and level list was transcribed from the
  4.0.3 standard from memory; check it against the official 4.0.3 CSV before relying on the count.
- **Status:** **Met** (the repository does what the requirement asks, for the scope above) · **Partly** (some of it,
  or not everywhere) · **Not met** · **N/A** (the feature does not exist in this build) · **Host** (depends on the
  deployment, not the repository).
- **Evidence labels:** **[VERIFIED]** = checked in code or by a test run during this assessment (E1, 25 Nov 2026).
  **[ASSUMPTION]** = taken from an existing design document or inferred, not re-checked here; the source is named.
- Gaps carry a **proposed fix** (section "Gaps and proposed fixes" at the end, numbered G1…).

## Summary

| Chapter | Met | Partly | Not met | N/A | Host | Total |
|---|---|---|---|---|---|---|
| V1 Architecture, design and threat modelling | 22 | 15 | 1 | 0 | 0 | 38 |
| V2 Authentication | 26 | 10 | 4 | 12 | 0 | 52 |
| V3 Session management | 15 | 1 | 0 | 2 | 0 | 18 |
| V4 Access control | 8 | 1 | 0 | 0 | 0 | 9 |
| V5 Validation, sanitisation and encoding | 27 | 2 | 0 | 1 | 0 | 30 |
| V6 Stored cryptography | 7 | 5 | 1 | 0 | 0 | 13 |
| V7 Error handling and logging | 7 | 4 | 0 | 0 | 1 | 12 |
| V8 Data protection | 7 | 7 | 1 | 0 | 0 | 15 |
| V9 Communication | 1 | 1 | 0 | 0 | 5 | 7 |
| V10 Malicious code | 4 | 1 | 0 | 0 | 0 | 5 |
| V11 Business logic | 6 | 2 | 0 | 0 | 0 | 8 |
| V12 Files and resources | 12 | 2 | 0 | 1 | 0 | 15 |
| V13 API and web service | 7 | 2 | 0 | 3 | 0 | 12 |
| V14 Configuration | 17 | 5 | 0 | 0 | 1 | 23 |
| **Total** | **166** | **58** | **7** | **19** | **7** | **257** |

Counts are generated from the tables below (one row per requirement). **Not met** (7): 1.1.2 (Threat modelling for every design change); 2.1.7 (Passwords checked against breached-password sets); 2.1.8 (Password strength meter); 2.2.3 (Notifications after credential/authenticator changes); 2.5.5 (Notification when an authentication factor changes); 6.4.1 (Secrets management solution (vault)); 8.3.6 (Sensitive data cleared from memory after use).

---

## V1 Architecture, design and threat modelling

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 1.1.1 | Secure SDLC used throughout | Partly | [ASSUMPTION] `AGENTS.md`, `company/COMPANY_RULES.md`: implementer + separate reviewer, small PR slices, CI on every PR. No written SDLC policy. | G1 |
| 1.1.2 | Threat modelling for every design change | Not met | [VERIFIED] threat models exist per release (`docs/security/SECURITY_THREAT_MODEL_RC5/6/7.md`, `THREAT_MODEL_V0_RC5.md`) but not per change; none for v1 yet. | G1 |
| 1.1.3 | Security constraints in user stories | Partly | [ASSUMPTION] task briefs carry hard rules (read-only on money, amount-only never closes, preparer never approves); not formal story constraints. | G1 |
| 1.1.4 | Trust boundaries documented | Partly | [ASSUMPTION] `docs/ARCHITECTURE.md`, threat models rc5-rc7; outbound boundary now in `src/lib/net/outbound-hosts.ts` [VERIFIED]. | G1 |
| 1.1.5 | High-level architecture defined and reviewed | Met | [ASSUMPTION] `docs/ARCHITECTURE.md`, `docs/architecture/`, ADRs in `docs/adr/`. | |
| 1.1.6 | Centralised, vetted security controls | Met | [VERIFIED] auth: Better Auth (`src/server/auth.ts`); authz matrix `src/server/authz.ts`; tenancy `src/server/tenant.ts` + RLS; CSRF `src/server/http.ts`; outbound `src/lib/net/safe-fetch.ts` (E1). | |
| 1.1.7 | Secure coding guidance available to developers | Partly | [ASSUMPTION] role files (`.claude/agents/*.md`), `AGENTS.md`; no secure-coding checklist. | G1 |
| 1.2.1 | Unique, low-privilege OS accounts for components | Partly | [VERIFIED] distinct DB logins: `clearline_runtime` (no superuser/BYPASSRLS, checked at start: `tenant.ts:checkRuntimeRole`), `clearline_jobs`, `clearline_provisioning`, `clearline_owner` for migrations only (`next.config.mjs` refuses owner URL). OS accounts: Host. | |
| 1.2.2 | Communications between components authenticated | Partly | [VERIFIED] DB logins use passwords from env. App-to-DB TLS: Host [ASSUMPTION]. | G10 |
| 1.2.3 | Single vetted authentication mechanism | Met | [VERIFIED] Better Auth only; `src/server/auth-route.ts` allow-lists its endpoints (every other is 404). | |
| 1.2.4 | All authentication pathways equally strong | Met | [VERIFIED] the only pathways are password + second factor (TOTP / passkey) and reset; sign-up, change-email, stateless verification are blocked (`auth-route.ts`). Test API uses a fictional fixed key on synthetic data only. | |
| 1.4.1 | Access control enforced at trusted points (server) | Met | [VERIFIED] `can()` checked server-side before every action, then RLS in PostgreSQL (`withTenant`). [ASSUMPTION] tests `tests/control/workflow.test.ts`. | |
| 1.4.4 | Single, well-vetted access control mechanism | Met | [VERIFIED] `src/server/authz.ts` permission matrix + `tenant.ts`; RLS as defence in depth. | |
| 1.4.5 | Feature/data-attribute access control, not only role | Partly | [ASSUMPTION] entity scoping of memberships (migration 0053) narrows by entity; most checks are role-based. | |
| 1.5.1 | Input/output requirements defined per data type | Met | [ASSUMPTION] `docs/product/STATEMENT_CSV_FORMAT.md`, OpenAPI for the test API, zod schemas on every route. | |
| 1.5.2 | Serialisation not used with untrusted clients, or protected | Met | [VERIFIED] JSON only; ingest JSON has its own strict reader keeping numbers exact (`src/lib/clearline/ingest/json.ts`), fuzzed for prototype pollution (`tests/fuzz/parsers.test.ts`). | |
| 1.5.3 | Input validation at a trusted service layer | Met | [VERIFIED] zod `.strict()` schemas in server modules (e.g. `src/server/ledger.ts` `PullInput`). | |
| 1.5.4 | Output encoding near the interpreter | Met | [VERIFIED] React escaping; `csvCell` neutralises formulas (`src/lib/csv/cell.ts`); parameterised SQL (Drizzle). | |
| 1.6.1 | Explicit key management policy | Partly | [ASSUMPTION] keys only from env (`BETTER_AUTH_SECRET`, `CLEARLINE_UPLOAD_KEY`); rotation not documented. | G7 |
| 1.6.2 | Consumers of keys protect them | Met | [VERIFIED] keys read on the server only; never logged (upload key value never echoed, `storage/local.ts`). | |
| 1.6.3 | No hard-coded keys or passwords | Met | [VERIFIED] secret scan of the tree: 15 findings, all fictional fixtures or throwaway local DB passwords, allow-listed with reasons (`.github/security/secret-scan-allowlist.json`). | |
| 1.6.4 | Low-security client-side secrets not used for security | Met | [VERIFIED] no secrets in client bundles; `NEXT_PUBLIC_*` are URLs only (`next.config.mjs`). | |
| 1.7.1 | Common logging format across the system | Partly | [VERIFIED] `audit_events` table is the security log (ids and counts only); console logs are free-form. | G6 |
| 1.7.2 | Logs sent to a remote system | Partly | [ASSUMPTION] audit rows live in PostgreSQL (separate from app host); no log shipping. | G6 |
| 1.8.1 | Sensitive data identified and classified | Met | [ASSUMPTION] founder rules: wallet addresses and customer references are personal data; logs hold ids and counts only (`AGENTS.md`, task rules). | |
| 1.8.2 | Protection levels per classification | Partly | [VERIFIED] uploads encrypted at rest (AES-256-GCM, `storage/local.ts`), retention job (`src/server/upload-retention.ts`); DB columns not field-encrypted. | G8 |
| 1.9.1 | Encrypted communications between components | Partly | Host for TLS; [VERIFIED] every outbound call is https-only (`safe-fetch.ts`). | G10 |
| 1.9.2 | Components verify the other side's certificate | Met | [VERIFIED] Node's fetch verifies TLS by default; nothing disables it (no `rejectUnauthorized`/`NODE_TLS_REJECT_UNAUTHORIZED` in `src`). | |
| 1.10.1 | Source control with check-in comments and traceability | Met | [VERIFIED] git, small commits with messages; PRs required by the `main` ruleset [ASSUMPTION: `docs/ci/REQUIRED_CHECKS_PROPOSAL.md`]. | |
| 1.11.1 | Business logic flows documented | Met | [ASSUMPTION] `docs/MATCHING_RULES.md`, `docs/POSTING_RULES.md`, `docs/clearline/`. | |
| 1.11.2 | High-value flows not shared unsynchronised state | Met | [ASSUMPTION] approvals and postings in DB transactions with idempotency keys (`control-http.ts` requires `Idempotency-Key`). | |
| 1.12.2 | User-uploaded files served from a separate origin or as attachments | Met | [VERIFIED] uploads are never served back inline; exports use `Content-Disposition: attachment` (e.g. `src/app/api/control/merchant/evidence/route.ts`). | |
| 1.14.1 | Segregation of components with different trust levels | Partly | [VERIFIED] pilot deployment serves only Control (`deploymentGate`); jobs worker separate process and DB login. Network segmentation: Host. | |
| 1.14.2 | Signed / integrity-checked deployment artefacts | Partly | [VERIFIED] GitHub actions pinned by SHA; Docker image not signed [ASSUMPTION]. | G11 |
| 1.14.3 | Build pipeline warns on outdated/insecure components | Met | [VERIFIED] new `dependency-audit` job (`.github/workflows/security.yml`, E1). | |
| 1.14.4 | Build pipeline automated and repeatable | Met | [VERIFIED] `npm ci` from lockfile, `.github/workflows/ci.yml`, `npm run build:prod-check`. | |
| 1.14.5 | Deployments sandboxed/containerised | Partly | [ASSUMPTION] `Dockerfile` exists (node:22-slim); runtime isolation: Host. | |
| 1.14.6 | No unsupported/insecure client-side tech (Flash, ActiveX…) | Met | [VERIFIED] none; CSP `object-src 'none'`. | |

Count V1: 38 rows.

## V2 Authentication

Clearline has no public sign-up, no SSO, no SMS/e-mail OTP and no look-up secrets other than recovery codes; those
requirements are N/A. Source for most rows: `src/server/auth.ts`, `src/server/auth-route.ts` [VERIFIED read in E1],
tests in `tests/control/auth.test.ts`, `tests/control/login-security.test.ts` [ASSUMPTION: not re-run in E1 beyond
`npm run test:control`, which runs them].

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 2.1.1 | Passwords at least 12 characters | Met | [VERIFIED] `minPasswordLength: 12`. | |
| 2.1.2 | Passwords of 64+ characters allowed, 128 max | Met | [VERIFIED] `maxPasswordLength: 128`. | |
| 2.1.3 | No truncation; spaces may be collapsed | Met | [ASSUMPTION] Better Auth hashes the whole string. | |
| 2.1.4 | Any printable Unicode allowed | Met | [ASSUMPTION] no character-class rule in the sign-in or reset forms. | |
| 2.1.5 | Users can change their password | Partly | [VERIFIED] only through e-mail reset; Better Auth's change-password endpoint is not on the allow-list. | G2 |
| 2.1.6 | Change requires current + new password | Partly | [VERIFIED] no in-session change exists (see 2.1.5); reset needs the single-use e-mailed token. | G2 |
| 2.1.7 | Passwords checked against breached-password sets | Not met | [VERIFIED] no check in `src` (no breach list, no k-anonymity call; a call would also be a new external service). | G3 |
| 2.1.8 | Password strength meter | Not met | [VERIFIED] none in `src/components/control/forms.tsx`. | G3 |
| 2.1.9 | No composition rules | Met | [VERIFIED] length only. | |
| 2.1.10 | No periodic rotation / history requirement | Met | [VERIFIED] none. | |
| 2.1.11 | Paste and password managers allowed | Met | [ASSUMPTION] standard `<input type="password" autocomplete>`; no paste blocking found. | |
| 2.1.12 | User can view the masked password | Partly | [ASSUMPTION] no show-password toggle on the sign-in form. | G3 |
| 2.2.1 | Anti-automation (rate limits, lockout) | Met | [VERIFIED] DB-backed per-account limits (`signin-limit.ts`, `rate-limit.ts`), per-address when the proxy header is configured; Better Auth limiter as a second layer (`auth.ts` `rateLimit`). | |
| 2.2.2 | Weak authenticators (SMS/e-mail) limited | N/A | No SMS or e-mail OTP. | |
| 2.2.3 | Notifications after credential/authenticator changes | Not met | [VERIFIED] no e-mail on password reset completion, MFA enrol/disable or passkey changes (the outbox only carries invitations, verification and reset links). | G4 |
| 2.3.1 | System-generated initial passwords random and short-lived | Met | [ASSUMPTION] invitations carry a one-time token; the person sets their own password (`src/server/onboarding/invitations.ts`). | |
| 2.3.2 | Enrolment of user-provided authenticators (U2F/FIDO) supported | Met | [VERIFIED] passkeys as a second factor (`src/server/webauthn.ts`, `auth-plugin.ts`). | |
| 2.3.3 | Renewal instructions for time-bound authenticators | N/A | No expiring authenticators. | |
| 2.4.1 | Passwords stored with an approved salted one-way KDF | Met | [ASSUMPTION] Better Auth `hashPassword` (scrypt) per `docs/security/AUTH_AND_TENANCY_RC5.md`. | |
| 2.4.2 | Salt ≥ 32 bits, unique per credential | Met | [ASSUMPTION] Better Auth scrypt with a random 16-byte salt. | |
| 2.4.3 | PBKDF2 iterations | N/A | scrypt, not PBKDF2. | |
| 2.4.4 | bcrypt work factor | N/A | scrypt, not bcrypt. | |
| 2.4.5 | Additional KDF iteration with a secret salt (pepper) | Partly | [ASSUMPTION] no pepper on password hashes. | G7 |
| 2.5.1 | Activation/recovery secret not sent in clear text | Met | [VERIFIED by doc] reset link carries the token in the URL fragment; e-mail via the outbox only. | |
| 2.5.2 | No password hints or knowledge-based answers | Met | [VERIFIED] none. | |
| 2.5.3 | Recovery does not reveal the current password | Met | [VERIFIED] reset sets a new password. | |
| 2.5.4 | No shared or default accounts | Met | [ASSUMPTION] users created per person by admin CLI / invitation; demo accounts exist only in demo builds (absent from production build, checked by `check-chain-recording.mjs --marker demo`). [VERIFIED] the marker check passed on E1's production build. | |
| 2.5.5 | Notification when an authentication factor changes | Not met | [VERIFIED] same cause as 2.2.3: no notification is sent. | G4 |
| 2.5.6 | Recovery uses a secure mechanism (time-limited token, MFA) | Met | [ASSUMPTION per `LOGIN_SECURITY_V1.md`] 30-minute single-use hashed token; all sessions revoked on reset. | |
| 2.5.7 | Lost OTP/MFA: identity proofing equal to enrolment | Partly | [ASSUMPTION] recovery codes; no documented admin re-proofing procedure. | G4 |
| 2.6.1 | Look-up secrets single use | Met | [ASSUMPTION] Better Auth recovery codes are single use. | |
| 2.6.2 | Look-up secrets have ≥ 112 bits entropy, or are salted-hashed | Partly | [ASSUMPTION] stored encrypted, not hashed (`LOGIN_SECURITY_V1.md`, "Gaps"). | G4 |
| 2.6.3 | Look-up secrets resist offline attack | Partly | as 2.6.2. | G4 |
| 2.7.1 | Clear-text out-of-band (SMS/PSTN) not offered by default | N/A | none. | |
| 2.7.2 | Out-of-band verifier expires after 10 minutes | N/A | none (e-mail links are recovery, see 2.5.6). | |
| 2.7.3 | Out-of-band codes used once | N/A | none. | |
| 2.7.4 | Out-of-band channel secure and independent | N/A | none. | |
| 2.7.5 | Out-of-band code stored hashed | N/A | none. | |
| 2.7.6 | Out-of-band code ≥ 20 bits entropy, CSPRNG | N/A | none. | |
| 2.8.1 | Time-based OTPs have a defined lifetime | Met | [ASSUMPTION] Better Auth TOTP, 30-second step; challenge cookie 5 minutes [VERIFIED `twoFactorCookieMaxAge: 5 * 60`]. | |
| 2.8.2 | OTP seeds protected (HSM or secure OS storage) | Partly | [ASSUMPTION] TOTP secrets encrypted with the server secret in PostgreSQL; no HSM. | G7 |
| 2.8.3 | Approved crypto for OTP generation/verification | Met | [ASSUMPTION] RFC 6238 via Better Auth. | |
| 2.8.4 | OTP used once within its validity | Met | [VERIFIED] replay guard `totp_used` in `auth-route.ts`. | |
| 2.8.5 | Reuse of an OTP is logged and the user notified | Partly | [VERIFIED] reuse refused and counted; no notification. | G4 |
| 2.8.6 | Physical OTP generators can be revoked | N/A | no hardware OTP tokens (passkeys are removable within step-up). | |
| 2.9.1 | Crypto verifier keys stored securely | N/A | no client-certificate or hardware-OTP verifier keys; passkey public keys only. | |
| 2.9.2 | Challenge nonce ≥ 64 bits, unique | Met | [ASSUMPTION per `LOGIN_SECURITY_V1.md`] single-use 5-minute WebAuthn challenges bound to the user. | |
| 2.9.3 | Approved crypto for generation/verification | Met | [ASSUMPTION] ES256/RS256 in `src/server/webauthn.ts` (hand-written verifier, flagged there for independent review). | |
| 2.10.1 | Intra-service secrets not unchanging (no static passwords) | Partly | [VERIFIED] DB logins use static passwords from env. | G10 |
| 2.10.2 | Service credentials are not default credentials | Met | [VERIFIED] `scripts/db/setup-local.sh` takes the passwords as arguments; nothing default in production config. | |
| 2.10.3 | Passwords stored with sufficient protection | Met | [VERIFIED] env only, never in the repo (secret scan). | |
| 2.10.4 | Secrets/API keys not in source code | Met | [VERIFIED] secret scan; keys from env (`TRONGRID_API_KEY`, `ETHERSCAN_API_KEY`, `ANTHROPIC_API_KEY`, Xero/QBO). | |

Count V2: 52 rows.

## V3 Session management

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 3.1.1 | Session tokens never in URL | Met | [VERIFIED] cookie only (`getSession` reads the cookie; `auth.ts`). | |
| 3.2.1 | New token on authentication | Met | [ASSUMPTION per `AUTH_AND_TENANCY_RC5.md`] sign-in always creates a new session row. | |
| 3.2.2 | Tokens ≥ 64 bits entropy | Met | [ASSUMPTION] Better Auth random session tokens. | |
| 3.2.3 | Tokens stored in browser securely (cookies) | Met | [VERIFIED] `httpOnly: true, sameSite: "strict"`, `__Secure-` prefix on https. | |
| 3.2.4 | Tokens generated with approved crypto | Met | [ASSUMPTION] Better Auth CSPRNG; cookie signed HMAC-SHA256 (`auth.ts` comment). | |
| 3.3.1 | Logout and expiry invalidate the token | Met | [VERIFIED] DB sessions, no cookie cache; sign-out deletes the row. | |
| 3.3.2 | Re-authentication periodically (L2: 12 h or 30 min idle) | Met | [VERIFIED] 8 h absolute lifetime (`SESSION_SECONDS`, enforced in `getSession`). Idle timeout: refresh at most hourly. | |
| 3.3.3 | Option to end all other sessions after a credential change | Met | [ASSUMPTION per `LOGIN_SECURITY_V1.md`] reset revokes all sessions; `revoke-other-sessions` endpoint. | |
| 3.3.4 | Users can view and log out active sessions | Met | [ASSUMPTION] `GET /api/control/security`, revoke endpoints. | |
| 3.4.1 | Cookie `Secure` | Met | [VERIFIED by doc + code] Better Auth sets Secure on https (`__Secure-` cookie name in `middleware.ts`). | |
| 3.4.2 | Cookie `HttpOnly` | Met | [VERIFIED] `httpOnly: true`. | |
| 3.4.3 | Cookie `SameSite` | Met | [VERIFIED] `sameSite: "strict"`. | |
| 3.4.4 | `__Host-` prefix | Partly | [VERIFIED] `__Secure-` prefix, not `__Host-`. | G5 |
| 3.4.5 | Cookie path as narrow as possible | Met | [VERIFIED] `path: "/"` on a pilot origin that serves only Control (`deploymentGate`). | |
| 3.5.1 | OAuth tokens: user can revoke | N/A | Clearline is not an OAuth provider; the Xero connection is the operator's (legacy desk). | |
| 3.5.2 | Session tokens, not static API secrets, for users | Met | [VERIFIED] users get sessions; the test API key is fictional and synthetic-only. | |
| 3.5.3 | Stateless tokens signed and checked | N/A | stateful DB sessions only. | |
| 3.7.1 | Re-authentication before sensitive actions | Met | [VERIFIED] `freshlyAuthenticated` step-up (10 minutes) for MFA changes, recovery codes, passkeys, org MFA policy (`auth-route.ts`). | |

Count V3: 18 rows.

## V4 Access control

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 4.1.1 | Enforced on a trusted service layer | Met | [VERIFIED] server-side `can()` + RLS. | |
| 4.1.2 | Attributes cannot be manipulated by users | Met | [VERIFIED] principal from the session cookie only; the requested org slug only selects among the user's memberships (`tenant.ts`). | |
| 4.1.3 | Least privilege | Met | [ASSUMPTION per `AUTH_AND_TENANCY_RC5.md`] Admin has no financial authority; preparer never approves (engine maker-checker). | |
| 4.1.5 | Fail securely (exceptions deny) | Met | [VERIFIED] `AccessDenied`/`RequestRefused`; unknown errors → generic 500 "Nothing was changed" (`src/server/http.ts`). | |
| 4.2.1 | Protection against IDOR | Met | [ASSUMPTION] RLS on 31 tables (`ENABLE ROW LEVEL SECURITY` in `drizzle/*.sql`, [VERIFIED count]); another org's id is 404 (tests in `tests/control/workflow.test.ts`). | |
| 4.2.2 | Anti-CSRF | Met | [VERIFIED] exact `Origin == CLEARLINE_ORIGIN` on every mutation (`http.ts:sameOriginOrNull`), SameSite=Strict, Better Auth origin check on. | |
| 4.3.1 | Admin interfaces use MFA | Met | [ASSUMPTION per `LOGIN_SECURITY_V1.md`] MFA required for Admin and Approver (`mfa-gate.ts`). | |
| 4.3.2 | Directory browsing off; no metadata exposure (.git etc.) | Met | [VERIFIED] Next serves only `public/` and `/_next/static`; no `public/` directory listing. | |
| 4.3.3 | Additional authorisation (step-up/adaptive) for high-value actions | Partly | [VERIFIED] step-up for security settings; approvals rely on role + MFA session, no per-approval step-up. | G2 |

Count V4: 9 rows.

## V5 Validation, sanitisation and encoding

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 5.1.1 | HTTP parameter pollution defended | Met | [ASSUMPTION] JSON bodies parsed by zod `.strict()`; query params read singly. | |
| 5.1.2 | Mass assignment protected | Met | [VERIFIED] `.strict()` zod schemas reject unknown keys (e.g. `PullInput`). | |
| 5.1.3 | All input validated (allow-lists) | Met | [VERIFIED] zod schemas; ingest parsers validate every field; fuzzed (E1). | |
| 5.1.4 | Structured data strongly typed and validated | Met | [VERIFIED] zod; exact decimal parsing (`ingest/decimal.ts`), fuzz round-trip test. | |
| 5.1.5 | URL redirects only to allow-listed destinations | Met | [VERIFIED] middleware redirects to fixed paths only (`/clearline`, `/control`, `/control/sign-in`). | |
| 5.2.1 | Untrusted HTML sanitised | Met | [VERIFIED] no user HTML rendered; one `dangerouslySetInnerHTML` is a server-generated QR SVG (`src/app/pay/[publicId]/page.tsx`), one the nonce'd theme script. | |
| 5.2.2 | Unstructured data sanitised | Met | [ASSUMPTION] free-text notes stored and rendered as text. | |
| 5.2.3 | Input to SMTP/IMAP sanitised | Met | [VERIFIED] `validMessage` refuses CR/LF in subjects and odd recipients (`src/server/email/sender.ts`). | |
| 5.2.4 | No eval / dynamic code execution | Met | [VERIFIED] production CSP has no `'unsafe-eval'` (test `tests/platform/config.test.ts`); no `eval`/`new Function` in `src` [ASSUMPTION: grep]. | |
| 5.2.5 | Template injection prevented | Met | [VERIFIED] no server-side template engine. | |
| 5.2.6 | SSRF: validate/allow-list outbound URLs | Met | [VERIFIED] E1: every outbound request goes through `src/lib/net/safe-fetch.ts` (exact host allow-list, https only, private addresses refused, redirects refused); `tests/platform/outbound-fetch.test.ts` fails on any raw `fetch` in server code. Residual: DNS rebinding TOCTOU (G9). | G9 |
| 5.2.7 | SVG scriptable content sanitised | Met | [VERIFIED] no user SVG accepted; the QR SVG is generated by the `qrcode` library from a server value. | |
| 5.2.8 | Markdown/CSS/XSL/BBCode sanitised | Met | [VERIFIED] none rendered from user input. | |
| 5.3.1 | Output encoding per context | Met | [VERIFIED] React; CSV `csvCell`; JSON responses. | |
| 5.3.2 | Unicode-safe output encoding | Met | [ASSUMPTION] React text nodes. | |
| 5.3.3 | Context-aware escaping against XSS | Met | [VERIFIED] React + nonce CSP with `'strict-dynamic'`; a browser test proves an injected inline script and inline handler are blocked (`tests/platform/csp.spec.ts`, run in E1: 16/16 passed). | |
| 5.3.4 | Parameterised queries / ORM | Met | [VERIFIED] Drizzle; raw `sql` template tags parameterise. | |
| 5.3.5 | No string-built queries elsewhere | Partly | [ASSUMPTION] `set_config(…)` in `tenant.ts` uses parameters; not every `sql` usage re-checked. | |
| 5.3.6 | JSON injection prevented | Met | [VERIFIED] `JSON.stringify` only. | |
| 5.3.7 | LDAP injection | N/A | no LDAP. | |
| 5.3.8 | OS command injection | Met | [VERIFIED] no `child_process` in `src` request paths [ASSUMPTION: grep of `src/app`, `src/server`]. | |
| 5.3.9 | Local/remote file inclusion | Met | [VERIFIED] storage paths are `<uuid org>/<32-hex key>` checked by regex (`storage/local.ts:where`). | |
| 5.3.10 | XPath / XML injection | Met | [VERIFIED] camt.053 parsed with `fast-xml-parser` (no DTD processing); fuzzed with entity-expansion and external-entity payloads (`tests/fuzz/parsers.test.ts`). | |
| 5.4.1 | Memory-safe string/buffer handling | Met | [VERIFIED] TypeScript/Node; no native addons in the app. | |
| 5.4.2 | Format strings not attacker-controlled | Met | [VERIFIED] none. | |
| 5.4.3 | Sign, range and input validation against integer overflow | Met | [VERIFIED] amounts are BigInt minor units; `parseAmount` caps digits (`too_large`); fuzz round-trip. | |
| 5.5.1 | Serialised objects integrity-checked or encrypted | Partly | [ASSUMPTION] provider webhooks HMAC-verified (`src/lib/clearline/connect/verify.ts`); workspace JSON in the synthetic console is client data by design. | |
| 5.5.2 | XML parsers: restrictive config, no XXE | Met | [VERIFIED] fuzz test feeds XXE/billion-laughs payloads; result never contains file contents and only `IngestError` escapes. | |
| 5.5.3 | Deserialisation of untrusted data avoided/protected | Met | [VERIFIED] JSON + zod only. | |
| 5.5.4 | `JSON.parse` not eval; JSON client parsing safe | Met | [VERIFIED] no eval. | |

Count V5: 30 rows.

## V6 Stored cryptography

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 6.1.1 | Regulated private data encrypted at rest | Partly | [VERIFIED] uploaded files AES-256-GCM (`storage/local.ts`); DB rows rely on disk encryption [ASSUMPTION: Host]. | G8 |
| 6.1.2 | Regulated health data encrypted at rest | Met | No health data is processed (N/A in substance; counted Met). | |
| 6.1.3 | Regulated financial data encrypted at rest | Partly | as 6.1.1: files yes, DB columns no. | G8 |
| 6.2.1 | Crypto modules fail securely, no padding oracle | Met | [VERIFIED] AES-GCM (authenticated; tag failure throws), no CBC. | |
| 6.2.2 | Industry-proven crypto, no custom algorithms | Partly | [VERIFIED] node:crypto, @noble/hashes, Better Auth. The WebAuthn verifier is hand-written over vetted primitives (`webauthn.ts`), flagged for review. | |
| 6.2.3 | Approved IVs, modes, padding | Met | [VERIFIED] 12-byte random IV per file, GCM, org + key as AAD. | |
| 6.2.4 | Algorithms and key lengths replaceable | Partly | [VERIFIED] file format has a version magic ("CLU1"); no key-id for rotation. | G7 |
| 6.2.5 | No insecure modes/ciphers/hashes (ECB, MD5, SHA-1 for security) | Met | [ASSUMPTION] grep finds SHA-256 for integrity; no MD5/SHA-1 in security uses. | |
| 6.2.6 | Nonces/IVs not reused for a key | Met | [VERIFIED] random 96-bit IV per encryption. | |
| 6.3.1 | Random values from a CSPRNG | Met | [VERIFIED] `crypto.getRandomValues` (CSP nonce), node:crypto random bytes for tokens [ASSUMPTION for every token site]. | |
| 6.3.2 | GUIDs from v4 CSPRNG | Met | [ASSUMPTION] `randomUUID()`. | |
| 6.4.1 | Secrets management solution (vault) | Not met | [VERIFIED] env vars only; no vault/KMS. | G7 |
| 6.4.2 | Key material not exposed to the app (HSM/isolated) | Partly | [VERIFIED] keys in process memory from env. | G7 |

Count V6: 13 rows.

## V7 Error handling and logging

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 7.1.1 | No credentials or session tokens logged | Met | [VERIFIED] audit rows hold ids and counts; outbound errors never carry the URL (`safe-fetch.ts`, chain `Secrets.redact`). | |
| 7.1.2 | No other sensitive data logged (per policy) | Partly | [VERIFIED] audit rows: ids/counts. Console logs: 6 `console.*` calls in `src/server` + `src/lib` [VERIFIED count]; not all reviewed. | G6 |
| 7.1.3 | Security events logged (auth success/fail, access control fail, validation fail) | Partly | [ASSUMPTION] `audit_events` covers approvals, membership, MFA/security changes; failed sign-ins counted in `login_failures`, not as events. | G6 |
| 7.1.4 | Each event has enough metadata for investigation | Met | [ASSUMPTION] `audit_events`: org, actor, entity, time, source. | |
| 7.2.1 | All authentication decisions logged | Partly | as 7.1.3. | G6 |
| 7.2.2 | All access control decisions can be logged; failures logged | Partly | [ASSUMPTION] refusals return 403/404, not logged as events. | G6 |
| 7.3.1 | Log injection prevented (encoding) | Met | [VERIFIED] audit rows are structured columns; console logs carry fixed strings. | |
| 7.3.3 | Security logs protected from modification | Met | [VERIFIED] `audit_events_append_only` trigger refuses UPDATE/DELETE for everyone (`drizzle/0001_security.sql`). | |
| 7.3.4 | Time sources synchronised | Host | [ASSUMPTION] host NTP; timestamps from PostgreSQL `now()`. | |
| 7.4.1 | Generic error message with a unique id | Met | [VERIFIED] generic 500 "Something went wrong. Nothing was changed." (`http.ts`). No correlation id shown. | |
| 7.4.2 | Exception handling used consistently | Met | [VERIFIED] route wrappers in `control-http.ts`/`http.ts` catch and map errors. | |
| 7.4.3 | Last-resort error handler | Met | [ASSUMPTION] Next's error boundary + the route wrappers. | |

Note: [ASSUMPTION] 7.3.3 may be L3 in 4.0.3; kept to be safe. Count V7: 12 rows.

## V8 Data protection

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 8.1.1 | Sensitive data not cached in server components (load balancers, caches) | Partly | [ASSUMPTION] dynamic Control pages are per-request (`dynamic` routes); CDN config: Host. | G12 |
| 8.1.2 | Cached copies on server protected/purged | Met | [ASSUMPTION] no server-side page cache for Control. | |
| 8.1.3 | Minimise parameters in requests (no hidden fields with sensitive data) | Met | [ASSUMPTION] ids only. | |
| 8.1.4 | Detect and alert on abnormal request volumes (scraping) | Partly | [VERIFIED] rate limits on auth endpoints; none on data reads/exports. | G12 |
| 8.2.1 | Anti-caching headers on sensitive data | Partly | [VERIFIED] gate refusals send `Cache-Control: no-store`; Control pages rely on Next's dynamic `private, no-cache, no-store` default [ASSUMPTION]. | G12 |
| 8.2.2 | No sensitive data in browser storage | Met | [ASSUMPTION] Control keeps no data in localStorage/IndexedDB (the synthetic console stores fictional workspace only). | |
| 8.2.3 | Client storage cleared on logout | Met | follows 8.2.2. | |
| 8.3.1 | Sensitive data in body/headers, not query string | Partly | [ASSUMPTION] filters (entity, date) use GET query params; no secrets in URLs. Wallet addresses may appear in some legacy desk URLs. | G12 |
| 8.3.2 | Users can export / delete their data | Partly | [ASSUMPTION] merchant deletion (`src/server/merchant-deletion.ts`) and exports exist; per-person deletion not built. | |
| 8.3.3 | Clear language about collection and use | Partly | [ASSUMPTION] legal text is the founder's (`docs/LEGAL_QUESTIONS.md`); not in-app. | |
| 8.3.4 | Sensitive data identified with a policy for it | Met | as 1.8.1. | |
| 8.3.5 | Access to sensitive data audited | Partly | [ASSUMPTION] writes audited; reads (exports) partly. | G6 |
| 8.3.6 | Sensitive data cleared from memory after use | Not met | [ASSUMPTION] JavaScript cannot reliably zero memory; no attempt made. | G13 |
| 8.3.7 | Sensitive data encrypted with authenticated encryption | Met | [VERIFIED] AES-GCM for files. | |
| 8.3.8 | Retention classification and deletion | Met | [VERIFIED] upload retention job (`src/server/upload-retention.ts`), 90 days default (founder decision); audit 7 years [ASSUMPTION]. | |

Count V8: 15 rows.

## V9 Communication

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 9.1.1 | TLS for all client connections, no fallback | Host | [VERIFIED] HSTS (2 years, subdomains) on every response (E1, `next.config.mjs`); TLS termination is the host's. | G10 |
| 9.1.2 | Only strong cipher suites | Host | proxy configuration. | |
| 9.1.3 | Only TLS 1.2/1.3 | Host | proxy configuration. | |
| 9.2.1 | Outbound connections use trusted TLS certificates | Met | [VERIFIED] `safe-fetch.ts` refuses non-https; Node verifies certificates. | |
| 9.2.2 | TLS for all outbound/backend connections | Partly | [VERIFIED] outbound HTTP yes; PostgreSQL TLS depends on `DATABASE_URL` (`sslmode`) [ASSUMPTION]. | G10 |
| 9.2.3 | Encrypted, authenticated external connections | Host | as 9.2.2 for the DB. | |
| 9.2.4 | Certificate revocation (OCSP stapling) | Host | proxy configuration. | |

Count V9: 7 rows.

## V10 Malicious code

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 10.2.1 | No unauthorised phone-home / data collection | Met | [VERIFIED] the only outbound hosts are the allow-listed APIs (`outbound-hosts.ts`); `NEXT_TELEMETRY_DISABLED` in CI. | |
| 10.2.2 | No unexpected permissions requested | Met | [VERIFIED] Permissions-Policy denies camera, microphone, geolocation, payment, USB and more (E1). | |
| 10.3.1 | Auto-update over secure channels with integrity | Met | No auto-update; deployments from the lockfile (`npm ci`). | |
| 10.3.2 | Integrity protections (SRI) on third-party resources | Met | [VERIFIED] no third-party scripts or styles; CSP `'self'` only. | |
| 10.3.3 | Protection from subdomain takeover | Partly | [ASSUMPTION] DNS is the operator's; release URLs pinned in `clearline-release.json`. | |

Count V10: 5 rows.

## V11 Business logic

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 11.1.1 | Flows processed in order, no skipped steps | Met | [ASSUMPTION] engine state machine; approval needs a request; preparer never approves. | |
| 11.1.2 | Realistic human timing; no too-fast submissions | Partly | [ASSUMPTION] rate limits on auth only. | G12 |
| 11.1.3 | Limits per action/transaction | Met | [VERIFIED] upload size/row limits; ingest limits (`ingest/limits.ts`). | |
| 11.1.4 | Anti-automation against excessive calls (data exfiltration, DoS) | Partly | as 8.1.4. | G12 |
| 11.1.5 | Business logic limits/validation against threats | Met | [ASSUMPTION] decision 5: auto-close only on exact reference + final chain + verified contract + exact amount; any difference to review. | |
| 11.1.6 | No TOCTOU in sensitive operations | Met | [ASSUMPTION] DB transactions, conditional single UPDATE for one-time tokens, idempotency keys. | |
| 11.1.7 | Monitoring for unusual events | Met | [ASSUMPTION] exceptions queue with owner, reason, next step; deal signals. Security alerting: see G6. | |
| 11.1.8 | Configurable alerting on automated attacks | Met | [ASSUMPTION] per-account lockout responses (429); no external alerting. | G6 |

Count V11: 8 rows.

## V12 Files and resources

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 12.1.1 | Large files refused (size limits) | Met | [VERIFIED] declared and actual size capped before buffering (`control-http.ts` upload path, `readBodyLimited`). | |
| 12.1.2 | Compressed files checked (zip bombs) | Partly | [ASSUMPTION] `.xlsx` read by exceljs with ingest row/cell limits (`ingest/xlsx.ts`); no explicit decompressed-size cap. | G14 |
| 12.1.3 | Per-user quota / file count | Partly | [ASSUMPTION] per-file limits; no per-org quota. | G14 |
| 12.2.1 | File type checked by content | Met | [VERIFIED] `sniffFile` detects by content (fuzzed in E1). | |
| 12.3.1 | User file names not used directly in paths | Met | [VERIFIED] storage key is random hex (`storage/local.ts`). | |
| 12.3.2 | Path traversal prevented | Met | [VERIFIED] org uuid + key regex before `path.join`. | |
| 12.3.3 | No remote file inclusion | Met | [VERIFIED] no file URLs fetched; outbound only via the safe client. | |
| 12.3.4 | No reflected file download (RFD) | Met | [ASSUMPTION] downloads have fixed names and `Content-Disposition: attachment`. | |
| 12.3.5 | No OS command execution with file metadata | Met | [VERIFIED] none. | |
| 12.3.6 | No untrusted file inclusion in code | Met | [VERIFIED] none. | |
| 12.4.1 | Untrusted files stored outside the web root | Met | [VERIFIED] `CLEARLINE_DATA_DIR`/storage directory, never under `public/`. | |
| 12.4.2 | Uploads scanned for malware | N/A | [ASSUMPTION per `UPLOADS_AND_MALWARE_SCANNING.md`] text/tabular files only, parsed never executed; binary uploads need founder approval and a scanner first. | |
| 12.5.1 | Web tier serves only allowed file extensions | Met | [VERIFIED] Next serves its build assets and `public/` only. | |
| 12.5.2 | Uploaded files never executed as HTML/JS | Met | [VERIFIED] never served inline; `nosniff`. | |
| 12.6.1 | SSRF: server fetches only allow-listed URLs | Met | [VERIFIED] E1 safe client; test fails on any bypass. | |

Count V12: 15 rows.

## V13 API and web service

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 13.1.1 | Same encoding/parsers across components | Met | [VERIFIED] UTF-8 JSON everywhere. | |
| 13.1.3 | No sensitive data (keys, tokens) in API URLs | Met | [VERIFIED] session cookies; reset token in the URL fragment; test API key in a header. | |
| 13.1.4 | Authorisation at URI and resource level | Met | [VERIFIED] route wrapper checks session + role, service checks entity/resource, RLS checks org. | |
| 13.1.5 | Requests with unexpected content types rejected | Partly | [ASSUMPTION] JSON routes parse as JSON and refuse non-JSON; not every route checks `Content-Type`. | |
| 13.2.1 | Only intended HTTP methods enabled | Met | [VERIFIED] Next route handlers export specific methods; `gates.spec.ts` checks 405s on the test API (run in E1: passed). | |
| 13.2.2 | JSON schema validation | Met | [VERIFIED] zod. | |
| 13.2.3 | CSRF protection for cookie-authenticated APIs | Met | [VERIFIED] exact-Origin check + SameSite=Strict. | |
| 13.2.5 | Content-Type checked on incoming requests | Partly | as 13.1.5. | |
| 13.2.6 | Message headers and payload trusted only after integrity check | Met | [ASSUMPTION] provider webhooks verified by HMAC with key rotation (`connect/verify.ts`). | |
| 13.3.1 | XSD validation for XML | N/A | camt.053 is read defensively (fuzzed) but not XSD-validated; no SOAP. | |
| 13.4.1 | GraphQL query allow-list / depth limiting | N/A | no GraphQL. | |
| 13.4.2 | GraphQL authorisation at the business-logic layer | N/A | no GraphQL. | |

Count V13: 12 rows.

## V14 Configuration

| ID | Requirement (paraphrased) | Status | Evidence | Gap |
|---|---|---|---|---|
| 14.1.1 | Build and deploy processes secure and repeatable | Met | [VERIFIED] CI from lockfile; production build gate (`npm run build:prod-check`); deploy guard (`src/server/deploy-guard.ts`). | |
| 14.1.2 | Compiler/build security flags | Met | [VERIFIED] TypeScript strict type-check in CI; `reactStrictMode`. | |
| 14.1.3 | Server configuration hardened | Partly | [VERIFIED] `poweredByHeader: false`, config validation fails fast (`next.config.mjs:assertDeploymentConfig`); host hardening: Host. | |
| 14.1.4 | Deployment automatable in reasonable time | Met | [ASSUMPTION] `Dockerfile`, runbooks in `docs/runbooks/`. | |
| 14.2.1 | Components up to date | Partly | [VERIFIED] E1 audit: 0 high/critical, 2 moderate (accepted with reasons in `.github/security/audit-allowlist.json`). No automated update PRs. | G11 |
| 14.2.2 | Unneeded features/docs/samples removed | Met | [VERIFIED] demo code absent from a plain production build (`check-chain-recording.mjs --marker demo --expect absent` passed in E1). | |
| 14.2.3 | Third-party assets from CDNs use SRI | Met | [VERIFIED] no CDN assets; fonts self-hosted (`@fontsource`). | |
| 14.2.4 | Third-party components from trusted, maintained sources | Met | [VERIFIED] npm registry, exact versions in `package.json`. | |
| 14.2.5 | Inventory (SBOM) of third-party libraries | Partly | [VERIFIED] `package-lock.json` is a full inventory; no SBOM artefact. | G11 |
| 14.2.6 | Attack surface reduced by sandboxing/encapsulating libraries | Partly | [VERIFIED] SDKs wrapped (ledger read-only `readOnly()`, Anthropic SDK via the safe client); no process sandbox. | |
| 14.3.2 | Debug modes off in production | Met | [VERIFIED] production CSP drops `'unsafe-eval'`/dev sources; `NODE_ENV=production` for `next start`. | |
| 14.3.3 | No version disclosure in headers | Met | [VERIFIED] `poweredByHeader: false`; `headers.spec.ts` asserts no `X-Powered-By` (E1). | |
| 14.4.1 | Content-Type with charset on every response | Partly | [ASSUMPTION] Next sets `text/html; charset=utf-8`; JSON helpers set `application/json`. Not asserted for every route. | |
| 14.4.2 | API responses carry `Content-Disposition: attachment` where downloads | Met | [VERIFIED] export routes (see 1.12.2). | |
| 14.4.3 | Content-Security-Policy | Met | [VERIFIED] per-request nonce CSP; production: no `'unsafe-inline'` except style attributes, no `'unsafe-eval'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'` (E1; `tests/platform/headers.spec.ts`, `csp.spec.ts`). | |
| 14.4.4 | `X-Content-Type-Options: nosniff` | Met | [VERIFIED] every route (E1 test). | |
| 14.4.5 | Strict-Transport-Security | Met | [VERIFIED] `max-age=63072000; includeSubDomains` on every route (E1). Preload not requested. | |
| 14.4.6 | Referrer-Policy | Met | [VERIFIED] `strict-origin-when-cross-origin`. | |
| 14.4.7 | Framing restricted (frame-ancestors / XFO) | Met | [VERIFIED] `frame-ancestors 'none'` + `X-Frame-Options: DENY`. | |
| 14.5.1 | Only required HTTP methods accepted | Met | as 13.2.1. | |
| 14.5.2 | `Origin` header not used for authentication/access decisions | Met | [VERIFIED] Origin is a CSRF check only, on top of the session. | |
| 14.5.3 | CORS allow-list strict | Met | [VERIFIED] no CORS headers sent by Control (same-origin only); COOP/CORP `same-origin` (E1). The test API answers its own OPTIONS (synthetic data). | |
| 14.5.4 | Trusted-proxy headers not trusted from clients | Host | [VERIFIED] per-address limits stay OFF unless the operator names a header the proxy overwrites (`client-ip.ts`); correctness depends on the proxy. | |

Count V14: 23 rows.

---

## Count note

[ASSUMPTION] Totals depend on the transcribed ID list; re-check against the official 4.0.3 CSV (G0). "Met" for 6.1.2 means no health data is processed.

## Gaps and proposed fixes

| # | Gap (requirements) | Proposed fix | Approval needed? |
|---|---|---|---|
| G0 | The ID/level list here is transcribed from memory (all) | Import the official ASVS 4.0.3 CSV into `docs/security/` and regenerate this table's skeleton from it; diff. | No |
| G1 | Per-change threat modelling, secure-coding guidance, SDLC write-up (1.1.1-1.1.4, 1.1.7) | Add a short threat-model section to the PR template (what crosses a trust boundary, what data, what new outbound host), and a one-page secure-coding checklist that points at the central controls (authz, tenant, safe-fetch, csvCell, zod). Write `docs/security/THREAT_MODEL_V1.md`. | No |
| G2 | No in-session password change; no step-up per approval (2.1.5, 2.1.6, 4.3.3) | Expose Better Auth change-password behind the allow-list with current-password + fresh step-up, revoke other sessions; consider a step-up (second factor within 10 minutes) for approving high-value postings. | **Yes: security-control change (adds an auth endpoint)** |
| G3 | Breached-password check, strength meter, show-password (2.1.7, 2.1.8, 2.1.12) | Ship a bundled top-100k common-password list (no network call) checked at reset/invite; a local strength estimate in the form; a show-password toggle. | No (strengthens). A k-anonymity breach API would be a new external service: **Yes** |
| G4 | No security notifications; recovery codes encrypted not hashed; no re-proofing procedure (2.2.3, 2.5.5, 2.5.7, 2.6.2-3, 2.8.5) | Queue an outbox e-mail on password reset, MFA enrol/disable, passkey add/remove, recovery-code regeneration, OTP replay. Hash recovery codes (needs a Better Auth hook or a plugin change). Document admin re-proofing for lost factors. | Hashing codes changes an auth store: **Yes** |
| G5 | Cookie prefix `__Secure-` not `__Host-` (3.4.4) | Set Better Auth's cookie to `__Host-clearline.session_token` on https (path `/`, no Domain) and update `middleware.ts:hasSessionCookie`. | **Yes: session-control change** |
| G6 | Logging coverage and shipping (1.7.x, 7.1.2-3, 7.2.x, 8.3.5, 11.1.8) | Add audit events for sign-in success/failure, MFA failures, access refusals (403/404 on Control) and exports; a structured JSON logger with a field allow-list replacing free-form console logs; document shipping to the host's log store. | No |
| G7 | Key management (1.6.1, 2.4.5, 2.8.2, 6.2.4, 6.4.x) | Document generation, storage and rotation for `BETTER_AUTH_SECRET`, `CLEARLINE_UPLOAD_KEY`, DB passwords; add a key id to the upload file format ("CLU2") to allow rotation; use the host's secrets manager when chosen. | Choice of a secrets manager is a vendor/cost decision: **Yes** |
| G8 | DB rows not field-encrypted (1.8.2, 6.1.1, 6.1.3) | Rely on encrypted disks at the host [Host]; evaluate column encryption for customer references and wallet addresses (cost: no SQL search on them). | Yes (design trade-off) |
| G9 | DNS-rebinding TOCTOU in the SSRF client (5.2.6 residual) | Pin the connection to the checked address with an undici `Agent` `connect.lookup` (needs `undici` as a direct dependency), or route egress through a forward proxy with the same allow-list. | Adding a dependency: founder's call |
| G10 | Component TLS / static service passwords (1.2.2, 1.9.1, 2.10.1, 9.2.2) | Require `sslmode=verify-full` for non-local `DATABASE_URL` in `deploymentConfigProblems`; rotate DB passwords on a schedule. | Refusing non-TLS DB URLs changes deploy config: **Yes** |
| G11 | Signed artefacts, SBOM, update automation (1.14.2, 14.2.1, 14.2.5) | Generate an SBOM (`npm sbom --sbom-format cyclonedx`) as a CI artefact; enable Dependabot security updates; sign the image if one is published. | No |
| G12 | Caching headers, read/export rate limits, query-string data (8.1.1, 8.1.4, 8.2.1, 8.3.1, 11.1.2, 11.1.4) | Explicit `Cache-Control: no-store` on Control pages and API answers (assert in `headers.spec.ts` with a pilot build); DB-backed rate limits on exports and bulk reads; move filter values that carry personal data to POST or opaque ids. | No |
| G13 | Clearing secrets from memory (8.3.6) | Not achievable in JavaScript; accept and document (short-lived processes, no core dumps at the host). | Acceptance: founder |
| G14 | Zip-bomb and quota limits for `.xlsx` (12.1.2, 12.1.3) | Check the declared uncompressed size of each zip entry before exceljs inflates it; per-organisation daily upload quota. | No |

## What E1 changed (for traceability)

- CSP tightened (style elements `'self'`, `base-uri 'none'`, `frame-src 'none'`, worker/manifest pinned); HSTS, COOP,
  CORP, a broader deny-all Permissions-Policy and `X-Permitted-Cross-Domain-Policies` on every route;
  `tests/platform/headers.spec.ts` on a production build.
- `src/lib/net/safe-fetch.ts` + `outbound-hosts.ts`; every outbound call routed through it; `tests/platform/outbound-fetch.test.ts`.
- `tests/fuzz/` (harness + parser properties).
- `.github/workflows/security.yml`: `dependency-audit`, `secret-scan`, `security-headers` (not required yet).
