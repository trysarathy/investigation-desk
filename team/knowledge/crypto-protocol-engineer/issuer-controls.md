# Issuer controls: Tether (USDT) and Circle (USDC) freeze, pause, upgrade

Accessed 2026-10-29. Clearline only **reads** these functions (`eth_call` / `triggerconstantcontract`).
It never calls a state-changing issuer function and has no role on any contract.

## 1. Circle USDC: FiatToken (source read)
Source: `github.com/circlefin/stablecoin-evm` (master): `contracts/v1/Blacklistable.sol`,
`contracts/v1/Pausable.sol`, `contracts/v1/FiatTokenV1.sol`, `contracts/v2/FiatTokenV2_2.sol`, README
[VERIFIED: files opened].

| Item | Signature | Selector / topic0 |
|---|---|---|
| Read freeze | `isBlacklisted(address) external view returns (bool)` | `0xfe575a87` |
| Freeze / unfreeze (blacklister role only) | `blacklist(address)`, `unBlacklist(address)` | `0xf9f92be4` / — |
| Events | `Blacklisted(address indexed _account)`, `UnBlacklisted(address indexed _account)`, `BlacklisterChanged(address indexed)` | `0xffa4e618…b855`, `0x117e3210…7c4e` |
| Pause (pauser role) | `pause()`, `unpause()`; `paused` public bool; events `Pause()`, `Unpause()` | `paused()` `0x5c975abb`; `Pause()` `0x6985a022…f625` |
| Gasless transfers | `transferWithAuthorization` (EIP-3009, `0xe3ee160e`), `receiveWithAuthorization`, `permit` (EIP-2612) | — |

Semantics [VERIFIED from source]:
- `transfer(to, value)` is `whenNotPaused notBlacklisted(msg.sender) notBlacklisted(to)`.
  `transferFrom` additionally checks `notBlacklisted(from)`. `mint` checks minter and `_to`.
  **A USDC payment to or from a blacklisted address reverts**: it never arrives (D03 + D09 finding).
- `approve` checks `msg.sender` and `spender`. When paused, transfers, approvals, mint and burn revert.
- V2.2 stores the blacklist flag in the **high bit of the balance slot** (`balanceAndBlacklistStates`);
  `_isBlacklisted` = `>> 255 == 1`. `initializeV2_2` blacklists the contract's own address. Read
  `isBlacklisted` via the public function, never by decoding storage.
- There is no "destroy" function: Circle freezes, it does not wipe balances in FiatToken.
- USDC is behind an upgradeable proxy (`proxyOwner`); the implementation can change. Always call the
  proxy address (the official contract), and treat a change of implementation as a reason to re-check.

