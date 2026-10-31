# Fixture: inputs for ADR 0003 (scenario source for the 20 test payments), Mon 2 Nov 2026

From the scenario catalogue (PR #53, D2.3): 20 payments needed: exact ×4, partial ×3 (one accepted
short), over ×2, duplicate ×1, wrong token/counterfeit ×2, wrong network ×2, look-alike sender
address ×2, no reference ×2, still confirming ×1, plus one failed transfer.

What exists in the repo (real, read 2026-11-01): `tests/fixtures/real/` holds 58 recorded
request/response exchanges of real public transactions (files like ETH-01..08, BSC-01..06, FAIL-B1,
plus Tron and poisoning cases); `OFFLINE_REPLAY_DIR` answers chain lookups from them; no testnet is
configured in `src/` (no Sepolia/Nile/Shasta). Payment requests are Ethereum-only.

Notes gathered by crypto-protocol-engineer (2 Nov):
- "Circle runs a testnet USDC faucet on Sepolia" — source: a Medium tutorial (2025), not Circle's page.
  Circle's own docs page did not open from the session.
- A testnet run needs: Sepolia added as a chain (chain id, RPC, explorer), the official testnet USDC
  contract from the issuer's own page, a funded test wallet, and someone to send each payment.
  Counterfeit and look-alike cases need a fake token contract deployed and a vanity-ish address:
  both need signed transactions.
- Replaying real transfers: the invoices' receiving addresses must be set to the real recipients of
  those public transfers; Clearline never received that money.

Aashmiin (Decisions log, 1 Nov): "I want the demo to be honest. I don't want to spend more than an
hour of my own time on test wallets."

Do: write ADR 0003 as it would be committed, and the Approval Queue row.
