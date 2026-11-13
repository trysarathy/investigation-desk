import { describe, expect, it } from "vitest";
import { ALLOWLISTED_TOKENS, BASE_SEPOLIA_CHAIN_ID, CHAIN_LABEL, FINALITY_THRESHOLD, canResolveException, investigate, listExceptions } from "@/lib/clearline";
import { attempt, errorCode, intent, run, sim, submitted } from "./helpers";

const usdc = () => submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater");

describe("synthetic Base Sepolia chain evidence", () => {
  it("labels testnet data and uses chain id 84532 with a synthetic allowlisted token", () => {
    expect(BASE_SEPOLIA_CHAIN_ID).toBe(84532);
    expect(CHAIN_LABEL).toMatch(/Synthetic/);
    expect(ALLOWLISTED_TOKENS[0]).toMatchObject({ chainId: 84532, symbol: "USDC", decimals: 6 });
    expect(ALLOWLISTED_TOKENS[0].label).toMatch(/not the issuer's official contract/);
  });
  it("observed → pending finality → verified are distinct states", () => {
    let { ws, id } = usdc();
    ws = sim(ws, id).workspace; // in_transit
    ws = sim(ws, id).workspace; // chain observed (0 conf)
    expect(intent(ws, id).status).toMatchObject({ settlement: "observed", settlementScope: "onchain_transfer" });
    ws = sim(ws, id).workspace; // provider completed
    expect(intent(ws, id).status.execution).toBe("provider_reported_completed");
    expect(intent(ws, id).status.settlement).toBe("observed");
    ws = sim(ws, id).workspace; // 6 confirmations
    expect(intent(ws, id).status.settlement).toBe("pending_finality");
    const pf = listExceptions(ws, { intentId: id, category: "pending_finality" })[0];
    ws = run(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: pf.id }, ownerId: "usr_maya" }).workspace;
    expect(canResolveException(ws, pf.id).code).toBe("FINALITY_NOT_REACHED");
    ws = sim(ws, id).workspace; // 12 confirmations
    expect(ws.chainObservations[0].confirmations).toBe(FINALITY_THRESHOLD);
    expect(intent(ws, id).status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
    // the pending_finality exception stays until a person resolves it
    expect(ws.exceptions.find((e) => e.id === pf.id)!.status).not.toBe("resolved");
    expect(canResolveException(ws, pf.id).allowed).toBe(true);
    const v = investigate(ws, id);
    expect(v.ok && v.value.explanationCodes).toContain("UK_BANK_CREDIT_NOT_PROVEN_BY_CHAIN");
  });
  const obsFor = (ws: ReturnType<typeof usdc>["ws"], id: string, o: Record<string, unknown> = {}) => ({
    intentId: id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC",
    txHash: "0x" + "ab".repeat(32), toAddress: "0x" + "cd".repeat(20),
    amountMinor: ws.quotes.find((q) => q.id === intent(ws, id).selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 100, confirmations: 3, ...o,
  });
  it("unsupported network or token raises an exception and is never counted", () => {
    const { ws, id } = usdc();
    for (const o of [{ chainId: 1, network: "ethereum" }, { tokenContract: "0x" + "11".repeat(20) }, { tokenSymbol: "USDT" }]) {
      const r = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obsFor(ws, id, o) });
      expect(r.outcome).toBe("exception_raised");
      expect(listExceptions(r.workspace, { category: "unsupported_token_or_network" })).toHaveLength(1);
      expect(intent(r.workspace, id).status.settlement).toBe("none");
    }
  });
  it("missing finality is never assumed; decreasing confirmations is a contradiction", () => {
    let { ws, id } = usdc();
    ws = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obsFor(ws, id, { confirmations: 11 }) }).workspace;
    expect(intent(ws, id).status.settlement).toBe("pending_finality");
    const r = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obsFor(ws, id, { confirmations: 2 }) });
    expect(r.outcome).toBe("contradictory_exception_raised");
    expect(intent(r.workspace, id).status.settlement).toBe("contradicted");
  });
  it("an on-chain amount different from the quote is contradictory", () => {
    const { ws, id } = usdc();
    const r = run(ws, "usr_maya", { type: "ingest_chain_observation", observation: obsFor(ws, id, { amountMinor: 1 }) });
    expect(r.outcome).toBe("contradictory_exception_raised");
  });
  it("rejects malformed chain inputs", () => {
    const { ws, id } = usdc();
    expect(errorCode(attempt(ws, "usr_maya", { type: "ingest_chain_observation", observation: obsFor(ws, id, { txHash: "0x123" }) }))).toBe("invalid_field");
    expect(errorCode(attempt(ws, "usr_maya", { type: "ingest_chain_observation", observation: obsFor(ws, id, { confirmations: -1 }) }))).toBe("invalid_field");
  });
});
