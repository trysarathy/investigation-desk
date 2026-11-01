# T2: the transfer moved blocks (R1, Kestrel Freight, INV-2207, 4,200 USDC, Ethereum)

Run: 2026-10-31 (SGT), crypto-protocol-engineer, holdout H1. Test run: nothing pushed, no PR opened.
Pre-flight: PAUSE not readable (live tools off in this holdout). WOULD WRITE that Log row and check
PAUSE before building. Baseline on a fresh worktree of `origin/main` (8decb27): 562 passed / 57 skipped
[VERIFIED this run].

## 1. What most likely happened, and how it differs from a lagging provider

**Reorg (what the ops note describes).** The same transaction is reported in a **different block
number** (23,041,870, then 23,041,872). A transaction that is already mined can only change blocks if the
canonical chain switched branches. The block that held it (or an ancestor) was orphaned, and the
transaction went back to the mempool and was included again in a later block on the new branch. After that,
the old block's confirmations count blocks on a branch that no longer exists. They mean nothing, and the count restarts
from the new block. Re-inclusion also changes the block hash and usually the `logIndex`, because `logIndex` is a
position in the **block**, not the transaction (`erc20-trc20.md` §2,
execution-apis `receipt.yaml`). [VERIFIED: pack, sources cited there]

**Lagging provider.** Same block number (and block hash), lower confirmation count. The provider's
head is behind, so `head − block` is smaller. The inclusion fact is the same. Only the provider's view of the tip
is older. So you keep the higher count from the provider that is further ahead, and never let a
stale head take confirmations backwards. Today's code does exactly this, and it is the only case it handles.

**Which number to trust:** for state, the newer block (23,041,872, 1 confirmation). For anything
irreversible, neither yet. Mark paid or post only once block 23,041,872 is at or below the
`finalized` tag (`eth_getBlockByNumber("finalized")`, ~2 epochs ≈ 12.8 min), and its block hash matches
the receipt's `blockHash` at two providers (`finality-reorgs.md`, `providers.md` policy 2).

**Something in the numbers doesn't add up, and I could not check it** (synthetic case: no real hash).
8 confirmations on block 23,041,870 means a head of 23,041,878. Two minutes later (~10 slots of 12 s),
1 confirmation on block 23,041,872 means a head of 23,041,873. The head went **backwards by 5 blocks**
while time moved forward. A genuine reorg that moves a transaction from 870 to 872 would have to replace
block 870 and every block after it: at least 9 blocks deep. On post-merge Ethereum, reorgs are
almost always 1 block deep. Proposer boost and attestation deadlines limit them (ethereum.org PoS page, quoted in
`finality-reorgs.md`), so a 9-deep reorg would be a notable network event [ASSUMPTION: I didn't look up the
historical reorg depth this run]. An equally likely explanation [GUESS] is that the two lookups were
answered by **different nodes with different views**: a node on a short-lived fork, or a
misbehaving/stale provider. The code can't tell, because it stores neither the block hash nor which provider
answered each report. What I would run on the real hash: `eth_getTransactionReceipt` at both providers
(compare `blockNumber`, `blockHash`, `logIndex`), `eth_getBlockByNumber` for heights 23,041,870 and
23,041,872 at both (does 870's hash match the first receipt's `blockHash`?), and both providers'
`latest`/`finalized` heads. The safe behaviour is the same either way: the newer, lower count stands
until finality, and nothing is marked paid on the old block.

## 2. Change (scratch worktree `/tmp/claude-0/ho-cpe-run-2`, branch `eval/ho-cpe-2` from `origin/main`)

`src/lib/requests/lifecycle.ts` `ingest` (signature unchanged). For an existing observation:
- `moved` = both the old and the new report have a block number and they differ → take the new
  `blockNumber` and `blockTime`, and confirmations = the new report's count (may go down).
- Same block → `max(prev, new)` as before (a lagging provider never takes confirmations backwards).
- No block in the new report (provider says pending/unknown) → keep the old block and count. Unknown is not
  negative.
