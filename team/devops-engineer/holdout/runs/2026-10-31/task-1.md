# Task 1: Red previews across a stack of branches

**State (gh api REST, 31 Oct 2026 14:34 SGT / 06:34 UTC):** 4 of 7 branches in the fixture red, `main` green. All 4 reds are **Vercel project `investigation-desk` (the product app preview)**, not the marketing site. One cause: the root `tsconfig.json` type-checks the Remotion film source. Fix PR #33 already exists and is green. **I am not opening a new PR tonight.** The plan is for you to merge #33, then update #28 from `pitch-deck`.

PAUSE / Gmail check: live tools are OFF for this test, so I couldn't read Settings PAUSE or run the Gmail search. On the job I would do that first.

## 1. Which deploy the red status belongs to
| Branch | Head | Status (context `Vercel`) | updated_at (UTC) | target_url project | Deployment |
|---|---|---|---|---|---|
| main | 8decb27 | success | 31 Oct 04:38:46 | sarathyv2/investigation-desk | — |
| qa-polish | 12abf33 | success | 28 Oct 18:14:25 | investigation-desk | — |
| xero-scopes | da07676 | success | 29 Oct 06:11:48 | investigation-desk | — |
| demo-video | c049bd4 | **failure** | 28 Oct 15:29:09 | investigation-desk | `dpl_Davf4zgb3ykLwjKKv1Ec9yg5kEV5` |
| pitch-deck | ad15acb | **failure** | 28 Oct 15:28:31 | investigation-desk | `dpl_91n1GEEnENvnUHUTbBzw3sJDhe2M` |
| website-fixes | c44edde | **failure** | 28 Oct 15:49:08 | investigation-desk | `dpl_E6qNXEfecJC7txW93Uhd4WeYXM2u` |
| brief-fixes | d179188 | **failure** | 28 Oct 15:51:01 | investigation-desk | `dpl_48st4bL3Zx2VBkgSPvUVTye7F1vY` |

Every status has `total_count 1` and the `Vercel Preview Comments` check-run reads completed/success. That check-run only posts the comment and says nothing about the build. [VERIFIED: `gh api repos/trysarathy/investigation-desk/commits/<sha>/status` and `/check-runs`, this run]

**The website itself isn't red.** `clearline-site` has no Git connection and goes live only through `bash website/deploy.sh` (`website/README.md`, "no Git connection, so nothing goes live by accident"). The red X on PR #28 is the **root app preview** for that branch. I built the marketing site locally at c44edde: `cd website && npm ci && npx next build` gave **exit 0**, with static routes `/`, `/demo`, `/privacy`, robots and sitemap. [VERIFIED: local build this session]

## 2. Root cause (local reproduction, evidence = local build; I hold no Vercel token, so I couldn't open Vercel's own log)
Scratch worktree of `origin/website-fixes` @ c44edde, Node v22.22.0, npm 10.9.4. `npm ci` gave exit 0 (127 packages).
- **Before:** `npx next build` **exit 1**:
  `./demo/video/remotion/src/LiveDemo.tsx:7:141 Type error: Cannot find module 'remotion' or its corresponding type declarations.`
  `npx tsc --noEmit` exit 2, with 4 errors, **all TS2307 under `demo/video/remotion/src/`** (LiveDemo.tsx:7, Root.tsx:2, Story.tsx:7, index.ts:1). None are in `src/`, so this is **config, not an app bug**.
- **Why:** root `tsconfig.json` `include` is `**/*.ts(x)` and `exclude` is `["node_modules", "website"]`. The film project's own dependency `remotion` is installed only inside `demo/video/remotion/`, so the root type-check can't resolve it.
- **Tree inspection (`git ls-tree`, `git show <ref>:tsconfig.json`):**

