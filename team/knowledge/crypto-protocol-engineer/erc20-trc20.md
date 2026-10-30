# ERC-20 and TRC-20: what a "payment" looks like on-chain

Accessed 2026-10-29 unless stated. Labels: [VERIFIED] = source opened or on-chain call made while
writing; [ASSUMPTION]; [GUESS].

## 1. The standard (ERC-20, status Final)
Source: ERC-20 text, `https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-20.md` (canonical
page https://eips.ethereum.org/EIPS/eip-20) [VERIFIED].

- `event Transfer(address indexed _from, address indexed _to, uint256 _value)`: "MUST trigger when
  tokens are transferred, including zero value transfers." Minting "SHOULD trigger a Transfer event with
  the `_from` address set to `0x0`." [VERIFIED]
- "Transfers of 0 values MUST be treated as normal transfers and fire the `Transfer` event" (both
  `transfer` and `transferFrom`) [VERIFIED]. Consequence: on tokens whose `transferFrom` accepts a
  zero amount with zero allowance, anyone can make the *genuine* contract emit
  `Transfer(victim → lookalike, 0)`; and anyone can deploy a token that emits any `Transfer` they like.
  That is the basis of zero-value and forged-transfer poisoning [ASSUMPTION: the standard permits it;
  the repo's POISON-2 real case shows a forged counterfeit-token transfer "from" a victim].
- `decimals()` is **OPTIONAL** ("can be used to improve usability … interfaces and other contracts MUST
  NOT expect these values to be present"). `name()` and `symbol()` are OPTIONAL too. [VERIFIED]
- `transferFrom(_from, _to, _value)`: "used for a withdraw workflow, allowing contracts to transfer
  tokens on your behalf"; it moves `_from`'s tokens if `msg.sender` has allowance. [VERIFIED]

### Topic hashes and selectors (computed with keccak-256 via `@noble/hashes`, 2026-10-29) [VERIFIED]
| Signature | keccak-256 (topic0 / first 4 bytes = selector) |
|---|---|
| `Transfer(address,address,uint256)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| `Approval(address,address,uint256)` | `0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925` |
| `transfer(address,uint256)` | `0xa9059cbb` |
| `transferFrom(address,address,uint256)` | `0x23b872dd` |
| `approve(address,uint256)` | `0x095ea7b3` |
| `symbol()` / `decimals()` / `name()` / `balanceOf(address)` | `0x95d89b41` / `0x313ce567` / `0x06fdde03` / `0x70a08231` |
| ERC-1155 `TransferSingle(address,address,address,uint256,uint256)` | `0xc3d58168…` (not a Transfer; ignore) |

ERC-721 also emits `Transfer(address,address,uint256)` with the **same topic0** but with the token id
**indexed**, so it has **4 topics** and empty data. `src/lib/chain/abi.ts` keeps only 3-topic logs, which
correctly drops ERC-721. [VERIFIED in code]

## 2. Decoding a Transfer log (EVM receipt)
A receipt log: `{address, topics[], data, logIndex, blockNumber, blockHash, transactionHash, removed}`.
- `address` = **the token contract that emitted the event**. This is the only field that says which
  token moved. Never trust `symbol()` alone.
- `topics[0]` = Transfer topic; `topics[1]` = from (left-padded to 32 bytes: last 20 bytes = address);
  `topics[2]` = to; `data` = uint256 value (32 bytes, big-endian) in **base units**.
- `logIndex` = position in the **block** (not the transaction). It changes if the transaction is
  re-included in a different block after a reorg. `removed: true` is set by nodes on logs removed by a
  reorg in subscriptions/filters. [ASSUMPTION: Ethereum JSON-RPC log object semantics, from
  `ethereum/execution-apis`; the `removed` field is visible in the repo's recorded receipts]
- Amount = value / 10^decimals, done with integers (`formatUnits` in `abi.ts`), never floats.

Worked example (real, recorded in `tests/fixtures/real/POISON-1.json`, Ethereum block 24,047,560,
2025-12-19T15:32:59Z) [VERIFIED from the recording]:
```
address  0xdac17f958d2ee523a2206206994597c13d831ec7   (Tether USDT, Ethereum)
topics   ddf252ad… | 000…cb80784ef74c98a89b6ab8d96ebe890859600819 | 000…baff2f13638c04b10f8119760b2d2ae86b08f8b5
data     0x…2d7985422f80  = 49,999,950,000,000 base units / 10^6 = 49,999,950.000000 USDT
logIndex 0x128 = 296
```
Genuine USDT, really sent, to `0xbaff…f8b5`: a poisoned look-alike of `0xbaf4…f8b5` (see
`attack-patterns.md`).

## 3. `transfer` vs `transferFrom`, batch payouts, routers
- The tx's `to` is often **not** the token: exchange batch payouts, DEX routers, Safe multisigs, ERC-4337
  bundlers, payment processors. The Transfer events in the receipt are the truth; the top-level call
  is only intent. Clearline decodes all Transfer logs and picks the one to our address (`pickTransfer`).
- `tx.from` ≠ Transfer `from` for `transferFrom`, a Safe, or an exchange hot wallet sweeping. Use the
  event's `from` for "who paid", and say "sent from" not "sent by".
- A failed (`status 0x0`) tx emits **no logs**; Clearline recovers the intended transfer from
  `transfer(address,uint256)` call data only to explain D03, never to count it. [VERIFIED in code]
- Fee-on-transfer / rebasing tokens: the Transfer value is what moved; balance deltas may differ.
  USDT has a fee mechanism (`basisPointsRate`, `maximumFee`) set to 0 today [ASSUMPTION for Ethereum;
  the Tron USDT ABI exposes `calcFee`, `basisPointsRate`, `maximumFee`, `setParams`: VERIFIED on-chain
  ABI, see §6]. If Tether ever sets a fee, the received amount < sent amount: compare the Transfer
  `value` to the invoice, which the code already does.

## 4. Decimals per official contract (read on-chain 2026-10-29 unless stated)

| Chain | Token | Contract | `decimals()` | Evidence |
|---|---|---|---|---|
| Ethereum | USDT | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 | Recorded `eth_call 0x313ce567` in `tests/fixtures/real/POISON-1.json` (eth.drpc.org, 2026-10-24) [VERIFIED from recording] |
| Ethereum | USDC | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 | `src/lib/fixtures/index.ts` comment: confirmed on Circle's page in week 3 [ASSUMPTION: not re-opened; developers.circle.com blocked in this session] |
| Tron | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (hex `41a614f803b6fd780986a42c78ec9c7f77e6ded13c`) | 6 | TronGrid `triggerconstantcontract decimals()` → 6, name "Tether USD", symbol "USDT", contract name `TetherToken` (`/wallet/getcontract`) [VERIFIED on-chain] |
| Arbitrum | USDC | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | 6 | arb1.arbitrum.io `eth_call` → "USDC", "USD Coin", 6, `isBlacklisted(0x0)` answers [VERIFIED on-chain; issuer listing ASSUMPTION] |
| Arbitrum | USDT0 | `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9` | 6 | symbol **"USD₮0"** (U+20AE), name "USD₮0"; no `isBlackListed`/`isBlacklisted` selector [VERIFIED on-chain] |
| Base | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 | mainnet.base.org `eth_call` → "USDC", 6, `isBlacklisted` answers [VERIFIED on-chain] |
| OP Mainnet | USDC | `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85` | 6 | mainnet.optimism.io → "USDC", 6, `isBlacklisted` answers [VERIFIED on-chain] |
| OP Mainnet | USDT (bridged) | `0x94b008aA00579c1307B0EF2c499aD98a8ce58e58` | 6 | → "USDT", "Tether USD", 6; **no** blacklist or `paused()` function: a bridged token, not Tether's own contract [VERIFIED on-chain] |
| BNB Chain | BSC-USD (Binance-Peg USDT) | `0x55d398326f99059fF775485246999027B3197955` | **18** | bsc-dataseed → symbol "USDT", name "Tether USD", **18 decimals**, no freeze function [VERIFIED on-chain] |
| BNB Chain | Binance-Peg USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | **18** | → "USDC", "USD Coin", **18** [VERIFIED on-chain] |
| Polygon | USDC / USDT | not checked | — | No reachable Polygon RPC in this session [could not verify] |

**Rules that follow:**
1. Decimals are per contract, not per symbol. "USDT has 6 decimals" is false on BNB Chain (18). A request
   for 100 USDT read with the wrong decimals is off by 10^12.
2. Never derive decimals from a symbol; read `decimals()` on the exact contract, and for official
   contracts **pin the expected value in settings and fail closed on mismatch** (gap G6 in
   `codebase-map.md`).
3. A token's `symbol()` and `decimals()` are whatever its deployer wrote. A counterfeit can return
   "USDT" and 6. Contract address is the identity.

## 5. TRC-20 differences (Tron)
Sources: TRON docs `mechanism-algorithm/account.md`, `mechanism-algorithm/resource.md`,
`contracts/contract.md`, `api/http/index.md` on `github.com/tronprotocol/documentation-en` (master)
[VERIFIED]; live TronGrid calls [VERIFIED on-chain].

- TVM is EVM-compatible at the ABI level: same Transfer topic `ddf252ad…`, same `transfer` selector
  `a9059cbb`, same 32-byte words. Tron USDT ABI (from `/wallet/getcontract`) has `Transfer(address
  indexed from, address indexed to, uint256 value)`. [VERIFIED on-chain]
- **Addresses**: 21 bytes = `0x41` + 20-byte hash; displayed as Base58Check (`T…`, 34 chars). Inside
  logs and ABI words the address is the **20 bytes without `41`**, and the log's `address` field is 40
  hex chars without prefix. Prepend `41` before base58check. [VERIFIED: doc + recorded TRN-01 receipt]
- Tx id = 64 hex **without** `0x`. Receipt via `/wallet/gettransactioninfobyid` returns `{id, fee,
  blockNumber, blockTimeStamp (ms), contract_address (41-hex), receipt{result, energy_usage, net_fee},
  log[]}`; empty `{}` until mined. `receipt.result` = `SUCCESS`, `REVERT`, `OUT_OF_ENERGY`,
  `OUT_OF_TIME`, … [VERIFIED: recorded TRN-01 and doc]. `log[i]` has no `logIndex`: Clearline uses the
  array position (event index within the transaction).
- `/walletsolidity/*` endpoints answer from **solidified** (irreversible) state; `/wallet/*` from the
  latest. `walletsolidity/gettransactioninfobyid` returns the same shape [VERIFIED live call on TRN-01].
- `visible: true` in requests → base58 addresses in responses; default `false` → hex. [VERIFIED doc]
- **Energy and bandwidth are irrelevant for reads.** They are consumed by the *sender* to execute and
  store a transaction (energy "only consumed when deploying or triggering a smart contract"; bandwidth
  for transaction bytes; 600 free bandwidth/day per account) [VERIFIED doc]. Constant calls
  (`triggerconstantcontract`) and `getblock`/`gettransactioninfobyid` cost Clearline nothing on-chain;
  only TronGrid's HTTP rate limit applies. Energy matters to us only as an *explanation*:
  `OUT_OF_ENERGY` is a failed payment (D03), fee burned in TRX, no USDT moved.
- Tron also has TRC-10 tokens (native assets, `TransferAssetContract`, no logs). USDT is TRC-20, not
  TRC-10. A TRC-10 "USDT" is a counterfeit by definition.

Worked example (real, `tests/fixtures/real/TRN-01.json`, Tron block 87,393,445, 2026-10-24T14:52:09Z)
[VERIFIED from recording; base58 computed with `src/lib/address.ts`]:
```
log.address a614f803b6fd780986a42c78ec9c7f77e6ded13c  → 41a614… → TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (USDT)
topics[1]   …d9251733398d2eef5b5a0be1d33fb1dbcbc401bc  → TVmN4nfC3NrgGxU3Ecpv9cvkc15h9upbFA (from)
topics[2]   …b4ba17ed21e62b43418ea5feb9677ff844f70dbe  → TSSoZb7K81i7NtoF7PEjDwG8m2gThoK9Zi (to)
data        …01004ccb00 = 4,300,000,000 / 10^6 = 4,300.000000 USDT; receipt.result SUCCESS
```

## 6. Issuer-specific functions on the token contracts
See `issuer-controls.md`. In short: USDT (TetherToken) exposes `isBlackListed`, `getBlackListStatus`,
`addBlackList`, `removeBlackList`, `destroyBlackFunds`, `pause`/`paused`, `deprecate`/`deprecated`/
`upgradedAddress`, fee params; USDC (FiatToken) exposes `isBlacklisted`, `blacklist`, `unBlacklist`,
`pause`/`paused`, `transferWithAuthorization` (EIP-3009) and `permit` (EIP-2612).

## Sources
- ERC-20: https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-20.md (accessed 2026-10-29) [VERIFIED]
- TRON docs (account, resource, contracts, HTTP API): https://github.com/tronprotocol/documentation-en/tree/master/docs (accessed 2026-10-29) [VERIFIED]
- On-chain: TronGrid `https://api.trongrid.io/wallet/getcontract`, `/wallet/triggerconstantcontract`; `https://arb1.arbitrum.io/rpc`, `https://mainnet.base.org`, `https://mainnet.optimism.io`, `https://bsc-dataseed.bnbchain.org` `eth_call` (2026-10-29) [VERIFIED]
- Repo recordings: `tests/fixtures/real/POISON-1.json`, `TRN-01.json`, `NET-ARB.json` (recorded 2026-10-24)
