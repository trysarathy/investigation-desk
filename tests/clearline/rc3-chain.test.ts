/**
 * rc3 Priority A — stablecoin evidence (invariant 5). Each test here failed before its fix in
 * src/lib/clearline/chain.ts / derive.ts / investigation.ts (C-1, C-2, C-3).
 */
import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, getAdapter, investigate, listExceptions, sampleWorkspace, scenarioIntentId, type Workspace } from "@/lib/clearline";
import { intent, run, sim, submitted } from "./helpers";

const usdc = () => submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater");
const obsFor = (ws: Workspace, id: string, o: Record<string, unknown> = {}) => ({
  intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC",
  txHash: "0x" + "cd".repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(intent(ws, id)),
  amountMinor: ws.quotes.find((q) => q.id === intent(ws, id).selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 100, confirmations: 3, ...o,
});
const ingest = (ws: Workspace, observation: ReturnType<typeof obsFor>) => run(ws, "usr_maya", { type: "ingest_chain_observation", observation });

describe("rc3 C-1: a rejected observation is never revived, and a tx hash belongs to one chain", () => {
  it("wrong-chain observation, then the same hash on Base Sepolia: not counted, contradiction raised, rejected record unchanged", () => {
    let { ws, id } = usdc();
    ws = sim(ws, id).workspace; // in_transit
    ws = ingest(ws, obsFor(ws, id, { chainId: 1, network: "ethereum", confirmations: 20 })).workspace;
    const rejected = structuredClone(ws.chainObservations.find((o) => o.intentId === id)!);
    expect(rejected.status).toBe("rejected_unsupported");
    const r = ingest(ws, obsFor(ws, id, { confirmations: 20 }));
    expect(r.outcome).toBe("contradictory_exception_raised");
    // Before the fix: the rejected record was updated in place (chainId 1, status "final") and settlement became "verified".
    expect(intent(r.workspace, id).status.settlement).toBe("none");
    expect(r.workspace.chainObservations.filter((o) => o.intentId === id)).toEqual([rejected]);
    expect(listExceptions(r.workspace, { intentId: id, category: "contradictory_evidence" }).map((e) => e.explanationCode)).toContain("CH_TX_HASH_ON_OTHER_CHAIN");
  });

  it("the same hash already counted on Base Sepolia for one payout cannot evidence another payout, even reported on another chain", () => {
    const a = usdc();
    a.ws = sim(a.ws, a.id).workspace;
    a.ws = ingest(a.ws, obsFor(a.ws, a.id)).workspace;
    // second payout in the SAME workspace
    const b = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay", internalReference: "INV-RC3-CH-B" }, "prv_tidewater", a.ws);
    let w = sim(b.ws, b.id).workspace;
    const same = ingest(w, obsFor(w, b.id));
    expect(same.outcome).toBe("contradictory_exception_raised");
    expect(intent(same.workspace, b.id).status.settlement).toBe("none");
    w = ingest(w, obsFor(w, b.id, { chainId: 1, network: "ethereum" })).workspace;
    expect(intent(w, b.id).status.settlement).toBe("none");
    expect(intent(w, a.id).status.settlement).toBe("pending_finality");
  });
});

describe("rc3 C-2: the same transaction in a different block is a reorg, never silent", () => {
  it("block number change with more confirmations raises CH_BLOCK_CHANGED and never verifies", () => {
    let { ws, id } = usdc();
    ws = sim(ws, id).workspace;
    ws = ingest(ws, obsFor(ws, id, { confirmations: 5 })).workspace;
    const r = ingest(ws, obsFor(ws, id, { blockNumber: 104, confirmations: 13 }));
    // Before the fix: outcome "applied", settlement "verified".
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status.settlement).toBe("contradicted");
    expect(listExceptions(r.workspace, { intentId: id, category: "contradictory_evidence" }).map((e) => e.explanationCode)).toContain("CH_BLOCK_CHANGED");
  });
});

