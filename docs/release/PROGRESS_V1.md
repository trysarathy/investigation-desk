# Clearline v1: progress

Updated after every PR. If a session is interrupted, resume from the "Next" line.

Base: Phase 0 stack #164–#175 on `release/v1` (top `v1/p0-12-settlement-numbers`, 6352925). Nothing is merged.

## Phase 0 (done, reported 24 Nov 2026)
12 stacked draft PRs #164–#175. Founder decisions on them (25 Nov 2026): #167, #171, #173, #174 approved; #170 approved
once the existing isolation tests pass unchanged on it — shown 25 Nov: the pre-#170 versions of
`chain-reads-partitioning.test.ts`, `chain-verify.test.ts` and `provider-console.test.ts` ran on #170's code on a fresh
database: 3 files, 18/18 passed [VERIFIED]; the full control suite on the stack top: 414/414 [VERIFIED].

## v1 continuous build

| Phase | Status | PRs | Notes |
|---|---|---|---|
| 0.5 Matching useful | in progress | — | blind breakdown, evidence-level split, other-currency accounts, property tests |
| decision follow-ups | in progress | — | needs-a-rate, IAS 21 draft, refund rows, partitions 24 months, deploy-env required, CI flake, #115 |
| 1 Accounts, security, access | in progress | — | onboarding + provisioning role, MFA/passkeys/reset/sessions/limits/SSO, entity scoping, access review |
| 2 Real data connections | not started | | |
| 3 Volume and workers | not started | | |
| 4 Accounting workflow | not started | | |
| 5 Security, privacy, ops | not started | | |
| 6 Deployment (ready, not provisioned) | not started | | |
| 7 Prove it | not started | | |
| 8 Go-live gate | not started | | |

## Next
Integrate wave 1 (Phase 0.5, follow-ups, Phase 1), run every suite on the combined stack, push stacked draft PRs on #175.
