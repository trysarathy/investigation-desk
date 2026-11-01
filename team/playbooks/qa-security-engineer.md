# Playbooks: qa-security-engineer

Every playbook starts with **§0 Start of run**. Times SGT. "Scratch" = a fresh directory in the
session's scratchpad, never the shared worktree. Log rows go to the Company HQ Log tab
(timestamp SGT, agent `qa-security-engineer`, action, ids, details with links).

## §0 Start of run (every playbook)
1. Read `company/COMPANY_RULES.md`, the definition, this file, and the pack files the task needs.
2. Read Settings `PAUSE`; Gmail search `from:aashmiin@gmail.com to:aashmiin@gmail.com subject:Clearline newer_than:3d`
   for a PAUSE reply. **PAUSE on → one Log row "stopped: PAUSE", nothing else.**
3. If the Google connection is a hatch.sg account: stop, change nothing, report it.
4. `git fetch origin --prune`; note the SHA of every branch you will touch.

---

## §1 Nightly QA run
**Trigger**: 22:53 SGT scheduled task "Clearline nightly product QA", or "run QA on X".
**Inputs**: `main`; open PRs (`gh api repos/trysarathy/investigation-desk/pulls?state=open`) whose head
commit changed in the last 24 h, newest first, max 4; Product roadmap `bug` rows; last night's email.

**Steps** (main first, then each PR branch):
1. Export: `git archive origin/<branch> | tar -x -C $S/<branch>-<YYYYMMDD>`; `npm ci --no-audit --no-fund`.
   `npm ci` failing = red (lockfile out of step), stop that branch.
2. `npx tsc --noEmit` → record exit code and error count.
3. `npx vitest run` **three times**, each to its own log; then once with
   `--reporter=json --outputFile=vitest.json` for per-file counts. Record files passed/failed/skipped,
   tests passed/failed/skipped, duration, for each run. Different results across runs = **flaky** (§2).
4. `npx next build` → exit code; note new warnings.
5. e2e: if `package.json` has `qa`, `npm run qa` (it builds, starts live and demo servers on a temp
   data dir, runs `tests/e2e/qa_flows.mjs` at 1280x800 and 390x844; `QA_SKIP_BUILD=1` reuses step 4).
   Else run `tests/e2e/demo_cases.py` against `npx next start` on a temp `DESK_DATA_DIR` if Python
   Playwright is installed. Else the manual demo flow (`test-map.md` §1). If none can run: **e2e =
   not run (reason)**. Record checks passed/total, console errors, phone overflow.
6. Security diff check on PR branches (`git diff origin/main...origin/<branch>`): secret patterns
   (`secrets-and-supply-chain.md` §1a on the diff), new/changed routes (guard? validation? size limit?
   demo-mode check?), new `fetch(` with a non-constant URL (SSRF), CSV/export writers not using
   `csvCell`, `dangerouslySetInnerHTML`, logging of request bodies/IPs/names, `package.json` changes
   (dependency checklist, `secrets-and-supply-chain.md` §2). Findings → email "Security" section; high/critical → Risks row.
7. Failures → §2, then §3 if fixable.
8. Stop and clean: kill servers you started (`QA_PORT` default 3400), delete scratch data dirs.

**Checks before reporting**: every number in the email appears in a log file from this session; a
branch with any step not run is PARTIAL, not GREEN; skipped tests are reported as skipped.
**Output**: email (§7); roadmap `bug` rows; Log rows.
**Log lines**: `nightly QA <branch>@<sha>: tsc ok, vitest 3/3 562 pass 57 skip, build ok, e2e 113/113` ·
`qa-fix PR #<n> into <branch>` · `bug filed: <title> (<link>)`.
**Stop conditions**: PAUSE; a secret found (stop that task: `secrets-and-supply-chain.md` "When you find one"); disk/time budget
exceeded (report what ran); `main` red → still test PR branches but say "main red" first.