describe("rc3 C-3: a reorg after finality un-matches the chain allocation", () => {
  it("s4 final + matched → confirmations drop → reconciliation exception and the payout is not reconciled; finality again restores the match after a person resolves", () => {
    let ws = sampleWorkspace();
    const id = scenarioIntentId(ws, "s4_chain")!;
    ws = sim(ws, id).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    const obs = ws.chainObservations.find((o) => o.intentId === id)!;
    const { id: _o, observedAt: _a, updatedAt: _b, finalityThreshold: _c, status: _d, label: _e, ...input } = obs;
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...input, confirmations: 2 } }).workspace;
    // Before the fix: reconciliation stayed "matched" on a reorged transfer.
    expect(intent(ws, id).status).toMatchObject({ settlement: "contradicted", reconciliation: "exception" });
    const v = investigate(ws, id);
    expect(v.ok && v.value.outstanding.map((o) => o.code)).toContain("OS_NOT_RECONCILED");
    // A person resolves the reorg contradiction with evidence: the recompute must not count the allocation while not final.
    const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
    ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "document_metadata", description: "Explorer shows the transfer re-included (fictional)" } }).workspace;
    ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Reorg confirmed; waiting for finality again" }).workspace;
    expect(intent(ws, id).status).toMatchObject({ settlement: "pending_finality", reconciliation: "pending" });
    ws = sim(ws, id).workspace; // +6 → 8
    ws = sim(ws, id).workspace; // +6 → 14 (final)
    expect(intent(ws, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
  });
});

describe("review M-3: a hash rejected on the SAME chain (unsupported token) never later counts", () => {
  it("unsupported token first, then the same hash as allowlisted USDC on Base Sepolia: CH_TX_HASH_CONFLICT, not counted", () => {
    let { ws, id } = usdc();
    ws = sim(ws, id).workspace;
    ws = ingest(ws, obsFor(ws, id, { tokenContract: "0x" + "99".repeat(20), tokenSymbol: "USDT", confirmations: 20 })).workspace;
    const r = ingest(ws, obsFor(ws, id, { confirmations: 20 }));
    // Before the fix: outcome "applied", a second observation "final" and settlement "verified".
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status.settlement).toBe("none");
    expect(r.workspace.chainObservations.filter((o) => o.intentId === id).map((o) => o.status)).toEqual(["rejected_unsupported"]);
    expect(listExceptions(r.workspace, { intentId: id, category: "contradictory_evidence" }).map((e) => e.explanationCode)).toContain("CH_TX_HASH_CONFLICT");
  });
  it("a hash rejected for ANOTHER payout (unsupported token) cannot evidence this payout either", () => {
    const a = usdc();
    a.ws = sim(a.ws, a.id).workspace;
    a.ws = ingest(a.ws, obsFor(a.ws, a.id, { tokenSymbol: "USDT", tokenContract: "0x" + "98".repeat(20) })).workspace;
    const b = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay", internalReference: "INV-RC3-M3-B" }, "prv_tidewater", a.ws);
    const w = sim(b.ws, b.id).workspace;
    const r = ingest(w, obsFor(w, b.id, { confirmations: 20 }));
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, b.id).status.settlement).toBe("none");
  });
});

