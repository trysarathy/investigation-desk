# Knowledge pack: devops-engineer

Last refreshed **31 Oct 2026** against `origin/main` @ 8decb27, `origin/website` @ e61f2e5,
`origin/gtm-os` @ 0e5f89c and the GitHub commit statuses of all 40 branches (14:08 SGT).
Refresh owner: **devops-engineer** (deploy-state every night; the rest on the 1st of each month with
the monthly refresh, and the same night a cited file changes). Labels per company rule 2.

| File | Use it for | Refresh when |
|---|---|---|
| `deploy-map.md` | Every environment (Vercel previews, `main`, `clearline-site`, Fly preview, tunnel, CI), how it builds, where config and data live | any change to `package.json`, `next.config.mjs`, `tsconfig.json`, `Dockerfile`, `vercel.json`, `website/` config, hosting |
| `deploy-state-2026-10-31.md` (+ `.raw.tsv`) | The first real check: per-branch state with timestamps, the cause of the 8 reds, metric baseline | superseded nightly by Log rows; keep as baseline |
| `runbooks.md` | Failed preview, failed prod, rollback (recommend only), backup/restore drill, secret found, postmortem template | after any incident |
| `backups.md` | What data exists, what's backed up (honestly: nothing hosted yet), the plan for a pilot | data-dir or hosting change |
| `monitoring-uptime.md` | What can be measured read-only today, what is blocked, internal SLOs | network or hosting change |
| `secrets-hygiene.md` | Where secrets live (names only), the pasted-token rule, redaction | new env var or host |
| `ci-recommendations.md` | Proposed CI workflow (pinned), branch protection, pinning, red-noise cleanup | each proposal accepted/rejected |
| `cost-notes.md` | Prices with labels for anything that would cost money | monthly |
| `benchmark.md` | SRE, DORA, GitHub, Vercel, Fly, Next.js, 12-factor, OpenSSF; 2 teardowns (GitLab 2017 backups, tj-actions 2025) | monthly |

## Decisions recorded here
- 31 Oct: "Active branch" = head commit in the last 7 days. "Green" = Vercel combined status
  `success` seen this run. `pending` with 0 statuses = **no status**, not pending.
- 31 Oct: The local `next build` is the evidence for a red Vercel build (no Vercel token held).
- 31 Oct: CI is proposed as a PR; devops-engineer never enables it, never changes settings.

## Primary vs secondary in this pack
Opened this session (primary, via the organisation's own source repos because the doc sites were
blocked): GitHub docs (`github/docs`), Fly docs (`superfly/docs`), Next.js docs (`vercel/next.js`),
Vercel CLI source (`vercel/vercel`), 12-factor (`heroku/12factor`), OpenSSF Scorecard (`ossf/scorecard`),
DORA Four Keys (`dora-team/fourkeys`), GitHub Advisory GHSA-mrrh-fwg8-r2c3 (`github/advisory-database`),
GitLab's infrastructure issues #1094–#1102 (GitLab API). Plus all repo files and `gh api` output.
**Not opened** (labelled ASSUMPTION): sre.google (SRE book), dora.dev, vercel.com/docs, GitLab's blog
postmortem, Cloudflare blog, GitHub billing docs, uptime-monitor pricing.
Ask Aashmiin to allow sre.google, dora.dev, vercel.com, fly.io, docs.github.com in Network settings.
