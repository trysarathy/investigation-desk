# The review standard (what "approve" means, what to look for, how fast, how to say it)

Primary sources opened 2026-11-01 (from the publishers' own repos; their websites were blocked):
- Google Engineering Practices, reviewer guide: `standard.md`, `looking-for.md`, `speed.md`,
  `comments.md`, `pushback.md`; developer guide `small-cls.md`
  (https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/<file>.md; the site is
  https://google.github.io/eng-practices/review/reviewer/).
- OWASP Code Review Guide project page (https://raw.githubusercontent.com/OWASP/www-project-code-review-guide/master/index.md).
- OWASP ASVS 5.0 (https://raw.githubusercontent.com/OWASP/ASVS/master/README.md and `5.0/en/` chapters).
- Stripe API reference, PaymentIntent `amount` (https://docs.stripe.com/api/payment_intents/create).
- Vitest API docs, `test.fails` (https://raw.githubusercontent.com/vitest-dev/vitest/main/docs/api/test.md).

## 1. The standard: when to approve
- Google's senior rule: "**In general, reviewers should favor approving a CL once it is in a state where
  it definitely improves the overall code health of the system being worked on, even if the CL isn't
  perfect.**" [VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/standard.md opened 2026-11-01]
- And the limit: "Nothing in this document justifies checking in CLs that definitely _worsen_ the overall
  code health of the system." [VERIFIED: same file, opened 2026-11-01]
- "Technical facts and data overrule opinions and personal preferences." Points of polish are prefixed
  "Nit:" so the author knows they may ignore them. [VERIFIED: same file, opened 2026-11-01]

**How we apply it.** Clearline's "code health" includes being correct to the cent and the day
(`company/OPERATING_MODEL.md`). So: APPROVE when every checklist line in `team/playbooks/code-review.md`
holds, even if you'd have written it differently. A wrong amount, a wrong date, a missing guard, a test
that can't fail or a dishonest line is never "not perfect but better": it worsens health, so it is
blocking. Taste is a `nit`, and nits never hold an approval.

## 2. What to look for (Google's list, our emphasis)
Google's reviewer checklist covers design, functionality, complexity, tests, naming, comments, style,
documentation, every line, context and good things. [VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/looking-for.md opened 2026-11-01]
- **Tests:** "Will the tests actually fail when the code is broken? … Tests do not test themselves … a
  human must ensure that tests are valid." [VERIFIED: same file, opened 2026-11-01] We make this
  mechanical: revert the src change and run the tests (`prove-the-test.md`).
- **Complexity:** "'Too complex' usually means 'can't be understood quickly by code readers'"; watch for
  over-engineering, "solve the problem they know needs to be solved now". [VERIFIED: same file, opened 2026-11-01]
- **Every line, in context:** read the whole file around a change when it touches money, dates, auth or
  posting; the bug is often in the line next to the diff (e.g. a new route without the guard its
  neighbours have).

## 3. Speed
"**One business day is the maximum time it should take to respond** to a code review request."
"LGTM with comments" is right when remaining comments are minor or optional.
[VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/speed.md opened 2026-11-01]
**How we apply it:** the nightly run reviews every un-reviewed head sha the same night (metric "PRs reviewed
within the night"). APPROVE with `non-blocking` comments is preferred over CHANGES REQUESTED for minor points.

## 4. Writing comments
"Be kind." "Explain why." Label severity so authors can prioritise: "Nit:", "Optional (or Consider):",
"FYI:"; "without comment labels, authors may interpret all comments as mandatory".
[VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/comments.md opened 2026-11-01]
Conventional Comments adds a machine-readable shape (`<label> [decorations]: <subject>`, labels such as
praise, nitpick, suggestion, issue, todo, question, thought, chore, and the decorations `blocking` /
`non-blocking`). [ASSUMPTION: conventionalcomments.org could not be opened 2026-11-01 (host blocked);
described from memory]. Our exact format is in `comment-format.md`.

**Pushback:** when the author disagrees, first consider whether they are right ("they might really have
a better insight"); if so, drop the point. If not, "further explain why", stay polite, and keep
advocating when it improves code health. On "I'll clean it up later": "usually unless the developer does
the clean up *immediately* after the present CL, it never happens", so it is "usually best to insist"
on it now. [VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/pushback.md opened 2026-11-01]
Deadline pressure is pushback too: our answer is a fast, precise re-review of the fix, never a lower bar.

## 5. Size
"100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large." Reviewers may
reject a change for being too large. [VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/developer/small-cls.md opened 2026-11-01]
Ours: aim < 300 changed lines, and > ~300 cannot auto-merge (`company/OPERATING_MODEL.md` §2). See `size-and-scope.md`.

## 6. Security baseline
- The OWASP Code Review Guide (v2, July 2017 PDF) argues that manual security review must keep "a
  prominent place" next to scanners, and its second section covers vulnerability types mostly based on
  the OWASP Top 10 2013; its appendix holds a reviewer checklist. [VERIFIED: https://raw.githubusercontent.com/OWASP/www-project-code-review-guide/master/index.md opened 2026-11-01]
  It is old; for concrete requirements we use ASVS 5.0.
- OWASP ASVS **5.0.0 (May 2025)** is the current stable version. [VERIFIED: https://raw.githubusercontent.com/OWASP/ASVS/master/README.md opened 2026-11-01]
  The requirements we cite (V1.2.10 CSV/formula injection, V3.4.4 nosniff, V3.4.6 frame-ancestors,
  V3.5.1/3.5.3 CSRF and Sec-Fetch-*, V13 secret management) are quoted in `security-checklist.md`.

## 7. Money: integers of minor units, never floats
- Stripe's API takes `amount` as "A positive integer representing how much to charge in the smallest
  currency unit (e.g., 100 cents to charge $1.00 or 100 to charge ¥100, a zero-decimal currency)."
  [VERIFIED: https://docs.stripe.com/api/payment_intents/create opened 2026-11-01]
- Our code does the same thing with strings and `BigInt`: `src/lib/payments/money.ts` holds "each value
  as an integer of minor units at its own scale", and `src/lib/decimal.ts` compares decimal strings
  without parsing floats. [VERIFIED: code @0c7d9f1]
- Why floats are banned, in numbers: `0.1 + 0.2` = `0.30000000000000004`; `(1.005).toFixed(2)` = `"1.00"`
  and `(2.675).toFixed(2)` = `"2.67"` (not half-up); `100.02 − 100.01` = `0.009999999999990905` (so a
  "≤ 1 cent" float check fails on exactly one cent); `Number("999999999999.999999")` = `1000000000000`
  (a 12-digit, 6-decimal USDC amount our validator accepts loses its cents). [VERIFIED: ran 2026-11-01, node 22.22.0]
  Any `Number()`, `parseFloat`, `toFixed`, `Math.round` or `+`/`-` on an amount in a diff is blocking
  unless it is the one documented boundary (`clearline-hotspots.md` §1).

## 8. Tests that are expected to fail
Vitest's `test.fails` / `it.fails` "indicate[s] that an assertion will fail explicitly": the test passes
while the code is broken and fails once it is fixed. [VERIFIED: https://raw.githubusercontent.com/vitest-dev/vitest/main/docs/api/test.md opened 2026-11-01]
Our bug and security branches use it (`// SECURITY BUG: remove .fails when fixed`). A fix PR must flip
each relevant `it.fails` to `it`, keep every case, and add none of its own weaker ones in their place.

## 9. Mutation-style thinking
Mutation testing (e.g. Stryker for JavaScript/TypeScript) changes the code under test and checks that
some test fails ("kills the mutant"). [VERIFIED: https://raw.githubusercontent.com/stryker-mutator/stryker-js/master/README.md opened 2026-11-01 (README only; stryker-mutator.io blocked)]
We don't run Stryker; we do the one mutation that matters by hand: remove the fix, and the new test
must fail (`prove-the-test.md`).
