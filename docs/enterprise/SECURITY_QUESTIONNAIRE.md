# Security questionnaire (CAIQ-lite / SIG-lite style)

Pre-filled answers for vendor-risk reviews. Answered against the code on branch `accounting-fixes`, 29 Oct 2026.
**Yes** = true today, with evidence. **Partial** = some of it is true; the line says which part. **Not yet** = not
true today; the line gives the plan. See `SECURITY_OVERVIEW.md` for context.

Company context: Clearline is a pre-revenue product run by one founder (a university student in Singapore). 0
customers. Invoices are issued by the founder's Indian sole proprietorship.

## A. Governance and organisation

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| A1 | Do you have a documented information security policy? | Partial | `docs/enterprise/SECURITY_OVERVIEW.md` and `docs/SPEC.md` §7 describe controls; no formal, approved policy set yet. Plan: write ISMS-lite policies before the first paid pilot ends. |
| A2 | Is someone accountable for security? | Yes | The founder (sole person). No separate security role exists. |
| A3 | Do you hold SOC 2, ISO 27001 or similar? | Not yet | None. Not planned before paying customers require it. |
| A4 | Do staff sign confidentiality agreements and receive security training? | Not yet | One person, no staff. Any contractor will sign an NDA before access. |
| A5 | Do you carry cyber or professional-indemnity insurance? | Not yet | Plan: quote before a contract that requires it. |

