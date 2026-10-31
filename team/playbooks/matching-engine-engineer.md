# Playbooks: matching-engine-engineer

Every playbook starts with **§0 Pre-flight** and ends with Log rows (company rule 8). Times SGT. Repo:
`trysarathy/investigation-desk`. Never push to `main`. Merge only under `company/OPERATING_MODEL.md` §2,
and never a change that lets more payments auto-match (§4).

## §0 Pre-flight (every run)
1. Settings `PAUSE` and the PAUSE email search (company rule 1). PAUSE = TRUE → one Log row
   `matching-engine-engineer | stopped: PAUSE on` and stop. hatch.sg Google account → stop, report.
2. Open `team/plan/tasks-<today SGT>.md`. **No task assigned to `matching-engine-engineer` → one Log row
   `matching-engine-engineer | no task assigned in tasks-<date>.md; exited` and stop.** Do not pick
   work yourself, however useful it looks; put an idea in a `proposed` roadmap row instead (one line,
   no build).
3. Fresh checkout of `main` in a scratch worktree, `npm ci`, `npx tsc --noEmit`, `npx vitest run`.
   Red main → Log `RISK: main red` and hand to the tech lead / crypto-protocol-engineer; do not fix
   others' code unless that is your assigned task.
4. Read `team/knowledge/matching-engine-engineer/matching-code-today.md`; re-check line numbers you
   will cite.

**Stop conditions (any playbook):** a request to tune on, inspect case-by-case, or copy from the held-out
set; a request to publish a number without n, or to call deposit diagnosis "matching accuracy"; a
request to label from product output or invent labels/transfers; any change that lets more payments
auto-match without a person (→ §4, Approval Queue only); a secret or key anywhere; anything touching
posting to Xero/QuickBooks, money amounts or customer data (approval-only). Stop that task, Log `RISK:`
or a `needs decision` row, carry on with other assigned work.

## §1 Build the evaluation harness (assigned task; split into PRs < 300 lines each)
Goal: a reproducible, offline, labelled evaluation of **invoice matching** by case, separate from the
existing deposit-diagnosis sets.

### 1.1 Layout (PR 1: schema + loader + scorer, no cases)
```
tests/matching/
  schema.ts            case type + validator
  tuning/<case-id>.json      one file per case
  holdout/<case-id>.json     one file per case (never read by tuning tooling)
  recordings/<case-id>.json  raw chain responses (sha256 + fetchedAt), via tests/fixtures/live/replay.ts
  HOLDOUT_LOOKS.md     append-only look log (also mirrored in docs/MATCHING_EVALS.md)
  harness.test.ts      runs tuning only; held-out runs only with MATCH_EVAL_HOLDOUT=1 + MATCH_EVAL_REASON
scripts/matching-eval.ts  prints the per-case table (n, TP, FM, abstain, flag, Wilson 95%)
```
### 1.2 Case schema (one JSON per case)
| Field | Meaning |
|---|---|
| `id` | `M-<case>-<nnn>` e.g. `M-EXACT-001` |
| `case_type` | exact, partial, overpayment, multiple_invoices, wrong_token, wrong_network, lookalike_address, failed, confirming, timing, duplicate_delivery, unidentified |
| `split`, `split_rule`, `split_at` | `tuning`/`holdout`, the rule that assigned it (§1.4), SGT time; never edited |
| `group` | grouping key (sender address, or the invoice book id) |
| `transfer` | chain, tx_hash, log_index, token_contract, from, to, amount (exact decimal string), block_time |
| `provenance` | explorer URL, independent source(s) read (Tronscan/Blockscout/second RPC/issuer event), who collected, date, `recording` path + sha256 |
| `invoices` | the SAMPLE invoice book at decision time: id, customer_ref, amount, token, chain, receiving_address, created_at, status; `"sample": true` on every row |
| `history` | prior observations/decisions the matcher may use (e.g. a paid invoice on the same address) |
| `label` | `expected_action` (auto_match / review / no_match / flag / wait), `true_invoice` (id or null), `flag_kind`, `why` (one sentence from the facts) |
| `labelled_by`, `labelled_at`, `second_labeller`, `agreed` | two labellers; disagreement → `needs_person`, case excluded from metrics until Aashmiin rules |

### 1.3 Labelling rules
1. Label from the **facts**, never from the product. Read the transfer from an independent source; the
   recording is for replay only.
