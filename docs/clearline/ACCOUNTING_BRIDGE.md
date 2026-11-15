# Clearline Accounting Bridge — engine side (rc4, CHANGE 15)

**Status (2026-11-15): sandbox prototype, engine only.** Fictional data. The bridge connects payment operations
to a customer's existing ledger by **proposing** journal entries from recorded evidence and **exporting** them as
a file. It is **not an ERP** and it **posts nothing**: there is no network adapter, no ledger credential and no
external write anywhere in the code. "Posted" in Clearline only records what a person says they posted in their
own ledger, with the reference they type in (`record_posting`, marked `simulated: true`).

**Review status.** The independent review of a91dd11 was **BLOCK** (F1–F13). CHANGE 16 (`ENGINE_API.md`)
addresses every finding; it has not been re-reviewed. The F1 stablecoin rule below is a **sandbox rule decided by
the coordinator and flagged for Aashmiin's sign-off**.

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
of the chain allocation (finality) — the same date in the journal and in the reconciliation export (review F9);
never UTC by accident (the organisation's IANA zone, Asia/Singapore in the sample).

**The supplier payable is cleared once, by the evidence that the beneficiary was paid on the payout's own rail
(review F1; sandbox rule flagged for Aashmiin's sign-off).** A fiat payout: the bank debit. A stablecoin-route
payout: the final chain transfer to the beneficiary's wallet; its bank (or custody) debit only funds the on-ramp
and goes to stablecoin clearing. The conversion difference between the funding currency and USDC is **not
proposed** (`NP_FX_NOT_EVIDENCED`) and is listed as an unresolved `stablecoin_conversion` row in the reconciliation
export. `propose_journal_entries` refuses (`LEDGER_DOUBLE_COUNT`) any result in which the net supplier payable /
customer receivable debit for one payout would exceed the payout (source currency) or its quoted recipient amount
(destination currency), or one bank line would be booked twice.

| Rule | Evidence that triggers it | Debit | Credit | Shows supplier paid? |
|---|---|---|---|---|
| `JR_SUPPLIER_PAYOUT_DEBIT` | Bank statement **debit** allocated to a live payout by its provider payment id | `supplier_payable` | `bank:<accountRef>` | yes (bank evidence) |
| `JR_ADVANCE_DISBURSED` | The same, for a payout funded by a treasury-approved advance | `customer_receivable` | `bank:<accountRef>` | yes |
| `JR_PAYOUT_DEBIT_NOT_DELIVERED` | The same debit, when the payout is returned, failed, cancelled, expired or on hold | `provider_clearing` | `bank:<accountRef>` | **no** |
| `JR_PAYOUT_RETURN_CREDIT` | Return credit allocated with `RC_RETURN_CONFIRMS_PROVIDER_RETURN` | `bank:<accountRef>` | `provider_clearing` | **no** |
| `JR_REPAYMENT_BY_REFERENCE` | Credit allocated by the repayment reference | `bank:<accountRef>` | `customer_receivable` | no |
| `JR_STABLECOIN_ONRAMP_FUNDING` (**sandbox rule, flagged for Aashmiin's sign-off**) | Bank (or custody) **debit** allocated to a live payout on the stablecoin route | `stablecoin_clearing` (debit's currency) | `bank:<accountRef>` | **no** (the chain transfer pays) |
| `JR_STABLECOIN_FINAL_TRANSFER` | FINAL chain observation to the beneficiary wallet, allocated by the provider-reported tx hash, payout not terminal | `supplier_payable` (or `customer_receivable` for an advance) | `stablecoin_clearing` | yes (chain evidence) |
| `JR_REVERSAL` | An exported or posted entry whose evidence no longer gives the same entry, or an exported entry an approver withdrew | the original's credits | the original's debits | no |

A return credit is proposed only for a **credit** line; a debit-direction return or reversal line is never
allocated by the engine (`RC_RETURN_LINE_IS_DEBIT`) and never gives an entry (review F2).

**Why returns use provider clearing.** An entry proposed for a returned payout books its debit to
`provider_clearing`, never to the supplier payable, and the return credit clears it. If a live payout's debit
was already exported or posted against the supplier payable when the provider reports the return, that entry is
kept unchanged (it may be in the ledger) and stays there **until its reversal is posted**: a `JR_REVERSAL` and a
`JR_PAYOUT_DEBIT_NOT_DELIVERED` rebooking are proposed. Since CHANGE 16 (review F5) the two are tied: the required
reversal cannot be rejected (`REVERSAL_REQUIRED`), and the rebooking cannot be approved or exported before the
reversal (`REVERSAL_FIRST`), so one bank debit is never booked twice and the supplier is never shown paid once
both are posted. (Before CHANGE 16 a rejected reversal left the payout shown paid and the bank debit booked twice.)
A provider claim of non-delivery changes the classification of *bank evidence*; it never creates a cash or
payable movement on its own.

### 2.1 What the stablecoin rule leaves for the accountant (re-review R5; for Aashmiin's sign-off)

For an SGD→USDC payout against an SGD invoice the two proposed entries are, each balanced in its own currency:

| Entry | SGD | USDC |
|---|---|---|
| `JR_STABLECOIN_ONRAMP_FUNDING` | Dr stablecoin_clearing X / Cr bank X | — |
| `JR_STABLECOIN_FINAL_TRANSFER` | — | Dr supplier_payable Y / Cr stablecoin_clearing Y |

Consequences:
- The supplier payable is cleared **in USDC** (Y), although the invoice and the payable may be in SGD. In a ledger
  with one functional currency (SGD), the accountant must translate that USDC line at a rate of their choosing and
  post any difference against the SGD payable by hand.
- Until then `stablecoin_clearing` carries an **SGD debit balance (X) next to a USDC credit balance (Y)**. They are
  never netted by the bridge: there is no rate evidence. The reconciliation export lists the pair as an unresolved
  `stablecoin_conversion` row (`amount` X SGD, `counterAmount` Y USDC).
- The payable is cleared once, by Y, in one currency; the engine refuses (`LEDGER_DOUBLE_COUNT`) anything that
  would clear one payout in two currencies (re-review R6).
- No FX, fee or rounding entry is proposed for this route.

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
| `NP_FX_NOT_EVIDENCED` | Cross-currency payouts: no rate evidence. **Fiat route:** the entry is in the currency that left the bank; any FX difference against a foreign-currency invoice is for the accountant. **Stablecoin route (re-review R5):** the funding entry is in the debit's currency (e.g. SGD) and the payable is cleared in **USDC** by the chain transfer; the conversion between them is not proposed (see §2.1). |
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

- A rejected (never exported) proposal is not proposed again for the same evidence; a different basis is proposed afresh.
- `approve_journal_proposal` and `export_journal` re-derive every entry and refuse `EVIDENCE_CHANGED` if it is not
  current (review F3). Approval needs every account key mapped and records the codes the approver saw; a mapping
  change that alters them supersedes the approval (`SP_MAPPING_CHANGED`), and the export uses exactly those codes
  (review F6).
- Withdrawing an **exported** entry (`reject_journal_proposal`) needs an approver other than the exporter, keeps its
  id for good, and proposes a `JR_REVERSAL`: the file may already be imported (review F7). If an approver other than
  the exporter **confirms it was never imported** (`confirm_not_imported`, recorded and audited), no reversal is
  needed (a pending one is superseded) and the same evidence may be proposed again; once the reversal is exported or
  posted, the confirmation is refused (re-review R4).
- A workspace saved under earlier posting rules loads: a proposed or approved entry those rules derived differently
  is superseded on load (`SP_RULES_CHANGED`, reported as a `journal_proposal_superseded` migration); exported and
  posted entries are never altered and get the reversal path (re-review R1).
- While a payout's provider status reports contradict each other (an open `contradictory_evidence` exception), its
  bank debit leaves settlement contradicted and gives no entry that shows the supplier paid (G1).
- On load, every entry's lines must re-derive from the evidence records it names, its `basisHash` is recomputed,
  and a proposed or approved entry must be the entry the current evidence gives. The approver's identity in a
  client-held workspace cannot be authenticated: these checks prove consistency with the evidence, not who clicked.
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

`section,row_id,movement,evidence_class,direction,amount,currency,value_date,statement_line_id,bank_line_id,account_ref,reference,counterparty,chain_observation_id,tx_hash,provider_event_ids,evidence_record_ids,payment_id,internal_reference,advance_id,obligation_id,allocation_ids,reconciliation_status,classification_codes,rule_code,rule_label,open_exceptions,journal_proposals,counter_amount,counter_currency,marking` (every row ends with `FICTIONAL SANDBOX`, review F12; `counter_amount` / `counter_currency` only on `stablecoin_conversion` rows)

### 5.2 Generic CSV journal import (`journalExportToCsv`)

Header, then **only journal lines** (importers read every row), each marked `FICTIONAL SANDBOX` in the last
column; `debit` / `credit` are exact decimal strings, one of them empty; one `journal_id` per balanced entry.

`journal_id,journal_date,entry_date,account_code,account_name,debit,credit,currency,memo,rule_code,evidence_ids,prior_period_item,reverses,prepared_by,approved_by,export_id,marking`

`journal_id` is `SANDBOX-<proposal id>` so the marking survives an importer that drops unmapped columns (review F12).
`journal_date` is the posting date (the first day of the open period for a prior-period item, flagged `true`).
A recorded export re-renders byte for byte from its record (`buildJournalExport(ws, { exportId })`), with the
account codes it used, even after the mapping changes: since CHANGE 16 (review F4) a journal id that was ever in an
export is never removed or reused (a per-case reset is refused), and load checks that the record and its entries
name each other. (Before CHANGE 16 a reject-then-reset could reuse an exported id.) The record keeps `sha256` (the
content hash the id abbreviates, over canonical JSON without id, hash and clock) and `fileSha256 { json, csv }`, the
SHA-256 of the exact bytes produced (review F10).

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
