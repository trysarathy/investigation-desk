# Sanctions and issuer-freeze data sources, and their limits

Written 2026-11-02 for S1 "release checks" (Aashmiin's decision, 2 Nov: the paid wording says only what
was checked). Code: `src/lib/requests/release-checks.ts` (wording), `sanctions.ts` (OFAC snapshot),
`freeze.ts` (issuer calls, stacked PR `feat/s1-freeze`), `finality.ts` (stacked PR `feat/s1-finality`). Labels follow company rule 2: **[VERIFIED: who date, url]** only when the
primary source itself was opened in this run.

**This is not a compliance or KYT screening product and not legal advice.** It looks up one address
against a list OFAC chose to publish, and asks the issuer's contract one yes/no question. A "passed"
means "not found in what we looked at, at that moment", nothing more.

## 1. OFAC SDN list (sender screening)

| Fact | Label |
|---|---|
| Treasury's own SDN-list page now lives at `https://sanctionslist.ofac.treas.gov/Home/SdnList`: `https://home.treasury.gov/policy-issues/financial-sanctions/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists` answers HTTP 302 to it | [VERIFIED: crypto-protocol-engineer 2026-11-02, https://home.treasury.gov/policy-issues/financial-sanctions/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists (redirect only; target page not opened)] |
| OFAC's FAQs moved to `ofac.treasury.gov` (`home.treasury.gov/policy-issues/financial-sanctions/faqs/562` → 302 `https://ofac.treasury.gov/faqs/562`) | [VERIFIED: crypto-protocol-engineer 2026-11-02, same method (redirect only)] |
| Digital-currency addresses appear in an SDN entry's ID list with ID type `Digital Currency Address - <ticker>` (e.g. `XBT`, `ETH`, `USDT`, `TRX`, `USDC`, `XMR`, `LTC`, `BSV`, `ARB`, `BSC`...), the address as the ID number; the ticker is the asset OFAC tagged, not always the chain (a `USDT` entry can be a Tron `T...` or an Ethereum `0x...` address) | [ASSUMPTION: secondary — OFAC FAQ 562/594 as summarised in public mirrors and vendor docs; sanctionslist.ofac.treas.gov and ofac.treasury.gov not reachable] |
| Official files: SDN list in XML (`SDN.XML`, plus the "advanced" `SDN_ADVANCED.XML`) and CSV (`SDN.CSV` + `ADD.CSV`/`ALT.CSV`; in the legacy CSV, IDs sit inside the remarks text) from the Sanctions List Service; the list carries a publish date | [ASSUMPTION: secondary, same reason] |
| OFAC states the listed addresses are not necessarily all the addresses an SDN controls; property of an SDN is blocked whether or not its address is listed | [ASSUMPTION: secondary — FAQ 562 wording not opened] |

**How we use it.** `sanctions.ts` loads a *recorded* snapshot (`src/lib/requests/sanctions-snapshot/ofac-sdn-digital-currency.json`)
with provenance: source URL, fetch time, the list's publish date, sha256 of the downloaded file. Only
EVM (`0x` + 40 hex) and Tron (`T` + 33 base58) addresses are used; XBT/XMR/LTC etc. are kept out (no
chain of ours uses them). EVM matching is checksum-insensitive and **across every EVM chain** (one key
holder, same address on Ethereum/BNB/Polygon/...), whatever ticker OFAC tagged; Tron base58 matches
exactly. A snapshot fetched more than **7 days** before the check is not used (OFAC adds addresses
without notice): that is our policy, not OFAC's.

**Status on 2026-11-02: no snapshot is shipped.** sanctionslist.ofac.treas.gov, ofac.treasury.gov and
www.treasury.gov (the old `/ofac/downloads/sdn.xml` path) do not resolve from the build session, and we
do not copy addresses from GitHub mirrors or vendors. So the sanctions check returns `not_run` and the
headline says **"Sender NOT checked."** To record one: allow the hosts below, download `SDN.XML` from
the Sanctions List Service, keep the `Digital Currency Address - *` IDs with their SDN uid, write the
JSON with the four provenance fields, commit it in its own PR (approval-only).

