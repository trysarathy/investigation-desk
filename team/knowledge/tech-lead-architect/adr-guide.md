# ADR guide

Accepted practice for Clearline is ADR 0001 (`docs/adr/0001-record-architecture-decisions.md`,
status Proposed until Aashmiin approves). Format source: Nygard's format as implemented in
npryce/adr-tools [ASSUMPTION: secondary, https://github.com/npryce/adr-tools/blob/master/src/template.md
opened 2026-11-01; Nygard's article could not be opened]. See `engineering-practices.md` §3.

## When to write one (any yes → ADR)
1. Changes a shared seam in `codebase-architecture.md` §2 (`PlanOptions`, `PostingLine`,
   `TransferEvent`, `Observation.key`, `RequestState`, `ProblemKind`, a store shape).
2. Adds a dependency, a store, a chain or network (incl. a testnet), a provider, a scheduled job, or
   an external host.
3. Touches posting, money, dates sent to the books, auth, secrets, OAuth scopes, permissions,
   deployment, or deletion behaviour.
4. Is hard to reverse (data written to a customer's books, a format inside an idempotency key, a
   public URL, a migration of stored data).
5. Two engineers' PRs disagree about an interface (the ADR settles it; both PRs follow it).
Otherwise: a paragraph in the PR description is enough.

## File and numbering
`docs/adr/NNNN-lower-case-title.md`, next free number, never reused, never renumbered.
Title is a statement of the decision ("Posting date is the calendar date in the organisation's
timezone"), not a question.

## Sections (in this order)
```
# N. <Decision as a statement>

Date: YYYY-MM-DD (SGT)

## Status
Proposed | Accepted (who, date, where recorded) | Superseded by NNNN | Deprecated
+ one line: approval-only? hard to reverse? which Approval Queue row.

## Context
Facts only, each labelled. The code as it is (file:line @ sha), the failing test, the external
spec (primary source opened, with date), constraints from SPEC.md / PRODUCT_FACTS / company rules,
and what is unknown. Options considered, briefly, with why each loses.

## Decision
"We will …". Concrete: names the field, function, file, fallback behaviour, and how it is split
into PRs (< 300 lines each).

## Consequences
What gets easier, what gets harder, who must do what (reconnect Xero, re-run tests), risks if
wrong and how they are contained, follow-ups.
```
Keep it to one or two pages. Plain English. No invented numbers; if you measured something, say how.

## Statuses and who moves them
| From → to | Who | When |
|---|---|---|
| (new) → Proposed | tech-lead-architect (or an engineer, reviewed by the tech lead) | written |
| Proposed → Accepted | **Aashmiin** if approval-only or hard to reverse; otherwise tech-lead-architect, with a Decisions log row | after review |
| Accepted → Superseded by NNNN | whoever writes the new ADR, approved the same way as the new one | new ADR accepted |
Never edit the Decision of an Accepted ADR; write a new one.

## Approval Queue entry (approval-only or hard to reverse)
Exactly three lines plus risk, no more:
```
ADR NNNN: <title> (<link>)
What changes: <one line, plain English>
Why now: <one line; what it unblocks in PLAN_14_DAY>
Risk: <what goes wrong if approved and wrong, and how it's contained>
```

## Review checklist (before setting Proposed)
- [ ] Every code fact has file:line @ sha; every external fact has a label and date.
- [ ] Options considered include "do nothing".
- [ ] Unknowns fail closed (block/pause), never default to a guess (e.g. never silent UTC).
- [ ] Split into PRs < 300 lines with owners.
- [ ] Says whether it is approval-only and why (OPERATING_MODEL §2 category).
- [ ] Doesn't contradict `docs/SPEC.md`; if it must, it says so and goes to Aashmiin.

## Examples in this repo
- `0001-record-architecture-decisions.md` (process)
- `0002-posting-date-in-organisation-timezone.md` (approval-only, posting + permissions)
- Next expected: `0003` scenario source for the 20 test payments (replayed real transfers vs
  testnet), needs Aashmiin.
