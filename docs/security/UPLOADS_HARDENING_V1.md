# Upload hardening (v1 phase 2.1)

This page replaces the "future binary uploads" plan in `UPLOADS_AND_MALWARE_SCANNING.md` for what v1 accepts: CSV/TSV,
XLSX, JSON, MT940 and camt.053. Files are stored encrypted and are never served back or rendered.

## File-type allowlist

- **The kind comes from the content** (`sniffFile`): magic bytes, zip parts (`xl/workbook`), text shape. The file name
  never decides the kind. PDF, old `.xls`, non-workbook zips, HTML/XML that is not camt.053, binary content (NUL bytes)
  and undecodable text are all refused.
- **Statement formats** (MT940, camt.053) are accepted only as bank statements.
- **The name's extension** must be one of csv, tsv, tab, txt, xlsx, json, xml, sta, mt940, 940 or fin. This applies only
  when the extension contains a letter, and it is checked after the content (`FILE_EXTENSION_NOT_ALLOWED`). So a CSV
  named `invoices.exe` is refused before anything is stored.

## Parser limits and protections

| Reader | Protections |
|---|---|
| all | 20 MB file, 100,000 data rows, 200 columns, 10,000 characters per cell |
| CSV/TSV | strict UTF-8, UTF-16 with BOM, windows-1252 fallback with a warning; NUL refused; linear reader |
| JSON | own strict reader, nesting depth 64, numbers kept as text |
| XLSX | zip checked before exceljs: every entry inflated with a hard cap (128 MB total), real size must equal the declared size, at most 2,000 entries, no ZIP64, encryption, unknown methods, duplicate names or header disagreement, no DOCTYPE/ENTITY in any XML part, no macros (`vbaProject.bin`) |
| camt.053 | DOCTYPE/ENTITY refused before parsing; entity expansion off; any parser failure (including nesting beyond the library limit) is a refused file |
| MT940 | line-based reader with the same limits |

Fuzz tests (`tests/clearline/ingest/hardening.test.ts`) run every reader over seeded random inputs and mutations of
valid files. Their assertions are that only a refusal (`IngestError`) is ever thrown and that each call finishes within
2 s. `CLEARLINE_FUZZ_RUNS=3000` runs a longer pass; that pass was run once locally and was green.

## CSV formula injection

Every CSV the application writes goes through one rule, `isFormulaLike` (`src/lib/csv/cell.ts`). A cell is prefixed
with `'` when it starts with tab, CR or LF, or when it starts with `= + - @` after Unicode folding (so full-width `＝`
counts) and after leading spaces or invisible characters. Plain decimal amounts are still written as numbers.
`tests/clearline/exports/formula-injection.test.ts` checks every writer.

## Malware scanning: optional, local, fail closed

`src/server/malware.ts` can stream each upload to a **ClamAV daemon** (`clamd`, `INSTREAM`) before the file is stored.
This needs no paid service and no new dependency. Set one of:

- `CLEARLINE_CLAMD_SOCKET=/run/clamav/clamd.ctl`, or
- `CLEARLINE_CLAMD_HOST` and `CLEARLINE_CLAMD_PORT`.

Results:

- An infected file is refused (`FILE_MALWARE_FOUND`) and audited with the signature name.
- If the daemon cannot answer, every upload is refused (`MALWARE_SCAN_UNAVAILABLE`).
- `CLEARLINE_MALWARE_SCAN=required` refuses uploads when no scanner is configured.

**The gap:** without that configuration, nothing is scanned. That is the default, and this build ships no daemon. The
risk is reduced but not removed:

- only text, XLSX and XML formats are accepted, and all are parsed by hardened readers;
- XLSX macros are refused;
- files are never served back or executed.

Options for the founder, each needing a decision:

- run ClamAV as a sidecar container (free; signature-based only; its signature updates need outbound access);
- use a managed malware-scanning feature of the storage or hosting provider (a new processor and a cost).

The tests use a fake `clamd` that speaks the real protocol. No real daemon was available here.

## Orphan cleanup

`npm run control:admin -- sweep-orphans [--dry-run] [--older-than-minutes N]` uses the owner connection and handles two
directions:

1. **Stored files that no upload row names**, and partial writes, are removed once they are older than the sweep age
   (default 60 minutes).
2. **Open uploads whose file is gone** (stored, mapped, validated or declined) are closed as deleted, and their
   validation rows are removed. **Confirmed or normalised** uploads without a file are only reported, because the
   database lets retention alone remove their file.

`--dry-run` changes nothing and reports what would happen. Each affected organisation gets one audit row
(`upload_orphans_cleaned` or `upload_orphans_dry_run`) containing ids and counts only.
