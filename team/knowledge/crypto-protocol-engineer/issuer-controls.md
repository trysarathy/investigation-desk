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
topic0 hashes above are signature-only and identical either way].

Semantics [ASSUMPTION for the exact code paths; consistent with the repo's real cases]:
- `transfer`/`transferFrom` require that the *sender* (`msg.sender` / `_from`) is not blacklisted; the
  recorded real cases FRZ-EF1/EF2 (Ethereum) and FRZ-TF1/TF2 (Tron) are USDT transfers from blacklisted
  senders that **reverted** (REVERT). [VERIFIED from `tests/real_cases.json` labels, proven by the
  issuer's own `AddedBlackList` tx]
- Unlike USDC, Tether does not appear to block transfers **to** a blacklisted address [ASSUMPTION]: a
  payment can land in a frozen deposit address and be stuck. That makes "is the **business's own**
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
- Arbitrum USDT0 `0xFd08…Cbb9` ("USD₮0"): no `isBlackListed`/`isBlacklisted`/`paused()` selector. USDT0
  is an omnichain (LayerZero OFT) USDT [ASSUMPTION: from public descriptions, not opened]; whatever freeze
  mechanism it has is not the Tether ABI. Don't call D09 "checked" there.
- USDC on Arbitrum, Base, OP: native Circle FiatToken (answers `isBlacklisted`, `paused`) [VERIFIED
  on-chain; that these are Circle's listed addresses is ASSUMPTION until developers.circle.com is opened].

## 4. Official contract list (what Clearline may treat as "genuine")
Rule: only addresses on the issuer's own page, recorded with the URL and date, then confirmed on-chain
(`symbol`, `decimals`, freeze selector answers). Pages: Circle
`https://developers.circle.com/stablecoins/usdc-contract-addresses`, Tether
`https://tether.to/en/supported-protocols/`. **Both were blocked from this session on 2026-10-29**; the
table is what can be stated today.

| Chain | Token | Contract | Status of evidence |
|---|---|---|---|
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | In code since week 2 (SPEC: Coinbase asset page); on-chain recording shows symbol USDT, 6 dp. Issuer page not re-opened [ASSUMPTION] |
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | In code: "Circle's USDC contract-address page, confirmed in week 3" [ASSUMPTION: not re-opened] |
| Tron | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | On-chain: `TetherToken`, USDT, 6 dp, freeze ABI present [VERIFIED on-chain]; issuer listing per SPEC (Trust Wallet/imToken) |
| Tron | USDC | — | Circle wound down USDC on Tron [ASSUMPTION: SPEC flags it; verify on Circle's page]. Treat any Tron "USDC" as unsupported until confirmed |
| Arbitrum / Base / OP | USDC | see `erc20-trc20.md` §4 | On-chain FiatToken behaviour [VERIFIED]; issuer listing [ASSUMPTION] |
| BNB Chain | any | company-declared only | Neither issuer lists BNB Chain (SPEC, week 3) |

Tether discontinued support on Omni, Kusama, Bitcoin Cash SLP (2023), EOS and Algorand (minting stopped
2024; wind-down 2025, revised in Aug 2025 to not freeze the contracts) [ASSUMPTION: news summaries via
search; Tether's blog not opened]. None of these are Clearline chains; any "USDT" there is unsupported.

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
- https://developers.circle.com/stablecoins/usdc-contract-addresses and https://tether.to/en/supported-protocols/ (blocked this session; must be opened before any new official contract is added)
