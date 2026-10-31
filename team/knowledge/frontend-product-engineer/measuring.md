# How to measure load time and accessibility (copy-paste procedure)

Tools in this pack (`K = team/knowledge/frontend-product-engineer`): `K/tools/measure.cjs` (timing +
axe + keyboard + screenshots), `K/tools/keyboard-flow.cjs` (keyboard-only approve and decision flows on
the demo), `K/tools/reflow-dark.cjs` (320 px reflow + dark-mode contrast), `K/tools/state-shot.cjs`
(screenshot + text of one URL, for empty/error states). lead-designer's `tools/contrast.mjs` and
`suggest.mjs` for token pairs. All free: Playwright (pre-installed globally; `NODE_PATH=$(npm root -g)`),
axe-core 4.10.2 (MIT, `npm i axe-core@4.10.2` in a scratch dir).

## 0. Never in the shared worktree
Scratch dir only (the session scratchpad). Never build or write inside `/home/user/ai-team` or a
read-only checkout other than `npm ci`'s `node_modules`.

## 1. Load time (the < 1 s gate)
```bash
SC=<scratchpad>; SHA=<commit or branch head>
mkdir -p $SC/build $SC/desk $SC/tools
git -C <repo> archive $SHA | tar -x -C $SC/build
cd $SC/build && npm ci && DEMO_MODE=on AI_EXPLANATIONS=off ./node_modules/.bin/next build
DEMO_MODE=on AI_EXPLANATIONS=off DESK_DATA_DIR=$SC/desk ./node_modules/.bin/next start -p 3300 &  # note the PID
curl -s -X POST -H 'content-type: application/json' -d '{"kind":"reset"}' http://127.0.0.1:3300/api/requests/demo
(cd $SC/tools && npm i axe-core@4.10.2)
AXE=$SC/tools/node_modules/axe-core/axe.min.js NODE_PATH=$(npm root -g) \
  node K/tools/measure.cjs http://127.0.0.1:3300 $SC/out 5 /requests /requests/all /requests/DEMO-1043 /requests/DEMO-1042 /requests/DEMO-1047 /books
CPU=4 TIMING_ONLY=1 OUTFILE=measure-cpu4.json NODE_PATH=$(npm root -g) node K/tools/measure.cjs http://127.0.0.1:3300 $SC/out 5 <same routes>
kill <PID>
```
- Use `./node_modules/.bin/next`, not `npx next`, inside a copied tree (npx failed to resolve through a
  symlinked `node_modules` on 2026-11-01; copy `node_modules` or run `npm ci` there).
- **Gate:** median load < 1000 ms AND median LCP < 1000 ms at 1× CPU, n = 5. Write the result as
  "`/books`: load 147 ms, LCP 408 ms (median of 5, local prod build, 1280×800, 1× CPU; 4× CPU 403/564)".
  Never "< 1 s" without the numbers, n, setup and commit.
- **Before vs after:** measure the base commit and the branch head the same way in the same session;
  report both. A change that adds > 100 ms median LCP to an owned screen needs a reason in the PR.
- **Lists at scale:** for `/payments`, `/inbox`, `/requests/all`, also measure with a large data set (a
  500-row import) before claiming the gate holds for real use. Demo data is 18 requests.
- What this is not: a field measurement. Real users add network latency; the deployed preview check is
  devops-engineer's (state it if not done).

## 2. Accessibility
1. `measure.cjs` already runs axe at 1280 and 390 (light) and the keyboard pass at 1280; read
   `measure.json`: `a11y[].axe` (id, impact, nodes, sample targets), `a11y[0].keyboard` (`trap`,
   `reachedEnd`, `invisibleCount`), `a11y[].hscroll`.
   Caveat: `keyboard.focusables` counts controls inside closed `<details>`; compare `stops` with what you
   expect by eye, not with `focusables`.
2. `node K/tools/reflow-dark.cjs http://127.0.0.1:3300 <routes>` (with `AXE=…`): 320 px `scrollWidth`
   must equal 320; dark-theme contrast violations.
3. `node K/tools/keyboard-flow.cjs http://127.0.0.1:3300 <outDir>`: approve posting and a decision by
   keyboard only (reset the demo afterwards: it posts to the demo books).
4. Manual, every time (axe finds ~57% of issues, `standards.md` §3): Tab/Shift+Tab through the changed
   part; Enter/Space on every control; Esc on dialogs; where does focus go after the action; zoom 200 %;
   read each screenshot yourself (Read the PNG; crop tall ones with Python PIL).
5. New colour pair → `node team/knowledge/lead-designer/tools/contrast.mjs '<fg>' '<bg>'`.
6. Not available in the container: VoiceOver/NVDA. Say "screen reader not tested" in the PR.

## 3. States
For each owned screen, capture with `state-shot.cjs`:
- **Empty:** start a second server with an empty `DESK_DATA_DIR` (port 3301) and shoot the page.
- **Error:** copy the store file, write `{broken` into it, shoot, **restore it** (only in your scratch
  `DESK_DATA_DIR`, never real data).
- **Loading:** read the route's `loading.tsx`; to see it, throttle CPU 6× and screenshot right after
  `page.goto(..., { waitUntil: "commit" })`.
- **Not found:** an unknown id, check the copy and the HTTP status.

## 4. Evidence to keep
Screenshots at 1280 and 390 of every changed screen (before and after), the JSON outputs, and the exact
command lines. Put them in the PR (see playbook §6); refresh `K/baseline/` when the baseline changes.
Clean up: kill servers by PID, remove scratch build dirs.
