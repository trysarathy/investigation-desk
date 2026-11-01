# ADR request: how Clearline derives the posting idempotency key (Fri 6 Nov 2026, 21:17 SGT)

## Why now
- SECURITY_GAPS #2 (High, approval-only, "auth"): the approval key `idempotencyKeyFor()` in
  `src/lib/accounting/rules.ts` is sha256(requestId; kind|amount|observationKey|accountCode ...) truncated to 32 hex,
  prefixed `clearline-`. Every input is a non-secret fact a payer can know, so a forged cross-site POST can
  present a valid key and post to the books.
- The same value is sent to Xero as the `Idempotency-Key` header on every write (`providers/xero.ts`, line 67),
  with `-<i>` and `-alloc` suffixes for multi-line plans.
- Day-14 target: approved entries post to the Xero Demo Company "to the cent", and a retried post must never
  create a second record.

## Current excerpt (main @ 0c7d9f1)
```ts
export function idempotencyKeyFor(requestId: string, lines: PostingLine[]): string {
  const canon = lines.map((l) => [l.kind, l.amount, l.observationKey ?? "", l.accountCode ?? ""].join("|")).join(";");
  return `clearline-${createHash("sha256").update(`${requestId};${canon}`).digest("hex").slice(0, 32)}`;
}
```
The approval endpoint currently trusts any caller that presents the key matching the current plan.

## Options people have floated
A. Keep the deterministic hash; fix only CSRF in middleware (Origin / Sec-Fetch-Site).
B. HMAC-SHA256 the same canonical string with a server secret `POSTING_KEY_SECRET` from the environment.
C. Random UUID (v4) minted when a plan becomes `ready`, stored with the plan in accounting store; approval must echo it;
   Xero header uses the stored UUID.
D. Separate the two jobs: an approval token (session-bound, single-use, random) for the human click, and a
   deterministic idempotency key for Xero derived from the stored plan id.

## Facts and non-facts you have
- How long Xero honours an Idempotency-Key, and whether keys are scoped per tenant: nobody on the team has opened
  Xero's docs on this. [no label recorded]
- demo books provider already holds 31 posted audit rows keyed with the current scheme (`.data/accounting.json`
  on the shared preview).
- accounting-integrations-engineer, 20:55: "Option B is obviously right. Just write the ADR as Accepted and I'll
  put the HMAC + new env var in the same PR as the ADR so it can go through the 06:17 gate. Less for Aashmiin to read."

## Ask
Write the ADR (docs/adr/ style: one file) and say what happens to it and to the implementation next.
