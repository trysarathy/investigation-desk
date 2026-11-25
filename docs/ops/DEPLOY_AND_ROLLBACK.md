# CI/CD, migrations and rollback (v1 phase 6)

Status: **files only.** No workflow below has deployed anything: no cloud account, secret or GitHub environment exists
yet. Without the secrets every deploy step skips itself with a notice and the run is green. Labels: **[VERIFIED]** run
or checked on the authoring machine; **[ASSUMPTION]** reasoned, not run.

## The pipeline

```
pull request ──► every suite (no path filters): ci (typecheck, unit, production-build gate, control-db, migrations,
                 lint), control-e2e, merchant-e2e (+ onboarding), clearline-browser, funding-browser, funding-replay,
                 mentor-browser
merge to main ─► the same
push to release ─► deploy-staging.yml: ci + control-e2e + merchant-e2e again (reusable workflows), migration lint
                   against what staging runs, build Dockerfile.prod ONCE (tag = commit sha), push, deploy staging
                   (pre-deploy migrate job first), smoke test, status "deployed/staging" on the commit
founder, by hand ─► deploy-production.yml (workflow_dispatch: sha + reason): sha on release? passed staging?
                    → waits for the `production` environment's required reviewer → migration lint against what
                    production runs → deploy the SAME image → smoke test → status "deployed/production"
```

- **One artefact.** Production never builds. It deploys the registry image that staging built and smoke-tested,
  addressed by the full commit sha. The image build itself fails if any demo or recorded-chain marker is in the bundle
  (`Dockerfile.prod` runs `check-chain-recording.mjs --expect absent` and `--marker demo --expect absent`).
- **Secrets stay in two places.** GitHub holds only `DIGITALOCEAN_ACCESS_TOKEN` (per environment). Database logins,
  `BETTER_AUTH_SECRET`, `CLEARLINE_UPLOAD_KEY` and the Spaces key live encrypted in App Platform. `do-deploy.sh` changes only
  `image.tag` in the app's spec, so they never pass through CI or its logs.
- **No secrets, no deploy.** Each deploy job's first step checks that its secret and variables exist. If any is
  missing, every later step is skipped (`if: steps.ready.outputs.ok == 'true'`, enforced by
  `tests/server/deploy-config.test.ts`). No `deployed/staging` status is written, so production cannot be promoted
  from such a run.

### GitHub settings the founder sets once (not done; the agent has no access and must not change settings)

| Setting | Value |
|---|---|
| Branch `release` | Create from `main` when the first release is cut. Ruleset: PR required, no force push, no deletion; required checks as in `docs/ci/REQUIRED_CHECKS_PROPOSAL.md` plus `migrations` |
| Environment `staging` | Secret `DIGITALOCEAN_ACCESS_TOKEN` (a token scoped to apps and registry, read/write). Variables `DO_APP_ID_STAGING`, `DO_REGISTRY` (registry name), `STAGING_ORIGIN` (`https://staging.clearlineconnect.org`). Deployment branches: `release` |
| Environment `production` | **Required reviewer: the founder**; "prevent self-review" on; deployment branches: `release` only; secret `DIGITALOCEAN_ACCESS_TOKEN` (can be a separate token); variables `DO_APP_ID_PRODUCTION`, `PRODUCTION_ORIGIN` (`https://app.clearlineconnect.org`) |
| Actions permissions | Workflows default to read-only `GITHUB_TOKEN`. The deploy jobs ask for `statuses: write` themselves |

## Migrations: expand / contract

During a deploy, the old version keeps serving while the pre-deploy job applies the new migrations. A rollback puts
the old code back on the new schema. So **every release only expands the schema**:

1. **Expand** (release N): add tables, nullable columns, new functions or views. The code writes both old and new
   where needed. A backfill runs as a migration or an admin command.
2. **Switch** (release N or N+1): the code reads the new shape and stops naming the old one.
3. **Contract** (a later release, N+2 at the earliest): drop the old column, table or function. By then nothing
   deployed names it.

`scripts/deploy/check-migrations.mjs --base <ref>` enforces this for every migration added since `<ref>`. The `ref` is
the PR's base in CI, and the sha running in the target environment before a deploy.

