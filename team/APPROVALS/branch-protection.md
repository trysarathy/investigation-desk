# Approval: branch protection on `main` (trysarathy/investigation-desk)

Prepared by devops-engineer, 2026-10-31 (SGT). Status: **NOT applied**. The API call
`gh api -X PUT repos/trysarathy/investigation-desk/branches/main/protection` was refused by this
session's GitHub proxy ("Write access to this GitHub API path is not permitted through this proxy",
HTTP 403). Read-back now: `GET .../branches/main` -> `"protected": false`
[VERIFIED: devops-engineer 2026-10-31, gh api GET].

## Before you start
- The `ci` check already exists: it ran on PR #42 (ci/github-actions), run
  https://github.com/trysarathy/investigation-desk/actions/runs/41231715977 -> job `ci` success,
  job `lint` failure (5 known lint errors in app code; `lint` is deliberately not required).
  GitHub only offers a check in the picker after it has reported once in the last 7 days.
- Recommended order: merge #42 first (it is green on `ci`), then add the rule. If you add the rule
  first, #42 can still merge because it reports `ci`.

## Click by click (classic rule, about 2 minutes)
1. Open https://github.com/trysarathy/investigation-desk/settings/branches (signed in as aashmiin).
2. Click **Add classic branch protection rule** (if you only see "Add branch ruleset", use the
   dropdown next to it for the classic rule).
3. **Branch name pattern**: `main`
4. Tick **Require a pull request before merging**.
   - **Required approvals**: set to **0** (all agents and you share one account, and GitHub does
     not let an account approve its own PR; agent reviews stay as PR comments/labels).
   - Tick **Dismiss stale pull request approvals when new commits are pushed**.
   - Leave "Require review from Code Owners", "Require approval of the most recent reviewable
     push" unticked.
5. Tick **Require status checks to pass before merging**.
   - Tick **Require branches to be up to date before merging** (this is `strict: true`).
   - In the search box type `ci` and pick **ci** (source GitHub Actions). Do NOT add `lint` or
     `Vercel` yet.
6. Leave unticked: Require conversation resolution, Require signed commits, Require linear
   history, Require deployments, Lock branch.
7. Leave **Do not allow bypassing the above settings** UNticked (this is `enforce_admins: false`:
   you, as admin, can still merge in an emergency).
8. Leave **Restrict who can push** unticked (`restrictions: null`).
9. Under "Rules applied to everyone including administrators": leave **Allow force pushes** and
   **Allow deletions** UNticked.
10. Click **Create**.

## Equivalent API call (if run from a session allowed to write settings)
```
gh api -X PUT repos/trysarathy/investigation-desk/branches/main/protection --input - <<'JSON'
{"required_status_checks":{"strict":true,"contexts":["ci"]},"enforce_admins":false,
 "required_pull_request_reviews":{"required_approving_review_count":0,"dismiss_stale_reviews":true},
 "restrictions":null,"allow_force_pushes":false,"allow_deletions":false,
 "required_linear_history":false,"required_conversation_resolution":false}
JSON
gh api repos/trysarathy/investigation-desk/branches/main/protection   # read back
```

## What it means
- Every change to `main` goes through a PR whose `ci` job (tsc, vitest, next build) is green and
  whose branch is up to date with `main`. No force-push or deletion of `main`.
- **Limit, be clear about it:** `enforce_admins: false` means the admin account can bypass. All
  agents use your account, so this rule does not technically stop an agent from pushing to `main`;
  the company rule ("never push to main") still does that. Set `enforce_admins: true` later if you
  want GitHub to enforce it for everyone, at the cost of no emergency bypass.

## Effect on open PRs into `main` (as of 2026-10-31: #10, #20, #35, #39, #43)
- Their branches do not contain `.github/workflows/ci.yml`, and until #42 merges `main` does not
  either, so no `ci` check runs on them: GitHub shows "ci: Expected - waiting for status to be
  reported" and **blocks the merge** (except your admin bypass).
- After #42 merges: for `pull_request` events GitHub runs the workflow from the PR's merge commit,
  which then includes `ci.yml`. Each open PR needs one new push or an **Update branch** click
  (needed anyway because of "up to date") to get a `ci` result. If `ci` is red, it is a real
  tsc/test/build failure on that branch.
- PRs into other branches (#21, #28, #29, #30, #31, #36, #37, #40, #41) are not affected: the rule
  is on `main` only. #32 and #33 are no longer open.
- If you say no: nothing changes; `main` stays unprotected and the `ci` check stays advisory.
