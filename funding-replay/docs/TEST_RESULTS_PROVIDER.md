# Test results — provider funding desk release candidate

**Synthetic prototype — no funds move.** Recorded 5 Nov 2026.

- **Tested source:** `trysarathy/investigation-desk@5e2df82` (branch `provider-funding-lifecycle`, `funding-replay/`).
  The commit that adds this file adds only tests and docs; the engine, UI and exporter are byte-identical to 5e2df82.
- **Build:** `python3 tools/export_site.py <out>` from 5e2df82. `build.txt` and the page footer both read
  "Build 5e2df82". There are 1,315 states, every one checked against the invariants at export:

  | Case | States |
  |---|---|
  | reference | 400 |
  | stale_balance | 458 |
  | fixed_terms | 17 |
  | no_cash | 53 |
  | competing | 53 |
  | failed_payout | 331 |
  | all_infeasible | 3 |

  The state cap is 600 per case. If a case exceeds it, the walk raises an error rather than truncating, and this
  is regression-tested.
- **Deployed:** `trysarathy/clearline-funding-desk` main @ `5c61373`. GitHub shows the Vercel status as "Deployment has
  completed" (deployment `D6bmFaZbHmc1gRQR7iKfMNZN7176`). Previous production was `774f739`.

## Suites (all run on 5e2df82 or its export)
| Suite | Result |
|---|---|
| `python3 -m unittest discover -s tests`: engine, lifecycle, parity, server, replay challenge and the lifecycle challenger | **206 OK** at 5e2df82; **208 OK** with the challenger's 2 final regression tests, which are added in this commit |
| `node tests/browser/lifecycle.cjs <export>`: provider desk journey and all cases, file:// | **596/596** |
| Integration lead's independent mentor check: the export served over HTTP like a static host, normal entry point, **every step double-clicked**, state id and on-screen amounts compared with the engine, laptop 1366×768 and phone 390×844 | **218/218** |
| `node tests/browser/recipient.cjs <export>/replay`: earlier replay, still shipped at `/replay/` | **24/24** |
| `node tests/browser/offline.cjs <export>/replay` | **54/54 states** |
| `node tests/browser/e2e.cjs`: replay dev server | **123/123** |

## The mentor journey, verified in the browser (reference case)
1. **Friday 15:00.** The headline is neutral: "Decision needed: how does Harbor Provisions get paid by Wed 18 Nov?"
   - Three routes are shown side by side: A feasible, B infeasible (no documented Monday cash support; a forecast
     doesn't count), C feasible.
   - The actions are listed in option order (Option A first).
   - Exposure reads "No advance drawn".
2. **Reserve capacity.** Reserved SGD 135,382.50; company available SGD 164,617.50; principal outstanding **SGD 0.00**.
   No cash is drawn.
3. **Record simulated draw.** Principal SGD 135,382.50 plus the fee of SGD 150.00. Exposure is Outstanding.
4. **Instruct payout, then Provider accepts payout.** The screen says credit is not yet evidenced; acceptance is not
   credit.
5. **Record beneficiary credit.** Wed 18 Nov 16:20. "Supplier credited; importer repayment outstanding".
   - Exposure is Outstanding SGD 135,532.50 (principal 135,382.50, fees 150.00).
   - The provider (FAC-NW-01) is owed by Northwind, due Fri 20 Nov 17:00.
   - The delivery half is complete and the exposure half is open.
6. **Advance the clock to Wed 23:00, then Thu 10:00.** Every balance is unchanged.
7. **Record customer receipt.** Listed as "not repayment"; exposure unchanged.
8. **Importer pays SGD 100,000.00.** Shown as received but not matched; exposure is unchanged until it is matched.
9. **Match repayment.** Fees SGD 150.00 and principal SGD 99,850.00 are applied; **SGD 35,532.50** principal and
   SGD 0.00 fees remain.
10. **Balance payment, then Match.** Exposure "Ended"; capacity back to SGD 300,000.00. The owner line reads
    "Nothing owed…", never "is owed".
11. **Close.** Case closed.
12. **Reset, then Request advance, then Decline.** "Advance declined — nothing reserved"; no draw, "No advance drawn".

## Independent challenger
Three rounds. The challenger wrote its own invariants from the contract and read only the view JSON.

**Round 1: 16 defects, all found in constructed fixture variants.** None appeared in the shipped cases. All fixed
by 001e29b without weakening a test:
- **D1a–c:** Option B was treated as feasible on support that was too small, too late, or in USD.
- **D2a–c:** advice named an action that doesn't exist.
- **D3a–b:** facts were used before their known_at.
- **D4:** a credit dated before the instruction was accepted.
- **D5, D5b:** float amounts were accepted.
- **M1–M5:** wording problems, a USD/SGD comparison, and age rounding.

**Round 2 (on 001e29b): 7 new tests, all fixed in 5e2df82.**
- **N1a, N1b:** a feasible Option A was hidden behind "wait".
- **N2:** the engine advised "Record Option B" with no action to do it. A `select_b` action was added.
- **N3:** the wording "only feasible route" appeared when two routes were feasible.
- **N4:** a suspension was applied before it was known.
- **N5:** funding figures were shown before their record was known.
- **N6:** "stays outstanding" appeared after repayment.

**Round 3 (on 5e2df82): no findings.**
- Option B never funds alongside C, never sends two instructions, never closes without credit, and is never offered
  on bad support.
- Attacks resisted:
  - a wrong-currency USD payment can be returned at once, can't close the case, and never reduces what is owed;
  - five repeated clicks at each step record each step once;
  - a settled or undrawn case never says "is owed";
  - clock advances never change money;
  - random fuzzing that includes disabled actions stays inside the reachable set.

## Not tested, and known limits
- **Live site.** This session's network policy blocks `*.vercel.app`, so the public URL was never opened from here.
  The Vercel "completed" status shows the deployment built. It does not show which build the alias serves.
- **Policy question, not modelled.** Whether a suspension "for new advances" should also block drawing a reservation
  made before the suspension was known. Today such a reservation can still be drawn.
- **Withdrawn support.** If cash support were withdrawn after Option B was chosen, nothing re-checks it, and no
  fixture can express a withdrawal.
- **State budget.** Fixture variants with valid Option B support would exceed the 600-state cap (568 and 670 states).
  The walk fails loudly, so this only matters if such a fixture is shipped.
- **Unmodelled.** Release of goods, FX accounting, real provider terms and real delivery times are not modelled.
  Roles are simulated, not authentication.
