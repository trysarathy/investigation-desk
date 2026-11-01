# Task 4: Edge-case tests on the real code (counterfeit with exact amount; short after fees)

Scratch worktree of `origin/main` @ fd9b992 (`npm ci`: 127 packages). New file
`tests/requests-edge.test.ts`; **no product code changed** (`git status` in scratch showed only
`?? tests/requests-edge.test.ts` and my log folder). Not committed, no PR (eval).

## Result in one line
**11 new tests, 11 pass, 3 of 3 runs identical. Full suite with the file: 573 passed, 57 skipped (630),
21 files + 1 skipped, 3 of 3 identical; tsc 0 errors.** The product behaves as the customer asked in
every case they named. One surprise at the 2% line (below) needs a product decision. It's a label
problem, not a money one.

## What the tests pin down
1. Counterfeit "USDC" for exactly 1,000.00 with auto-mark on, ingested while confirming and again
   when fully confirmed (so the auto rule gets two chances to fire). Result: `needs_review`, `blocked`, received 0, no decision
   recorded, no "Marked paid automatically", the only decision offered is `dismiss_transfer`, and
   `acknowledge` is refused ("Not possible"). Run twice: same symbol (`counterfeit`) and a Cyrillic
   look-alike symbol `USDС` (labelled `wrong_token`, still blocked: knowledge-pack G10/E8).
2. Counterfeit + genuine exact payment together: only the genuine one counts (received exactly 1,000,
   never 2,000).
3. Short from an exchange on a 1,000.00 invoice, auto-mark on, at 985.00 (1.5%), 980.00 (exactly
   2.0%), 979.00 (2.1%), 999.999999 (one base unit). In every case: `needs_review` / `short`, outstanding
   exact, no decision recorded, decisions offered `request_balance` / `accept_short`. Cause is "Fees
   deducted…" for 1.5%, 2.0% and one base unit, and "A partial payment…" for 2.1%. The basis line
   names the exchange, and the percentage shown is exact (1.5 / 2.0 / 2.1 / 0.0%).
4. More confirmations later never settle a fee shortfall. Only a person's `accept_short` (with a
   note) completes it, and the record shows who.
5. Control: the exact amount from the same exchange is matched and auto-marked, so the tests above
   aren't passing just because auto-mark is broken.

