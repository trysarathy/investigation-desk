# Accounting finality review

## Scope and result

[VERIFIED] Reviewed the complete diffs of PR #72 at `cdf1ef2f45ab3041ad6d6eb0cecf7b2d2ce7e67c` and PR #74 at `8729afda5b728dae817a23f55cc4f069590c9249`, each against `28b62de3fdbb4858423fd7ee30946e7f4e5ca774`. Neither narrow diff needed a correctness fix. This is a local review, not an independent approval of the code below.

- [VERIFIED] #72 requires both network and recipient checks before paid wording, including the overpayment path (`src/lib/requests/release-headline.ts:93–118`). Its four new regressions cover absent and not-run attribution checks for exact and overpayments (`tests/release-checks.test.ts:372–389`). It does not change posting eligibility.
- [VERIFIED] #74 removes the irreversible-payment guarantee and block-gap-derived wait estimate. The remaining text reports the network's result without promising an arrival time (`review/finality-copy:src/lib/requests/release-checks.ts:34–35`; `src/lib/demo-slices/release.ts:68`). This does not add any finality enforcement.
- [VERIFIED] Before this patch, `approveAndPost` accepted a ready plan without reading finality. The plan counted observations by confirmations (`src/lib/accounting/rules.ts:110`). A confirmation count is no longer sufficient to send that plan to external books.

## Fix

[VERIFIED] External accounting writes now re-read the Ethereum `finalized` head, transaction receipt and canonical block before calling the adapter (`src/lib/accounting/engine.ts:45–63`; `src/lib/accounting/finality.ts:11–48`). The receipt must be successful, in the earlier observed block, at or below finalized height, with the exact transfer index, contract, sender, recipient and integer amount. Block time must still match the payment date. Missing, malformed, changed or unavailable evidence records a refusal; no accounting line is sent. Every counted transfer is checked before the first adapter call, including earlier transfers supporting a writeoff or retry.

[VERIFIED] The service creates an uncached keyless RPC reader; offline replay and disabled live lookups cannot satisfy the live posting check (`src/lib/accounting/service.ts:74–78`). Only the in-process `DemoBooksAdapter` is exempt. A caller's `demo` flag cannot exempt an external adapter. Confirmation thresholds remain preliminary matching rules, not finality evidence.

## Checks

[VERIFIED] Commands run on each unchanged PR head: `npx tsc --noEmit`, `npx vitest run`, `npx next build`.

| Head | Typecheck | Tests | Build |
| --- | --- | --- | --- |
| #72 cdf1ef2 | Pass | 830 passed; 67 skipped; 1 todo | Pass |
| #74 8729afd | Pass | 826 passed; 67 skipped; 1 todo | Pass |
| This patch | Pass | 849 passed; 67 skipped; 1 todo | Pass |

The first setup reused an incomplete dependency directory and failed to resolve `qrcode`; `npm ci --ignore-scripts --no-audit --no-fund` installed the lockfile dependencies, then all three checks were rerun on both exact heads. No source change was needed for that setup issue.

[VERIFIED] Restoring the pre-fix engine made all 18 initial finality regressions fail; restoring the fix passed them. The additional multi-transfer test checks that a removed second transfer prevents the first line from posting. Tests use synthetic provider responses and spy accounting adapters, never real books or customer data.

## Limits and merge dependencies

- [VERIFIED] Accounting requests currently target Ethereum only (`src/lib/requests/types.ts:9`). This patch does not authorize Tron or L2 accounting writes.
- [ASSUMPTION] The configured Ethereum RPC reports the chain honestly. This is not a light client, consensus verifier or independent multi-provider quorum. No live-provider or live-Xero smoke test was performed.
- [VERIFIED] Existing expected-key optionality, request-store/accounting-store race risk and independent price-source policy remain outside this small finality fix. Do not describe the whole accounting integration as production-certified.
- [VERIFIED] Dependency order from current PR bases: #65 → #67 → #68 → #66 → #69; #72 and #74 are siblings based on #69. This patch targets #72's branch. Integrate this patch into #72, then #72 and #74 into #69, preserving the whole stack when choosing final merge targets. The arrows describe prerequisite content, not permission to merge. No merge was performed.
