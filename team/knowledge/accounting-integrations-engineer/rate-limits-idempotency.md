# Rate limits, idempotency and retries

## Facts
- Xero `Idempotency-Key` header, 128 characters max [VERIFIED: Xero OpenAPI 19.1.0 opened 2026-11-01]. Key
  retention time and behaviour for a reused key with a different body: **not in the spec** [ASSUMPTION: open
  developer.xero.com idempotency guide].
- Xero per-org limits 5 concurrent / 60 per minute / 5,000 per day, app-wide 10,000 per minute, 429 when
  exceeded [ASSUMPTION: secondary, search summary of developer.xero.com/faq/limits]. Retry header names not
  confirmed.
- QBO `requestid` query parameter, unique per company, ≤ 50 chars non-batch [ASSUMPTION: secondary, search
  summary of developer.intuit.com].
- Xero access token 30 min, refresh 60 days [VERIFIED: xero-node README opened 2026-11-01]; QBO access 1 h, old
  refresh token dies 24 h after a new one is issued [VERIFIED: intuit/oauth-jsclient README opened 2026-11-01].

## How our code behaves [VERIFIED: code @0c7d9f1, read 2026-11-01]
- Plan key = sha256(request id + each line's kind|amount|observationKey|accountCode), so the same plan always
  gives the same key; a changed plan gives a new key and must be approved again (`expectedKey`).
- Per line, key `<planKey>-<i>`; credit-note allocation `-alloc`; QBO link payment `-link`.
- Lines already in the audit log as `posted` are dropped from the next plan (one line per transfer, ever).
- `PartialPostError`: lines that reached the books before a failure are recorded as posted.
- **No automatic retry, no 429 handling, no `Retry-After`.** A failure becomes a `failed` audit entry; a person
  approves again (same key, so already-created records are returned, not duplicated, *if* Xero still remembers
  the key).

## The design rule (how the best teams do it, see `benchmark-practices.md`)
1. **Idempotent by construction**: a deterministic key per external write, derived from the facts, never random
   per attempt. ✓ today.
2. **The ledger of record is ours first**: write "approved" before calling out, "posted" with the external id
   after; on an ambiguous outcome (timeout, 5xx, connection reset) the state is *unknown*, not *failed*. Today a
   timeout after Xero created the payment is logged `failed`; a retry with the same key is safe only while Xero
   keeps the key. Proposed: on ambiguous outcomes, **read back** (`GET /Payments?where=Reference…` or by invoice)
   before re-posting.
3. **Retry only what's safe**: 429 and 5xx with backoff and jitter, honouring any retry-after header; never retry
   a 400 (validation) automatically; cap attempts (e.g. 3); serialise calls per tenant (Xero's concurrency limit)
   [ASSUMPTION: policy proposal].
4. **Budget calls**: a plan is ≤ 4 calls per line (fee write-off = 2). 60/min/org is ample for one approval at a
   time; bulk import (`GET /Invoices?summaryOnly=true`) must page [ASSUMPTION: page size not checked].
5. **Never log a token, an auth header or a token-endpoint body.** `xero-auth.ts` already refuses to echo the
   token body; error messages include up to 300 chars of the API body, which for the Accounting API contains
   validation text, not tokens [ASSUMPTION; check in sandbox].
