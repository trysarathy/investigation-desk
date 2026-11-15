/**
 * rc4 Connect — deterministic simulator of each FICTIONAL provider's own side (no network).
 *
 * The provider's truth about a payout is a script of versions, each taking effect a fixed number of
 * minutes after submission. From that truth the simulator produces exactly what the provider would
 * send: the status-API snapshot (`fetchStatus`), the change feed (`listSince`) and signed webhooks.
 * A webhook body and a poll snapshot of the same version describe the same object; for providers
 * that dedupe by object version they are byte-identical.
 */
import { sha256Hex } from "../sha256";
import type { PaymentInstruction, PaymentIntent, WebhookDelivery, Workspace } from "../types";
import { CONNECT_SCRIPTS, connectKeyring, getDescriptor, type ScriptEntry } from "./descriptors";
import { providerIdempotencyKey } from "./idempotency";
import { findMapping } from "./normalize";
import type { AdapterDescriptor, SigningKey } from "./types";
import { encodeHeaderBundle, signDelivery } from "./verify";

export interface TruthVersion {
  version: number;
  at: string;
  entry: ScriptEntry;
}

/** Same derivation as the original sandbox adapters, so Clearline's own chain observation can name it. */
export const syntheticFinalTxHash = (ref: string) => "0x" + sha256Hex("synthetic-tx:" + ref);
/** A different hash: the provider's preliminary one (it may change before the transfer is final). */
export const syntheticPreliminaryTxHash = (ref: string) => "0x" + sha256Hex("preliminary-tx:" + ref);

const RAW_REASON: Record<string, string> = {
  beneficiary_account_invalid: "acct_invalid",
  validation_failed: "bad_request",
  compliance_review: "review",
  provider_unavailable: "network_drop",
};

export function providerScript(d: AdapterDescriptor, intent: PaymentIntent): readonly ScriptEntry[] {
  const scripts = CONNECT_SCRIPTS[d.providerId] ?? {};
  const named = intent.metadata?.connect_script;
  return (named !== undefined && Object.prototype.hasOwnProperty.call(scripts, named) ? scripts[named] : undefined) ?? scripts[intent.sandboxOutcome] ?? scripts.success ?? [];
}

/** Every version the provider will ever hold for this payout (some may still be in the future). */
export function providerTruth(d: AdapterDescriptor, intent: PaymentIntent, instr: PaymentInstruction): TruthVersion[] {
  const from = Date.parse(instr.submittedAt ?? "");
  if (!instr.providerPaymentId || !Number.isFinite(from)) return [];
  return providerScript(d, intent).map((entry, i) => ({ version: i + 1, at: new Date(from + entry.afterMinutes * 60_000).toISOString(), entry }));
}

/** The provider object for one version, as its status API returns it (canonical field order). */
export function snapshotObject(d: AdapterDescriptor, intent: PaymentIntent, instr: PaymentInstruction, v: TruthVersion): Record<string, unknown> {
  const s = d.shape;
  const ref = instr.providerPaymentId!;
  const m = findMapping(d, v.entry.status, v.entry.subStatus);
  const o: Record<string, unknown> = { [s.ref]: ref };
  if (s.version) o[s.version] = v.version;
  o[s.status] = v.entry.status;
  if (s.subStatus && v.entry.subStatus !== undefined) o[s.subStatus] = v.entry.subStatus;
  if (s.addendum && v.entry.addendum !== undefined) o[s.addendum] = v.entry.addendum;
  if (s.reason && m?.reason) o[s.reason] = RAW_REASON[m.reason] ?? m.reason;
  o[s.amount] = instr.amountMinor;
  o[s.currency] = instr.currency;
  if (s.txHash && v.entry.txHash) o[s.txHash] = v.entry.txHash === "final" ? syntheticFinalTxHash(ref) : syntheticPreliminaryTxHash(ref);
  o[s.occurredAt] = v.at;
  // Every version echoes the provider idempotency key Clearline sent (kept verbatim in rawBody).
  o.idempotency_key = providerIdempotencyKey(d, intent.idempotencyKey, instr.id);
  return o;
}

export const eventIdFor = (d: AdapterDescriptor, ref: string, version: number) => `evt_${sha256Hex(`${d.providerId}:${ref}:${version}`).slice(0, 20)}`;

