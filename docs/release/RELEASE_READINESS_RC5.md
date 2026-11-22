# rc5 release readiness (22 Nov 2026)

## Verdict: **2. Authenticated persistent staging candidate**

This is not "controlled design-partner pilot candidate", and not "production-ready".

### Evidence for the verdict

The application is authenticated, persistent and tenant-isolated, and it has been tested **locally** against PostgreSQL 16:
- **137** database integration tests and **24** end-to-end tests pass;
- the public demo suite is unchanged (261 passed);
- the engine's **1820** tests pass.

### Why not higher

| Blocking gap | Owner |
|---|---|
| No hosted private staging: needs a paid database and host | founder approval (cost) |
| No genuinely independent review: every reviewer was launched by the implementing session | a separate reviewer or the founder |
| A confirmed CSV import counts as bank evidence and can verify settlement | founder / accounting policy decision |
| Stablecoin posting rules are sandbox-only, pending sign-off | founder / accountant |
| No MFA or SSO, and no password reset | engineering (next) |
| No CSV upload page or Accounting Bridge screens (services exist) | engineering (next) |
| No backups or monitoring for a hosted environment | after hosting is approved |
| `funding-browser` (Funding Desk) is flaky in CI | engineering |
| No compliance assessment of any kind | — |

## Definition-of-done checklist (section 20 of the mandate)

| Item | Status | Evidence |
|---|---|---|
| Database schema and migrations | ✅ | `drizzle/0000–0005`, schema test |
| PostgreSQL-backed persistent workflow | ✅ local | workflow + e2e (restart) |
| Authentication | ✅ | Better Auth, auth tests |
| Server-side membership enforcement | ✅ | `tenant.ts`, RLS |
| Tenant isolation tested | ✅ | workflow, hardening, imports, accounting, e2e |
| Role-based authorisation tested | ✅ | workflow, API, accounting, imports |
| Maker-checker with real identities | ✅ | service checks, DB triggers bound to the signed-in user, race tests |
| Payment investigations persisted | ✅ | workflow |
| Evidence trail persisted | ✅ | `settlement_evidence`, `provider_events`, audit |
| Exceptions and ownership persisted | ✅ | workflow (owner, priority, next action, due date) |
| Redwood case end to end | ✅ | workflow + e2e |
| Secure fictional CSV import | ✅ service + tests; ❌ no upload page | imports tests |
| Accounting proposals persist | ✅ | accounting tests |
| Audit events recorded | ✅ | append-only `audit_events` |
| Unit / integration / browser / accessibility tests | ✅ | TEST_RESULTS_RC5.md |
| Typecheck / build / lint | ✅ | TEST_RESULTS_RC5.md |
| Draft PRs | ✅ | #114–#124 |
| Documentation | ✅ | this folder plus architecture, security and runbooks |
| Known security limitations documented | ✅ | SECURITY_THREAT_MODEL_RC5.md |
| Hosted staging | ❌ blocked | needs approval |
