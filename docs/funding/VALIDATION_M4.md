# M4 validation

[VERIFIED — final command results] TypeScript `tsc --noEmit` exited 0. Vitest exited 0: 683 passed, 57 skipped; 26 passing test files and one skipped file. Production `next build` exited 0. The output suite passed 26 cases and three checked golden snapshots covering CSVs, both ERP formats, digests, manifests and OOXML member content.

[VERIFIED — normal entry point] `npm run funding-export -- --sample --settings fixtures/funding/export-settings.json --as-of 2026-11-19T10:00:00Z --out <new-directory>` completed and wrote 11 review files. ZIP CRC checks passed, all XML members parsed, and an independent openpyxl read found the `Open advances` sheet with SGD 60,000 outstanding. No generated workbook or output directory is committed.

[VERIFIED — safeguards tested] Tests cover exact per-event balancing, timezone month rollover, UTC, invalid mappings, strict boolean confirmations, foreign-currency refusal, Xero's line limit, numeric negative Xero credits, formula injection including hidden/full-width prefixes, Slack mentions, XML invalid characters, XLSX precision refusal with CSV retained, excess/unmatched receipts, named write-off entries and deterministic repeat output.

[VERIFIED — lint limit] Repository `npm run lint` exited 1 with 20 existing errors and 41 warnings outside this milestone's changed output/CLI/test files. Scoped ESLint on the M4 output modules, shared CSV helper, CLI and output tests exited 0 without warnings. The inherited M3 constant-binding cleanup is included. Package-lock and application dependencies are unchanged.

[VERIFIED — external limit] Independent code review reran the 26 output tests with no blockers. Neither Xero nor NetSuite import was executed in a sandbox or live account. Controller confirmation flags are local configuration assertions until authenticated settings controls exist. Files are cumulative review snapshots; repeat import safety and reversals remain the controller's responsibility.
