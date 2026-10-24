# Real-data test report: stablecoin investigation desk

Branch `test-real-data`, 24–25 Oct 2026. Labels: **[VERIFIED]** means I ran it and saw the
result; **[ASSUMPTION]** and **[GUESS]** mean I didn't. Full tables are in `demo/results/results.md`.

**Verdict: ready to demo to a buyer, with caveats.** The verdicts were correct on 111 of 111 real
transactions after the fixes, including 52 collected afterwards. But the test covered only the
deposit-investigation part of the product, with sample company records. The payments matching
side and the AI explanations have not been tested on real data.

## What was tested

- **59 real cases** in `tests/real_cases.json`, on Tron, Ethereum, BNB Chain, Polygon, Arbitrum
  and Base, plus 2 real Bitcoin transaction IDs. Every expected answer is backed by a source that
  is not the product:
  - Tronscan's API;
  - Blockscout;
  - a second RPC provider;
  - the issuer's own `AddedBlackList` or `Blacklisted` event;
  - Tether's and Circle's contract lists;
  - Bitquery's write-up for the poisoning cases.
- **52 held-out cases** in `tests/real_cases_holdout.json`. I built these *after* the fixes, from
  newer transactions, so the after-fix score is not just a score on the cases I tuned against.
- **Cases that need company records** use **SAMPLE COMPANY DATA**. These are a fictional
  company's deposit addresses (File A) and ledger (File B), stored in `tests/real-data/` and
  marked as sample data on every row. They point at real transactions. They cover:
  - credited, not credited, held and rejected payments;
  - payments to another customer's address or a retired address;
  - below-minimum payments, unsupported tokens and wrong-network payments.
- **How each case was run:** exactly as a user would. I pasted the hash on the queue screen,
  with an optional reporting customer, then ran all cases again in one bulk CSV. No API keys
  were set.

| | Before fixes | After fixes | Held-out (after) |
|---|---|---|---|
| Correct | 43 / 59 (72.9%) | **59 / 59** | **52 / 52** |
| False alarms on normal payments | 0 / 12 | 0 / 12 | 0 / 12 |
| Wrong **and** High confidence | **13** | 0 | 0 |
| "Check paused" | 3 | 0 | 0 |
| Median / slowest investigation | 17.4 s / 19.7 s | **1.4 s** / 11.7 s | 1.4 s / 9.8 s |
| Bulk, 57 rows | 310 s | 54 s | 27 s (52 rows) |

All figures in the table are [VERIFIED].

## What works reliably [VERIFIED]

- **Normal payments are never flagged.** All 24 credited payments, across Tron, Ethereum and
  BNB Chain in both sets, came back as "Already credited" with High confidence.
- **Failed transfers (D03): 21 of 21 across both sets.** This covers Tron OUT_OF_ENERGY and
  REVERT, and Ethereum and BNB Chain reverts. It includes 4 failed attempts by addresses that
  were already frozen; the freeze is attached as a finding on each.
- **Issuer freeze (D09): 11 of 11.** The desk asks Tether's or Circle's own contract, read-only,
  whether the address is frozen.
- **Fake USDT (D06): 13 of 13.** Twelve counterfeit tokens named exactly "USDT", plus one called
  "ÚЅDТ" that uses Cyrillic letters.
- **Wrong network (D04): 6 of 6.** Polygon, Arbitrum and Base transfers sent to an address the
  company registered on Ethereum.
- **Company-record diagnoses: all correct.** Not credited, on hold, rejected, below minimum,
  unsupported token, another customer's address, retired address and wrong address.
- **Not found (D01): 4 of 4,** using real Bitcoin transaction IDs, which look like hashes.
- **Waiting for confirmations (D02): 2 of 2,** caught live 1–3 blocks after they were mined.
- **Address poisoning (D07b): 2 of 2.** These are the documented $50M (Dec 2025) and $39.9K
  (Aug 2026) losses. The verdict is "wrong address" with the look-alike flag, and the evidence
  links the actual poisoning transfer.
- **Evidence is real.** Every explorer link on the 59 pages points at the case's own hash, apart
  from the poisoning pages, which also link the earlier poisoning transfer, as they should. I
  checked that transfer on-chain.
- **It fails clearly, not silently:**
  - With every chain unreachable, each case says "Check paused: … not responding" and gives no
    verdict. This takes about 17 s.
  - A rate-limited or failing chain pauses the case. It never turns into "not found" or "failed";
    this is now tested on real recordings.
  - The wrong chain on a bulk row gives "Found on Ethereum, not on Tron as the row says".
  - An email address used as a customer ID is refused.
  - Upper-case hashes, padded hashes and Tron hashes with `0x` all work.
- **The demo works offline.** With `OFFLINE_REPLAY_DIR=tests/fixtures/real` and every outbound
  connection blocked, all 57 recorded cases give the same answers. The 2 live cases pause,
  correctly.

## What was broken, and is now fixed

These are listed in the order they were fixed, worst first. Each fix is in this branch, and the
real cases are now automated tests: `tests/real-cases.test.ts`, 57 recorded cases plus 4
outage tests.

1. **The app couldn't investigate anything without API keys.** Etherscan V2 now refuses keyless
   calls, and the app required both keys before it would look anything up. Now TronGrid runs
   keyless, and Ethereum, Polygon and Arbitrum fall back to free public RPCs.
2. **Wrong confident answer: a successful payment was reported as "Transaction failed" (High).**
   When a node returned no receipt, the code read that as a failure. Public nodes do this for
   transactions a few months old. Ten real cases hit it, including the $50M poisoning. That
   payment would have been told "your transfer failed, resend". A missing receipt is now an
   unknown that pauses the case, and it is never cached.
   - **Caveat:** my first keyless choice of node (publicnode) is what exposed this. With the
     Etherscan key the product was designed for, it may not have shown up [ASSUMPTION]. It was
     still a latent bug: any node can do this.
