# 1. Record architecture decisions

Date: 2026-11-01 (SGT)

## Status

Proposed (tech-lead-architect). Becomes Accepted when Aashmiin approves it in the Approval Queue.
This ADR is process-only and easy to reverse, but it decides where the team's decisions live, so
she confirms it.

## Context

Clearline's code is built by several AI engineers in parallel (crypto-protocol-engineer,
accounting-integrations-engineer, matching-engine-engineer, frontend-product-engineer,
devops-engineer, qa-security-engineer, lead-designer), each starting every run from a fresh session
with no memory of earlier runs. Decisions made in a chat, a PR comment or a Log row are lost to the
next run, so engineers re-open settled questions or quietly pick different answers (for example, two
PRs adding two different timezone fields to the posting options).

Michael Nygard proposed short Architecture Decision Records, kept in the repository, numbered and
never deleted, with the sections Title, Status, Context, Decision and Consequences
[ASSUMPTION: secondary, the ADR template in npryce/adr-tools
https://github.com/npryce/adr-tools/blob/master/src/template.md opened 2026-11-01, which cites
Nygard's 2011 article; the article itself (https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
could not be opened: host blocked in this session]. The adr-tools project records its own first
decision the same way [VERIFIED:
https://raw.githubusercontent.com/npryce/adr-tools/master/doc/adr/0001-record-architecture-decisions.md
opened 2026-11-01].

`docs/SPEC.md` already says the spec wins over any AI's architecture idea unless Aashmiin changes
it. ADRs must not compete with it: they record *how* we build what the spec asks.

## Decision

We will record every architecturally significant decision as an ADR in `docs/adr/NNNN-title.md`
(four-digit number, lower-case hyphenated title), in Nygard format: Title, Date (SGT), Status,
Context, Decision, Consequences. The tech-lead-architect writes or reviews each one.

- "Significant" means: changes a shared interface (`PlanOptions`, `TransferEvent`, store shapes),
  adds a dependency, store, chain, network or provider, changes posting, money, dates, auth,
  secrets, permissions or deployment, or is hard to reverse.
- Statuses: `Proposed` → `Accepted` (only after Aashmiin approves when the decision is
  approval-only or hard to reverse; otherwise when the tech lead accepts it and logs it) →
  `Superseded by NNNN` or `Deprecated`. An ADR is never deleted or rewritten after acceptance; a
  change is a new ADR that supersedes it.
- Each ADR is one to two pages, in plain English, and labels external facts per company rule 2.
- Every PR that implements an ADR links it in its description. A PR that contradicts an accepted
  ADR gets `CHANGES REQUESTED` from the morning integration check.
- Anything hard to reverse goes to the Approval Queue as a 3-line summary plus the risk, with the
  ADR link.
- An ADR in `docs/adr/` lands on `main` through a normal PR; it is documentation, so it is not
  approval-only by path, but its *Decision* takes effect only at the status the rules above allow.

## Consequences

- Fresh sessions can read `docs/adr/` and `docs/ARCHITECTURE.md` and start from settled answers.
- Writing an ADR costs about 20-40 minutes per significant decision; small, reversible choices stay
  in PR descriptions instead.
- Until this ADR is accepted, ADR 0002 and later are still written in this format, marked
  `Proposed`.
- Risk: ADRs drift from the code. Mitigation: the morning integration check compares merged PRs
  with accepted ADRs, and `docs/ARCHITECTURE.md` is fixed in the same PR as any change it describes.