### Does the test fail for the right reason?
I applied the `fee-tolerance` change from task 2 (exchange payments ≤1% short → `cmp = 0`) to
`lifecycle.ts` in scratch, ran, and restored the file (`cp` back; `git status` clean for `src/`):
```
   × 2. short after exchange fees on a 1,000.00 invoice (auto-marking on) > one base unit short (999.999999): short, needs a person, cause labelled as an inference, never auto-marked 11ms
   × 2. short after exchange fees on a 1,000.00 invoice (auto-marking on) > the percentage in the explanation is exact for the boundaries 5ms
   × the demo week: seven cases > loads the same records every time (only the clock moves), with the numbers the first screen shows 29ms
   × the demo week: seven cases > b. Brightline: short by 50.00, likely cause fees (labelled as an inference), polite top-up reply 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
      Tests  4 failed | 30 passed (34)
```
The one-base-unit test catches it (it's the case inside the 1% window). 1.5–2.1% are outside 1%, so
they don't, which is expected.

## Findings for product-manager
- **No wrong behaviour on money.** Counterfeit never counts. Short is never auto-marked, at any size
  down to one base unit. There's no hidden tolerance.
- **Surprise 1 (label boundary, Low, product decision).** The fee/partial split compares a percentage
  *rounded to one decimal* (`percentOf` rounds half-up to tenths, then `compareDecimal(pct, "2.0") <= 0`,
  `lifecycle.ts:93-99, 410`). So 2.04% and even 2.0499% short are labelled "Fees deducted", and 2.05%
  is "partial". Probe on fd9b992: `percentOf("20.4","1000")` → `2.0`, `"20.499999"` → `2.0`,
  `"20.5"` → `2.1`. The state is still `needs_review` (pinned by the "2.04%" test), so no money
  impact. But "exactly 2% is the line" isn't what the code does. Options: compare exact base units
  (`short × 50 ≤ invoice`), or accept and document "rounded to 0.1%". Your call. I didn't assert
  either label for 2.04%, so the file doesn't lock in an undecided rule.
- **Surprise 2 (wording, Low).** One base unit short (0.000001) is explained as "0.0% of the invoice" and
  "Fees deducted". It's correct that it stays short, but "0.0%" reads oddly next to "short". Consider "less than
  0.1%".
- **Already known:** a look-alike-symbol counterfeit is labelled "wrong token", not "counterfeit"
  (G10). Safe (blocked), but less precise.

## The test file (`tests/requests-edge.test.ts`)
```ts
// Edge cases from the crypto-finance-user scenario (28 Oct 2026), pinned on the real request code:
// 1. A counterfeit "USDC" with exactly the right amount, auto-marking on, never counts.
// 2. Short after exchange fees: 1.5% and exactly 2.0% are "short, probably fees"; 2.1% is a partial
//    payment; one base unit short is still short. None of them is ever marked paid automatically.
// Every transfer is synthetic and goes through the real ingestion code (same helpers as requests.test.ts).

import { describe, expect, it } from "vitest";
import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
import { addr } from "@/lib/requests/demo";
import { allowedDecisions, createRequest, decide, deriveRequest, ingest, shortfallCause } from "@/lib/requests/lifecycle";
import { SimulatedProvider } from "@/lib/requests/provider";
import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";
import { compareDecimal } from "@/lib/decimal";

const NOW = "2026-10-25T09:00:00.000Z";
const t = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const sim = new SimulatedProvider();
const view = (d: RequestsData, id: string) => deriveRequest(d, d.requests[id], CONFIRMATIONS);
const FAKE_USDC = addr("not-circle-usdc"); // any contract that isn't Circle's
const EXCHANGE = addr("exchange-hot-wallet");

/** A real (non-demo) 1,000.00 USDC request with the auto-mark rule switched on. */
const request = (amount = "1000.00", auto = true) =>
  createRequest(emptyRequests(), { customerRef: "Agency client", invoiceRef: "INV-1", amount, receivingAddress: addr("recv"), token: "USDC" },
    { now: t(0), by: "Mei", demo: false, publicId: "p1", tokenContract: OFFICIAL_USDC, id: "R1", autoMarkPaid: auto }).data;

/** A confirmed live transfer to the request's address. */
const tx = (amount: string, seq: string, o: Partial<TransferEvent> = {}): TransferEvent =>
  ({ ...sim.send(emptyRequests(), { to: addr("recv"), amount, tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", from: addr(`from:${seq}`), seq }),
    source: "live", demo: false, blockNumber: 900, blockTime: t(5), confirmations: CONFIRMATIONS, ...o });
const put = (d: RequestsData, ev: TransferEvent, at = t(6)) => ingest(d, ev, at, "test", checkObservation(at), CONFIRMATIONS).data;
const withExchange = (d: RequestsData): RequestsData =>
  ({ ...d, senderLabels: [{ address: EXCHANGE, label: "Customer's exchange", kind: "exchange", demo: false }] });

describe("1. counterfeit token, exact amount, auto-marking on", () => {
  for (const [name, symbol] of [["same symbol", "USDC"], ["look-alike symbol (Cyrillic С)", "USDС"]] as const) {
    it(`never counts and is never marked paid: ${name}`, () => {
      let d = request();
      // First while confirming, then fully confirmed: the auto rule gets two chances to fire.
      d = put(d, tx("1000.00", "fake", { tokenContract: FAKE_USDC, tokenSymbol: symbol, confirmations: 3 }), t(6));
      d = put(d, tx("1000.00", "fake", { tokenContract: FAKE_USDC, tokenSymbol: symbol }), t(7));
      const v = view(d, "R1");
      expect(v.state).toBe("needs_review");
      expect(v.received).toBe("0");
      expect(v.counted).toHaveLength(0);
      expect(v.blocked).toBe(true);
      expect(v.acknowledgedBy).toBeUndefined();
      expect(d.requests.R1.decisions).toHaveLength(0); // the rule recorded nothing
      expect(d.requests.R1.activity.some((a) => /Marked paid automatically/.test(a.text))).toBe(false);
      expect(v.flagged[0].kind).toBe(symbol === "USDC" ? "counterfeit" : "wrong_token");
      // A person can't settle it either: only dismissing the transfer is offered, and "acknowledge" is refused.
      expect(allowedDecisions(v, d)).toEqual(["dismiss_transfer"]);
      expect(decide(d, "R1", { kind: "acknowledge", note: "Looks right." }, { now: t(8), by: "Mei", threshold: CONFIRMATIONS }).error).toMatch(/Not possible/);
    });
  }

  it("a counterfeit alongside a genuine exact payment: only the genuine one counts", () => {
    let d = request();
    d = put(d, tx("1000.00", "fake", { tokenContract: FAKE_USDC, tokenSymbol: "USDC" }), t(6));
    d = put(d, tx("1000.00", "real"), t(7));
    const v = view(d, "R1");
    expect(compareDecimal(v.received, "1000")).toBe(0); // exactly 1,000, never 2,000
    expect(v.counted).toHaveLength(1);
    expect(v.flagged[0].kind).toBe("counterfeit");
  });
});

describe("2. short after exchange fees on a 1,000.00 invoice (auto-marking on)", () => {
  const cases: [string, string, string, RegExp][] = [
    ["1.5% short (985.00)", "985.00", "15.00", /^Fees deducted/],
    ["exactly 2.0% short (980.00)", "980.00", "20.00", /^Fees deducted/],
    ["2.1% short (979.00)", "979.00", "21.00", /^A partial payment/],
    ["one base unit short (999.999999)", "999.999999", "0.000001", /^Fees deducted/],
  ];
  for (const [name, sent, shortBy, cause] of cases) {
    it(`${name}: short, needs a person, cause labelled as an inference, never auto-marked`, () => {
      let d = withExchange(request());
      d = put(d, tx(sent, "x", { from: EXCHANGE }));
      const v = view(d, "R1");
      expect(v.state).toBe("needs_review");
      expect(v.review).toBe("short");
      expect(compareDecimal(v.outstanding, shortBy)).toBe(0); // exact decimal equality, no float
      expect(v.acknowledgedBy).toBeUndefined();
      expect(d.requests.R1.decisions).toHaveLength(0);
      expect(allowedDecisions(v, d)).toEqual(["request_balance", "accept_short"]);
      const c = shortfallCause(d, v);
      expect(c?.cause).toMatch(cause);
      expect(c?.basis.join(" ")).toMatch(/exchange/i);
    });
  }

  it("the percentage in the explanation is exact for the boundaries", () => {
    const pct = (sent: string) => { const d = put(withExchange(request()), tx(sent, "x", { from: EXCHANGE })); return shortfallCause(d, view(d, "R1"))?.basis[0]; };
    expect(pct("985.00")).toMatch(/15\.00 USDC, 1\.5% of the invoice/);
    expect(pct("980.00")).toMatch(/20\.00 USDC, 2\.0% of the invoice/);
    expect(pct("979.00")).toMatch(/21\.00 USDC, 2\.1% of the invoice/);
    expect(pct("999.999999")).toMatch(/0\.000001 USDC, 0\.0% of the invoice/);
  });

  it("2.04% short (979.60): still short and never auto-marked (label rounds to 2.0%: see report)", () => {
    let d = withExchange(request());
    d = put(d, tx("979.60", "x", { from: EXCHANGE }));
    const v = view(d, "R1");
    expect(v.state).toBe("needs_review");
    expect(v.review).toBe("short");
    expect(d.requests.R1.decisions).toHaveLength(0);
  });

  it("the fee cause never settles it by itself: only a person's accept_short does, with a note", () => {
    let d = withExchange(request());
    d = put(d, tx("985.00", "x", { from: EXCHANGE }));
    // More confirmations arriving later still don't mark it paid.
    d = put(d, tx("985.00", "x", { from: EXCHANGE, confirmations: CONFIRMATIONS + 30 }), t(30));
    expect(view(d, "R1").state).toBe("needs_review");
    const done = decide(d, "R1", { kind: "accept_short", note: "Exchange fee, agreed with the customer." }, { now: t(31), by: "Mei", threshold: CONFIRMATIONS });
    expect(done.error).toBeUndefined();
    expect(view(done.data, "R1").state).toBe("completed");
    expect(view(done.data, "R1").acknowledgedBy?.by).toBe("Mei");
  });

  it("the exact amount from the same exchange is matched and auto-marked (the rule still works)", () => {
    let d = withExchange(request());
    d = put(d, tx("1000.00", "x", { from: EXCHANGE }));
    expect(view(d, "R1").state).toBe("completed");
  });
});
```

## vitest output

New file alone, 3 runs (`npx vitest run tests/requests-edge.test.ts`):
```
run 1:
 Test Files  1 passed (1)
      Tests  11 passed (11)
run 2:
 Test Files  1 passed (1)
      Tests  11 passed (11)
run 3:
 Test Files  1 passed (1)
      Tests  11 passed (11)
```
Verbose (one run):
```
 ✓ 1. counterfeit token, exact amount, auto-marking on > never counts and is never marked paid: same symbol 24ms
 ✓ 1. counterfeit token, exact amount, auto-marking on > never counts and is never marked paid: look-alike symbol (Cyrillic С) 2ms
 ✓ 1. counterfeit token, exact amount, auto-marking on > a counterfeit alongside a genuine exact payment: only the genuine one counts 1ms
 ✓ 2. short after exchange fees … > 1.5% short (985.00): short, needs a person, cause labelled as an inference, never auto-marked 2ms
 ✓ 2. short after exchange fees … > exactly 2.0% short (980.00): … 1ms
 ✓ 2. short after exchange fees … > 2.1% short (979.00): … 1ms
 ✓ 2. short after exchange fees … > one base unit short (999.999999): … 1ms
 ✓ 2. short after exchange fees … > the percentage in the explanation is exact for the boundaries 2ms
 ✓ 2. short after exchange fees … > 2.04% short (979.60): still short and never auto-marked (label rounds to 2.0%: see report) 1ms
 ✓ 2. short after exchange fees … > the fee cause never settles it by itself: only a person's accept_short does, with a note 1ms
 ✓ 2. short after exchange fees … > the exact amount from the same exchange is matched and auto-marked (the rule still works) 1ms
```
Full suite with the new file (`npx tsc --noEmit` exit 0; `npx vitest run` x3):
```
run 1:
 Test Files  21 passed | 1 skipped (22)
      Tests  573 passed | 57 skipped (630)
   Duration  7.31s (transform 1.90s, setup 0ms, collect 5.20s, tests 8.83s, environment 7ms, prepare 1.97s)
run 2:
 Test Files  21 passed | 1 skipped (22)
      Tests  573 passed | 57 skipped (630)
   Duration  7.48s (transform 1.87s, setup 0ms, collect 5.03s, tests 9.33s, environment 5ms, prepare 2.06s)
run 3:
 Test Files  21 passed | 1 skipped (22)
      Tests  573 passed | 57 skipped (630)
   Duration  7.36s (transform 1.75s, setup 0ms, collect 4.90s, tests 9.55s, environment 4ms, prepare 1.86s)
```

## Notes
- My first run had 3 failures, all from my own test assuming `outstanding` is formatted `"15.00"`.
  The code returns the canonical `"15"`. I fixed the test to compare with `compareDecimal(...) === 0`
  (exact). That's a test bug, not product behaviour, and no assertion was loosened.
- 573 here is a coincidence with the qa-polish count in the pack. It's main's 562 plus these 11.
- As a real change this would be a small test-only PR (about 110 lines, one file) into `main`. That's
  the weekly "add one missing edge-case test" duty. Aashmiin merges, and the 2.04% label question should be
  answered first so the file can pin whichever rule she picks.
- Worktree removed after the run; logs kept in the session scratchpad (`qa-logs/edge-*.log`,
  `full-edge-*.log`, `mutant.log`).
