# M7 security and audit validation

This milestone adds private deployment controls and an integrity-checkable audit history. It is not a claim of security certification or regulator/auditor approval. See [security, retention and recovery](SECURITY_M7.md) for trust boundaries and provider responsibilities.

## Audit interface

The persisted file is a `clearline-funding/v2` envelope containing canonical domain data and a hash-chained audit array. A business update and its audit entry are one atomic replacement under the provider writer lease. Read/check/export entries preserve the business revision. Each entry binds the current domain-data SHA-256 and prior entry hash.

Imports record source hashes and accepted/duplicate IDs. Decisions record server-derived actor identity and original check snapshots. Explicit UI review requests are logged, not each internal replay calculation. Export events distinguish prepared bytes from locally written files; HTTP downloads never claim client receipt or ERP delivery. Authenticated requests that fail are recorded without raw credentials or request bodies.

The normal `--data` export and evidence CLIs read the envelope and attribute their audit activity to a local administrator process, not a named web user. In-memory `--sample` CLI runs remain isolated synthetic demonstrations without a persistent provider audit store. The UI sample deployment does have a persistent audit store.

## Verify and retain a trusted anchor

```sh
npm run funding-audit -- --data /private/provider/funding.json --anchor-out /private/separate-record/anchor.json
npm run funding-audit -- --data /private/provider/funding.json --verify-anchor /private/separate-record/anchor.json
```

Keep the anchor outside the store's ordinary write authority. Without an independently retained anchor, a complete rebuilt/replaced chain cannot be excluded. Verification accepts extensions containing the trusted anchor and rejects truncation before it. Inspecting a legacy raw store validates its complete domain history and persists a migration entry before returning an anchor. It does not fabricate retrospective audit identities.

## Upgrade an M6 deployment

Stop every server/CLI writer. Back up the deployment and inspect its ownership and paths. M6 could create `funding.json` or `access.json` with mode 0644 inside its private directory; M7 refuses those files. After confirming they are owned regular files, set the deployment directory to 0700 and the known private files (`funding.json`, `access.json`, optional `export-settings.json` and synthetic CSVs) to 0600. Do not recursively chmod unknown paths or follow symlinks. Run the audit command above to validate and migrate, retain its anchor separately, then start the single server. Source records and business revision are preserved by migration.

The store is bounded to 64 MiB and 100,000 audit entries. It fails closed at capacity. Monitor size/entry count and stop for a provider-approved archival/replacement process before reaching these bounds. There is no automatic log truncation, archival or retention scheduler.

## Candidate checks

Focused audit tests cover record tampering, deletion/reordering, current-data binding, durable legacy anchors, valid-prefix truncation, concurrent audits/business updates, unchanged business revision for views, rejected stale export snapshots, failed mutations, deterministic evidence across audit activity and private file/path enforcement.

Auth tests cover fixed bounded asynchronous scrypt, concurrent login limits, account/global throttles, credential revocation, expiry/logout, deployment binding, strict configuration, HTTPS except loopback, malformed UTF-8/JSON, streaming caps/cancellation and clock-audit failure reporting.

[VERIFIED] Candidate fee8ada passed typecheck, 751 tests (57 skipped), and production build. An independent reviewer reproduced those results in an isolated checkout. QA independently passed 50 auth/audit/route probes, including two identical HTTP evidence downloads while audit entries grew and business revision did not change. Scoped lint has no errors; inherited unused-parameter warnings in the touched store were then removed. Full-repository lint retains the unrelated 20 errors and 41 warnings previously recorded.

[VERIFIED] Vitest is pinned to 4.1.12; a PostCSS override resolves 8.5.23 while Next remains 15.5.28. `npm audit` reports zero known vulnerabilities at this check. That is a dependency-advisory result, not proof that the app has no vulnerabilities.

[VERIFIED] Normal CLI smoke: private synthetic setup, anchor creation, file export, two evidence exports and trusted-anchor verification all exited 0. Evidence ZIP bytes matched; business revision remained 1 while the audit reached 8 entries. Every deployment file was mode 0600. Tests cover rejected unsafe/symlink paths and directories inside the application repository.

Browser regression remains pending the M7 draft PR run. No live customer data or external messages were used.
