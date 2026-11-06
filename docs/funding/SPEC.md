# Funding Desk: provider-owned files and named decisions

[ASSUMPTION — founder brief] The first workflow prepares an advance at cutoff, records a named treasury decision, then tracks the receivable until repaid. No custody, payment initiation, credit decision or accounting API writes. The provider supplies classifications; safeguarding treatment **needs counsel**.

## Reuse and boundaries

[VERIFIED — source imports] M1 reuses `csv/parse.ts` for strict CSV parsing, `payments/money.ts` for exact decimal arithmetic and `lock.ts` for serialized atomic file updates. PR80's `advances/ledger.ts` and export helper remain unchanged and will back M3's repayment outputs. Existing Python replay and mentor demo remain the source for M8 historical parity; M1 does not claim to have integrated them.

`FundingStore` keeps one provider's records in a deployment-owned JSON file. Use **one Node server process per data directory**: the inherited lock is in-process. An exclusive writer directory rejects overlapping processes; an interrupted process leaves that lock for operator inspection before removal. This is not multi-host storage. Invalid data is rejected before a write; malformed stored JSON fails closed and requires restore. Load and write rebuild imported records from retained CSV bytes and each batch’s original mapping, then compare the complete store. M1 rejects users, decisions and lifecycle changes until their own validated histories exist. These hashes detect accidental edits, not a malicious operator replacing the whole file. For a stale writer directory, stop every process using the directory, preserve a backup, verify the stored file, then remove only the empty `<store>.writer` directory. Never remove it merely because it is old. This is not a distributed ledger or production database guarantee. No HTTP endpoint is exposed in M1.

Amounts are exact nonnegative decimal strings in SGD or USD, at most two decimals. Dates are UTC ISO seconds, with both `effective_at` (event time) and `known_at` (when evidence became available). Source IDs point to retained input SHA-256 and row number. Matching, decisions and exports must respect both clocks. Historical known times are provider assertions, not independently verified evidence of what was known then. IDs are immutable: identical repeats are recorded as duplicates; changed values under an existing ID reject the whole file. Terms revisions require a future explicit versioning workflow, not silent overwrite.

## CSV mapping and import

The five files in `fixtures/funding/` are fictional. Import customers, advances, cash, payouts and receipts through `importCsv`. `columns` exports the canonical field lists. A mapping object maps each canonical field to a unique provider header, for example `{"credit_limit":"Approved limit", ...}`. On first import supply the full mapping; subsequent imports can omit it. `FundingStore.update(d => [importCsv(d, kind, text, mapping, filename, importedAt), result])` saves the mapping and input together. `save` is disabled: mutations use `update` so they cannot bypass the current revision.

Payout rows mean the provider has evidence of supplier credit; they do not initiate it. Bank rows are incoming customer receipts into the stated account. The provider must establish account ownership and evidence quality; a CSV cannot prove those facts. Empty invoice reference, customer terms or receipt reference remain explicit missing evidence for later checks; other required values are rejected with a row-specific error. Bad imports leave existing data unchanged. XML/camt.053 is deferred: CSV is the supported contract.

Cash rows contain `snapshot_id,account,balance,currency,classification,amount` plus common evidence fields. **Balance is the gross account balance repeated as a control total, not another bucket.** `amount` is the non-overlapping classified portion. Each snapshot has four rows: free, safeguarded customer money, pending payouts, buffer. M2 must require consistent balance/times, all four classifications and a complete sum. Then free cash is gross balance minus the three restricted buckets exactly once. Never add undrawn credit capacity. Classification is provider-supplied and must say “confirm with your counsel”.

## Milestone acceptance

| Milestone | Acceptance gate |
|---|---|
| M1 inputs | Synthetic files import; mapping survives reload; malformed rows/conflicting IDs reject atomically; corrupt store never resets. |
| M2 review | Five deterministic checks; duplicate funding and self-approval blocked; reasoned named decisions; cash/limit reserved atomically. |
| M3 repayment | PR80 reused; one receipt cannot clear two advances; uncertainty remains review; exceptions and totals reconcile. |
| M4 outputs | Stable CSV/XLSX, balanced mapped journals, golden output tests, one-line all-clear digest; no sends. |
| M5 evidence | Reproducible content hashes, manifest and tamper test; checksums do not prove source truth. |
| M6 screens | Only approvals, exceptions and settings; desktop/phone screenshot and browser checks. |
| M7 security | Authenticated identity/roles, server authorization, append-only hash chain, retention/restore/delete procedure. |
| M8 replay | Five synthetic historical cases, time-visible decisions, comparison report under two minutes. |

[VERIFIED — M1 implementation scope] M1 defines the entities and file boundary only. It does not authenticate a user, approve credit, establish safeguarding legality, allocate repayments or make a bank/auditor reliance claim. Later milestones must pass their separate gates.
