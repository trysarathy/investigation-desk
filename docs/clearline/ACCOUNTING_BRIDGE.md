# Clearline Accounting Bridge — engine side (rc4, CHANGE 15)

**Status (2026-11-15): sandbox prototype, engine only.** Fictional data. The bridge connects payment operations
to a customer's existing ledger by **proposing** journal entries from recorded evidence and **exporting** them as
a file. It is **not an ERP** and it **posts nothing**: there is no network adapter, no ledger credential and no
external write anywhere in the code. "Posted" in Clearline only records what a person says they posted in their
own ledger, with the reference they type in (`record_posting`, marked `simulated: true`).

Prepared by a general-purpose AI subagent working under the repository role briefs for
accounting-integrations-engineer, matching-engine-engineer and tech-lead-architect. It has not been reviewed.
These posting rules have **not** been signed off by Aashmiin (the role brief requires her approval of every
posting rule before anything could post to a real ledger); they are sandbox rules for the console only.

Code: `src/lib/clearline/accounting/` (public names re-exported by `src/lib/clearline/index.ts`).
API reference: `ENGINE_API.md` CHANGE 15. Records: `DATA_MODEL.md`. Invariants: `ARCHITECTURE.md` §4b.

## 1. What it does, in order

1. **Reconciliation export** (`buildReconciliationExport(ws, { from, to })`): one row per settled, returned or
   unresolved money movement whose date falls in `[from, to)` (organisation calendar dates).
2. **Proposed journal entries** (`propose_journal_entries`): balanced, one currency each, every line naming its
   rule and its evidence ids.
3. **Chart-of-accounts mapping** (`set_account_mapping`): Clearline account roles → the customer's codes.
4. **Accounting periods** (`open_accounting_period`, `close_accounting_period`).
5. **Audit**: every bridge action appends audit events naming the actor and the evidence ids.
6. **Adapter specification** (this file, §6): how a future connector would take the export. Not built.

## 2. Posting rules (sandbox; not signed off)

