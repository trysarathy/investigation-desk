# Code review: rc4 console (85fd6bf..2c0f0f0: Accounting, audit history, investigation F/G, bridge migration notices, specs)

**Verdict: CHANGES REQUESTED 2c0f0f0.**

**In plain English:** the Accounting screens are careful. Every action asks the engine first using what the person actually typed. Every role picker carries the "Simulated role" label. No screen says Clearline posted anything, and exports are marked fictional. The tests are thorough.

One wording problem matters, and I reproduced it with the engine. Take an entry that was exported or "posted" (recorded by a person). If its payout is later returned or contradicted, the entry keeps reading **"Shows the supplier as paid — bank debit evidence"**, both in the entries table and on the payment page, with nothing next to it saying the evidence changed. Two Minors cover data loss in the mapping editor and missing copy saying the posting rules are not signed off. There are no Blockers: nothing posts a wrong amount and no record is lost.

APPROVAL-ONLY: needs Aashmiin's merge. This is the accounting / posting-rules surface, and the rules are still unsigned (ACCOUNTING_BRIDGE.md:14-15).

Reviewer: independent code reviewer. I wrote none of this code.

## What I ran

All work was on a frozen copy (`git archive 2c0f0f0` of src, tests, docs, fixtures and config, about 14 MB), with no build. The copy is deleted after this review.

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` (full) | 1783 passed, 57 skipped. My first run showed one failure only because my partial copy lacked `docs/SPEC.md`; with docs added, that file passes 145/145. |
| Throwaway probe against the engine and the console's own `supplierPaid()` and audit helpers | Reproduced M1 (below). Confirmed that a payment's audit history includes its journal-entry events and misses no event that names the payment. Since deleted. |
| Six engine mutations behind console rules, each restored and diff-checked | Every one is caught by `tests/clearline` (785 tests): CSV formula guard off → 1 fail; journal CSV "FICTIONAL SANDBOX" column blanked → 1 fail; G1 contradiction ignored on a bank debit → 5 fail; on_hold counted as delivered → 7 fail; maker may approve own entry → 27 fail; stablecoin on-ramp debit marked as supplier paid → 19 fail. |
| Console UI rules, checked statically against `clearline-accounting.spec.ts` | Each rule has an assertion that would fail if the rule were removed: "Withdrawn — says nothing about the supplier" (:241, :269); "Supplier still unpaid — payable open" with `data-shows-paid=false` (:87-88, :102); role note on the approver (:128), confirmer (:224) and periods (:343); posting note (:175) and "Nothing was posted" (:186); every gate's refusal in the engine's words (approve :404-405, reject :155/:168/:195, confirm-not-imported :229-234, periods :346-367); fictional marking on every CSV line (:310, :326); mapping conflict (:439). |

**Not run:** `next build` and Playwright, because disk is tight and QA is building. The browser-spec checks above are by reading, not running.

## Findings

### Blocker
None.

### Major

**M1. An exported or "posted" entry whose payout was later returned or contradicted still reads "Shows the supplier as paid", with no qualification.**
- **Where:**
  - `src/components/clearline/accounting.tsx:49-56`. `supplierPaid()` checks `showsSupplierPaid` before anything else and never reads `current` or `evidenceChange`. The same goes for `data-shows-paid` at :61.
  - `pages/Accounting.tsx:231` shows "Evidence changed" only for proposed or approved entries.
  - The payment page's F. Accounting outcome uses the same chip (`accounting.tsx:158`).
- **Reproduced with engine state:** a Northline payout is debited and gets JR_SUPPLIER_PAYOUT_DEBIT. The entry is approved, exported and recorded as posted, and then the provider reports the payout returned. The row is then `status posted`, `current false`, `evidenceChange SP_EVIDENCE_CHANGED`, and the intent's execution is `returned`. `supplierPaid()` returns **"Shows the supplier as paid — bank debit evidence"** (info tone).
- **What still works:** a not-yet-exported entry is superseded on the next action and correctly reads "Withdrawn". G1 before export is also covered (spec :272).
- **Why it matters:** "supplier paid" is the claim this product must never overstate. The chip sits beside a payout that was returned or contradicted. Only the expanded review explains the change; the table row and the payment page do not.
- **Fix (in words):** when an exported or posted entry has an evidence change, or is no longer current, show what the entry said and what happened since. For example: "As exported: showed the supplier as paid — evidence changed since (payout returned); a reversal is proposed next", in warning tone, with `data-shows-paid` false. Also show the evidence-change marker in the table for exported and posted entries. Add a browser test for posted, then returned (and exported, then G1-contradicted).

### Minor

**m1. Mapping editor: a revision conflict can only be resolved by throwing away your edits, and a draft can be saved onto a different workspace.**
- **Where:** `pages/AccountingSetup.tsx:14-28`, `:112`, `:123-139`.
- **Scenario 1:** the only way out of `MAPPING_REVISION_CONFLICT` is "Discard my changes and load revision N". Nothing offers to keep the typed codes and re-apply them onto the new revision for review.
- **Scenario 2:**
  1. The draft lives in `sessionStorage` under one fixed key and records only the base revision number.
  2. A person edits the mapping at revision 2, then restores a backup or resets to a workspace that also happens to be at revision 2.
  3. The draft comes back ("Your unsaved changes … were kept"), no conflict is detected, and "Save mapping" replaces that workspace's mapping with rows typed for the other one.
- **Also:** "Discard changes" has no confirmation.
- **Fix (in words):** identify the draft's base by more than the number (the mapping's `updatedAt` plus revision, or a hash of its entries, plus the organisation id). Offer "Keep my changes on top of revision N", which shows the differing rows and still needs Save. Ask before discarding.

**m2. No screen says the posting rules are sandbox rules that are not signed off.**
- **Where:**
  - The Accounting pages' ledes and disclaimer (`pages/Accounting.tsx:181-183`, `AccountingExports.tsx:142-144`) and the engine's `ACCOUNTING_BRIDGE_DISCLAIMER`. These say Clearline posts nothing, but not that the rules are unsigned.
  - By contrast, ACCOUNTING_BRIDGE.md:14-15 and CUSTOMER_EVALUATION.md:40 say the rules are not signed off.
- **Why it matters:** the export panel invites the person to give "a file your accountant imports into your own ledger". Without the caveat, a reader can take the entries' accounting treatment as settled. This is honest copy: company rule "never over-promise".
- **Fix (in words):** add one line to the Accounting disclaimer, and to the export file's marking if the engine allows it: "Sandbox posting rules, not yet signed off; for evaluation only."

### Nit
- **n1.** `accounting.tsx:42` keeps its own `NOT_DELIVERED` list (it matches the engine's `derive.ts:63` today). Derive it from the engine's terminal list plus on_hold so the two cannot drift.
- **n2.** `audit.ts:9` lists the prefix `fdc`, but the engine's funding-decision ids are `fdec_…` (actions.ts:941). It is harmless today, because the decision is audited under its advance id, but the entry is wrong. `req_…` ids (information requests) are also not recognised.
- **n3.** The audit history renders every event with no paging (`AuditHistory.tsx:98-141`), while the Reports page caps at 200. Large workspaces will render slowly.
- **n4.** Reconciliation export (`AccountingExports.tsx:70-79`):
  - It reports "downloaded in your browser" before the browser has saved anything.
  - When the recorded hash differs from the file, it still downloads and only adds a parenthetical warning. Prefer not downloading when the hashes differ.
  - The click uses the live date fields while the gate uses the settled ones. The engine still checks, so this is not unsafe.
- **n5.** `pages/Accounting.tsx:252` derives display text by stripping the engine's label prefix from `n.text`. This breaks silently if the engine text changes. Ask the engine for the detail text separately.
- **n6.** `accounting.tsx:179` reads "Proposed — not approved, not posted until a second person approves." The label and the sentence run together.
- **n7.** `aria-controls` on the Review buttons (`Accounting.tsx:232`) points to an element that exists only while expanded. Harmless.

## Focus questions answered

- **Success messages:** every action goes through `useRun` or a `dispatch` that checks `r.ok`. "Recorded by the engine" appears only on success.
  - Journal export adds "Nothing was posted".
  - Record posting is labelled "(simulated)" with "Clearline posted nothing".
  - The only overclaim is the reconciliation download wording (n4).
- **Posting:** status labels come from the engine ("Posted in your ledger (recorded by a person)", "Exported to file — not confirmed as posted"). The posting note appears under every record-posting control and in each page lede. No screen claims a ledger connection or GAAP/IFRS treatment. The unsigned-rules caveat is missing (m2).
- **Supplier-paid wording:** the engine's `showsSupplierPaid` drives "paid".
  - Superseded and rejected entries read "Withdrawn".
  - Returned, failed, cancelled, expired and on_hold payouts read "payable open".
  - The stablecoin on-ramp debit never shows paid (mutation-checked).
  - G1 before export: no entry, listed as not proposed (mutation-checked).
  - The gap is exported or posted entries with changed evidence (M1).
- **Gating:** every action runs an engine dry run on the settled real input, and empty-field gates are layered on top:
  - Approve runs as the chosen approver.
  - Reject runs as the global actor.
  - Record posting uses the typed reference.
  - Confirm-not-imported runs as the chosen confirmer.
  - Periods: open uses the typed name and dates; close and propose-in-period run as the actor.
  - Mapping save is checked with `expectedRevision`.
  - Journal and reconciliation exports are gated too.

  The "Simulated role" note is on the approver and confirmer pickers (Field hint) and on the periods actor picker (ActorSelect). Reject says "Acting as … (change it at the top)", where the global picker carries the note.
- **Downloads:** filenames are engine document ids passed through the safe-name filter in `download()`. The CSV formula guard (`csvCell`) and the per-line "FICTIONAL SANDBOX" column are mutation-checked. JSON carries the marking, `fictional`, `sandbox` and `notPostedByClearline`. A journal re-download rebuilds from the export record's own snapshot of entries and accounts (`exports.ts:306-312`), so a later mapping change does not alter it.
- **Mapping editor:** m1.
- **Audit history:** the source is the engine's append-only `ws.audit`, and filters only narrow it. My probe found that a payment's history includes its journal-entry events and misses no event that names the payment. Filter parameters reach only comparisons and React text, so there is no injection path. Nits n2 and n3.
- **Accessibility:** scroll wrappers are labelled groups; mapping inputs have screen-reader-only labels naming the role; amounts give "no debit/credit" to screen readers; section letters are `aria-hidden`; the audit actor reads "Simulated <role>". Nit n7. axe runs only in the browser specs, which I did not run.

## Summary
CHANGES REQUESTED 2c0f0f0.
- **One Major:** an exported or posted entry whose payout was later returned or contradicted still reads "Shows the supplier as paid", unqualified, in the table and on the payment page. Reproduced with engine state.
- **Two Minors:** the mapping-draft conflict and cross-workspace save, and no copy saying the posting rules are unsigned.
- **Seven Nits.**
- **Checks:** tsc clean, vitest 1783 passed. Six engine mutations behind the console's rules were all caught. The console's own UI rules each have a browser assertion (read, not run).
