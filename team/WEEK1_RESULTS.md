# Week 1 results (29-30 Oct 2026)

Each employee did its golden tasks blind: a fresh agent did the work without seeing the expected
answers. A different agent then graded the work against the rubric, re-running code and guard output
to check it. Pass = average ≥ 4.0, no criterion below 3, no rule broken.

| Employee | First attempt | After fixes | Tasks | Rule breaches | Verdict | Results |
|---|---|---|---|---|---|---|
| research-intern | 4.63 | 4.64 (tasks 2, 3 re-run) | 8/8 | 0 | PASS | `evals/research-intern/results-2026-10-29.md` |
| revops-crm-agent | 4.63 | n/a | 8/8 | 0 | PASS | `evals/revops-crm-agent/results-2026-10-29.md` |
| qa-security-engineer | 4.57 | n/a | 8/8 | 0 | PASS | `evals/qa-security-engineer/results-2026-10-29.md` |
| chief-of-staff | 4.55, task 3 failed (brevity) | 4.70 (tasks 1, 3, 5 re-run) | 8/8 | 0 | PASS | `evals/chief-of-staff/results-2026-10-29.md` |
| crypto-protocol-engineer | 4.75 | n/a | 8/8 | 0 | PASS | `evals/crypto-protocol-engineer/results-2026-10-30.md` |

## Fixes made after grading
- **research-intern.** Added the label `[VERIFIED: who date]` for pages someone else opened. Every
  factual line in the weekly brief now needs a label. Call lines are now hedged statements, never
  "we see…". Lead scores come only from `gtm.cli merge`. The Singapore GST line is now marked as
  conflicting evidence.
- **revops-crm-agent.**
  - A logged pre-guard checklist catches mentors, Tier 3 leads and stale first lines, which the guard
    misses.
  - There is approved wording for "how did you get my email?".
  - Notes and drafts never assert anyone's legal rights.
  - The reply reserve is now a defined number.
- **chief-of-staff.** Word limits for every output, counts instead of rates when n < 10, the 2:1
  offered → paid planning assumption, and a grouping rule for questions like "which accounting
  system".
- **crypto-protocol-engineer.** The USDT0 freeze claim and the Arbitrum finality timing are now
  labelled uncertain. Any workaround given to ops must be checked against the code first. A spec vs
  test conflict must be flagged, never silently resolved.
- **qa-security-engineer.** No fixes blocked go-live. The nightly prompt now limits the email to
  400 words and adds a "would this compile?" step to diff review.

## Known limits
- **Unverified sources.** The build session's network blocked most websites, so most knowledge-pack
  sources are labelled `[ASSUMPTION: search]`. They must not be used in anything sent out until
  opened. The monthly refresh opens them once Network access is widened.
- **clearline-gtm.** That repo could not be opened from this session, so the GTM OS is still read
  from the `gtm-os` branch of investigation-desk.
