# M1 input validation

[VERIFIED — commands executed on this branch] `npm ci` completed. `npx tsc --noEmit` exited 0. `npx vitest run` exited 0: 615 passed, 57 skipped, 23 passing files and one skipped file. The 24 funding input tests cover the five synthetic CSVs, remembered mappings, exact amounts, dates, provenance tampering, conflicting IDs, bad rows, failed-write preservation, writer exclusion and concurrent store instances. `npx next build` exited 0.

[VERIFIED — implementation scope] No app route or existing UI changed. No bank connection, authentication, approval decision, repayment allocation or accounting export is delivered by M1. No browser screenshot is claimed. The existing 57 real-record tests remain skipped; passing synthetic tests are not customer validation.

[VERIFIED — review process] Independent code and QA reviewers inspected the input boundary. Their early findings about persisted state, identity and source tampering were fixed by validating the entire store against canonical replay of retained CSV batches on load and write. A later milestone must extend this with validated decision/event history rather than trusting mutable state fields.

[ASSUMPTION — deployment constraint] Use one Node process and a provider-owned local filesystem. Writer-directory exclusion rejects overlapping processes; stale locks need operator inspection after a crash. Whole-file replay validation is deliberately small-pilot storage, not a high-volume or distributed database design.
