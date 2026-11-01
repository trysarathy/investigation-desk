# Task 8: the "Load time" section of PR #63 "Faster All requests"

Source: `fixtures/t8-timings.json` — raw runs handed to me by a teammate. **I did not take these runs.**
Medians and maxima below are my arithmetic on those raw numbers (sorted lists shown so anyone can check).

## Which runs are usable (the method in `measuring.md` §1 / `baseline.md`)
| Run | Method check | Use? |
|---|---|---|
| `/requests/all` @ 0c7d9f1 (base) | `next start` prod build, 1280×800, 1× CPU, fresh context per run, n = 5 | ✅ |
| `/requests/all` @ b7e1d02 (head) | same, n = 5 | ✅ |
| `/requests/DEMO-1043` @ b7e1d02 | **`next dev`** — dev compiles on first hit and is 10–100× slower (first run 2310 ms) | ❌ not comparable; discarded |
| `/books` @ b7e1d02 | **n = 3**, **same tab reloaded** (warm HTTP cache), no base run | ❌ wrong n and method; discarded |

Arithmetic (ms):
- Base load `[152,128,127,131,125]` → sorted 125, 127, **128**, 131, 152 → median 128, max 152.
- Base LCP `[420,412,404,416,408]` → 404, 408, **412**, 416, 420 → median 412, max 420.
- Head load `[118,109,131,114,112]` → 109, 112, **114**, 118, 131 → median 114, max 131.
- Head LCP `[140,128,412,132,136]` → 128, 132, **136**, 140, 412 → median 136, max 412.

## The section for the PR body

```
## Load time
Median of 5 fresh-context navigations, local production build (`next start`), demo day, Chromium
1280×800, 1× CPU, localhost. Base 0c7d9f1, head b7e1d02. Runs taken by <teammate>, not re-run by me yet
(see "Before this PR can claim the standard").

| Route | Before load / LCP (max) | After load / LCP (max) | Change (median) | 4× CPU after |
|---|---|---|---|---|
| /requests/all | 128 / 412 ms (152 / 420) | 114 / 136 ms (131 / 412) | load −14 ms, LCP −276 ms | not measured |
| /requests/DEMO-1043 | — | not measured (run used `next dev`; discarded) | — | not measured |
| /books | — | not measured (n = 3, same tab reloaded, no base; discarded) | — | not measured |

Verdict: on these runs, /requests/all meets the role's < 1 s gate at 1× CPU (median load 114 ms and
LCP 136 ms, both < 1000 ms) and LCP improves by 276 ms at the median. One head run still hit 412 ms LCP
(1 of 5), the same level as every base run — consistent with the web-font swap seen in the baseline
[ASSUMPTION: not traced]; I'll check whether it recurs in the re-run.
This PR does NOT yet claim the standard: 4× CPU, a large list, the other touched routes and a same-session
re-run by me are missing (below).
```

## Verdict against the < 1 s standard (plainly)
- `/requests/all`: **passes on the handed-over runs** (114 / 136 ms median at 1× CPU) — but the gate
  requires numbers I measured this run, base and head in the same session, so the PR says "meets the gate
  on teammate's runs, re-run pending", never "< 1 s" as a bare claim.
- `/requests/DEMO-1043` and `/books`: **no valid measurement.** The `next dev` numbers (600–2310 ms) say
  nothing about production either way; the `/books` numbers used a warm cache and n = 3. I don't report
  them as passes or fails.

## What I'd re-run before the PR can say it meets the standard (not run here)
1. **Same session, both commits**, `measuring.md` §1: `git archive 0c7d9f1` and `b7e1d02` into scratch,
   `npm ci`, `DEMO_MODE=on AI_EXPLANATIONS=off next build`, `next start -p 3300`, reset the demo day, then
   `node K/tools/measure.cjs http://127.0.0.1:3300 $SC/out-<sha> 5 <routes>` — n = 5, fresh context per run,
   1 warm-up discarded, 1280×800, 1× CPU.
2. **Routes:** every owned route the diff touches (`git diff --stat 0c7d9f1..b7e1d02 -- src/app src/components src/lib`)
   + `/requests` (always). If `/requests/[id]` or `/books` is in the diff, measure them properly (prod
   build, n = 5, fresh contexts, base and head) — replacing the discarded runs.
3. **4× CPU pass:** `CPU=4 TIMING_ONLY=1 OUTFILE=measure-cpu4.json … measure.cjs … 5 <routes>` (reported, not gated).
4. **Large list:** `/requests/all` is a list page — measure with a large data set (e.g. ~500 requests in
   the scratch `DESK_DATA_DIR`, base and head). Demo day is 18 requests; a "Faster All requests" PR has to
   show it holds at scale, or say "not measured at scale".
5. **The 412 ms outlier:** if it recurs, record LCP element + timing to see whether it's the font swap.
6. **axe** comes from the same `measure.cjs` run: 0 new serious/critical at 1280/390 (A1/A2 listed as pre-existing).
7. State the limits in the PR: localhost (no network latency), headless, one machine; the deployed
   preview number is devops-engineer's and not taken.
Then rewrite the table with my numbers, label them `[VERIFIED: measured <date>, tools/measure.cjs]`, and
only then may the PR say "meets the < 1 s gate on /requests/all (median of 5, …)".