2. `auto_match` only when an exact identifier makes the answer certain under the spec: exactly one open
   invoice uses that address, genuine contract, right chain, exact amount, confirmed, no repeat-payer
   history. Everything ambiguous is `review` even if a human could guess right.
3. Look-alike, wrong network, wrong token, counterfeit, failed → `flag`, `true_invoice` = the invoice the
   payer intended (for explanation), never a match.
4. Unknowable (e.g. two identical invoices, no sender history) → `review`, never a guess.
5. Invoices are **SAMPLE COMPANY DATA (fictional)** until a customer gives real data with written
   consent; say "real transfers, sample invoices" in every report.
6. Never invent a transfer, hash, amount or address. A constructed scenario uses a real transfer with a
   sample invoice built around it, and `why` says what was constructed.

### 1.4 Adding real transfers with provenance (each batch = one PR)
1. Find candidates by public read-only queries (`tests/real-data/tools/chain.py`, `scan_evm.py` style;
   TronGrid v1, Blockscout, public RPC). No keys in files.
2. For each: read status, contract, from/to, amount, block time from **two** sources; record both URLs.
3. **Assign the split before running the product:** group by `group`; split = holdout if
   `sha256(group)` first hex digit ∈ {0,1,2,3} (25%), else tuning; additionally every case newer than the
   current tuning freeze date goes to holdout. Overrides: a transfer that is in **any** held-out set
   (including the deposit-diagnosis `tests/real_cases_holdout.json`) never enters a tuning set — the
   engine code is shared, so tuning on it would leak; a transfer already in the deposit tuning set goes
   to matching tuning. Record `split_rule`.
4. Stratify: each case type needs ≥ 5 tuning and ≥ 5 holdout cases before its row is reported; until
   then the row says "n too small to report".
5. Record raw responses (`RECORD_REAL=1` pattern), store sha256.
6. Label (§1.3) with a second labeller (qa-security-engineer or crypto-protocol-engineer).
7. Only now run the harness on **tuning**.
8. Log row: `added <k> cases (<types>) tuning <a> holdout <b>, PR #n`.

### 1.5 Scoring (scripts/matching-eval.ts)
Per case type and overall, tuning and holdout separately: n, auto-matches, TP, FM, abstain, flags,
FMR with Wilson 95% and zero-event upper bound, recall on exact, abstain rate. Definitions:
`team/knowledge/matching-engine-engineer/metrics.md`. Deterministic: same input, same table.

### 1.6 Held-out looks
Held-out runs only with `MATCH_EVAL_HOLDOUT=1 MATCH_EVAL_REASON="<why>"`; the run appends
`<SGT time> | <agent> | <sha> | <reason> | <summary>` to `tests/matching/HOLDOUT_LOOKS.md` and the
look log table in `docs/MATCHING_EVALS.md`. Allowed reasons: final check of a reviewed change, monthly
report. Never: "see which cases fail", tuning, debugging. A held-out failure → §5-style root cause on a
**new tuning case**; the held-out number reported is the one before the fix.

## §2 Nightly change procedure (trigger: 00:17 SGT, an assigned task in tasks-<date>.md)
1. §0. Restate the task and its acceptance test in one line each; can't → `needs decision` row.
2. Branch `feat/match-<slug>` / `fix/match-<slug>`.
3. **Before:** run the tuning harness (and `npx vitest run`); save the table.
4. Tests first: a failing test (unit and/or a new tuning case) that shows the behaviour to change.
5. Smallest change. Pure functions, exact decimals, unknown → review.
6. **After:** tuning harness again. Any new false match on tuning → stop, don't open the PR.
7. If the change is ready for review: one logged held-out look (§1.6).
8. Update `docs/MATCHING_EVALS.md` in the same PR: date, sha, before/after per case type with n and
   Wilson; "not measured" rows stay.
9. Classify: does it change what auto-matches? (§3/§4). `tsc`, `vitest`, `next build` green, seen.
10. PR with spec + acceptance criteria, failing-test-first evidence, before/after table, CHANGELOG line.
    Reviews: code-reviewer (`team/playbooks/code-review.md`) + qa-security-engineer.
11. Log rows; summary row: `task: <id>; PR #n; FMR holdout <k>/<m> (n=<N>); abstain <x>/<N>; recall
    exact <a>/<b>; held-out looks this cycle: <c>`.

