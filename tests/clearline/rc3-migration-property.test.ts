/**
 * Second re-review R2-M1 / third re-review R3-B1 / fourth check R4-m1: the load-time migration is a NO-OP on every
 * workspace rc3 itself produces, and every workspace an action produces loads. After EVERY successful action of
 * seeded random rc3 sequences, loadWorkspace(serialize(ws)) returns migrations [] and a byte-identical workspace.
 *
 * Generator: provider events with every failure injection; signed webhooks of every type; bank and provider
 * statement lines of every shape (incl. near-amount, late and over-amount debits of the payout's reference);
 * chain observations of every shape incl. reorgs and conflicts; resolutions with and without acceptDifference /
 * acceptLateDate; approve_acceptance; reopen (exceptions and cases); hold documents, reviewer assignment and
 * decisions; cancel; advances (create, decide, repay by reference); notes; info requests; case evidence; clock moves;
 * the full payment lifecycle (create → quote → route → approve / reject → submit); per-case resets, also at a
 * later clock. Starting points: the sample plus live USDC / SGD payouts, and (every third seed) a migrated
 * workspace saved by the v2 engine (fixtures v2_sample, v2_t1, v2_va, v2_gaps, v2_vb).
 *
 * Attribution: the extended generator (lifecycle actions, reopen/resolve cycles with acceptance flags, advance
 * repayments, hold reviewer assignment, migrated v2 starting points, resets at a later clock) was written by the
 * independent reviewer for the fourth check (scratchpad probes8/prop-ext.test.ts, docs/release/CODE_REVIEW_RC3_ENGINE.md)
 * and adopted here; the boosted lifecycle / approval candidates, the KINDS coverage assertion and the scripted
 * lifecycle test were added when adopting it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALLOWLISTED_TOKENS, SAMPLE_SCENARIOS, applyAction, getAdapter, loadWorkspace, resetScenario, sampleWorkspace, serializeWorkspace, type Workspace, type WorkspaceAction } from "@/lib/clearline";
import { debitLine, intent as intentOf, submitted } from "./helpers";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function candidates(ws: Workspace, r: () => number): { actor: string; action: WorkspaceAction }[] {
  const pick = <T,>(xs: T[]): T | undefined => (xs.length ? xs[Math.floor(r() * xs.length)] : undefined);
  const out: { actor: string; action: WorkspaceAction }[] = [];
  // half the time, the payouts the migration rules are about: USDC (chain evidence) and live ones (can still fail)
  const focus = ws.intents.filter((i) => i.destinationCurrency === "USDC" || ["submitted", "in_transit", "provider_reported_completed"].includes(i.status.execution));
  const intent = (r() < 0.6 && focus.length ? pick(focus) : pick(ws.intents))!;
  const instr = ws.instructions.find((x) => x.id === intent.instructionId);
  const ppid = instr?.providerPaymentId;
  const inj = pick(["none", "none", "none", "contradictory", "duplicate", "out_of_order", "timeout", "bad_signature"] as const)!;
  out.push({ actor: "usr_maya", action: { type: "simulate_provider_event", intentId: intent.id, injection: inj } });
  if (instr?.providerPaymentId) {
    // a signed provider webhook of any type, so terminal states arrive in every order relative to the evidence
    const type = pick(["payout.failed", "payout.returned", "payout.completed", "payout.in_transit", "payout.on_hold"] as const)!;
    const seq = ws.providerEvents.filter((e) => e.intentId === intent.id).reduce((m, e) => Math.max(m, e.sequence), 0) + 1;
    const rawBody = JSON.stringify({ id: `${instr.providerPaymentId}-P${ws.seq}`, type, provider_payment_id: instr.providerPaymentId, sequence: seq, occurred_at: ws.asOf, ...(type === "payout.failed" || type === "payout.returned" ? { reason: "beneficiary_account_invalid" } : {}), ...(type === "payout.on_hold" ? { reason: "compliance_review", requested_documents: ["Invoice"] } : {}) });
    out.push({ actor: "usr_maya", action: { type: "ingest_webhook", delivery: { providerId: instr.providerId, rawBody, signatureHeader: getAdapter(instr.providerId)!.signWebhook(rawBody, Math.floor(Date.parse(ws.asOf) / 1000)) } } });
  }
  const n = ws.seq;
  // half the lines are the payout's own exact, in-window bank debit (so debit-then-failure orders occur)
  const exact = r() < 0.5 && !!ppid;
  const amount = exact ? intent.amountMinor : pick([intent.amountMinor, Math.floor(intent.amountMinor / 2), intent.amountMinor + 50, intent.amountMinor * 3, 777])!;
  const valueDate = exact ? "2026-11-13" : pick(["2026-11-12", "2026-11-13", "2026-11-30", "2025-01-01"])!;
  const reference = exact ? `PAYOUT ${ppid}` : pick([ppid ? `PAYOUT ${ppid}` : "", ppid ? `RETURN ${ppid}` : "", "", "RPY-SEABRIGHT-0001", "UNKNOWN 1"])!;
  const source = exact ? ("bank_statement" as const) : pick(["bank_statement", "bank_statement", "provider_settlement_report"] as const)!;
  const direction = exact ? ("debit" as const) : pick(["debit", "debit", "credit"] as const)!;
  const kind = direction === "credit" ? pick(["payment", "return", "reversal"] as const)! : "payment";
  out.push({ actor: "usr_maya", action: { type: "ingest_statement_line", line: { lineId: `P-${n}`, source, accountRef: source === "bank_statement" ? "BANK-PROP (fictional)" : "prv_northline:settlement", direction, kind, amountMinor: Math.max(1, amount), currency: pick([intent.sourceCurrency, intent.sourceCurrency, "USD"])!, reference, counterparty: "Counterparty (fictional)", valueDate } } });
  if (intent.destinationCurrency === "USDC" && instr) {
    const q = ws.quotes.find((x) => x.id === intent.selectedQuoteId);
    const existing = ws.chainObservations.find((o) => o.intentId === intent.id && o.status !== "rejected_unsupported");
    const base = { intentId: intent.id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC", txHash: existing?.txHash ?? "0x" + (n % 255).toString(16).padStart(2, "0").repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(intent), amountMinor: q?.estimatedRecipientMinor ?? 1, blockNumber: existing?.blockNumber ?? 900, confirmations: pick([0, 3, 11, 12, 20])! };
    const variant = pick(["same", "same", "unsupported", "otherChain", "block", "fewer"])!;
    const obs = variant === "unsupported" ? { ...base, tokenSymbol: "USDT", tokenContract: "0x" + "98".repeat(20) } : variant === "otherChain" ? { ...base, chainId: 1, network: "ethereum" } : variant === "block" ? { ...base, blockNumber: base.blockNumber + 3 } : variant === "fewer" ? { ...base, confirmations: Math.max(0, (existing?.confirmations ?? 1) - 1) } : base;
    out.push({ actor: "usr_maya", action: { type: "ingest_chain_observation", observation: obs } });
  }
  const exc = pick(ws.exceptions.filter((e) => e.status !== "resolved"));
  if (exc) {
    out.push({ actor: "usr_maya", action: { type: "assign_owner", target: { kind: "exception", id: exc.id }, ownerId: "usr_maya" } });
    out.push({ actor: "usr_maya", action: { type: "attach_evidence", target: { kind: "exception", id: exc.id }, evidence: { kind: pick(["document_metadata", "funds_returned_confirmation"] as const)!, description: "Evidence (fictional)" } } });
    out.push({ actor: pick(["usr_maya", "usr_sam", "usr_daniel"])!, action: { type: "resolve", target: { kind: "exception", id: exc.id }, note: "Reviewed", ...(r() < 0.3 ? { acceptDifference: true } : {}), ...(r() < 0.2 ? { acceptLateDate: true } : {}) } });
  }
  const awaiting = pick(ws.exceptions.filter((e) => e.resolution?.acceptedDifference?.secondApproval && !e.resolution.acceptedDifference.secondApproval.approvedBy));
  // R4-m1: offered several times (by a different person) so a successful approve_acceptance is reached in the random walk
  if (awaiting) for (let k = 0; k < 4; k++) out.push({ actor: awaiting.resolution!.actorId === "usr_sam" ? "usr_daniel" : "usr_sam", action: { type: "approve_acceptance", exceptionId: awaiting.id, note: "Second person checked the bank charge" } });
  if (awaiting) out.push({ actor: awaiting.resolution!.actorId, action: { type: "approve_acceptance", exceptionId: awaiting.id, note: "Self-approval (refused)" } });
  const hold = pick(ws.holds.filter((h) => h.status !== "released" && h.status !== "rejected"));
  if (hold) {
    out.push({ actor: "usr_maya", action: { type: "submit_hold_documents", holdId: hold.id, documents: ["Supporting commercial invoice"] } });
    out.push({ actor: "usr_priya", action: { type: "record_hold_decision", holdId: hold.id, decision: pick(["release", "reject", "request_more"] as const)!, reason: "Reviewed (fictional)" } });
  }
  const c = pick(ws.cases);
  if (c) out.push({ actor: "usr_maya", action: { type: "assign_owner", target: { kind: "case", id: c.id }, ownerId: "usr_maya" } }, { actor: "usr_maya", action: { type: "resolve", target: { kind: "case", id: c.id }, note: "Closed" } });
  out.push({ actor: "usr_maya", action: { type: "advance_clock", to: new Date(Date.parse(ws.asOf) + Math.floor(r() * 4) * 86_400_000).toISOString() } });
  // R3-B1: reopen (exceptions and cases), cancel, advances, notes, info requests, case evidence, new payments
  const resolved = pick(ws.exceptions.filter((e) => e.status === "resolved"));
  if (resolved) out.push({ actor: pick(["usr_maya", "usr_daniel"])!, action: { type: "reopen", target: { kind: "exception", id: resolved.id }, reason: "Reopened for review" } }, { actor: "usr_maya", action: { type: "reopen", target: { kind: "exception", id: resolved.id }, reason: "Reopened again" } });
  const resolvedCase = pick(ws.cases.filter((x) => x.status === "resolved"));
  if (resolvedCase) out.push({ actor: "usr_maya", action: { type: "reopen", target: { kind: "case", id: resolvedCase.id }, reason: "New information" } });
  out.push({ actor: pick(["usr_maya", "usr_daniel"])!, action: { type: "cancel_intent", intentId: intent.id, reason: "No longer needed" } });
  if (c) {
    out.push({ actor: "usr_maya", action: { type: "add_note", target: { kind: "case", id: c.id }, text: "Note (fictional)" } });
    out.push({ actor: "usr_maya", action: { type: "request_info", caseId: c.id, from: "Supplier", request: "Confirm account details" } });
    out.push({ actor: "usr_maya", action: { type: "attach_evidence", target: { kind: "case", id: c.id }, evidence: { kind: "document_metadata", description: "Case document (fictional)" } } });
  }
  if (!intent.advanceId && !["cancelled", "expired", "failed", "returned"].includes(intent.status.execution))
    out.push({ actor: "usr_maya", action: { type: "create_advance", input: { intentId: intent.id, customerRef: `CUST-${n}`, customerName: "Customer (fictional)", supplierName: "Supplier (fictional)", invoiceRef: `INV-ADV-${n}`, dueDate: "2026-11-25", repaymentReference: `RPY-PROP-${n}` } } });
  const adv = pick(ws.advances.filter((a) => !a.decisionId));
  if (adv) out.push({ actor: pick(["usr_daniel", "usr_maya"])!, action: { type: "decide_advance", advanceId: adv.id, outcome: pick(["approve", "decline"] as const)!, reason: "Treasury review (fictional)" } });
  const cancellable = pick(ws.intents.filter((i) => ["created", "quoted", "approved"].includes(i.status.execution)));
  if (cancellable) out.push({ actor: "usr_maya", action: { type: "cancel_intent", intentId: cancellable.id, reason: "Cancelled before submission" } });
  if (r() < 0.2) out.push({ actor: "usr_maya", action: { type: "create_intent", input: { internalReference: `INV-PROP-${n}`, amountMinor: 50_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-PROP-01", beneficiaryName: "Prop Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-11-20", idempotencyKey: `prop-new-${n}` } } });

  // REVIEW EXTENSION: lifecycle actions the generator lacks, and heavy reopen/resolve cycles with acceptance flags
  const live = pick(ws.intents.filter((i) => ["created", "quoted"].includes(i.status.execution)));
  if (live) {
    out.push({ actor: "usr_maya", action: { type: "request_quotes", intentId: live.id } });
    const q = pick(ws.quotes.filter((x) => x.intentId === live.id && x.eligible));
    if (q) out.push({ actor: "usr_maya", action: { type: "choose_route", intentId: live.id, quoteId: q.id } });
  }
  const pend = pick(ws.instructions.filter((x) => x.status === "pending_approval"));
  if (pend) out.push({ actor: "usr_daniel", action: { type: "approve_instruction", instructionId: pend.id } }, { actor: "usr_daniel", action: { type: "approve_instruction", instructionId: pend.id } }, { actor: "usr_daniel", action: { type: "reject_instruction", instructionId: pend.id, reason: "No" } }, { actor: pend.makerId, action: { type: "approve_instruction", instructionId: pend.id } });
  const appr = pick(ws.instructions.filter((x) => x.status === "approved" && ws.intents.find((i) => i.id === x.intentId)?.status.execution === "approved"));
  // R4-m1: offered several times so a successful submit_instruction is reached in the random walk
  if (appr) for (let k = 0; k < 4; k++) out.push({ actor: "usr_maya", action: { type: "submit_instruction", instructionId: appr.id } });
  const h2 = pick(ws.holds.filter((h) => h.status !== "released" && h.status !== "rejected"));
  if (h2) out.push({ actor: "usr_priya", action: { type: "assign_hold_reviewer", holdId: h2.id, reviewerId: pick(["usr_priya", "usr_daniel"])! } });
  const ov = pick(ws.exceptions.filter((e) => ["RC_OVERPAYMENT", "RC_OUTSIDE_TIME_WINDOW", "CH_TX_HASH_CONFLICT", "CH_TX_HASH_ON_OTHER_CHAIN"].includes(e.explanationCode)));
  if (ov) {
    if (ov.status === "resolved") out.push({ actor: "usr_maya", action: { type: "reopen", target: { kind: "exception", id: ov.id }, reason: "cycle" } }, { actor: "usr_maya", action: { type: "reopen", target: { kind: "exception", id: ov.id }, reason: "cycle" } });
    else for (const flags of [{}, { acceptDifference: true }, { acceptLateDate: true }, { acceptDifference: true, acceptLateDate: true }]) out.push({ actor: pick(["usr_maya", "usr_sam"])!, action: { type: "resolve", target: { kind: "exception", id: ov.id }, note: "cycle", ...flags } as WorkspaceAction }, { actor: "usr_maya", action: { type: "assign_owner", target: { kind: "exception", id: ov.id }, ownerId: "usr_maya" } }, { actor: "usr_maya", action: { type: "attach_evidence", target: { kind: "exception", id: ov.id }, evidence: { kind: "document_metadata", description: "e (fictional)" } } });
  }
  if (ppid && r() < 0.5) out.push({ actor: "usr_maya", action: { type: "ingest_statement_line", line: { lineId: `X-${n}`, source: "bank_statement", accountRef: "BANK-X (fictional)", direction: "debit", kind: "payment", amountMinor: intent.amountMinor + pick([1, 50, Math.floor(intent.amountMinor / 50), Math.floor(intent.amountMinor / 4)])!, currency: intent.sourceCurrency, reference: `PAYOUT ${ppid}`, counterparty: "C (fictional)", valueDate: pick(["2026-11-13", "2026-11-25", "2026-12-20"])! } } });
  const adv2 = pick(ws.advances.filter((a) => a.obligationId));
  if (adv2) { const ob = ws.obligations.find((o) => o.id === adv2.obligationId); if (ob) out.push({ actor: "usr_maya", action: { type: "ingest_statement_line", line: { lineId: `R-${n}`, source: "bank_statement", accountRef: "BANK-SGD-OPS (fictional)", direction: "credit", kind: "payment", amountMinor: Math.max(1, Math.floor(ob.principalMinor / pick([1, 2, 3])!)), currency: ob.currency, reference: ob.reference, counterparty: "Cust (fictional)", valueDate: "2026-11-14" } } }); }
  return out;
}

const seen = new Set<string>();
const KINDS = new Map<string, number>();
/** Action kinds applied successfully by the random walk alone. */
const RANDOM_KINDS = new Set<string>();
function note(ws: Workspace) {
  for (const i of ws.intents) {
    if (["failed", "returned", "cancelled"].includes(i.status.execution) && ws.chainObservations.some((o) => o.intentId === i.id && o.status !== "rejected_unsupported")) seen.add("terminal payout with chain evidence");
    if (["failed", "returned", "cancelled"].includes(i.status.execution) && ws.allocations.some((a) => a.target.kind === "payment" && a.target.intentId === i.id)) seen.add("terminal payout with a bank debit");
  }
  if (ws.chainObservations.some((o) => o.status === "final")) seen.add("final chain transfer");
  if (ws.chainObservations.some((o) => o.status === "rejected_unsupported")) seen.add("rejected observation");
  for (const code of ["CH_CONFIRMATIONS_DECREASED", "CH_BLOCK_CHANGED", "CH_TX_HASH_CONFLICT", "CH_TX_HASH_ON_OTHER_CHAIN", "CH_TRANSFER_FOR_TERMINAL_PAYOUT", "RC_DEBIT_FOR_FAILED_PAYOUT", "RC_OVERPAYMENT", "RC_OUTSIDE_TIME_WINDOW"])
    if (ws.exceptions.some((e) => e.explanationCode === code)) seen.add(code);
  if (ws.exceptions.some((e) => e.status === "resolved")) seen.add("resolved exception");
  if (ws.exceptions.some((e) => e.resolution?.acceptedDifference?.secondApproval?.approvedBy)) seen.add("second approval");
  if (ws.exceptions.some((e) => e.history.some((h) => h.action === "acceptance_withdrawn"))) seen.add("acceptance withdrawn on reopen");
  if (ws.exceptions.some((e) => e.history.some((h) => h.action === "supersede_withdrawn"))) seen.add("supersede withdrawn on reopen");
  if (ws.exceptions.some((e) => e.status === "reopened")) seen.add("reopened exception");
  if (ws.cases.some((c) => c.status === "reopened")) seen.add("reopened case");
  if (ws.intents.some((i) => i.status.execution === "cancelled")) seen.add("cancelled payment");
  if (ws.fundingDecisions.length > 1) seen.add("advance decided");
  if (ws.cases.some((c) => c.requestedInfo.some((q) => q.actorId === "usr_maya"))) seen.add("info requested");
}
const FIX = ["v2_sample", "v2_t1", "v2_va", "v2_gaps", "v2_vb"].map((f) => readFileSync(path.join(__dirname, "fixtures", `${f}.json`), "utf8"));
function start(seed = 0): Workspace {
  if (seed % 3 === 0) { const l = loadWorkspace(FIX[(seed / 3) % FIX.length]); if (!l.ok) throw new Error("fixture"); return l.value.workspace; }
  let ws = sampleWorkspace();
  ws = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay", internalReference: "INV-PROP-USDC", idempotencyKey: "prop-usdc-0001" }, "prv_tidewater", ws).ws;
  ws = submitted({ amountMinor: 1_000_000, internalReference: "INV-PROP-SGD", idempotencyKey: "prop-sgd-0001" }, "prv_northline", ws).ws;
  return ws;
}

