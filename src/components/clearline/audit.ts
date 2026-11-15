/**
 * Audit history helpers (founder journey step 17). The engine's audit trail (`ws.audit`) is the only source:
 * this module only works out which payment each event concerns and which record ids an event names, so the
 * console can filter by payment and link the evidence. Nothing here creates, edits or hides an audit event.
 */
import type { AuditEvent, Workspace } from "@/lib/clearline";

/** Record ids the engine writes into audit events (entity ids and ids quoted in summaries). */
const PREFIXES = "pi|qt|ins|pev|evd|stl|alc|exc|case|hold|chn|adv|fdc|obl|rpa|jp|acx|per";
export const RECORD_ID_RE = new RegExp(`\\b(?:${PREFIXES})_\\d{3,}\\b`, "g");
const IS_RECORD_ID = new RegExp(`^(?:${PREFIXES})_\\d{3,}$`);

/** Every record id in the workspace that belongs to one payment, mapped to that payment's id. */
export function paymentOfRecords(ws: Workspace): Map<string, string> {
  const m = new Map<string, string>();
  const put = (id: string | undefined, intentId: string | undefined) => { if (id && intentId && !m.has(id)) m.set(id, intentId); };
  for (const i of ws.intents) put(i.id, i.id);
  for (const q of ws.quotes) put(q.id, q.intentId);
  for (const x of ws.instructions) put(x.id, x.intentId);
  for (const e of ws.providerEvents) put(e.id, e.intentId);
  for (const h of ws.holds) put(h.id, h.intentId);
  for (const c of ws.chainObservations) put(c.id, c.intentId);
  for (const a of ws.advances) put(a.id, a.intentId);
  const advIntent = new Map(ws.advances.map((a) => [a.id, a.intentId]));
  for (const d of ws.fundingDecisions) put(d.id, advIntent.get(d.advanceId));
  for (const o of ws.obligations) put(o.id, advIntent.get(o.advanceId));
  const oblIntent = new Map(ws.obligations.map((o) => [o.id, advIntent.get(o.advanceId)]));
  for (const a of ws.allocations) {
    const intent = a.target.kind === "payment" ? a.target.intentId : oblIntent.get(a.target.obligationId);
    put(a.id, intent);
    put(a.statementLineId, intent);
  }
  for (const r of ws.repaymentAllocations) { put(r.id, oblIntent.get(r.obligationId)); put(r.statementLineId, oblIntent.get(r.obligationId)); }
  for (const c of ws.cases) put(c.id, c.intentId ?? (c.advanceId ? advIntent.get(c.advanceId) : undefined));
  for (const e of ws.exceptions) put(e.id, e.intentId ?? (e.advanceId ? advIntent.get(e.advanceId) : e.obligationId ? oblIntent.get(e.obligationId) : undefined));
  for (const e of ws.evidence) put(e.id, e.intentId ?? (e.advanceId ? advIntent.get(e.advanceId) : undefined));
  for (const p of ws.accounting?.proposals ?? []) put(p.id, p.intentId ?? (p.advanceId ? advIntent.get(p.advanceId) : undefined));
  return m;
}

/** The record ids an audit event names: its entity id first, then the ids quoted in its summary. */
export function referencesOf(a: AuditEvent): string[] {
  const ids = [a.entityId, ...(a.summary.match(RECORD_ID_RE) ?? [])];
  return [...new Set(ids.filter((x) => IS_RECORD_ID.test(x)))];
}

/** The payments an audit event concerns (through its entity or any record it names). */
export function paymentsOf(a: AuditEvent, owners: Map<string, string>): string[] {
  return [...new Set(referencesOf(a).map((id) => owners.get(id)).filter((x): x is string => !!x))];
}

/** Where a record id opens in the console, when it has a page. */
export function hrefOfRecord(id: string, owners: Map<string, string>): string | undefined {
  const intent = owners.get(id);
  const [prefix] = id.split("_");
  switch (prefix) {
    case "pi": return `/clearline/payments/${id}`;
    case "stl": return `/clearline/reconciliation#${id}`;
    case "exc": return `/clearline/exceptions?view=all#${id}`;
    case "case": return intent ? `/clearline/payments/${intent}#case` : "/clearline/investigations";
    case "hold": return `/clearline/holds#${id}`;
    case "chn": return intent ? `/clearline/payments/${intent}#chain` : undefined;
    case "adv": case "obl": case "rpa": case "fdc": return "/clearline/treasury/funding";
    case "jp": return `/clearline/accounting#${id}`;
    case "acx": return `/clearline/accounting/exports#${id}`;
    case "per": return `/clearline/accounting/setup#${id}`;
    default: return intent ? `/clearline/payments/${intent}#timeline` : undefined;
  }
}