Amounts are exact integer minor units of the evidence's currency (USDC 6 dp); no rounding happens because no
rule converts or splits an amount. Dates: the bank statement's value date, or the organisation-calendar date
of the chain allocation; never UTC by accident (the organisation's IANA zone, Asia/Singapore in the sample).

| Rule | Evidence that triggers it | Debit | Credit | Shows supplier paid? |
|---|---|---|---|---|
| `JR_SUPPLIER_PAYOUT_DEBIT` | Bank statement **debit** allocated to a live payout by its provider payment id | `supplier_payable` | `bank:<accountRef>` | yes (bank evidence) |
| `JR_ADVANCE_DISBURSED` | The same, for a payout funded by a treasury-approved advance | `customer_receivable` | `bank:<accountRef>` | yes |
| `JR_PAYOUT_DEBIT_NOT_DELIVERED` | The same debit, when the payout is returned, failed, cancelled, expired or on hold | `provider_clearing` | `bank:<accountRef>` | **no** |
| `JR_PAYOUT_RETURN_CREDIT` | Return credit allocated with `RC_RETURN_CONFIRMS_PROVIDER_RETURN` | `bank:<accountRef>` | `provider_clearing` | **no** |
| `JR_REPAYMENT_BY_REFERENCE` | Credit allocated by the repayment reference | `bank:<accountRef>` | `customer_receivable` | no |
| `JR_STABLECOIN_FINAL_TRANSFER` | FINAL chain observation to the beneficiary wallet, allocated by the provider-reported tx hash, payout not terminal | `supplier_payable` (or `customer_receivable` for an advance) | `stablecoin_clearing` | yes (chain evidence) |
| `JR_REVERSAL` | An exported or posted entry whose evidence no longer gives the same entry | the original's credits | the original's debits | no |

**Why returns use provider clearing.** A returned payout's debit is booked to `provider_clearing`, never to the
supplier payable, and the return credit clears it. So no line of a returned payout ever reduces the supplier
payable: the books cannot show the supplier as paid, and the payable stays open. If a live payout's debit was
already exported or posted against the supplier payable when the provider reports the return, that entry is
kept unchanged and a `JR_REVERSAL` plus a `JR_PAYOUT_DEBIT_NOT_DELIVERED` rebooking are proposed (corrections
are new, approved entries). A provider claim can therefore only make the books say *less* (not delivered); it
never creates a cash or payable movement on its own.

**What is never proposed** (`notProposed`, each with its reason and exception ids):

| Code | Case |
|---|---|
| `NP_PROVIDER_COMPLETION_ONLY` | Provider reports completed; no bank or final chain evidence. **No entry and no memo line** (decision below). |
| `NP_PROVIDER_REPORT_ONLY` | A provider settlement report line. |
| `NP_AMOUNT_ONLY_MATCH` | Only the amount matches (e.g. the s5 SGD 20,000.00 receipt with no reference). The reconciliation exception stays. |
| `NP_AMBIGUOUS_REFERENCE`, `NP_UNALLOCATED_LINE` | Not matched by exactly one trusted reference. |
| `NP_PARTIAL_REMAINDER` | The part of a line or payout no evidence covers (the evidenced part is proposed). |
| `NP_ACCEPTED_DIFFERENCE` | A person accepted an over-amount or late bank debit; it was not allocated, so there is no evidence of what the difference is. Book by hand after review. |
| `NP_FEE_NOT_EVIDENCED` | Quote fees are indicative; no statement line or provider charge evidences them. |
| `NP_FX_NOT_EVIDENCED` | Cross-currency payouts: no rate evidence. The entry is in the currency that left the bank; any FX difference against a foreign-currency invoice is for the accountant. |
| `NP_CHAIN_NOT_FINAL`, `NP_CHAIN_NOT_COUNTED` | Chain transfer below the finality threshold, not matched by tx hash, unsupported or conflicting. |
| `NP_EVIDENCE_CONTRADICTED` | A final chain transfer for a payout the provider reports failed or returned. |
| `NP_NO_OPEN_PERIOD` | No open period covers (or follows) the entry date. |

**Decision: provider-reported completion gives no entry at all** (not a "pending evidence" memo line). Reasons:
(1) a generic CSV journal import has no reliable "memo, do not post" flag, so a memo line inside an entry could
be imported as a real line; (2) keeping it out of the proposal set makes "no entry without evidence" and
"proposed ≠ posted" true by construction, and checkable at load; (3) the reconciliation export already lists it
as a `provider_reported_only` row and the view lists it under `notProposed`, so nothing is hidden.

## 3. Proposal lifecycle (separate from every payment status)

```
proposed ──approve (approver ≠ proposer)──▶ approved ──export_journal──▶ exported ──record_posting (a person, external ref)──▶ posted
   │                                          │                            │
   ├──────────── reject (reason) ─────────────┴────────────────────────────┘──▶ rejected
   └── evidence changed (automatic, after any action) ──▶ superseded (reason, replacedBy)
exported / posted + evidence changed ──▶ unchanged, evidenceChange recorded; next propose adds JR_REVERSAL (+ the new entry)
```

- A rejected proposal is not proposed again for the same evidence; a different basis is proposed afresh.
- `approve_journal_proposal` re-derives the entry and refuses `EVIDENCE_CHANGED` if it is not current.
- The basis (`basisHash`) covers the rule, accounts, amounts, currency, entry date and every evidence id.

## 4. Periods and the mapping

- Periods are `[from, to)` calendar dates in the organisation's zone, never overlapping.
- `close_accounting_period` (approver) is refused while the period has proposed or approved entries.
- A closed period refuses `propose_journal_entries { periodId }` (`PERIOD_CLOSED`). An entry dated in a closed
  period is proposed on the first day of the earliest later open period with `priorPeriodItem
  { originalDate, originalPeriodId, reason }` — never silently re-dated.
- Account keys: `bank:<statement accountRef>`, `supplier_payable`, `customer_receivable`, `stablecoin_clearing`,
  `provider_clearing`, `suspense`. Each maps to one customer account code (codes unique: two roles on one code
  would net movements that mean different things). `suspense` is mapped in the sample but no rule uses it: an
  unidentified receipt stays an exception rather than being parked in suspense automatically.
- `export_journal` is refused with `UNMAPPED_ACCOUNT_ROLE: map <keys>` while any key its entries use is unmapped.
- Default sample mapping (fictional): 1010 bank SGD, 1020 bank USD, 1200 receivables from customers, 1300 provider
  clearing, 1310 stablecoin clearing USDC, 1999 suspense, 2100 supplier payables.

## 5. Export file formats

Both documents are deterministic: same workspace + same arguments → byte-identical JSON (sorted keys, 2-space
indent, trailing newline) and CSV (RFC 4180, CRLF). `documentId` = `rx_` / `jx_` + the first 16 hex digits of
`sha256`, the SHA-256 of the document's canonical JSON without `documentId`, `sha256` and `generatedAt` (the id
names the content, not the clock). Text cells starting with `= + - @`, tab or CR are prefixed with `'`.

