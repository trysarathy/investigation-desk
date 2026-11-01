# Engineering practices benchmark: how strong tech leads and staff engineers work

Researched 2026-11-01 SGT by tech-lead-architect. Canonical sites were blocked by the session's
network policy, so where an organisation publishes its own text on GitHub I read that instead (still
the primary source: the same authors' own repository). Everything else is labelled
`[ASSUMPTION]`. Each section ends with **"What we do"**: the rule it becomes in the playbook.

## 1. Small changes (Google engineering practices)

Source: Google's "Small CLs" guide, in Google's own repo
[VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/developer/small-cls.md
opened 2026-11-01; canonical page https://google.github.io/eng-practices/review/developer/small-cls.html
was blocked].
- "the right size for a CL is **one self-contained change**": it "addresses **just one thing**",
  includes related tests, and the system "will continue to work well … after the CL is checked in".
- "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large, but it's up
  to the judgment of your reviewer." File spread counts: "A 200-line change in one file might be
  okay, but spread across 50 files it would usually be too large."
- Reviewers "have discretion to reject your change outright for the sole reason of it being too
  large."
- Why: reviewed faster and more thoroughly, fewer bugs, easier to merge, easier to design well,
  less blocking, simpler to roll back.
- Splitting strategies named: **stacking** (one small CL, then the next based on it),
  **by files** (groups needing different reviewers), **horizontally** (by layer, e.g. an API stub
  first), **vertically** (by feature slice). Also: a new API should ship with a usage in the same CL.

**What we do:** hard cap 300 changed lines (additions + deletions as GitHub counts them) for
anything the gate may merge; aim for ~100-200. One concern per PR. Split by layer for our stack:
(1) pure function + tests, (2) adapter/service, (3) route, (4) UI. A new type ships with its first
use.

## 2. Code review standard and speed (Google)

[VERIFIED: https://raw.githubusercontent.com/google/eng-practices/master/review/reviewer/standard.md
and .../speed.md opened 2026-11-01]
- The senior principle: "reviewers should favor approving a CL once it is in a state where it
  definitely improves the overall code health of the system being worked on, even if the CL isn't
  perfect." There is "no such thing as 'perfect' code—there is only *better* code."
- "**One business day is the maximum time it should take to respond** to a code review request."

**What we do:** code-reviewer and QA run nightly, so any PR opened by 23:59 has both verdicts by
the 06:17 gate; a PR waiting > 1 night for review is a "blocked" line in the evening report. The
reviewer is never the author (`team/playbooks/code-review.md`).

## 3. Architecture Decision Records (Nygard)

Nygard's article itself (https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
**could not be opened** (host blocked). What we use:
- The format as implemented by adr-tools (Nat Pryce): sections Status, Context, Decision,
  Consequences, under a numbered title and a date; Context = "the issue motivating this decision,
  and any context that influences or constrains the decision"; Decision = "the change that we're
  proposing or have agreed to implement"; Consequences = "what becomes easier or more difficult to
  do and any risks introduced" [ASSUMPTION: secondary, npryce/adr-tools
  https://raw.githubusercontent.com/npryce/adr-tools/master/src/template.md opened 2026-11-01].
- Commonly attributed to Nygard and not confirmed here: ADRs are short (one or two pages), kept in
  the repo, numbered sequentially and never reused, and superseded ADRs are kept and marked
  [ASSUMPTION: not opened].

**What we do:** `adr-guide.md` and ADR 0001.

## 4. Staff engineers: Tech Lead and Architect archetypes (staffeng.com)

Read from the site's own source repository (README: "This repository is a Hugo site powering
staffeng.com") [VERIFIED: https://github.com/lethain/staff-eng, files
`content/guides/staff-archetypes.md`, `engineering-strategy.md`, `manage-technical-quality.md`,
cloned 2026-11-01; staffeng.com itself was blocked].
- Tech Lead: "guides the approach and execution of a particular team"; "comfortable scoping complex
  tasks, coordinating their team towards solving them, and unblocking them along the way"; "the
  first person called when the roadmap needs to be shuffled."
