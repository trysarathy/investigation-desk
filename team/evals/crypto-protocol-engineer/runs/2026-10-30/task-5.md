# Task 5: USDT on the wrong network (REQ-1093 / INV-2207)

Source: `fixtures/t5-wrong-network.json` (real Arbitrum receipt NET-ARB, recorded 2026-10-24; Northwind Pay and its request/wallet note are fictional). Conversions computed this run [VERIFIED this run]; code behaviour read from the repo source [VERIFIED by reading]. No live chain calls.

## Answer to ops (short)
**No, don't mark INV-2207 paid, and don't post it to Xero.** The customer did send 3,876.96, but as **USDT0 on Arbitrum One**, not Tether USDT on Ethereum, which is what the request asked for. The money is sitting at your Safe's address **on Arbitrum**, where your Safe doesn't exist. **Getting it back is possibly doable, but only by your treasury, and it isn't certain.** It depends on whether your Safe can be re-created at the same address on Arbitrum (details below). Do that soon. Until it's done, nobody else should touch that address, and the invoice stays unpaid.

## 1. Decoding the transfer
| Fact | Raw | Decoded |
|---|---|---|
| Chain | lookups: only `arbitrum` = found (6 others not_found) | Arbitrum One |
| Tx / status | `0x54ab00b5…8495`, `status 0x1` | success |
| Block / time | `0x1ede2b7c`, `blockTimestamp 0x6adccd4b` | 517,876,604; **2026-10-24T15:22:51Z** |
| Emitting contract | `0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9` | Arbitrum **USDT0**: `symbol()` = `name()` = "USD₮0" (U+20AE TUGRIK SIGN, then digit zero), `decimals()` = 6 (read on Arbitrum per fixture; matches the pack's on-chain check 2026-10-29) |
| topic0 | `0xddf252ad…b3ef` | Transfer, 3 topics |
| from | `topics[1]` | `0xc1e767d996b3ce4b527b342d5c600dfa825368c5` (also `tx.from`; `tx.to` = the token, so a direct `transfer`) |
| to | `topics[2]` | **`0xb38e8c17e38363af6ebdcb3dae12e0243582891d`** = REQ-1093's receiving address, same 20 bytes |
| value | `0xe715b700` | 3,876,960,000 ÷ 10^6 = **3,876.960000** = REQ-1093 amount exactly |
| logIndex | `0x37` | 55; `removed: false` |

## 2. What the token is, and what it is not
- **It is:** USDT0 on Arbitrum. That's an omnichain USDT (LayerZero OFT) that has replaced bridged USDT on Arbitrum [ASSUMPTION: public descriptions, not opened this run]. It's a legitimate dollar token, not a scam contract, and it has 6 decimals.
- **It is not:**
  - Tether's own TetherToken on Ethereum (`0xdac17f958d2ee523a2206206994597c13d831ec7`), which is the request's `token_contract`.
  - On Ethereum at all. Ethereum lookup = not_found.
  - A token with Tether's freeze ABI. It has no `isBlackListed`/`isBlacklisted`/`paused()` (pack, on-chain 2026-10-29). So whatever issuer controls it has, "freeze checked" can't be claimed.
  - "Counterfeit" in Clearline's sense either. The right label is **wrong network** (and wrong token contract for this request), not "fake".

## 3. What Clearline does with it today
**Payment request (REQ-1093, live mode, someone pastes the hash with `attach_hash`):**
- `requests/provider.ts LiveHashProvider.lookup`: `fetchFacts` looks the hash up on all 7 chains. It's found on Arbitrum, so it returns `"Found on arbitrum, not Ethereum. Requests here are paid on Ethereum only."` and **records nothing** (no Observation, no evidence kept). That's gap G12.
- So REQ-1093 stays "awaiting payment" with no trace of the customer's payment except whatever the person writes in a note. The page's "wrong network" handling (`transferIssue` → `wrong_network`, `present.ts` copy, `accept_other_network`) exists in the code, but live lookups never feed it today. Only the demo/simulated path does.
- Even if it were recorded, `accept_other_network` is allowed only if `walletOf(data, "arbitrum", 0xb38e…)` is one of the business's own wallets **on Arbitrum** (`lifecycle.ts:454`). Treasury says there's no such wallet, so it would be refused, and correctly so.

**Deposit desk (`/investigate`):**
- Found on Arbitrum, which is a cross-check chain, not a deposit chain (`DEPOSIT_CHAINS` = tron, ethereum, bsc). If `0xb38e…891d` is in File A for `ethereum` (the scenario's File A row; not included in the JSON), then **D04 "Wrong network", High**: "Sent on arbitrum; address is registered on ethereum."
- Reply template: "Your {token} was sent on Arbitrum, but we only accept it on Ethereum. Our team is reviewing whether it can be recovered…", with `{token}` = "USD₮0".
- Next step comes from the boolean `keysHeldOnOtherChains` (sample = false): "Unrecoverable: the company does not hold this key on the network the funds arrived on." That wording is **too absolute for a Safe** (see §5).

## 4. Can it be marked paid, or posted to Xero? No.
- Marking paid: the request's token contract is Ethereum USDT. Nothing arrived at that contract, on that chain, at that address. Received on Ethereum = 0, so INV-2207 is unpaid.
- Posting: `accounting/rules.ts` treats `wrong_network` as **never posted** ("it was sent on Arbitrum, not Ethereum"). Even after a person's `accept_other_network`, Clearline only says "post it by hand if the money really is yours". The money isn't controllable by Northwind today, so it isn't theirs on the books yet. Posting it would book an asset nobody can spend.
- If the treasury recovers the funds (§5) and moves them to a wallet they control, that's a new, verifiable on-chain fact. A person can then settle INV-2207 against it with Aashmiin's/the business's approval, with the evidence attached.

## 5. Can the money be recovered? Possibly, by the treasury only, not certainly
The key fact is that `0xb38e…891d` is a **Safe (contract wallet), deployed on Ethereum only**. On Arbitrum, that address has no code. The USDT0 balance is recorded against it, but nobody can move it until code that the treasury controls exists at that address on Arbitrum.
- An EOA would be simple: the same private key controls the same address on every EVM chain. For a contract wallet, "same address" doesn't mean "same owner". A Safe's address comes from its factory deployment (normally CREATE2 over factory address + singleton + the exact setup data: owners, threshold, salt nonce).
  - **If** the Safe was created with a factory/singleton that exists at the same addresses on Arbitrum, and the treasury has the exact original setup parameters, they can deploy the identical Safe at `0xb38e…891d` on Arbitrum. The same 2-of-3 owners then control it, and they can move the 3,876.96 USDT0 (and bridge/swap it to Ethereum USDT if they want).
  - **If** it was created with an older factory version that isn't deployed at the same address on Arbitrum, or with different parameters, the address can't be reproduced. The funds are then effectively stuck.
  - Someone else racing to deploy at that address is a known risk with older, nonce-based factories (the 2022 Wintermute/Optimism OP incident) [ASSUMPTION: from memory, not opened this run]. That's a reason to act soon.
- Who does it: **Northwind's treasury, with its own signers, using Safe's tooling/support** [ASSUMPTION: Safe offers guidance for this; not opened]. Clearline doesn't deploy contracts, sign, hold keys or move funds. It can only verify afterwards, with read-only `eth_getCode(0xb38e…, Arbitrum)` and the next Transfer out.
- Other routes: the customer can't reverse an on-chain transfer. Asking the USDT0 issuer is a long shot, and there's no Tether freeze/reissue ABI on this contract.
- Next step for ops: tell the customer, neutrally, that it arrived on the wrong network and is being looked into, and **not to resend** until told. The `present.ts` wrong-network copy says exactly this ("please don't send again until they reply"). Only change the invoice once treasury reports the outcome.

## 6. Things in this token data that could trip our code
1. **`USD₮0` symbol.** U+20AE (₮) has no NFKD decomposition, and the trailing `0` makes it "USD₮0", not "USDT". `claimedSymbol` doesn't read it as claiming USDT (gap G8). If someone "fixes" that by folding ₮→T and dropping digits, it would be read as USDT. With no official Arbitrum USDT contract in Settings, D06 would then either be skipped or, once a contract is set, flag a **genuine** USDT0 as "fake". Fix it deliberately: put an issuer-sourced official contract per chain in Settings and treat USDT0 as its own token, never as a symbol-folding side effect.
2. **No Tether freeze ABI.** A freeze probe for "USDT" on this contract will revert. The result must be `not_supported` ("not available on this chain"), never "not frozen", and never a failed call that blocks the case.
3. **Decimals = 6 here**, but per-contract, not per-symbol (BSC-USD is 18). Keep reading/pinning decimals per contract (G6).
4. **Arbitrum block numbers (~0.25 s)**: confirmation counts are meaningless here ("12 confirmations" ≈ 3 s of sequencer trust). Use the L1-derived `safe`/`finalized` tags.
5. **Same 20-byte address on another chain**: the request matcher keys on address. A future multi-chain request matcher that matches on address alone would count this as paid. The chain and token contract must be part of the match.
6. **`keysHeldOnOtherChains` is a single boolean** that can't express "EOA keys yes, Safe not deployed". For a Safe it gives the wrong next step either way. It needs a per-wallet, per-chain fact ("deployed and controlled on chain X").
7. **G12**: the live request path throws away the evidence (no Observation, no raw response linked to the request). That's the reason this conversation needs an engineer at all.

## Notes
- [VERIFIED this run]: decoded amount/addresses/time/block. Code paths read: `requests/provider.ts:83`, `requests/lifecycle.ts:283,423,454`, `accounting/rules.ts:98-107`, `engine/rules.ts D04`, `catalogue.ts:44-47`, `templates.ts D04`.
- [ASSUMPTION]: what USDT0 is; Safe re-deployment mechanics for this particular Safe (factory version unknown); Wintermute precedent details; that File A registers `0xb38e…` on Ethereum (stated but not included in the JSON).
- Not checked: `eth_getCode` on Arbitrum for `0xb38e…` (no network this run). It's the first read-only call I'd make.
- Follow-ups (would go to the roadmap as `proposed`, not built tonight): G12 record wrong-network observations from live lookups; per-chain wallet deployment facts instead of `keysHeldOnOtherChains`; official per-chain contracts for cross-check chains (G8).
- WOULD WRITE (Log): `crypto-protocol-engineer | answered ops on REQ-1093 | wrong network (USDT0 on Arbitrum); not paid, not postable; recovery = treasury Safe redeploy, uncertain | task-5.md`.