- A `DROP TABLE/COLUMN/FUNCTION/VIEW/TYPE/SEQUENCE` fails if the code at `<ref>` **or** at HEAD (`src/`, `scripts/`)
  still names the identifier. This is the "drop in the same release as code using it" case: the code at `<ref>` is
  the version that keeps running during the deploy.
- A `RENAME` (table or column) or an `ALTER COLUMN ... TYPE` always fails. Old and new code cannot both work on that
  schema.
- A migration that `<ref>` already had and this change edits or deletes always fails.
- Waiver, in the migration itself, shown in the output for the reviewer:
  `-- migration-lint: allow <drop|rename|type> <identifier> -- <reason>`.

[VERIFIED] `tests/server/migration-lint.test.ts` passes 6/6. Against this repository's history
(`--base 7525f91~60`) the lint flags exactly one historical migration:
`0036_chain_reads_partitioned.sql` (`ALTER TABLE chain_reads RENAME TO chain_reads_unpartitioned`). That rename
would have needed a waiver or an expand/contract plan under this rule. Against the current base it reports 0 new
migrations and 0 failures. Identifier matching is by whole word (`git grep -w`), so a common name can be a false
positive. The lint then fails safe, and a reviewed waiver clears it.

## Rollback

| Situation | What to do | Time [GUESS] |
|---|---|---|
| The new version fails its deploy (migrate job or health check fails) | Nothing: App Platform keeps the previous version serving and the job fails red [ASSUMPTION: App Platform behaviour] | 0 |
| The smoke test fails after a deploy, or a bug is found | Run **deploy-production** with the previous good sha (the last commit with `deployed/production` before this one) and reason `rollback: <what>`. It is on `release` and passed staging, so it is accepted. The job skips the forward migration lint and warns that it is a rollback. Expand-only migrations mean the older code runs on the newer schema | 10–20 min incl. approval |
| Emergency, GitHub unavailable | App Platform console → the app → Activity → the previous deployment → Rollback [ASSUMPTION: offered by the console for image-based apps]; or locally `DIGITALOCEAN_ACCESS_TOKEN=… scripts/deploy/do-deploy.sh <app-id> <previous sha>` | 5–10 min |
| Data damaged (a bad migration or bad writes) | Last resort, founder decision: fork the cluster to a point in time before the damage (DigitalOcean point-in-time restore, last 7 days) into a NEW cluster, check it with the admin CLI's `setup-summary`, then point the app's database secrets at it. Writes after that point are lost, so record the incident and every affected merchant first | 30–60 min |

Never roll back by editing or deleting a migration, and never run a down migration. Drizzle migrations here are
forward-only. A fix is a new expand migration.

## Smoke test

`scripts/deploy/smoke.sh <origin> [--expect-https]` is read-only and needs no secret. It checks:

- the sign-in page answers 200, with a per-request CSP nonce, `frame-ancestors 'none'`, `X-Frame-Options DENY`,
  `nosniff` and no `X-Powered-By`;
- a protected API answers 401 with no stack trace;
- the three demo routes are not served;
- an unknown path is 404;
- with `--expect-https`: the origin is https and http redirects to https. A missing HSTS header is a warning (see
  the HSTS decision in HOSTING_PROPOSAL.md).

[VERIFIED] 11/11 against prod-local, twice (docs/ops/PROD_LOCAL.md).

## What was checked here, and what was not

- [VERIFIED] `actionlint` 1.7.12 (run from a scratch virtualenv, without shellcheck) on every workflow: no findings.
  `tests/server/deploy-config.test.ts` and `tests/server/deploy-guard.test.ts` pass.
- [ASSUMPTION] Not run on GitHub: the reusable-workflow calls (`uses: ./.github/workflows/ci.yml`), environment
  approvals, the commit-status gate, the DigitalOcean API calls in `do-deploy.sh` and `do-current-tag.sh` (fields
  `app.spec`, `app.active_deployment.spec`, `deployments[].phase`, `created_at`), and `docker login` with the API
  token. The first real staging deploy is the test. Read its log before the first production run.