## 2. Tether USDT: TetherToken
Ethereum source is verified on Etherscan (not reachable from this session); the **Tron** USDT ABI was read
on-chain via TronGrid `/wallet/getcontract` for `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (contract name
`TetherToken`, origin `THPvaUhoh2Qn2y9THCZML3H815hhFhn5YC`) [VERIFIED on-chain 2026-10-29].

| Item | Signature (Tron ABI, VERIFIED) | Selector / topic0 |
|---|---|---|
| Read freeze | `isBlackListed(address)` (public mapping) and `getBlackListStatus(address _maker)` | `0xe47d6060` / `0x59bf1abe` |
| Freeze / unfreeze (owner) | `addBlackList(address _evilUser)`, `removeBlackList(address _clearedUser)` | `0x0ecb93c0` / — |
| Wipe frozen balance (owner) | `destroyBlackFunds(address _blackListedUser)` | `0xf3bdc228` |
| Events | `AddedBlackList(address indexed _user)`, `RemovedBlackList(address indexed _user)`, `DestroyedBlackFunds(address indexed _blackListedUser, uint256 _balance)` | `0x42e16015…19dc`, `0xd7e9ec6e…470c`, `0x61e6e66b…98c6` |
| Pause | `pause()`, `unpause()`, `paused()`; events `Pause`, `Unpause` | `0x5c975abb` |
| Upgrade | `deprecate(address _upgradedAddress)`, `deprecated()`, `upgradedAddress()`; event `Deprecate(address newAddress)` | `0x0e136b19`, `0x26976e3f` |
| Fees | `setParams(newBasisPoints, newMaxFee)`, `basisPointsRate`, `maximumFee`, `calcFee` | — |
| Supply | `issue(amount)`, `redeem(amount)`; events `Issue`, `Redeem` | — |

State on 2026-10-29 (Tron) [VERIFIED on-chain]: `decimals()` = 6, `symbol()` = "USDT", `name()` =
"Tether USD", `paused()` = false, `deprecated()` = false.

Event indexing on the **Ethereum** TetherToken may differ from Tron (the Ethereum contract predates the
Tron deployment) [ASSUMPTION: check the verified source on Etherscan before writing a log filter; the
topic0 hashes above are signature-only and identical either way; etherscan.io still 403 and no Ethereum
RPC reachable on 2026-10-31]. On **Tron**, a simulated USDT `Transfer` carries 3 topics (from and to both
indexed) [VERIFIED on-chain: api.trongrid.io `triggerconstantcontract` logs, 2026-10-31].
Tether's own page says the Ethereum USD₮ contract "does not return a Boolean value in the transfer
function" (use SafeERC20 when calling it) [VERIFIED: https://tether.to/en/supported-protocols/, 2026-10-31].

Semantics [ASSUMPTION for the exact code paths; consistent with the repo's real cases]:
- `transfer`/`transferFrom` require that the *sender* (`msg.sender` / `_from`) is not blacklisted; the
  recorded real cases FRZ-EF1/EF2 (Ethereum) and FRZ-TF1/TF2 (Tron) are USDT transfers from blacklisted
  senders that **reverted** (REVERT). [VERIFIED from `tests/real_cases.json` labels, proven by the
  issuer's own `AddedBlackList` tx]
- Unlike USDC, Tether does not block transfers **to** a blacklisted address, at least on **Tron**
  [VERIFIED on-chain 2026-10-31: api.trongrid.io `triggerconstantcontract` on `TR7N…Lj6t`: `transfer` of 1
  base unit from the (non-blacklisted) contract origin to `TBzUpQyGiPP6uR8BwKkr6rsoYqdY9g8mNU`, for which
  `isBlackListed` = true, executed without revert and emitted a Transfer log (it returned `false` as its
  bool, so never trust the return value); the reverse, a transfer *from* that address, hit REVERT]. For the
  Ethereum contract this is still [ASSUMPTION: Etherscan source not readable]. A payment can land in a
  frozen deposit address and be stuck. That makes "is the **business's own**
  receiving address frozen" the more important check for receipts, which the code does do (role
  `deposit` in `freezeFacts`).
- `destroyBlackFunds` burns a frozen address's balance and emits `DestroyedBlackFunds`; a credited deposit
  can later vanish from the balance. That is an accounting contradiction worth surfacing (not built).
- When `deprecated` is true, the legacy contract forwards calls to `upgradedAddress`. If that ever
  happens, Transfer events may be emitted by the new contract: re-confirm the official contract.

## 3. Bridged and wrapped "USDT/USDC" (no issuer controls)
Measured 2026-10-29 [VERIFIED on-chain]:
- BNB Chain BSC-USD `0x55d3…7955` and Binance-Peg USDC `0x8AC7…580d`: 18 decimals; `isBlackListed`,
  `isBlacklisted` and `paused()` all revert. Issued by Binance, not Tether/Circle (SPEC section 3, week 3
  finding). D09 is "not available on this chain", correctly a known gap, not a missing fact.
- OP Mainnet "USDT" `0x94b0…8e58`: no blacklist or pause functions: a bridged standard token.
- Arbitrum USDT0 `0xFd08…Cbb9` ("USD₮0"): no `isBlackListed`/`isBlacklisted`/`paused()`/`pause()` selector,
  **but it is freezable** under different names (corrected 2026-10-31: was "believed to expose" an
  unchecked `isBlocked`). It is an EIP-1967 proxy, implementation `0x3263cd783823d04a6b9819517e0e6840d37ca3f4`
  (admin `0x553ec478…1b4a`); the implementation bytecode contains the selectors for
  `isBlocked(address)` `0xfbac3951`, `addToBlockedList(address)` `0x3c7c9b90`,
  `removeFromBlockedList(address)` `0x1a14f449` and `destroyBlockedFunds(address)` `0x0e27a385`, and
  `isBlocked(0x0)` answers `false` via the proxy [VERIFIED on-chain: arb1.arbitrum.io `eth_getStorageAt`
  slot 0x3608…2bbc, `eth_getCode`, `eth_call`, 2026-10-31]. Event names/topics for blocking and whether
  `isBlocked` also blocks the *recipient* are not known (no verified source: docs.usdt0.to blocked,
  Everdawn-Labs repos private). Omnichain link: `oftContract()` → `0x14E4a1B13bf7F943c8ff7C51fb60FA964A298D92`,
  whose `endpoint()` is `0x1a44076050125825900e736c501f859c50fE728c` and `oftVersion()` returns interface
  `0x02e49c2c`, v1 [VERIFIED on-chain, same date]; that address is LayerZero's EndpointV2 on Arbitrum as
  used in LayerZero's own scripts [VERIFIED: github.com/LayerZero-Labs/devtools
  `packages/script-devtools-evm-foundry/scripts/GasProfiling/OFTProfilerExample.s.sol`, read via git clone
  2026-10-31]. So USDT0 = token behind a LayerZero OFT adapter, with a Tether-style block list that is
  **not** the legacy Tether ABI. Clearline's D09 must read `isBlocked` here; until it does, don't call D09
  "checked" on Arbitrum USDT0. Tether's supported-protocols page lists no Arbitrum USD₮ contract
  [VERIFIED: https://tether.to/en/supported-protocols/, 2026-10-31].
- USDC on Arbitrum, Base, OP: native Circle FiatToken (answers `isBlacklisted`, `paused`) [VERIFIED
  on-chain] and all three addresses are on Circle's list [VERIFIED: https://developers.circle.com/stablecoins/usdc-contract-addresses, 2026-10-31].

## 4. Official contract list (what Clearline may treat as "genuine")
Rule: only addresses on the issuer's own page, recorded with the URL and date, then confirmed on-chain
(`symbol`, `decimals`, freeze selector answers). Pages: Circle
`https://developers.circle.com/stablecoins/usdc-contract-addresses`, Tether
`https://tether.to/en/supported-protocols/`. Blocked on 2026-10-29; **both opened 2026-10-31** and the
table re-checked against them.