### Limits (say these plainly; the UI line under the headline does)
- **Only addresses OFAC chose to publish.** Not every address of a sanctioned person; not their new
  addresses until OFAC adds them; not addresses of entities owned 50% or more by SDNs (**the 50% rule
  is not checked**); not indirect exposure (funds that passed through a sanctioned address or mixer one
  hop earlier); not the receiving side's counterparties. Chain-analytics (KYT) vendors do that; we don't.
- **Only the US SDN list.** Not checked: OFAC's non-SDN lists (e.g. Sectoral Sanctions, NS-MBS), the
  **UN Security Council Consolidated List**, **EU** consolidated list, **UK** (OFSI/FCDO) list,
  **Singapore** (MAS targeted financial sanctions, which largely implement UN designations, and the
  Terrorism (Suppression of Financing) Act lists), **Hong Kong** (HKMA / UN sanctions ordinances),
  **UAE** (Local Terrorist List / UN), or any other country's. None of these publish addresses in the
  same structured way as OFAC [ASSUMPTION: not opened; their hosts are blocked].
- **Staleness.** The answer is as of the snapshot's list date; the line under the headline always shows it.
- **Sender only.** The receiving address is the business's own, so it is not screened.
- **Wording (2 Nov, QA applying Aashmiin's rule that wording states only checks that ran):** the headline
  says "Sender not on the US OFAC SDN list." (her example "public sanctions lists" was illustrative;
  she can overrule). The line underneath names the list date and the lists not checked.
- **Internal only.** Sanctions and freeze sentences never go into payer-facing text (tipping-off,
  docs/SPEC.md §2 legal note for D09/D14).

## 2. Issuer freeze (Tether, Circle)

| Contract | Read function (used) | Freeze events | Label |
|---|---|---|---|
| Tether USDT, Ethereum `0xdAC17F958D2ee523a2206206994597C13D831ec7` (contract `TetherToken`, solc v0.4.18) | `isBlackListed(address)` public mapping `0xe47d6060`; also `getBlackListStatus(address _maker) external constant` | `AddedBlackList(address _user)`, `RemovedBlackList(address _user)`, `DestroyedBlackFunds(address _blackListedUser, uint _balance)`: **not indexed on Ethereum** (the address is in `data`, not a topic) | [VERIFIED: crypto-protocol-engineer 2026-11-02, Etherscan verified source via https://api.etherscan.io/v2/api?chainid=1&module=contract&action=getsourcecode&address=0xdAC17F958D2ee523a2206206994597C13D831ec7 (SourceCode field sha256 36bf0b57…62b485f8)] |
| Tether USDT, Tron `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` (`TetherToken`, origin `THPvaUhoh2Qn2y9THCZML3H815hhFhn5YC`) | `isBlackListed(address)` View, `getBlackListStatus(address _maker)` View | same three events, **`_user` / `_blackListedUser` indexed on Tron** | [VERIFIED: crypto-protocol-engineer 2026-11-02, TronGrid `POST https://api.trongrid.io/wallet/getcontract` ABI] |
| Circle USDC, Ethereum `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (`FiatTokenProxy` → implementation `0x43506849d7c04f9138d1a2050bbf3a0c054402dd`, `FiatTokenV2_2`, solc v0.6.12) | `isBlacklisted(address) external view returns (bool)` `0xfe575a87` | `Blacklisted(address indexed _account)`, `UnBlacklisted(address indexed _account)`, `BlacklisterChanged(address indexed newBlacklister)` | [VERIFIED: crypto-protocol-engineer 2026-11-02, Etherscan verified source getsourcecode for the proxy and implementation (SourceCode field sha256 1a71101f…4606b9d)] |

Contract addresses on the issuers' own pages: Ethereum USDC `0xA0b86991…eB48` [VERIFIED:
crypto-protocol-engineer 2026-11-02, https://developers.circle.com/stablecoins/usdc-contract-addresses
(read with curl; WebFetch can't resolve the host)]; Ethereum USDT `0xdac17f95…1ec7` (as an Etherscan link)
and Tron USDT `TR7N…Lj6t` [VERIFIED: crypto-protocol-engineer 2026-11-02, https://tether.to/en/supported-protocols/ (curl)].

Semantics read from the source this run:
- **Tether, Ethereum:** `transfer` requires `!isBlackListed[msg.sender]`, `transferFrom` requires
  `!isBlackListed[_from]`; **the recipient is not checked**, so a payment can land in a frozen address
  and then can't leave [VERIFIED: same Etherscan source; this closes the Ethereum half of the
  ASSUMPTION in `issuer-controls.md` §2]. Tron: the same, proven by simulation on 2026-10-31
  [VERIFIED: crypto-protocol-engineer 2026-10-31, api.trongrid.io triggerconstantcontract].
- **Circle:** `transfer` is `notBlacklisted(msg.sender) notBlacklisted(to)`; `transferFrom` also
  `notBlacklisted(from)`: a payment to or from a blacklisted address reverts [VERIFIED: same source].

**How we use it.** `freeze.ts readIssuerFreeze()` calls the issuer function through the existing
provider layer (`EvmFetcher.ethCall` → Etherscan V2 `eth_call` at `latest`, or keyless RPC;
`TronFetcher.isBlackListed` → TronGrid `triggerconstantcontract`) for **both the sender and the
receiving address**. We check the receiver because Tether lets money into a frozen address (it is then
stuck): recommended and built. On Ethereum it also reads `eth_blockNumber` first, so the answer carries
the block; on Tron it carries the time only. Only the issuer's own contract is asked (a look-alike or
BNB Chain's company-declared contract → `not_run`). Any error, timeout or unreadable answer → `not_run`.
Recorded once, replayed offline: `tests/fixtures/real/FREEZE-*.json` (2026-11-02, ADR 0003).

### Limits
- **Point in time.** The answer is "as of block N / time T at `latest`", not at the payment's block
  (that needs an archive node, or the freeze events compared by block). It can change after: observed
  this run, Tron sender `TUDFqg6NhHGtcqn4nJzkCPfquwwm9MqBSb` (hex `c81a74ef…dcc6`), recorded frozen on
  2026-10-23 (real case FRZ-TF1), now reads **not frozen**: Tether emitted `RemovedBlackList` for it in
  block 87,479,978 (2026-10-27 15:00 UTC, tx `267bfded7390da2e…`) [VERIFIED on-chain:
  crypto-protocol-engineer 2026-11-02, api.trongrid.io `/v1/contracts/TR7N…/events?event_name=RemovedBlackList`
  and triggerconstantcontract]. So "Not frozen" is a snapshot, and so is "frozen".
- **Covered:** Tether USDT on Ethereum and Tron, Circle USDC on Ethereum (the contracts in Settings).
  **Not covered:** USDT0 (`isBlocked`), bridged tokens with no issuer controls (BNB Chain BSC-USD /
  Binance-Peg USDC, OP USDT), pause state (`paused()`, gap G7), Tether `deprecated()` forwarding.
- `destroyBlackFunds` can later wipe a frozen balance (Tether); a "not frozen" today says nothing about it.
- A freeze is an issuer's decision, not a sanctions finding; a frozen sender may or may not be sanctioned.

## 3. What the product says when a check can't run
Exact strings from `releaseHeadline()` (tests in `tests/release-checks.test.ts`):
- All passed: "Paid and final. Right token and amount. Sender not on the US OFAC SDN list. Not frozen."
- Sanctions not run: "... Sender NOT checked. ..." · Freeze not run: "... Freeze status NOT checked."
- Token / amount not run: "Token NOT checked." / "Amount NOT checked." · Finality unknown: "Finality NOT checked." (not called paid)
- Not final: "Not final yet." + the 6a status sentence.
- Any blocking failure (wrong token, short, wrong network, look-alike or different receiving address, sanctioned, frozen): "Don't release: <what failed>."
- Overpaid: "Paid 5 USDT more than the invoice. Check with finance before refunding." (problem tone; a person decides, POSTING_RULES C5).
- "Paid" only when finality, token and amount all passed; otherwise "Final, but not confirmed as paid. …".
- The word "safe" is never produced (tested over all 324 combinations). Main lines carry no block numbers or "confirmations"; those are in `technical`.

## 4. Hosts to allow (environment → network access), then flip the labels above
`sanctionslist.ofac.treas.gov`, `ofac.treasury.gov`, `www.treasury.gov` (OFAC list + FAQs 562/594);
`scsanctions.un.org`, `main.un.org` (UN list); `www.mas.gov.sg` (Singapore); `www.gov.uk` (UK);
`www.hkma.gov.hk`; `github.com` web pages (circlefin/stablecoin-evm; read via Etherscan instead this
run). developers.circle.com and tether.to open with curl but not with WebFetch.
