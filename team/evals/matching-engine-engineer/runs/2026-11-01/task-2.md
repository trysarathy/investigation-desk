# Task 2: first labelling batch (C1-C6)

Run: 2026-11-01 SGT, matching-engine-engineer. Inputs: `fixtures/t2-candidates.json`, playbook §1.2-1.4,
`case-taxonomy.md`, `lookalike-poisoning.md`, `eval-methodology.md`. I also read (read-only) the
product checkout at main 0c7d9f1 to confirm which deposit set each transfer comes from and the request
code (`tests/real_cases.json`, `tests/real_cases_holdout.json`, `src/lib/requests/lifecycle.ts`,
`service.ts`, `check.ts`). No chain calls (live tools off), so **I re-read no transfer myself**: chain
facts below are as the colleague recorded them, and their independent re-read is a condition of entry.
Every invoice is SAMPLE COMPANY DATA (fictional); this is "real transfers, sample invoices".

## Split computation (rule: group = sender address string as written; holdout if first hex digit of sha256(group) ∈ {0,1,2,3})
Computed with `python3 hashlib.sha256(group.encode()).hexdigest()` on 2026-11-01 [VERIFIED: computed 2026-11-01]:

| cid | group (sender) | sha256 prefix | hash rule says | override that applies | **final split** | `split_rule` to record |
|---|---|---|---|---|---|---|
| C1 | TWzirBJLiUauAaJWT7Vtk6DeSmvYbKghjH | `ae7b2634…` | tuning | TRN-02 is in deposit **tuning** → matching tuning (consistent) | **tuning** | `sha256(sender)[0]=a ∉ 0-3; deposit-tuning TRN-02 → tuning` |
| C2 | TBSfSqcZxe5X6dL8WjVLrCF1cvrAcRPH14 | `9c6863c8…` | tuning | TRN-03 in deposit tuning → tuning (consistent) | **tuning** | `sha256(sender)[0]=9; deposit-tuning TRN-03 → tuning` |
| C3 | 0x2222…2222 (invented) | `8ce31402…` | (tuning) | — | **not admitted** (invented transfer) | — |
| C4 | 0x8afcf06919e6719bec706696c5ccb3dde40b4377 | `fe0fca0c…` | tuning | ETH-01 is in deposit **tuning** (`tests/real_cases.json`, I checked) → tuning (consistent) | **tuning** | `sha256(sender)[0]=f; deposit-tuning ETH-01 → tuning` |
| C5 | 0x5f9433482b62ced7266d2d04b9c0ecbfc5201c60 | `f01924d8…` | tuning | **H-ETH-01 is in the deposit HELD-OUT set → never enters a tuning set** (shared engine code; tuning on it leaks) | **holdout** | `override: in tests/real_cases_holdout.json (H-ETH-01) → holdout; hash rule (f) overridden` |
| C6 | 0xcb80784ef74c98a89b6ab8d96ebe890859600819 | `777443b9…` | tuning | POISON-1 in deposit tuning → tuning (consistent) | **tuning** | `sha256(sender)[0]=7; deposit-tuning POISON-1 → tuning` |

Time rule ("every case newer than the current tuning freeze date goes to holdout"): **no freeze date is
set yet** (this is the first batch). The batch PR must set it, and record it in each case's `split_rule`;
if it is set before 2026-10-24T16:15Z, C5 is holdout on both grounds. `split_at` = the SGT time the
split is written, before the product runs on any case.

**C5: the colleague's "put it in tuning, we need more exact cases there" is refused.** A case's split
comes from the rule at intake and never moves. Tuning needs exact cases → collect more real exact
transfers whose senders hash into tuning (and are in no held-out set).

## Decisions per candidate

### C1 (TRN-02, Tron, 400.000001 USDT): **admit, after the fixes below**
- `case_type`: **exact**. `expected_action`: **auto_match**. `true_invoice`: **S-INV-101**.
- Why (from the facts): one open SAMPLE invoice uses `TCbtVniD…kmsA`, official USDT contract
  `TR7NHqje…Lj6t`, status SUCCESS, amount 400.000001 equals the invoice exactly, no history at the
  address. Two independent sources listed (Tronscan API + TronGrid). `why` must say the invoice was
  **constructed** around the real transfer (amount and address copied from it).
- Missing: confirmation count/finality at decision time (label needs "confirmed"); `log_index`;
  `recording` path + sha256; `provenance.collected_by`/date; names of both labellers + `agreed`;
  `id` (`M-EXACT-001`), `group`, `split_rule`, `split_at`.
