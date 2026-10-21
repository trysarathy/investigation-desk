# Stablecoin Payment Investigation Desk

Build week 1 of Product Spec v1 (21 Oct 2026): app shell, design tokens, the case queue and the
investigation view, running on **fabricated sample data**. The rules engine (D01–D14, D07b, D99)
is also in, as pure functions. Week 2 needs it, and the investigation view should show verdicts
the code actually computed.

```
npm install
npm run dev        # http://localhost:3000
npm test           # engine fixture tests
npm run build
```

## Layout

| Path | What |
| --- | --- |
| `src/lib/engine/` | `context.ts` derives facts, `evidence.ts` builds the timeline, `rules.ts` holds one pure function per code, `run.ts` picks the verdict |
| `src/lib/fixtures/` | Sample settings, Files A and B, and 17 sample cases (one per code plus the edge cases) |
| `src/lib/templates.ts` | Approved reply templates from the spec |
| `src/lib/view.ts` | Server-side view models; verdicts are computed on the server only |
| `src/app/` | Queue `/`, investigation `/cases/[id]`, `/investigate?q=`, `/bulk`, `/settings` |
| `tests/engine.test.ts` | Fixture tests from spec section 6 |

## Prototype-only switches

- `/?state=empty` shows the new-workspace empty state; `/?state=stale` shows the stale-ledger bar.
- `/?down=tron` (or any chain) simulates a chain API outage. Affected cases show "Check paused".
- On `CS-1057`, press **R**: the re-check flips D02 to D12 and shows the red contradiction banner.

## Deliberate deviations from the spec (need sign-off)

1. **D02 only matches a deposit that would otherwise be credited** (company address, allowlisted
   official token, at or above minimum, no freeze). In strict catalogue order a fake token or a
   below-minimum deposit with few confirmations would get D02, whose reply says "it will be credited
   automatically".
2. **D05 skips tokens impersonating USDT or USDC.** Otherwise D05 (earlier in the order) would hide D06.
3. **D07 yields to D07b** when the look-alike and dust-transfer pattern is present. Otherwise D07
   (High) always beats D07b (Medium) and D07b could never show.
4. **A ledger row marked REJECTED for a confirmed, valid deposit gives D99**: the catalogue has no code for it.
5. **D13 and D14 use only an exact `tx_hash` join.** A row without a hash that matches on address
   and amount is shown as evidence but never decides a High verdict.

## Not built yet (by plan)

Chain fetchers (week 2); CSV upload and validation, AI text and its validator, bulk (week 4);
auth, roles, row-level security, audit log, rule versioning (week 5). Official contracts other
than USDT on Tron and USDT on Ethereum stay unset until checked against Tether's and Circle's own
pages. With them unset, D06 does not run for those pairs.
