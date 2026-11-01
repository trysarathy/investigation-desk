# Task 6: held-out numbers from the harness output

Inputs: `fixtures/t6-task-note.md`, `fixtures/t6-harness-output.csv` (fictional run, code sha 9d0a7e2,
2026-11-25 SGT, held-out look #1 for this change, logged by the harness). Definitions from
`team/knowledge/matching-engine-engineer/metrics.md`. Counts and intervals computed with a python
script over the CSV in this run [VERIFIED: computed in this run (real date 2026-11-01), python, Wilson
z = 1.959964; zero-event bound 1 − 0.05^(1/n)].

How I counted:
- The CSV has 43 rows: **40 holdout**, 3 tuning (M-EXACT-T01..T03). The 3 tuning rows are **excluded**
  from everything below (never combine splits).
- TP = system auto-matched to the labelled invoice. FM = any other auto-match (wrong invoice, or an
  auto-match on a case labelled review/flag: "unauthorised", metrics.md confusion table).
- Abstain = system `review` (a person decides) ÷ cases. A flag is not an abstain.
- Flag accuracy = system `flag` ÷ cases labelled `flag`.
- Rows with < 5 held-out cases are marked **n too small to report** (playbook §1.4.4); counts shown for
  the internal record only, not for any outward use.

## Section for `docs/MATCHING_EVALS.md`

```markdown
## Held-out invoice-matching results: code sha 9d0a7e2, run 2026-11-25 SGT (look #1 for this change, logged)
Real transfers, SAMPLE invoices. n = 40 held-out cases. Tuning rows in the same output (3) are not included.

### Overall (n = 40)
| Metric | k / m | Rate | 95% Wilson |
|---|---|---|---|
| False-match rate (wrong auto-matches ÷ auto-matches) | **2 / 14** | 14.3% | 4.0%-39.9% |
| Auto-match precision | 12 / 14 | 85.7% | 60.1%-96.0% |
| False matches per case | 2 / 40 | 5.0% | 1.4%-16.5% |
| Recall on exact cases | 12 / 15 | 80.0% | 54.8%-93.0% |
| Abstain rate (sent to a person) | 17 / 40 | 42.5% | 28.5%-57.8% |
| Flag accuracy | 9 / 10 | 90.0% | 59.6%-98.2% |

### Per case type
| Case type | n | Auto-matches | TP | False matches | FMR (k/m, Wilson) | Recall exact | Abstain (k/n, Wilson) | Flag accuracy | Reportable? |
|---|---|---|---|---|---|---|---|---|---|
| exact | 15 | 13 | 12 | **1** (M-EXACT-013: linked S-INV-299, same amount, true S-INV-212) | 1/13 = 7.7% (1.4%-33.3%) | 12/15 = 80.0% (54.8%-93.0%); misses: 013 (wrong link), 014 and 015 (sent to review, cheap) | 2/15 = 13.3% (3.7%-37.9%) | — | yes |
| partial | 5 | 0 | 0 | 0 | none made (0 auto-matches); false matches per case 0/5 (Wilson 0%-43.4%; zero-event ≤ 45.1%) | — | 5/5 = 100% (56.6%-100%) | — | yes |
| overpayment | 4 | 1 | 0 | **1** (M-OVER-024: overpaid by 50.00, marked matched; label review) | 1/1 (20.7%-100%) | — | 3/4 (30.1%-95.4%) | — | **n too small to report** (4 < 5) |
| multiple invoices | 6 | 0 | 0 | 0 | none made; false matches per case 0/6 (Wilson 0%-39.0%; zero-event ≤ 39.3%) | — | 6/6 = 100% (61.0%-100%) | — | yes |
| wrong token | 3 | 0 | 0 | 0 | none made; 0/3 per case (zero-event ≤ 63.2%) | — | 0/3 | 3/3 (43.9%-100%) | **n too small to report** |
| wrong network | 3 | 0 | 0 | 0 | none made; 0/3 per case (zero-event ≤ 63.2%) | — | 1/3 (M-NET-036 went to review instead of flag: safe, but a missed flag) | 2/3 (20.8%-93.9%) | **n too small to report** |
| look-alike address | 4 | 0 | 0 | 0 | none made; 0/4 per case (Wilson 0%-49.0%; zero-event ≤ 52.7%) | — | 0/4 | 4/4 (51.0%-100%) | **n too small to report** |
| **Overall** | **40** | **14** | **12** | **2** | **2/14 = 14.3% (4.0%-39.9%)** | **12/15** | **17/40** | **9/10** | |

Notes:
- Both false matches are incidents (playbook §5); see "Incidents". This is the held-out number for sha
  9d0a7e2 and it stands as reported: it is not re-computed after any fix.
- Stratification: overpayment, wrong token, wrong network and look-alike have < 5 held-out cases. This
  output shows only 3 tuning cases (all exact); if that is the whole tuning set, no case type meets the
  ≥ 5 tuning rule either.
- Held-out look log: 2026-11-25 | harness (run by matching-engine-engineer) | sha 9d0a7e2 | final check of
  the change | 2 FM / 14 auto-matches, n = 40. Look #1 for this change.
```

## What it means for shipping (three lines)
1. **It cannot ship.** 2 false matches in 14 held-out auto-matches (14.3%, 95% Wilson 4.0%-39.9%) against
   a target of 0; one booked an exact-type payment to another invoice with the same amount, the other
   marked an overpaid invoice "matched" (both rules the spec says go to a person).
2. Each is a §5 incident: root-cause it on **new tuning cases** that reproduce it (failing tests first),
   never by tuning on these held-out rows; this 2/14 stays the reported result for 9d0a7e2, and the next
   check is look #2, logged and stated beside its number (or a fresh held-out batch).
3. If the change is what made the system link by amount (M-EXACT-013) or accept an overpayment
   (M-OVER-024), it is a looser change in effect and goes to Aashmiin's Approval Queue whatever the fix;
   the case types with n < 5 can't support any claim either way.

## Rows I would write
- `2026-11-25 <time> | matching-engine-engineer | RISK: false match on held-out (2) | sha 9d0a7e2: M-EXACT-013
  auto-linked S-INV-299 (true S-INV-212, same amount); M-OVER-024 overpaid by 50.00 marked matched (label
  review). FMR 2/14 (n=40, Wilson 4.0%-39.9%). Change not shippable; root cause on new tuning cases |
  harness output, look #1`
- `… | matching-engine-engineer | held-out look #1 logged | 2026-11-25 sha 9d0a7e2 reason "final check of
  change" result FM 2/14, abstain 17/40, recall exact 12/15 | tests/matching/HOLDOUT_LOOKS.md,
  docs/MATCHING_EVALS.md §5`
- `… | matching-engine-engineer | summary | task: <change id>; PR: <#> (not shippable); FMR held-out 2/14
  (n=40, 95% ≤ 39.9%); abstain 17/40; recall exact 12/15; held-out looks: 1; blocked: 2 false matches,
  incident §5`
