# Runbook: chain data provider outage

Labels: **[VERIFIED]** read in the code; **[ASSUMPTION]** reasoned, not tested.

Alert: `chain_provider_outage:<network>` (src/server/ops/alerts.ts): in the alert window at least
`CLEARLINE_ALERT_CHAIN_MIN_READS` (default 5) chain reads for that network, and at least
`CLEARLINE_ALERT_CHAIN_UNAVAILABLE_SHARE` (default 50%) of them "unavailable" (`chain_reads.status`).

## What it means for customers

- [VERIFIED: src/lib/clearline/merchant/chain/client.ts] An unavailable read is recorded as unavailable: it never
  becomes "not found" or "paid". A payment whose chain transfer cannot be read is **not matched**; it waits. Nothing
  is auto-closed on missing chain evidence ("completed" is a claim; when unsure, abstain).
- Other networks and other addresses keep reconciling.
- So the impact is **delay**, not wrong results. Severity 2 if it lasts more than 2 hours for a network a customer
  uses; otherwise severity 3.

## Steps

1. Check the provider's own status page (TronGrid for `tron`; the Ethereum JSON-RPC / Etherscan provider for
   `ethereum`). Read `chain_reads.reason` for the network in the last hour (a description of the failure;
   as an owner query, aggregated by reason, never copied with addresses into a ticket): rate limiting (HTTP 429) or authentication (401/403) point to our key, 5xx and timeouts to the
   provider.
2. **Our key** (429/401/403): check the key is set and not revoked; if quota is exhausted, slow the schedule or wait
   for the quota window. Do not switch to an unauthenticated endpoint.
3. **Provider down**: post on the status page (component `chain_data`, impact `minor`; text: "Payments on TRON
   are confirmed late. Nothing is lost; they will be matched once the data provider recovers.").
4. Do nothing to the data. When the provider recovers, the next scheduled run (or a manual run from the merchant's
   runs page) reads again; the alert resolves on the worker's next pass after the share drops.
5. Longer than 24 hours: tell affected merchants directly that matching on that network is paused, and discuss a
   second provider (a code change: a new reader behind the same `ChainClient` interface; never a provider with
   unverified data, and it must pass the recorded-fixture tests).
6. Never mark payments matched by hand to "catch up".
