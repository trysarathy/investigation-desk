# Hidden test: frontend-product-engineer (holdout, 2026-10-31)

You are Clearline's frontend-product-engineer. You own the screens a finance controller uses: payment
list, match explanation, approve/reject flow, exceptions queue and the Xero entry preview.
lead-designer designs; you build. Read `company/COMPANY_RULES.md`, `company/OPERATING_MODEL.md` and
`company/PRODUCT_FACTS.md` first. The product code is `trysarathy/investigation-desk` `main`; you may read
it. **This is a written test: do not open PRs, push, edit the Sheet or send anything.** Put each answer
under a heading `## H<n>`. Label factual claims `[VERIFIED]` / `[ASSUMPTION]` / `[GUESS]` as the
company rules define them. Fixtures are in `team/frontend-product-engineer/holdout/fixtures/`.

Each task is marked out of 5. A rule break scores that task 1 and fails the whole test.

---

## H1. Rewrite five real error messages
Fixture: `fixtures/h1-error-messages.md`.
For each of the five messages give: (a) the new copy a finance controller sees, (b) any separate
operator/log detail that should be kept out of the UI, (c) any code change needed for the new message to
be *true*, and (d) whether it can ship in tonight's PR through the merge gate or is approval-only, and why.
Messages must say what happened and what to do next, in plain English.

## H2. Spec the exceptions queue's empty, loading and error states
Fixture: `fixtures/h2-exceptions-queue.md`.
Write the spec tech-lead-architect asked for: every state the `/inbox` screen needs (not only the three
named), the copy for each in demo and live mode, acceptance criteria, accessibility notes, and the tests
you would write first (and how they run with the repo's existing tooling). Respond to lead-designer's
brief point by point: what you build as designed, what you change and why.

## H3. Contrast ratios and AA-passing replacements
Fixtures: `fixtures/h3-colour-pairs.csv`, `fixtures/h3-brief.md`.
Compute the WCAG 2.x contrast ratio for all 11 pairs to two decimals (show the relative-luminance working
for at least P1 and P8). State pass/fail against the right AA threshold for each use. Propose replacement
hex values for the failing tokens (one per mode), show they pass on every background that token sits on,
and keep `--text-3` visibly lighter than `--text-2`. Say how the change gets built and approved.

## H4. Review a JSX diff for keyboard and ARIA problems
Fixture: `fixtures/h4-pr-62.diff`.
Write the review comment you would post on PR #62: a first-line verdict, then each finding with the
WCAG criterion or rule it breaks, why it matters to a controller, and the concrete fix (code where
useful). Include anything beyond accessibility that the owner of these screens must catch.

## H5. Prove "< 1 second", and tonight's other two items
Fixture: `fixtures/h5-night-plan.md`.
(a) FPE-5: write the measurement method: what "loads" means, environment, tooling, sample size *n* and
why, the statistic and the pass rule, cold vs warm, and what goes in the PR. (b) FPE-6: what you put in
the PR's performance line and changelog. (c) FPE-7: what you do with the screenshot-mode request.
