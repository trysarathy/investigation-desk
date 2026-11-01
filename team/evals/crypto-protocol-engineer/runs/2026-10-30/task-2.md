# Task 2: a mistyped receiving address on a payment request

Roadmap row (next, owner Product): "A finance user can create a payment request (or import invoices from Xero) with a receiving address that has a typo in it. Catch typos before the payment page and QR code go to the customer."

Restated: reject, on both entry paths, a receiving address whose EIP-55 checksum proves it was mistyped. Acceptance test: `0x…831Ec7` (bad checksum) is refused by `POST /api/requests` (via `validateRequest`) and by `POST /api/accounting/import` with a 422 and a "checksum" message; the correctly checksummed, all-lower and all-upper forms are accepted.

Pre-flight: PAUSE assumed FALSE. Worktree `/tmp/claude-0/cpe-eval-2` from `origin/main` (fd9b992), `npm ci` OK. Baseline (same tree as task 1): tsc 0 errors, vitest 562 passed | 57 skipped [VERIFIED this run].

## 1. What the code does today [VERIFIED by reading main]
| Path | Check today | File |
|---|---|---|
| Single payment request (`POST /api/requests` → `service.createPaymentRequest` → `validateRequest`) | regex `^0x[0-9a-fA-F]{40}$` only | `src/lib/requests/lifecycle.ts:43` |
| Invoice import from the books (Xero/demo) (`POST /api/accounting/import` → `importOpenInvoices` → `importInvoice` → `createRequest`) | route regex only; `importInvoice`/`createRequest` do **no** validation | `src/app/api/accounting/import/route.ts:7,13`; `src/lib/accounting/engine.ts:68` |
| Files A/B CSV upload | format **and** EIP-55 (`eip55Ok`) + Tron base58check | `src/lib/csv/files.ts:64-81 checkAddress` |
This is gap G3 / attack pattern A2. Shown by the failing tests below: the typo is accepted by `validateRequest`, and the import route returned **200** (it made payment requests for every open demo invoice with the mistyped address).

## 2. The four example inputs (EIP-55, ERC-55 Final: keccak-256 of the lower-case hex; a letter is upper-case iff the matching hash nibble ≥ 8)
| Input | Result | Why |
|---|---|---|
| `0xdAC17F958D2ee523a2206206994597C13D831ec7` | accepted | mixed case, matches its checksum (computed locally with `@noble/hashes` keccak_256 = same string) |
| `0xdAC17F958D2ee523a2206206994597C13D831Ec7` | **rejected**: "Mixed-case address fails its EIP-55 checksum (likely a typo)." | the `e` before `c7` is upper-case where the checksum says lower |
| `0xdac17f958d2ee523a2206206994597c13d831ec7` | accepted | all lower: no checksum present, valid but unchecked |
| `0xDAC17F958D2EE523A2206206994597C13D831EC7` | accepted | all upper: no checksum present, valid but unchecked |
Flag: this example address is **Ethereum's USDT token contract** itself. As a receiving address it would be a disaster (tokens sent to the token contract are not the business's). The checksum can't know that; see follow-ups.

## 3. The change (smallest, reusing the existing validator)
- `lifecycle.ts`: new `receivingAddressError(address)` = format regex, then `checkAddress("ethereum", a)` from `csv/files.ts` (the existing EIP-55 implementation; no duplicate keccak code). `validateRequest` uses it.
- `api/accounting/import/route.ts`: replaces its private regex with the same function, so both paths share one rule and one message, and the check runs **before** `importOpenInvoices` creates any request, public page or EIP-681 QR.
- Import safety: `lifecycle.ts` already imports `address.ts` (node:crypto) and no client component imports `lifecycle.ts`, so pulling in `csv/files.ts` adds nothing to client bundles (`next build` green).

