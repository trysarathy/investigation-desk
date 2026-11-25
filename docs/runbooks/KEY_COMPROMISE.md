# Runbook: a key, password or account is compromised

Labels: **[VERIFIED]** read in the code; **[ASSUMPTION]** reasoned, not tested; **[ASSUMPTION, lawyer]** to confirm.
Clearline holds **no private keys and no wallet keys**: it reads public chains and never signs or moves funds. The
secrets below protect customer data and the integrity of what Clearline shows. Rotations are done by two people.

Start an incident (docs/runbooks/INCIDENT_RESPONSE.md, severity 1 if customer data may have been read).
Never paste a secret into a ticket, chat, log or this repository.

## Inventory (names only)

| Secret | What it protects | Rotation | Side effects |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | session signing; encryption of stored authenticator (TOTP) secrets [VERIFIED: tests/control/harness.ts enrols TOTP "exactly as Better Auth stores one: encrypted"]; rate-limit key hashing (src/server/rate-limit.ts) | new value in the secrets manager, redeploy | every session ends; every enrolled authenticator becomes unreadable, so users re-enrol MFA (plan this with customers); rate-limit counters reset |
| `CLEARLINE_UPLOAD_KEY` | AES-256-GCM encryption of uploaded files at rest | **no in-place rotation in this build** [VERIFIED: one key, src/server/storage/local.ts] | files encrypted with the old key can only be read with it. If the key leaked: the files' confidentiality is lost anyway; set a new key for new uploads, keep the old one offline only until the uploads purge has deleted the old files (90 days), then destroy it |
| Database passwords (`clearline_owner`, `clearline_runtime`, `clearline_jobs`, `clearline_provisioning`) | the data | `ALTER ROLE … PASSWORD` as a superuser, update the secrets manager, restart app and worker | brief outage per login; do runtime and jobs first |
| `TRONGRID_API_KEY`, `ETHERSCAN_API_KEY` | chain-read quota (public data) | revoke at the provider, issue a new one | none beyond quota abuse |
| `XERO_CLIENT_SECRET`, `QBO_ACCESS_TOKEN` | posting proposals to a customer's ledger | revoke at the provider; the customer reconnects | ledger sync paused until reconnected |
| E-mail provider credentials (when one is configured) | outgoing invitations and resets | revoke at the provider | invitations and resets pause |
| Operator laptop / SSH / hosting console accounts | everything | revoke the device's keys and sessions at the provider; re-issue with MFA | — |

## Steps

1. **Contain**: revoke the leaked secret at its source first (provider console, `ALTER ROLE`), even before you know
   how it leaked. For a user account: `control:admin revoke-sessions <email>`, then `revoke <org> <email>` if the
   membership itself must go.
2. **Rotate** per the table. Order for a full rotation: database runtime and jobs logins → `BETTER_AUTH_SECRET` →
   provider tokens → owner and provisioning logins.
3. **Check what was done with it**: the audit log (`audit_events`: exports with hash and count, approvals,
   membership changes) and the hosting provider's access logs, for the window from the earliest possible leak.
   A suspicious approval is reported to the customer; it is never reversed by an operator in the database.
4. **Failed-login spike** (alert `failed_login_spike`): compare the per-account and per-address limits in
   src/server/rate-limit.ts and src/server/signin-limit.ts (they already slow guessing). If the failures concentrate on
   one account, tell its organisation's admin and consider `revoke-sessions`. If one address bucket dominates, block it
   at the load balancer. If a sign-in SUCCEEDED from the attacking pattern, treat the account as compromised (step 1).
5. **Notify** per docs/runbooks/INCIDENT_RESPONSE.md ("Who to notify"); deadlines there are [ASSUMPTION, lawyer].
6. **Review** how it leaked and fix that (a secret in a log is a severity-1 finding: logs are scrubbed by
   src/server/ops/scrub.ts, and CI runs scripts/ops/check-log-safety.mjs, but neither is a guarantee).