## B. Access control and identity

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| B1 | Do users sign in with individual accounts? | Not yet | No sign-in. "Acting as" is self-declared (`src/components/ActingAs.tsx`). Plan: email + TOTP sign-in. |
| B2 | Is MFA enforced? | Not yet | No sign-in, so no MFA. Planned with B1. |
| B3 | Is SSO (SAML/OIDC) supported? | Not yet | Roadmap after B1. |
| B4 | Is role-based access control enforced? | Not yet | Roles designed in `docs/SPEC.md` §7, not built. |
| B5 | Can access to the application be restricted? | Partial | Optional shared HTTP Basic auth (`src/middleware.ts`); host-level IP allow-list possible. One shared password, no per-user identity. |
| B6 | Is customer data logically separated from other customers? | Yes | One deployment and one data directory per customer (`src/lib/data-dir.ts`); no shared multi-tenant store. |
| B7 | Is production access by your staff limited and logged? | Partial | Only the founder has host access; host provider logs apply. No in-app admin access log. |
| B8 | Do you require keys or credentials to customer wallets? | Yes (we don't) | Never. Read-only chain access (`src/lib/chain/`); no signing code. |

## C. Encryption and key management

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| C1 | Is data encrypted in transit? | Partial | Outbound calls use HTTPS. The app serves HTTP; TLS is terminated by the host or tunnel. Plan: document and enforce HTTPS-only per deployment. |
| C2 | Is data encrypted at rest? | Not yet | Plain JSON files (`src/lib/accounting/store.ts`, `src/lib/requests/service.ts`). Only disk-level encryption if the host provides it. |
| C3 | Are third-party OAuth tokens encrypted? | Not yet | `xero-tokens.json` is plain JSON (`src/lib/accounting/providers/xero-auth.ts`). Plan: encrypt with a key from the host's secret manager. |
| C4 | Are secrets kept out of source control? | Yes | Environment variables only; `.env*` git-ignored (`.gitignore`, `.env.example`). |
| C5 | Are API keys redacted from logs and stored data? | Yes | Etherscan key redacted from stored URLs; TronGrid key in an unstored header (`README.md` "Live chain data"); Xero errors never echo the body (`xero-auth.ts`). |

## D. Logging and monitoring

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| D1 | Do you keep an audit log of user actions? | Yes | `audit.jsonl` with actor, time, IP (`src/lib/payments/audit.ts`); posting audit in `accounting.json` (`src/lib/accounting/service.ts`). |
| D2 | Is the audit log tamper-evident? | Not yet | App-level append only; files are editable on the host. Plan: hash-chained entries. |
| D3 | Is the actor in the log a verified identity? | Not yet | Self-declared "Acting as" name. Fixed by B1. |
| D4 | Do you monitor for security events and alert on them? | Not yet | No alerting. Plan: host uptime and error alerts to the founder's email. |

## E. Incident response

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| E1 | Do you have an incident response plan? | Partial | Commitments in `SUPPORT_AND_UPTIME.md` (notice times, contact); no tested runbook. |
| E2 | Will you notify us of a breach affecting our data, and how fast? | Yes | Within 72 hours of becoming aware, by email (`DATA_PROCESSING_TERMS_TEMPLATE.md` §8). |
| E3 | Have you had a security incident in the last 12 months? | Yes (none) | No incidents; no customer data has been held. |

## F. Business continuity and resilience

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| F1 | Do you back up customer data? | Not yet | No automated backups. Plan: daily volume snapshot at the host; with the database, managed backups. |
| F2 | Is there a tested disaster-recovery plan with RTO/RPO? | Not yet | Plan after the database move. |
| F3 | Is the service highly available? | Not yet | Single process by design (`src/lib/lock.ts`); bulk jobs don't survive a restart (`README.md`). No uptime SLA during pilots. |
| F4 | What happens if the founder is unavailable? | Partial | Self-hosting option (`Dockerfile`) means you can run it without us; source access can be escrowed on request. No second operator. |

## G. Vendor and subprocessor management

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| G1 | Do you list your subprocessors? | Yes | `DATA_PROCESSING_TERMS_TEMPLATE.md` §5. |
| G2 | Do you assess subprocessors' security? | Partial | Chosen from major providers with their own SOC 2/ISO reports; no formal review documented. |
| G3 | Does any AI provider receive our data? | Partial | Off by default (`Dockerfile`: `AI_EXPLANATIONS=off`). If enabled, Anthropic receives evidence with customer IDs removed (`src/lib/ai/explain.ts`). Zero-retention agreement: not yet. |
| G4 | Do third-party chain data providers see our data? | Yes | They see the transaction hashes and addresses looked up (`.env.example`). Use keyed providers for pilots. |

## H. Data residency and privacy

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| H1 | Can data be kept in a specific region? | Yes | Self-host, or we deploy to the region you choose (`SECURITY_OVERVIEW.md` §6). |
| H2 | What personal data do you process? | Yes | Listed per file in `SECURITY_OVERVIEW.md` §2: invoice contact names, customer references, actor names, IP addresses. Emails refused in Files A/B (`src/lib/csv/files.ts`). |
| H3 | Do you comply with Singapore PDPA (and GDPR where relevant)? | Partial | Website privacy notice follows PDPA; no DPO appointed, no formal PDPA assessment of the product. India DPDP applicability needs legal review (`docs/SPEC.md` §7). |
| H4 | Will you sign a DPA? | Partial | Template in `DATA_PROCESSING_TERMS_TEMPLATE.md`; not yet reviewed by a lawyer. |
| H5 | Can you delete our data on request? | Partial | Yes, within 10 business days, but mostly by hand (delete the data directory). In-app deletion only for imported payment records (`/api/payments/clear`). |

## I. Secure development (SDLC) and vulnerability management

| # | Question | Answer | Evidence or plan |
|---|---|---|---|
| I1 | Is code reviewed before release? | Partial | Changes go through pull requests and review rounds (git history); one developer, assisted by AI coding tools. |
| I2 | Do you have automated tests? | Yes | `tests/` (engine, accounting, chain, CSV, payments, AI validation; `npm test`). |
| I3 | Do you run CI on every change? | Not yet | No CI pipeline in the repo. Plan: GitHub Actions for tests, typecheck and audit. |
| I4 | Do you scan dependencies for vulnerabilities? | Not yet | Pinned versions (`package.json`), no automated scanning. Plan: Dependabot + `npm audit` in CI. |
| I5 | Do you validate untrusted input? | Yes | Strict CSV validation (`src/lib/csv/files.ts`); spreadsheet-formula neutralisation in exports (`README.md` "Bulk"); plan-key check on approvals. |
| I6 | Has an independent penetration test been performed? | Not yet | None. Plan: before the first customer with real volume, or at your cost if required sooner. |
| I7 | Do you have a vulnerability disclosure process? | Not yet | Plan: a `SECURITY.md` with a contact address. |
| I8 | Is the product able to move funds? | Yes (it cannot) | No keys, no signing; read endpoints only (`docs/SPEC.md` §7, `src/lib/chain/`). |

---

**Count:** 46 questions. Not yet: 19. Partial: 12. Yes: 15 (four of those are "Yes" to a question where the
safe answer is that we don't do the risky thing: B8, E3, I8, and G4 is a disclosure).
