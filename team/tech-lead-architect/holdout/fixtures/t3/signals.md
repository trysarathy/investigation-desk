# Signals gathered by your evening run, Thu 5 Nov 2026 (Day 5), 21:17-21:28 SGT

1. Decisions log, 4 Nov 19:30 (Aashmiin): "Added Require status checks: ci to the main ruleset."
   Your 21:18 `gh api .../rules/branches/main` output now lists pull_request, non_fast_forward, deletion,
   required_status_checks (contexts: ["ci"]).
2. Merge gate log 5 Nov 06:17: merged #51 (reorg dismiss) and #53 (exceptions queue list view, after a fresh
   `CODE REVIEW: APPROVE c9d0f55`). #52 (posting-date timezone) is in the Approval Queue; Approval Queue row
   status: "waiting" (Aashmiin travelling, back at a laptop 6 Nov per her email).
3. matching-engine-engineer, PR #57 description (opened 5 Nov 16:02): "R1 DONE. All 20 Day-14 test payments
   pass. ✅ Day-14 matching is complete." PR #57 = fixtures only (288 lines), head `9e1d204`.
   - CI on `9e1d204`: success. The test file runs the 20 fixtures against the **simulated demo books provider**
     (`provider: "demo"`), not the Xero Demo Company.
   - Comments: `CODE REVIEW: APPROVE 3c77a10` (an earlier commit), `QA: PASS 9e1d204`.
   - Assertions PR (part b) not opened.
4. matching-engine-engineer T2 branch `fix/wrong-network-lookalike`: pushed 19:44, no PR. Its commit message:
   "BNB wrong-network now flagged; look-alike still needs_review - unsure whether that is the right state".
5. accounting-integrations-engineer Log row 02:10: "RISK: spend limit - hit usage-limit error mid-T3. Pushed
   `feat/xero-demo-org-connect` (WIP, compiles, tests not run). Stopped." No activity since.
6. frontend-product-engineer, 18:20 chat note: "Exceptions queue shipped 🎉". Branch `feat/exceptions-risky-rows`
   pushed, no PR. T5 (DEMO.md): no branch, no commits.
7. devops-engineer 15:10: "Preview OOM fixed (NODE_OPTIONS=--max-old-space-size=4096 in the preview env)."
   Preview deploy history: 15:22 green, 17:40 red (OOM), 20:05 green.
   Note: the change was made in the preview hosting settings, not in a PR.
8. lead-designer: copy review for T4 posted as a comment on the branch: 3 changes requested.
9. Xero Demo Company: not connected (Connect needs Aashmiin's click; she is travelling).
