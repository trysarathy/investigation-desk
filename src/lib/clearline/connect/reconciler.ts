/**
 * rc4 Connect — webhook intake and the polling reconciler (simulated; no network).
 *
 * Both feed the engine's ONE event path (`ingest_webhook` / `poll_provider` → ingestPayload), so a
 * status learned by polling is processed exactly like the same status learned by webhook.
 *
 * - `receiveConnectWebhook`: verifies the raw body first. Verified or invalid → the engine records it
 *   (an invalid one as rejected, never applied). Unverified (no scheme, or one this sandbox cannot
 *   check) → NOT applied: Clearline polls the provider's status API to confirm instead.
 * - `reconcileConnect`: for every unresolved Connect payout, polls `fetchStatus`; or, with
 *   `mode: "list_since"`, reads each provider's change feed since a cursor and feeds every listed
 *   version in provider order. An unchanged snapshot (same bytes already recorded) is skipped.
 */
import { applyAction } from "../actions";
import { getAdapter } from "../adapters";
import { sha256Hex } from "../sha256";
import type { ActionContext, EngineError, Result, Workspace } from "../types";
import type { ConnectAdapter } from "./adapter";
import { CONNECT_DESCRIPTORS, getDescriptor } from "./descriptors";
import { parseProviderBody } from "./normalize";
import { listSince } from "./simulator";
import type { AdapterDescriptor, ConnectVerification } from "./types";
import { canonicalHeaderValue, encodeHeaderBundle } from "./verify";

/** Payout executions a reconciler keeps polling (a completed payout can still regress). */
export const UNRESOLVED_EXECUTION: readonly string[] = ["submitted", "in_transit", "awaiting_information", "on_hold", "provider_reported_completed"];

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function unresolvedConnectIntents(ws: Workspace): string[] {
  return ws.intents
    .filter((i) => UNRESOLVED_EXECUTION.includes(i.status.execution))
    .filter((i) => {
      const instr = ws.instructions.find((x) => x.id === i.instructionId);
      return Boolean(instr?.providerPaymentId && getDescriptor(instr.providerId));
    })
    .map((i) => i.id);
}

export interface ConnectReceipt {
  workspace: Workspace;
  verification: ConnectVerification;
  action: "ingested" | "rejected_recorded" | "polled_to_confirm" | "unverified_unknown_payment";
  outcome: string;
  intentId?: string;
}

export function receiveConnectWebhook(ws: Workspace, delivery: { providerId: string; rawBody: string; headers: Record<string, string> }, ctx: ActionContext): Result<ConnectReceipt> {
  const d = getDescriptor(delivery?.providerId);
  if (!d) return { ok: false, error: { code: "not_found", message: "Unknown Connect provider.", field: "providerId" } };
  const adapter = getAdapter(d.providerId) as ConnectAdapter;
  // Review M-4: only the headers the provider's declared schemes read go into the bundle (a real request
  // carries many more), and the receipt is taken from what the ENGINE recorded, not from this pre-check.
  const declared = declaredHeaders(d);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(delivery.headers ?? {})) if (typeof v === "string" && declared.includes(k.toLowerCase())) headers[k.toLowerCase()] = canonicalHeaderValue(d.verification, k, v);
  const verification = adapter.verifyConnect(delivery.rawBody, headers, unix(ctx.at));
  if (verification.status !== "unverified") {
    const r = applyAction(ws, { type: "ingest_webhook", delivery: { providerId: d.providerId, rawBody: delivery.rawBody, signatureHeader: encodeHeaderBundle(headers) } }, ctx);
    if (!r.ok) return r;
    const ev = r.value.workspace.providerEvents.at(-1);
    return { ok: true, value: { workspace: r.value.workspace, verification, action: r.value.outcome === "rejected_signature" ? "rejected_recorded" : "ingested", outcome: r.value.outcome, intentId: ev?.intentId } };
  }
  // Unverified: never a fact. Find the payout it names (if any) and ask the provider directly.
  const claim = parseProviderBody(d, delivery.rawBody);
  const instr = claim.ok ? ws.instructions.find((i) => i.providerId === d.providerId && i.providerPaymentId === claim.value.ref) : undefined;
  if (!instr) return { ok: true, value: { workspace: ws, verification, action: "unverified_unknown_payment", outcome: "not_applied" } };
  const r = applyAction(ws, { type: "poll_provider", intentId: instr.intentId }, ctx);
  if (!r.ok) return r;
  return { ok: true, value: { workspace: r.value.workspace, verification, action: "polled_to_confirm", outcome: r.value.outcome, intentId: instr.intentId } };
}

