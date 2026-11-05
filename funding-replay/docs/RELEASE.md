# Release path — Clearline Funding Desk (mentor link)

**Synthetic prototype — no funds move.** One repeatable path from source to the permanent mentor link
https://clearline-funding-desk.vercel.app. Do not create a second Vercel project.

## Two repositories (kept separate on purpose)
| Role | Repository | Branch | Folder |
|---|---|---|---|
| **Source** (engine, UI, tests, docs) | `trysarathy/investigation-desk` | `provider-funding-lifecycle` | `funding-replay/` |
| **Deploy** (built static files only) | `trysarathy/clearline-funding-desk` | `main` (production) | repository root (flat; no `docs/`, no `vercel.json`, no build step) |

The Vercel project behind the mentor link is assumed to be connected to the deploy repository's `main`
with the root as the output directory (static, no framework). This could not be confirmed from the build
session (no Vercel dashboard or API access, and `vercel.app` was unreachable). **Check it once** in Vercel →
Project → Settings → Git (repository and production branch) and → Build & Development (root directory `./`,
no build command).

## Restore point
Production before the provider-lifecycle release: deploy repo `main` @ `774f739d4e8ed268b275a45904e47f184a8f8226`
("Initial commit": the Friday/Monday tester replay, 54 states).

Rollback (either):
- Vercel → Deployments → the deployment for `774f739` → **Promote to Production** (instant), or
- `git -C clearline-funding-desk revert --no-edit <release-commit> && git push origin main`.

## Release steps
```bash
# 1. Source checks (from investigation-desk/funding-replay)
python3 -m unittest discover -s tests            # engine + lifecycle + server
python3 tools/export_site.py /tmp/cfd-build      # BFS export; aborts if any state breaks an invariant
node tests/browser/lifecycle.cjs /tmp/cfd-build  # provider desk journey (file://)
node tests/browser/recipient.cjs /tmp/cfd-build/replay   # earlier replay, still shipped under /replay/

# 2. Preview locally over HTTP (same as a static host)
(cd /tmp/cfd-build && python3 -m http.server 8080)   # open http://127.0.0.1:8080

# 3. Publish (production path = push deploy repo main)
cd clearline-funding-desk
git rm -rq . && cp -R /tmp/cfd-build/. . && git add -A
git commit -m "Release provider funding lifecycle from investigation-desk@<source-sha>"
git push origin main
```

## Verify at the exact URL (signed-out / private window)
1. https://clearline-funding-desk.vercel.app opens with no login, shows "Simulated" labels.
2. Fresh case: Friday decision, three routes side by side, nothing hindsight.
3. Switch to the simulated reviewer, **Reserve capacity**; consequence text shown before approval.
4. Draw, instruct, provider accepts, credit → Wednesday: "Supplier credited; importer repayment outstanding".
5. Thursday: record the customer receipt (not repayment), then repayment, **Match repayment**, close.
6. **Reset** returns to the Friday state. `/replay/` still opens the earlier replay.
If any step fails, roll back (above) and record why.

## Release log
| Date | Source (investigation-desk) | Deploy commit (clearline-funding-desk main) | Vercel status on GitHub | Live check |
|---|---|---|---|---|
| 5 Nov 2026 | `5e2df82` | `5c61373` (previous `774f739`) | success, "Deployment has completed" (D6bmFaZbHmc1gRQR7iKfMNZN7176) | Not done from the build session (vercel.app blocked there); owner to check that `/build.txt` reads "Build 5e2df82" |

Confirmed on 5 Nov from GitHub commit statuses: the Vercel project `sarathyv2/clearline-funding-desk` deploys this repo's `main`.
