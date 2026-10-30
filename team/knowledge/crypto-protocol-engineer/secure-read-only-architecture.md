# Secure read-only architecture: the rules that keep Clearline non-custodial

Sources: `docs/SPEC.md` section 7, `docs/ACCOUNTING_SYNC.md` "Access", whitepaper sections 4.1, 5 and A.7
(`origin/whitepaper`), `docs/enterprise/ARCHITECTURE.md` (`origin/enterprise-pack`), and the code
[all VERIFIED 2026-10-29].

## The invariant
**No code path in Clearline can move funds.** It holds no private keys, seed phrases, signing ability,
token approvals, or roles on any contract; it calls only read endpoints with Clearline's own API keys
(never the customer's). The only write anywhere is to the accounting system, only through
`approveAndPost()`, only for a plan in state `ready`, only after a person clicks Approve, with an
idempotency key per line. Whitepaper 5: "If Clearline received, held or forwarded funds, it would become a
party to the payment and in Singapore would likely need a licence for digital payment token services"
[ASSUMPTION as stated there; no legal advice yet].

## Concrete rules for every PR
1. **Allowed chain methods only**: `eth_getTransactionByHash`, `eth_getTransactionReceipt`,
   `eth_getBlockByNumber`, `eth_blockNumber`, `eth_call`, `eth_getLogs` (read), `eth_chainId`; TronGrid
   `/wallet/get*`, `/walletsolidity/*`, `/wallet/triggerconstantcontract`, TronGrid v1 GETs; Etherscan
   `module=proxy|account|contract` reads; Blockscout GETs. **Forbidden**: `eth_sendRawTransaction`,
   `eth_sendTransaction`, `eth_sign*`, `personal_*`, `wallet_*`, TronGrid `broadcasttransaction`,
   `createtransaction`, `triggersmartcontract` (builds a tx; use `triggerconstantcontract`), any signer
   library (ethers `Wallet`, viem `privateKeyToAccount`, TronWeb with a private key, `@noble/secp256k1`
   signing). A grep for these is part of the PR self-check (playbook §6).
2. **Refunds and returns are instructions, not transactions.** `present.ts refundInstruction` produces text
   for the business's treasury to execute in its own wallet. Never a "send" button, never a pre-signed tx,
   never a WalletConnect session requesting `eth_sendTransaction`.
3. **Keys and tokens**: chain API keys from env only (`live.ts`); Etherscan key redacted from stored URLs
   (`http.ts redact`); TronGrid key in a header, never stored; Xero tokens server-side in the data dir,
   never in the browser or repo. No secret in code, logs, fixtures, PRs or chat (company rule 4). Recorded
   fixtures must be scrubbed of keys (they are: `secretParams` redaction).
4. **Unknown pauses**: a missing fact never becomes a verdict that leads to crediting or posting.
5. **Deterministic core, AI at the edge**: rules decide; AI only words; output validated; evidence only.
6. **Append-only history**: decisions, activity, check snapshots, posting audit, `audit.jsonl`.
7. **A person approves anything that changes the books**; counterfeit, failed, wrong-network and wrong-token
   transfers are never posted, whatever a person clicks.
8. **Least data**: addresses, hashes, amounts, pseudonymous customer refs; no names/emails/ID documents in
   chain-facing code.

## Known gaps (whitepaper 5 table, and this pack)
No sign-in (typed name + optional Basic auth); Xero tokens unencrypted on disk; audit log not
tamper-evident; JSON files, one process; posting function accepts approval without the plan key (route
enforces it); no pen test. Protocol gaps G1-G12 in `codebase-map.md`. Don't claim any of these are solved.

## Requests that break the invariant (always refuse, offer the read-only alternative)
| Request | Why not | Read-only alternative |
|---|---|---|
| "Auto-refund the overpayment" / "Refund button" | needs a signer and funds | refund instruction + treasury executes; Clearline verifies the refund tx afterwards |
| "Sweep deposit addresses to treasury" | custody | business's custody provider sweeps; Clearline reads both legs |
| "Generate a fresh deposit address per invoice" | needs key material (HD xpub derivation is borderline: it creates addresses whose keys the business holds, and Clearline would then be trusted to derive them correctly) | business's custody provider issues addresses via its API; Clearline stores and watches them (whitepaper 4.4 plan) |
| "Top up gas for the customer" | moves funds | out of scope |
| "Use this private key to test end to end" | secret handling + signing | recorded fixtures, simulated provider, or a person sends a testnet/mainnet payment from their own wallet and gives us the hash |
| "Ask the customer for their seed phrase/API key with trading permission" | rule 3 | read-only API keys from their custody provider, only after Aashmiin approves |
