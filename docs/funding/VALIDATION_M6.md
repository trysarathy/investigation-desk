# M6 candidate validation

[VERIFIED] TypeScript typecheck and production Next build exit 0. Full Vitest run: 716 passed, 57 skipped. The new route suite has 17 passing tests. Scoped ESLint passes on new funding server/API/UI/setup/tests; full-repository lint still reports the existing 20 errors and 41 warnings. No claim that those unrelated errors were fixed.

The route tests exercise real Request/Response handlers against disposable synthetic stores: authentication, HTTP-only sessions, server-bound identity, Origin and CSRF refusal, maker/checker and viewer restrictions, recorded decline reason, every export format, non-accounting exports without ERP settings, append-only cash classifications, stale bank observation times, remembered provider mappings, future-row visibility, logout/password-revocation invalidation, normal-mode simulation refusal and streaming body limits.

A local production server reported ready, but a separate HTTP probe could not connect in this environment. Browser acceptance remains **pending**, not passed. The draft-PR workflow runs the actual production server in GitHub Actions with disposable synthetic stores, isolated desktop and phone journeys, console-error assertions, screenshots and build provenance. M6 is not accepted until that run and its screenshots have been reviewed.

## Review fixes included

- Reclassification no longer stamps an old bank balance as newly observed; the operator supplies its actual observation time.
- Generated classification CSVs retain the provider's remembered mapping.
- Unknown/future advances do not break or leak into the visible queue.
- Open-advance files and digests do not depend on controller/ERP account mappings.
- Expired or revoked sessions return 401 on mutation; normal anonymous UI bootstrap uses a quiet data-free session probe.
- Journal filenames use the existing adapter names and XLSX downloads use workbook bytes.
- Existing CLI `.js` import specifiers resolve their TypeScript sources in the Next build; CLI semantics remain unchanged.

The browser suite is an acceptance gate, not a substitute for a real provider trial. No public deployment, real customer data, live money, ERP import or communication was tested. Authentication baseline uses one server process; full audit/security/retention work belongs to M7.
