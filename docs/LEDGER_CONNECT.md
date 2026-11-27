# Ledger connections (Xero, QuickBooks Online) — v1 phase 2.3

Status: built and tested against **local stand-in servers only** (fictional data). No real Xero or Intuit endpoint has been
called. Nothing here has been run against a registered developer app [ASSUMPTION: request and response shapes follow
the ledgers' public API documentation].

## What it does

| Step | Who | What happens |
|---|---|---|
| Connect / Reconnect | Admin | OAuth 2.0 authorisation code flow. Xero gets PKCE (S256) and a nonce, which is checked against its `id_token`. QuickBooks gets state only. The state is used once, expires after 10 minutes and is stored as a hash. It is bound to the member who started the flow and to their browser (an HttpOnly, SameSite=Lax cookie scoped to the callback path). |
| Choose organisation | Admin | Xero only, when one authorisation covers several organisations. Once chosen, the organisation of a connection never changes: reconnecting must authorise the same organisation, and a different one means disconnecting and connecting again. |
| Tokens | — | Sealed with AES-256-GCM using `CLEARLINE_LEDGER_TOKEN_KEY` and bound to organisation, connection and field. The database never holds a usable token. Without the key, connecting is refused. |
| Refresh | — | The access token is refreshed when it has less than two minutes left. A row lock means only one refresh runs at a time, so a rotated refresh token is never lost. |
| Revoked / expired | — | A refused refresh (`invalid_grant`), a refresh-token expiry that has passed (QuickBooks reports it; Xero is assumed to expire after 60 days), a 401, or Xero's 403 for a removed connection all set the connection to **Reconnect needed**. The stored tokens are deleted, and the Ledger page shows *Reconnect* to an Admin. |
| Read | Finance, Payment Operations | Reads sales invoices and payments (GET only). Issued invoices go into an **orders/invoices upload** that is stored, mapped and validated. A person confirms it, as with any file, before anything reaches matching. The mapping: Order ID = invoice number, amount = invoice total, status open (authorised or paid) or void. Drafts are left out and no issue time is invented. Payments are counted and never stored, because a ledger's payment is a claim. |
| Draft journal | Finance | One journal proposal is written as a Xero manual journal with `Status: DRAFT`, and only when `postingRulesSigned(orgId)` is true. The journal must also be proposed or approved (not exported, rejected or superseded), balanced, in the ledger's base currency, with every account mapped to a ledger code. One idempotency key per journal and ledger organisation: a retry never writes a second draft. **QuickBooks Online has no draft journal state, so Clearline never writes a journal there** [ASSUMPTION]. |
| Rate limits | — | Calls per ledger organisation are capped below the published limits: Xero 50 a minute and 4,500 a day, QuickBooks 400 a minute [ASSUMPTION: published 60/5,000 and 500]. A 429 blocks calls until its Retry-After has passed. The limiter is in-process. |
| Audit | — | Connect, refusal, choice, refresh, reconnect-needed, read, account mapping, draft, draft refusal and disconnect each write an `audit_events` row. Rows hold ids and counts only, never a token, an amount or a name from the ledger. |

### The posting-rules guard (`postingRulesSigned`)

`src/server/ledger-connect.ts` reads `public.posting_rules_signatures` **if it exists**. The org counts as signed only
when that table has a row with `org_id` = the organisation and `revoked_at IS NULL`. The newest `signed_at` wins and its
`version` is written on the draft. A missing table, a missing column, no SELECT grant or any other error means **not
signed**. Phase 4 builds the table and the sign-off. It must give the table these four columns, or the guard stays
closed. The tests create a throwaway table of this shape and drop it afterwards.

## Local stand-ins (tests and local runs)

```
npx tsx scripts/ledger/standin-server.ts      # Xero stand-in on 127.0.0.1:4170, QuickBooks on 127.0.0.1:4171
```

Server environment for a local run:

```
CLEARLINE_LEDGER_ENV=standin
CLEARLINE_XERO_STANDIN_URL=http://127.0.0.1:4170
CLEARLINE_QBO_STANDIN_URL=http://127.0.0.1:4171
XERO_CLIENT_ID=standin-xero-client
QBO_CLIENT_ID=standin-qbo-client
QBO_CLIENT_SECRET=standin-qbo-secret
CLEARLINE_LEDGER_TOKEN_KEY=<openssl rand -base64 32>
```

Stand-in URLs must be loopback `http` addresses; any other host is refused.

## Switching to the real sandbox (founder)

Do this only after the developer apps are registered. No production setting exists: `CLEARLINE_LEDGER_ENV` accepts
`standin` or `sandbox` only. Allowing a live ledger is a separate decision and needs a code change.

1. **Xero** (developer.xero.com → New app → Web app):
   - Redirect URI: `<CLEARLINE_ORIGIN>/api/control/merchant/ledger/callback`. It must match exactly, so in production
     use the `https` origin.
   - Scopes requested by default: `openid offline_access accounting.settings.read accounting.contacts.read accounting.transactions`.
     If the app was created after Xero's 2026 granular-scope change, set `XERO_SCOPES` to the granular equivalents
     (invoices read, payments read, manual journals write, settings read) [ASSUMPTION: check the app's scope list].
   - Set `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET`. Leaving the secret out makes a public PKCE client.
   - Connect the **Xero Demo Company** only. In `sandbox` mode an organisation that is not a demo company is refused.
2. **QuickBooks Online** (developer.intuit.com → app → Development keys):
   - Redirect URI: the same callback URL.
   - Scope: `com.intuit.quickbooks.accounting` (override with `QBO_SCOPES`).
   - Set `QBO_CLIENT_ID` and `QBO_CLIENT_SECRET`. API calls go to `https://sandbox-quickbooks.api.intuit.com` only.
3. Set `CLEARLINE_LEDGER_ENV=sandbox` and `CLEARLINE_LEDGER_TOKEN_KEY` (32 random bytes, base64; keep it in the secret
   store). `CLEARLINE_ORIGIN` must already be set. Remove `CLEARLINE_XERO_STANDIN_URL` and `CLEARLINE_QBO_STANDIN_URL`.
4. Open **Ledger** in the merchant navigation as an Admin of a *live* organisation, then press Connect.

Rotating `CLEARLINE_LEDGER_TOKEN_KEY` makes every stored token unopenable. Each connection then shows
*Reconnect needed*, and nothing is lost but the tokens.

## Files

- `drizzle/0059_ledger_connections.sql`, `drizzle/0060_ledger_journal_drafts.sql`: tables, RLS and transition triggers
- `src/lib/accounting/connect/`: sealing, providers (OAuth), rate limiter, API reads and the draft-only write
- `src/server/ledger-connect.ts`: the service. Routes are under `src/app/api/control/merchant/ledger/`; the page is `src/app/control/merchant/ledger/page.tsx`
- `scripts/ledger/standin-server.ts`: the stand-ins (never imported by `src/`)
- Tests: `tests/clearline/ledger/connect.test.ts`, `tests/control/ledger-connect.test.ts`, `tests/control/ledger-connect-e2e.test.ts`

The older file-based Xero connection (`src/lib/accounting/providers/xero-auth.ts`, `/api/accounting/xero/*`, the
stablecoin experiment) and the rc7 read-only pull (`CLEARLINE_LEDGER_PULL`) are unchanged.