/** The webhook body the provider sends for a version (an envelope with an event id, or the bare object). */
export function webhookBody(d: AdapterDescriptor, intent: PaymentIntent, instr: PaymentInstruction, v: TruthVersion): string {
  const obj = snapshotObject(d, intent, instr, v);
  if (!d.shape.objectField) return JSON.stringify(obj);
  return JSON.stringify({ [d.shape.eventIdField ?? "id"]: eventIdFor(d, instr.providerPaymentId!, v.version), type: "object.updated", [d.shape.objectField]: obj });
}

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function locate(ws: Workspace, intentId: string) {
  const intent = ws.intents.find((i) => i.id === intentId);
  const instr = intent ? ws.instructions.find((i) => i.id === intent.instructionId) : undefined;
  const d = instr ? getDescriptor(instr.providerId) : undefined;
  return intent && instr && d ? { intent, instr, d } : undefined;
}

/**
 * The signed webhook the fictional provider sends for one version, as a v1 WebhookDelivery whose
 * `signatureHeader` is the Connect header bundle. `signAt` defaults to the version's own time.
 */
export function providerWebhook(ws: Workspace, intentId: string, version: number, opts: { signAt?: string; keys?: SigningKey[]; headers?: Record<string, string> } = {}): WebhookDelivery & { headers: Record<string, string> } {
  const l = locate(ws, intentId);
  if (!l) throw new Error(`No Connect payout ${intentId}`);
  const v = providerTruth(l.d, l.intent, l.instr).find((x) => x.version === version);
  if (!v) throw new Error(`Provider has no version ${version} for ${intentId}`);
  const rawBody = webhookBody(l.d, l.intent, l.instr, v);
  const headers = opts.headers ?? signDelivery(l.d.verification[0], rawBody, opts.keys ?? connectKeyring(l.d.providerId), unix(opts.signAt ?? v.at));
  return { providerId: l.d.providerId, rawBody, signatureHeader: encodeHeaderBundle(headers), headers };
}

export type StatusSnapshot = { kind: "snapshot"; rawBody: string; version: number; at: string } | { kind: "none"; reason: string };

/** Simulated `fetchStatus(providerRef)`: the latest version at `at` (or one listed version that exists by then). */
export function fetchStatusSnapshot(d: AdapterDescriptor, intent: PaymentIntent, instr: PaymentInstruction, at: string, version?: number): StatusSnapshot {
  if (!instr.providerPaymentId) return { kind: "none", reason: "Instruction not submitted to the provider." };
  const known = providerTruth(d, intent, instr).filter((v) => Date.parse(v.at) <= Date.parse(at));
  const v = version === undefined ? known.at(-1) : known.find((x) => x.version === version);
  if (!v) return { kind: "none", reason: version === undefined ? "The provider has no status for this payout yet." : `The provider has no version ${version} for this payout at ${at}.` };
  return { kind: "snapshot", rawBody: JSON.stringify(snapshotObject(d, intent, instr, v)), version: v.version, at: v.at };
}

export interface FeedChange {
  intentId: string;
  ref: string;
  version: number;
  at: string;
}

/**
 * Simulated `listSince(cursor)`: every version of every payout at this provider that took effect in
 * (cursor, at], in provider order (time, then reference, then version). The cursor is an ISO instant.
 */
export function listSince(ws: Workspace, providerId: string, cursor: string | undefined, at: string): { supported: boolean; changes: FeedChange[]; nextCursor: string } {
  const d = getDescriptor(providerId);
  if (!d || !d.polling.listSince) return { supported: false, changes: [], nextCursor: cursor ?? "" };
  const lo = cursor ? Date.parse(cursor) : -Infinity;
  const hi = Date.parse(at);
  const changes: FeedChange[] = [];
  for (const instr of ws.instructions) {
    if (instr.providerId !== providerId || !instr.providerPaymentId) continue;
    const intent = ws.intents.find((i) => i.id === instr.intentId);
    if (!intent) continue;
    for (const v of providerTruth(d, intent, instr)) {
      const t = Date.parse(v.at);
      if (t > lo && t <= hi) changes.push({ intentId: intent.id, ref: instr.providerPaymentId, version: v.version, at: v.at });
    }
  }
  changes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0) || a.version - b.version);
  return { supported: true, changes, nextCursor: new Date(hi).toISOString() };
}
