# Playbooks: devops-engineer

Times SGT. Scratch = a fresh dir in the session scratchpad, never the shared worktree. Log rows go to
Company HQ → Log (timestamp SGT, agent `devops-engineer`, action, ids, details with links). Every
playbook is **read-only on production**: no deploy, promote, rollback, env/secret or settings change
in Vercel, Fly or GitHub; those are written as recommendations for Aashmiin.

## Fixes from qualification (31 Oct)
- Before suggesting she deploy any branch, check its public copy against `team/CLAIMS_REVIEW.md` and `company/PRODUCT_FACTS.md` and name any false line (e.g. "Free during the pilot").
- Every tool or plan cost you mention needs a [VERIFIED] pricing page link with date, or it's [ASSUMPTION].
- Facts from your own pack (benchmark.md, deploy-state, drill records) keep their original label with who/date (company rule 2); never `[VERIFIED per pack]`. A drill or build you ran this session is `[VERIFIED: devops-engineer <date>, <command + exit code>]`.
- Before saying a fix PR is enough, check it merges cleanly into the failing branch (`git merge --no-commit --no-ff` in a scratch worktree) and list every active branch it covers.
- The nightly Log row names every green branch as well as the red ones.
- Never state something the inputs don't show (a probe result you didn't run, "reproduced" without the
  command and its exit code).
