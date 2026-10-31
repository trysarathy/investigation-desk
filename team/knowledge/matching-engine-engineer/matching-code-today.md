# Matching and confidence in the code today (main 0c7d9f1)

Every statement is [VERIFIED: matching-engine-engineer 2026-11-01, the file:line named, main 0c7d9f1]
unless labelled otherwise. Line numbers drift: re-check before citing in a PR.

There is **no single "matching engine"**. Matching and "confidence" are decided in four places, by
deterministic rules. There is **no learned model, no probability and no calibrated score anywhere**.

## 1. Deposit investigation engine (D-codes, confidence High / Medium / none)
- `src/lib/engine/run.ts:19-46` `investigate()`: runs every rule in `CATALOGUE_ORDER`
  (`src/lib/catalogue.ts:12-15`); verdict = first **High** match (`run.ts:38`), else first **Medium**
  (`run.ts:39`), else **D99** with `confidence: null` (`run.ts:43`). A chain lookup error with no tx →
  `state: "paused"` (`run.ts:31-35`). This is the only "abstain" in the engine: D99 and paused.
- Confidence is **assigned by hand per rule**, not computed: e.g. D07 is High, or Medium when File A
  rows were rejected (`src/lib/engine/rules.ts:110-119`); D07b is always Medium (`rules.ts:121-131`);
  ledger-based D12/D13/D14/D16 are High only on an `exact` ledger match, else Medium
  (`rules.ts:46`, `:195`, `:204`, `:211`, `:223`).
- Ledger join `matchLedger` (`src/lib/engine/context.ts:223-250`): `exact` only on chain + tx hash +
  transfer index + token contract, or hash + contract when the tx holds ≤ 1 company transfer; `ambiguous`
  when several company transfers and no index; `address_amount` fallback (no hash: same customer,
  address, amount, not dated before the transfer) → always caps at Medium. This is spec rule precedence
  5 (`docs/SPEC.md:113`).

## 2. Payment requests (the invoice-to-payment flow sold today; Ethereum only)
- **Attribution** `attribute()` `src/lib/requests/lifecycle.ts:118-147`. Candidates = requests on the
  same chain, same demo/real world, whose receiving address equals the transfer's `to`.
  - 0 open, some paid → attributed to the last paid one as "possibly a duplicate" (`:122-127`).
  - 0 open, none paid → `none` (unidentified) (`:128-132`).
  - 1 open but a paid request used the address too → **ambiguous** (repeat-payment guard) (`:134-137`).
  - exactly 1 open → **attributed by System** ("the address identifies it") (`:138-141`). This is the
    only automatic invoice link in the request flow. Its correctness rests entirely on the business
    giving each open invoice its own address.
  - ≥ 2 open → **ambiguous**; an exact-amount candidate is only a hint, "amount alone isn't proof"
    (`:143-146`).
- **Does a transfer count?** `transferIssue()` `lifecycle.ts:280-301`: failed, wrong network (anything
  not Ethereum, `REQUEST_CHAIN` `src/lib/requests/types.ts:8`), wrong address, wrong contract
  (counterfeit if the symbol contains the token name, else wrong token), mined before the request was
  created (timing; a person may override), or an engine problem verdict (`PROBLEM` set
  `src/lib/requests/check.ts:31`).
- **State** `deriveRequest()` `lifecycle.ts:326-394`: completed / needs_review (flagged, ambiguous,
  short, over) / confirming / awaiting_payment / **matched** (confirmed counted transfers sum to exactly
  the amount, `:376-379`). Short → `review: "short"` (`:380-388`); over → `review: "over"`, with
  `duplicate` when every transfer equals the full amount (`:344`, `:389-393`).
- **Auto-mark-paid rule** `autoMark()` `lifecycle.ts:229-242`: marks a `matched` request paid with
  `by: "Auto-match rule"` (`AUTO_RULE`, `:155`). Only for requests created with `autoMarkPaid`;
  `src/lib/requests/service.ts:36` sets `autoMarkPaid: demo`, so **it is on only in demo mode**. In live
  mode a person marks paid. Turning it on for live requests is the single biggest "more auto-matching"
  change available, and is approval-only (see playbook §4).
- **Suggested match for an unidentified payment** `suggestMatches()` `lifecycle.ts:506-528`: a
  hand-weighted score "out of 100, not a probability": exact amount owed 40, known sender 35, unique
  amount among open requests 15, paid after request created 10; labels **Strong ≥ 80, Possible ≥ 50,
  Weak** (`:524`); suggestions below 40 dropped, top 3 kept (`:527`). A person confirms
  (`assign_transfer`). **These thresholds have never been measured on labelled data.**
- **Engine reuse** `src/lib/requests/check.ts:49-64` `factsFor()` builds engine facts with
  `freezeStatus: "not_supported"` and `senderHistoryStatus: "not_supported"` (`:61`), so **D09 and D07b
  never fire on the request path**; a look-alike destination is caught only as "wrong address".
- **Payment-page address checker** `compareAddress()` `lifecycle.ts:557-563`: "lookalike" when first 4
  **or** last 4 hex characters match (warns the payer before sending).

## 3. Three-way payments matching (`/payments`, CSV imports)
- `src/lib/payments/match.ts:1-13` header: automatic links on **exact identifiers only**
  (merchant reference = instruction ID, or named provider payment ID; chain + tx hash + transfer index,
  or hash alone when the tx carries exactly one token transfer; bank row ID columns; ledger by
  chain + hash + index). "Several candidates, identifiers that disagree, or a record that arrived twice
  with different content all go to review. Amount, time and address similarity rank candidates and
  nothing more."
- `resolveChain()` `match.ts:255-290`: hash on > 1 chain → review; chain named ≠ found → review
  (`chain_mismatch`); unresolved chains → unknown; index not in tx → review (`conflicting_ids`);
  several transfers and no index → review.
- `similarity()` `match.ts:138-153`: hand-weighted rank only: same amount +3, same destination +3, same
  asset prefix +1, same chain +1, within 1 h +2 / within 24 h +1. `rank()` `:156-161`;
  `suggester()` `:175-241` keeps the best five. **Never links.**
- Tests: `tests/payments.test.ts` (24), `tests/payments-review.test.ts` (20),
  `tests/payments-redirects.test.ts` (7) — unit tests on small hand-built inputs, some using recorded
  chain responses; not a labelled evaluation set.

## 4. What auto-links today, in one table
| Path | Automatic link/decision | Never automatic |
|---|---|---|
| Deposit engine | High verdict from exact facts; ledger High only on exact join | look-alike (D07b Medium), address+amount ledger match (Medium) |
| Payment request | attribution when exactly one open request uses the address; "marked paid" only in demo | ≥ 2 open requests on an address; repeat payer; short/over; any flagged transfer; suggestions |
| Three-way payments | exact identifiers | similarity, amount, time, address |

## 5. Spec vs code conflicts to know
- Spec D07b: "first 4 and last 4 characters" (`docs/SPEC.md:86`); engine: first 3 + last 4
  (`context.ts:101-111`, changed after the real-data test, comment explains why); payment page: first 4
  OR last 4 (`lifecycle.ts:557-563`). Three rules for one idea: see `lookalike-poisoning.md`.
- Spec success metric "Verdict accuracy ... 98% or better, measured on a labelled set of 200 past cases"
  and "Wrong high-confidence verdicts: Zero (release gate)" (`docs/SPEC.md:60-70`): no 200-case set
  exists (n = 59 + 52).