- Still one observation (same key). Activity gets a `confirmations` line: "Chain reorganisation: the
  same transfer moved from block 23,041,870 to block 23,041,872. Confirmations restart from the new
  block (1 of 12 confirmations)." If the request was already marked paid, the line adds "This request
  was already marked paid on the old block: check it before relying on that."
- `deriveRequest` is unchanged: a `matched` request becomes `confirming` on its own, because the confirmed
  count drops below the threshold. Decisions are never touched. Engine snapshots stay append-only (`withCheck`
  appends a new snapshot for the new block and keeps the old ones).

**Failing test first** (`tests/requests-reorg.test.ts`, before the change) [VERIFIED this run]:
```
× takes the new block and block time, restarts confirmations from it, and stays one observation
    AssertionError: expected 'duplicate' to be 'updated'
× logs a reorganisation line naming the old and the new block
    AssertionError: expected 'The same transfer (0x77777777…7777a1)…' to match /reorganisation/i
× a lagging provider reporting the same block with a lower count never takes confirmations backwards
    AssertionError: expected 8 to be 4          (the post-reorg half of the test)
× a matched request goes back to confirming when its transfer is re-mined below the threshold
    AssertionError: expected 'matched' to be 'confirming'
× never erases decisions or engine snapshots; a request the auto rule already marked paid is flagged in its log
    AssertionError: expected 'The same transfer (0x77777777…7777a1)…' to match /reorganisation/i
✓ a report with no block (provider says pending) is unknown: block and confirmations are kept
✓ a person's decision recorded before the reorg is kept
Tests  5 failed | 2 passed (7)
```
After the change, two tests failed on my own wrong expectation: `money.add` returns "4200", not
"4200.000000". I corrected the test, not the code.

**Checks after the change** [VERIFIED this run]:
- `npx vitest run tests/requests-reorg.test.ts`: **7 passed (7)**
- `npx tsc --noEmit`: exit 0
- `npx vitest run`: **569 passed | 57 skipped (626)** (562 + 7 new). The existing test "an older event never
  takes confirmations backwards" still passes.
- `npx next build`: exit 0, `✓ Compiled successfully in 11.9s`, `✓ Generating static pages (19/19)`
- §6 greps: clean. Diff: 2 files, +132 / −7 (code 25 lines).

## 3. WOULD OPEN PR (not opened)

**Title:** `fix(requests): a transfer re-mined in another block takes the new block and restarts confirmations (reorg, R1)`

