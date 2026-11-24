# Proposal: required checks on `main`

Status: **proposal only.** Nothing has been changed on GitHub. `main` has no branch protection today [VERIFIED: `GET /repos/trysarathy/investigation-desk/branches/main/protection` returned 404 "Branch not protected" on 24 Nov 2026].

## The five checks to require

| Check | Workflow file | What it runs |
|---|---|---|
| `lint` | `.github/workflows/ci.yml` | ESLint |
| `ci` | `.github/workflows/ci.yml` | Typecheck, unit tests and builds |
| `control-db` | `.github/workflows/ci.yml` | Control integration tests on a real PostgreSQL 16 |
| `control-e2e` | `.github/workflows/control-e2e.yml` | rc5 control browser journeys (desktop and phone) |
| `merchant-e2e` | `.github/workflows/merchant-e2e.yml` | Merchant and provider browser journeys (desktop and phone) |

**Why these five can be required [VERIFIED by reading the workflows]:** all five run on every pull request, with no `paths:` filter. A required check that never runs would block unrelated PRs, and none of these has that problem.

**Not proposed as required:**
- `clearline-browser` and `funding-browser`: these are path-filtered, so they do not run on every PR.
- `replay`.
- The Vercel preview.

## The funding-browser flake: fixed, not quarantined

- **The cause [VERIFIED]:** `FundingStore.load()` read the store file without taking the store's lock.
  - When a read overlapped a write, the reader opened the old file and the writer renamed the new one over it.
  - The private-file check then refused the replaced file as unsafe, and the API answered 500 ("Funding records or audit cannot be read").
  - This was caught in a local server log with a temporary diagnostic, which was not committed.
- **The fix:** `load()` now runs inside the same lock as every other read and write.
- **The test:** `tests/funding/store-concurrency.test.ts` checks that a load started during a write waits for it. It fails without the fix.
- **Local runs:** the exact counts before and after the fix are in the PR that adds this file.

## How the founder would apply this (not run by Claude)

Run this with an admin token, in a shell you control:

```bash
gh api -X PUT repos/trysarathy/investigation-desk/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -F "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=lint" \
  -f "required_status_checks[contexts][]=ci" \
  -f "required_status_checks[contexts][]=control-db" \
  -f "required_status_checks[contexts][]=control-e2e" \
  -f "required_status_checks[contexts][]=merchant-e2e" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions=null" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"
```

- **`enforce_admins=true`** applies the rules to admins too.
- **The review requirement** (one approving review) is a suggestion; drop that line if you merge alone.