## §3 Threshold or rule change (anything that changes which cases auto-match, abstain or are suggested)
Includes: `attribute()` rules, `autoMark` / `autoMarkPaid`, `suggestMatches` weights and Strong/
Possible/Weak cut-offs, `similarity` weights, `looksAlike` / `compareAddress`, ledger join quality,
engine confidence assignments.
1. Write the proposal: current value (file:line), new value, why, expected effect per case type.
2. Tune on **tuning only**. Show the per-case table before/after.
3. Direction check:
   - **Stricter** (fewer auto-matches, more abstain): normal PR; code-reviewer + QA must both pass;
     may auto-merge only if every §2 condition of the operating model holds.
   - **Looser** (any case type gains auto-matches, a suggestion becomes an automatic action, or a
     flag becomes a match): **approval-only. Never auto-merge.** §4.
   - Unclear → treat as looser.
4. One held-out look, logged. Publish both tables in `docs/MATCHING_EVALS.md`.

## §4 Approval Queue for "more auto-matching"
Draft PR (never merged by you) + Approval Queue row: 3-line summary (what auto-matches now that didn't,
on which case types), the risk (worst false match it allows, e.g. "two open invoices on one address,
exact amount equals the newer one: would book the wrong customer"), the evidence (tuning and held-out
FM k/m with n and Wilson upper bound; how many more auto-matches). Recommendation stated plainly. She
decides; Log row `approval requested: <row>`.

## §5 Incident: a false match is found
Trigger: anyone reports a payment linked/marked paid to the wrong invoice (or a flag-worthy payment
counted).
1. **Stop the spread:** Log `RISK: false match <request id> <tx hash>` at once (chief-of-staff puts it
   top of 07:30). Do not edit, re-post or delete any record, Xero entry or customer data yourself: those
   are approval-only and Aashmiin acts. If an entry is awaiting Approve, say "do not approve" in the RISK
   row.
2. Re-derive from raw chain data, independent of the product (explorer + second source): what the
   transfer was, which invoice it truly belongs to.
3. Root cause in one sentence naming file:function and the rule that allowed the link.
4. If the matching rule can do it again: propose turning the path stricter (e.g. disable the rule) as an
   urgent `bug` row; stricter changes follow §3 (stricter).
5. Add the case to **tuning** (`M-INCIDENT-nnn`), failing test first; the held-out set is not touched.
6. Update `docs/MATCHING_EVALS.md`: incident section (date, case type, root cause, fix PR), and the FMR
   line now counts it.
7. Hand-offs: crypto-protocol-engineer if a chain fact was wrong; accounting-integrations-engineer if an
   entry was prepared/posted; Aashmiin for anything customer-facing.

## §6 Publishing a number (any report, PR, claims request)
Check: task named (invoice matching vs deposit diagnosis); n next to it; split named (tuning/held-out);
date and sha; Wilson 95% when n < 1000; zero events with upper bound; "real transfers, sample invoices"
when true; no "accuracy" for a different task; no combined tuned+held-out figure. A request for an
outward claim (website, deck) is customer-facing: draft the honest line, route to Aashmiin via the
Approval Queue, never publish.

## Fixes after the 1 Nov golden run (grader findings)
- **Passive exposure counts as a look (§1.6).** If held-out results are shown to you in any form (a pasted
  table, a PR comment, a chart), log it as a look *by you* as well as by whoever showed it, even if you
  didn't ask for it.
- **One look-alike definition (§3).** Never invent a new near-miss rule. Reuse `looksAlike` in the engine
  (first 3 + last 4 today) or propose a single change to it, and to docs/SPEC.md, as an approval item for
  Aashmiin, so the engine, payment page and spec stop drifting apart.
- **Label-only cut-offs (§3).** Changing Strong/Possible/Weak bands that only change an on-screen label is
  a normal reviewed change; any change that lets a payment link to an invoice without a person is
  approval-only.
- **Incident drafts for Aashmiin (§5).** In anything she might forward to a customer: state only what you
  verified on chain (with the hash), say what is still being checked, and promise no fix, feature or date.
  "We're investigating and nothing will post until a person confirms" beats a confident cause.
- **Test rule claims before proposing them.** Before writing "only when X proves it", check the code path
  against the known failure modes (shared address, import typos, same-amount invoices).
- **Recompute pack numbers you quote.** If your own arithmetic disagrees with the pack, use yours, say so,
  and flag the pack line for correction.
