/**
 * Deterministic sample workspace. Every name, organisation, reference, hash and amount is
 * FICTIONAL. The sample is built by replaying public actions, so it is always consistent with
 * the engine's rules (and a failure here is a bug, caught by tests).
 */
import { applyAction } from "./actions";
import { sandboxRoutes } from "./adapters";
import type { Actor, LiquidityPolicy, LiquiditySnapshot, PaymentIntent, Workspace, WorkspaceAction } from "./types";

export const SAMPLE_AS_OF = "2026-11-13T02:00:00.000Z";
const BUILD_START = "2026-11-12T00:00:00.000Z";

export const SAMPLE_ACTORS: Actor[] = [
  { id: "usr_maya", name: "Maya Tan · Operations (fictional)", role: "operator" },
  { id: "usr_sam", name: "Sam Lee · Operations (fictional)", role: "operator" },
  { id: "usr_daniel", name: "Daniel Ong · Treasury approver (fictional)", role: "approver" },
  { id: "usr_priya", name: "Priya Nair · Compliance reviewer (fictional)", role: "compliance" },
  { id: "usr_alex", name: "Alex Chen · Viewer (fictional)", role: "viewer" },
];

/** Scenario keys stored on `intent.scenario`. */
export const SAMPLE_SCENARIOS = {
  s1_success: "Successful payment: provider-reported completion, then a bank statement line matched separately",
  s2_returned: "Returned payout: beneficiary details rejected, return event and return statement line",
  s3_hold: "Compliance hold: partner requested documents; reviewer assigned; never auto-released",
  s4_chain: "Base Sepolia stablecoin delay: observed, pending finality, then verified after the threshold",
  s5_funding: "Funding exposure: SGD 50,000.00 advance, SGD 30,000.00 repaid by reference, SGD 20,000.00 outstanding",
} as const;
export type SampleScenario = keyof typeof SAMPLE_SCENARIOS;

const POLICY: LiquidityPolicy = {
  id: "pol_sandbox_v1",
  label: "Illustrative provider-defined liquidity policy (sandbox). Not a regulatory or safeguarding classification; confirm classifications with counsel.",
  definedBy: "Fictional provider treasury policy",
  bufferBps: 500,
  minBufferMinor: { SGD: 480_000, USD: 450_000, USDC: 100_000_000, PHP: 0, EUR: 0 },
  maxAgeMinutes: 360,
};

const LIQUIDITY: LiquiditySnapshot[] = [
  { id: "liq_northline_sgd", providerId: "prv_northline", accountRef: "NL-SGD-OPS-01 (fictional)", currency: "SGD", eligibleMinor: 21_248_673, restrictedMinor: 500_000, safeguardedMinor: 1_854_217, source: "Northline sandbox balance export (fictional)", asOf: "2026-11-13T01:30:00.000Z" },
  { id: "liq_harbour_usd", providerId: "prv_harbour", accountRef: "HF-USD-NOSTRO-02 (fictional)", currency: "USD", eligibleMinor: 6_427_843, restrictedMinor: 0, safeguardedMinor: 1_100_000, source: "Harbour FX sandbox statement (fictional)", asOf: "2026-11-11T09:00:00.000Z" },
  { id: "liq_harbour_sgd", providerId: "prv_harbour", accountRef: "HF-SGD-OPS-03 (fictional)", currency: "SGD", eligibleMinor: 4_200_000, restrictedMinor: 1_200_000, safeguardedMinor: 900_000, source: "Harbour FX sandbox statement (fictional)", asOf: "2026-11-13T00:45:00.000Z" },
  { id: "liq_tidewater_usdc", providerId: "prv_tidewater", accountRef: "Synthetic Base Sepolia treasury wallet", currency: "USDC", eligibleMinor: 17_562_820_000, restrictedMinor: 2_000_000_000, safeguardedMinor: 0, source: "Synthetic testnet balance read (fictional)", asOf: "2026-11-13T01:45:00.000Z" },
];

