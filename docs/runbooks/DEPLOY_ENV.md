# Runbook: `CLEARLINE_DEPLOY_ENV` (where a server runs)

**Founder decision (v1 #165): `CLEARLINE_DEPLOY_ENV` is required on every real deployment.** A production server
(`NODE_ENV=production`, which `next start` sets) **refuses to start** when it is unset or empty, and logs one line:

```
{"event":"server_refused","code":"DEPLOY_BUILD_REFUSED","hint":"CLEARLINE_DEPLOY_ENV is not set. A production server (NODE_ENV=production, `next start`) must say where it runs: set CLEARLINE_DEPLOY_ENV=production or staging on a real deployment, or local, ci or demo for a local run, CI or the demo. See docs/runbooks/DEPLOY_ENV.md."}
```

The check runs at server start (`src/instrumentation.ts` → `src/server/deploy-guard.ts`), whatever the build. It names
no secret. `next dev` and the unit tests (`NODE_ENV` development or test) are not affected.

## Values

| Value | Use | Set by |
|---|---|---|
| `production` | the production deployment | the deployer (hosting settings / secrets) |
| `staging` | a staging deployment | the deployer |
| `demo` | the offline demo (`npm run demo`), a demo preview image | `scripts/demo/lib.ts` (`appEnv`); `docker run -e` / `fly secrets` for the preview image |
| `ci` | servers started in GitHub Actions | every workflow job's `env` (`.github/workflows/*.yml`); test servers via `tests/deploy-env.ts` when `CI` is set |
| `local` | a person's own `next start`, local Playwright runs | the person (`CLEARLINE_DEPLOY_ENV=local npx next start`); test servers via `tests/deploy-env.ts` |

Any other value (for example `prod`) refuses at build (`next.config.mjs`) and at start, so a typo can never switch the
checks off. With `staging` or `production`, a demo build or a test build also refuses to start (unchanged).

## Where it is set in this repository

- Playwright web servers: `playwright.clearline.config.ts`, `playwright.control.config.ts` and
  `tests/e2e-control/restart.spec.ts` (through `tests/e2e-control/env.ts`), `playwright.merchant.config.ts` (through
  `tests/e2e-merchant/env.ts`), `playwright.rc3-console.config.ts`, `playwright.mentor.config.ts`,
  `playwright.funding.config.ts` (passed on by `tests/browser/start-funding-server.mjs`),
  `tests/qa-release-v2/playwright.qa-v2.config.ts`, and the platform suite's own servers (`tests/platform/server.ts`).
  All use `testDeployEnv()` (`tests/deploy-env.ts`): `ci` under CI, `local` otherwise; a test server refuses to claim
  `staging`, `production` or `demo`.
- The demo: `scripts/demo/lib.ts` (`appEnv`, used by `npm run demo` and `scripts/demo/e2e-server.ts`, so
  `playwright.demo.config.ts` and `playwright.demo-video.config.ts` too): `demo`.
- CI: every job in `.github/workflows/*.yml` except `lint` sets `CLEARLINE_DEPLOY_ENV: ci`.
- v1 phase 6: the App Platform specs set `staging` / `production` (`ops/do/app.staging.yaml`,
  `ops/do/app.production.yaml`); `scripts/prodlocal/run.sh` and `docker-compose.prod-local.yml` set `local`;
  `Dockerfile.prod` does not set it.
- The `Dockerfile` deliberately does **not** set it: whoever runs the image says which (`-e CLEARLINE_DEPLOY_ENV=demo`
  for the preview). A real deployment sets `production` or `staging` in its hosting settings.

## Checks

- Unit: `tests/server/deploy-guard.test.ts` (unset/empty refuses in every build with the message above; every named
  value starts a plain build; test servers never claim staging, production or demo; every config and workflow above
  sets it).
- On the go-live checklist: docs/release/GO_LIVE_CHECKLIST.md.
