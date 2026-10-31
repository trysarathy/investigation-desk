# CI recommendations (proposed; nothing is enabled by devops-engineer)

31 Oct 2026. Today: **0 GitHub Actions workflows; `main` unprotected** [VERIFIED: gh api]. The only
automatic check is Vercel's build status. qa-security-engineer runs the full suite nightly by hand.

## R1. A CI workflow (PR for her review; adding a file under `.github/workflows/` turns it on when merged)
Branch `ci/build-test-<date>`, PR into `main`. It runs what COMPANY_RULES already require before a PR:
`tsc`, `vitest`, `next build`. No secrets, read-only token, actions pinned by SHA.

```yaml
# .github/workflows/ci.yml  (PROPOSED — opened as a PR, merged only by Aashmiin)
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read            # least privilege (GitHub secure-use guide)
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build-test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      DEMO_MODE: "1"         # offline demo data; no keys needed
      LIVE_LOOKUPS: "off"
      AI_EXPLANATIONS: "off"
    steps:
      - uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09   # v5.1.0
        with: { persist-credentials: false }
      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0
        with: { node-version: "22", cache: npm }
      - run: npm ci --no-audit --no-fund
      - run: npx tsc --noEmit
      - run: npx vitest run
      - run: npx next build
```
- SHAs from `git ls-remote --tags https://github.com/actions/{checkout,setup-node}` on 31 Oct 2026
  [VERIFIED]; newer majors exist (checkout v7.0.1, setup-node v7.1.0). At PR time re-check the SHA and
  release notes; prefer a version at least 2 weeks old.
- Before opening: run the same four commands locally on the target sha and paste results. Check the
  env vars above don't change test results vs. the nightly QA counts (if they do, drop them).
- Cost: public repo → GitHub-hosted runners are free for public repositories [ASSUMPTION: GitHub
  billing docs not opened this session]. Re-check before claiming US$0.
- Not included on purpose: deploy steps, secrets, `pull_request_target`, third-party actions.

## R2. Branch protection on `main` (her setting; GitHub → Settings → Branches)
Require a PR, block force-push and deletion (default for a rule), and once R1 has run green for a week,
require the `ci / build-test` status check [VERIFIED: github/docs `about-protected-branches.md`].
Cost US$0. Reason: OpenSSF Scorecard rates Branch-Protection High risk; `main` is the product.

## R3. Pin the remaining floating dependencies (small PRs, her merge)
- `website/deploy.sh`: `npx --yes vercel@latest` → an exact version (`vercel@<x.y.z>`), re-checked monthly.
- `Dockerfile`: `node:22-slim` → a specific `node:22.x.y-slim` tag (digest pinning optional).
- Add `"engines": {"node": ">=22 <23"}` or `.nvmrc` (`22`) so Vercel, Docker and laptops agree
  (12-factor dev/prod parity). Confirm the Vercel project's Node setting with her first.

## R4. Stop red noise from finished branches
`website`, `website-books`, `brief-books`, `film-books` (no open PRs) deploy red on every push. Options
for her: delete the branches, or a one-file PR adding `vercel.json` with `"git": {"deploymentEnabled": false}`.

## R5. Later (not now)
Dependabot/Renovate for weekly update PRs (Scorecard Dependency-Update-Tool); gitleaks in CI
(qa-security-engineer's call, allowlist `team/evals/` only); `output: "standalone"` for a smaller image.
