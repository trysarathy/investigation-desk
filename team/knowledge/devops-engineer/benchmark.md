# How the best SRE / DevOps engineers work, and what it means for a 1-person, 0-customer company

Accessed 31 Oct 2026. Labels follow company rule 2. **Network note:** this session could not reach
sre.google, dora.dev, docs.github.com, vercel.com, fly.io, nextjs.org, 12factor.net or
securityscorecards.dev directly (DNS/proxy refused). Where the **same organisation publishes the
same document as source on GitHub/GitLab**, it was opened there and is labelled
`[VERIFIED: <org> source repo]`. The Google SRE book has no such source, so every SRE-book point is
`[ASSUMPTION: not opened this session]` until sre.google is allowed.

## 1. Frameworks

### Google SRE (Beyer, Jones, Petoff, Murphy (eds.), *Site Reliability Engineering*, O'Reilly 2016, free at https://sre.google/sre-book/)
All [ASSUMPTION: not opened this session; standard content of chapters 4, 5, 15 and appendix D]:
- **SLI / SLO / SLA** (ch. 4, "Service Level Objectives"): measure a few indicators users feel
  (availability, latency), set an objective, keep the SLA (a promise with consequences) looser than
  the SLO. *Clearline today:* no users, so **no SLA and no public SLO**. Internal SLOs only:
  "previews that Aashmiin might show build green", "the marketing site answers 200".
- **Error budgets** (ch. 3): 100% minus the SLO is the budget for change; when it is spent, slow down
  releases. *Clearline:* applied to deploys: if `main` goes red twice in a week, the nightly asks for
  a CI gate before more merges.
- **Toil** (ch. 5, "Eliminating Toil"): manual, repetitive, automatable, tactical, no lasting value,
  scales with load; keep it under ~50% of an SRE's time. *Clearline:* the nightly check is toil done
  by an agent; the CI workflow PR is the "engineering" that removes it.
- **Postmortem culture** (ch. 15): written for user-visible downtime, data loss, on-call intervention,
  or a monitoring failure; **blameless**; action items with owners. *Clearline:* template in
  `runbooks.md` §6, triggers in playbook §6.
- **Incident management** (ch. 14): one incident commander, clear roles, a live document. *Clearline:*
  Aashmiin is the only human, so devops-engineer acts as scribe and recommender; she decides.