## §2 Triaging a red build: flaky vs environment vs real
**Trigger**: any non-zero exit or differing runs in §1.
1. Collect: failing test name(s), file:line, assertion diff, which of the 3 runs failed, durations.
2. **Same test fails 3/3 with the same assertion** → real until proven otherwise. Re-run that file
   alone (`npx vitest run tests/<file> -t "<name>"`) to confirm; read the diff since the last green
   SHA (`git log --oneline <green>..<sha> -- <paths under test>`), find the change that broke it.
3. **Fails 1–2 of 3, or only in the full run** → flaky candidate. Run the file 10 times
   (`for i in $(seq 10); do npx vitest run tests/<file> > f-$i.log 2>&1; echo $?; done`). Look for:
   wall-clock budgets (e.g. `qa-fixes.test.ts` "5,000 rows … in under 10 s"), `Date.now()`/timezone,
   random IDs, shared temp dirs or globals between files (`globalThis` caches in `audit.ts`), port
   clashes, ordering of `Object.values`, network. Report "flaky: n of 10 failed, cause <x> [VERIFIED]
   or suspected <x> [ASSUMPTION]". **Never** add `retry` (vitest has `--retry` and a `retry` config
   [VERIFIED, vitest docs]) or `.skip` to make it pass; propose a deterministic fix.
4. **Environment** (npm registry down, Playwright browser missing, port in use, disk full): say so,
   mark that step "not run (environment)", never "pass".
5. Severity: money-affecting (counting, marking paid, posting, attribution) or security → **High**,
   top of the email; UI/layout → Medium; wording → Low.
**Output**: one triage line per failure in the email: `<test>`: real|flaky|environment — evidence —
cause — next action (fix PR / bug row / owner).

## §3 Writing a qa-fix PR
**Trigger**: a real failure whose fix is small (≈ 50 lines or fewer incl. test) and safe.
**Not for**: anything touching posting rules, attribution, auth, data deletion or a product decision
→ write a bug instead (crypto-protocol-engineer owns it).
1. Branch from the failing branch's SHA: `qa-fix/<branch>-<YYYYMMDD>` (e.g. `qa-fix/main-20261029`).
2. **Test first**: add/adjust a test that fails on the current code for the right reason; run it,
   save the failing output.
3. Smallest fix; no refactors, no unrelated formatting, no weakening of any assertion.
4. Full gate on the fix branch: `npx tsc --noEmit`, `npx vitest run` ×3, `npx next build`, e2e if the
   UI changed. All green or no PR.
5. Commit as `Aashmiin Kaur <aashmiin@gmail.com>`, message `qa-fix: <what> (<test name>)`, ending with
   the `Co-Authored-By` and session lines from the company rules. Never commit `.data/`, `.next/`,
   `.env*`, build output.
6. PR into the failing branch (into `main` only if `main` itself is red). Body: failing test before
   (output excerpt), cause, fix, gate results with counts, risk, "Not merged: Aashmiin merges".
7. Roadmap row status `bug` with the PR link; Log row.
**Stop**: fix grows past ~50 lines, or touches a never-do area → abandon the branch locally, write the
bug with the failing test attached as a patch.

## §4 Weekly security review (Sundays 21:47 SGT, proposed — run only once approved)
**Inputs**: `main` SHA; open PRs; last week's review; Risks rows tagged `security`.
1. Secrets: `secrets-and-supply-chain.md` §1a–1d on `main` and every branch, full-history `-G` pass.
2. Dependencies: `npm audit --omit=dev` and `npm audit` in a scratch `main`; diff against last week;
   `npm audit signatures`; any new advisory → read the advisory page, judge exposure in our code.
3. Routes: regenerate the route inventory (`find src/app/api -name route.ts`) and compare with
   `owasp.md`; every new route checked for guard, validation, limit, test.
4. OWASP walk: go down `owasp.md` tables; re-test each gap still open (probe in scratch, e.g. POST
   `/api/demo/reset` on a live-mode scratch server; `curl -I` for headers); update status.
5. Edge cases: one gap from `edge-case-catalogue.md` turned into a test PR (§3 rules) or a bug.
6. Properties: once fast-check is in, run all properties with `numRuns: 10000`.
7. Claims: §5 against anything that changed this week.
8. Update the pack files you touched; re-date them.
**Output**: "Security review <date>" section in Sunday's product health email: new / fixed / still
open by severity, each with file:line and the fix; Risks rows; Log row.
**Stop**: a secret or an actively exploitable issue on a deployed instance → `RISK:` row and email at
once; don't wait for the full review.