3. **Poisoning was missed.** Three separate problems:
   - The rule required the first 4 characters to match, and the $50M case matched only 3.
   - It ignored the "forged transfer" pattern that the $39.9K case used.
   - It couldn't read Ethereum history without an Etherscan key.

   The rule is now first 3 and last 4 characters. A random match happens about once in 268
   million address pairs. Both patterns are recognised, and history comes from Blockscout when
   there is no key.
4. **Look-alike token symbols weren't treated as fake.** "ÚЅDТ" now counts as claiming to be
   USDT, and the reply says "not genuine USDT".
5. **A freeze was hidden behind a lesser diagnosis.** USDC from a Circle-blacklisted sender was
   called "unsupported token". An issuer freeze now ranks straight after "failed".
6. **Slowness.** There were two causes:
   - One public node refused even "not found" lookups, and its 403 errors were retried for about
     15 s.
   - Keyless TronGrid allows 3 requests a second and suspends callers for 5 s past that.

   The median went from 17.4 s to 1.4 s.
7. **Smaller fixes:**
   - In a transaction that moves several tokens to the same address, the desk now looks at the
     stablecoin.
   - "Another customer's address" is Medium, not High, when the reporting customer has no
     addresses at all, because that is probably a mistyped ID.
   - A non-hash input now says it isn't a hash, instead of "address lookup not built".
   - The sidebar no longer calls uploaded data "fabricated sample data".
   - An evidence line no longer claims "first 4 characters" after the rule changed.

## What fails or is unreliable, and why

- **Free public data sources are fragile.** In two days I saw three different failures:
  - nodes returning no receipt;
  - "archive requests need a token" errors, even for unknown hashes;
  - TronGrid's 3-requests-a-second limit, which paused one row in a bulk run.

  The worst case is about 10–17 s before the desk gives up and pauses. That is fine for a demo,
  but not for a pilot [VERIFIED].
- **Freeze is checked now, not at the time of the payment.** A deposit received before the sender
  was frozen is still escalated as D09. That is defensible for compliance, but a buyer may ask
  [VERIFIED].
- **Lookup by address or customer reference isn't built.** Customers often paste an address. The
  desk says this clearly and doesn't guess [VERIFIED].
- **Company settings are hard-coded sample settings:** confirmations, minimums and accepted
  tokens. A real company can't change them in the app yet [VERIFIED].
- **The poisoning sample is small.** Only 2 cases were documented well enough to prove. There are
  no Tron poisoning cases and none in the held-out set. Treat D07b as promising, not proven.
- **The AI explanations were not tested.** No Anthropic key was set, so every page showed the
  approved template text. I checked the template text against the evidence and found one false
  claim, which is now fixed. The AI path is untested [ASSUMPTION].
- **The payments platform was not tested on real data:** three-way matching, the exceptions inbox
  and exports. It needs real provider settlement reports, bank statements and a ledger. Earlier
  stress tests used fixtures only.
- **Memo or tag deposits (D15) can't be tested.** They are out of scope in v1.

## What can't be tested without real company data

Ask a design partner for:

1. **Ground truth.** One month of "deposit not arrived" tickets, with the hash, the customer
   pseudonym and *how each was actually resolved*. This is the only way to measure accuracy on
   their real mix of cases.
2. **File A: deposit addresses with assignment history.** Address, chain, customer pseudonym,
   assigned_at and retired_at, for the same month. Reassigned and retired addresses matter.
3. **File B: a ledger export** covering every deposit row with tx_hash, transfer/log index,
   status (credited, pending, held, rejected), credited_at, amount, token and customer pseudonym.
4. **Their real settings:** confirmations per chain, minimums, accepted token contracts (on BNB
   Chain especially), and their below-minimum and retired-address policies.
5. **For the payments side:** a week of payout instructions, the provider's settlement report
   (for example BVNK, with a sample of settled-amount and date formats), the bank statement and
   the payout ledger, all for the same payments.
6. **If they support memo chains:** deposits with memos or tags. This is needed before D15 can
   exist.

No names, emails or ID documents: customer pseudonyms only.

## Top 5 fixes before showing a real payment ops team

1. **Use paid or keyed data sources.** Free TronGrid and Etherscan keys, plus one paid RPC
   (Alchemy, QuickNode or similar) with archive receipts. Add a second provider per chain as a
   fallback. This removes the main reliability risk.
2. **Make company settings editable** (confirmations, minimums, accepted tokens), with a version
   history. Every verdict depends on them.
3. **Add lookup by address,** listing recent transfers to or from it. Customers paste addresses
   as often as hashes [GUESS: based on the exchange help pages cited in the spec, not measured].
4. **Test the payments-matching side on one real provider report.** Then test the AI explanation
   path with a key before calling it AI in a demo.
5. **Sign off the rule changes in the spec:**
   - D07b uses 3+4 characters and accepts both poisoning patterns;
   - D09 precedence;
   - the D17 Medium cap;
   - keyless sources.

   After that I'll sync `docs/SPEC.md`. It still describes the old rules; this PR does not edit
   it.

## How to rerun

- `npm test` runs 567 tests, including the 57 recorded real cases, offline.
- `RECORD_REAL=1 NODE_USE_ENV_PROXY=1 npx vitest run tests/real-record.test.ts` re-records the
  real cases.
- `tests/real-data/tools/` holds the scripts used: case builder, runner, robustness checks and
  the demo recorder. Paths at the top may need adjusting.
- Demo: `demo/DEMO_SCRIPT.md`, `demo/demo.mp4`, `demo/demo.gif`, `demo/screenshots/`.
