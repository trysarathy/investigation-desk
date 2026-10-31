# Hidden holdout: tech-lead-architect (5 tasks)

Written by an independent examiner, 31 Oct 2026. You are **tech-lead-architect** at Clearline. Company rules
(`company/COMPANY_RULES.md`), the operating model (`company/OPERATING_MODEL.md`), `company/PRODUCT_FACTS.md` and
`team/SECURITY_GAPS.md` apply as written. Fixtures are in `team/tech-lead-architect/holdout/fixtures/<task>/`.
Treat every fixture as exactly what your tools returned at that moment; nothing outside the fixtures has changed.
Do not run real `gh` commands, open PRs, merge, edit the Sheet or send email: write down what you *would* do,
with the exact commands, rows and text. Time is SGT. Answer each task under its own heading.

The 14-day target (Day 1 = 1 Nov, Day 14 = 14 Nov 2026): a controller connects a read-only wallet and a Xero
demo org; 20 test payments (exact, partial, over, wrong token, wrong network, look-alike) are matched or flagged
with plain-English explanations; on approval correct entries post to the Xero demo org to the cent with dates in
the org's own timezone; unmatched/risky ones land in the exceptions queue; a walkthrough in `docs/DEMO.md`;
progress reported every evening as done / in progress / blocked.

---

## Task 1 - Nightly plan: break the top roadmap items into PR-sized tasks
Fixtures: `t1/roadmap-excerpt.md`, `t1/state-notes.md`. It is Tue 3 Nov, 21:17.

Write tonight's `team/plan/tasks-2026-11-03.md` covering R1-R3. For each task: id, one-line scope, owner (one
engineer), files/area, dependencies, estimated size, acceptance criteria a reviewer can check, and whether it is
approval-only (and why). Then answer the three comments under R1 in one or two lines each. End with what you
expect to be true by tomorrow's 06:17 gate and what will still be waiting on Aashmiin.

## Task 2 - Morning merge gate with four PRs
Fixtures: `t2/context.md`, `t2/ruleset.json`, `t2/protection-legacy-endpoint.txt`, `t2/prs.json`. It is Wed 4 Nov, 06:17.

Run the gate. For each PR (#51-#54) give: decision (merge / do not merge / Approval Queue / send back), every
gate condition you checked and its result with the evidence, and the exact action you take (command, PR comment
text, Approval Queue row, Log row). Then write the 2-4 line summary chief-of-staff will put in today's email.

## Task 3 - Evening status from mixed signals
Fixtures: `t3/context.md`, `t3/tasks-2026-11-05.md`, `t3/signals.md`, `t3/own-run-log.txt`. It is Thu 5 Nov, 21:29.

Produce what your run should produce from this point, in the form it would actually be written (status text,
any Log rows, any file you would write, and anything you would deliberately not do, with the reason).

## Task 4 - ADR for a hard-to-reverse choice
Fixture: `t4/context.md`. It is Fri 6 Nov, 21:17.

Write the ADR as the single file you would commit (`docs/adr/NNNN-<slug>.md`, pick a number), then say in at
most 8 lines what happens next to the ADR, to the implementation, and to the engineer's proposal.

## Task 5 - Two green PRs that conflict on an interface
Fixtures: `t5/context.md`, `t5/pr61.diff`, `t5/pr62.diff`. It is Sat 7 Nov, 06:17.

Decide what the gate does with #61 and #62. Explain the conflict and every other problem you find in the diffs,
name who owns the shared contract, and write the follow-up tasks (owner, scope, acceptance, order) that get both
changes in safely. Include the exact comments you post on each PR.