## §5 Claims-audit check
**Trigger**: a commit on `website*`, `whitepaper`, `pitch-deck`, `brief*`, `demo-video`,
`enterprise-pack`, the GTM repo's offer/call script; or a change to a file a "yes" claim cites.
1. Pin commits (copy and code). 2. Extract claims (quote + file:line). 3. Verify each against code/
tests/run logs at the pinned commit (`security-pack-and-claims.md` method). 4. Verdict: yes /
delivered with our team / roadmap / FALSE / unverified / illustrative. 5. For each FALSE: the true
replacement sentence. 6. Diff vs the last audit.
**Output**: a "Claims" section in the email (FALSE first) and a Log row per FALSE claim, handed to the
copy owner. You do not edit the copy.
**Stop**: a claim names a customer, logo, number of users or certification → FALSE unless Aashmiin's
written confirmation exists; flag at the top.

## §6 Release sign-off checklist (Aashmiin asks "can I merge/ship X?")
Answer with this list, each item ✔ (seen this session, with the number) / ✘ / not checked:
1. Branch SHA and base; diff size; PR description matches the diff.
2. `npm ci` clean; tsc 0 errors; vitest ×3 identical, counts; next build ok.
3. e2e: `npm run qa` (or the documented fallback) at desktop and phone; console errors 0.
4. Money paths: if the diff touches `requests/`, `accounting/`, `engine/`, `chain/`: the related
   edge cases in the catalogue still have passing tests; any new behaviour has a test.
5. Security diff check (§1 step 6) clean or findings accepted by Aashmiin in writing.
6. Secrets scan on the diff and new commits: clean.
7. `npm audit` no new high/critical in prod deps.
8. Claims: anything this release lets us say, or stops us saying, is reflected in the claims audit.
9. Demo still loads from a fresh data dir; reset keeps non-demo records.
10. Rollback: the previous green SHA.
**Verdict wording**: "Ready to merge, in my view: all 10 checked" / "Not ready: items n, m" /
"Can't say: items n not checked because …". Merging stays Aashmiin's click.

## §7 The product health email
**To**: aashmiin@gmail.com only. **Subject**: `Clearline product health <YYYY-MM-DD>` (date of the run, SGT).
**Format** (plain text, under 400 words unless something is red):
```
GREEN | RED | PARTIAL — main <sha7>: <one line why>
(RED/RISK items first, one line each, with links)

Branches
- main <sha7>: tsc ok · vitest 3/3 identical 562 passed 57 skipped (20 files + 1 skipped) · build ok · e2e 113/113 (npm run qa) | not run (reason)
- PR #<n> <branch> <sha7>: …
Flaky: <test> n of 3 (cause / suspected cause) | none seen
Bugs: found <n> (links) · fixed <n> (qa-fix PR links) · still open <n>
Security: new <n> (sev, file:line, one line) · open by severity C/H/M/L · npm audit prod <n>, all <n>
Claims: FALSE <n> (where) | unchanged since <date>
Merge first: PR #<n> because <reason> | nothing ready
Couldn't check: <item — reason>
Metrics: main green n/7 this week · escaped defects this month n · open security issues C/H/M/L
```
**Rules**: GREEN only if every step ran and passed on `main` this session. PARTIAL if anything was
not run. Counts copied from logs. No secrets, no customer data, no full stack traces (link the log
location instead). Same email whether the news is good or bad.
**Log line**: `product health email sent: <GREEN|RED|PARTIAL>, branches <n>, bugs <n>`.

## Sources
- vitest `retry` option: https://github.com/vitest-dev/vitest/blob/main/docs/config/retry.md (accessed 2026-10-29) [VERIFIED]
- Script behaviour (`npm run qa`, `qa_flows.mjs`): `origin/qa-polish:scripts/qa.mjs`, `tests/e2e/qa_flows.mjs` (read and run 29 Oct) [VERIFIED]
