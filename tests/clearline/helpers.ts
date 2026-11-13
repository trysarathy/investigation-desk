import { applyAction, emptyWorkspace, getAdapter, type ActionResult, type CreateIntentInput, type Workspace, type WorkspaceAction } from "@/lib/clearline";

export function attempt(ws: Workspace, actorId: string, action: WorkspaceAction, at?: string): ActionResult {
  return applyAction(ws, action, { actorId, at: at ?? ws.asOf });
}
export function run(ws: Workspace, actorId: string, action: WorkspaceAction, at?: string) {
  const r = attempt(ws, actorId, action, at);
  if (!r.ok) throw new Error(`${action.type}: ${r.error.code} ${r.error.message}`);
  return r.value;
}
export function errorCode(r: ActionResult) {
  return r.ok ? "ok" : r.error.code;
}
let n = 0;
export const baseInput = (o: Partial<CreateIntentInput> = {}): CreateIntentInput => ({
  internalReference: `INV-T-${++n}`,
  amountMinor: 1_000_000,
  sourceCurrency: "SGD",
  destinationCurrency: "PHP",
  purpose: "Supplier invoice",
  beneficiaryRef: "BEN-TEST-01",
  beneficiaryName: "Test Supplier (fictional)",
  destinationCountry: "PH",
  requestedExecutionDate: "2026-11-20",
  idempotencyKey: `test-key-${n}-${Math.abs(o.amountMinor ?? 0)}`,
  ...o,
});
export function created(o: Partial<CreateIntentInput> = {}, ws: Workspace = emptyWorkspace()) {
  const r = run(ws, "usr_maya", { type: "create_intent", input: baseInput(o) });
  return { ws: r.workspace, id: r.createdIds[0] };
}
export function approved(o: Partial<CreateIntentInput> = {}, providerId = "prv_northline", ws0?: Workspace) {
  let { ws, id } = created(o, ws0);
  ws = run(ws, "usr_maya", { type: "request_quotes", intentId: id }).workspace;
  const q = ws.quotes.find((x) => x.intentId === id && x.providerId === providerId && x.eligible)!;
  const c = run(ws, "usr_maya", { type: "choose_route", intentId: id, quoteId: q.id });
  ws = run(c.workspace, "usr_daniel", { type: "approve_instruction", instructionId: c.createdIds[0] }).workspace;
  return { ws, id, instructionId: c.createdIds[0] };
}
export function submitted(o: Partial<CreateIntentInput> = {}, providerId = "prv_northline", ws0?: Workspace) {
  const a = approved(o, providerId, ws0);
  const ws = run(a.ws, "usr_maya", { type: "submit_instruction", instructionId: a.instructionId }).workspace;
  const ppid = ws.instructions.find((i) => i.id === a.instructionId)!.providerPaymentId!;
  return { ws, id: a.id, instructionId: a.instructionId, ppid };
}
export const sim = (ws: Workspace, intentId: string, injection: "none" | "timeout" | "duplicate" | "out_of_order" | "contradictory" | "bad_signature" = "none") =>
  run(ws, "usr_maya", { type: "simulate_provider_event", intentId, injection });
export const intent = (ws: Workspace, id: string) => ws.intents.find((i) => i.id === id)!;
export const later = (ws: Workspace, minutes: number) => new Date(Date.parse(ws.asOf) + minutes * 60000).toISOString();

export function signedDelivery(ws: Workspace, providerId: string, payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload);
  const signatureHeader = getAdapter(providerId)!.signWebhook(rawBody, Math.floor(Date.parse(ws.asOf) / 1000));
  return { providerId, rawBody, signatureHeader };
}
export const debitLine = (o: Record<string, unknown> = {}) => ({
  lineId: `L-${++n}`, source: "bank_statement" as const, accountRef: "BANK-SGD-TEST", direction: "debit" as const, kind: "payment" as const,
  amountMinor: 1_000_000, currency: "SGD" as const, reference: "", counterparty: "Northline Payments (sandbox)", valueDate: "2026-11-13", ...o,
});
