# Deployment runbook (rc5)

## Environments

| Environment | Status | Data | Identity |
|---|---|---|---|
| **LOCAL** | works (this runbook) | fictional seed | real sign-in, local PostgreSQL 16 |
| **PUBLIC DEMO** | existing Vercel previews (`/clearline`), publicly reachable | fictional sample in the browser | simulated roles, labelled |
| **PRIVATE STAGING** | **not deployed**. Needs a hosted PostgreSQL 16 and a host with access control → **founder approval (cost)** | fictional/synthetic only | real sign-in |
| **PRODUCTION** | **not enabled** | — | — |

## Local: start to finish (commands tested in this session)

```bash
# 1. PostgreSQL 16 (any local cluster; this used /usr/lib/postgresql/16, port 54329)
export PGHOST=127.0.0.1 PGPORT=54329 PGUSER=postgres
scripts/db/setup-local.sh clearline_dev '<owner-password>' '<runtime-password>'

# 2. Migrations (as the OWNER)
DATABASE_OWNER_URL=postgres://clearline_owner:<owner-password>@127.0.0.1:54329/clearline_dev npx drizzle-kit migrate

# 3. Fictional seed: two organisations, fictional users (passwords from the environment, never arguments)
DATABASE_URL=postgres://clearline_owner:<owner-password>@127.0.0.1:54329/clearline_dev \
CLEARLINE_SEED_PASSWORD='<a fictional password, ≥ 12 chars>' npm run control:admin -- seed-demo

# 4. Build and run the pilot (as the RUNTIME login)
export CLEARLINE_CONTROL_PILOT=1 CLEARLINE_ORIGIN=http://127.0.0.1:3000 \
       BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
       DATABASE_URL=postgres://clearline_runtime:<runtime-password>@127.0.0.1:54329/clearline_dev
npx next build && npx next start -H 127.0.0.1 -p 3000
# open http://127.0.0.1:3000/control  → sign in as ops@lumen.example / approver@lumen.example
```

Seeded users:
- **lumen-demo:**
  - `ops@lumen.example` (Payment Operations)
  - `approver@lumen.example` (Approver)
  - `finance@lumen.example` (Finance)
  - `viewer@lumen.example` (Viewer)
  - `admin@lumen.example` (Admin)
- **harbour-demo:**
  - `ops@harbour.example`
  - `approver@harbour.example`

All are fictional. The password is the one you set in step 3.

## Administration (owner connection)
```bash
DATABASE_URL=<owner url> CLEARLINE_NEW_PASSWORD='…' npm run control:admin -- create-user someone@example.test "Name (fictional)"
DATABASE_URL=<owner url> npm run control:admin -- grant lumen-demo someone@example.test approver
DATABASE_URL=<owner url> npm run control:admin -- revoke lumen-demo someone@example.test      # also revokes sessions
DATABASE_URL=<owner url> npm run control:admin -- revoke-sessions someone@example.test
```

## Backup and restore (owner)
```bash
pg_dump --format=custom --file=clearline-$(date +%F).dump "$DATABASE_OWNER_URL"
# restore into an empty database prepared by setup-local.sh:
pg_restore --no-owner --role=clearline_owner --dbname="$DATABASE_OWNER_URL" clearline-YYYY-MM-DD.dump
```

## Private staging (requires founder approval — not done)

1. **Database.** Provision a managed PostgreSQL 16 (paid), plus TLS, backups and point-in-time recovery.
   - Create `clearline_owner` and `clearline_runtime` with `scripts/db/setup-local.sh`.
   - Store both passwords in the host's secret store.
2. **Host.** Use a host with access control. If its proxy overwrites a client-IP header, name it in `CLEARLINE_CLIENT_IP_HEADER` to add a per-IP sign-in limit (the per-account limit always applies). A dedicated Vercel project with deployment protection, or Fly.io, would both work.
   - Set `CLEARLINE_CONTROL_PILOT=1`, `CLEARLINE_ORIGIN=https://<staging host>`, `BETTER_AUTH_SECRET` and `DATABASE_URL` (runtime login only).
3. **Rules for staging.**
   - Never reuse the public demo project.
   - Never set the pilot flag on the public preview.
   - Do not attach clearlineconnect.org.
4. **Release.** Run migrations as the owner from CI or by hand, before the release.
