# Deploy state, 31 Oct 2026 (first real check, by the builder of devops-engineer)

**Check started 2026-10-31 14:08:45 SGT (06:08:45 UTC).** Read-only. Method: GitHub REST only
(GraphQL is blocked from cloud sessions):

```bash
gh api 'repos/trysarathy/investigation-desk/branches?per_page=100'          # 40 branches
gh api repos/trysarathy/investigation-desk/commits/<sha>                    # commit date
gh api repos/trysarathy/investigation-desk/commits/<sha>/status             # combined status (Vercel)
gh api repos/trysarathy/investigation-desk/commits/<sha>/check-runs         # "Vercel Preview Comments"
```

Raw output for all 40 branches: `deploy-state-2026-10-31.raw.tsv` (branch, sha, commit date UTC,
`state|count|statuses`, `count|check-runs`). Every row below is [VERIFIED: gh api, 31 Oct 14:08 SGT].

**Reading the combined status correctly.** GitHub returns `state: pending` with `total_count: 0` when
a commit has **no statuses at all**. That is "no deploy reported", not "deploying". The rows marked
`no status` below are that case.

## Active branches (head commit in the last 7 days): 26

| Branch | Head | Commit (UTC) | Vercel status | Updated (UTC) | Notes |
|---|---|---|---|---|---|
| main | 8decb27 | 31 Oct 04:37 | **success** | 31 Oct 04:38 | No "Preview Comments" check-run on main, so probably the production deployment of project `investigation-desk` [ASSUMPTION: GitHub Deployments API is blocked from this session, so environment not confirmed] |
| ai-team | 9f42e19 | 31 Oct 06:08 | success | 31 Oct 06:08 | |
| bug/dismiss-while-confirming-reorg | 2ca25e7 | 31 Oct 04:37 | success | 31 Oct 04:39 | |
| whitepaper-v0.3 | 1239bcb | 29 Oct 19:51 | success | 29 Oct 19:52 | PR #37 |
| whitepaper | 827a0ec | 29 Oct 06:19 | success | 29 Oct 06:20 | PR #35 |
| xero-scopes | da07676 | 29 Oct 06:10 | success | 29 Oct 06:11 | PR #36 |
| company-os | 0831c0a | 29 Oct 03:17 | success | 29 Oct 03:18 | |
| fix/preview-build | 53d5765 | 29 Oct 01:46 | success | 29 Oct 01:47 | PR #33 (the fix) |
| qa-fix/demo-video-2026-10-28 | 0e9fd3e | 28 Oct 18:26 | success | 28 Oct 18:28 | PR #32 (the fix) |
| qa-polish | 12abf33 | 28 Oct 18:12 | success | 28 Oct 18:14 | PR #31 |
| enterprise-pack | 7c493e3 | 28 Oct 17:29 | success | 28 Oct 17:30 | PR #30 |
| accounting-fixes | f49e81f | 28 Oct 15:44 | success | 28 Oct 15:44 | |
| accounting-sync | 12ceb99 | 28 Oct 13:18 | success | 28 Oct 13:19 | |
| **website-fixes** | c44edde | 28 Oct 15:48 | **failure** | 28 Oct 15:49 | PR #28 → pitch-deck. `dpl_E6qNXEfecJC7txW93Uhd4WeYXM2u` |
| **brief-fixes** | d179188 | 28 Oct 15:49 | **failure** | 28 Oct 15:51 | PR #29 → pitch-deck. `dpl_48st4bL3Zx2VBkgSPvUVTye7F1vY` |
| **demo-video** | c049bd4 | 28 Oct 15:27 | **failure** | 28 Oct 15:29 | PR #20 → main; fix PR #32 open. `dpl_Davf4zgb3ykLwjKKv1Ec9yg5kEV5` |
| **pitch-deck** | ad15acb | 28 Oct 15:27 | **failure** | 28 Oct 15:28 | PR #21 → demo-video; fix PR #33 open. `dpl_91n1GEEnENvnUHUTbBzw3sJDhe2M` |
| **film-books** | b3908c9 | 28 Oct 13:39 | **failure** | 28 Oct 13:40 | no open PR. `dpl_EBiBrXrgrR5PGZfGD4MH9ydKh8Cx` |
| **brief-books** | e424d1f | 28 Oct 13:19 | **failure** | 28 Oct 13:20 | no open PR. `dpl_Dg89GuT3nPSRHV9KxUvv6McvZhfc` |
| **website-books** | d1d6d20 | 28 Oct 13:18 | **failure** | 28 Oct 13:19 | no open PR. `dpl_87rmaz4HE7nGWzGtWzZUgoACajs6` |
| **website** | e61f2e5 | 28 Oct 01:12 | **failure** | 28 Oct 01:13 | merged via PR #22 (closed). `dpl_4sqyvpyWVBc2g115uwBgHgzxPn2w` |
| gtm-os | 0e5f89c | 29 Oct 02:31 | no status | — | expected: `vercel.json` has `"git": {"deploymentEnabled": false}` (commit "Skip Vercel deploys on gtm-os") |
| demo-a-plus | 81d9667 | 25 Oct 08:56 | no status | — | no `vercel.json`; cause unknown [GUESS: Vercel's Git link may post-date these commits; the earliest status seen on any branch is 28 Oct] |
| payment-requests | 136450b | 24 Oct 19:08 | no status | — | as above |
| test-real-data | 418a639 | 24 Oct 17:16 | no status | — | as above |
| qa-fixes | e167212 | 24 Oct 07:00 | no status | — | as above |

The 14 branches with heads older than 7 days (week1–4, spec-sync-*, exceptions-inbox*,
payments-matching, product-core-and-trust, add-product-spec, spec-direction) all have no status.

## Metric today
- **Active branches green: 13 of 26 (50%)**; 13 of 21 that report a deploy (62%). 8 red, 5 no status
  (1 intentionally off).
- `main`: green.
- Time red → fix PR: `website` red 28 Oct 01:13 UTC; PR #33 created 29 Oct 01:46 UTC = **24 h 33 min**.
  `demo-video` red 28 Oct 15:29 UTC; PR #32 created 28 Oct 18:27 UTC = **2 h 58 min**
  [VERIFIED: gh api status `updated_at` and PR `created_at`].
- Backup restore drill done: **yes on a scratch copy** (31 Oct, restore + start 6.9 s, 2/2 files match); no live store exists (`backups.md`).

## Cause of the 8 reds [VERIFIED: tree inspection of all 8 + local reproduction on `website`]
All 8 red branches contain `demo/video/remotion/` (7–9 files) and their root `tsconfig.json`
`exclude` lacks `demo/video/remotion`, so `next build` type-checks the film source and fails with
`TS2307 Cannot find module 'remotion'` (remotion is installed only inside the film project). The two
green fix branches are the only branches that contain the folder **and** exclude it. `main` does not
contain the folder (0 files).

Local reproduction, this session (scratch export of `origin/website` @ e61f2e5, Node v22.22.0, npm 10.9.4):
- `npm ci` exit 0 (127 packages). `npx next build` **exit 1**:
  `./demo/video/remotion/src/LiveDemo.tsx:7:141 Type error: Cannot find module 'remotion' or its corresponding type declarations.`
- Same tree with `"exclude": ["node_modules", "website", "demo/video/remotion"]`: `next build` **exit 0**;
  `tsc --noEmit` exit 0.
- `website/` static site (`cd website && npm ci && npx next build`): exit 0 (routes `/`, `/demo`,
  `/privacy`, robots, sitemap). The marketing site itself builds; only the root app preview fails.

Vercel's own build logs (`npx vercel inspect <dpl> --logs`) need a Vercel token, which this employee
does not hold, so the evidence is the local build.

## What it needs from Aashmiin (decisions, nothing done)
1. Merge PR #33 into `pitch-deck` and PR #32 into `demo-video` (both one-line `tsconfig.json`
   changes, green on Vercel). That turns `pitch-deck` and `demo-video` green.
2. PR branches #28 (`website-fixes`) and #29 (`brief-fixes`) stay red until they include the fix.
   devops-engineer can open one-line fix PRs into each (`fix/deploy-<branch>-<date>`), or she can
   update them from `pitch-deck` after #33 merges.
3. `website` (merged in PR #22), `website-books`, `brief-books`, `film-books`: no open PR. Recommend
   deleting the branches or adding a `vercel.json` with `"git": {"deploymentEnabled": false}`
   (as on `gtm-os`). Her decision; devops-engineer never deletes branches.

## Couldn't check
- Public uptime probes of `https://clearline-site.vercel.app/` and any `*.fly.dev` host: the session's
  network proxy refused the connection (CONNECT 403), so **no uptime reading was taken**.
- Whether `main`'s deployment is the production one, and Vercel project settings (Node version,
  production branch): need the Deployments API (blocked) or a Vercel token (not held).
- Whether a Fly.io app exists at all: no `fly.toml` on any branch; README shows the commands only.
- Repository facts that were checked: default branch `main`, visibility **public**, `main`
  **not protected**, **0 GitHub Actions workflows** [VERIFIED: gh api, 31 Oct].
