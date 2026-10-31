# 14-day dependency map

Source of truth for steps and status: `docs/PLAN_14_DAY.md` (step ids D<day>.<n>). This file is the
graph and the critical path, so the nightly plan picks unblocked work first and names blockers
precisely. Written 2026-11-01 SGT; all steps not started.

## Graph (A = needs Aashmiin; AO = approval-only PR she merges)

```
A: branch rule requires `ci` (D1.3) ─────────────────────────────► enables auto-merge (else she merges all)

A: approve ADR 0002 ──► D2.1 PR(a) orgTimeZone [AO] ──► D3.1 PR(b) Xero /Organisation + scope [AO] ─┐
                                                                                                      │
A: Xero dev app + connect Demo Company (Day 3) ───────────────────────────────────────────────────────┤
A: posting spec: wallet bank acct + fee acct (Day 3) ──► D5.2 account settings [AO] ──────────────────┤
                                                                                                      ▼
D2.3 scenario catalogue ──► D2.4 ADR 0003 ──► A: choose source ──► D5.1 batch 1 ──► D6.1 batch 2 ──► D7.1 20-run (demo books)
D3.2 watch.ts (pure) ──► D4.1 watcher route ──► D6.2 wrong-network recorded ───────────────────────┘      │
                     └─► D4.2 connect-wallet UI ─────────────────────────────────────────────────────────┤
                                                                                                         ▼
                                                        D8.1 exceptions queue, D9.1 explanations, D9.2 posting-date display
                                                                                                         ▼
D10.1 demo:check script, D10.2 Xero verify script ──► D11.1 live run on Xero Demo Company ──► D12.1 fixes
                                                                                                         ▼
                                                     D13.1 DEMO.md (A: Xero screenshots) ──► D14.1 clean reproduction ──► D14.2 final status
Independent (operating-model order, fit in gaps): D2.2 reorg dismiss, D3.3 contrast fix, D4.3 sec #1/#4a [AO], D5.3 sec #2 [AO], D6.3 sec #6 [AO]
```

## Critical path (longest chain; slip here moves Day 14)
`A: ADR 0002 approval → D2.1 → (A merges) → D3.1 → (A merges) + A: Xero connected → D11.1 → D13.1 → D14.1`
Every link marked A is a human step. The tech lead's job is to make each one a 2-minute decision:
3-line Approval Queue row, PR green and reviewed, exact clicks written.

Second path: `D2.3 → D2.4 → A: source choice → D5.1 → D6.1 → D7.1 → D8.1`.

## Per target item: what must be true
| Target | Needs | Aashmiin steps |
|---|---|---|
| 1 Connect wallet (read-only) + Xero demo org | D3.2, D4.1, D4.2; Xero app + connection; D3.1 (scope) | Xero app, connect Demo Company |
| 2 20 payments arrive | D2.3, D2.4, D5.1, D6.1 (+ D4.1 if watched) | choose source (ADR 0003) |
| 3 Matched or flagged, plain English | exists today (`lifecycle.ts`, `present.ts`) + D6.2, D9.1 | none |
| 4 Correct entries in Xero (accounts, cents, org-local date) | D2.1, D3.1, D5.2, D10.2, D11.1 | approve ADR 0002, posting spec, merge AO PRs, connection |
| 5 Exceptions queue with reasons | D8.1 (+ D6.2) | none |
| 6 DEMO.md walkthrough | D10.1, D11.1, D13.1, D14.1 | Xero screenshots |

## Latest-safe dates for Aashmiin's steps (after these, Day 14 slips)
| Step | Latest | Why |
|---|---|---|
| Approve ADR 0002 + merge D2.1 | Day 4 | D3.1 needs D2.1 on `main`; D11.1 needs both |
| Xero app + Demo Company connected | Day 9 | D10.2 needs a connection to test the read-only verify script |
| Posting spec (accounts) | Day 5 | D5.2 |
| Scenario source choice | Day 4 | D5.1 must start by Day 5 |
| Merge D3.1 + D5.2 | Day 10 | D11.1 is Day 11 |
These are planning estimates [GUESS: one engineer-run per task, no rework], re-checked each night.

## Risks on the map
- Xero Demo Company region, base currency and timezone are unknown until connected
  [ASSUMPTION: not checked]. Only USD invoices post (`rules.ts`): if the Demo Company's base
  currency isn't USD, USD invoices may need multi-currency. Check on connection (D3.1 reads
  `/Organisation`, which includes the base currency).
- If testnet is chosen: a testnet chain and its official token contract must be added (from the
  issuer's own page only), and counterfeit/look-alike cases need someone to sign testnet
  transactions; agents never sign. Adds ~3-4 tasks and Aashmiin's time.
- Branch rule unchanged → nothing auto-merges; every PR waits for her; throughput depends on her
  merging daily.
