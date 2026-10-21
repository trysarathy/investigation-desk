# Stablecoin Payment Investigation Desk

Build week 1 of Product Spec v1 (21 Oct 2026): app shell, design tokens, the case queue and the
investigation view, running on **fabricated sample data**. The rules engine (D01–D14, D16, D07b, D99)
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
| `src/lib/fixtures/` | Sample settings, Files A and B, and 20 sample cases (one per code plus the edge cases) |
| `src/lib/templates.ts` | Approved reply templates from the spec |
| `src/lib/view.ts` | Server-side view models; verdicts are computed on the server only |
| `src/app/` | Queue `/`, investigation `/cases/[id]`, `/investigate?q=`, `/bulk`, `/settings` |
| `tests/engine.test.ts` | Fixture tests from spec section 6 |

## Prototype-only switches

- `/?state=empty` shows the new-workspace empty state; `/?state=stale` shows the stale-ledger bar.
- `/?down=tron` (or any chain) simulates a chain API outage. Affected cases show "Check paused".
- On `CS-1057`, press **R**: the re-check flips D02 to D12 and shows the red contradiction banner.

## Rule precedence (spec, signed off 21 Oct, revised 22 Oct)

Guards inside the rules override strict "first High match wins" (see `src/lib/engine/rules.ts`):

1. D02 matches only a deposit that would otherwise be credited.
2. D05 skips tokens whose symbol is USDT or USDC, so D06 is never hidden.
3. D07 always stands. When the look-alike pattern is present, D07b is attached as a Medium
   "likely cause" finding that the analyst confirms. Any other matched Medium rule is attached the same way.
4. A REJECTED ledger row on a valid confirmed deposit is D16 "Rejected by company", not D99.
5. D12, D13, D14 and D16 are High only on an exact match of chain + tx_hash + transfer index +
   token contract. File B has an optional `transfer_index` column (EVM log index or Tron event
   index). Without it, a tx with more than one transfer to company addresses caps at Medium.
   A row matched on address and amount only also caps at Medium.

No reply template may promise a future credit; a test fails on "will be credited".

## Payout workflow hedge

`Facts.workflow` (`"deposit" | "payout"`) and `Facts.providerEvents` already hold payout
creation, provider statuses (verbatim) and later returns with their reason, and they render as
evidence with a provider source. A payout workflow would add a provider fetcher that fills
`providerEvents`, a second rule list (P-codes) selected by `workflow` in `run.ts`, and templates
for those codes. The verdict picker, findings, evidence, UI and audit record stay as they are.

## Not built yet (by plan)

Chain fetchers (week 2); CSV upload and validation, AI text and its validator, bulk (week 4);
auth, roles, row-level security, audit log, rule versioning (week 5). Official contracts other
than USDT on Tron and USDT on Ethereum stay unset until checked against Tether's and Circle's own
pages. With them unset, D06 does not run for those pairs.
