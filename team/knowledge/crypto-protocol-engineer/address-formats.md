# Address formats: EVM, Tron, ENS, Solana

Accessed 2026-10-29.

## EVM (Ethereum, BNB Chain, Polygon, Base, Arbitrum, Optimism)
- 20 bytes = last 20 bytes of keccak-256(public key), written `0x` + 40 hex. **The same EOA address
  exists on every EVM chain** (same key controls it everywhere). That is why wrong-network sends land
  (D04): the address is valid on the other chain, and whether funds are recoverable depends on whether the
  business controls **that key** there. For a **smart-contract wallet** (Safe, ERC-4337 account, exchange
  deposit contract) the same address on another chain may be undeployed, deployed by someone else, or
  deployable only with the original factory/salt: "same address" does not mean "same owner".
  Derivation facts [VERIFIED: raw.githubusercontent.com/ethereum/ethereum-org-website/dev/public/content/developers/docs/accounts/index.md, 2026-10-31]:
  EOA address = "the last 20 bytes of the Keccak-256 hash of the public key" with `0x`; a `CREATE`
  contract address "comes from the creator's address and ... the nonce"; `CREATE2` from creator, salt and
  creation-code hash. That the same key gives the same address on every EVM chain, and the
  smart-wallet consequences, follow from this [ASSUMPTION: inference, not stated on the page].
- **EIP-55 mixed-case checksum** (ERC-55, status Final) [VERIFIED:
  `raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-55.md`]: hash the lower-case hex (no `0x`)
  with keccak-256; for each hex *letter* at position i, upper-case it if the i-th nibble of the hash is ≥ 8.
  "On average there will be 15 check bits per address, and the net probability that a randomly generated
  address if mistyped will accidentally pass a check is 0.0247%." Test vector:
  `0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed`.
  - All-lower or all-upper = **no checksum** (valid, unchecked). Mixed case that fails = almost certainly a
    typo: reject with a clear message, never silently lower-case it.
  - EIP-1191 (Last Call) adds the chain id into the checksum for chains that opt in (RSK); not used by our
    chains. Don't apply it. [VERIFIED: erc-1191.md]
- Clearline: canonical form = lower-case with `0x` (`src/lib/address.ts`). EIP-55 is enforced in
  `csv/files.ts checkAddress` (Files A/B) but **not** in `requests/lifecycle.ts validateRequest` or
  `api/accounting/import` (gap G3). The checksum protects against typos only, **not** against
  look-alike/poisoned addresses, which are valid addresses with valid checksums.
- Special addresses: `0x0000…0000` (mint/burn in Transfer events), `0x…dEaD` burn; precompiles
  `0x…01`-`0x…0a`. A payment "from 0x0" is a mint, not a customer.

## Tron
Source: TRON docs `mechanism-algorithm/account.md` [VERIFIED].
- Address = `0x41` + last 20 bytes of keccak-256(public key), then **Base58Check**: checksum = first 4
  bytes of sha256(sha256(payload)); base58 alphabet excludes `0 O I l`. Because the first byte is `0x41`,
  the string always starts with **`T`** and is 34 characters. [VERIFIED]
- Hex form `41…` (42 hex chars) appears in API responses with `visible:false`; inside ABI words and logs
  the `41` is dropped (20 bytes). [VERIFIED: docs + TRN-01 recording]
- A Tron address and an EVM address share the same 20-byte body if derived from the same key, but a Tron
  address can't receive on an EVM chain by mistake (different format): D04 never applies to Tron
  (`rules.ts`). A Tron hex body pasted as `0x…` into an EVM wallet *would* be a valid EVM address: a
  potential wrong-network trap [ASSUMPTION].
- Clearline: `tronHexToBase58` / `tronToHex` in `address.ts`; **`tronToHex` does not check the base58
  checksum** (gap G5); `csv/files.ts checkAddress` does (round-trip compare).

## ENS (ERC-137)
- ENS names (`alice.eth`) resolve to addresses via the registry/resolver; resolution can change at any
  time the owner updates it. ERC-681 says resolution "is up to the payer" and "Hexadecimal addresses
  always take precedence over ENS names" [VERIFIED: erc-681.md, erc-137.md].
- Clearline rule: never accept an ENS name as a receiving address on a request; store and show the hex
  address only. If a customer pays "to alice.eth", the chain records the resolved hex address; match on
  that.

## Solana (not a v1 chain; SPEC: v1.1)
- Ed25519 public keys, base58, 32 bytes (typically 43-44 chars). SPL tokens live in **associated token
  accounts** derived from (owner, mint); a payment goes to the ATA, not the wallet address; transfers are
  instructions inside a tx, identified by signature, not by EVM-style logs. USDC mint
  `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` [ASSUMPTION: third-party listing via search; Circle's page
  not opened]. Adding Solana is a new adapter and a new matching key (signature + instruction index), not
  a config change.

## Look-alikes (poisoning) vs checksum
EIP-55 and Base58Check catch random typos. They do **not** catch an attacker-generated vanity address that
matches the first and last characters, because it is a real, correctly checksummed address. Detection
needs comparison with the *intended* address (see `attack-patterns.md`). Clearline's two definitions:
engine `looksAlike` = first 3 + last 4 significant chars; sender checker `compareAddress` = first 4 OR
last 4 hex chars (gap G11). Real case POISON-1 (`0xbaf4…f8b5` vs `0xbaff…f8b5`) shows why first-4 is too
strict for the engine.

## Sources
- ERC-55: https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-55.md (accessed 2026-10-29) [VERIFIED]
- ERC-1191: https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-1191.md (accessed 2026-10-29) [VERIFIED]
- ERC-137 (ENS) and ERC-681: same repo, accessed 2026-10-29 [VERIFIED]
- TRON account model: https://github.com/tronprotocol/documentation-en/blob/master/docs/mechanism-algorithm/account.md (accessed 2026-10-29) [VERIFIED]