**Body:**
```
## What and why
`ingest` kept the first block number forever and never let confirmations go down. So after a chain
reorganisation the request page showed the orphaned block (23,041,870) with 8 confirmations, while
the chain said block 23,041,872 with 1. A mined transaction that moves to a different block number was
re-included on a new canonical branch, so the old count is void (finality-reorgs.md; JSON-RPC
`latest` "may be re-orged out of the canonical chain", execution-apis block.yaml). Now: a different
block replaces the old one and restarts the count. The same block with a lower count (a lagging provider)
still never goes backwards. A report with no block changes nothing. Activity names both blocks and
says "Chain reorganisation". Still one observation. No decision is erased.
Closes: ops note on R1 / INV-2207 (WOULD ADD roadmap `bug` row; gap G2 in codebase-map.md, first half).

## How it was tested
- Failing test first: `tests/requests-reorg.test.ts › takes the new block and block time, restarts
  confirmations from it, and stays one observation` failed with `expected 'duplicate' to be 'updated'`
  (5 of 7 failed before the change).
- Added: same-block lower count (before and after a reorg), no-block report = unknown, matched →
  confirming → matched counted once, auto-rule-paid request keeps its decision and gets a log
  warning without a second acknowledgement, a person's request_balance decision is kept.
- `npx tsc --noEmit` ✔  `npx vitest run` ✔ (569 passed, 57 skipped)  `npx next build` ✔   (all seen this run)

## Protocol and security notes
- Read-only: no chain method added. Pure function change. Grep clean.
- Unknown facts: a report without a block keeps the last known block (never "unmined").
- Ethereum (and the Tron observations requests already record). Decimals untouched.
  Finality: still counted from `latest` (G1). This PR does not add a finality gate.

## What Aashmiin should check
1. Demo or test: a request at 8 of 12, then re-report the same transfer in block +2 with 1 confirmation.
   The page shows 1 of 12, "confirming", and a "Chain reorganisation" line naming both blocks.
2. A request already marked paid keeps "completed". Its log carries the warning (see follow-ups).

## Not done / follow-ups (honest list)
1. **Auto-rule already marked it paid.** The acknowledgement stays on record (by design: history is
   append-only), so the state stays `completed`. All this PR does is warn in the log. The proper fix
   is two parts. (a) Gate `autoMark` on finality: a request can only be auto-marked paid once its
   block is ≤ `finalized` (Ethereum) or solidified (Tron), read from the node, and unknown pauses. Then
   the auto rule can't act on a block that later reorgs. (b) If a reorg still hits a settled
   request, add a new derived state, `needs_review` "paid on a block that was reorganised", and stop
   any accounting plan for it. Never reverse a posting automatically: a person decides, and the
   accounting entry is changed by a new record, never by editing the old one. (b) needs a product
   decision, so it becomes a `needs decision` row.
2. **A changed logIndex is a second observation.** The key is `chain:hash:logIndex`, and real
   re-inclusion usually changes `logIndex`. The same money then shows as two transfers → "Paid twice"
   + refund suggestion (G2). Fix: key by `chain + txHash + position of the transfer within the tx`,
   with logIndex/blockHash as attributes, plus a migration for stored keys and the decisions that
   reference `observationKey`. Separate PR.
3. **Which report is canonical.** The latest report wins, so a lagging provider that is still on the old branch
   could move the block back. Needs the block hash on `TransferEvent`/`Observation`, provider
   provenance per report, and a head/`finalized` comparison before a block change is accepted.
4. **Caches.** `chain/evm.ts` caches mined txs/receipts/blocks forever (`ttlSec: Infinity`), so a
   re-lookup can't see a reorg within the cache lifetime. Cache only at or below `finalized`.
5. `payments/refresh.ts` never re-reads a found hash (same G2 class). Out of scope here.
6. Knowledge pack: update codebase-map G2 and finality-reorgs "what the code does today" in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015s4Kk7vKgcSQ7csnYmEH5j
```
WOULD commit as `Aashmiin Kaur <aashmiin@gmail.com>` with the Co-Authored-By and Claude-Session lines,
push `fix/requests-reorg-block-move` (never `main`) and open it via `gh api …/pulls -X POST`.

## Reply to ops (on R1)
> Trust the new block: 23,041,872, at 1 confirmation, and count up from there. A transaction that shows up in a
> different block was re-mined after a chain reorganisation, so the 8 confirmations on block 23,041,870
> no longer count. The "lagging provider" case is different: same block, lower count, and there we
> keep the higher count. R1 is not paid yet. Don't mark it paid by hand until it is confirmed again. Once the fix
> ships the page will show this by itself. One more thing: the two answers imply the chain tip went backwards by 5 blocks.
> That is unusual on Ethereum, so I'll compare both providers' block hashes on the real transaction
> before we decide which provider to trust.

## Log rows (WOULD WRITE)
- `2026-10-31 SGT | crypto-protocol-engineer | WOULD open PR fix/requests-reorg-block-move | R1 / INV-2207 | (holdout: not opened)`
- `2026-10-31 SGT | crypto-protocol-engineer | needs decision | reorg after auto-mark-paid: reopen state + accounting hold | see PR follow-up 1`

