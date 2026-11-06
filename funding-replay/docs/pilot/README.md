# Clearline pilot operating desk

Private, authenticated workspace for a payment provider's operators and reviewers. Every supplier payment the
provider agrees to support is a **case**: routes A/B/C, approval, reservation, draw, payout reference, delivery,
customer receipt, repayments, close — with an append-only audit history. **Payouts are manual (external
reference + evidence) or through the sandbox connector; nothing here moves money, holds funds or lends.**

The public mentor demo (https://clearline-funding-desk.vercel.app) is a separate static, synthetic site built from
`engine/` + `tools/export_site.py`. It never talks to this server and contains no pilot data.

## Architecture (and why)
- Python 3.9+ standard library only: `http.server` + `sqlite3`. No packages to install or patch.
- **SQLite in WAL mode on a persistent disk** is the transactional store: every command runs in one
  `BEGIN IMMEDIATE` transaction, and database triggers/unique indexes refuse over-reservation, a second draw or a
  second live payout even if application checks race. Simplest choice for a single-provider pilot with a handful of
  users; the trade-off is one server process (no horizontal scaling) and a host with a durable volume.
- Hosting therefore needs a long-running process with durable storage. A single container with a volume (Fly.io,
  Render, Railway, a VM) runs it as built. Running it on a serverless platform would first need the storage moved
  to a managed database (e.g. Postgres) — a code change, not a configuration change.

## Run locally (exact commands, from `funding-replay/`)
```bash
export PILOT_ENV=dev PILOT_DB=$HOME/clearline-pilot.db PILOT_SECRET=dev-only-secret
python3 -m pilot.cli migrate          # forward-only migrations (0001_init, 0100_sandbox)
python3 -m pilot.cli seed             # synthetic orgs, users, facilities — NO cases (blank workspace)
python3 -m pilot.cli serve --port 8765   # open http://127.0.0.1:8765
python3 -m pilot.cli check            # integrity + every identity; exit 1 on any failure
```
Dev/test sign-ins (synthetic, refused in `PILOT_ENV=pilot`): `operator@harbourline.test` / `pilot-dev-operator`,
`reviewer@harbourline.test` / `pilot-dev-reviewer`, `reviewer2@harbourline.test`, `viewer@harbourline.test` /
`pilot-dev-viewer`; second org `operator@meridian.test` / `pilot-dev-operator`. Provision a blank organisation (the admin boundary is this privileged CLI; no shared credentials):
`create-org --name … --id ORG-X`, `PILOT_NEW_PASSWORD=… create-user --org ORG-X --email … --name … --role
operator|reviewer|viewer`, `create-facility --org ORG-X --id FAC-X --name … --currency SGD --limit … --fee-flat …
--allocation fees_first --funding-cash … --policy-version "POL v1" --required-evidence balance[,invoice]`,
`update-facility --id FAC-X --policy-version "POL v2" …` (every change is a new version), `list-facilities`,
`list-users`, `disable-user --email …` (revokes sessions). See WALKTHROUGH.md. Add real pilot users with
`PILOT_NEW_PASSWORD=… python3 -m pilot.cli create-user --org ORG-HL --email … --name … --role operator|reviewer|viewer`.

`PILOT_CLOCK=2026-12-01T01:30:00Z` pins the server clock (tests and walkthroughs); leave it unset in a pilot.

## Tests
```bash
python3 -m unittest discover -s tests/pilot      # pilot domain, API, capacity races, sandbox, data modules, challenger
node tests/browser/pilot.cjs                     # UI owner's browser journey (real server)
node tests/browser/pilot_lead_journey.cjs        # unscripted invoice, two users, three server restarts, recovery paths
python3 -m unittest discover -s tests            # mentor demo engine regressions (unchanged)
```

## Production-style container
```bash
docker build -f deploy/pilot/Dockerfile -t clearline-pilot .
docker volume create cl-pilot-data
docker run -d --name cl-pilot -e PILOT_SECRET=<64 hex chars> -v cl-pilot-data:/data -p 8080:8080 clearline-pilot
docker exec cl-pilot python3 -m pilot.cli seed --synthetic     # prints random initial passwords once
```
`PILOT_ENV=pilot` in the image: Secure cookies, seeding refused without `--synthetic`, development passwords never
used, `/api/health` returns only `{ok, db, migrations}`. Put it behind HTTPS (the host's TLS); Secure cookies
need it outside localhost.

## Deploy (requires the founder's hosting account — not done from the build session)
Fly.io, Singapore region, using `deploy/pilot/fly.toml`:
```bash
fly launch --no-deploy --copy-config --name clearline-pilot
fly volumes create pilot_data --size 1 --region sin
fly secrets set PILOT_SECRET=$(python3 -c 'import secrets;print(secrets.token_hex(32))')
fly deploy
fly ssh console -C "python3 -m pilot.cli seed --synthetic"      # synthetic workspace; record the printed passwords
```
Then verify at the printed `https://<app>.fly.dev`: sign-in, a viewer cannot act, another org gets "Not found", a
new case survives `fly machine restart`.

## Backup and restore
```bash
python3 -m pilot.cli backup /backups/pilot-$(date +%F).db      # online backup + integrity check + .sha256
python3 -m pilot.cli restore /backups/pilot-2026-12-07.db       # refuses corrupt/mismatched files; keeps .pre-restore copy
python3 -m pilot.cli migrate && python3 -m pilot.cli check
```
Operator recovery for interrupted imports, uncertain payouts and failed reconciliation: `RECOVERY.md`.