- Note for the scorer: the request path today is **Ethereum only** (`REQUEST_CHAIN`, `types.ts:8`;
  `validateRequest` accepts only `0x`+40 hex, `lifecycle.ts:15,43`; `check.ts:74` "this request is
  Ethereum only") [VERIFIED: read 2026-11-01, main 0c7d9f1]. A Tron invoice cannot exist in the product
  today, so the label (spec: auto_match) and today's behaviour (wrong_network flag / not creatable) will
  differ. Keep the label from the facts; the scorer must report Tron cases in their own row (or mark
  them "chain not supported by request path") so they don't silently drag recall or look like a bug.

### C2 (TRN-03, Tron, 990 USDT vs invoice 1000): **admit only after relabel + second source**
- Proposed label is **rejected**: it was copied from Clearline's own output (`checkObservation` → D13
  "Already credited"). Labels never come from the product (playbook §1.3.1). And D13 is a **deposit
  diagnosis** about a sample ledger, not an invoice-matching answer.
- From the facts: 990 < 1000 → `case_type`: **partial** (not exact). `expected_action`: **review**
  (a person decides: request the balance or accept short). `true_invoice`: **S-INV-102** (only open
  invoice on that address; recorded for the explanation, not as a match).
- Missing: a **second independent source** (only Tronscan read; add TronGrid `gettransactioninfobyid`
  or a second API); two labellers from the facts; confirmations; recording + sha256; ids/split fields;
  `why` stating the invoice was constructed at 1000 around a real 990 transfer. Same Tron note as C1.

### C3 (invented Ethereum transfer, 1500 vs 1000): **do not admit**
- The transfer is made up (`real: false`, hash `0x1111…`, sender `0x2222…`, no sources). Never invent
  a transfer, hash, amount or address (playbook §1.3.6). "The label is obviously right" doesn't matter:
  the case tests nothing real and would contaminate every number it touches.
- What to do instead: build the overpayment row from a **real** transfer with a SAMPLE invoice whose
  amount is set below it (e.g. a real 1,500 USDT transfer, invoice 1,000), two sources, `why` saying
  what was constructed. Label would be `overpayment` / `review` / that invoice. Overpayment stays
  "n too small to report" until ≥ 5 tuning and ≥ 5 held-out exist.

### C4 (ETH-01, 331.4 USDT, two open invoices 331.4 and 500 on one address): **admit with corrected label**
- `case_type`: **multiple_invoices** (correct). Proposed `auto_match` is **rejected**: ≥ 2 open
  invoices share the destination; amount alone isn't proof (`attribute()` `lifecycle.ts:143-146`
  returns ambiguous with only a hint; `docs/SPEC.md` "Matching": amount may rank, never auto-link).
- `expected_action`: **review**. `true_invoice`: **null** (not determinable from chain facts: same
  customer, two open invoices, no reference on-chain). If the case builder intends S-INV-104, record it
  as a `candidates` hint with `why` "constructed: amount equals S-INV-104", not as the true invoice;
  either way any auto-match on this case scores as a false match.
- Missing: a second labeller from the facts; recording + sha256; confirmations; `log_index`;
  ids/split fields. Sources are fine (Blockscout + second RPC), but name the RPC URL.

### C5 (H-ETH-01, 300 USDT, one open invoice): **admit to HELD-OUT only, after a second source and labeller**
- `case_type`: **exact**. `expected_action`: **auto_match**. `true_invoice`: **S-INV-106**.
- Split **holdout** (override above). Not tuning, whatever the tuning set needs.
- Missing: a **second independent source** (only the Etherscan web page; add Blockscout API or an
  `eth_getTransactionReceipt` from a second RPC, which also gives `log_index` and confirms the official
  Tether contract `0xdac17f…1ec7`); a **second labeller** (only one); recording + sha256; ids/split
  fields; `why` stating the invoice was constructed.
- Because it's held-out: once written, no tuning tool reads it, and no one runs or inspects it except
  through a logged look (§1.6).

### C6 (POISON-1, 49,999,950 USDT to look-alike 0xbaff…f8b5): **admit with corrected label**
- `case_type`: **lookalike_address** (correct). Proposed `auto_match` is **rejected**: the transfer
  went to `0xbaff2f13…f8b5`, the invoice's address is `0xbaf4b1af…f8b5` (first 3 + last 4 equal: the
  poisoning pattern), 12 minutes after the look-alike sent the payer 0.005 USDT dust. "Same customer,
  exact amount, right time, nearly identical address" is the description of the attack; address
  similarity is evidence of an attack, never of a match. The money never reached the business.