describe("review m-3: a mistaken first entry is recoverable once a person resolves the conflict", () => {
  for (const wrong of [{ chainId: 1, network: "ethereum" }, { tokenSymbol: "USDT", tokenContract: "0x" + "97".repeat(20) }])
    it(`wrong ${Object.keys(wrong)[0]} first → conflict → person resolves → the correct observation counts; the rejected record stays, marked superseded`, () => {
      let { ws, id } = usdc();
      ws = sim(ws, id).workspace;
      ws = ingest(ws, obsFor(ws, id, { ...wrong, confirmations: 20 })).workspace;
      ws = ingest(ws, obsFor(ws, id, { confirmations: 20 })).workspace;
      const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" })[0];
      // still blocked while the conflict is open
      expect(ingest(ws, obsFor(ws, id, { confirmations: 20 })).outcome).toBe("contradictory_exception_raised");
      ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
      ws = run(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "document_metadata", description: "Explorer shows the transfer on Base Sepolia (fictional)" } }).workspace;
      ws = run(ws, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "The first entry had the wrong network; the Base Sepolia record is correct" }).workspace;
      const rejected = ws.chainObservations.find((o) => o.intentId === id && o.status === "rejected_unsupported")!;
      expect(rejected.supersededBy).toBe(exc.id);
      // Before the fix: a new CH_TX_HASH_ON_OTHER_CHAIN on every later ingest (dead end).
      const r = ingest(ws, obsFor(ws, id, { confirmations: 20 }));
      expect(r.outcome).toBe("applied");
      expect(intent(r.workspace, id).status.settlement).toBe("verified");
      expect(r.workspace.chainObservations.filter((o) => o.intentId === id)).toHaveLength(2);
    });
});

describe("review m-3: supersededBy cannot be forged in a stored workspace", () => {
  it("a supersededBy on a counted observation, or naming an open exception, is refused", async () => {
    const { parseWorkspaceValue } = await import("@/lib/clearline");
    const ws = sampleWorkspace();
    const w = structuredClone(ws);
    w.chainObservations[0].supersededBy = w.exceptions.find((e) => e.status !== "resolved")!.id;
    const r = parseWorkspaceValue(w);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.field).toBe("chainObservations[0].supersededBy");
  });
});

describe("third re-review R3-B1: reopening a resolved hash conflict withdraws the supersede; the workspace keeps loading", () => {
  it("wrong chain → conflict → resolve (supersede, verified) → reopen → the rejected record blocks again, settlement contradicted, reload ok, resolve again recovers", async () => {
    const { loadWorkspace, serializeWorkspace } = await import("@/lib/clearline");
    let { ws, id } = usdc();
    ws = sim(ws, id).workspace;
    ws = ingest(ws, obsFor(ws, id, { chainId: 1, network: "ethereum", confirmations: 20 })).workspace;
    ws = ingest(ws, obsFor(ws, id, { confirmations: 20 })).workspace;
    const exc = listExceptions(ws, { intentId: id, category: "contradictory_evidence" })[0];
    const resolve = (w: Workspace) => {
      w = run(w, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" }).workspace;
      w = run(w, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: "document_metadata", description: "Explorer (fictional)" } }).workspace;
      return run(w, "usr_maya", { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Wrong network on the first entry" }).workspace;
    };
    ws = resolve(ws);
    ws = ingest(ws, obsFor(ws, id, { confirmations: 20 })).workspace;
    expect(intent(ws, id).status.settlement).toBe("verified");
    const rejected = ws.chainObservations.find((o) => o.intentId === id && o.status === "rejected_unsupported")!;
    expect(rejected.supersededBy).toBe(exc.id);
    const re = run(ws, "usr_maya", { type: "reopen", target: { kind: "exception", id: exc.id }, reason: "Not sure which network was right" });
    ws = re.workspace;
    // Before the fix: "chainObservations[0].supersededBy: must name a resolved hash-conflict exception" on the next action / reload.
    expect(ws.chainObservations.find((o) => o.id === rejected.id)!.supersededBy).toBeUndefined();
    expect(re.audit.map((a) => a.action)).toContain("chain.supersede_withdrawn");
    expect(intent(ws, id).status.settlement).toBe("contradicted");
    const reloaded = loadWorkspace(serializeWorkspace(ws));
    if (!reloaded.ok) throw new Error(reloaded.error.message);
    expect(reloaded.value.migrations).toEqual([]);
    ws = resolve(reloaded.value.workspace);
    expect(ws.chainObservations.find((o) => o.id === rejected.id)!.supersededBy).toBe(exc.id);
  });
});
