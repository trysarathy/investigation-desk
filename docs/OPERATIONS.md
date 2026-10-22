# Operating the pilot candidate

Use one isolated instance and volume per company. This build is not a multi-tenant SaaS deployment.
Node 24 was tested; SQLite uses Node's built-in experimental module. Run `npm ci`, `npm test`,
`npm run typecheck`, `npm run build`, then `npm start -- --hostname 127.0.0.1` behind HTTPS.

## Configuration

See `.env.example`. For fictional preview only set `DEMO_MODE=1`; never expose real company
records with that switch. For real use unset it, configure a random SESSION_SECRET of at least
32 characters, WORKSPACE_ID and DESK_USERS. Each account has id, role (analyst/lead/admin),
a unique random salt, a 64-byte scrypt passwordHash encoded as hex, and a unique base32
TOTP secret. Provision these out-of-band through a secret manager; no account invitation,
password recovery or SSO workflow is implemented. Removing an account is not a substitute
for immediate session revocation: rotate the session secret to invalidate sessions.

Set TRONGRID_API_KEY and ETHERSCAN_API_KEY for investigations. Optional operator-owned HTTPS
RPC_* URLs enable EVM lookup fallbacks. Ethereum scans can use public Blockscout when no
Etherscan key is set; this is not an SLA. Keep AI_EXPLANATIONS=off for deterministic templates.
Configure company policy in Settings before live investigation, then import address/ledger CSVs.
Never upload private keys or seed phrases. No component signs or sends transactions.

## Integrations

Slack commands require SLACK_SIGNING_SECRET and SLACK_TEAM_ID. Alert delivery is separately
disabled unless SLACK_ALERTS_ENABLED=1, SLACK_BOT_TOKEN, SLACK_ALERT_CHANNEL and HTTPS
PUBLIC_APP_URL are configured. An authenticated admin can POST `/api/alerts/deliver` from
the same origin to deliver queued alerts. Review the destination first. No scheduler is installed.
The private Zendesk sidebar is in `integrations/zendesk`; configure its domain allowlist and
secure TICKET_API_TOKEN setting before packaging. Neither integration has customer-installation
verification. Intercom is not implemented. LedgerConnector is an interface, not a live ERP connector.

## Storage, retention and availability

SQLite evidence documents and append-only hash-linked audit records coexist with legacy `.data`
CSV/workspace/raw/cache/bulk files. Use encrypted disks, restricted filesystem permissions and
an encrypted backup system supplied by the operator. Do not put `.data` in source control.
Security settings support 7/30/90-day retention with an explicit sweep of evidence and legacy files;
audit metadata remains. External backups and secure disk erasure need separate controls.
Hash linkage detects alterations only against a trusted checkpoint; it is not an external notarization.

Company Scan is a bounded in-process background job. Process termination can interrupt it;
there is no durable distributed worker/resume guarantee. Coverage and unavailable states are
shown. `/api/health` shows observed lookup-provider status, not a comprehensive uptime SLA.
Network intelligence is opt-in coarse aggregation only; no live cross-company federation exists.

## Validation

`npm test`, `npm run typecheck`, `npm run build` are the normal gates.
`scripts/e2e-check.cjs` starts an isolated production instance with disposable test accounts.
`scripts/visual-qa.cjs` uses Playwright and CHROMIUM_PATH (default `/tmp/desk-chromium`),
starts production demo, captures 13 screens, exports PDF and scans three attributed public wallets.
Browser QA tooling is provided by the build environment, not a runtime dependency.
Do not run visual QA against private production data. Its public scan reports are retained under
`artifacts/qa`; scan addresses are explorer-attributed, not company-confirmed.

Before paid deployment: independent security review, real company policy and adjudicated cases,
verified integrations, backup/restore drill, access lifecycle, provider quota/load tests and deployment
monitoring. The 100-real-case accuracy and fresh-live latency gates remain unfulfilled.
