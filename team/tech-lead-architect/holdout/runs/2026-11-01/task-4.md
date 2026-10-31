# Task 4: ADR for the posting idempotency key, Fri 6 Nov 2026, 21:17 SGT

The number: `0003` is taken by the scenario-source ADR (D2.4), so the next free number is **0004**. I would run `ls docs/adr` before committing. If 0004 is already taken, I take the next free one. Numbers are never reused.

File: `docs/adr/0004-separate-approval-token-from-books-idempotency-key.md`, on branch `docs/adr-0004-approval-token`.

---

```markdown
# 4. A single-use approval token authorises a posting; a stored posting id, not a hash of public facts, keys Xero writes

Date: 2026-11-06 (SGT)

## Status
**Proposed** (tech-lead-architect, 2026-11-06). Approval-only and hard to reverse:
- it changes auth (who may approve a posting) and posting (the key sent to Xero);
- the key format ends up inside writes to the books (OPERATING_MODEL §2; adr-guide "hard to reverse" #4).

Only Aashmiin can move it to Accepted. Approval Queue row: "ADR 0004: approval token + stored posting id".

## Context
- **The code today** [VERIFIED: code read at `0c7d9f1`, 2026-11-06]:
  - `idempotencyKeyFor(requestId, lines)` in `src/lib/accounting/rules.ts:68` returns `clearline-` + the first 32 hex of sha256 of `requestId;kind|amount|observationKey|accountCode;...`.
  - `POST /api/accounting/<id>` takes `{ actor, key }` (`src/app/api/accounting/[id]/route.ts:2,9-13`).
  - `approveAndPost` (`src/lib/accounting/engine.ts`) refuses a key that differs from the current plan's, appends `approved` with `idempotencyKey`, then calls the adapter.
  - The Xero adapter sends the same value as the `Idempotency-Key` header (`providers/xero.ts:67`), with `-<i>` and `-alloc` suffixes (`xero.ts:98`).
  - Audit rows store `idempotencyKey` (`accounting/types.ts` `AuditEntry`).
- **The key does two jobs that pull in opposite directions:**
  1. Proving a person looked at *this* plan and clicked Approve. That needs something the attacker cannot know, used once.
  2. Making a retried write to Xero land once. That needs the *same* value on every retry of the same approved posting.
- **The flaw** (SECURITY_GAPS #2, High) [VERIFIED: qa-security-engineer 2026-10-31, reproduced by test and by hand on `8decb27`]:
  - Every input to the hash is a fact a payer can know.
  - So a cross-site `text/plain` POST with a recomputed key was posted to the demo books under a typed name.
  - There is no CSRF check on any route.
- **Store**:
  - `.data/accounting.json` on the shared preview holds 31 posted audit rows keyed with the current scheme. They are demo books (fictional, labelled "Demo data"), not a real Xero org.
  - There are no migrations: loads spread `{...empty(), ...file}` (ARCHITECTURE §1.2). New fields must be optional and old files must load.
- **Unknown**: how long Xero honours an `Idempotency-Key`, and whether keys are scoped per tenant or per app. [ASSUMPTION: not checked; nobody on the team has opened Xero's documentation on this; developer.xero.com was blocked on 2026-11-01.] This ADR must not depend on the answer. Where it matters, the design fails closed.
- **No real login exists yet** (week-5 plan in code comments). "Session-bound" is not available. Today's binding is to the plan and the page render.
- **Options**
  - **Do nothing.** It loses: a High gap that skips the human approval step and forges the audit trail. It blocks target 4 being honest.
  - **A. Fix CSRF only** (Origin / `Sec-Fetch-Site` in middleware). Necessary, and we do it (step 1 below). On its own it is not enough: the approval key stays computable, so any same-origin or non-browser caller (scripts, a future integration, a curl from anyone past the preview gate) can approve without seeing the plan. Approval still isn't proof of a click.
  - **B. HMAC with `POSTING_KEY_SECRET`.** It makes the key unguessable, but:
    - it still mixes both jobs: the key is reusable forever, not single-use;
    - it adds a secret to manage and rotate (approval-only: secrets);
    - rotating or losing the secret changes the Xero key for a plan mid-retry, which is exactly the duplicate-record case we must prevent;
    - a missing env var on a fresh checkout would break Day 14 reproducibility or tempt a default.
  - **C. Random UUID stored with the plan, echoed by approval and used as the Xero key.** Unguessable and stable on retry, but one value still does both jobs. The approval value must be consumed after one use, while the Xero key must live on across retries. Every plan recompute (each new transfer) also mints a new value, so its lifecycle is unclear.
  - **D. Separate the jobs.** Chosen.

## Decision
We will separate the approval proof from the books idempotency key.

1. **Approval token (authorises the click)**
   - When the request page loads a `ready` plan, `GET /api/accounting/<id>` returns `approvalToken`: 32 random bytes from `crypto.randomBytes`, base64url.
   - The server stores only `sha256(token)` in `AccountingData.approvalTokens?: Array<{ requestId, tokenHash, planHash, issuedAt, expiresAt, usedAt? }>`. Expiry is 15 minutes [GUESS: long enough for one review; to be tuned].
   - `POST /api/accounting/<id>` requires `{ actor, approvalToken }`. The service refuses (403, nothing posted, `failed` audit row "approval not accepted") when the token:
     - is unknown, expired or used; or
     - has a `planHash` that is not the current plan's.
   - Otherwise it marks the token `usedAt` before calling the adapter. The token is single-use.
   - When real login lands, the token also binds to the session (a new ADR).
2. **Plan fingerprint.** Today's `idempotencyKeyFor` is renamed `planHash()` and is used only to detect "what you approved isn't what would post now". It is no longer accepted as authorisation and is no longer sent to Xero.
3. **Books idempotency key (makes retries land once)**
   - At approval, the service mints `postingId` (UUID v4) and stores it on the `approved` audit row (new optional field `postingId?: string`).
   - Every write for that approval uses `Idempotency-Key: clearline-<postingId>`, with the existing `-<i>` / `-alloc` suffixes.
   - Retrying the same approval (partial or timed-out post) reuses the stored `postingId`, so the keys are identical. A new approval of a changed plan gets a new `postingId`. That is correct: it is a different posting.
4. **Legacy rows.** An `approved` audit row with no `postingId` keeps using its recorded `idempotencyKey` for any retry. Old files load unchanged. The 31 demo rows need no rewrite. No stored field is renamed or retyped.
5. **CSRF** (SECURITY_GAPS #2 fix): in `src/middleware.ts`, refuse any non-GET to `/api/*` unless `Sec-Fetch-Site` is `same-origin` or `Origin` matches the host, and require `Content-Type: application/json`.
6. **Unknown Xero key window fails closed.** Before re-sending a write for an approval older than the confirmed Xero idempotency window, the adapter does a read-only `GET` for an existing Payment/CreditNote with our `Reference`. If found, it records `posted`. If it can't tell, it records `failed` with "Check Xero before retrying" and does not resend. Until someone opens Xero's docs, the window is treated as 0: every retry checks first.
7. **No new secret or env var.** The tokens and ids are random and stored.
8. **PRs, each under 300 changed lines, each approval-only, in this order:**
   - (a) crypto-protocol-engineer: CSRF origin check in middleware. Flip `tests/security-csrf.test.ts` `it.fails` → `it` (~120 lines).
   - (b) accounting-integrations-engineer: `approvalTokens` store field + `issueApprovalToken` / `consumeApprovalToken` (pure + service), with tests: single-use, expired, wrong `planHash`, old-shape `accounting.json` loads (~200 lines).
   - (c) accounting-integrations-engineer + frontend-product-engineer: route takes `approvalToken`, request page sends it, `planHash` rename; the "recomputed key is refused" test passes (~200 lines).
   - (d) accounting-integrations-engineer: `postingId` on `approved`, Xero/QuickBooks headers from it, legacy fallback, check-before-retry; tests for timeout-retry same key, legacy row same key, new approval new key (~250 lines).

## Consequences
- **Easier**
  - A forged POST can't approve: it can neither read a token cross-origin nor guess one.
  - The audit trail's "approved by" is backed by a token a page actually received.
  - Retries keep one key for the life of an approval, and rotating nothing can change it.
- **Harder**
  - One more store field and token housekeeping (expired tokens pruned on write).
  - API callers must GET before POST.
  - The demo operator flow must fetch a token (the demo seeding in `engine.ts` writes audit rows directly and is unaffected).
- **Who must do what**
  - Aashmiin approves this ADR and each PR.
  - QA re-runs the SECURITY_GAPS #2 reproduction after (c).
  - No Xero reconnect is needed.
- **Risks if wrong**
  - A bug in (d) could send a different key on a retry and create a duplicate record in Xero.
  - Contained by: legacy fallback, check-before-retry, tests on all three cases, and the live Demo Company run (D11.1) before any customer use.
- **Follow-ups**
  - Open Xero's docs on idempotency key lifetime and scope, then relabel this context.
  - Bind tokens to the session when login lands (new ADR).
  - Update `docs/ARCHITECTURE.md` §1.3 step 7 and SECURITY_GAPS #2 in PR (c).
```

---

## What happens next (≤ 8 lines)
1. **ADR**: I open a docs PR with ADR 0004 as **Proposed** and add the Approval Queue row: "ADR 0004: approval token + stored posting id | What changes: a click needs a single-use token; Xero keys come from a stored id | Why now: SECURITY_GAPS #2 (High) and target 4's 'never a second record' | Risk: a wrong retry key could duplicate a Xero record; contained by legacy fallback + check-before-retry + D11.1." Only Aashmiin can accept it.
2. **Implementation**: PRs (a)-(d) go into the nightly task files, in order, each under 300 lines and each approval-only. They are never through the 06:17 gate; she merges each. (a) can start tonight because CSRF is needed under every option.
3. **The engineer's proposal**: declined, with the reason written to accounting-integrations-engineer.
   - I can't mark an approval-only, hard-to-reverse ADR "Accepted".
   - The ADR and the code go in separate PRs.
   - An HMAC env-var PR is approval-only (secrets, auth) and can never go through the gate.
   - Option B also keeps the two jobs mixed, and secret rotation risks duplicate Xero records.
4. **Log**: `RISK:`-free Log rows for "ADR 0004 proposed" and "queued for approval ADR 0004".
