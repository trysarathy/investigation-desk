# CODE REVIEW: BLOCK a91dd11 (rc4 Accounting Bridge, CHANGE 15)

APPROVAL-ONLY: needs Aashmiin's merge. This change adds posting rules, accounts and amounts. The rules are also not signed off yet (ACCOUNTING_BRIDGE.md:11).

**In plain English:** The bridge is careful in most places. Entries balance exactly, provider reports alone never create entries, amount-only matches never do, and maker ≠ checker is enforced. But I could make it book money wrongly in three ways using normal sandbox actions:
- On a stablecoin payout it debits the supplier payable twice, once from the bank debit and once from the chain transfer.
- It books a bank debit as cash coming in.
- If a person rejects a reversal while approving the rebooking, it books one bank debit twice and never proposes the reversal again.

A crafted workspace can also export invented amounts. A per-case reset can reuse a journal id that is already in an exported file. Our rule is BLOCK for wrong money or duplicated postings.

Reviewer: independent code-reviewer (general-purpose agent with the code-reviewer and accounting-integrations-engineer briefs). I wrote none of this code. I wrote no product files. My probes ran in a scratch copy.

## What I ran (at a91dd11, frozen with `git archive` to scratchpad/crb)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npx vitest run tests/clearline` | 33 files, **611 passed** |
| Probe tests (scratchpad/review-probes/e1, e2, e5, e7, e8 `.test.ts`, run in the frozen copy, then moved out) | reproduce F1–F8 below; output quoted in each finding |
| Mutation run (one copy, scratchpad/mut, since deleted): rc4-journal, rc4-exports, rc4-load-labels, rc4-invariants (+ rc3-sample-stability) | 20 mutants applied: **15 killed, 5 survived** (table at the end) |

I did not run lint, `next build` or Playwright (scope was tsc and vitest only).

---

## Findings

### F1 BLOCKING (BLOCK): a stablecoin payout's supplier payable is debited twice (bank debit + final chain transfer)
- **Where:** `src/lib/clearline/accounting/derive.ts:118-175` (the bank-debit branch makes `JR_SUPPLIER_PAYOUT_DEBIT` / `JR_ADVANCE_DISBURSED`, lines 157-175). The chain branch at `derive.ts:191-213` makes `JR_STABLECOIN_FINAL_TRANSFER`, debiting `supplier_payable` at line 206. Neither branch knows the other exists for the same payout.
- **Failure scenario (reproduced, probe e7):** an SGD→USDC payout on the Base Sepolia route (prv_tidewater), the normal on-ramp shape.
  1. The bank line `PAYOUT <ppid>`, SGD 10,000.00, is allocated by trusted reference.
  2. The provider reports completed with the tx hash, and the chain observation goes final.
  3. `propose_journal_entries` then gives:
     `JR_SUPPLIER_PAYOUT_DEBIT Dr supplier_payable 10,000.00 SGD / Cr bank` **and**
     `JR_STABLECOIN_FINAL_TRANSFER Dr supplier_payable 7,438.377184 USDC / Cr stablecoin_clearing`.

  One invoice is shown as paid twice. `stablecoin_clearing` is credited with nothing ever debiting it, so the clearing account goes negative for good. The sample s4 (USDC→USDC, probe e1) does the same if a USDC bank or custody debit is ingested: the net is `supplier_payable +12,850.95 USDC` against a 6,427.83 payout.
