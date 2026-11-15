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

---

# Re-review: CODE REVIEW: APPROVE 466d42a3b2247db1a4223af1e1f02e436da1c1c0 (CHANGE 16, rc4/wip-engine)

APPROVAL-ONLY: needs Aashmiin's merge. The change alters posting rules, and the new F1 stablecoin rule is a sandbox decision that is still unsigned. Approval covers the engine diff `395db0f..rc4/wip-engine` in `src/lib/clearline`, `tests/clearline` and `docs/clearline`. I did not review the Connect adapter framework or the console Accounting UI in a132340.

**In plain English:** The five blocking defects are fixed, and I could not get any of them to book wrong money again. Each fix has a test that fails on the old code.

Seven non-blocking points remain:
- one compatibility trap: saved workspaces with pending entries can become unloadable after a rule change;
- one important but untested guard;
- documentation gaps about what the stablecoin rule means in a single-currency ledger.

None of them books wrong money. The stablecoin rule is double-entry sound per currency. It deliberately leaves the SGD/USDC conversion unresolved, and that is clearly marked. Aashmiin still has to sign it off.

## What I ran

All commands ran on a fresh frozen copy of 466d42a (`git archive`). I deleted the copy afterwards, along with a temporary a91dd11 copy.

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npx vitest run tests/clearline` | 39 files, **732 passed** |
| New `rc4-review-fixes.test.ts` run against the **a91dd11** engine (temporary copy) | **26 failed, 4 passed**. The 4 that pass are the M6, M9, M11 and M17 mutant-killers. They test behaviour that was already correct at a91dd11, so passing there is expected. Every F1–F13 test and every defence-in-depth test fails at a91dd11. |
| My original probes (e1, e2, e5, e7, e8) at 466d42a | See the table below. |
| New re-review probes (`review-probes/p-rereview.test.ts`) | P0–P3, described below. |
| Mutants of CHANGE 16 (10 of mine, plus their 2 declared survivors) | 8 of 10 killed. N1 and N6 survive (gaps R2 and R3). F1b and F3a survive, as declared. |

### My original probes now
| Probe | a91dd11 | 466d42a |
|---|---|---|
| e7 (SGD→USDC stablecoin payout: bank debit + final chain) | supplier payable debited SGD 10,000 **and** USDC 7,438.38 | `JR_STABLECOIN_ONRAMP_FUNDING` Dr stablecoin_clearing SGD / Cr bank, then `JR_STABLECOIN_FINAL_TRANSFER` Dr supplier_payable USDC / Cr stablecoin_clearing. Payable cleared once. |
| e1 (s4 USDC→USDC with a USDC custody debit) | payable +12,850.95 | payable +6,423.116085. Clearing keeps +4.713915 USDC, which is the fee, listed as `NP_PARTIAL_REMAINDER`. |
| e1/E6 (debit-direction reversal on a returned payout) | booked as Dr bank | `exception_raised` (`RC_RETURN_LINE_IS_DEBIT`), no allocation, no entry. |
| e2 (crafted approval with invented amounts) | loaded and exported | refused at load: "every line's amount and currency must equal its allocation's". |
| e2/E3 (operator remaps after approval) | stale codes exported | refused correctly: `MAPPING_REVISION_CONFLICT` without `expectedRevision`. With it, the approval is superseded (`SP_MAPPING_CHANGED`; covered by their F6 test). |
| e2/E4 and e5(2) (exporter withdraws the entry, then resets) | reset reused jp_00189 | refused correctly: `maker_checker_violation` for the exporter. With a different approver, the reset is refused (`ACCOUNTING_ENTRIES_RECORDED`; their F4 test). |
| e5 (reject the reversal, post the rebooking) | bank −20,000, supplier "paid" | refused correctly: `REVERSAL_REQUIRED`. |
| e8 (duplicate webhook after the chain entry is posted) | evidenceChange plus reversal | no flag, `no_new_proposals`. |

## The points asked about

**1. Each fix has a test that fails at a91dd11.** Yes (table above).
- I ran the five defence-in-depth tests at a91dd11 as well, and they fail there too. ENGINE_API says they "were not run against a91dd11"; I ran them.
- The widened `rc4-invariants` walk shares the same oracle as the implementation (`ledgerProblem`). It is not an independent check (see R6).

**2. The F1 rule is sound double-entry; it is acceptable for the sandbox, flagged, but not fully documented.**
- Both entries balance in their own currency (BigInt). Per currency:
  - SGD: bank −X, stablecoin_clearing +X;
  - USDC: supplier_payable +Y, stablecoin_clearing −Y.
- Nothing nets across currencies, and no FX entry is invented. That is the honest result, given there is no rate evidence.
- The open item is visible: `NP_FX_NOT_EVIDENCED` (with stablecoin-route wording), an unresolved `stablecoin_conversion` row with `counterAmount` in the reconciliation export, and the sign-off flag in both docs.
- What the docs do **not** say (R5): for an SGD invoice, the bridge clears the supplier payable **in USDC**. In a single-functional-currency ledger, the accountant must translate that line and post the SGD-to-USDC difference by hand. Until then, stablecoin clearing shows an SGD debit balance next to a USDC credit balance.
- `ACCOUNTING_BRIDGE.md:84` still says "The entry is in the currency that left the bank". That is no longer true on the stablecoin route.
- This needs Aashmiin's sign-off. It is not a code defect.

**3. F2 and rc3 data: works, but the guard is untested (R2).**
- An rc3-shaped debit-direction return allocation (probe P0, crafted by flipping the stored line) loads with `migrations: []`. That holds both with and without `accounting`.
- `propose` then gives no entry, only `NP_EVIDENCE_CONTRADICTED`.
- But mutant N1 removes that derive guard (`derive.ts`, the `isReturn && line.direction !== "credit"` branch), and **all 227 rc4 tests still pass**. Under N1 the same probe proposes Dr bank 10,000 on the debit line again. The CHANGE 16 claim "still load … and give no entry" is true today but unprotected.

**4. F3 cannot be forged at load or export, apart from the identity limit the docs now admit.**
- Load now ties every non-reversal entry to exactly one allocation: same amount and currency, the line's own bank account, the side that matches its direction, and a payout or obligation link. It recomputes `basisHash` and requires pending entries to equal the current candidate.
- An attacker who recomputes the SHA-256 still cannot change amounts, accounts or evidence.
- Export re-derives as well. Its check never fires on its own; that is mutant F3a, below.
- What remains forgeable is who approved or posted. The docs (`validate.ts` header, ENGINE_API CHANGE 16) now say so plainly.
- A forged **posted** entry on old evidence is corrected rather than refused: probe P1 shows sync flags it, and the next `propose` adds its reversal.

**5. The F5 and F7 reversal rules hold.**
- The required reversal cannot be rejected (N4 killed).
- A rebooking cannot be approved or exported before its reversal (N3 killed). The two can export together.
- A withdrawn-after-export entry counts as in the ledger and is reversed (N9 killed). Only an approver who is not the exporter can withdraw it (N8 killed).
- Design note (R4): probe P2 shows that an entry withdrawn because it was **never imported** still gets a reversal, and that reversal cannot be rejected. The entry is also never proposed again. Clearline's net (entry + reversal = 0) is right only if the accountant imports the reversal exactly when they imported the original. This is conservative and documented ("the file may already be imported"), but there is no "confirmed not imported" path.
- A minor wording issue: `REVERSAL_REQUIRED` says "its evidence no longer gives it" for a withdrawn entry whose evidence is unchanged.

**6. The F6 choice (a mapping change supersedes the approval) is sound.**
- The approver re-approves exactly the codes that will be exported, and one file never mixes revisions.
- Exported entries keep the codes in their export record.
- Approval refuses unmapped keys, and `expectedRevision` is now required.
- N5 (no supersession) and N10 (export does not compare codes) are both killed.

**7. The declared survivors are confirmed.**
- **F1b**, the `LEDGER_DOUBLE_COUNT` guard in propose: removing it passes 227 of 227. I agree it cannot fire.
  - On the stablecoin rail, derive gives at most one payable-debiting entry per payout.
  - The chain amount must equal the quote's `estimatedRecipientMinor` exactly (`chain.ts:209`), so the destination-currency bound cannot give a false positive.
  - A legacy or crafted double posting is reversed in the same propose (P1).
  - Keep it as defence in depth. Its one weakness: if it ever fires, the whole propose is refused, including the corrective reversal. When it next changes, prefer listing the problem over failing the action.
- **F3a**, export re-derive: removing it passes 227 of 227. Equivalent: load refuses non-current pending entries, sync runs after every action and after `resetScenario`, and migrations run before validation. Keep it as defence in depth.

**8. The widened random walk is real.** It now generates:
- return and reversal lines in both directions;
- SGD→USDC and USDC payouts with bank debits, plus chain observations;
- resets after exports, rejected reversals and early approvals of rebookings.

After every action it checks net-per-payout and bank-line limits, the debit side, and re-render-to-file-hash. The limit is R6: the net check calls the production `ledgerProblem`, which bounds each currency separately.

**9. The docs are mostly accurate now.**
- These are correct: the CHANGE 15 corrections ("checks were structural only"; "4 survived"), the identity caveat, the F4 and F10 wording, the column lists and the reversal rules.
- These are not: R5 (the NP_FX row, and the payable cleared in USDC is undocumented), R1 (the load error says "No version of the engine produces this" for entries a91dd11 did produce), and the R2 claim, which is true but untested.

## Remaining findings (all non-blocking)
- **R1 (Medium): saved workspaces with pending entries become unloadable after a posting-rule change.**
  - `validate.ts` refuses any proposed or approved entry that is not the current candidate.
  - Probe P1: a workspace saved by a91dd11 with a *proposed* `JR_SUPPLIER_PAYOUT_DEBIT` on a stablecoin payout (re-hashed exactly as a91dd11 would have) is now refused with "No version of the engine produces this, so it was not repaired". Proposed chain entries saved at a91dd11 that list a duplicate event (F8) will be refused the same way.
  - Every future rule change will repeat this.
  - **Fix:** for entries that pass the evidence tie and the basis self-check but are no longer current, supersede them with a recorded reason (for example a versioned migration with `SP_EVIDENCE_CHANGED`) instead of refusing the load. Keep refusing entries that fail the tie or the hash. Correct the error message.
- **R2 (Low): the derive guard for stored debit-direction return allocations is untested.** Mutant N1 survives. **Fix:** add a test with an rc3-shaped debit return allocation, like P0, and assert no entry plus `NP_EVIDENCE_CONTRADICTED`.
- **R3 (Low): the "first reporting event only" rule for F8 is untested.** Mutant N6 (`derive.ts`, `.slice(0, 1)` removed) survives. No test has two `applied` or `recorded_no_state_change` events with the same tx hash. **Fix:** add one, for example a second `payout.completed` with another event id and the same hash.
- **R4 (Low): no "withdrawn, confirmed not imported" path** (P2, above). **Fix:** let an approver attest "not imported", recorded in the audit. Then no reversal is required, and the entry may be proposed again.
- **R5 (Low, docs; for Aashmiin): the F1 consequences are not spelled out.**
  - **Fix:** in ACCOUNTING_BRIDGE §2, state that on the stablecoin route the payable is cleared in USDC, and that stablecoin clearing keeps an SGD debit next to a USDC credit until the accountant books the conversion.
  - Correct the `NP_FX_NOT_EVIDENCED` row at line 84.
  - Keep "flagged for Aashmiin's sign-off" next to the rule table row.
- **R6 (Low): the payable bound is per currency, and the invariant is checked with the production function.**
  - `ledgerProblem` would accept one payout cleared in full in SGD **and** in full in USDC. Derive cannot produce that today, so it matters only as defence in depth.
  - **Fix:** allow at most one currency of payable clearing per payout. In `rc4-invariants`, add an independent check that does not reuse `ledgerProblem`, for example by counting payable-debiting standing or active entries per payout, net of their reversals.
- **R7 (Low): `REVERSAL_REQUIRED` gives the wrong reason for withdrawn entries.** **Fix:** say "withdrawn after export" when that is the reason.

## Summary
APPROVE 466d42a (engine), approval-only.
- F1–F13 are fixed. My probes now pass or are refused correctly, and each fix has a test that fails at a91dd11.
- The two declared surviving mutants are equivalent in practice and worth keeping as defence in depth.
- The F1 stablecoin rule is balanced per currency and honestly leaves the conversion unresolved. It needs Aashmiin's sign-off before it counts as a posting rule.
- Next, in order: R1 (load compatibility), the R2 and R3 tests, then the R5 docs.
- The Connect framework and the console UI in a132340 were not reviewed here.

---

# Final check (CHANGE 17): CODE REVIEW: APPROVE 5278061713247211a2db34374e3e7e31894bd2d8 (rc4/wip-engine)

APPROVAL-ONLY: needs Aashmiin's merge. These are posting-rule changes, and the F1 stablecoin rule is still unsigned.

Scope: the engine diff `8dc4361..rc4/wip-engine` in `src/lib/clearline`, `tests/clearline` and `docs/clearline`, excluding `connect/`. The only Connect file I looked at is the one test the owner changed.

**In plain English:** R1–R7 and G1 work. On genuine a91dd11 output, the old saved workspaces now load, their stale pending entries are set aside with a reason, and nothing already exported or posted is touched. But dropping the load refusal for a bank line booked twice reopened one crafted-data hole (K1). A workspace with two posted copies of the same entry now loads. Its double booking is never corrected, and from then on every `propose` that would create anything is refused. That is a fix to make next. It does not book wrong money through any normal action, and it does not export anything.

## What I ran

Fresh frozen copies were made with `git archive`: 5278061 for the review, and a separate a91dd11 copy for the fixtures. No worktree was touched, and both copies were deleted afterwards.

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | exit 0 |
| `npx vitest run tests/clearline` | 43 files, **776 passed** |
| The owner's generator `scratchpad/gen/zz-gen.test.ts`, run in my **a91dd11** copy | passed; wrote 3 genuine a91dd11 fixtures, kept in `scratchpad/a91-fixtures/` |
| Those fixtures loaded at 5278061 (`review-probes/real-a91-fixtures.test.ts`) | all 3 load, and the R1 behaviour holds (below) |
| My earlier probes (e1, e2, e5, e7, e8, p-rereview) at 5278061 | all still fixed or refused correctly. P1 (a proposed entry from the old rules) now **loads** and is superseded. |
| New probes (`review-probes/q-final.test.ts`) | Q1 finds K1; Q2 confirms the exporter cannot confirm "not imported" |

## R1 on genuine a91dd11 output (not simulated)
| Fixture (made by the a91dd11 engine) | Load at 5278061 | After `propose` |
|---|---|---|
| `rc4a_onramp_proposed` (a91dd11 proposed both Dr payable SGD and Dr payable USDC) | OK. One migration, `journal_proposal_superseded` for the SGD payable entry (`SP_RULES_CHANGED`). The USDC chain entry is still current and is kept. | `JR_STABLECOIN_ONRAMP_FUNDING` proposed; no ledger problem; reloads with no further migrations |
| `rc4a_chain_duplicate_event_proposed` (basis lists the duplicate event) | OK. One migration; the chain entry is superseded | the same entry is proposed again without the duplicate; reloads clean |
| `rc4a_rejected_reversal_double_count` (posted original + posted rebooking + rejected reversal) | OK. No migrations. **No exported or posted entry changed** (byte-compared). Ledger problem at load: bank line booked SGD 20,000 against a 10,000 line. | the reversal is proposed again; the ledger problem clears; reloads clean |

The simulated fixtures in `rc4-rereview.test.ts` match what the real engine produced.

## The points asked about

**Can R1's supersession hide or upgrade anything?** No.
- It only moves *proposed* or *approved* entries to `superseded`. These were never exported, so nothing leaves the books.
- Exported and posted entries are never altered.
- It runs only after the evidence tie and the basis self-check pass. Entries that fail those are still refused.
- It is idempotent: a second load reports no migrations.
- In `applyAction` it runs on the copied workspace, and its audit event joins that action's result.
- One wording issue (K3): the reason always says "Saved by an earlier engine version", even when the entry was crafted.

**Do the two dropped load refusals reopen an F3 forgery?**
- **Direction check:** no. A crafted pending entry is superseded. A crafted *posted* return credit on a debit line gets no candidate, so sync flags it and the next `propose` adds its reversal.
- **Bank line booked twice:** yes, for one shape. This is **K1**, below.

**Can `confirm_not_imported` be abused?**
- The exporter cannot confirm (Q2 gives `maker_checker_violation`, including when the exporter is an approver).
- An operator cannot confirm.
- It is refused once the reversal is exported or posted, and refused on a posted entry.
- It keeps the entry's export link, so its journal id stays reserved (reset is still refused).
- Load checks that the confirmer is an approver other than the exporter.
- What remains: an approver who wrongly confirms "not imported" for an entry that *was* imported skips the reversal. The same evidence can then be proposed and exported again. That needs a false attestation by a second person, it is audited, and it cannot be detected from the data. I accept it as the same trust limit as `record_posting`.
- In the sample, usr_daniel is the only approver. If he exports, nobody can confirm. That is correct, but worth knowing.

**Is G1 consistent?**
- The engine (`reconcileLine`), `recomputeDimensions` and the bridge (derive, for both bank and chain entries) all treat **any** open `contradictory_evidence` exception on the payout as blocking.
- Migration rule G repairs only the four provider-status codes (`PROVIDER_STATUS_CONTRADICTIONS`). So a saved "verified" state alongside another open contradiction code is not repaired by rule G (K4). The bridge still proposes no entry for it, because derive uses the broad test, so this affects only the displayed settlement status.
- Design note: while a contradiction is open, a real bank debit gets no entry at all, not even to provider clearing, so the bank account in the books runs behind the statement until a person resolves it. This is listed (`NP_EVIDENCE_CONTRADICTED` with the exception ids) and it is conservative. It is acceptable.

**The Connect test the owner changed** (`rc4-connect-rereview` "completed → in_transit"):
- The new assertions are right for G1. While the regression's contradiction is open, the pending supplier-paid entry is superseded, nothing is proposed, and nothing double-counts.
- But the test title still says "no entry is superseded", which is now false. Rename it.

**R6 and the random walk:** the cross-currency cap is in `ledgerProblem`. The walk now has an independent recomputation (per payout, per currency, counting withdrawn-after-export entries but not confirmed-not-imported ones), so it no longer relies on `ledgerProblem` as its own oracle.

**R5 docs:** §2.1 and the stablecoin-route wording in the `NP_FX_NOT_EVIDENCED` row now say what the accountant must book. These are still flagged for Aashmiin.

## Findings
- **K1 (Medium; fix next): a crafted duplicate posting loads, is never corrected, and then blocks every future `propose`.**
  - **Probe Q1:** copy a posted s1 entry under a new id with the same source key and basis hash, and list it in its export record.
  - At 466d42a this was refused at load. At 5278061 it loads. The view shows the SGD bank booked twice (−49,302.74 against a 24,651.37 line).
  - `propose` returns `no_new_proposals`: both copies match the current candidate, so no reversal is derived.
  - After any new evidence (a fresh payout debit), `propose` fails `LEDGER_DOUBLE_COUNT` for the whole workspace, so the bridge can never propose again.
  - The owner's test (`rc4-review-fixes` "F5 + R1") uses a *different* source key (`DUP:`). That shape gets reversed, so the test misses this one.
  - The code comment in `validate.ts` says "propose proposes the reversal again, which corrects it". That is true only for a91dd11's rejected-reversal shape.
  - a91dd11 could not produce two standing entries with the same source key and basis hash: its `isNew` blocked them.
  - **Fix:**
    - At load, refuse two un-reversed in-ledger entries with the same source key and basis hash (keep accepting the rejected-reversal shape).
    - Or flag the extra copy (`evidenceChange`) so that a reversal is derived for it.
    - Also, in `propose`, refuse `LEDGER_DOUBLE_COUNT` only when the new proposals *introduce or worsen* a problem, not when it already existed.
- **K2 (Low):** rename the changed Connect test, as above.
- **K3 (Low):** the `SP_RULES_CHANGED` reason and migration text claim the entry was "saved by an earlier engine version". Say instead that the current rules no longer give this entry (provenance unknown).
- **K4 (Low):** migration rule G covers 4 codes, while the engine and bridge block on any open `contradictory_evidence` exception. Either widen rule G to the category, or document why it is narrower.

## Summary
APPROVE 5278061 (engine), approval-only.
- R1 holds on genuine a91dd11 fixtures, not only simulated ones.
- `confirm_not_imported` keeps maker ≠ checker.
- G1 holds in the engine and the bridge; the migration rule is narrower (K4).
- All my earlier probes stay fixed.
- Fix K1 next. It turns one crafted state into a bridge that can never propose again, and it reopens a guarantee 466d42a had.
- K2–K4 are small.
- Everything I made was deleted, except the fixtures in `scratchpad/a91-fixtures/` and the probe files in `scratchpad/review-probes/`.
