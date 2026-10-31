# Knowledge pack: tech-lead-architect

Last refreshed: **2026-11-01 SGT** · Refresh owner: tech-lead-architect (monthly with the golden-task
re-run; and in the same change as anything that makes a file untrue, e.g. a merged PR that moves a
module or the branch rule changing). Built by reading `origin/main` @ `0c7d9f1`, the
`bug/xero-posting-date-timezone` branch, the live branch ruleset (GitHub REST, read-only), and
primary sources reachable from this session (GitHub-hosted official repos).

Labels (company rule 2): `[VERIFIED: <url or file> opened/read 2026-11-01]` only when the primary
source itself was opened by tech-lead-architect on that date; `[ASSUMPTION: secondary, <source>]` for
anything second-hand; `[ASSUMPTION]` / `[GUESS]` otherwise. When you reuse a fact, copy its label
with who and when, e.g. `[VERIFIED: tech-lead-architect 2026-11-01, <url>]`. Never "[VERIFIED per pack]".

| File | Use it for |
|---|---|
| `codebase-architecture.md` | The system as it really is, from a tech lead's seat: modules and owners, shared interfaces, data store and its no-migration rule, request flow, demo mode, accounting providers, where money and dates live, the **approval-only path map**, and the files most likely to collide between parallel PRs. Full doc: `docs/ARCHITECTURE.md`. |
| `engineering-practices.md` | Sourced benchmark: Google's small CLs and code-review standard, ADRs, staff-engineer archetypes (Tech Lead, Architect), technical-quality "hot spots first", DORA four keys, idempotency, GitHub branch rules. What each means for our nightly loop. |
| `adr-guide.md` | When to write an ADR, the Nygard format we use, numbering, statuses, what goes to the Approval Queue, a filled example outline, review checklist. |
| `task-sizing.md` | How to cut roadmap items into PR-sized tasks (< 300 changed lines), the split patterns that fit this codebase, estimating, the task-file schema, approval-only flagging, worked splits of real items. |
| `dependency-map-14-day.md` | The 14-day target's dependency graph: which piece blocks which, the critical path, what only Aashmiin can unblock, and the order the nightly plan follows. |

## What could not be opened on 2026-11-01 (host blocked in this session)
google.github.io (read the same text from Google's own repo `github.com/google/eng-practices`),
cognitect.com (Nygard's ADR article: only secondary via npryce/adr-tools), stripe.com (idempotency
post), linear.app/method, dora.dev (read DORA's `dora-team/fourkeys` repo instead), staffeng.com (read
the site's source repo `github.com/lethain/staff-eng`), developer.xero.com (read Xero's official
OpenAPI repo instead), docs.github.com (read `github/docs` source instead). First job when the
network allows: open the canonical pages and confirm the labels.

## Refresh checklist
1. `git log` since last refresh on `src/` and `.github/`: update `codebase-architecture.md`,
   `docs/ARCHITECTURE.md` and the collision list.
2. Re-read the branch rule: `gh api repos/trysarathy/investigation-desk/rulesets` and
   `.../branches/main/protection`; update the merge-gate facts.
3. Re-run `npx tsc --noEmit && npx vitest run` on a clean `npm ci` and update counts.
4. Re-open each external source; flip `[ASSUMPTION]` to `[VERIFIED]` only if the primary page opens.
5. Update `dependency-map-14-day.md` statuses from `docs/PLAN_14_DAY.md`.