| Chain | Token | Contract | Status of evidence |
|---|---|---|---|
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | Listed by Tether [VERIFIED: https://tether.to/en/supported-protocols/, 2026-10-31]; on-chain recording shows symbol USDT, 6 dp |
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | Listed by Circle [VERIFIED: https://developers.circle.com/stablecoins/usdc-contract-addresses, 2026-10-31] |
| Tron | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | Listed by Tether [VERIFIED: https://tether.to/en/supported-protocols/, 2026-10-31]; on-chain: `TetherToken`, USDT, 6 dp, freeze ABI present [VERIFIED on-chain] |
| Tron | USDC | — | Tron is **not** in Circle's mainnet USDC table [VERIFIED: https://developers.circle.com/stablecoins/usdc-contract-addresses, 2026-10-31]; Circle's wind-down announcement itself not opened (circle.com blocked). Treat any Tron "USDC" as not Circle-issued |
| Arbitrum / Base / OP | USDC | see `erc20-trc20.md` §4 | On-chain FiatToken behaviour [VERIFIED]; on Circle's list [VERIFIED: https://developers.circle.com/stablecoins/usdc-contract-addresses, 2026-10-31] |
| Polygon PoS | USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | On Circle's list [VERIFIED: https://developers.circle.com/stablecoins/usdc-contract-addresses, 2026-10-31]; decimals/freeze not read on-chain (no Polygon RPC reachable) |
| Polygon / Arbitrum / Base / OP | USDT | — | Tether's page lists no USD₮ contract on these chains (it lists Ethereum, Avalanche, Kava, Celo, Kaia, Tron, Liquid, Solana, Polkadot AssetHub, Tezos, Near, Ton, Aptos) [VERIFIED: https://tether.to/en/supported-protocols/, 2026-10-31]: any USDT there is bridged or USDT0, not on Tether's list |
| BNB Chain | USDT / USDC | company-declared only | Neither issuer lists a USD₮ or USDC contract on BNB Chain; Tether's page lists only **XAU₮** (`0x21cA…A3bf`) under BNB Smart Chain, and Circle's table has no BNB entry [VERIFIED: https://tether.to/en/supported-protocols/ and https://developers.circle.com/stablecoins/usdc-contract-addresses, 2026-10-31; corrected 2026-10-31: was "neither issuer lists BNB Chain"] |

Tether "is no longer issuing or obligated to redeem Tether Tokens on the Kusama, Bitcoin Cash SLP, Omni
Layer, EOS and Algorand blockchains" and lists them as deprecated; EUR₮ is wound down and CNH₮ redemption
ends 20 Feb 2027 [VERIFIED: https://tether.to/en/supported-protocols/, 2026-10-31]. The dates (SLP 2023, minting stopped 2024, wind-down
2025, Aug 2025 revision not to freeze) are still [ASSUMPTION: news summaries; tether.io announcement
blocked]. None of these are Clearline chains; any "USDT" there is unsupported.

## 5. What a freeze means for Clearline's verdicts
- D09 reads freeze state **at `latest` when the hash is looked up**, not at the payment's block. The
  repo's real cases FRZ-TD1..3, FRZ-ED1/2, FRZ-EC1 are deposits whose sender was blacklisted **after**
  paying ("has since blacklisted"). Evidence must say "frozen as of block N (checked at time T)", never
  "was frozen when it paid". To prove state at payment time, `eth_call` at the payment block (needs an
  archive node) or find the `AddedBlackList`/`Blacklisted` event and compare block numbers.
- Sender frozen + transfer succeeded ⇒ frozen later; the funds arrived. Compliance escalation, neutral
  reply (no tipping-off: SPEC's D09/D14 legal note).
- Sender frozen + transfer reverted ⇒ D03 primary, D09 finding (catalogue order).
- Business's own receiving address frozen ⇒ every future USDT payment there is stuck: a `RISK:` for the
  customer, surfaced loudly.
- Freeze call failed ⇒ unknown ⇒ D02/D12 blocked (`missingFact`), never "not frozen".
- Pause: transfers revert while paused; already-mined payments are unaffected. Worth showing as a
  chain-wide banner (not built: gap G7).

## Sources
- https://github.com/circlefin/stablecoin-evm (contracts/v1/Blacklistable.sol, Pausable.sol, FiatTokenV1.sol, contracts/v2/FiatTokenV2_2.sol), accessed 2026-10-29 [VERIFIED]
- TronGrid `POST https://api.trongrid.io/wallet/getcontract {"value":"TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t","visible":true}` and `triggerconstantcontract` reads, 2026-10-29 [VERIFIED]
- `tests/real_cases.json` FRZ-* labels and `tests/fixtures/real/FRZ-*.json` recordings (recorded 2026-10-24)
- Selectors/topics: keccak-256 computed locally with `@noble/hashes` [VERIFIED]
- https://developers.circle.com/stablecoins/usdc-contract-addresses and https://tether.to/en/supported-protocols/ (blocked 2026-10-29; opened 2026-10-31) [VERIFIED]
- USDT0 on Arbitrum: arb1.arbitrum.io `eth_getStorageAt` (EIP-1967 slots), `eth_getCode` of implementation `0x3263…a3f4`, `eth_call` `isBlocked`/`decimals`/`oftContract`/`endpoint`/`oftVersion`, 2026-10-31 [VERIFIED on-chain]; selectors computed locally (pure-Python keccak-256, checked against `transfer`/`decimals`/`isBlacklisted`)
- LayerZero EndpointV2 address on Arbitrum: github.com/LayerZero-Labs/devtools (git clone, 2026-10-31) [VERIFIED]; docs.layerzero.network, docs.usdt0.to blocked
- Tron to-blacklisted simulation: `triggerconstantcontract` transfer from `THPvaUhoh2Qn2y9THCZML3H815hhFhn5YC` to `TBzUpQyGiPP6uR8BwKkr6rsoYqdY9g8mNU`, 2026-10-31 [VERIFIED on-chain]
