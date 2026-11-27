# Hosting proposal: Singapore, under USD 100 a month (v1 phase 6)

Status: **proposal only.** No account was created, no resource provisioned, no cloud API called, nothing paid.
Prices were collected on **2026-11-25** with web search only: the session could not open digitalocean.com,
aws.amazon.com or render.com pages directly (their hosts are not allowed in this session's network). Each price below
is therefore from a search-result excerpt of the page cited. **Every price is [ASSUMPTION] until the founder sees it on
the provider's own page or calculator before ordering.** Other labels: **[VERIFIED]** run on the authoring machine;
**[GUESS]** an estimate.

## What production needs

- Managed PostgreSQL 16 with point-in-time recovery (PITR).
- An app host with HTTPS for `next start`.
- A separate worker process (`scripts/jobs/worker.ts`), plus a pre-deploy migration job and a daily
  `purge-uploads` run.
- Encrypted object storage for uploads.
- Staging and production fully separate: databases, secrets, buckets, keys.
- Fit within USD 100 a month.

## The deciding constraint: the owner login must be BYPASSRLS

Migrations `FORCE ROW LEVEL SECURITY`. The schema owner `clearline_owner` runs migrations and the admin CLI, so it
must be `BYPASSRLS`. **[VERIFIED on PostgreSQL 16, 2026-11-25]** a role with CREATEROLE but without BYPASSRLS gets:

> ERROR: permission denied to create role. DETAIL: Only roles with the BYPASSRLS attribute may create roles with the
> BYPASSRLS attribute.

Managed PostgreSQL never gives out a superuser. So a host works only if its admin login itself has BYPASSRLS. This
is not something to weaken (approval-only; it is not changed here). `scripts/ops/db-bootstrap.sh` checks it first and
refuses, changing nothing, if the admin lacks it [VERIFIED: the refusal path against a local TLS cluster with a
CREATEROLE-only admin; the success path with an admin that has it].

| Host | Admin login has BYPASSRLS? |
|---|---|
| DigitalOcean Managed PostgreSQL (`doadmin`) | **Probably yes** [ASSUMPTION]. DigitalOcean's docs do not list the attributes. `\du` output posted on DigitalOcean's community Q&A shows `doadmin` with "Create role, Create DB, Replication, Bypass RLS" ([DO docs: modify user privileges](https://docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/), [community Q&A](https://www.digitalocean.com/community/questions/permission-denied-for-database-postgres-when-creating-schemas-in-dev-database?comment=96127)) |
| AWS RDS / Lightsail (master user, `rds_superuser`) | **Probably not** [ASSUMPTION]. AWS's role listing shows Bypass RLS on the internal `rdsadmin` only, not on the master user ([AWS: rds_superuser](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Appendix.PostgreSQL.CommonDBATasks.Roles.rds_superuser.html)) |
| Render PostgreSQL | Unknown [ASSUMPTION]; not documented in what was found |

## Options compared (monthly, USD, both environments)

### A. DigitalOcean, region SGP1: **recommended**

| Item | Size | Staging | Production | Source |
|---|---|---:|---:|---|
| Managed PostgreSQL 16 (daily backups, 7-day retention, fork to a point in time) | 1 vCPU / 1 GiB / 10 GiB, 1 node | 15.15 | 15.15 | price: third-party summaries ([infratally](https://infratally.com/articles/digitalocean-managed-postgres-deep-dive/), [itechguides](https://www.itechguides.com/products/digitalocean-managed-postgresql/)); backups and PITR: [DO restore docs](https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/), [manage cluster / fork](https://docs.digitalocean.com/products/databases/postgresql/how-to/manage-cluster/) |
| App Platform web service (HTTPS, managed certificate, custom domain) | `apps-s-1vcpu-1gb` (1 shared vCPU, 1 GiB, 150 GiB transfer) | 12.00 | 12.00 | [DO App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/) |
| App Platform worker | `apps-s-1vcpu-0.5gb` (512 MiB) | 5.00 | 5.00 | same |
| Pre-deploy migrate job, daily purge job | `apps-s-1vcpu-0.5gb`, billed per second while running | ~0.05 | ~0.05 | same; amount [GUESS] |
| Spaces object storage (one subscription covers both private buckets: 250 GiB, 1 TiB egress) | — | 5.00 (shared) | | [DO Spaces pricing](https://docs.digitalocean.com/products/spaces/details/pricing) |
| Container Registry, Basic (5 repos, 5 GiB) | — | 5.00 (shared) | | [DO Container Registry pricing](https://docs.digitalocean.com/products/container-registry/details/pricing) |
| DNS (DigitalOcean DNS) | — | 0 | | [ASSUMPTION] free |
| **Total** | | | | **74.40** (headroom 25.60) |

- Overage: App Platform egress beyond the allowance is $0.02/GiB; Spaces storage beyond 250 GiB is $0.02/GiB-month and
  egress $0.01/GiB (same sources). Expected v1 volumes are far below the allowances [GUESS].
- Upgrade within budget: a production standby node (high availability) is about +$15 [ASSUMPTION], which gives about
  $89.
- **Check before ordering:** DigitalOcean announced restrictions on choosing "Standard Edition" database plans: for
  accounts that never created a cluster from **15 October 2026**, and for all accounts from **30 November 2026**
  ([DO release note](https://docs.digitalocean.com/release-notes/upcoming/dbaas-plan-changes/)). The page could not
  be opened. Confirm that the 1 GiB PostgreSQL 16 plan, with PITR, is still orderable and at what price. If only a
  higher plan is offered, re-check the total.
- Spaces at-rest encryption by the provider was not confirmed [ASSUMPTION]. It does not matter for confidentiality:
  the app seals every object with AES-256-GCM (`CLEARLINE_UPLOAD_KEY`) before it leaves the server
  (`src/server/storage/s3.ts`), so the bucket holds ciphertext only.

### B. AWS Lightsail, Singapore (ap-southeast-1): cheaper, probably blocked

| Item | Staging | Production | Source |
|---|---:|---:|---|
| Lightsail managed PostgreSQL, 1 GB (PITR from the last 7 days, restored to a new DB) | 15 | 15 | [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/), [Lightsail FAQ](https://aws.amazon.com/lightsail/faq/) |
| Container service, Micro node (0.25 vCPU, 1 GB; web + worker in one deployment), HTTPS | 10 | 10 | same |
| Object storage bucket, 5 GB | 1 | 1 | [ASSUMPTION] not confirmed in what was found |
| **Total** | | **~52** | |

Not recommended: the master user probably cannot create a BYPASSRLS owner (above), so `db-bootstrap.sh` would refuse.
There is also no pre-deploy job (migrations would run from CI over the database's public endpoint), and a 0.25 vCPU
node is tight for `next start` plus the worker [GUESS].

### C. Render, Singapore region

| Item | Staging | Production | Source |
|---|---:|---:|---|
| Postgres 1 GB (PITR: sources disagree on which plans; one says 3 days on Hobby, 7 on Pro) | 19 | 19 | third-party ([kuberns](https://kuberns.com/blogs/render-postgres-pricing-setup-limits/), [sliplane](https://sliplane.io/blog/cheap-managed-postgres-providers)) |
| Web service 512 MB | 7 | 7 | third-party ([budgetforge](https://www.budgetforge.dev/tools/render-pricing-2026)) |
| Background worker (same compute model [ASSUMPTION]) | 7 | 7 | inferred |
| Workspace fee (Pro, needed for team access and longer PITR [ASSUMPTION]) | 25 | | [comparedge](https://comparedge.com/tools/render/cost-guide) |
| Object storage: none of its own; use Spaces or S3 | 5 | | as A |
| **Total** | | **~96** | |

Not recommended: near the ceiling, BYPASSRLS unknown, no object storage of its own, and the pricing changed twice in
2026 per third-party reports.

### Recommendation

**Option A, DigitalOcean SGP1, at about $74 a month.** It is the only option where the owner login looks possible,
the provider has everything in one Singapore region (database with PITR, HTTPS app host with worker and jobs, S3-API
object storage, registry), and there is about $25 of headroom. Two gates come before any money is committed:

1. the plan-change note above;
2. on the FIRST cluster (staging), `scripts/ops/db-bootstrap.sh` must pass its preflight. If it refuses, stop,
   delete the cluster, and bring the decision back. The fallback is a Droplet with self-managed PostgreSQL 16 and
   WAL archiving to Spaces. That is not "managed", so it needs a founder decision.

## What is in the repository for option A

| File | What |
|---|---|
| `ops/terraform/*.tf` | Project; one PostgreSQL 16 cluster per environment (`prevent_destroy`), a database firewall (only its own app and the founder's address); one private bucket per environment, no versioning (retention deletes really delete); a key per bucket scoped to that bucket only; the registry. Not applied |
| `ops/do/app.staging.yaml`, `ops/do/app.production.yaml` | App Platform specs: web, worker, PRE_DEPLOY migrate job, daily purge job, the attached cluster (for its CA certificate), own domain; every secret is a `CHANGE_ME_` placeholder |
| `Dockerfile.prod`, `scripts/deploy/entrypoint.sh` | The one image (plain build, demo and recorded-chain absence checked during the build); writes the DB CA certificate for `sslmode=verify-full` |
| `src/server/storage/s3.ts` | `CLEARLINE_UPLOAD_STORE=s3`: uploads in Spaces, sealed as on disk |
| `scripts/ops/db-bootstrap.sh` | The four logins and the database on a managed cluster, after the preflight |
| `.github/workflows/deploy-*.yml`, `scripts/deploy/*` | docs/ops/DEPLOY_AND_ROLLBACK.md |

Validation [VERIFIED]: `terraform` is not installed here, so `terraform validate` was not run. The `.tf` files parse
with `python-hcl2` 8.2.0 (HCL syntax only; provider schema and attribute names are [ASSUMPTION], checked by the
founder's first `terraform plan`). The App Platform specs parse as YAML and are checked by
`tests/server/deploy-config.test.ts`. They were not checked against DigitalOcean's spec schema: `doctl apps spec
validate` needs the API.

## Provisioning, step by step (for the founder, after deciding)

Run from your own computer. Paste nothing secret into chat, tickets or the repository. Keep the values in your password
manager.

```bash
# 0. tools: doctl, terraform >= 1.6, psql 16, jq, openssl. Account with 2FA on; a billing alert at $90.
doctl auth init                                   # paste a token with full scope for provisioning only; revoke later
export DIGITALOCEAN_TOKEN=$(doctl auth token 2>/dev/null || true)   # or read -rs DIGITALOCEAN_TOKEN
#    Spaces admin key for Terraform only (console: API → Spaces Keys → full access), then:
read -rs SPACES_ACCESS_KEY_ID; read -rs SPACES_SECRET_ACCESS_KEY; export SPACES_ACCESS_KEY_ID SPACES_SECRET_ACCESS_KEY

# 1. infrastructure (first apply: clusters, buckets, keys, registry)
cd ops/terraform && cp terraform.tfvars.example terraform.tfvars   # put your own IP in admin_ip_cidrs
terraform init && terraform plan -out plan.bin    # READ the plan: 2 clusters, 2 buckets, 2 keys, 1 registry, 1 project
terraform apply plan.bin
terraform output database_hosts
terraform output -json spaces_keys                # straight into the password manager

# 2. each environment's database (staging FIRST; stop if the preflight refuses)
doctl databases list                              # note the cluster ids
doctl databases get-ca <staging-cluster-id> -o json | jq -r .certificate | base64 -d > /tmp/ca-staging.pem
export PGHOST=<staging host> PGPORT=25060 PGUSER=doadmin PGADMINDB=defaultdb PGSSLMODE=verify-full PGSSLROOTCERT=/tmp/ca-staging.pem
read -rs PGPASSWORD; export PGPASSWORD           # doadmin password (doctl databases connection <id>)
for v in OWNER RUNTIME JOBS PROVISIONING; do read -rs "CLEARLINE_${v}_PASSWORD"; export "CLEARLINE_${v}_PASSWORD"; done
#   (four NEW random values per environment: openssl rand -hex 24, stored in the password manager)
scripts/ops/db-bootstrap.sh clearline
#   repeat for production with its own CA, host and four NEW passwords

# 3. the apps (staging first). Fill a LOCAL copy (git-ignored), create, then delete the copy.
cp ops/do/app.staging.yaml ops/do/app.staging.local.yaml
#   replace every CHANGE_ME_: the URLs are
#   postgres://clearline_runtime:<pw>@<private host>:25060/clearline?sslmode=verify-full&sslrootcert=/tmp/clearline-db-ca.pem
#   (same for clearline_jobs, clearline_provisioning, and clearline_owner in the two jobs);
#   BETTER_AUTH_SECRET: openssl rand -hex 32; CLEARLINE_UPLOAD_KEY: openssl rand -base64 32 (KEEP IT: files sealed with
#   it are unreadable without it); the Spaces key of THIS environment's bucket. image tag: leave it, CI sets it.
#   The first create needs an image: push one by hand once, or run deploy-staging first and create the app after.
doctl apps create --spec ops/do/app.staging.local.yaml && shred -u ops/do/app.staging.local.yaml
doctl apps list                                   # note the app ids

# 4. second terraform apply: only the apps (and your IP while you need it) reach the databases
#    terraform.tfvars: app_ids = { staging = "<id>", production = "<id>" }; later remove admin_ip_cidrs and apply again
terraform apply

# 5. DNS for clearlineconnect.org: CNAME staging → <staging app default domain>, app → <production app default domain>
#    (App Platform shows the target and issues the certificate), plus the e-mail records below.

# 6. GitHub: environments staging and production, secrets and variables as in docs/ops/DEPLOY_AND_ROLLBACK.md;
#    production: required reviewer = you. Create the release branch. Push to release → staging deploys.

# 7. First staging run: smoke passes; create the first merchant with the admin CLI over the owner login
#    (DEPLOYMENT_RUNBOOK_RC7 "First run"); a restore drill: fork the staging cluster to a time 1 hour ago,
#    connect with the owner login, run `setup-summary`, delete the fork. Record the result.

# 8. Production: Actions → deploy-production → sha that passed staging → approve. Revoke the provisioning token.
```

Do not set `CLEARLINE_CHAIN_LIVE=1`, e-mail sending or any new key until the steps below are decided.

## E-mail (transactional): proposal

The app sends invitations, verification and reset e-mails through `EmailSender`. Today only local stand-ins exist: the
`email_outbox` table (`CLEARLINE_EMAIL_SENDER=outbox`, set in the specs) and an outbox folder. **No provider relay is
built.** Building one (a worker task that reads the outbox and calls the provider's API) is a separate, approval-only
slice: it sends personal data (names, e-mail addresses) to a processor.

| Provider | Price | Notes |
|---|---|---|
| **Amazon SES, ap-southeast-1 (recommended)** | about $0.10 per 1,000 e-mails; free-tier terms disputed in sources | Data processed in Singapore. DKIM, custom MAIL FROM. A new account starts in the sandbox, so a production-access request is needed. Separate AWS account, used for SES only ([price summaries](https://mailtrap.io/blog/transactional-email-services/), [lettr](https://lettr.com/blog/best-transactional-email-services/)) [ASSUMPTION] |
| Resend | free: 3,000 a month, 100 a day, 3 domains | Simplest API. Region and processor terms to be checked |
| Postmark | free: 100 a month | Strong deliverability; the free tier is too small past the pilot |

Expected v1 volume: dozens to a few hundred a month [GUESS], so the cost is under $1 either way. Sender domain
`clearlineconnect.org`. Send from `no-reply@clearlineconnect.org` with a custom MAIL FROM subdomain
`mail.clearlineconnect.org`. The founder sets these DNS records (exact values come from the provider's console):

| Record | Name | Value (shape) |
|---|---|---|
| SPF (on the MAIL FROM subdomain) | `mail.clearlineconnect.org` TXT | `v=spf1 include:amazonses.com -all` |
| MAIL FROM MX | `mail.clearlineconnect.org` MX 10 | `feedback-smtp.ap-southeast-1.amazonses.com` |
| DKIM (3 records, Easy DKIM) | `<token>._domainkey.clearlineconnect.org` CNAME | `<token>.dkim.amazonses.com` |
| DMARC, start | `_dmarc.clearlineconnect.org` TXT | `v=DMARC1; p=none; rua=mailto:dmarc-reports@clearlineconnect.org; adkim=s; aspf=r; pct=100` |
| DMARC, after 2–4 weeks of clean reports | same | `p=quarantine`, then `p=reject` |
| Root SPF if nothing else sends as the root domain | `clearlineconnect.org` TXT | `v=spf1 -all` |

## Chain provider keys (free tiers, two per network): proposal

The app reads Tron through TronGrid (`TRONGRID_API_KEY`) and Ethereum through Etherscan V2 (`ETHERSCAN_API_KEY`) and
an RPC URL (`ETHEREUM_RPC_URL`). They are read-only: no signing method exists in the code. Live reads stay off
(`CLEARLINE_CHAIN_LIVE` unset) until the founder adds the keys. Use **separate keys for staging and production**, so
staging cannot exhaust production's quota. "Two per network" here means a primary and a standby provider. **The code
reads one provider per network at a time**, so the standby is a key kept ready and swapped in by changing the secret.
Automatic failover is not built.

| Network | Primary (free tier) | Standby (free tier) |
|---|---|---|
| Tron | TronGrid: free key; 100,000 requests a day at 15 rps per most sources, but a newer free plan may be 10,000 a day ([trongrid.io](https://www.trongrid.io/), [boltrpc](https://boltrpc.io/blog/trongrid-rate-limits)) [ASSUMPTION] | a second TronGrid account's key, or a TRON-compatible RPC provider's free tier ([chainstack comparison](https://chainstack.com/best-tron-rpc-providers-2026/)). A different provider needs a code change (TronGrid's API is used) |
| Ethereum | Etherscan API V2: free tier 3 calls/s, 100,000 a day; from 3 Nov 2026 calls are blocked at the daily limit unless overage is on ([Etherscan rate limits](https://docs.etherscan.io/rate-limits)) | RPC: Alchemy free (30M compute units a month) ([Alchemy](https://www.alchemy.com/support/free-tier-details)) or Infura free (3M credits a day per the pricing page) ([Infura](https://docs.infura.io/get-started/pricing/)) as `ETHEREUM_RPC_URL` |

Keys go only into App Platform's encrypted secrets, never the repository or CI. Run `npm run chain:smoke` from your own
machine once per key before turning on live reads. It has never been run against mainnet.

## Decisions for the founder

1. Accept option A (about $74/month), subject to the two gates above.
2. **HSTS:** the app does not send `Strict-Transport-Security`. `smoke.sh` reports it as a warning. Adding it in
   `next.config.mjs` for https origins changes a security header, so it is approval-only and is not done here.
3. E-mail provider (SES recommended), and building the outbox relay as an approval-only slice.
4. Whether to add the production standby node (about +$15) now or after the pilot.
5. Backup retention: DigitalOcean keeps 7 days. Deleted merchants' data remains in backups for up to 7 days. Note
   this in the retention policy.