- **Why it matters:** this is the product's core stablecoin flow. An accountant importing the file would show the supplier as paid twice.
- **Fix (needs Aashmiin's posting-rule decision):**
  - When a payout's rail is the stablecoin route, the bank debit is the on-ramp funding. Book it to a clearing account: Dr stablecoin_clearing (or provider_clearing) / Cr bank.
  - Only the final chain transfer then clears the payable: Dr payable / Cr clearing.
  - More generally, allow at most one payable- or receivable-debiting entry per payout. Any second evidence leg must go through a clearing account.
  - Add this to load validation, and add a property-test invariant: "the net debit to supplier_payable (or customer_receivable) per payout is never more than the payout amount".
- **Test gap:** the random walk never makes a chain payout with a bank debit, so it cannot find this.

### F2 BLOCKING (High): a bank **debit** is booked as cash in (sign inversion on return/reversal lines)
- **Where:** `derive.ts:130-142` decides `isReturn` from the allocation code only and never reads `line.direction`. The root cause is older engine code: `reconciliation.ts:197-222` accepts a `return`/`reversal` line in either direction as `RC_RETURN_CONFIRMS_PROVIDER_RETURN`, and `serialize.ts:246` accepts it at load.
- **Failure scenario (reproduced, probe e1 "E6"):**
  1. A payout is returned.
  2. A bank line of `kind: "reversal", direction: "debit"` arrives, quoting `RETURN <ppid>`. This is the bank reversing a return credit, so money goes out again.
  3. It is allocated, and the bridge proposes `JR_PAYOUT_RETURN_CREDIT Dr bank 10,000.00 / Cr provider_clearing`.

  The ledger's bank balance moves the opposite way from the statement.
- **Fix:**
  - In derive: propose `JR_PAYOUT_RETURN_CREDIT` only for a `credit` line. A debit-direction return or reversal should be listed under `notProposed` (contradicted), with no entry.
  - Flag the engine side to matching-engine-engineer: `reconcileLine` and the loader should refuse a debit-direction return confirmation.
  - Add `direction` to the rule-shape check in `accounting/validate.ts:146`. For bank rules, the bank line's side must match the statement direction.

### F3 BLOCKING (High): a crafted workspace exports invented amounts on a forged approval; load validation does not tie lines to evidence
- **Where:** `accounting/validate.ts:113-190` checks shape, balance and that evidence ids exist *somewhere*. It never checks:
  - that `basisHash` matches the stored lines and evidence;
  - that a proposed or approved entry matches a current candidate;
  - that the evidence is the kind the rule needs.

  `actions.ts:189-211` (`exportJournal`) exports every `approved` proposal without re-deriving it. `syncAccounting` runs only *after* the action (`actions.ts` in the main dispatcher, `applyAction`: dispatch, then `syncAccounting`).
- **Failure scenario (reproduced, probe e2):**
  1. Take the sample. On s1's proposal set `status: "approved"` and `approval.by: "usr_daniel"`, change both line amounts to 99,999,999, and set `evidenceIds` to an s4 **provider event** id.
  2. `loadWorkspace` returns OK.
  3. usr_maya runs `export_journal`, which is applied. The CSV carries `Dr 2100 999,999.99 / Cr 1010 999,999.99` with `evidence_ids = pev_00103` (a provider report), `approved_by = usr_daniel`.
  4. Only afterwards does sync mark it `evidenceChange`.

  CHANGE 13 says the console loads workspaces that visitors craft, and that "neither a stored status nor a stored decision is trusted". ENGINE_API CHANGE 15 says a crafted record "is refused". Both claims fail here.
- **Fix:**
  - `export_journal` must re-derive each approved proposal and refuse `EVIDENCE_CHANGED` unless its `basisHash` equals the current candidate's (the same check approve does at `actions.ts:164-165`).
  - At load: recompute the basis from the stored fields and require it to equal `basisHash`. Require every proposed or approved entry to have a matching current candidate. Require rule-appropriate evidence: a bank statement line plus an allocation for bank rules, and a chain observation plus an allocation for the chain rule.
  - State in the docs that the approver's identity in a client-held workspace cannot be authenticated.

### F4 BLOCKING (High): a per-case reset reuses a proposal id that an export file already contains
- **Where:** `scenarios.ts:193-199` puts a *rejected* proposal into `bridgeRemove` even when it was exported. `scenarios.ts:264-265` then restores the sample's proposal under the same id. `validate.ts:106` only checks that the ids in `proposalIds` exist.
- **Failure scenario (reproduced, probe e2 "E4"):**
  1. Approve s1's `jp_00189` and export it (file `jx_…`).
  2. Reject it; the reset message itself tells users to do this.
  3. `resetScenario(s1)` returns OK. `jp_00189` is back as a fresh `proposed` entry.
  4. The export record still lists `jp_00189`, and `buildJournalExport({exportId})` no longer re-renders to its recorded sha256 (`rerender false`).
  5. The restored `jp_00189` can be approved and exported again. The same `journal_id` now appears in two files with different content, so a ledger import either drops the second or posts both.
- **Fix:**
  - Refuse the reset (`ACCOUNTING_ENTRIES_RECORDED`) when any of the case's proposals has `export` set or is named by any export record.
  - Never restore a proposal id that an export record names.
  - At load, also check the reverse link: every id in an export's `proposalIds` must be a proposal whose `export.exportId` is that record.

### F5 BLOCKING (High): the reversal and the rebooking are independent. Rejecting the reversal double-books the bank debit and the supplier stays "paid"
- **Where:**
  - `actions.ts:104-109` (`isNew`): a rejected reversal suppresses its own candidate for good.
  - `actions.ts:176-187`: any operator can reject any proposed, approved or exported entry.
  - `actions.ts:157-174`: approving the rebooking does not depend on the reversal.
- **Failure scenario (reproduced, probe e5):**
  1. A live payout's debit is posted as `JR_SUPPLIER_PAYOUT_DEBIT`.
  2. The provider reports it returned. `propose` gives `REV` and `JR_PAYOUT_DEBIT_NOT_DELIVERED`.
  3. The reversal is rejected; the rebooking is approved, exported and posted.
  4. Posted net: `supplier_payable +10,000.00` (supplier shown paid on a returned payout), `bank −20,000.00` (one debit booked twice), `provider_clearing +10,000.00`.
  5. `propose` then returns `no_new_proposals`. The reversal is never offered again.

  This breaks ACCOUNTING_BRIDGE.md:44-50: "no line of a returned payout ever reduces the supplier payable".
- **Fix:**
  - A rebooking for a source key whose standing entry is not yet reversed cannot be approved or exported unless its reversal is approved in the same or an earlier export.
  - Rejecting a `JR_REVERSAL` while the original still stands, and its evidence still differs, is refused. Alternatively it also withdraws the paired rebooking, and the reversal stays proposable.

### F6 (Medium): an operator can change the account codes after approval; the approver never saw the codes that get exported
- **Where:** `actions.ts:61-72` lets the operator role run `set_account_mapping`, and `expectedRevision` is optional, so the last writer wins (line 67). `actions.ts:189-207` exports with whatever mapping is current.
- **Failure scenario (reproduced, probe e2 "E3"):** usr_daniel approves s1's payout debit. usr_maya then remaps `supplier_payable` to `6999 Sundry expense` and exports. The file posts the payout to an expense account, with `approved_by = usr_daniel`. The checker never checked it.
- **Fix:**
  - Record the mapping revision on each approval. `export_journal` refuses `MAPPING_CHANGED_SINCE_APPROVAL` when the current revision differs.
  - Or make mapping changes approver-only with maker ≠ checker.
  - Make `expectedRevision` required.

### F7 (Medium): an operator alone can reject an exported (possibly imported) entry; no reversal is then ever proposed
- **Where:** `actions.ts:176-187`. Afterwards the entry is neither standing nor active. `derive.ts:271-272` skips it, and `isNew` suppresses it.
- **Failure scenario (probe e5, second test):** usr_maya rejects an exported entry; `propose` returns `no_new_proposals`. If the accountant had already imported the file, the ledger holds an entry that Clearline says was rejected, and no reversal is ever proposed for it.
- **Fix:**
  - Do not allow rejecting an exported entry. Correct it with a reversal.
  - Or require an approver (≠ the exporter) and an explicit "not imported" attestation that is recorded in the audit.

### F8 (Medium): a volatile field in the basis. A duplicate (ignored) webhook marks a posted chain entry "evidence changed" and proposes a reversal plus an identical rebooking
- **Where:** `derive.ts:202` collects *every* provider event with the tx hash, including `duplicate_ignored` (and `recorded_no_state_change`).
- **Failure scenario (reproduced, probe e8):**
  1. After s4's chain entry is posted, the provider redelivers the same webhook. It is stored as `pev_00218 duplicate_ignored`.
  2. The posted entry gets `evidenceChange: "added pev_00218"`.
  3. `propose` creates `JR_REVERSAL` of the posted entry (plus the same entry again).

  This is churn in the customer's ledger, and with F5 it becomes a double count.
- **Fix:** use only `applied` events in the basis and the evidence ids.

### F9 (Low): a chain transfer is dated differently in the two exports
`derive.ts:208` dates the journal entry by `orgDate(allocation.createdAt)`. `exports.ts:154` dates the reconciliation row by `orgDate(observation.observedAt)`, which is the first sighting, possibly days before finality. Across a period boundary, the movement lands in one period in the reconciliation export and in another in the journal. **Fix:** use one date, the org-calendar date of finality or allocation, in both.

### F10 (Low): `sha256` is not the hash of the file bytes
`exports.ts:94-98` hashes `stableStringify(body minus generatedAt)`. But `types.ts:185` says "SHA-256 of the exported document body". `sha256sum` of the downloaded JSON or CSV will never match the recorded value. **Fix:** correct the comment and docs, or also record the SHA-256 of the exact CSV/JSON bytes.

### F11 (Low): a stale `evidenceChange` flag
`actions.ts:275` and `:287` set `evidenceChange` but never clear it. When the evidence flips back (a re-final after a reorg), the reversal is withdrawn but the standing entry keeps saying "a reversal will be proposed". The withdrawal text for an *exported* reversal is also misleading (`actions.ts:258`). **Fix:** clear the flag, or append a "matches again" history entry, when the candidate matches again.

### F12 (Low): the fictional marking can be dropped
- In the journal CSV, the marking is only a separate `marking` column (`exports.ts:336`), which importers discard as an unmapped column. The `[SANDBOX]` memo prefix survives, but `validate.ts:132` accepts any memo, so a crafted workspace can drop it.
- The reconciliation CSV marks only the first `meta` row (`exports.ts:227`). Filtering by `section` loses it.
- **Fix:** require memos to start with `[SANDBOX]` at load, and prefix `journal_id` (e.g. `SANDBOX-jp_…`). Add a per-row marking column to the reconciliation CSV.

### F13 (Low): differences between chain amount and payout amount are invisible
s4 pays 6,427.830000 USDC, but the final transfer is 6,423.116085. The 4.71 USDC difference appears in neither `NP_PARTIAL_REMAINDER` nor `NP_FEE_NOT_EVIDENCED`, because `derive.ts:245-247` looks at bank allocations only. **Fix:** list the uncovered remainder for chain legs too.

### Note (non-blocking): `record_posting`
`record_posting` (`actions.ts:213-224`) accepts any operator or approver. That includes the person who proposed and exported the entry, and it does not check that the reference is unique. This is acceptable for "a person says they posted it". Consider recording who posted it in the ledger separately from who typed it, and warning on a reused reference across periods.

---

## What I verified holds
- **Double entry:** every derived entry is two lines in one currency, with exactly equal amounts. `isBalanced` uses BigInt per currency (`derive.ts:288-300`), and approve, propose and load all re-check it. No rule converts or splits an amount, so there is no rounding. Display totals pass through `Number()` (`exports.ts:202,315`, `view.ts:85`). That is safe at the engine's `MAX_AMOUNT_MINOR`.
- **Directions** match the documented table for all six rules (M1 and M12 killed). The exceptions are F1 and F2 above.
- **Truthfulness:**
  - A provider report alone never produces an entry: `derive.ts:121` requires `bank_statement`, and NP_PROVIDER_REPORT_ONLY / NP_PROVIDER_COMPLETION_ONLY handle the rest.
  - An unrelated or amount-only receipt never does. Credit `payment` lines go only to repayment matching, and the s5 SGD 20,000.00 receipt stays NP_AMOUNT_ONLY_MATCH.
  - Returned, failed, cancelled, expired and held debits go to provider_clearing (M2 killed).
  - The narrative honestly says that a bank debit evidences money leaving the bank, not the supplier's receipt.
- **Supersession:** proposed or approved entries are superseded after every action (sync in `applyAction`). A superseded, rejected or approved entry cannot be posted, because `record_posting` requires `exported` (M8 killed). Exported entries cannot be exported again (only `approved` are picked). Posted entries cannot be posted twice.
- **Periods:**
  - `[from, to)` is applied by string comparison of ISO dates.
  - Overlap is refused (`periods.ts:70`).
  - A closed period refuses proposals, and late items move to the first day of the next open period with `priorPeriodItem`.
  - Close is approver-only (M7 killed) and refused while entries are proposed or approved.
  - Reversal dates use the org calendar (`orgDate(asOf, tz)`).
- **CoA:**
  - Unmapped keys block the export (`exports.ts:304-305`).
  - Duplicate codes are refused (M16 killed). Note that the comparison is case-sensitive, so `abc` and `ABC` are both accepted.
  - Duplicate keys are refused.
  - A recorded export stores the codes it used.
- **Maker ≠ checker:** checked before the role check (M3 killed) and at load (M13 killed). The ingesting operator cannot approve, because ingest is operator-only and approve is approver-only.
- **Hashing:** `generatedAt` is excluded from the document id (M10 killed). The basis excludes the reversal's clock date.
- **CSV:** `= + - @`, tab and CR are prefixed with `'`, and newlines are neutralised (M5 killed). Leading-space or full-width `＝` cells are not prefixed. That is acceptable for Excel and LibreOffice defaults.
- **Interactions:**
  - rc3 and v2 workspaces load with `migrations: []` and no `accounting` key (rc4-load-labels passes).
  - Holds are treated as not delivered.
  - Accepted differences give no entry (documented).
  - A reorg while an entry is proposed supersedes it. A reorg after export gets `evidenceChange` plus a reversal.
  - Reset refuses approved, exported and posted entries (M20 killed). The gap is F4.
- **The property test** (`rc4-invariants`, 24 walks × 70 steps) is real and exercises the full lifecycle. Its generator, though, never creates return or reversal statement lines, chain payouts with a bank debit, resets after an export, or rejections of reversals. It also has no "net per payout" invariant. That is why F1, F2, F4 and F5 got through.

## Mutation results (rc4 tests + rc3-sample-stability)
| # | Mutant | Result |
|---|---|---|
| M1 | return credit sides swapped | killed (62) |
| M2 | on_hold treated as delivered | killed (23) |
| M3 | maker may approve own proposal | killed (18) |
| M4 | rejected proposals re-proposed | killed (1) |
| M5 | `@` dropped from CSV guard | killed (2) |
| M6 | period lookup `date <= to` (boundary) | **survived**: no test dates an entry exactly on `to` |
| M7 | operator may close a period | killed (1) |
| M8 | record_posting from `approved` | killed (1) |
| M9 | amount dropped from basisHash | **survived** (covered indirectly by evidence ids; docs say amounts are in the basis) |
| M10 | `generatedAt` included in document hash | killed (2) |
| M11 | advance-funded chain transfer debits supplier_payable instead of customer_receivable | **survived**: rule branch untested |
| M12 | reversal lines not swapped | killed (12) |
| M13 | maker = checker accepted at load | killed (1) |
| M14 | approve skips basis re-check | survived (equivalent in practice: sync supersedes first; it matters for F3) |
| M15 | non-final chain transfer proposed | killed (1) |
| M16 | duplicate account codes allowed | killed (1) |
| M17 | close allowed with an *approved* entry | **survived**: only the `proposed` case is tested |
| M18 | reversal skipped when the rule changes | killed (2) |
| M20 | reset ignores approved entries | killed (1) |
| M21 | provider report line not listed | killed (1) |

ENGINE_API.md:39 claims "20 mutants, 20 killed". That was their own set. Four of mine survive that are not equivalent (M6, M9, M11, M17).

## Docs accuracy
- ENGINE_API.md:4 says a crafted record "is refused, never repaired". False for F3.
- ACCOUNTING_BRIDGE.md:44-50 says "no line of a returned payout ever reduces the supplier payable". False via F5. It also says "a provider claim can only make the books say less". The F8 churn contradicts the spirit of that.
- ACCOUNTING_BRIDGE.md:125-127 and ENGINE_API.md:32 say "a recorded export re-renders byte for byte". False after F4.
- ACCOUNTING_BRIDGE.md:31-32 says chain dates are "the org-calendar date of the chain allocation". True for the journal, but the reconciliation export uses observedAt (F9).
- `types.ts:185` says "SHA-256 of the exported document body". Inaccurate (F10).
- The rest matches the code: rule table, lifecycle, roles table, mapping, file columns, the not-built adapter section and limitations.

## Summary
BLOCK. The structure is good: exact balancing, evidence ids on every line, maker ≠ checker, no provider-only entries, and honest wording. But F1 (stablecoin payouts debit the payable twice), F2 (a bank debit booked as a credit) and F5 (a rejected reversal leaves one debit booked twice) produce wrong money in the books. F3 (crafted workspaces export invented amounts) and F4 (reset reuses exported journal ids) break the "never trust stored state" and "re-renders byte for byte" claims.

Minimum to re-review:
- fix F1–F5 with tests that fail at a91dd11;
- add the "net debit to the payable per payout ≤ payout amount" invariant to rc4-invariants;
- add return/reversal lines, bank-funded chain payouts, reset-after-export and rejected reversals to the generator;
- add tests killing M6, M11 and M17.

Then F6–F8, then the Low items. The posting-rule decision for F1 needs Aashmiin.