- When refusing an unsafe request, always give the safest working option in one line (e.g. "demo from
  main, which is green"), and keep it short.

## §0 Start of run (every playbook)
1. Read `company/COMPANY_RULES.md`, the definition, this file, the pack files the task needs.
2. Settings `PAUSE`; Gmail search `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d`.
   **PAUSE on → one Log row "stopped: PAUSE", nothing else.** hatch.sg Google account → stop, report.
3. `git fetch origin --prune`. Note the time (SGT and UTC) the check starts.

---

## §1 Nightly deploy check (03:27)
**Trigger:** scheduled task "Clearline devops nightly" (03:27), or "check the deploys".
**Inputs:** branch list, statuses, check-runs, open PRs, last night's Deploys Log row, roadmap `bug` rows.
**Steps:**
1. `gh api 'repos/trysarathy/investigation-desk/branches?per_page=100'` → name + sha. REST only.
2. For each: `gh api …/commits/<sha>` (committer date). **Active** = head commit in the last 7 days,
   plus `main` always.
3. For each active branch: `gh api …/commits/<sha>/status` and `…/check-runs`. Record state,
   `total_count`, context, `updated_at`, `dpl_…` id. **`pending` + `total_count 0` = "no status"**.
   A real `pending` older than 1 h = "stuck" (note it).
4. Compare with last night: new reds, fixed, still red (days red).
5. For each red: runbook §1 (known-PR check → local reproduction → classify). Max **3** local builds a
   night (time budget); the rest "not reproduced tonight (budget)". Same root cause on several
   branches: reproduce once, verify the others by tree inspection, say which is which.
6. Config cause and no open fix → fix PR (§2). App bug → roadmap `bug` row to crypto-protocol-engineer
   (§2 step 2). Finished branch (merged, no open PR) red → recommendation R4 (delete or disable deploys,
   her choice).
7. `main` red → §5 (RISK).
8. Probes M4–M6 (`monitoring-uptime.md`) if the network allows; else "probe: couldn't run (proxy 403)".
**Checks:** every state comes from an API call this run; every "fixed" has a build run this session;
no secret printed; counts add up (green + red + no status = active).
**Output:** one Log row + a 5-line block for the chief-of-staff briefing:
```
Deploys 31 Oct 03:27: 13/26 active green (main green). Red 8: website, website-books, … (cause: remotion type-check; fix PRs #32/#33 open, need merge).
New tonight: none. Fixed: none. Stuck: none. No status: 5 (gtm-os deploys off; 4 older: unknown).
Fix PRs opened: none. Bugs to engineering: none. Probe: couldn't run (proxy 403).
Needs you: merge #33, #32; decide delete/disable for website, website-books, brief-books, film-books.
```
**Log line:** `Deploys: 13/26 green; red: <list>; actions: <PRs/bugs>; evidence: <local build|API only>`.
**Stop:** PAUSE; a secret seen (runbook §5); budget hit (report what ran).

## §2 Build-failure fix PR
**Trigger:** §1 step 6 config cause, or a request.
1. Confirm no open PR fixes it (`pulls?state=open&base=<branch>`; also search titles for the error).
2. **Is it really config?** If the failing file is under `src/`, `tests/` or the error is in app logic
   (type error in our code, failing import we wrote, test failure) → it's an **app bug**: write the
   roadmap row (`bug`, owner crypto-protocol-engineer, file:line, log excerpt, branch, sha) and stop.
   Never: `ignoreBuildErrors`, `ignoreDuringBuilds`, `@ts-ignore`, excluding `src/` paths, deleting or
   skipping tests, `continue-on-error`. A red build that's an app bug stays red until engineering fixes it.
3. Branch `fix/deploy-<branch>-<YYYYMMDD>` from `origin/<branch>`. Minimal change, one cause.
4. Gate in scratch: `npm ci`, `npx tsc --noEmit`, `npx vitest run`, `npx next build` (and `website/`
   build if touched). Record exit codes and counts as printed.
5. PR into the failing branch; body: cause, before/after build lines, gate counts, "config only, no app
   behaviour change", risk, attribution lines. Never merge. Commit as Aashmiin Kaur per company rules.
6. Log `Deploys: fix PR #n into <branch> (<cause>)`; time red → PR in the metric.

## §3 Weekly uptime + backup report (PROPOSED: Sun 20:47; needs her approval to schedule)
1. From the week's Deploys Log rows: nights run (n/7), share of active branches green each night,
   `main` green nights, reds opened/closed, median time red → fix PR (hours).
2. Probes: "n of n nightly probes 200" per URL, or "not measured (reason)". Never an uptime %.
3. Backups: the honest line from `backups.md`; drill done y/n (date, RTO, RPO).
4. Drift (§4) one line. Open recommendations awaiting her (with cost).
5. ≤ 200 words, as a Log row + note for the chief-of-staff, so the Monday plan (08:44) and Monday's
   07:27 briefing pick it up (the Sunday 17:38 report runs before it and uses last week's). Log row.

## §4 Dependency / Node drift note (weekly, inside §3)
In scratch on `main`: `npm outdated --json`, `npm audit --omit=dev --json`; same in `website/` on
`pitch-deck`. Note Node: Dockerfile tag, `engines`/`.nvmrc` (none today), Vercel setting (unknown).
Output: 3–5 lines: majors behind, security advisories (prod vs dev), floating pins (`vercel@latest`,
`node:22-slim`). **Never upgrade automatically**; a bump is a separate small PR on request.

## §5 Incident first response (prod down / `main` red / site not answering)
1. Confirm twice from two signals (status API + probe or local build). Note first-seen time.
2. Log `RISK: <prod down|main red> — <what>, first seen <time>`; message chief-of-staff for the
   **top of the briefing** (and, if before 07:30, it leads the 07:27 briefing).
3. Gather evidence (read-only). Classify (runbook §1 step 4). **No production changes**: no
   promote, rollback, redeploy, env change, hotfix push to `main`.
4. Write the recommendation: rollback target (runbook §3) and/or fix PR / bug row, with risk.
5. Keep a timeline (for the postmortem). After recovery: §6.

## §6 Postmortem
**Triggers:** production down or degraded for anyone outside Clearline; any data loss; a secret
exposed; `main` red > 24 h; a monitoring gap that hid a failure. Template: `runbooks.md` §6.
Blameless, draft within 48 h, to Aashmiin via the approval queue; action items become roadmap rows or PRs.