export function emptyWorkspace(): Workspace {
  return {
    schemaVersion: 1,
    mode: "sandbox",
    label: "TEST MODE · fictional sandbox workspace — no real providers, money movement or compliance decisions",
    asOf: SAMPLE_AS_OF,
    seq: 0,
    organization: { id: "org_lumen_pay", name: "Lumen Pay Sandbox Pte Ltd (fictional)", fictional: true, baseCurrency: "SGD", timezone: "Asia/Singapore" },
    actors: SAMPLE_ACTORS.map((a) => ({ ...a })),
    routes: sandboxRoutes(),
    intents: [],
    quotes: [],
    instructions: [],
    providerEvents: [],
    evidence: [],
    statementLines: [],
    allocations: [],
    exceptions: [],
    cases: [],
    holds: [],
    liquidityPolicy: structuredClone(POLICY),
    liquidity: structuredClone(LIQUIDITY),
    chainObservations: [],
    advances: [],
    fundingDecisions: [],
    obligations: [],
    repaymentAllocations: [],
    idempotency: {},
    audit: [],
  };
}

class Builder {
  ws: Workspace;
  t: number;
  constructor() {
    this.ws = { ...emptyWorkspace(), asOf: BUILD_START };
    this.t = Date.parse(BUILD_START);
  }
  run(actorId: string, action: WorkspaceAction): string[] {
    this.t += 3 * 60_000;
    const r = applyAction(this.ws, action, { actorId, at: new Date(this.t).toISOString() });
    if (!r.ok) throw new Error(`Sample build failed at ${action.type}: ${r.error.code} ${r.error.message}`);
    this.ws = r.value.workspace;
    return r.value.createdIds;
  }
  intent(id: string): PaymentIntent {
    return this.ws.intents.find((i) => i.id === id)!;
  }
  pay(scenario: SampleScenario, input: Omit<Extract<WorkspaceAction, { type: "create_intent" }>["input"], "idempotencyKey" | "requestedExecutionDate" | "purpose">, providerId: string, opts: { advance?: () => void } = {}): string {
    const [id] = this.run("usr_maya", {
      type: "create_intent",
      input: { ...input, purpose: "Supplier invoice", requestedExecutionDate: "2026-11-16", idempotencyKey: `sample-${scenario}-0001` },
    });
    this.ws.intents.find((i) => i.id === id)!.scenario = scenario;
    opts.advance?.();
    this.run("usr_maya", { type: "request_quotes", intentId: id });
    const quote = this.ws.quotes.find((q) => q.intentId === id && q.providerId === providerId && q.eligible)!;
    const [ins] = this.run("usr_maya", { type: "choose_route", intentId: id, quoteId: quote.id });
    this.run("usr_daniel", { type: "approve_instruction", instructionId: ins });
    this.run("usr_maya", { type: "submit_instruction", instructionId: ins });
    return id;
  }
  sim(intentId: string, times = 1) {
    for (let i = 0; i < times; i++) this.run("usr_maya", { type: "simulate_provider_event", intentId });
  }
  ppid(intentId: string): string {
    const i = this.intent(intentId);
    return this.ws.instructions.find((x) => x.id === i.instructionId)!.providerPaymentId!;
  }
}

