# Vertical slice 1 — persistent payment investigation with second-person approval

**Customer (fictional):** a cross-border B2B payment provider. **Users:** a Payment Ops Manager / Reconciliation
Analyst (preparer) and a second authenticated approver in the same organisation. Fictional data only; every screen
labelled as such. No money moves; Clearline Connect never moves funds — it records instructions and evidence.

## Journey and acceptance

| # | Step | Acceptance (each is an automated test against the database-backed app) |
|---|---|---|
| 1 | Sign in | real authentication; wrong password refused with a generic message; rate-limited |
| 2 | Dashboard / Work Queue | lists only the signed-in user's organisation's open investigations, by priority and due date |
| 3 | Open a payment | shows three separate states: execution (provider claim), settlement evidence, reconciliation |
| 4 | Evidence timeline | every provider event, statement line and chain observation, with source, evidence class and time |
| 5 | Deterministic contradictions | e.g. provider "completed" + bank return → a contradiction with its rule code; same inputs, same result |
| 6 | Investigation | owner, priority, status, next action, due date, evidence references; changes audited |
| 7 | Proposed resolution | references evidence ids and the rule; stored as an immutable version |
| 8 | Second-user approval | a different authenticated user with the Approver role; preparer refused; an edit after approval invalidates it |
| 9 | Resolution blocked | without referenced evidence, or without a valid approval, the case cannot resolve (server refusal) |
| 10 | Return distinction — **Redwood Supplies (fictional)** | USD 12,784.90 payout returned, reason "account invalid": outgoing −12,784.90, returned +12,784.90, net 0.00, **supplier still unpaid** |
| 11 | Audit trail | every action with actor, time, before/after; append-only |
| 12 | Evidence-backed export | CSV/JSON that names the evidence ids and rule for each conclusion; byte-identical on re-export |
| 13 | Durability | the same state after refresh, after logout + login, and after a server restart |
| 14 | Isolation | a user of another organisation cannot see or change any of it (HTTP 404), even with the ids |

## Metrics to instrument (no ROI claims)

Time from investigation opened → first action → proposed resolution → approved → resolved; reopen count; number of
evidence items referenced per resolution. Reported with denominators; never presented as customer results.
