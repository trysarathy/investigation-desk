# Task 4: "my deposit never arrived" (SAMPLE-C045, 49,999,950 USDT)

Source: `fixtures/t4-poisoning.json` only (real Ethereum data, POISON-1; the company and its File A row are fictional sample data). Conversions computed this run (BigInt, local) [VERIFIED this run]. No live chain calls.

## 1. The payment, decoded
| Fact | Raw | Decoded |
|---|---|---|
| Tx | `0xc0514a79…6a0f` | receipt `status 0x1` = success |
| Block | `0x16eefc8` | 24,047,560; hash `0x3ab3d708…9e0f`; log `blockTimestamp 0x6945702b` = **2025-12-19T15:32:59Z** |
| Emitting contract (`log.address`) | `0xdac17f958d2ee523a2206206994597c13d831ec7` | **genuine Tether USDT on Ethereum** (the official contract in Settings; 6 decimals per the recorded `decimals()` call) |
| topic0 | `0xddf252ad…b3ef` | `Transfer(address,address,uint256)`, 3 topics |
| from (`topics[1]`) | last 20 bytes | `0xcb80784ef74c98a89b6ab8d96ebe890859600819` (also `tx.from`, so a direct `transfer`) |
| to (`topics[2]`) | last 20 bytes | **`0xbaff2f13638c04b10f8119760b2d2ae86b08f8b5`** |
| value (`data`) | `0x2d7985422f80` | 49,999,950,000,000 base units ÷ 10^6 = **49,999,950.000000 USDT** |
| logIndex | `0x128` | 296 (position in the block) ; `removed: false` |
| Depth | head `0x190c083` = 26,263,683 | 26,263,683 − 24,047,560 = **2,216,123 confirmations** (Clearline convention, no +1): ~10 months old, far past `finalized`. No reorg question here. |

So: real USDT really moved, and it really left the customer's sending address. It went to `0xbaff…f8b5`.

