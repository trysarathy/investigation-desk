# Task 3: decode a Tron payment and decide what it is

Source: `fixtures/t3-tron-receipt.json` only (real TronGrid receipt TRN-01, recorded 2026-10-24; heads, File A row, settings and freeze reads are the scenario). Conversions below were computed this run with a local base58check (sha256d checksum) and BigInt, no network [VERIFIED this run].

## 1. Decoding the TRC-20 Transfer log by hand
The receipt (`/wallet/gettransactioninfobyid`) has one log. TVM uses the EVM ABI: same topic0 and selector.

| Field | Raw | Conversion | Result |
|---|---|---|---|
| topic0 | `ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` | keccak-256 of `Transfer(address,address,uint256)` | ERC-20/TRC-20 Transfer, 3 topics (so not a 4-topic ERC-721-style Transfer) |
| contract (`log.address`) | `a614f803b6fd780986a42c78ec9c7f77e6ded13c` (20 bytes, no `41`) | prepend `41` → `41a614…d13c`; Base58Check(payload + first 4 bytes of sha256(sha256(payload))) | **`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`** |
| from (`topics[1]`) | `000…00d9251733398d2eef5b5a0be1d33fb1dbcbc401bc` | last 20 bytes → `41d925…01bc` → base58check | **`TVmN4nfC3NrgGxU3Ecpv9cvkc15h9upbFA`** |
| to (`topics[2]`) | `000…00b4ba17ed21e62b43418ea5feb9677ff844f70dbe` | last 20 bytes → `41b4ba…0dbe` → base58check | **`TSSoZb7K81i7NtoF7PEjDwG8m2gThoK9Zi`** |
| value (`data`) | `0x…0000000001004ccb00` | hex `1004ccb00` = **4,300,000,000** base units; ÷ 10^6 (decimals of this contract) | **4,300.000000 USDT** |