## 4. What it protects against and what it does not
Protects:
- Typos in a **mixed-case** (checksummed) address: a changed, missing-then-retyped or case-slipped character. EIP-55: "the net probability that a randomly generated address if mistyped will accidentally pass a check is 0.0247%". Tests show one-letter-case, one-digit and last-digit changes all rejected.
- Wrong length / non-hex (already caught by the regex).
Does **not** protect against:
- Typos in **all-lower or all-upper** input: there is no checksum to check (valid per EIP-55). Many explorers and some exchanges display lower case, so this is a real hole. Mitigation (follow-up): show the address back in EIP-55 form and ask the user to compare it with the wallet, or compare it against the business's known wallets.
- **Look-alike / poisoned** addresses copied from wallet history: they are real addresses with valid checksums (test pins the real POISON-1 look-alike `0xBaFF2F13…08f8b5` as accepted). Needs comparison with the business's own wallet list (`looksAlike`), not a checksum.
- A **valid but wrong** address (someone else's wallet, an exchange address, a token contract like the example above, an address the business doesn't control on Ethereum, a Safe that isn't deployed on Ethereum).
- Requests **already stored** before this change (not re-validated).
- Payment-page tampering or QR swaps after the request exists (A12; ERC-681 security considerations).
- Tron: requests are Ethereum-only (`REQUEST_CHAIN`), so not applicable; base58check already exists in `checkAddress` if Tron requests arrive.

## 5. Tests (failing first, then passing) [VERIFIED this run]
New `describe("receiving address typos (EIP-55) on both entry paths")` in `tests/requests.test.ts` (offline; route test uses a scratch `DESK_DATA_DIR`):
1. `payment request: rejects a mixed-case address that fails its checksum` (case typo, digit typo, last-digit typo)
2. `payment request: accepts a correct checksum, and all-lower / all-upper (valid, but unchecked)` (+ whitespace trimmed, too short → format error)
3. `does not catch a look-alike with a valid checksum (poisoning is not a typo)`: documents the limit
4. `invoice import route: rejects a checksum typo before any request is made, accepts a good address`

Before the change (`npx vitest run tests/requests.test.ts -t "EIP-55"`):
```
× payment request: rejects a mixed-case address that fails its checksum
  → .toMatch() expects to receive a string, but got undefined
× invoice import route: rejects a checksum typo before any request is made, accepts a good address
  → expected 200 to be 422 // Object.is equality
Tests  2 failed | 2 passed | 23 skipped (27)
```
(Tests 2 and 3 pass before and after on purpose: they pin behaviour that must not change.)
After:
```
npx vitest run tests/requests.test.ts   Tests 27 passed (27)
npx tsc --noEmit                        exit 0
npx vitest run                          Test Files 20 passed | 1 skipped (21); Tests 566 passed | 57 skipped (623)
npx next build                          exit 0, "✓ Compiled successfully"
```
566 = 562 + 4 new. Self-check: 3 files, +67/−4 (71 lines); forbidden-method grep on the diff: 0 hits; no secrets/.env/.data in diff.

## 6. Diff (`git -C /tmp/claude-0/cpe-eval-2 diff origin/main`, after `git add -A`)
```diff
diff --git a/src/app/api/accounting/import/route.ts b/src/app/api/accounting/import/route.ts
index ccb61d3..309b874 100644
--- a/src/app/api/accounting/import/route.ts
+++ b/src/app/api/accounting/import/route.ts
@@ -3,14 +3,16 @@
 
 import { NextResponse } from "next/server";
 import { importOpenInvoices } from "@/lib/accounting/service";
-
-const EVM = /^0x[0-9a-fA-F]{40}$/;
+import { receivingAddressError } from "@/lib/requests/lifecycle";
 
 export async function POST(req: Request) {
   const b = await req.json().catch(() => undefined) as { actor?: unknown; receivingAddress?: unknown; token?: unknown } | undefined;
   const actor = typeof b?.actor === "string" ? b.actor.trim().slice(0, 60) : "";
   if (!actor) return NextResponse.json({ error: "Set \"Acting as\" first." }, { status: 422 });
-  if (typeof b?.receivingAddress !== "string" || !EVM.test(b.receivingAddress.trim())) return NextResponse.json({ error: "Enter the Ethereum address customers pay to." }, { status: 422 });
+  if (typeof b?.receivingAddress !== "string" || !b.receivingAddress.trim()) return NextResponse.json({ error: "Enter the Ethereum address customers pay to." }, { status: 422 });
+  // Same check as a single request: format + EIP-55 checksum, before any request or QR exists.
+  const addressError = receivingAddressError(b.receivingAddress);
+  if (addressError) return NextResponse.json({ error: addressError }, { status: 422 });
   const token = b?.token === "USDT" ? "USDT" : "USDC";
   const res = await importOpenInvoices(actor, b.receivingAddress.trim(), token);
   if (res.error) return NextResponse.json({ error: res.error }, { status: 409 });
diff --git a/src/lib/requests/lifecycle.ts b/src/lib/requests/lifecycle.ts
index f7eac2a..5db9e38 100644
--- a/src/lib/requests/lifecycle.ts
+++ b/src/lib/requests/lifecycle.ts
@@ -3,6 +3,7 @@
 // engine check, so the same inputs always give the same records (and tests can replay them).
 
 import { sameAddress } from "../address";
+import { checkAddress } from "../csv/files";
 import { compareDecimal, isDecimal } from "../decimal";
 import { add, sub } from "../payments/money";
 import type {
@@ -26,6 +27,19 @@ export interface NewRequestInput {
 }
 
 /** Field errors, empty when the request is valid. Amounts are exact decimals with at most 6 places. */
+/**
+ * The receiving address a request (or an invoice import) will show the customer. Format first, then
+ * the EIP-55 checksum, reusing the File A validator: a mixed-case address whose case doesn't match
+ * its checksum is almost certainly mistyped (EIP-55: ~0.0247% of typos slip through). All-lower or
+ * all-upper hex carries no checksum and is accepted. A correctly checksummed look-alike (poisoning)
+ * passes: that needs a comparison with the business's own wallets, not a checksum.
+ */
+export function receivingAddressError(address: string): string | undefined {
+  const a = address.trim();
+  if (!EVM_ADDRESS.test(a)) return "An Ethereum address: 0x followed by 40 hex characters.";
+  return checkAddress("ethereum", a);
+}
+
 export function validateRequest(i: NewRequestInput): Record<string, string> {
   const e: Record<string, string> = {};
   const text = (v: string, name: string) => {
@@ -40,7 +54,8 @@ export function validateRequest(i: NewRequestInput): Record<string, string> {
   else if ((amt.split(".")[1] ?? "").length > USDC_DECIMALS) e.amount = `${i.token ?? "USDC"} has ${USDC_DECIMALS} decimal places at most.`;
   else if (compareDecimal(amt, "0") <= 0) e.amount = "Must be more than zero.";
   else if (amt.split(".")[0].replace(/^0+/, "").length > 12) e.amount = "Too large for one request.";
-  if (!EVM_ADDRESS.test((i.receivingAddress ?? "").trim())) e.receivingAddress = "An Ethereum address: 0x followed by 40 hex characters.";
+  const addressError = receivingAddressError(i.receivingAddress ?? "");
+  if (addressError) e.receivingAddress = addressError;
   if (i.token !== undefined && !REQUEST_TOKENS.includes(i.token)) e.token = "USDC or USDT.";
   return e;
 }
diff --git a/tests/requests.test.ts b/tests/requests.test.ts
index f73ad69..d995879 100644
--- a/tests/requests.test.ts
+++ b/tests/requests.test.ts
@@ -274,3 +274,49 @@ describe("input, money and links", () => {
     expect(view(d, "R1").state).toBe("matched");
   });
 });
+
+describe("receiving address typos (EIP-55) on both entry paths", () => {
+  // Ethereum USDT's contract, used only as a well-known EIP-55 vector (never as a receiving address).
+  const GOOD = "0xdAC17F958D2ee523a2206206994597C13D831ec7";      // correct mixed-case checksum
+  const TYPO = "0xdAC17F958D2ee523a2206206994597C13D831Ec7";      // one letter's case wrong
+  const LOWER = "0xdac17f958d2ee523a2206206994597c13d831ec7";     // no checksum to check
+  const UPPER = "0xDAC17F958D2EE523A2206206994597C13D831EC7";     // no checksum to check
+  const base = { customerRef: "A", invoiceRef: "I", amount: "10" };
+  const err = (receivingAddress: string) => validateRequest({ ...base, receivingAddress }).receivingAddress;
+
+  it("payment request: rejects a mixed-case address that fails its checksum", () => {
+    expect(err(TYPO)).toMatch(/checksum/i);
+    expect(err("0xdAC17F959D2ee523a2206206994597C13D831ec7")).toMatch(/checksum/i);  // one digit changed
+    expect(err("0xdAC17F958D2ee523a2206206994597C13D831ec8")).toMatch(/checksum/i);  // last digit changed
+  });
+
+  it("payment request: accepts a correct checksum, and all-lower / all-upper (valid, but unchecked)", () => {
+    expect(err(GOOD)).toBeUndefined();
+    expect(err(` ${GOOD} `)).toBeUndefined();
+    expect(err(LOWER)).toBeUndefined();
+    expect(err(UPPER)).toBeUndefined();
+    expect(err("0xdAC17F958D2ee523a2206206994597C13D831ec")).toMatch(/40 hex/);    // too short: still a format error
+  });
+
+  it("does not catch a look-alike with a valid checksum (poisoning is not a typo)", () => {
+    // Real Dec 2025 poisoning look-alike of 0xbaf4…f8b5, written with its correct EIP-55 checksum.
+    expect(err("0xBaFF2F13638C04B10F8119760B2D2aE86b08f8b5")).toBeUndefined();
+  });
+
+  it("invoice import route: rejects a checksum typo before any request is made, accepts a good address", async () => {
+    const saved = process.env.DESK_DATA_DIR;
+    process.env.DESK_DATA_DIR = mkdtempSync(path.join(tmpdir(), "import-"));
+    try {
+      const { POST } = await import("@/app/api/accounting/import/route");
+      const call = (receivingAddress: string) => POST(new Request("http://desk.test/api/accounting/import", {
+        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: "Mei", receivingAddress, token: "USDT" }) }));
+      const bad = await call(TYPO);
+      expect(bad.status).toBe(422);
+      expect((await bad.json()).error).toMatch(/checksum/i);
+      const good = await call(GOOD);
+      expect(good.status).not.toBe(422);
+    } finally {
+      if (saved === undefined) delete process.env.DESK_DATA_DIR; else process.env.DESK_DATA_DIR = saved;
+    }
+  });
+});
```

## 7. WOULD OPEN PR:
```
Title: fix(requests): reject mistyped receiving addresses (EIP-55) on request creation and invoice import (G3)

## What and why
A payment request or a books import accepted any 0x + 40 hex, so a mistyped address went straight onto the
payment page and the EIP-681 QR. Both paths now run the File A validator's EIP-55 check (ERC-55, Final):
a mixed-case address whose case doesn't match its keccak-256 checksum is refused with "Mixed-case address
fails its EIP-55 checksum (likely a typo)". All-lower/all-upper addresses carry no checksum and are still
accepted.
Closes roadmap row: "A finance user can create a payment request (or import invoices from Xero) with a
receiving address that has a typo in it…"

## How it was tested
- Failing test first: `tests/requests.test.ts › receiving address typos (EIP-55) on both entry paths ›
  payment request: rejects a mixed-case address that fails its checksum` failed with
  `.toMatch() expects to receive a string, but got undefined`; `… › invoice import route: rejects a checksum
  typo before any request is made` failed with `expected 200 to be 422`.
- Added: 4 tests (case/digit typos rejected; good/lower/upper accepted; valid-checksum look-alike accepted
  (documents the limit); import route 422 on a typo).
- `npx tsc --noEmit` ✔  `npx vitest run` ✔ (566 passed, 57 skipped)  `npx next build` ✔   (all seen this run)

## Protocol and security notes
- Read-only: no chain calls added; pure validation; grep clean.
- Unknown facts: n/a (input validation only).
- Chains/tokens affected: Ethereum payment requests (USDC/USDT). Tron not applicable (requests are Ethereum-only).
- Limits: does not catch typos in all-lower/all-upper input, poisoned look-alikes with valid checksums,
  or a valid-but-wrong address (incl. a token contract). Already-stored requests are not re-validated.

## What Aashmiin should check
- /requests → New request with 0xdAC17F958D2ee523a2206206994597C13D831Ec7: refused with the checksum message.
- /books → Import invoices with the same address: refused, no requests created.

## Not done / follow-ups
- Refuse a receiving address equal to an official token contract (USDT/USDC) or any known contract (needs
  `eth_getCode`, a chain read; separate PR).
- For all-lower/upper input: echo the EIP-55 form back and ask for a confirm; compare against the business's
  known wallets with `looksAlike` and warn on a near miss.
- Defence in depth: `importInvoice`/`createRequest` still trust their caller; consider validating inside.
- One-off scan of stored open requests for checksum-invalid addresses (report only, no edits).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j
```
Branch would be `fix/request-address-eip55`; commit as `Aashmiin Kaur <aashmiin@gmail.com>` with the Co-Authored-By and Claude-Session lines; push the branch only.

WOULD WRITE (Company HQ): roadmap row → `in review` + PR link; Log row `opened PR #<n> | receiving-address typo check (G3) | <link>`.

## Notes
- All results above were run and seen by me this session; worktree removed and `eval/cpe-task-2` deleted afterwards.
- [ASSUMPTION] The UI forms show the API's `receivingAddress`/`error` text as they do today for the regex message (`ImportInvoices.tsx` shows `j.error`); not clicked through in a browser.
- The knowledge pack's G3/A2 lines (on the `ai-team` branch) should be flipped to "fixed on main via PR #<n>" after merge.
