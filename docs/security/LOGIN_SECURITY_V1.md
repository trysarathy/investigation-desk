# Login security (v1 phase 1.2)

Status: built on branch `v1/b2-auth`, local commits only. Every item below is a **security-control change that
strengthens** sign-in; none loosens an existing guard. Independent review is requested before merge, in particular for
the hand-written WebAuthn verifier (`src/server/webauthn.ts`). No certification or compliance claim is made.

## What is enforced

| Control | Where | Notes |
|---|---|---|
| MFA required for Admin and Approver | `src/server/mfa-gate.ts`, called by `tenantFrom` (every `/api/control` route), `pageContext` (every `/control` page) and `POST /api/control/org` | Until enrolled: pages redirect to `/control/security?required=enrol`, APIs answer `403 MFA_ENROLLMENT_REQUIRED`. |
| Per-organisation "MFA for everyone" | `org_security_settings` (RLS: members read; only that org's Admin writes, as themselves) | Admin only, fresh step-up, audited. |
| A session of an MFA user must have proved MFA | `sessions.mfa_verified_at`, set only when the session is created by a second-factor endpoint, or stamped by a step-up | Otherwise `403 MFA_VERIFICATION_REQUIRED`. |
| TOTP + 10 recovery codes | Better Auth `twoFactor` plugin | Secret and codes stored encrypted (server secret). Enabling needs the password. "Trust this device" is never honoured. A TOTP code is accepted once (replay guard). Lockout after 5 consecutive failures for 15 min. |
| Passkeys (second factor) | `src/server/auth-plugin.ts`, `src/server/webauthn.ts` | Added on top of TOTP, within a fresh step-up. ES256/RS256, attestation "none" (not verified), UP+UV required, exact origin and RP ID, single-use 5-minute challenges bound to the user, increasing signature counter. |
| Step-up for sensitive actions | `freshlyAuthenticated` (10 minutes) | Turning MFA off, new recovery codes, adding/removing passkeys, the org MFA policy. A user with MFA steps up with a second factor; a password counts only for a user without MFA. |
| Password reset by e-mail | Better Auth reset, behind `src/server/auth-route.ts` | 30-minute, single-use token, stored hashed (`verification.storeIdentifier: "hashed"`), link in the URL fragment, all sessions revoked on reset, same answer for every address, sent only to a verified address. |
| E-mail verification | `src/server/email-verification.ts`, `auth_tokens` | 256-bit token, SHA-256 at rest, 30 minutes, spent by one conditional UPDATE; a new link voids the older ones. Better Auth's own (replayable, stateless) verification endpoints are blocked. |
| E-mail sending | `src/server/email/` (`EmailSender.send({to, subject, text, html?, kind?})`, the one sender shared with onboarding) | Only the local outbox (`CLEARLINE_EMAIL_SENDER=outbox`, table `email_outbox`, the web app can INSERT but never SELECT) or "disabled". No real provider is called. |
| Session list and revoke | `GET /api/control/security`, `POST /api/control/security/revoke-session`, `/revoke-other-sessions` | Own sessions only; no tokens or addresses are returned; another user's id is a 404. |
| Endpoint allow-list | `src/server/auth-route.ts` | Every other Better Auth endpoint (sign-up, change-email, two-factor/disable, list-sessions, get-session, …) is a 404. |
| Attempt limits | `src/server/rate-limit.ts` (database, shared by every instance), `src/server/signin-limit.ts` | Per account AND per address: sign-in, MFA (TOTP, recovery code, passkey, step-up), reset requests, reset submissions, verification e-mails and links. Better Auth's in-memory limiter stays as a second layer keyed on the trusted address only. |

## Deployment: the client address

Route handlers cannot see the TCP peer, and `next start` only fills `X-Forwarded-For` when the request has none. So
**per-address limits are OFF unless the operator says how to find the address** (per-account limits always apply):

- `CLEARLINE_CLIENT_IP_HEADER=X-Real-IP` — a single-value header the proxy overwrites on every request; or
- `CLEARLINE_TRUSTED_PROXY_HOPS=1` — the number of proxies that each append to `X-Forwarded-For`; or
- `CLEARLINE_TRUSTED_PROXIES=10.0.0.0/8,…` — the proxies' addresses; the first untrusted hop from the right is the client.

Use the last two only when the app's port is reachable from the proxy alone; otherwise a client could write its own
`X-Forwarded-For`. IPv6 clients are bucketed by /64.

## Gaps (honest)

- **OIDC SSO is not built.** Better Auth's SSO plugin (`@better-auth/sso`) is not installed and packages cannot be added
  here. The installed `generic-oauth` plugin could carry per-organisation OIDC, but doing it safely needs: no implicit
  sign-up, a binding from each provider to one organisation, SSO sessions scoped to that organisation, MFA step-up for
  enrolled users, and a mock IdP for tests. Left as a decision.
- Passkeys are a second factor only (no passwordless sign-in), and are not exercised in the Playwright suite (the e2e
  origin is an IP address, which WebAuthn does not accept as an RP ID); they are covered by control tests with a
  software authenticator.
- Recovery codes are stored encrypted (Better Auth), not hashed.
- The admin CLI marks the accounts it creates as e-mail-verified (pre-existing behaviour, unchanged).
- A reset request for an existing, verified address does slightly more work than one for an unknown address
  (an outbox insert): a timing difference, not a different answer.
