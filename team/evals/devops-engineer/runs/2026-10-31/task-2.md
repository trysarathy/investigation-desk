# Task 2: Fix the red `website-fixes` preview

**State: website-fixes @ c44edde is red (Vercel `failure`, 28 Oct 15:49:08 UTC, `dpl_E6qNXEfecJC7txW93Uhd4WeYXM2u`).
Cause reproduced locally: the root type-check pulls in `demo/video/remotion/` (TS2307 `remotion`). One-line
`tsconfig.json` exclude makes tsc, vitest and next build green. Fix PR prepared; not pushed (live tools off).**

Run 31 Oct 2026, 14:28–14:31 SGT (06:28–06:31 UTC). Node v22.22.0, npm 10.9.4. Scratch worktree
`/tmp/claude-0/devops-eval` (detached at c44eddeed2455caad697cd536c535d101b030733), removed afterwards.

## 1. Confirm from the API (REST, this run)
```
gh api repos/trysarathy/investigation-desk/commits/c44eddeed245…/status
→ failure | 1 | Vercel=failure@2026-10-28T15:49:08Z "Deployment has failed — … npx vercel inspect dpl_E6qNXEfecJC7txW93Uhd4WeYXM2u --logs"
gh api repos/trysarathy/investigation-desk/branches/website-fixes → head c44eddeed245… (unchanged)
gh api 'repos/trysarathy/investigation-desk/pulls?state=open&base=website-fixes' → [] (no PR targets website-fixes)
```
Open PRs checked (all 11): #33 (fix/preview-build → pitch-deck) and #32 (→ demo-video) carry the same fix but
don't reach website-fixes; #28 is website-fixes' own PR into pitch-deck. **No duplicate.** [VERIFIED: gh api, 31 Oct 14:29 SGT]

## 2. Reproduce (before)
```
npm ci            → exit 0 (added 127 packages)
npx next build    → exit 1
  ./demo/video/remotion/src/LiveDemo.tsx:7:141
  Type error: Cannot find module 'remotion' or its corresponding type declarations.
  Next.js build worker exited with code: 1 and signal: null
```
Why: root `tsconfig.json` `include` is `**/*.ts(x)` and `exclude` is `["node_modules","website"]`. The branch
contains `demo/video/remotion/` (9 files, own `package.json`; `remotion` is installed only there), so the app's
type-check sees it. Evidence = local build (no Vercel token held, so Vercel's own log was not read); the error
matches the known pattern on all 8 red branches (`deploy-state-2026-10-31.md`).
Classification: **config** (a sub-project pulled into the root build), not an app bug: the failing file is
film source, not `src/`, and no app code is excluded or silenced.

## 3. Change (exact diff)
```diff
diff --git a/tsconfig.json b/tsconfig.json
index bb4b2d9..ba7fba2 100644
--- a/tsconfig.json
+++ b/tsconfig.json
@@ -17,5 +17,5 @@
     "paths": { "@/*": ["./src/*"] }
   },
   "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
-  "exclude": ["node_modules", "website"]
+  "exclude": ["node_modules", "website", "demo/video/remotion"]
 }
```
Identical to the line PR #33 adds on pitch-deck (`git diff c44edde origin/fix/preview-build -- tsconfig.json`
shows only this line), so when #28 and #33 both land in pitch-deck the hunks are the same and should not conflict.

## 4. Gate (after), this session
```
npx tsc --noEmit  → exit 0
npx vitest run    → exit 0   Test Files 19 passed | 1 skipped (20); Tests 539 passed | 57 skipped (596)
npx next build    → exit 0   ✓ Compiled successfully; ✓ Generating static pages (16/16)
website/: npm ci → exit 0; npx next build → exit 0 (out/ has index.html, demo/, 404.html)  [not touched; checked because the branch changes website/]
```

## 5. WOULD OPEN PR:
- **Branch:** `fix/deploy-website-fixes-20261031` from `origin/website-fixes` @ c44edde
- **Base:** `website-fixes` (the failing branch; not pitch-deck, not main)
- **Commit** (author `Aashmiin Kaur <aashmiin@gmail.com>`):
  ```
  Fix website-fixes preview build: exclude the Remotion film from the app type-check

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j
  ```
- **Title:** `Fix website-fixes preview build: exclude demo/video/remotion from the root type-check`
- **Body:**
  ```
  ## Why
  The Vercel preview for website-fixes (c44edde) has failed since 28 Oct 15:49 UTC
  (dpl_E6qNXEfecJC7txW93Uhd4WeYXM2u). The root tsconfig type-checks every .ts/.tsx in the repo, including
  the Remotion film project in demo/video/remotion/, whose `remotion` dependency is installed only inside
  that folder.

  ## Before (local, Node 22.22.0)
  npx next build → exit 1
  ./demo/video/remotion/src/LiveDemo.tsx:7:141 Type error: Cannot find module 'remotion' …

  ## Change
  tsconfig.json: add "demo/video/remotion" to "exclude" (1 line). Same change as #33 (pitch-deck) and #32
  (demo-video), applied here so this branch doesn't wait on that chain.

  ## After (this branch, local)
  npx tsc --noEmit → exit 0
  npx vitest run → 19 files passed, 1 skipped; 539 tests passed, 57 skipped
  npx next build → exit 0

  Config only, no app behaviour change: no file under src/ or tests/ is excluded or edited; the film
  project keeps its own tsconfig and build.
  Risk: low. If the film source is ever imported by the app, the type-check will no longer cover it.
  Merge: Aashmiin's decision. devops-engineer does not merge.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j
  ```

## 6. Reply to the chief-of-staff
"website-fixes red cause found and reproduced (remotion type-check, same as #33). Fix PR
`fix/deploy-website-fixes-20261031` → website-fixes is ready: 1 line, tsc/vitest/build green locally. It
needs Aashmiin's merge; the preview goes green only after Vercel rebuilds on merge (I'll confirm at the next
nightly check, not before).
**One thing to check before Monday:** the Vercel preview of website-fixes is the **product app** (project
`investigation-desk`, root build), not the marketing site. This branch only changes files under `website/`
(10 files), which go live only through `website/deploy.sh` to `clearline-site`. So the preview link will show
the app, not her website changes. If she wants the mentor to see the new website, that's a `deploy.sh` run
(production, her machine, her token) or a local `cd website && npx next build` she screenshares."

## WOULD WRITE: Log row
`2026-10-31 14:31 SGT | devops-engineer | Deploys: fix PR into website-fixes (remotion type-check) | c44edde, dpl_E6qNXEfecJC7txW93Uhd4WeYXM2u, branch fix/deploy-website-fixes-20261031 | before: next build exit 1 (TS2307 remotion); after: tsc 0, vitest 539 passed/57 skipped, build 0; evidence: local build; PR not opened (live tools off); red → PR ready 62 h 42 min`

(Time red → fix PR ready: 28 Oct 15:49 UTC → 31 Oct 06:31 UTC = **62 h 42 min**; target < 24 h missed. The
metric counts to the PR's `created_at`, which doesn't exist until it's opened.)
