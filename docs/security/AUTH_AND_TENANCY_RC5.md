# Authentication, authorisation and tenancy (rc5)

## Authentication — `src/server/auth.ts`

**Library:** Better Auth 1.7.18, with the Drizzle adapter. It is an established, maintained library, and Clearline implements no password crypto or protocol of its own. Users are created by an administrator with the library's own `hashPassword` (scrypt).

| Control | Setting | Test (`tests/control/auth.test.ts`) |
|---|---|---|
| Sign-in | email + password; there is **no public sign-up** (`disableSignUp`) | "signs in…", "there is no public sign-up" |
| Generic failure | the same 401 message for an unknown user and a wrong password | "refuses a wrong password and an unknown user…" |
| Sessions | **database rows**; 8 h absolute, refreshed at most hourly; **no cookie cache**, so a deleted row ends the session at once | "an expired session…", "revoking sessions…", "sign-out deletes…" |
| Cookie | `clearline.session_token`, `HttpOnly`, `SameSite=Strict`, `Secure` on https | checked in the sign-in test |
| CSRF | **exact `Origin == CLEARLINE_ORIGIN`** on every POST to `/api/auth` and `/api/control` (`src/server/http.ts`), **and** Better Auth's own origin check, forced on (`disableOriginCheck: false`). The library disables that check under `NODE_ENV=test` by default; a test caught this | "refuses a sign-in from a foreign origin", "a sign-out … from a foreign origin is refused…" |
| Brute force | **per account**: 5 failed sign-ins per 15 min, counted in PostgreSQL (`login_failures`, shared by every instance; `src/server/signin-limit.ts`), then 429 even for the right password. A per-IP limit is added only when the deployment names a header its proxy overwrites (`CLEARLINE_CLIENT_IP_HEADER`); a client-supplied `X-Forwarded-For` never chooses a bucket | "limits failed sign-ins PER ACCOUNT, even when every attempt claims a different X-Forwarded-For" |
| Absolute session lifetime | a session is refused (and deleted) 8 h after sign-in, even if the library refreshed its expiry | "a session older than 8 hours is refused…" |
| Runtime role guard | refuse to serve if the database role is superuser or BYPASSRLS (`tenant.ts:checkRuntimeRole`) | hardening test M8 |
| Forged cookie | not a session | "a forged or random cookie…" |

**Limitations:**
- **Lockout risk.** The per-account limit allows an attacker to lock one account for 15 minutes (a deliberate trade-off).
- **No MFA, SSO or password reset flow** exists yet.
- **No session fixation risk in this flow.** Sign-in always creates a new session token server-side and never reuses an existing one.

## Organisation context — `src/server/tenant.ts`

1. The **Principal** (user id, name, email) comes only from the session cookie.
2. `resolveTenant(principal, requestedSlug)` lists the user's **active** memberships.
   - The requested slug, from a cookie or path, only *selects* among them.
   - An organisation the user doesn't belong to returns **404**, so its existence is not disclosed.
3. `withTenant` opens one transaction and sets `app.user_id` and `app.org_id` with `set_config(…, true)`, which is transaction-scoped.
   - When that transaction ends, the pooled connection no longer carries the context (tested).
4. Inside the transaction, RLS limits every tenant table to that organisation, and to an active member of it.
   - This is defence in depth: services also filter by `orgId` explicitly.

**Tests (`tests/control/workflow.test.ts`, "tenant isolation…").** The two seeded organisations deliberately share engine record ids, such as `pi_00027` and `exc_…`:
- selecting the other organisation gets 404;
- with RLS, the other organisation's id forced into the context returns 0 rows;
- writes in B are invisible to A;
- A's approver cannot decide B's request (404);
- A's export contains none of B's data;
- no context leaks between transactions.

## Authorisation — `src/server/authz.ts`

| Permission | Admin | Payment Ops | Finance | Approver | Viewer |
|---|---|---|---|---|---|
| read | ✓ | ✓ | ✓ | ✓ | ✓ |
| investigate (owner, notes, evidence, info, reopen) | | ✓ | | | |
| request approval | | ✓ | | | |
| decide approval | | | | ✓ | |
| import statement | | | ✓ | | |
| accounting prepare (propose, export, posting reference, periods, mapping) | | | ✓ | | |
| accounting approve | | | | ✓ | |
| manage members | ✓ (CLI only in rc5) | | | | |

- **Least privilege:** Admin has no financial authority.
- **Two checks:** the matrix is checked on the server before every action, and then the engine applies its own role and maker-checker rules with the session user as actor.
- **Engine roles:**
  - payment_ops and finance map to `operator`;
  - approver maps to `approver`;
  - admin and viewer map to `viewer`.
- **Not reachable through the pilot API:** payment creation and execution, provider simulation, clock changes, scenario reset and direct `resolve`. These return `ACTION_NOT_AVAILABLE` (tested).
- **Revocation:**
  - `scripts/control/admin.ts revoke <org> <email>` sets `revoked_at` and deletes the user's sessions.
  - The membership no longer resolves, and RLS (`app_is_member`) refuses the user's rows even on a direct database write (tested).

## Public demo identity

The public sandbox keeps its "Acting as" picker, which is labelled "Simulated role — not sign-in or access control". The pilot never falls back to it:
- a pilot deployment does not serve `/clearline`;
- a non-pilot deployment does not serve `/control`.
