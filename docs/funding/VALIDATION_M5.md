# M5 validation

[VERIFIED] The normal `funding-evidence` CLI produced a synthetic per-advance ZIP and its detached hashes, and its verify command accepted that pack. Independent QA also inspected ZIP members and hashes using Python. No file was sent and no ERP or bank acceptance was tested.

[VERIFIED] Focused tests cover deterministic archive bytes; exact historical decision snapshots; later receipts excluded at earlier checkpoints; declined and import-only cases; unknown advances; altered archive, manifest, payload, missing and extra files; malformed ZIP bounds and CRC; duplicate names; high-bit and traversal names; safe paths for arbitrary original filenames; and same raw CSV imported under two different mappings without mixing cash accounts.

The verifier requires separately trusted expected hashes. Tests that replace the outer archive checksum do so deliberately to reach inner parser and manifest checks. That does not establish trust in a replacement sidecar.

## Commands and results

- `npx tsc --noEmit`: exit 0.
- Scoped ESLint on evidence implementation, ZIP helper, CLI and tests: exit 0.
- `npx vitest run tests/funding/evidence.test.ts`: 16 passed.
- `npx vitest run`: 699 passed, 57 skipped.
- `npm run build`: exit 0.

[VERIFIED] A reviewer found source hash/row collisions could mix cash from another mapped account. Selection now follows the original policy's account, currency, visibility and latest snapshot criteria, within the event's import prefix. A regression imports identical bytes twice with different ID/account mappings and checks only the original account's four buckets are used.

[ASSUMPTION] The provider retains trusted hashes separately and limits access to full raw CSVs. Complete files may include unrelated customers or later-known rows. Raw source assertions are not independently authenticated. No browser acceptance is needed for this file-only milestone; UI follows in M6.
