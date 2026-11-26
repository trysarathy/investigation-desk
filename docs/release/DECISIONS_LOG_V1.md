# Clearline v1: decisions log

Decisions taken during the v1 build that the founder's instructions did not cover. Each one takes the most
conservative option: it never loosens matching, weakens security, costs money or touches legal text. Every entry says
how to reverse it. Founder decisions themselves are recorded in `PROGRESS_V1.md` and the PR descriptions, not here.

| # | Date | Area | Decision | Why | How to reverse |
|---|---|---|---|---|---|
| 1 | 2026-11-25 | CI | Every browser spec waits for a non-empty `<title>` before running axe, not only the one that flaked. | With `retries: 0` the same streamed-title gap could fail any axe check after a client-side navigation. | Remove the `waitForFunction(... document.title ...)` lines in `tests/browser/*.spec.ts`. |
| 2 | 2026-11-25 | Docs | #115's five rc5 docs are kept as history (`docs/history/rc5/`, `docs/security/THREAT_MODEL_V0_RC5.md`); ADR 0004 goes into `docs/adr/` as it is still accurate. | Fold in what is useful without presenting rc5 plans as current. | Delete those files. |
