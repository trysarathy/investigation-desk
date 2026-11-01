# 3. The 20 demo payments are replayed real recorded transfers, not a testnet

Date: 2026-11-01 (SGT)

## Status

**Accepted** by Aashmiin Kaur, 2026-11-01 ("ADR 0003: approved — replay real recorded transfers").

## Context

Target 2 of the 14-day plan (`docs/PLAN_14_DAY.md`) needs 20 test payments covering exact, partial,
over, wrong token, wrong network and a look-alike address. Two sources were possible:

- **A testnet** (e.g. Sepolia with a test USDC contract). Needs a wallet that Aashmiin controls and
  sends from, her time for every payment, and a new chain and token contract in the code. Clearline
  never holds keys, so agents cannot send testnet payments themselves.
- **Replayed real recorded transfers.** Real public USDC/USDT transfers already on Ethereum, Tron and
  BNB Chain, whose raw chain responses are recorded once and replayed offline in tests. The repo
  already does this for the checking engine (`tests/fixtures/real/`, `tests/real_cases*.json`).

## Decision

The 20 demo payments are **real public transfers, recorded once and replayed**:

1. Each scenario stores the raw chain responses it needs (transaction, receipt/logs, block with its
   finality status), the URL and time they were fetched, and the explorer link, under
   `tests/fixtures/real/scenarios/` with a provenance file. No response is edited by hand.
2. Invoices for the demo are **fictional and labelled so** (sample company, sample invoice numbers);
   the transfers are real and labelled "real public transfer, not a Clearline customer".
3. A scenario that cannot be found as a real transfer (e.g. a specific look-alike address case) is
   built only from real transfers paired with a fictional invoice, never a made-up transaction. If
   none exists, the gap is reported, not faked.
4. The replay runs offline in CI and in `npm run demo:check`; live fetching is only used to record.
5. The same 20 scenarios are the labelled set for the first invoice-matching measurement
   (matching-engine-engineer), reported with n = 20 and Wilson intervals in `docs/MATCHING_EVALS.md`.

## Consequences

- No keys, no wallet and no new chain are needed; Aashmiin's time is not spent sending payments.
- Every demo screen must say the invoices are sample data and the transfers are real public ones.
- A live "watch my address" demo still needs a real address with incoming transfers; the replay
  shows the same code path with recorded responses, and the demo script says so.
- 20 is a small set: any accuracy figure from it is stated with its n and interval, never as a
  headline percentage.
