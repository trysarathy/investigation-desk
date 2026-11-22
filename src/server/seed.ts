import {
  applyAction, sampleWorkspace, sandboxWebhookSecret, signSandboxWebhook,
  type Workspace, type WorkspaceAction,
} from "@/lib/clearline";

/**
 * FICTIONAL pilot seed. The engine's sample workspace plus the mandatory Redwood Supplies acceptance case, built
 * only through engine actions (no record is written by hand):
 *
 *   USD 12,784.90 to Redwood Supplies Ltd (fictional). The provider reports the payout COMPLETED, the bank statement
 *   shows the outgoing debit, then the provider reports it RETURNED (beneficiary account invalid) and the statement
 *   shows the return credit. Expected: execution returned (after a reported completion), settlement never verified,
 *   net movement 0.00, supplier still unpaid, an open returned-payout exception.
 */
export const REDWOOD_REFERENCE = "INV-2026-188";

export function pilotSeedWorkspace(): Workspace {
  let ws = sampleWorkspace();
  let t = Date.parse(ws.asOf);
  const run = (actorId: string, action: WorkspaceAction) => {
    t += 3 * 60_000;
    const r = applyAction(ws, action, { actorId, at: new Date(t).toISOString() });
    if (!r.ok) throw new Error(`seed ${action.type}: ${r.error.code} ${r.error.message}`);
    ws = r.value.workspace;
    return r.value.createdIds;
  };
  const [id] = run("usr_maya", { type: "create_intent", input: {
    internalReference: REDWOOD_REFERENCE, amountMinor: 1_278_490, sourceCurrency: "USD", destinationCurrency: "USD",
    beneficiaryRef: "BEN-REDWOOD-09", beneficiaryName: "Redwood Supplies Ltd (fictional)", destinationCountry: "SG",
    purpose: "Supplier invoice", requestedExecutionDate: ws.asOf.slice(0, 10), idempotencyKey: "pilot-redwood-0001",
  } });
  run("usr_maya", { type: "request_quotes", intentId: id });
  const quote = ws.quotes.find((q) => q.intentId === id && q.providerId === "prv_northline" && q.eligible);
  if (!quote) throw new Error("seed: no eligible Northline quote for the Redwood payment");
  const [ins] = run("usr_maya", { type: "choose_route", intentId: id, quoteId: quote.id });
  run("usr_daniel", { type: "approve_instruction", instructionId: ins });
  run("usr_maya", { type: "submit_instruction", instructionId: ins });
  run("usr_maya", { type: "simulate_provider_event", intentId: id }); // in transit
  run("usr_maya", { type: "simulate_provider_event", intentId: id }); // provider reports completed
  const ppid = ws.instructions.find((x) => x.id === ins)!.providerPaymentId!;
  run("usr_maya", { type: "ingest_statement_line", line: { lineId: "SIMBANK-0188", source: "bank_statement", accountRef: "BANK-USD-OPS (fictional)", direction: "debit", kind: "payment", amountMinor: 1_278_490, currency: "USD", reference: `NORTHLINE PAYOUT ${ppid}`, counterparty: "Northline Payments (sandbox)", valueDate: ws.asOf.slice(0, 10) } });
  // the provider later reports the payout returned: a signed (sandbox test key) webhook, verified by the engine
  const seq = ws.providerEvents.filter((e) => e.intentId === id).length + 1;
  const body = JSON.stringify({ id: `${ppid}-E${seq}`, provider_payment_id: ppid, sequence: seq, occurred_at: new Date(t + 60_000).toISOString(), type: "payout.returned", amount_minor: 1_278_490, currency: "USD", reason: "beneficiary_account_invalid" });
  const unix = Math.floor((t + 120_000) / 1000);
  run("usr_maya", { type: "ingest_webhook", delivery: { providerId: "prv_northline", rawBody: body, signatureHeader: signSandboxWebhook(body, sandboxWebhookSecret("prv_northline"), unix) } });
  run("usr_maya", { type: "ingest_statement_line", line: { lineId: "SIMBANK-0189", source: "bank_statement", accountRef: "BANK-USD-OPS (fictional)", direction: "credit", kind: "return", amountMinor: 1_278_490, currency: "USD", reference: `RETURN ${ppid} ACCOUNT INVALID`, counterparty: "Northline Payments (sandbox)", valueDate: ws.asOf.slice(0, 10) } });
  return ws;
}