### 5.1 Reconciliation export CSV (`reconciliationExportToCsv`)

Header, then three `meta` rows (`XR_FICTIONAL_SANDBOX` marking, `XR_GENERATED_AT` id/hash/clock, `XR_PERIOD`), then
one row per movement, sorted by value date then row id. `section` is the evidence class: `evidenced`,
`provider_reported_only` or `unresolved`.

`section,row_id,movement,evidence_class,direction,amount,currency,value_date,statement_line_id,bank_line_id,account_ref,reference,counterparty,chain_observation_id,tx_hash,provider_event_ids,evidence_record_ids,payment_id,internal_reference,advance_id,obligation_id,allocation_ids,reconciliation_status,classification_codes,rule_code,rule_label,open_exceptions,journal_proposals`

### 5.2 Generic CSV journal import (`journalExportToCsv`)

Header, then **only journal lines** (importers read every row), each marked `FICTIONAL SANDBOX` in the last
column; `debit` / `credit` are exact decimal strings, one of them empty; one `journal_id` per balanced entry.

`journal_id,journal_date,entry_date,account_code,account_name,debit,credit,currency,memo,rule_code,evidence_ids,prior_period_item,reverses,prepared_by,approved_by,export_id,marking`

`journal_date` is the posting date (the first day of the open period for a prior-period item, flagged `true`).
A recorded export re-renders byte for byte from its record (`buildJournalExport(ws, { exportId })`), with the
account codes it used, even after the mapping changes.

## 6. Adapter specification (design only — NOT built)

> **No external posting exists.** Nothing below is implemented. A real connector would need the posting rules
> signed off by Aashmiin, a security review, the customer's written consent and — per the role brief — a demo or
> sandbox ledger only until then. Clearline's current offer is the export file a customer's accountant imports.

```ts
/** A future ledger connector. Every method is idempotent on (proposalId, exportId). */
interface AccountingAdapter {
  readonly system: "generic_csv" | "netsuite" | "zoho_books" | "tally" | "rillet";
  /** The customer's chart of accounts, to validate an AccountMapping (read-only). */
  listAccounts(): Promise<{ code: string; name: string; type: string; currency?: string }[]>;
  /** Open/closed periods as the ledger sees them, to refuse a proposal the ledger would reject. */
  listPeriods(): Promise<{ name: string; from: string; to: string; closed: boolean }[]>;
  /** Turn an approved JournalExport into the ledger's own payload. Pure; no network. */
  render(doc: JournalExport): { contentType: string; body: string };
  /**
   * NOT BUILT. Would submit `render(doc)` after a person's explicit click, with an idempotency key per
   * journal entry, and return the ledger's own reference for each entry so record_posting can store it.
   */
  submit?(doc: JournalExport, approval: { by: string; at: string }): Promise<{ proposalId: string; externalReference: string }[]>;
}
```

Mapping notes. **All [ASSUMPTION: not verified against the vendors' documentation this run; to be checked
against the official import specifications before any build].**

| System | How the generic CSV maps | Notes |
|---|---|---|
| NetSuite | One journal entry per `journal_id`; lines carry account (internal id or number from `account_code`), debit, credit, memo; `journal_date` → transaction date; subsidiary and currency per entry | Multi-currency entries need the subsidiary's base currency and an exchange rate, which the bridge does not provide (`NP_FX_NOT_EVIDENCED`). |
| Zoho Books | Manual journal import: one journal per `journal_id`, lines with account name/code, debit, credit, notes | Account names must match exactly; map by code where the import allows it. |
| Tally | Journal vouchers; ledger names from `account_name`; debit/credit per ledger; date from `journal_date` | Tally imports are usually XML; `render()` would translate the CSV rows to vouchers. |
| Rillet | Journal entry import with account, debit, credit, memo, date | Treat as a generic journal import until its specification is checked. |

## 7. Limitations

- Engine and data only; the console screens and any v1 read endpoint are not part of this change (the generic
  `POST /actions` already accepts the bridge actions, and `GET /workspace` returns the sample with its bridge data).
- One currency per entry; no FX, fee, tax (GST) or rounding entries, because the engine has no evidence of them.
- A bank debit evidences that money left the bank, not that the supplier received it; the entry says so.
- Periods cannot be reopened; a closed period's late items always move forward.