- Architect: "responsible for the direction, quality, and approach within a critical area",
  combining "technical constraints, user needs, and organization level leadership."
- Strategy from specifics: "write five design documents, and pull the similarities out"; write a
  design doc for work "used by numerous future projects", that "meaningfully impact[s] your users",
  or takes "more than a month"; "Keep the template simple".
- Technical quality, in order: fix the **hot spots** "causing immediate problems", then adopt
  **best practices**, then **leverage points**; "Premature processes add more friction than value."

**What we do:** the role is both archetypes for one small team: scope and unblock nightly (Tech
Lead) and own the shared interfaces and ADRs (Architect). Hot spots first: the 14-day target's
blockers (posting date, address watching, scenario set) come before any refactor or new process.

## 5. Delivery metrics (DORA four keys)

[VERIFIED: https://raw.githubusercontent.com/dora-team/fourkeys/main/README.md opened 2026-11-01;
the repo says "This repository is not currently maintained"; dora.dev was blocked]
- Deployment Frequency: "How frequently a team successfully releases to production".
- Lead Time for Changes: "The median amount of time for a commit to be deployed into production."
- Time to Restore Services: median time from the failing deployment to remediation.
- Change Failure Rate: "The number of failures per the number of deployments."

**What we do:** we have no production deploys yet, so we measure the pre-production analogues
honestly and say so: **cycle time** (task assigned → PR ready-to-merge, median hours), **PRs that
fit first time** (merged without an integration fix), **change failure rate** (merged PRs that
needed a revert or fix-forward within 7 days / merged PRs). Never call these DORA metrics.

## 6. Idempotency (Stripe)

The Stripe post (https://stripe.com/blog/idempotency) **could not be opened** (host blocked).
[ASSUMPTION: not opened] The widely described practice: a client sends a unique idempotency key
with each mutating request so a retry after a timeout cannot apply the change twice; retries use
exponential backoff with jitter.
What our code does, which is what matters [VERIFIED: code read 2026-11-01]: `idempotencyKeyFor()`
in `accounting/rules.ts` derives the key from request id, line kinds, amounts, observation keys and
account codes; `approveAndPost` refuses a stale key; partial posts are recorded so a retry skips
them; `chain/http.ts` retries 429/5xx with jittered backoff. Known weakness: the key is computable
from non-secret facts (SECURITY_GAPS #2).

**What we do:** any new write path (none planned in 14 days besides the existing adapter) must use
a deterministic key and record partial success; the reviewer checks it.

## 7. Linear's method

https://linear.app/method **could not be opened** (host blocked). No claims are made about its
content [ASSUMPTION: not opened]. Do not quote it until it is opened.

## 8. Branch rules (GitHub)

[VERIFIED: https://raw.githubusercontent.com/github/docs/main/content/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches.md
opened 2026-11-01]: "By default, the restrictions of a branch protection rule don't apply to people
with admin permissions"; rules can include "Require status checks before merging" and "Require pull
request reviews before merging". Our live rule (a ruleset, not classic protection) is in
`codebase-architecture.md` / `docs/ARCHITECTURE.md` §1.9: PR required, no required status check,
role bypass [VERIFIED: gh api rulesets/26284409 read 2026-11-01].

**What we do:** the merge gate treats "branch protection on" as: a rule on `main` that requires a
PR **and** requires the `ci` check (strict / up to date). PR-only is not enough.

## 9. Our own adds (from the code and company rules, not external)
- Tests first for bugs; `it.fails` → `it` in the fix PR (OPERATING_MODEL §2).
- Unknown facts pause, never become negatives (crypto-protocol-engineer pack).
- One merger: the tech lead is the only agent that merges, so two agents never race on `main`.
