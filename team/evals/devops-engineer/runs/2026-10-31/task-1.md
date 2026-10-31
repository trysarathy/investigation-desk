# Task 1: Nightly deploy check, 3 Nov 2026 03:27 SGT (19:27 UTC 2 Nov)

Source: `team/evals/devops-engineer/fixtures/task1/` (FICTIONAL snapshot, treated as tonight's `gh api` REST
results). Per the task, **no local builds were run tonight**: every state below comes from the fixture
statuses, nothing is carried over from last night. PAUSE: off (task statement).

**Active window:** head commit after 26 Oct 19:27 UTC (7 days), plus `main`. 10 branches listed → **9 active**;
`week4-polish` (22 Oct) is inactive.

## Per-branch state

| Branch | Head | Commit (UTC) | Vercel status (`updated_at` UTC) | Check-runs | Class | Notes |
|---|---|---|---|---|---|---|
| main | a1b2c3d | 2 Nov 10:02 | success (2 Nov 10:03:40) | none | **green** | no Preview Comments check-run → probably the production deployment [ASSUMPTION: Deployments API not used] |
| ai-team | b2c3d4e | 2 Nov 14:40 | success (2 Nov 14:41:02) | Preview Comments ✓ | green | |
| pitch-deck | c3d4e5f | 1 Nov 09:15 | success (1 Nov 09:16:50) | ✓ | green | green since #33 merged 1 Nov (last night's row) |
| demo-video | e5f6071 | 1 Nov 09:20 | success (1 Nov 09:21:30) | ✓ | green | green since #32 merged 1 Nov |
| **payment-terms** | 0718293 | 2 Nov 18:30 | **failure** (2 Nov 18:31:40), `dpl_FICTIONALpt07` | ✓ | **red, NEW** | PR #41 → **main**. Red 56 min at check time. Not reproduced tonight (no local build in this run): cause unknown |
| **website-fixes** | d4e5f60 | 28 Oct 15:48 | **failure** (28 Oct 15:49:08), `dpl_FICTIONALwf01` | ✓ | **red, 6th night** | PR #28 → pitch-deck. Known config cause (remotion type-check, same as #33). **No open PR targets website-fixes** (open-prs.json) |
| **website** | 293a4b5 | 28 Oct 01:12 | **failure** (28 Oct 01:13:08), `dpl_FICTIONALws22` | ✓ | **red, 6th night** | merged branch, no open PR → R4 (delete or disable deploys, her choice) |
| xero-scopes | f607182 | 2 Nov 18:55 | **pending**, total_count 1, "Vercel is deploying your app" (2 Nov 18:55:58) | none yet | **pending (real), not green** | 31 min old at 19:27 UTC: under the 1 h "stuck" line. Re-check at the next run; not counted green |
| gtm-os | 18293a4 | 1 Nov 02:31 | pending, **total_count 0** | none | **no status** | expected: `vercel.json` `deploymentEnabled: false` |

Counts: green 4 + red 3 + pending 1 + no status 1 = **9 active**. ✓

## Metric
- **Active branches green: 4/9 (44%)** (target 100%). `main`: green.
- **Time red → fix PR:**
  - website-fixes: red since 28 Oct 15:49 UTC, **no fix PR after 123 h 38 min** (5 d 3 h). Target (< 24 h) **missed**; the fix is known and one line.
  - payment-terms: red 2 Nov 18:31:40 UTC; 56 min so far; clock running (first step = local reproduction to classify config vs app bug).
  - website: finished branch; R4 recommendation, not a fix PR.

## Compared with last night (Log 2 Nov 03:41 SGT: "6/8 active green; red: website-fixes, website")
- **New red:** payment-terms (new branch, first deploy failed; PR #41 targets `main`).
- **Fixed:** none tonight (pitch-deck/demo-video were already green last night).
- **Still red:** website-fixes (6th night), website (6th night).
- **Not green but not red:** xero-scopes, new commit 18:55 UTC still deploying.
- **Doesn't reconcile:** last night's row names only reds, so I can't say per branch which of the 6 greens
  changed; 6/8 → 4/9 is explained by +1 active (payment-terms) and xero-scopes now pending, which leaves one
  green unaccounted for [couldn't check: greens not named in the row]. Fix for next time: list greens in the Log row.

## Diagnosis / actions tonight
1. **website-fixes** (config, known): cause = `tsconfig.json` `exclude` lacks `demo/video/remotion` (reproduced on
   the real branch, see task-2.md). Action: open `fix/deploy-website-fixes-20261103` (one-line exclude, same as
   #33) **only after the gate runs green this session**; not run in this exercise, so:
   `WOULD OPEN PR (after gate): fix/deploy-website-fixes-20261103 → website-fixes` (body as task-2.md).
2. **payment-terms** (new, unclassified): runbook §1 next — scratch export of 0718293, `npm ci`, `npx next build`,
   `npx vitest run` (within the 3-build budget). If the failing file is under `src/` → roadmap `bug` →
   crypto-protocol-engineer, kept red. **PR #41 → main must not be merged while red** (it would turn `main` red).
3. **website**: R4 recommendation stays in the approval queue (delete the branch, or a `vercel.json` with
   `"git": {"deploymentEnabled": false}` as on gtm-os). Her decision.
4. Probes M4–M6: couldn't run (proxy 403, network not allowed for these hosts).

## WOULD WRITE: Log row (Company HQ → Log)
| Timestamp (SGT) | Agent | Action | IDs | Details |
|---|---|---|---|---|
| 2026-11-03 03:27 | devops-engineer | Deploys | main a1b2c3d; payment-terms 0718293 `dpl_FICTIONALpt07`; website-fixes d4e5f60 `dpl_FICTIONALwf01`; website 293a4b5 `dpl_FICTIONALws22` | Deploys: 4/9 green (main green); red: payment-terms (NEW, PR #41 → main, cause not yet reproduced), website-fixes (remotion type-check, 6 nights, no fix PR yet: 123 h, target missed), website (merged branch, R4); pending: xero-scopes (deploying 31 min); no status: gtm-os (deploys off); actions: fix PR for website-fixes queued behind gate, payment-terms repro next; evidence: API only (no local build this run); probe: couldn't run (proxy 403) |

## 5-line block for the chief-of-staff's 07:27 briefing
```
Deploys 3 Nov 03:27: 4/9 active green (main green). Red 3: payment-terms (NEW, PR #41 → main), website-fixes (remotion type-check, 6 nights), website (finished branch).
New tonight: payment-terms red (cause not yet reproduced). Fixed: none. Stuck: none (xero-scopes deploying 31 min). No status: 1 (gtm-os, deploys off).
Fix PRs opened: none yet (website-fixes one-line fix waits on gate). Bugs to engineering: none yet (payment-terms classified after repro). Probe: couldn't run (proxy 403).
Needs you: don't merge #41 while it's red; decide delete/disable for `website`.
Metric: time red → fix PR missed for website-fixes (123 h).
```

## Roadmap / Risks rows
- **Roadmap `bug`:** none yet. payment-terms gets one only if the reproduction shows an app error (not guessed tonight).
- **Risks:** none required by the rules (main green, prod not down, no secret seen). Watch item (no `RISK:` row):
  PR #41 into `main` is red; merging it would put `main` red.
