# The Auditor role (v1 phase 4)

**Status: built, approval-only (a new role and a security control). It relaxes nothing for any existing role.**

## What it is
- A separate, read-only membership of a merchant organisation with the role `auditor`, for one period of whole months
  (at most twelve), optionally limited to some entities (the entity scope of drizzle/0053), until an expiry at most
  90 days after the grant. MFA is required for the role, as for an Admin or an Approver.
- Granted and ended only by the provisioning path (owner connection):
  `npm run control:admin -- grant-auditor <org> <email> --from YYYY-MM --to YYYY-MM --expires <ISO> --by <who asked> [--entities A,B]`
  and `npm run control:admin -- revoke-auditor <org> <email>` (grants revoked, membership revoked, sessions signed out).
  A person who already holds another role in the organisation is refused: an Auditor needs a separate account.

## What it can do
One page, `/control/merchant/audit`: the period's payments, and the evidence pack (PDF, CSV, JSON) per payment and per
entity-month of the period (`GET /api/control/audit/evidence`). Every listing and download is audited with the grant id,
scope, format and the file's SHA-256 (never contents).

## How it is enforced
- **Server:** the role holds one permission (`audit_download`); every other service refuses it. No active grant
  (expired, revoked, never made) is a 403 when the organisation is resolved. A month outside the grant, another entity, or
  a payment of another period is "not found".
- **Database (drizzle/0067), with the services bypassed:** RESTRICTIVE policies on every organisation table with
  row-level security. An Auditor writes nothing except its own audit rows; reads only the tables an evidence pack is
  made of, and only rows of the period (entity calendar date for invoices and chain transfers, provider day for
  settlement batches, value date for bank lines, entry date for journal proposals) and the rows hanging off them; every
  other organisation table not at all. No active grant is the empty period: nothing at all.
- A test fails if an organisation table with row-level security lacks the four auditor policies, so a new table cannot
  be forgotten silently (`tests/control/auditor.test.ts`). A new table that an Auditor must read needs its own reviewed
  predicate in a migration.

## Decisions (conservative; how to reverse)
- An order belongs to a period by its invoice's issue date in the entity's calendar (database) and by its transfers'
  dates (the evidence pack). Both must hold. A payment received in November for an October invoice needs a grant
  covering both months. Reverse: change the `invoices` predicate in a new migration.
- An expired or revoked grant hides even the organisation's member and entity lists.
- The audit trail an Auditor sees is limited to rows about the period's payments, exceptions, write-offs, approvals and
  batches, plus its own. Entity-wide events (runs, exports by others) are not shown to it.

## Not built
An in-app screen for an Admin to grant an Auditor (today: the owner CLI only); expiry reminders.
