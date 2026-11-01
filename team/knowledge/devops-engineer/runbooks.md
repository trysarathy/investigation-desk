# Runbooks

Every runbook is **read-only on production**. Anything that changes a live deployment, a setting, an
env var or a secret is written as a **recommendation for Aashmiin** with the exact click path or
command, labelled `PRODUCTION — her action`. Scratch = a fresh dir in the session scratchpad.

## §1 Failed preview build (Vercel status `failure` on a non-`main` branch)
1. Confirm from the API, not memory: `gh api repos/trysarathy/investigation-desk/commits/<sha>/status`.
   Record context, state, `updated_at`, the `dpl_…` id from the description.
2. Is it already known? Search open PRs into that branch (`gh api 'repos/…/pulls?state=open&base=<branch>'`)
   and the last Deploys Log row. If an open PR already fixes it → recommend merging it; stop.
3. Reproduce locally: `git archive origin/<branch> | tar -x -C $S/<branch>-<sha7>`; `npm ci`;
   `npx next build` (root app, which is what Vercel builds). Save `build-before.log`. Vercel's own logs
   need a token we don't hold: say "evidence = local build".
4. Classify the cause (this decides who fixes it):
   - **Config** (tsconfig include/exclude, next.config, lockfile out of step, Node version, a
     sub-project pulled into the root build, `vercel.json`) → devops-engineer fixes (§1a).
   - **App bug** (a type error or failing import in `src/`, a test the build runs, a real runtime
     error) → **not ours.** Roadmap row `bug` → crypto-protocol-engineer, with the file:line and the log
     excerpt. Never exclude `src/` files, add `// @ts-ignore`, set `typescript.ignoreBuildErrors` or
     `eslint.ignoreDuringBuilds` to make it green. That hides a defect.
   - **Environment** (registry down, Vercel incident, out of memory): note it, re-check next night.
   - **Can't reproduce locally** (local green, Vercel red): say so; likely Node version or env var
     difference; recommend Aashmiin opens the Vercel log (`npx vercel inspect <dpl> --logs`), list
     what to look for.
5. Known pattern (28–31 Oct): `TS2307 Cannot find module 'remotion'` from `demo/video/remotion/` →
   add `"demo/video/remotion"` to root `tsconfig.json` `exclude` (as PR #32/#33). Same pattern for
   `website/` (already excluded on `website`-family branches).

### §1a Config fix PR
- Branch `fix/deploy-<branch>-<YYYYMMDD>` from `origin/<branch>`; one cause, one PR, < 20 lines usually.
- Gate: `npx tsc --noEmit`, `npx vitest run`, `npx next build` all green **in this session**; put the
  before/after build lines in the PR body. PR into the failing branch, never `main` unless `main` is red.
- PR body ends with the attribution lines from the session; commit as Aashmiin Kaur per company rules.
- Never merge. Log `Deploys: <branch> red → fix PR #n`.

## §2 Failed production build (`main` red, or the live site/app down)
1. **This is a RISK.** First action: Log row `RISK: main deploy red <sha>` (or `RISK: prod down`), and
   a line for the top of the 07:30 briefing via chief-of-staff.
2. Reproduce locally exactly as §1 on `origin/main`. Classify (config / app bug / environment).
3. What is serving users now? If Vercel keeps the previous production deployment live after a failed
   build [ASSUMPTION: Vercel docs not opened; confirm in the dashboard], nothing is down; say so.
4. Fix path: config → fix PR into `main` (still her merge). App bug → roadmap `bug`, owner
   crypto-protocol-engineer, flagged urgent. **No hotfix pushed to `main`, no force-push, ever.**
5. Rollback recommendation if users see breakage: §3.

## §3 Rollback (RECOMMEND ONLY)
devops-engineer never promotes, rolls back or redeploys production. It writes this for Aashmiin:
- **Vercel (product or site):** dashboard → project → Deployments → the last known-good deployment
  (give its `dpl_…` id and commit sha) → "Promote to Production" / Instant Rollback; or
  `npx vercel rollback <dpl-url>` / `npx vercel promote <dpl-url>` with her token [VERIFIED: commands
  exist in vercel/vercel CLI source; flags not re-checked].
- **Marketing site (`clearline-site`):** check out the last good commit and run `bash website/deploy.sh`
  (it deploys `--prod`). Her machine, her token.
- **Fly preview:** `fly releases` then `fly deploy --image <previous image ref>` [ASSUMPTION: flyctl
  docs not opened for this flag]. Her action.
- State: what is broken, the good target (id, sha, date), expected effect, risk (data written since
  the good release), how to verify after (URL + expected status).

## §4 Data-dir / volume backup and restore drill (design)
See `backups.md` for what exists. Drill outline (run first on a scratch copy, never on a live host):
1. **Seed**: `DESK_DATA_DIR=$S/drill/live npx next start` on a scratch export; load the demo day
   (FICTIONAL data only), create one request; record file list + sha256 of every file except
   `xero-tokens.json` (must not exist in a drill: no Xero connection).
2. **Back up**: stop the server (consistent copy: files are JSON written by the app, no DB), `tar -czf
   backup-<date>.tgz -C $S/drill live`; record size and sha256.
3. **Lose it**: delete `$S/drill/live`.
4. **Restore**: untar into `$S/drill/restored`; start the app with `DESK_DATA_DIR=$S/drill/restored`.
5. **Verify**: file hashes match; the app lists the same requests (HTTP 200 on `/requests`, same count);
   time the restore (RTO) and note the age of the backup (RPO).
6. Record: `Backup drill: done <date>, RTO <m:ss>, RPO <age>, files n/n match`. Metric "restore drill
   done" = yes only after step 5 passed this session.
For a real Fly volume the same drill uses `fly volumes snapshots create` and `fly volumes create
--snapshot-id` into a **new** volume on a **staging** app: her commands, her approval.

## §5 Secret seen where it shouldn't be
Stop that task. Don't copy, echo, test or "use once" the value. Describe as `<type> at <location>`,
`REDACTED`. Log `RISK: secret exposed — <type>, <location>`. Recommend: she rotates it at the provider
(link to the provider's token page), then the reference is removed; history rewrite only if she
decides. Hand to qa-security-engineer for the scan of tree + history.

## §6 Postmortem template (blameless; within 48 h of any trigger in playbook §6)
```
# Postmortem: <title>  (status: draft for Aashmiin)
Date / duration (SGT): <start> – <end>, <minutes>
Severity: <prod down | prod degraded | data at risk | preview only>
Authors: devops-engineer (+ who else)    Reviewed by: Aashmiin
## Summary (3 lines: what users saw, why, what fixed it)
## Impact (who/what was affected; customers: 0 today — say so; data lost: yes/no, how much)
## Timeline (SGT, each line: time — event — source/evidence link)
## Root cause(s) (technical, contributing; no names as causes)
## Detection (how we found out; how long after it started; did monitoring catch it?)
## Response and recovery (what was done, by whom, what was only recommended)
## What went well / what went badly / where we got lucky
## Action items (each: action, type prevent|detect|mitigate, owner, due, PR/roadmap link)
## Evidence (logs, commands run, status JSON — secrets REDACTED)
```
