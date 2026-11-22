# Bank-statement CSV import format (Clearline Control, rc5)

Status: implemented in `src/server/imports.ts` (`parseStatementCsv`, `importStatementCsv`, `listImports`,
`importErrorReport`, `evidenceProvenance`). Tests: `tests/control/imports.test.ts`. Fictional data only.

## Who can import

Only the **Finance** role (`import_statement`). Payment Operations investigates; an Approver decides. Every other
role (Viewer, Payment Operations, Approver, Admin) is refused with 403. Every role in the organisation can list the
imports and read their error reports. Nothing crosses organisations: rows are written under `ctx.orgId` inside the
row-level-security transaction, and another organisation sees none of them.

## File

| Rule | Limit |
|---|---|
| Encoding | UTF-8. A leading BOM is accepted. Invalid UTF-8 or any NUL byte refuses the file. |
| Syntax | RFC 4180: comma separator, `"` quoting with `""` escapes, CRLF or LF line endings. |
| Size | 1 to 1,048,576 bytes (1 MiB). Checked before the file is hashed, decoded or parsed. |
| Rows | 1 to 5,000 data rows. Blank lines are skipped and listed as notes. |
| File name | 5 to 200 characters ending in `.csv`. No `/`, `\`, `<`, `>` or control characters. It is shown to people only and never used as a path. |

## Columns

The header row must name **exactly** these nine columns, in lower case and in any order. A missing, duplicated or
unknown column refuses the file. No column can set provenance, a status, "verified" or "bank-authenticated". The
server sets every field the file does not contain.

| Column | Rule |
|---|---|
| `line_id` | 1-64 characters: `A-Z a-z 0-9 _ - : .`. The bank's own id for the line. |
| `account_ref` | 2-64 characters: letters, digits, space and `( ) / . , : ; ' _ & # + -`. |
| `value_date` | `YYYY-MM-DD`, and it must be a real calendar date. `2026-02-30` is refused. |
| `direction` | `debit` or `credit`. |
| `kind` | `payment`, `return` or `reversal`. |
| `amount` | A positive plain decimal such as `1234.50`, at most 32 characters, with no more decimals than the currency allows (SGD, USD, PHP and EUR allow 2; USDC allows 6). It may not have a sign, an exponent, thousands separators or surrounding spaces. It must be greater than zero and at most 10^15 minor units. It is converted to integer minor units with `parseAmount` (BigInt; never floating point). |
| `currency` | `SGD`, `USD`, `PHP`, `EUR` or `USDC`, upper case. |
| `reference` | 0-140 characters, exactly as printed. `<`, `>`, line breaks and control characters other than TAB are refused. |
| `counterparty` | 0-120 characters, with the same character rules as `reference`. |

`(account_ref, line_id)` must be unique within the file. The engine also refuses a line already ingested in the
organisation (`source` + `account_ref` + `line_id`; the source is always `bank_statement`).

Example (fictional):

```csv
line_id,account_ref,value_date,direction,kind,amount,currency,reference,counterparty
SIMBANK-CSV-1001,SIMBANK-SGD-OPS (fictional),2026-11-13,credit,payment,1250.00,SGD,INV-FICT-1001 CUSTOMER RECEIPT,Kestrel Foods (fictional)
```

## Outcomes

- **Imported (201).** The engine accepted every line. Each line is stored in `settlement_evidence` with
  `provenance = 'csv_import'` and the `import_id`. Any evidence record the engine creates for the line is stored the
  same way. A `statement_imports` row records `status = 'imported'`, and the audit log records
  `statement_import_accepted` with the SHA-256, the counts and the actor.
- **Rejected (422). Nothing is imported.** One invalid row, or one line the engine refuses, rejects the whole file.
  A `statement_imports` row records `status = 'rejected'` with per-row errors (`row`, `column`, `code`, `message` and
  a truncated `value`), and the audit log records `statement_import_rejected`. At most 500 errors are stored; the
  total is always reported. `importErrorReport` downloads the errors as CSV.
- **Duplicate (409).** A file with the same SHA-256 was already uploaded in this organisation, whether it was imported
  or rejected. The audit log records `statement_import_duplicate`. To retry a rejected file, correct it; the corrected
  file has a different hash.
- **Empty or over 1 MiB (422, `FILE_EMPTY` / `FILE_TOO_LARGE`).** The file is refused before it is read, and the audit
  log records `statement_import_rejected`. No `statement_imports` row is written, because that table only accepts
  files of 1..1,048,576 bytes.
- **Idempotency.** The same idempotency key with the same file replays the stored response. The same key with a
  different file is refused (`IDEMPOTENCY_KEY_REUSED`).

## Matching

The engine decides matching; the import does not. Matching is reference-based. An outgoing line is attributed to a
payment only when its reference contains the payment's provider payment id. A line that matches on amount alone is
never allocated: the engine opens an `RC_AMOUNT_ONLY_CANDIDATES` exception. A second line for a payout that is
already allocated raises `RC_DUPLICATE_SUSPECTED`.

## Provenance shown to people

`evidenceProvenance(ctx, intentId)` returns each statement line and evidence record about a payment, with its
`provenance`, `importId`, `fileSha256`, `fileName` and importer. Imported lines carry the label:

> Imported by <user> from <file sha256> — not an authenticated bank feed

The UI must show this label next to every imported line, and next to any status it supports (see the limitation
below).

## Storage

The file is parsed in memory only. It is never written to disk, never kept as a file and never served back. The
database keeps the hash, name, size, counts, the parsed lines and the error list. Formula-looking cells (`= + - @`,
TAB, CR) are stored as raw text and never evaluated. Every CSV the app emits, including the import error report,
passes cells through `csvCell` (`src/lib/csv/cell.ts`), which prefixes such cells with `'`.

## Known limitation: imported lines count as bank evidence

The engine has no notion of provenance. A line imported from a CSV counts exactly like an authenticated bank feed.
When its reference names a payment's provider payment id with that payment's amount and currency, the engine
allocates it and can move the payment's settlement to `verified`. This also applies to a payment that is on hold.

One Finance user can therefore make settlement read "verified" by uploading a file. The provenance label, the audit
event and maker-checker on resolution (Payment Ops proposes, an Approver decides) limit the damage. They do not stop
the status change. Closing this gap needs an engine change. One option is a provenance-aware settlement scope (for
example `imported_statement`) that never yields `verified` without a second person's confirmation.

## Known limitation: large files are slow

The parser handles 5,000 rows in well under a second, but the engine's cost per ingested line grows with the number
of lines in the workspace. Measured locally, the pure engine alone (`applyAction`, no database) took 0.4 s for 100
lines, 2.4 s for 300, 7.5 s for 500 and 43 s for 1,000. The import applies every line to one locked workspace and
persists the diff once. Calling `runEngineAction` once per line instead took about 21 s for 300 lines. Until the
engine gains a batch ingest, files much larger than a few hundred lines will exceed normal HTTP request times, even
though the format allows 5,000 rows.
