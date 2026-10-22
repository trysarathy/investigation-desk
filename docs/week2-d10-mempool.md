# D10 mempool check: Week 2 finding

**Decision: D10 is disabled** (`Settings.mempoolChecksEnabled = false`). A hash that is pending
or missing falls to D01, whose reply already says "it may not have been sent yet". The D10
rule, template and tests stay in the code so it can be turned back on.

D10 says "tx in the mempool but not mined after the chain's normal window". That needs two
facts: that the transaction is pending, and **since when**. Probed on 22 Oct 2026:

## TronGrid (Tron)

- `/wallet/getpendingsize` and `/wallet/gettransactionlistfrompending` work, but disagree with
  each other and between calls one second apart: sizes 452, 393, 287 against list lengths
  131, 440, 365. One pair of lists shared only 1 transaction. This looks like load-balanced
  nodes, each with its own pool.
- A transaction taken from the pending list was **not** found by `gettransactionfrompending`
  (a different node answered), and it was already mined (block 87324094, SUCCESS) seconds later.
- Tron blocks come every ~3 s and transactions expire after about a minute, so "pending
  longer than the normal window" barely exists on Tron.
- There is no first-seen time. `raw_data.timestamp` is set by the sender, so it isn't a
  first-seen time.

**Not reliable.**

## Etherscan API V2 (Ethereum)

- `eth_getTransactionByHash` does return pending transactions (`blockNumber: null`). All 3
  transactions sampled from Etherscan's `pending` block came back that way.
- There is no endpoint to list or watch the mempool (`eth_pendingTransactions` is rejected),
  and the answer reflects only Etherscan's own node's pool. A dropped or replaced transaction
  just disappears.
- There is no first-seen time, so "pending longer than the window" can't be decided from one
  lookup.

**Visible, but not reliable enough for a verdict.**

## What would make D10 work

Record our own first-seen time on the first lookup that returns "pending", and re-check on the
60-second auto re-check. That needs stored cases (database, week 5). Until then, pending
lookups show as "pending, not mined" in the evidence and the verdict is D01.
