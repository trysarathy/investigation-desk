# Onboarding (v1 phase 1.1): invite-only, platform console, setup wizard

Fictional values only in every example. Nothing here moves money, connects to a ledger or calls a paid service.

## Invite-only

There is no public sign-up. Better Auth runs with `disableSignUp`, and `src/app/api/auth/[...all]/route.ts`
refuses every `sign-up` / `signup` path (any method, any case, percent-encoded) with 404 before Better Auth sees it
(tests: `tests/control/provisioning.test.ts`, `tests/e2e-onboarding/onboarding.spec.ts`). A person gets an account
only by accepting an invitation (`/control/invite`) or from the operator's CLI (`create-user`, `add-member`).

An invitation is a one-time token (32 random bytes). Only its SHA-256 is stored (`org_invitations`); the token is in
the email link's `#fragment`, which browsers never send to a server. It expires after 72 hours [ASSUMPTION] (the
database caps any invitation at 7 days), works once, and a new invitation to the same person replaces the old one.

## Roles and logins

| Login | Used by | May do |
|---|---|---|
| `clearline_owner` | migrations, admin CLI | everything (never the web app) |
| `clearline_runtime` | web app (`DATABASE_URL`) | unchanged by this phase (snapshot test) |
| `clearline_jobs` | job worker | unchanged |
| `clearline_provisioning` (new) | platform console, invitation acceptance, setup wizard (`DATABASE_PROVISIONING_URL`) | EXECUTE on 14 `prov_*` functions only; no table privilege; NOBYPASSRLS; owns nothing |

`scripts/db/setup-local.sh <db> <owner-pw> <runtime-pw> <jobs-pw> <provisioning-pw>` creates the provisioning login
(the 5th argument, or `CLEARLINE_PROVISIONING_PASSWORD`). Without it, migration 0049 creates the role without login.
The app refuses a provisioning URL that names a superuser, a BYPASSRLS login, the table owner or a member of
`clearline_app`. Without `DATABASE_PROVISIONING_URL` the Setup page says setup is not available and the nav hides it.

The `prov_*` functions (drizzle/0049) are SECURITY DEFINER, owned by the schema owner, with a fixed search_path.
They check who acts from the transaction's `app.user_id` / `app.org_id` (set by the server from the session):
wizard functions act only on `app_org_id()`, only for an active **Admin** of that merchant, only until setup is
finished; platform functions only for an active platform operator. Every write inserts an `audit_events` row with the
acting user's id.

## Platform operator (the narrowest definition)

Clearline had no platform-operator concept. A platform operator is a user listed in `platform_operators`, and the
console exists only when the deployment sets `CLEARLINE_PLATFORM_CONSOLE=1`. Both are required; otherwise
`/control/platform` and its API are a 404. There is no screen that grants the flag:

```sh
DATABASE_OWNER_URL=... npm run control:admin -- grant-platform-operator operator@platform.example
DATABASE_OWNER_URL=... npm run control:admin -- revoke-platform-operator operator@platform.example   # also signs them out
```

An operator can create an empty LIVE merchant or provider organisation (optionally a merchant served by an existing
provider) and invite its FIRST admin (Admin of a merchant, Provider Admin of a provider). Once the organisation has an
admin, the operator cannot invite anyone else into it. The console shows ids, names, kinds and counts only: no
organisation data, member list or emails.

## Email

`src/server/email` defines ONE `EmailSender { send({ to, subject, text, html?, kind? }) }`, shared with login
security (phase 1.2; unified at the wave 1 integration). The only implementation is the local outbox
(`CLEARLINE_EMAIL_SENDER=outbox`: the `email_outbox` table; the web app may insert but never read it, the provisioning
role queues invitation emails only through `prov_queue_invitation_email`, drizzle/0068). Without it, inviting is
refused and nothing is created. The invitation row and its email are in one transaction (the provisioning
transaction, or the owner's for the CLI): if the sender refuses or anything later fails, both are rolled back. Tests
read the outbox as the owner (`tests/support/email-outbox.ts`, test-only).

## CLI (schema owner, `DATABASE_OWNER_URL`)

```sh
npm run control:admin -- create-merchant acme-sg --name "Acme SG (fictional)" --timezone Asia/Singapore
npm run control:admin -- invite-admin acme-sg first.admin@acme.example      # needs CLEARLINE_EMAIL_SENDER=outbox, CLEARLINE_ORIGIN
```

## The setup wizard (`/control/merchant/setup`, merchant Admin only)

Steps: entities and currencies → ledger (Xero / QuickBooks Online / none; a choice only, no connection) → bank
accounts (last four characters only) → matching tolerance (the approved default per entity: larger of 0.5% or
SGD 5 / USD 5 / AED 20; to change it, the Settings page) → payment provider (link by its code when none; aggregates
only) → mapping templates (optional, from a pasted header row) → users and roles (invitations) → finish. Entities,
ledger and tolerance must be done before finishing. After finishing, every wizard write is refused; later changes
go through the operator's CLI, or Settings for the matching policy.

## Checks

- `npm run test:control` with `CLEARLINE_TEST_PROVISIONING_URL` (the provisioning login) — `tests/control/provisioning.test.ts`
  fails with BLOCKED without it.
- `npx playwright test -c playwright.onboarding.config.ts` after a pilot build (desktop and mobile, axe 0 violations).
- The runtime grants snapshot `tests/control/fixtures/runtime-grants.json` was captured at 6352925 (migrations
  0000–0041). Regenerate it only for a reviewed migration that intentionally changes the runtime role's grants.