### DORA (Google's DevOps Research and Assessment)
[VERIFIED: dora-team/fourkeys source repo, `README.md`, https://github.com/dora-team/fourkeys] Four
keys: **Deployment Frequency**, **Lead Time for Changes**, **Time to Restore Services**, **Change
Failure Rate** ("the number of failures per the number of deployments. For example, if there are four
deployments in a day and one causes a failure, that is a 25% change failure rate"). dora.dev's newer
guide (which renames and extends the metrics) could not be opened [ASSUMPTION: not opened].
*Clearline:* with ~0 production deploys a week, DORA rates are noise (n < 10: report counts, not
rates, as the chief-of-staff does). What we track instead: share of active branches green, time
red → fix PR, and (once there are production deploys) count of deploys and failed deploys per week.

### GitHub branch protection and Actions
- [VERIFIED: github/docs source, `about-protected-branches.md`] Protection rules can "disable force
  pushes", "prevent the matching branches from being deleted", require PR reviews and **required
  status checks** ("can be checks or commit statuses") before merging.
  *Clearline:* `main` is **not protected** [VERIFIED: gh api]. Recommend (her settings change):
  protect `main`, block force-push and deletion, require the CI check once it exists.
- [VERIFIED: github/docs source, `content/actions/reference/security/secure-use.md`] Set the default
  `GITHUB_TOKEN` to read-only; **pin actions to a full-length commit SHA**; avoid `pull_request_target`
  with untrusted code; treat a compromised action as having access to all repo secrets.

### Vercel (deployments, previews, promote, rollback)
- [VERIFIED: vercel/vercel source, `packages/cli/src/commands/{promote,rollback,inspect}/command.ts`]
  The CLI has `vercel promote` ("Promote an existing Deployment to current"), `vercel rollback`
  ("Roll back to a previous deployment") and `vercel inspect --logs`. **These are production changes
  and need a token: devops-engineer recommends them, never runs them.**
- `git.deploymentEnabled: false` in `vercel.json` stops Git deploys for a branch [VERIFIED in use on
  `gtm-os`; Vercel's docs page not opened → ASSUMPTION on exact semantics].
- Hobby plan is for non-commercial use [ASSUMPTION: from AGENTS.md; vercel.com not opened].

### Fly.io (volumes, snapshots)
[VERIFIED: superfly/docs source repo, `volumes/overview.mdx`, `volumes/snapshots.mdx`, `about/pricing.mdx`;
published at https://fly.io/docs/volumes/]
- "A volume exists on one server"; "Fly.io does not automatically replicate data among the volumes";
  "Always provision at least two volumes per app"; with one Machine "you'll have downtime if there's a
  host or network failure, and whenever you deploy your app".
- "We automatically take daily snapshots of all Fly Volumes", kept **5 days by default**, settable
  1–60 days (`--snapshot-retention`, or `snapshot_retention` under `[mounts]` in `fly.toml`); restore
  = `fly volumes create <name> --snapshot-id <id> -s <size>` into a **new** volume.
- Fly's own warning: snapshots "shouldn't be your primary backup method".
- Prices: volume **US$0.15/GB/month** (provisioned); snapshots **US$0.08/GB/month, first 10 GB free
  each month**.

### Next.js deployment
[VERIFIED: vercel/next.js source, `docs/01-app/01-getting-started/17-deploying.mdx`] Four options:
Node.js server (all features), Docker (all features), static export (limited), adapters. The
product uses Node/Docker (needs route handlers and middleware); the website uses static export.
`output: "standalone"` is the recommended minimal Docker image (we don't use it: an improvement
note, not urgent).

### The Twelve-Factor App (Adam Wiggins / Heroku, https://12factor.net)
[VERIFIED: heroku/12factor source repo, `content/en/{config,build-release-run,logs,dev-prod-parity}.md`]
- III Config: "strict separation of config from code"; litmus test: "whether the codebase could be
  made open source at any moment, without compromising any credentials". **Our repo IS public**
  [VERIFIED: gh api], so this test is live, not hypothetical.
- V Build, release, run: a release = build + config; releases are immutable → rollback = point at a
  previous release (Vercel's model).
- XI Logs: write to stdout; never manage log files. X Dev/prod parity: keep the gap small (same Node
  major locally, in Docker and on Vercel).

### OpenSSF Scorecard (supply chain)
[VERIFIED: ossf/scorecard source, `docs/checks.md`] Checks include Branch-Protection (risk High),
CI-Tests, Code-Review, Dangerous-Workflow, Dependency-Update-Tool, **Pinned-Dependencies** (Medium),
SAST, Security-Policy, **Token-Permissions** (High). *Clearline today* [our own reading, not a
Scorecard run]: Branch-Protection fails (main unprotected), CI-Tests fails (no CI), Pinned-Dependencies
mostly passes for npm (exact versions + lockfile) but fails for `vercel@latest` in `deploy.sh` and
the floating `node:22-slim` base image.

## 2. Teardowns (real incidents, lessons for Clearline)

### Teardown A: GitLab.com database outage, 31 Jan 2017 (backups that were never restored)
Primary evidence opened: GitLab's own public infrastructure tracker, the follow-up issues filed on
1–2 Feb 2017 by the engineers involved [VERIFIED: GitLab API, project `gitlab-com/gl-infra/production-engineering`, accessed 31 Oct 2026]:
- #1102 "Automated testing of recovering PostgreSQL database backups"
  (https://gitlab.com/gitlab-com/gl-infra/production-engineering/-/work_items/1102): "Once a week a host
  is started automatically… grab the most recent database backup… check a few tables to see if there's
  data… If these tables don't have any data, or the restoring process failed, errors should be sent".
- #1095 "Prometheus monitoring for backups": backup alerts went by email that "isn't working due to
  DMARC not being set up" and "may go to an inbox one might not actively check"; alert when the backup
  is too small, too old, or failed.
- #1098 "Hourly LVM snapshots": daily snapshots "proven to be inadequate as a recovery technique".
- #1094 "Update PS1 across all hosts to more clearly differentiate between hosts and environments"
  (bold red for production): the human-factors fix for running a command on the wrong host.
- #1101 "Recover production replica(s)": there was one replica; aim for at least two.
The headline narrative (an engineer deleted the primary's data directory while working on
replication; about six hours of data lost; several backup methods found not working) comes from
GitLab's blog postmortem, which this session could not open
(https://about.gitlab.com/blog/2017/02/10/postmortem-of-database-outage-of-january-31/)
[ASSUMPTION: not opened this session].
**Lessons for Clearline:**
1. A backup that has never been restored is not a backup → the **restore drill** (`backups.md`) is the
   metric, not "snapshots exist".
2. Backup alerts must reach a place someone reads → the weekly report goes into the chief-of-staff
   briefing, not a separate inbox.
3. Make production unmistakable → devops-engineer's commands are read-only by construction, and any
   step touching a live host is a recommendation for Aashmiin, labelled PRODUCTION.
4. One copy on one machine is a single point of failure → Fly's own docs say the same about one volume.

### Teardown B: tj-actions/changed-files supply-chain compromise, 14–15 Mar 2025 (CVE-2025-30066)
Primary source: GitHub Advisory Database GHSA-mrrh-fwg8-r2c3
(https://github.com/advisories/GHSA-mrrh-fwg8-r2c3) [VERIFIED: github/advisory-database source JSON].
"Attackers retroactively modified multiple version tags to reference a malicious commit, exposing
CI/CD secrets in workflow logs"; the script read the Runner Worker's memory and printed secrets to
logs, "publicly accessible in repositories with public workflow logs"; "impacting over 23,000
repositories"; remedy: review runs, **revoke and rotate** exposed secrets, update references.
**Lessons for Clearline:**
1. Our repo is public, so Actions logs would be public too → the proposed CI workflow holds **no
   secrets at all** (tsc, vitest, build need none: the app runs keyless and DEMO_MODE defaults on).
2. **Pin every action to a full commit SHA**, not a tag (tags can be moved, which is exactly what
   happened). Same logic: pin `vercel@<version>` in `deploy.sh`.
3. `permissions: contents: read` at the top of every workflow.
4. If a secret might have leaked, the fix is rotation by the owner (Aashmiin), not deleting the log.

### Further reading (not opened; ask to allow the hosts)
- SRE book appendix D example postmortem ("Shakespeare Sonnet++"), https://sre.google/sre-book/example-postmortem/ [ASSUMPTION: not opened].
- Cloudflare 2 Jul 2019 outage (a WAF rule deployed globally at once), https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/ [ASSUMPTION: not opened]: the lesson usually drawn is staged rollout.

## 3. What "world-class" looks like at Clearline's size (our synthesis)
| Top-team practice | Clearline version (today) | Later (with a pilot) |
|---|---|---|
| SLOs + error budgets | internal: previews green, site 200, `main` green | real SLO for the pilot host, agreed with the customer only after measuring |
| Paging on-call | nightly 03:27 check + briefing; prod-down = `RISK:` top of briefing | external uptime monitor with SMS to her (paid, her approval) |
| CI gate on every PR | proposed workflow (`ci-recommendations.md`), her merge | required status check on protected `main` |
| Backups + tested restores | nothing persistent exists yet; drill designed | Fly volume + snapshots + encrypted off-host copy, monthly drill |
| Blameless postmortems | template + triggers ready | each incident, within 48 h |
| Change management | small PRs, never merge/promote | same; plus staged rollout |
