# M2 validation

[VERIFIED — executed commands] `npx tsc --noEmit` exited 0. `npx vitest run` exited 0: 635 passed, 57 skipped; 24 passing files, one skipped file. `npx next build` exited 0. The 44 funding tests include 20 M2 scenarios: named preparation/approval/decline, each check, actual unpaid exposure, partial payout reservation, distinct-invoice concurrent approval, stale revisions, missing/future/stale cash, historical-state query refusal, edited snapshots, append-only histories and M1 migration.

[VERIFIED — independent review] Code and QA reviewers inspected the work. Their early findings led to runtime event validation, explicit historical-query rejection, retained undisbursed reservations after partial payout and the distinct-invoice concurrency test. Independent QA reran all 44 funding tests and separately probed partial-payout headroom, M1 migration and future-event refusal.

[VERIFIED — scope] No HTTP endpoint, sign-in, live provider call, payout instruction or UI was added. Browser screenshots are not claimed. Existing real-record tests remain skipped. User identities and historical times come from trusted local inputs until M7 supplies server authentication and server-assigned live action timestamps. A synthetic test result is not financial or legal validation.