Cross-checks that agree:
- Transaction `raw_data.contract[0]` is a `TriggerSmartContract` from `owner_address 41d925…01bc` (= the log's `from`, so a direct `transfer`, not a `transferFrom` by a third party) to `contract_address 41a614…d13c` (= the log's contract); call data `a9059cbb` = `transfer(address,uint256)` with `to = …b4ba17ed…0dbe` and amount `…01004ccb00`, identical to the log.
- `receipt.result = "SUCCESS"`. Block 87,393,445, `blockTimeStamp` 1792853529000 ms = **2026-10-24T14:52:09Z**.
- `contractResult` is `0x00…00` (the `transfer` return value reads as `false`). Do not read that as failure: success is `receipt.result` plus the emitted Transfer log. [ASSUMPTION: Tron's USDT `transfer` is known for not returning `true`; not opened as source this run.] Our code uses `receipt.result` (`chain/tron.ts:66`), not `contractResult`, which is the right choice.
- Fee: `net_fee` 345,000 sun = 0.345 TRX of bandwidth burned by the **sender**. `energy_usage_total` 64,285, of which `energy_penalty_total` 49,635 is the dynamic-energy surcharge on a heavily used contract. That is the sender's cost. It has no bearing on what we received or on the verdict (TRON resource model: energy and bandwidth are spent by whoever executes the transaction).

## 2. Is it genuine USDT? Yes
- Identity is the **emitting contract address**, never the symbol. `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` equals the company's accepted Tron USDT contract in `company_settings.accepted_tokens.tron` and the official Tron USDT in the knowledge pack (`TetherToken`, `decimals()` = 6, freeze ABI present: [VERIFIED on-chain 2026-10-29 by the pack author]; issuer-page listing still [ASSUMPTION], tether.to was blocked).
- It is TRC-20 with a real Transfer log. It is not a TRC-10 asset (that would be `TransferAssetContract` with no log).
- 6 decimals is the right divisor **for this contract** (not "USDT everywhere"; BSC-USD is 18).

## 3. Confirmations, and how I counted
- Clearline's convention: `confirmations = head − txBlock`, no +1 (`engine/context.ts`), with head = **latest** (`/wallet/getblock`, gap G1).
  - Latest head 87,393,463 − 87,393,445 = **18 confirmations** (an explorer counting `head − block + 1` would show 19).
- Tron's finality signal is different: a block is **solidified** (irreversible) once ≥ 70% of the 27 SRs (19 distinct SRs) have built on it (TRON docs, `mechanism-algorithm/dpos.md`).
  - Solidified head (`/walletsolidity/getnowblock`) = 87,393,443 < 87,393,445. The tx block is **not yet solidified**, 2 blocks short. `/walletsolidity/gettransactioninfobyid` would still return `{}` for it.
  - Latest − solidified = 20 blocks at check time, in line with the ~19-block lag the pack measured.
- Timing: checked at 14:53:03Z, 54 s after the block (≈ 18 × 3 s).

## 4. Verdict the engine should give now
Inputs: File A row `TSSoZb7K81i7NtoF7PEjDwG8m2gThoK9Zi`, tron, SAMPLE-C001, assigned 2025-01-01, not retired. So `addressAtTime` = `this_customer` (customer inferred from the row by `inferCustomer` if the case had none). Token accepted, not impersonating. 4,300 ≥ minimum 1. Sender and deposit freeze reads both `false` (known, so the facts aren't missing). No ledger row. Receipt SUCCESS. Head known.
→ `creditable()` is true, 18 < 20, so **D02 "Waiting for confirmations", High**. D12 (arrived, not credited) is blocked because the threshold isn't reached. No D07/D09/D17/D18 hits.

Reply to the customer (D02 template, filled by `fillValues`: n = 18, N = 20, eta = (20 − 18) × 3 s = 6 s → `formatDuration` gives "about a minute"):
> Your transfer is on the Tron network and has 18 of 20 confirmations. Once it reaches 20 confirmations it becomes eligible for crediting, usually within about a minute. We'll update you once our checks are complete.

Analyst next step: wait and re-check. Do not credit yet. On the re-check, if there's still no ledger row once it's confirmed, the verdict becomes D12 (arrived, not credited) and the payment goes to crediting.

## 5. Would I let it be credited now?
**(a) Current settings (20 confirmations counted from latest): No.** 18 < 20. Under this setting it becomes eligible when latest ≥ 87,393,465 (~6 s after the check). Note that "20 from latest" is a **sample setting** (SPEC section 3, exchange practice). It is not Tron's finality rule. In normal conditions it lands at about the solidification point, but it isn't proof: a skipped or repeated SR slot makes solidification take longer.

**(b) Tron's own finality rule (solidified block): No.** The tx block 87,393,445 is above the solidified head 87,393,443. It becomes irreversible when `/walletsolidity/getnowblock` ≥ 87,393,445 **and** `/walletsolidity/gettransactioninfobyid` returns the same receipt (same block, `SUCCESS`, same Transfer log). Typically that's seconds away.

My recommendation: credit (and offer "Approve and post" on the request side) only on (b). Use the 20-count only to display "confirmed". If the solidified read fails, the result is **unknown → paused**, never "assume final" (pack's two-gate policy, `finality-reorgs.md`). This is gap G1 in the code today: Tron confirmations come from `/wallet/getblock` (latest), and `/walletsolidity` isn't read.

Freeze caveat: `isBlackListed = false` for both addresses was read at **latest at check time**, not at the payment block. Evidence must say "not frozen as of the check at 2026-10-24T14:53:03Z".

## Notes
- [VERIFIED this run]: all base58 conversions, the 4,300,000,000 → 4,300.000000 value, the block time, and the counts (18, −2, 20 lag). The template text, the `creditable`/`missingFact` logic, `formatDuration` and `tron.ts:66` were read from the repo source.
- [ASSUMPTION]: why Tron USDT's `contractResult` is zero; the official-contract status on Tether's own page (not opened); that the case customer is SAMPLE-C001 (from File A inference).
- No live calls made (tasks.md: no network to chains). Tronscan was ignored as instructed.
- WOULD WRITE (Company HQ Log): `crypto-protocol-engineer | investigated TRN-01 scenario | D02 18/20, not solidified, do not credit yet | task-3.md`.