describe("R2-M1: the migration never fires on a workspace rc3 produced", () => {
  for (let seed = 1; seed <= 60; seed++)
    it(`seed ${seed}: every intermediate workspace of a random rc3 sequence loads with migrations [] and byte-identical`, () => {
      const r = rng(seed * 7919);
      let ws = start(seed);
      let applied = 0;
      for (let step = 0; step < 90; step++) {
        if (r() < 0.05) {
          const sc = Object.keys(SAMPLE_SCENARIOS)[Math.floor(r() * 5)];
          const rs = resetScenario(ws, sc, { actorId: "usr_maya", at: new Date(Date.parse(ws.asOf) + Math.floor(r() * 30) * 86_400_000).toISOString() });
          if (rs.ok) ws = rs.value.workspace;
        } else {
          const list = candidates(ws, r);
          const { actor, action } = list[Math.floor(r() * list.length)];
          const res = applyAction(ws, action, { actorId: actor, at: ws.asOf });
          if (!res.ok) continue;
          { const a = action as { acceptDifference?: boolean; acceptLateDate?: boolean }; const k = action.type + (a.acceptDifference ? "+diff" : "") + (a.acceptLateDate ? "+late" : ""); KINDS.set(k, (KINDS.get(k) ?? 0) + 1); RANDOM_KINDS.add(k); if (a.acceptDifference) RANDOM_KINDS.add("resolve+diff"); if (a.acceptLateDate) RANDOM_KINDS.add("resolve+late"); }
          ws = res.value.workspace;
          applied++;
        }
        note(ws);
        const text = serializeWorkspace(ws);
        const loaded = loadWorkspace(text);
        if (!loaded.ok) throw new Error(`seed ${seed} step ${step}: refused ${loaded.error.message}`);
        expect(`seed ${seed} step ${step}: ${JSON.stringify(loaded.value.migrations.map((m) => [m.kind, m.intentId, m.text]))}`).toBe(`seed ${seed} step ${step}: []`);
        expect(serializeWorkspace(loaded.value.workspace) === text).toBe(true);
      }
      expect(applied).toBeGreaterThan(10);
    }, 120_000);

  // Scripted rc3 sequences through every state the migration rules are about (each step is checked).
  const noop = (ws: Workspace, label: string) => {
    note(ws);
    const text = serializeWorkspace(ws);
    const loaded = loadWorkspace(text);
    if (!loaded.ok) throw new Error(`${label}: refused ${loaded.error.message}`);
    expect(`${label}: ${JSON.stringify(loaded.value.migrations.map((m) => m.kind))}`).toBe(`${label}: []`);
    expect(serializeWorkspace(loaded.value.workspace) === text).toBe(true);
  };
  const act = (ws: Workspace, actor: string, action: WorkspaceAction, label: string) => {
    const r = applyAction(ws, action, { actorId: actor, at: ws.asOf });
    if (!r.ok) throw new Error(`${label}: ${r.error.message}`);
    noop(r.value.workspace, label);
    return r.value.workspace;
  };
  const hook = (ws: Workspace, id: string, type: string, seq: number) => {
    const ins = ws.instructions.find((x) => x.id === intentOf(ws, id).instructionId)!;
    const rawBody = JSON.stringify({ id: `${ins.providerPaymentId}-S${seq}`, type, provider_payment_id: ins.providerPaymentId, sequence: seq, occurred_at: ws.asOf, ...(type === "payout.failed" || type === "payout.returned" ? { reason: "beneficiary_account_invalid" } : {}) });
    return { type: "ingest_webhook" as const, delivery: { providerId: ins.providerId, rawBody, signatureHeader: getAdapter(ins.providerId)!.signWebhook(rawBody, Math.floor(Date.parse(ws.asOf) / 1000)) } };
  };
  const resolveAll = (ws: Workspace, id: string, label: string) => {
    for (const e of ws.exceptions.filter((x) => x.intentId === id && x.status !== "resolved")) {
      ws = act(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }, label);
      ws = act(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "funds_returned_confirmation", description: "Evidence (fictional)" } }, label);
      const r = applyAction(ws, { type: "resolve", target: { kind: "exception", id: e.id }, note: "Reviewed" }, { actorId: "usr_maya", at: ws.asOf });
      if (r.ok) { ws = r.value.workspace; noop(ws, `${label} resolve ${e.explanationCode}`); }
    }
    return ws;
  };
  const usdc = () => {
    const s = submitted({ amountMinor: 6_427_830_000, sourceCurrency: "USDC", destinationCurrency: "USDC", destinationCountry: "SG", sandboxOutcome: "chain_delay" }, "prv_tidewater", sampleWorkspace());
    const ws = act(s.ws, "usr_maya", { type: "simulate_provider_event", intentId: s.id }, "usdc in_transit");
    const i = intentOf(ws, s.id);
    const obs = { intentId: s.id, chainId: 84532, network: "base-sepolia", tokenContract: ALLOWLISTED_TOKENS[0].contract, tokenSymbol: "USDC", txHash: "0x" + "5e".repeat(32), toAddress: getAdapter("prv_tidewater")!.expectedWallet!(i), amountMinor: ws.quotes.find((q) => q.id === i.selectedQuoteId)!.estimatedRecipientMinor, blockNumber: 50, confirmations: 3 };
    return { ws, id: s.id, obs };
  };
  it("scripted: chain pending or final, then payout.failed (T-1), then a person resolves", () => {
    for (const confirmations of [0, 3, 12]) {
      let { ws, id, obs } = usdc();
      ws = act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, confirmations } }, `T-1 obs ${confirmations}`);
      ws = act(ws, "usr_maya", hook(ws, id, "payout.failed", 9), `T-1 failed ${confirmations}`);
      resolveAll(ws, id, `T-1 ${confirmations}`);
    }
  });
  it("scripted: final + matched, then a reorg (fewer confirmations or another block), then a person resolves and finality returns", () => {
    for (const reorg of [{ confirmations: 2 }, { blockNumber: 53, confirmations: 15 }]) {
      let { ws, id, obs } = usdc();
      const ins = ws.instructions.find((x) => x.id === intentOf(ws, id).instructionId)!;
      ws = act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, confirmations: 12 } }, "C-3 final");
      const rawBody = JSON.stringify({ id: `${ins.providerPaymentId}-S9`, type: "payout.completed", provider_payment_id: ins.providerPaymentId, sequence: 9, occurred_at: ws.asOf, tx_hash: obs.txHash });
      ws = act(ws, "usr_maya", { type: "ingest_webhook", delivery: { providerId: ins.providerId, rawBody, signatureHeader: getAdapter(ins.providerId)!.signWebhook(rawBody, Math.floor(Date.parse(ws.asOf) / 1000)) } }, "C-3 completed with hash");
      expect(intentOf(ws, id).status.reconciliation).toBe("matched");
      ws = act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, ...reorg } }, "C-3 reorg");
      ws = resolveAll(ws, id, "C-3");
      act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, ...reorg, confirmations: 30 } }, "C-3 final again");
    }
  });
  it("scripted: unsupported or other-chain record first, then the same hash as USDC (conflict), then a person resolves and it counts", () => {
    for (const wrong of [{ tokenSymbol: "USDT", tokenContract: "0x" + "97".repeat(20) }, { chainId: 1, network: "ethereum" }]) {
      let { ws, id, obs } = usdc();
      ws = act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, ...wrong, confirmations: 20 } }, "B unsupported first");
      ws = act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, confirmations: 20 } }, "B conflict");
      ws = resolveAll(ws, id, "B");
      ws = act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, confirmations: 20 } }, "B counted after supersede");
      // R3-B1: reopen the resolved conflict (withdraws the supersede), then resolve it again
      const conflict = ws.exceptions.find((e) => e.intentId === id && (e.explanationCode === "CH_TX_HASH_CONFLICT" || e.explanationCode === "CH_TX_HASH_ON_OTHER_CHAIN"))!;
      ws = act(ws, "usr_daniel", { type: "reopen", target: { kind: "exception", id: conflict.id }, reason: "Reopened (fictional)" }, "B reopen");
      ws = act(ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...obs, confirmations: 25 } }, "B observation while reopened");
      resolveAll(ws, id, "B again");
      // the reverse order (valid first, unsupported later) is an ordinary rc3 state too
      let v = usdc();
      v.ws = act(v.ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...v.obs, confirmations: 20 } }, "B' valid first");
      act(v.ws, "usr_maya", { type: "ingest_chain_observation", observation: { ...v.obs, ...wrong, confirmations: 20 } }, "B' unsupported later");
    }
  });
  it("scripted: bank debit then failed / returned / cancelled, either order, then a person resolves", () => {
    for (const end of ["payout.failed", "payout.returned"]) for (const debitFirst of [true, false]) {
      let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
      ws = act(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, "bank in_transit");
      const debit = { type: "ingest_statement_line" as const, line: debitLine({ reference: `PAYOUT ${ppid}`, valueDate: "2026-11-13" }) };
      if (debitFirst) ws = act(ws, "usr_maya", debit, `${end} debit first`);
      ws = act(ws, "usr_maya", hook(ws, id, end, 9), `${end}`);
      if (!debitFirst) ws = act(ws, "usr_maya", debit, `${end} debit after`);
      ws = resolveAll(ws, id, `${end} ${debitFirst}`);
      // close the case where the rules allow it, then reopen it (R3-B1: reopen paths stay loadable)
      const caseId = intentOf(ws, id).caseId;
      if (caseId) {
        ws = act(ws, "usr_maya", { type: "assign_owner", target: { kind: "case", id: caseId }, ownerId: "usr_maya" }, "case owner");
        const closed = applyAction(ws, { type: "resolve", target: { kind: "case", id: caseId }, note: "Closed" }, { actorId: "usr_maya", at: ws.asOf });
        if (closed.ok) {
          noop(closed.value.workspace, `${end} case closed`);
          act(closed.value.workspace, "usr_daniel", { type: "reopen", target: { kind: "case", id: caseId }, reason: "Reopened (fictional)" }, `${end} case reopened`);
        }
      }
    }
  });

  it("scripted: over-amount and late bank debits on a completed payout, accepted or plainly resolved", () => {
    for (const line of [{ amountMinor: 1_000_050 }, { amountMinor: 1_150_000 }, { valueDate: "2026-11-30" }]) for (const accept of [true, false]) {
      let { ws, id, ppid } = submitted({ amountMinor: 1_000_000 }, "prv_northline", sampleWorkspace());
      ws = act(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, "in_transit");
      ws = act(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, "completed");
      ws = act(ws, "usr_maya", { type: "ingest_statement_line", line: debitLine({ reference: `PAYOUT ${ppid}`, valueDate: "2026-11-13", ...line }) }, "disagreeing debit");
      const e = ws.exceptions.filter((x) => x.intentId === id && x.statementLineId).at(-1)!;
      ws = act(ws, "usr_maya", { type: "assign_owner", target: { kind: "exception", id: e.id }, ownerId: "usr_maya" }, "owner");
      ws = act(ws, "usr_maya", { type: "attach_evidence", target: { kind: "exception", id: e.id }, evidence: { kind: "document_metadata", description: "Bank advice (fictional)" } }, "evidence");
      const late = "valueDate" in line;
      const r = applyAction(ws, { type: "resolve", target: { kind: "exception", id: e.id }, note: "Reviewed", ...(accept && !late ? { acceptDifference: true } : {}), ...(accept && late ? { acceptLateDate: true } : {}) }, { actorId: "usr_maya", at: ws.asOf });
      if (!r.ok) throw new Error(`resolve ${JSON.stringify(line)}: ${r.error.message}`);
      noop(r.value.workspace, `resolve ${JSON.stringify(line)} accept=${accept}`);
      let after = r.value.workspace;
      if (after.exceptions.find((x) => x.id === e.id)!.resolution!.acceptedDifference?.secondApproval)
        after = act(after, "usr_sam", { type: "approve_acceptance", exceptionId: e.id, note: "Bank tariff checked (fictional)" }, "second approval");
      // R3-B1: reopening must leave a workspace that loads unchanged
      act(after, "usr_daniel", { type: "reopen", target: { kind: "exception", id: e.id }, reason: "Reopened (fictional)" }, `reopen ${JSON.stringify(line)} accept=${accept}`);
    }
  });

  it("scripted: the full lifecycle (create → quote → route → approve → submit → provider events) from the sample and from a migrated v2 workspace", () => {
    for (const base of [sampleWorkspace(), start(3)]) {
      let ws = base;
      const n = ws.seq;
      const created = applyAction(ws, { type: "create_intent", input: { internalReference: `INV-LIFE-${n}`, amountMinor: 75_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-LIFE-01", beneficiaryName: "Life Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-12-20", idempotencyKey: `life-${n}` } }, { actorId: "usr_maya", at: ws.asOf });
      if (!created.ok) throw new Error(created.error.message);
      ws = created.value.workspace;
      noop(ws, "created");
      const id = created.value.createdIds[0];
      ws = act(ws, "usr_maya", { type: "request_quotes", intentId: id }, "quotes");
      const q = ws.quotes.find((x) => x.intentId === id && x.providerId === "prv_northline" && x.eligible)!;
      const routed = applyAction(ws, { type: "choose_route", intentId: id, quoteId: q.id }, { actorId: "usr_maya", at: ws.asOf });
      if (!routed.ok) throw new Error(routed.error.message);
      ws = routed.value.workspace;
      noop(ws, "routed");
      const ins = routed.value.createdIds[0];
      ws = act(ws, "usr_daniel", { type: "approve_instruction", instructionId: ins }, "approved");
      ws = act(ws, "usr_maya", { type: "submit_instruction", instructionId: ins }, "submitted");
      KINDS.set("submit_instruction", (KINDS.get("submit_instruction") ?? 0) + 1);
      ws = act(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, "in_transit");
      act(ws, "usr_maya", { type: "simulate_provider_event", intentId: id }, "completed");
    }
  });
  it("the sequences really reached the states the migration rules are about (the property is not vacuous)", () => {
    const wanted = ["acceptance withdrawn on reopen", "supersede withdrawn on reopen", "reopened exception", "reopened case", "cancelled payment", "advance decided", "info requested", "second approval", "terminal payout with chain evidence", "terminal payout with a bank debit", "final chain transfer", "rejected observation", "CH_CONFIRMATIONS_DECREASED", "CH_TRANSFER_FOR_TERMINAL_PAYOUT", "RC_DEBIT_FOR_FAILED_PAYOUT", "RC_OVERPAYMENT", "RC_OUTSIDE_TIME_WINDOW", "resolved exception"];
    expect(wanted.filter((x) => !seen.has(x))).toEqual([]);
    // R4-m1: the random walk itself applied these successfully (not only the scripted tests)
    const kinds = ["submit_instruction", "approve_instruction", "choose_route", "request_quotes", "approve_acceptance", "assign_hold_reviewer", "reopen", "cancel_intent", "decide_advance", "request_info", "resolve+diff", "resolve+late"];
    expect(kinds.filter((k) => !RANDOM_KINDS.has(k))).toEqual([]);
  });
});