## 2. Destination vs the customer's deposit address
```
File A (SAMPLE-C045, ethereum, active since 2025-01-01):  0xbaf4b1af7e3b560d937da0458514552b6495f8b5
Payment went to:                                          0xbaff2f13638c04b10f8119760b2d2ae86b08f8b5
                                                            ^^^^                            ^^^^
```
- These are different addresses. The first 3 hex characters (`baf`) and the last 4 (`f8b5`) match; the 4th character differs (`4` vs `f`), and so does everything in the middle.
- Engine `looksAlike` (first 3 + last 4) = **true**. The sender checker `compareAddress` (first 4 OR last 4) also flags it, on the last 4. The spec's old first-4 rule would have missed it (gap G11; this exact case is why the engine uses first 3 + last 4).
- Both addresses are valid. Written in EIP-55 form they are `0xbaf4b1aF7E3B560d937DA0458514552B6495F8b5` and `0xBaFF2F13638C04B10F8119760B2D2aE86b08f8b5` (computed this run). **A checksum doesn't help against a look-alike**: the attacker's address is a real, correctly checksummed one.
- [ASSUMPTION] `0xbaff…f8b5` is not in any other File A row (only the customer's rows are in the fixture). D07 High depends on the full File A having no rejected rows.

## 3. The earlier transfers between sender and destination (chronological)
| # | Time (UTC) | Block / log | Direction | Token contract | Value → amount | Classification |
|---|---|---|---|---|---|---|
| 1 | 15:10:11 | 24,047,447 / 344 | sender → look-alike | `0xdac17f…1ec7` **genuine USDT** | 0 → **0 USDT** | **Zero-value poisoning ("forged out")**. ERC-20 requires zero-value transfers to fire `Transfer`, so a third party can call `transferFrom(victim, lookalike, 0)` without the victim's signature or allowance. The victim's history then shows a "sent to 0xbaff…f8b5" entry. [ASSUMPTION: the victim didn't sign it; confirm via that tx's `tx.from`, which should be the attacker, not `0xcb80…0819`] |
| 2 | 15:12:11 | 24,047,457 / 480 | sender → look-alike | `0xfa2c55c4…9124` **counterfeit** (symbol `U‍‍⁣S‎D⁣‏‏‎⁣T‍‎`, "USDT" hidden behind Unicode format characters U+200D/U+200E/U+200F/U+2063) | 50,000,000,000,000,000,000 ÷ 10^18 (its own decimals) = **50 fake "USDT"** | **Forged-transfer poisoning ("forged out")**. A fake token emits a Transfer "from" the victim, a second planted history entry that renders as "USDT". Worth nothing. (This is one of the seven contracts in task 1.) |
| 3 | 15:20:35 | 24,047,499 / 665 | look-alike → sender | `0xdac17f…1ec7` **genuine USDT** | 5,000 ÷ 10^6 = **0.005 USDT** | **Dust poisoning ("dust in")**: 0.005 ≤ `dustThreshold` 1. Now "received from 0xbaff…f8b5" also sits in the victim's history. |
| — | 15:32:59 | 24,047,560 / 296 | sender → look-alike | genuine USDT | **49,999,950 USDT** | The payment: sent 12 min after the dust, 22 min after the first plant |

All three match `isPoisoning` (`engine/context.ts`): #1 zero value on the payment's from→to; #2 different token contract on the payment's from→to; #3 dust from the look-alike back to the sender. The code decides #2 by **contract**, not symbol, so the task-1 symbol gap (G13) doesn't weaken D07b here.

## 4. Verdict and findings (Clearline rule precedence: first High in `CATALOGUE_ORDER`, D07b attached as a finding)
- D01 no (found). D03 no (success). D04 no (destination isn't a company address on another chain). D05/D06 no (genuine official USDT). D09 not evaluated here: no freeze reads in the fixture.
- **Verdict: D07 "Sent to an address that isn't the customer's/company's", High.** Fact: the destination is not in the deposit-address list. Next step (catalogue): "Unrecoverable by the company. Advise the customer."
- **Finding: D07b "Look-alike address (address poisoning)", Medium.** The destination matches the customer's assigned address on first 3 + last 4, after dust/forged transfers between it and the sender (3 found, cited above). Medium because it is a heuristic, so an analyst confirms. Next step: "Confirm the look-alike pattern, then send the security notice."
- Not credited, and never credited on this evidence. No ledger action.

## 5. Reply the analyst may send (D07 template, word for word, `short_addr` = `truncateMiddle(to, 6, 6)`)
> The funds went to 0xbaff…08f8b5, which is not your deposit address. We can't access or recover funds at that address. Always copy your address from our app, never from your transaction history.

Optional addition once D07b is confirmed (security notice; analyst-approved, no promises):
> For your security: your deposit address is 0xbaf4b1aF7E3B560d937DA0458514552B6495F8b5. Shortly before your payment, three transfers appeared in your wallet history involving 0xBaFF2F13638C04B10F8119760B2D2aE86b08f8b5, an address made to look like it: a 0 USDT transfer, a transfer of a fake "USDT" token, and 0.005 USDT sent to you. This pattern is called address poisoning. We have no control over that address. If you wish to pursue it, report it promptly to your local police and to Tether, the USDT issuer; any action is their decision.

Give the full addresses, not just the shortened ones: the shortened form is exactly what the attack exploits.

## 6. What the analyst must confirm before sending
1. The reporting customer really is SAMPLE-C045, and `0xbaf4…f8b5` is their current deposit address (File A row active, not retired; no File A rows rejected at upload, otherwise D07 drops to Medium).
2. `0xbaff…f8b5` isn't in File A for **any** customer or chain (otherwise this is D17/D04, not D07).
3. The poisoning pattern from the raw txs: tx `0xfc1e…91be` and `0x2733…1405` were **sent by a third party** (`tx.from` ≠ `0xcb80…0819`), and `0x9780…88bd` came from the look-alike. That's what moves D07b from "looks like" to "confirmed".
4. The sender `0xcb80…0819` is the customer's own wallet (the Transfer's `from` shows where it was "sent from", not who owns it).
5. No ledger row credits this tx (none expected).

## 7. Can the company recover the funds? No.
- The company never controlled `0xbaff…f8b5`: it's the attacker's address, with its own key. Clearline is read-only and holds no keys, so neither of them can move anything there, and neither should suggest otherwise.
- The tokens are **genuine USDT**, so the issuer can act. Tether can blacklist the address (`addBlackList`, event `AddedBlackList`; on Tether's contract a blacklisted address can't send) and has a `destroyBlackFunds` path. **Only Tether** decides that, normally on a law-enforcement request, and only while the funds are still at that address. That's why speed matters for the customer. [ASSUMPTION: Tether's handling policy; not opened this run]
- I did not check whether the funds are still at `0xbaff…f8b5` (no network this run). A read-only `balanceOf` / `isBlackListed(0xbaff…)` call would answer that, and I would add it to the case evidence. Even so, "frozen" would not mean "recovered".

## Notes
- [VERIFIED this run]: every decoded number, the time, the depth, the look-alike comparison and the EIP-55 forms. Rule behaviour is from reading `rules.ts`/`context.ts`/`templates.ts`/`catalogue.ts`.
- [ASSUMPTION]: who signed transfers #1/#2; Tether's freeze practice; that no other File A row holds `0xbaff…`.
- The engine reply truncates the address to `0xbaff…08f8b5`. For poisoning cases, I'd suggest the reply show the full addresses (product follow-up, not changed).
- WOULD WRITE (Log): `crypto-protocol-engineer | investigated SAMPLE-C045 report (POISON-1) | D07 High + D07b Medium; unrecoverable by company | task-4.md`. No RISK row: nothing was credited or posted.