export function sampleWorkspace(): Workspace {
  const b = new Builder();

  // 1. Successful payment
  const s1 = b.pay("s1_success", { internalReference: "INV-2026-126", amountMinor: 2_465_137, sourceCurrency: "SGD", destinationCurrency: "PHP", beneficiaryRef: "BEN-OAKWELL-01", beneficiaryName: "Oakwell Engineering (fictional)", destinationCountry: "PH" }, "prv_northline");
  b.sim(s1, 2); // in_transit, provider_reported_completed
  b.run("usr_maya", { type: "ingest_statement_line", line: { lineId: "SIMBANK-0001", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "debit", kind: "payment", amountMinor: 2_465_137, currency: "SGD", reference: `NORTHLINE PAYOUT ${b.ppid(s1)}`, counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-12" } });

  // 2. Returned payout
  const s2 = b.pay("s2_returned", { internalReference: "INV-2026-141", amountMinor: 1_278_490, sourceCurrency: "USD", destinationCurrency: "SGD", beneficiaryRef: "BEN-REDWOOD-07", beneficiaryName: "Redwood Supplies Ltd (fictional)", destinationCountry: "SG", sandboxOutcome: "return" }, "prv_northline");
  b.sim(s2, 2); // in_transit, returned
  b.run("usr_maya", { type: "ingest_statement_line", line: { lineId: "SIMBANK-0002", source: "bank_statement", accountRef: "BANK-USD-OPS (fictional)", direction: "credit", kind: "return", amountMinor: 1_278_490, currency: "USD", reference: `RETURN ${b.ppid(s2)} ACCOUNT INVALID`, counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-12" } });
  const s2case = b.intent(s2).caseId!;
  const s2exc = b.ws.exceptions.find((e) => e.intentId === s2 && e.category === "returned_payout")!.id;
  b.run("usr_maya", { type: "assign_owner", target: { kind: "case", id: s2case }, ownerId: "usr_maya" });
  b.run("usr_maya", { type: "assign_owner", target: { kind: "exception", id: s2exc }, ownerId: "usr_maya" });
  b.run("usr_maya", { type: "add_note", target: { kind: "case", id: s2case }, text: "Supplier asked to reconfirm account details through the known contact on file. Do not reissue until confirmed." });

  // 3. Compliance hold
  const s3 = b.pay("s3_hold", { internalReference: "INV-2026-145", amountMinor: 883_950, sourceCurrency: "SGD", destinationCurrency: "USD", beneficiaryRef: "BEN-EASTPORT-03", beneficiaryName: "Eastport Trading (fictional)", destinationCountry: "US", sandboxOutcome: "hold" }, "prv_harbour");
  b.sim(s3, 2); // in_transit, on_hold
  const hold = b.ws.holds.find((h) => h.intentId === s3)!;
  b.run("usr_priya", { type: "assign_hold_reviewer", holdId: hold.id, reviewerId: "usr_priya" });
  b.run("usr_priya", { type: "assign_owner", target: { kind: "case", id: b.intent(s3).caseId! }, ownerId: "usr_priya" });

  // 4. Base Sepolia stablecoin delay
  const s4 = b.pay("s4_chain", { internalReference: "INV-2026-149", amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", beneficiaryRef: "BEN-STONEBRIDGE-02", beneficiaryName: "Stonebridge Exports (fictional)", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater");
  b.sim(s4, 4); // in_transit, chain observed (0), provider completed, 6/12 confirmations

  // 5. Funding exposure
  let advanceId = "";
  const s5 = b.pay("s5_funding", { internalReference: "INV-PM-5011", amountMinor: 5_000_000, sourceCurrency: "SGD", destinationCurrency: "SGD", beneficiaryRef: "BEN-PACIFIC-05", beneficiaryName: "Pacific Metals (fictional supplier)", destinationCountry: "SG" }, "prv_northline", {
    advance: () => {
      const intentId = b.ws.intents[b.ws.intents.length - 1].id;
      [advanceId] = b.run("usr_maya", { type: "create_advance", input: { intentId, customerRef: "CUST-SEABRIGHT", customerName: "Seabright Trading (fictional)", supplierName: "Pacific Metals (fictional supplier)", invoiceRef: "INV-PM-5011", dueDate: "2026-11-20", repaymentReference: "RPY-SEABRIGHT-0001" } });
      b.run("usr_daniel", { type: "decide_advance", advanceId, outcome: "approve", reason: "Within agreed limit; invoice and terms on file (fictional review)." });
    },
  });
  b.sim(s5, 2);
  b.run("usr_maya", { type: "ingest_statement_line", line: { lineId: "SIMBANK-0003", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "debit", kind: "payment", amountMinor: 5_000_000, currency: "SGD", reference: `NORTHLINE PAYOUT ${b.ppid(s5)}`, counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-12" } });
  b.run("usr_maya", { type: "ingest_statement_line", line: { lineId: "SIMBANK-0004", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 3_000_000, currency: "SGD", reference: "RPY-SEABRIGHT-0001 PART PAYMENT", counterparty: "SEABRIGHT TRADING", valueDate: "2026-11-12" } });
  b.run("usr_maya", { type: "ingest_statement_line", line: { lineId: "SIMBANK-0005", source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: 2_000_000, currency: "SGD", reference: "", counterparty: "SEABRIGHT TRADING", valueDate: "2026-11-12" } });

  b.run("usr_maya", { type: "advance_clock", to: SAMPLE_AS_OF });
  return b.ws;
}

/** Real id of a seeded scenario's payment intent (ids are sequential, e.g. pi_00001). */
export function scenarioIntentId(ws: Workspace, scenario: SampleScenario | string): string | undefined {
  return ws.intents.find((i) => i.scenario === scenario)?.id;
}
/** Alias requested by the console (UI_REQUESTS R1). */
export const intentForScenario = scenarioIntentId;
