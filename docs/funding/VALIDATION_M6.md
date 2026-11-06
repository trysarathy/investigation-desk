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

## First remote browser run

[VERIFIED] GitHub Actions run 42286677542 passed the two security cases but failed both journey cases at initial navigation: `/` served the build-time earlier-product redirect to `/requests`. Runtime funding mode now redirects `/` to `/funding` in middleware before that static page can run. Two focused middleware regressions cover the redirect and legacy-route refusal. The browser assertions remain unchanged; the next remote run is still required.

The runtime redirect uses the configured public origin rather than Next's normalized request hostname. Logout also clears the prior user's selected case and pending import form. Typecheck, scoped lint, the 19 focused middleware/route checks and production build pass for this correction. The remote browser rerun remains required.

## Second remote browser run

[VERIFIED] Run 42287663427 reached the funding page but maker login failed the configured-Origin check after root navigation; direct funding-page viewer login passed. The middleware absolute redirect was not sufficient to preserve the browser origin through Next's adapter. Root is now explicitly dynamic and uses its existing relative server redirect. Middleware still refuses legacy routes and does not rewrite the root hostname. Origin/CSRF checks and the browser journey remain strict; the harness now also asserts the exact landing origin. A fresh remote run is required.