## Full diff (`git add -A` in the worktree, `git diff --cached origin/main`)
```diff
diff --git a/src/lib/requests/lifecycle.ts b/src/lib/requests/lifecycle.ts
index f7eac2a..3ced84f 100644
--- a/src/lib/requests/lifecycle.ts
+++ b/src/lib/requests/lifecycle.ts
@@ -157,7 +157,10 @@ export const AUTO_RULE = "Auto-match rule";
 /**
  * The single entry point for transfer events, simulated or live. A repeat delivery of the same
  * transfer (chain + hash + log index) never creates a second payment: identical → "duplicate";
- * newer block data → "updated". Confirmations never go backwards.
+ * newer block data → "updated". In the same block, confirmations never go backwards (a lagging
+ * provider reports a lower count for the same block). In a different block, the transaction was
+ * re-mined after a chain reorganisation: the new block and block time are taken and confirmations
+ * restart from it, so they may go down. A report with no block is unknown and changes nothing.
  *
  * `claimedFor`: the transfer was looked up from a hash given for that request (a customer emailed
  * it). It is recorded against the request even when it went somewhere else, so the request shows
@@ -173,23 +176,31 @@ export function ingest(data: RequestsData, ev: TransferEvent, now: string, actor
   };
 
   if (prev) {
-    const block = prev.blockNumber ?? ev.blockNumber;
-    const confirmations = Math.max(prev.confirmations, ev.confirmations);
+    // Re-mined in another block (reorg): the chain's latest answer replaces the old block.
+    const moved = prev.blockNumber !== undefined && ev.blockNumber !== undefined && ev.blockNumber !== prev.blockNumber;
+    const block = moved ? ev.blockNumber : prev.blockNumber ?? ev.blockNumber;
+    const confirmations = moved ? ev.confirmations : Math.max(prev.confirmations, ev.confirmations);
+    const blockTime = moved ? ev.blockTime ?? prev.blockTime : prev.blockTime ?? ev.blockTime;
     const changed = block !== prev.blockNumber || confirmations !== prev.confirmations || (prev.status !== ev.status && ev.blockNumber !== undefined);
     const owners = ownersOf(prev);
     if (!changed) {
       for (const id of owners) note(id, { at: now, actor, kind: "duplicate", observationKey: key, text: `The same transfer (${short(ev.hash)}) was reported again. Ignored: it counts once.` });
       return { data: { ...data, requests }, outcome: "duplicate", key };
     }
-    let next: Observation = { ...prev, blockNumber: block, blockTime: prev.blockTime ?? ev.blockTime, confirmations,
+    let next: Observation = { ...prev, blockNumber: block, blockTime, confirmations,
       status: ev.blockNumber !== undefined ? ev.status : prev.status, lastUpdatedAt: now };
     const need = prev.chain === "tron" ? 20 : threshold; // Tron needs 20 (the business's setting), Ethereum 12
     const crossed = prev.confirmations < need && confirmations >= need;
+    const count = `${Math.min(confirmations, need)} of ${need} confirmations`;
     for (const id of owners) {
+      // A decision already made on the old block stays on record; the log says it rested on that block.
+      const paid = moved && acknowledgement(requests[id]) ? ` This request was already marked paid on the old block: check it before relying on that.` : "";
       note(id, { at: now, actor, kind: "confirmations", observationKey: key,
-        text: prev.blockNumber === undefined && block !== undefined
-          ? `Included in block ${block.toLocaleString("en-US")} (${Math.min(confirmations, need)} of ${need} confirmations).`
-          : crossed ? `Confirmed: ${need} of ${need} confirmations.` : `${Math.min(confirmations, need)} of ${need} confirmations.` });
+        text: moved
+          ? `Chain reorganisation: the same transfer moved from block ${prev.blockNumber!.toLocaleString("en-US")} to block ${block!.toLocaleString("en-US")}. Confirmations restart from the new block (${count}).${paid}`
+          : prev.blockNumber === undefined && block !== undefined
+          ? `Included in block ${block.toLocaleString("en-US")} (${count}).`
+          : crossed ? `Confirmed: ${need} of ${need} confirmations.` : `${count}.` });
     }
     next = withCheck(next, { ...data, requests }, check);
     const out = { ...data, requests, observations: { ...data.observations, [key]: next } };
diff --git a/tests/requests-reorg.test.ts b/tests/requests-reorg.test.ts
new file mode 100644
index 0000000..10c911b
--- /dev/null
+++ b/tests/requests-reorg.test.ts
@@ -0,0 +1,114 @@
+// A transfer re-reported in a different block is a chain reorganisation: the same transaction was
+// re-mined. It takes the new block and its confirmations restart (they may go down); a lagging
+// provider reporting the same block with a lower count never takes confirmations backwards.
+// Every transfer here is synthetic (fictional addresses and hashes) and goes through real ingestion.
+import { describe, expect, it } from "vitest";
+import { checkObservation, CONFIRMATIONS, OFFICIAL_USDC } from "@/lib/requests/check";
+import { addr } from "@/lib/requests/demo";
+import { AUTO_RULE, createRequest, decide, deriveRequest, ingest } from "@/lib/requests/lifecycle";
+import { emptyRequests, type RequestsData, type TransferEvent } from "@/lib/requests/types";
+
+const NOW = "2026-10-31T01:00:00.000Z";
+const t = (m: number) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
+const view = (d: RequestsData, id = "R1") => deriveRequest(d, d.requests[id], CONFIRMATIONS);
+const OLD = 23_041_870;
+const NEW = 23_041_872;
+
+const request = (o: { auto?: boolean } = {}) =>
+  createRequest(emptyRequests(), { customerRef: "Kestrel Freight", invoiceRef: "INV-2207", amount: "4200", receivingAddress: addr("kestrel"), token: "USDC" },
+    { now: t(0), by: "Mei", demo: false, publicId: "R1", tokenContract: OFFICIAL_USDC, id: "R1", autoMarkPaid: o.auto }).data;
+
+const ev = (o: Partial<TransferEvent> = {}): TransferEvent => ({
+  source: "live", demo: false, chain: "ethereum", hash: `0x${"7".repeat(62)}a1`, logIndex: 41,
+  from: addr("kestrel-payer"), to: addr("kestrel"), tokenContract: OFFICIAL_USDC, tokenSymbol: "USDC", amount: "4200.000000",
+  status: "success", blockNumber: OLD, blockTime: "2026-10-31T01:01:11.000Z", confirmations: 8, ...o,
+});
+const put = (d: RequestsData, e: TransferEvent, at: string) => ingest(d, e, at, "Live chain lookup", checkObservation(at), CONFIRMATIONS);
+const only = (d: RequestsData) => {
+  const all = Object.values(d.observations);
+  expect(all).toHaveLength(1);
+  return all[0];
+};
+
+describe("reorg: the same transfer re-mined in a different block (R1, INV-2207)", () => {
+  it("takes the new block and block time, restarts confirmations from it, and stays one observation", () => {
+    let d = put(request(), ev(), t(2)).data;
+    const r = put(d, ev({ blockNumber: NEW, blockTime: "2026-10-31T01:01:35.000Z", confirmations: 1 }), t(4));
+    expect(r.outcome).toBe("updated");
+    d = r.data;
+    const o = only(d);
+    expect(o.blockNumber).toBe(NEW);
+    expect(o.blockTime).toBe("2026-10-31T01:01:35.000Z");
+    expect(o.confirmations).toBe(1);
+    expect(view(d).state).toBe("confirming");
+    expect(view(d).received).toBe("0");
+    expect(view(d).pending).toBe("4200");
+  });
+
+  it("logs a reorganisation line naming the old and the new block", () => {
+    let d = put(request(), ev(), t(2)).data;
+    d = put(d, ev({ blockNumber: NEW, confirmations: 1 }), t(4)).data;
+    const line = d.requests.R1.activity.at(-1)!;
+    expect(line.text).toMatch(/reorganisation/i);
+    expect(line.text).toContain("23,041,870");
+    expect(line.text).toContain("23,041,872");
+    expect(line.observationKey).toBe(only(d).key);
+  });
+
+  it("a lagging provider reporting the same block with a lower count never takes confirmations backwards", () => {
+    let d = put(request(), ev({ confirmations: 8 }), t(2)).data;
+    const r = put(d, ev({ confirmations: 5 }), t(3));
+    expect(r.outcome).toBe("duplicate");
+    expect(only(r.data).confirmations).toBe(8);
+    expect(only(r.data).blockNumber).toBe(OLD);
+    // After a reorg the same rule holds on the new block.
+    d = put(r.data, ev({ blockNumber: NEW, confirmations: 4 }), t(4)).data;
+    d = put(d, ev({ blockNumber: NEW, confirmations: 2 }), t(5)).data;
+    expect(only(d).confirmations).toBe(4);
+    expect(only(d).blockNumber).toBe(NEW);
+  });
+
+  it("a report with no block (provider says pending) is unknown: block and confirmations are kept", () => {
+    let d = put(request(), ev(), t(2)).data;
+    d = put(d, ev({ blockNumber: undefined, blockTime: undefined, confirmations: 0 }), t(3)).data;
+    expect(only(d).blockNumber).toBe(OLD);
+    expect(only(d).confirmations).toBe(8);
+  });
+
+  it("a matched request goes back to confirming when its transfer is re-mined below the threshold", () => {
+    let d = put(request(), ev({ confirmations: CONFIRMATIONS }), t(2)).data;
+    expect(view(d).state).toBe("matched");
+    d = put(d, ev({ blockNumber: NEW, confirmations: 1 }), t(4)).data;
+    expect(view(d).state).toBe("confirming");
+    expect(view(d).maxConfirmations).toBe(1);
+    d = put(d, ev({ blockNumber: NEW, confirmations: CONFIRMATIONS }), t(7)).data;
+    expect(view(d).state).toBe("matched");
+    expect(view(d).received).toBe("4200"); // counted once, not twice
+  });
+
+  it("never erases decisions or engine snapshots; a request the auto rule already marked paid is flagged in its log", () => {
+    let d = put(request({ auto: true }), ev({ confirmations: CONFIRMATIONS }), t(2)).data;
+    expect(view(d).state).toBe("completed");
+    const decisions = d.requests.R1.decisions;
+    expect(decisions.map((x) => x.by)).toEqual([AUTO_RULE]);
+    const snapshots = only(d).checks.length;
+    d = put(d, ev({ blockNumber: NEW, confirmations: 1 }), t(4)).data;
+    expect(d.requests.R1.decisions).toEqual(decisions);
+    expect(only(d).checks.length).toBeGreaterThanOrEqual(snapshots);
+    expect(only(d).checks.slice(0, snapshots)).toEqual(only(put(request({ auto: true }), ev({ confirmations: CONFIRMATIONS }), t(2)).data).checks);
+    const line = d.requests.R1.activity.at(-1)!.text;
+    expect(line).toMatch(/reorganisation/i);
+    expect(line).toMatch(/already marked paid/i);
+    // The auto rule does not mark it paid a second time once the new block confirms.
+    d = put(d, ev({ blockNumber: NEW, confirmations: CONFIRMATIONS }), t(7)).data;
+    expect(d.requests.R1.decisions.filter((x) => x.kind === "acknowledge")).toHaveLength(1);
+  });
+
+  it("a person's decision recorded before the reorg is kept", () => {
+    let d = put(request(), ev({ amount: "4000.000000", confirmations: CONFIRMATIONS }), t(2)).data;
+    d = decide(d, "R1", { kind: "request_balance", note: "asked for 200" }, { now: t(3), by: "Mei", threshold: CONFIRMATIONS }).data;
+    const before = d.requests.R1.decisions;
+    d = put(d, ev({ amount: "4000.000000", blockNumber: NEW, confirmations: 1 }), t(4)).data;
+    expect(d.requests.R1.decisions).toEqual(before);
+  });
+});
```