export interface PollResult {
  intentId: string;
  providerId: string;
  version?: number;
  outcome: string;
  error?: EngineError;
}

/**
 * True when this exact snapshot (same bytes) is already recorded for the payout. Review L-1: a copy that was
 * suppressed during a hold does not count once the hold has ended (the engine re-applies its redelivery).
 */
function alreadyRecorded(ws: Workspace, intentId: string, rawBody: string): boolean {
  const h = sha256Hex(rawBody);
  const onHold = ws.intents.find((i) => i.id === intentId)?.status.execution === "on_hold";
  return ws.providerEvents.some((e) => e.intentId === intentId && e.payloadHash === h && e.processingOutcome !== "rejected_signature" && (onHold || !e.detail.suppressedOnHold));
}

/** Lower-case header names the provider's declared verification schemes read. */
export const declaredHeaders = (d: AdapterDescriptor): string[] =>
  d.verification.flatMap((s) => [s.signatureHeader, s.timestampHeader]).filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase());

function pollOne(ws: Workspace, ctx: ActionContext, intentId: string, version: number | undefined, out: PollResult[]): Workspace {
  const intent = ws.intents.find((i) => i.id === intentId)!;
  const instr = ws.instructions.find((i) => i.id === intent.instructionId)!;
  const adapter = getAdapter(instr.providerId)!;
  // rc5 conformance fix: a provider call that throws (timeout, transport error) is reported for this payout only;
  // the state is unchanged and the other payouts are still polled (CONNECT_ADAPTERS.md §7).
  let snap: ReturnType<NonNullable<typeof adapter.fetchStatus>>;
  try {
    snap = adapter.fetchStatus!(ws, intent, instr, ctx.at, version);
  } catch (e) {
    out.push({ intentId, providerId: instr.providerId, version, outcome: "error", error: { code: "precondition_failed", message: `Provider status call failed (provider unavailable): ${e instanceof Error ? e.message : "unknown error"}` } as EngineError });
    return ws;
  }
  if (snap.kind === "none") {
    out.push({ intentId, providerId: instr.providerId, version, outcome: "no_event_pending" });
    return ws;
  }
  if (alreadyRecorded(ws, intentId, snap.rawBody)) {
    out.push({ intentId, providerId: instr.providerId, version: snap.version, outcome: "unchanged" });
    return ws;
  }
  const r = applyAction(ws, { type: "poll_provider", intentId, ...(version !== undefined ? { version } : {}) }, ctx);
  if (!r.ok) {
    out.push({ intentId, providerId: instr.providerId, version: snap.version, outcome: "error", error: r.error });
    return ws;
  }
  out.push({ intentId, providerId: instr.providerId, version: snap.version, outcome: r.value.outcome });
  return r.value.workspace;
}

/**
 * One reconciler pass. `fetch_status` (default): every unresolved Connect payout, latest status.
 * `list_since`: each provider's change feed from `cursors[providerId]` (providers without a feed
 * fall back to fetch_status). Errors on one payout never stop the others; they are reported.
 */
export function reconcileConnect(
  ws: Workspace,
  ctx: ActionContext,
  opts: { mode?: "fetch_status" | "list_since"; cursors?: Record<string, string> } = {},
): { workspace: Workspace; results: PollResult[]; cursors: Record<string, string> } {
  const results: PollResult[] = [];
  const cursors: Record<string, string> = { ...(opts.cursors ?? {}) };
  let w = ws;
  if (opts.mode === "list_since") {
    const viaFetch = new Set<string>();
    for (const d of CONNECT_DESCRIPTORS) {
      const feed = listSince(w, d.providerId, cursors[d.providerId], ctx.at);
      if (!feed.supported) {
        for (const id of unresolvedConnectIntents(w)) if (w.instructions.some((i) => i.intentId === id && i.providerId === d.providerId)) viaFetch.add(id);
        continue;
      }
      for (const c of feed.changes) w = pollOne(w, ctx, c.intentId, c.version, results);
      cursors[d.providerId] = feed.nextCursor;
    }
    for (const id of viaFetch) w = pollOne(w, ctx, id, undefined, results);
    return { workspace: w, results, cursors };
  }
  for (const id of unresolvedConnectIntents(ws)) w = pollOne(w, ctx, id, undefined, results);
  return { workspace: w, results, cursors };
}
