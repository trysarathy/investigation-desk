# Clearline rc6 — architecture: merchant reconciliation for stablecoin payment providers

Test mode · illustrative data.

- **What exists:** this describes what is **built and tested locally** on fictional data. Nothing is hosted; no real provider, bank, chain node or ledger is connected.
- **Read-only:** no code holds, sends, converts or settles money or tokens.
- **What carries over:** rc5's architecture (`ARCHITECTURE_RC5.md`) still applies. rc6 adds a second product on the same foundation without changing an rc5 security control or engine status.

## Tenancy: provider → merchant → entity

```
organizations (kind = 'provider')  ── theme (white label)        provider_admin / provider_ops
        │ provider_org_id
organizations (kind = 'merchant')  ── rc5 RLS, audit, two-person approvals apply unchanged
        │
merchant_entities (functional currency SGD/AED/USD, ledger xero/quickbooks, time zone) ── merchant_policy (tolerance, write-off threshold, imported-line flag)
```

- **Merchant users** see only their own merchant: forced RLS with `org_id = app_org_id() AND app_is_member(org_id)`.
- **Provider users, by default:** **aggregates only**, through `provider_merchant_health(provider)`. This is SECURITY DEFINER, uses `pg_temp` last, and is restricted to provider roles and the provider's own merchants.
- **Provider users with a full grant:** a merchant's explicit, unrevoked **`full` grant** (`provider_grants`) adds **read** access to that merchant's rows only. Providers can never write merchant data.
- **Invitations:** a provider may invite only **Viewers** into a merchant (migration 0014). Roles with authority are granted by the merchant's own Admin.

## Data flow

```
 provider export (CSV/JSON + column mapping) ─┐
 settlement report (per-payment or totals)    ├─ adapters (pure, validated; reject rows with reasons) ─┐
 chain: RecordedChainClient (live mode OFF)   │   src/lib/clearline/merchant/adapters/                  │
 bank lines: rc5 CSV import + 2nd-person ok ──┘                                                        ▼
                                      src/server/merchant.ts: ingest → rows (RLS) → engine input
                                                                                                       ▼
                     src/lib/clearline/merchant/ (PURE ORACLE): match.ts steps 1–4 → bridge.ts step 5 → journal.ts
                                                                                                       ▼
            match_records (chain | provider | bank | ledger | explanation; never merged) · differences (append-only,
            content-addressed) · recon_exceptions (owner, reason, next step) · writeoff_proposals (rc5 two-person) ·
            merchant_journal_proposals (pending_sign_off, enforced by CHECK) · audit_events
                                                                                                       ▼
   /control/merchant/** (screens 1–9) · /control/merchant/provider/** (10–12) · /clearline/cases (public, no DB)
   scripts/reconstruct (local CLI; no network, no DB, no upload)
```

- **Deterministic:** an identical rerun writes nothing. The input SHA-256 and engine version are stored on every match record.
- **Approvals:** write-offs and resolutions use rc5's `approval_requests` with a hashed, immutable payload. Database triggers bind the decider to the signed-in user, refuse self-approval, stale versions and closed requests, and require an approved request before a write-off can become `approved`.
- **Imported bank lines** (`csv_import`) are labelled "imported, not bank-authenticated". They never verify settlement on their own unless `merchant_policy.allow_imported_bank_lines_as_verified` is on; it defaults to off, and the decision is the founder's.

## Public demo and pilot

- **Public demo:** `/clearline/cases` renders the three cases from the pure engine, with no database and no login.
- **Pilot:** `/control/merchant/**` is served only with `CLEARLINE_CONTROL_PILOT=1`, behind rc5 sign-in.
- **Separation:** the middleware never serves both surfaces from one deployment.