- `expected_action`: **flag** (look-alike / wrong address + security notice). `true_invoice`:
  **S-INV-107** (the invoice the payer intended, for the explanation only; never a match).
- Missing: `token_contract` (must confirm genuine USDT vs counterfeit; POISON-2 in the same set was a
  counterfeit forgery); a **second chain source** (Bitquery's investigation page is a secondary write-up,
  not a chain source: add Blockscout or a second RPC); the dust transfer's own hash in `history` (with
  source), not a free-text note; two labellers; recording + sha256; ids/split fields; `why` stating the
  invoice was constructed (customer SAMPLE-C045 and its address = the victim's intended address).
- Gap to note: this is a tuning case. The held-out side still has **0** look-alike cases; the row stays
  "n too small to report" until ≥ 5 real look-alike cases are collected whose senders hash to holdout.

## Batch summary
| cid | admit? | case_type | expected_action | true_invoice | split |
|---|---|---|---|---|---|
| C1 | yes, after fixes | exact | auto_match | S-INV-101 | tuning |
| C2 | yes, after relabel + 2nd source | **partial** | **review** | S-INV-102 | tuning |
| C3 | **no** (invented transfer) | — | — | — | — |
| C4 | yes, after relabel | multiple_invoices | **review** | **null** (candidates 104, 105) | tuning |
| C5 | yes, after 2nd source + 2nd labeller | exact | auto_match | S-INV-106 | **holdout** (override) |
| C6 | yes, after fixes | lookalike_address | **flag** | S-INV-107 (intended, not a match) | tuning |

Resulting counts if all fixes land: tuning 4 (exact 1, partial 1, multiple_invoices 1, lookalike 1),
holdout 1 (exact 1). Every row is "n too small to report" (needs ≥ 5 tuning and ≥ 5 held-out per type).

## What the colleague must change before the batch PR
1. **Drop C3.** Replace it, if wanted, with a real transfer + sample invoice built around it.
2. **Relabel from the facts, not the product or intuition:** C2 → partial/review; C4 → review,
   true_invoice null; C6 → flag. Remove "copied from Clearline's own output" as a label source.
3. **C5 goes to holdout** (it is in `tests/real_cases_holdout.json`); do not move it to tuning.
4. **Two independent chain sources for every case:** add a second for C2, C5 and C6 (Bitquery is a
   secondary write-up, not a chain source; an Etherscan web page alone is one source). Name the RPC
   used for C4.
5. **Two labellers per case** (qa-security-engineer or crypto-protocol-engineer as second), with
   `labelled_by`, `labelled_at`, `second_labeller`, `agreed`; C5 has one, C3/C4/C6 were labelled by
   the colleague alone.
6. **Fill the schema** (§1.2) for every case: `id` (`M-EXACT-001`, `M-PART-001`, …), `group`, `split`,
   `split_rule`, `split_at` (written before the product runs), `log_index`, `token_contract` (C6
   missing), confirmations at decision time, `provenance` (who collected, when), `recording` path +
   sha256 (RECORD_REAL=1 pattern), `"sample": true` on every invoice (present), `history` entries with
   hashes and sources (C6), `label.why` in one sentence including what was constructed.
7. **Set and record the tuning freeze date** (time-order rule) in the PR and in each `split_rule`.
8. **Note the Tron/request-path gap** on C1 and C2 (request flow is Ethereum only today) so the scorer
   reports them separately.
9. One batch = one PR; held-out files under `tests/matching/holdout/` only; no tuning tool reads them;
   run the harness on **tuning only** after the split and labels are written.
10. PR Log row: `added 5 cases (exact 2, partial 1, multiple_invoices 1, lookalike_address 1) tuning 4
    holdout 1, PR #n`.

## Log rows I would write
- `2026-11-01 <time> | matching-engine-engineer | reviewed first labelling batch C1-C6 | admit 5 after
  fixes, reject C3 (invented transfer); relabelled C2 (product-derived label → partial/review), C4
  (amount-only → review), C6 (look-alike → flag); C5 held-out by override (in deposit held-out set) |
  fixtures/t2-candidates.json`
- `… | matching-engine-engineer | summary | task: labelling batch 1 review; PR: none yet (colleague's
  batch PR after fixes); FMR held-out not measured; abstain not measured; recall exact not measured;
  held-out looks: 0; blocked: second sources/labellers missing`