| Branch | remotion files | exclude has `demo/video/remotion`? | Vercel |
|---|---|---|---|
| main | 0 | no (not needed) | green |
| demo-video | 7 | no | red |
| pitch-deck, website-fixes, brief-fixes | 9 | no | red |
| fix/preview-build (PR #33 → pitch-deck) | 9 | **yes** | green (29 Oct 01:47 UTC) |
| qa-fix/demo-video-2026-10-28 (PR #32 → demo-video) | 7 | **yes** | green (28 Oct 18:28 UTC) |

- **After:** I merged `origin/fix/preview-build` (PR #33) into the scratch copy of website-fixes. It merged with no conflicts and changed only `tsconfig.json` (1 line). Results: `tsc --noEmit` **exit 0**; `vitest run` **exit 0, 19 files passed / 1 skipped, 539 tests passed / 57 skipped**; `next build` **exit 0** (16 static pages). Neither website-fixes nor brief-fixes touches `tsconfig.json` (`git diff pitch-deck..<branch>`), so the fix carries through with a plain merge.
- I didn't build brief-fixes and demo-video locally. They are verified by tree inspection only (same tsconfig, same folder). Vercel already shows green for the fixed versions of both stacks.

## 3. The plan (no new PR: the fix exists, and a duplicate would be noise)
Stack: `website-fixes (#28)` and `brief-fixes (#29)` → `pitch-deck (#21)` → `demo-video (#20)` → `main`.

Your approvals, in order:
1. **Merge PR #33** (`fix/preview-build` → `pitch-deck`): one line in `tsconfig.json`, Vercel green. This turns `pitch-deck` green.
2. **Update #28 from pitch-deck.** On PR #28 click "Update branch" (merge `pitch-deck` into `website-fixes`), or in a terminal: `git checkout website-fixes && git merge origin/pitch-deck && git push`. Vercel rebuilds; expected result is green, based on my local after-build. **Verify:** PR #28 shows Vercel ✓. Then merge #28 into `pitch-deck`.
3. Same for **#29** (`brief-fixes`): update from `pitch-deck` after step 1.
4. **Merge PR #32** (`qa-fix/demo-video-2026-10-28` → `demo-video`): fixes `demo-video` / #20. #32 and #33 are independent. When #21 later merges into `demo-video`, both sides already exclude the folder (an easy tsconfig conflict at worst).
5. Alternative if you'd rather I do step 2: I'd push nothing to your branch. I'd open `fix/deploy-website-fixes-20261031` → `website-fixes` with the same one-line exclude. That duplicates #33, so I recommend steps 1–2 instead.

**WOULD OPEN PR:** none. (#33 already fixes it. Opening `fix/deploy-website-fixes-20261031` with an identical diff would only add a PR to merge.)

What I did **not** do: hide anything (no `ignoreBuildErrors`, no `@ts-ignore`, `src/` untouched), push, or merge.

## Time red → fix PR
website-fixes red 28 Oct 15:49 UTC. The fix PR covering it (#33, into its base) was created 29 Oct 01:46 UTC: **9 h 57 min**. demo-video red 28 Oct 15:29 UTC → #32 created 18:27 UTC: **2 h 58 min**.

## Briefing block
```
Deploys 31 Oct 14:34 (fixture branches): 3/7 green (main green). Red 4: demo-video, pitch-deck, website-fixes, brief-fixes (one cause: remotion type-check, root tsconfig).
New tonight: none. Fixed: none. Stuck: none. Website (clearline-site) itself builds: exit 0 locally; the red is the app preview.
Fix PRs opened: none (fix exists: #33 → pitch-deck, #32 → demo-video; both green). Bugs to engineering: none. Probe: not run.
Needs you: merge #33 → then "Update branch" on #28 and #29 → merge #32.
```
**WOULD WRITE (Log):** `Deploys: 3/7 fixture branches green; red: demo-video, pitch-deck, website-fixes, brief-fixes; cause remotion type-check (config); actions: recommend merge #33, update #28/#29, merge #32; evidence: local build before exit 1 / after exit 0 at c44edde`.
