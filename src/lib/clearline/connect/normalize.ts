/**
 * rc4 Connect — raw provider body → normalised claim → engine payload.
 *
 * Rules:
 * - The raw status, sub-status, addendum and reason are kept verbatim next to the claim.
 * - An unmapped raw status is REFUSED (typed error, nothing applied), never guessed.
 * - Ordering value: the provider's object version, or the adapter's raw rank for providers without one.
 *   Never arrival time.
 * - Dedupe key: the descriptor's declared key; the documented fallback when the body lacks it.
 * - A hash the status does not declare final is kept as `txHashPreliminary` and never reaches the
 *   engine's `tx_hash` (so it is never chain evidence and never allocates).
 */
import { isCurrency } from "../money";
import { sha256Hex } from "../sha256";
import { isIsoInstant } from "../tx";
import type { CurrencyCode, ProviderEvent, Result, SandboxWebhookPayload, Workspace } from "../types";
import type { AdapterDescriptor, NormalizedClaim, ProviderRawStatus, StatusMapping } from "./types";

const ID_RE = /^[A-Za-z0-9_\-]{1,64}$/;
const TOKEN_RE = /^[A-Za-z0-9_.\-]{1,40}$/;
const EVENT_ID_RE = /^[A-Za-z0-9_\-:.]{1,80}$/;

/** Mapping lookup: an exact (raw, sub-status) row first, then a "*" row. Undefined = unmapped. */
export function findMapping(d: AdapterDescriptor, status: string, subStatus: string | undefined): StatusMapping | undefined {
  return d.statuses.find((m) => m.raw === status && m.subStatus === subStatus) ?? d.statuses.find((m) => m.raw === status && m.subStatus === "*");
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function parseProviderBody(d: AdapterDescriptor, rawBody: string): Result<NormalizedClaim> {
  const bad = (message: string, field: string): Result<NormalizedClaim> => ({ ok: false, error: { code: "invalid_field", message: `${d.providerName}: ${message}`, field } });
  if (typeof rawBody !== "string") return bad("body must be a string.", "rawBody");
  let v: unknown;
  try {
    v = JSON.parse(rawBody);
  } catch {
    return bad("body is not JSON.", "rawBody");
  }
  if (!isObj(v)) return bad("body must be a JSON object.", "rawBody");
  const s = d.shape;
  // Webhook envelope (event id + object) or a bare object snapshot (a poll response).
  const enveloped = s.objectField !== undefined && isObj(v[s.objectField]);
  const obj: Obj = enveloped ? (v[s.objectField!] as Obj) : v;
  const eventId = s.eventIdField !== undefined ? v[s.eventIdField] : undefined;
  if (enveloped && (typeof eventId !== "string" || !EVENT_ID_RE.test(eventId))) return bad(`${s.eventIdField} must be a short identifier.`, s.eventIdField ?? "id");

  const ref = obj[s.ref];
  if (typeof ref !== "string" || !ID_RE.test(ref)) return bad(`${s.ref} must be a short identifier.`, s.ref);
  const status = obj[s.status];
  if (typeof status !== "string" || !TOKEN_RE.test(status)) return bad(`${s.status} must be a short status token.`, s.status);
  const sub = s.subStatus !== undefined ? obj[s.subStatus] : undefined;
  if (sub !== undefined && (typeof sub !== "string" || !TOKEN_RE.test(sub))) return bad(`${s.subStatus} must be a short status token.`, s.subStatus!);
  const addendum = s.addendum !== undefined ? obj[s.addendum] : undefined;
  if (addendum !== undefined && (typeof addendum !== "string" || addendum.length > 200 || /[<>]/.test(addendum))) return bad(`${s.addendum} must be short plain text.`, s.addendum!);
  const reasonCode = s.reason !== undefined ? obj[s.reason] : undefined;
  if (reasonCode !== undefined && (typeof reasonCode !== "string" || !TOKEN_RE.test(reasonCode))) return bad(`${s.reason} must be a short code.`, s.reason!);
  const amount = obj[s.amount];
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return bad(`${s.amount} must be a positive integer (minor units).`, s.amount);
  const currency = obj[s.currency];
  if (!isCurrency(currency)) return bad(`${s.currency} must be a supported currency.`, s.currency);
  const occurredAt = obj[s.occurredAt];
  if (!isIsoInstant(occurredAt)) return bad(`${s.occurredAt} must be an ISO-8601 instant.`, s.occurredAt);
  const version = s.version !== undefined ? obj[s.version] : undefined;
  if (d.ordering.kind === "object_version" && (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1))
    return bad(`${s.version ?? "version"} must be a positive integer (this provider orders by object version).`, s.version ?? "version");
  const hash = s.txHash !== undefined ? obj[s.txHash] : undefined;
  if (hash !== undefined && (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/.test(hash))) return bad(`${s.txHash} must be 0x + 64 lowercase hex.`, s.txHash!);

  const mapping = findMapping(d, status, sub as string | undefined);
  if (!mapping) return bad(`unmapped raw status "${status}${sub ? "/" + sub : ""}"; nothing was applied (the reviewed mapping table must be extended first).`, s.status);

  const objectVersion = typeof version === "number" ? version : undefined;
  const raw: ProviderRawStatus = {
    status,
    ...(sub !== undefined ? { subStatus: sub as string } : {}),
    ...(addendum !== undefined ? { addendum: addendum as string } : {}),
    ...(reasonCode !== undefined ? { reasonCode: reasonCode as string } : {}),
    rank: mapping.rank,
    claimConfidence: mapping.confidence,
    settlementClaim: mapping.settlementClaim,
    ...(objectVersion !== undefined ? { objectVersion } : {}),
    ...(typeof hash === "string" && mapping.txHash !== "final" ? { txHashPreliminary: hash } : {}),
  };

  let dedupeKey: string;
  let dedupeKeySource: NormalizedClaim["dedupeKeySource"] = "declared";
  const versionKey = objectVersion !== undefined ? `ver:${ref}:${objectVersion}` : undefined;
  if (d.dedupe.declared === "event_id" && typeof eventId === "string") dedupeKey = `evt:${eventId}`;
  else if (d.dedupe.declared === "object_version" && versionKey) dedupeKey = versionKey;
  else {
    dedupeKeySource = "fallback";
    const fb = d.dedupe.fallback;
    dedupeKey =
      fb === "object_version" && versionKey ? versionKey
        : fb === "object_status" ? `st:${ref}:${status}:${(sub as string | undefined) ?? ""}`
          : `hash:${sha256Hex(rawBody).slice(0, 32)}`;
  }

  return {
    ok: true,
    value: {
      providerId: d.providerId,
      ref,
      dedupeKey,
      dedupeKeySource,
      sequence: d.ordering.kind === "object_version" ? objectVersion! : mapping.rank,
      occurredAt: occurredAt as string,
      amountMinor: amount,
      currency: currency as CurrencyCode,
      mapping,
      raw,
      ...(typeof hash === "string" && mapping.txHash === "final" ? { txHash: hash } : {}),
    },
  };
}

/** The engine's payload for a claim. The preliminary hash is deliberately NOT `tx_hash`. */
export function toEnginePayload(c: NormalizedClaim): SandboxWebhookPayload {
  return {
    id: c.dedupeKey,
    type: c.mapping.event,
    provider_payment_id: c.ref,
    sequence: c.sequence,
    occurred_at: c.occurredAt,
    amount_minor: c.amountMinor,
    currency: c.currency,
    ...(c.mapping.reason ? { reason: c.mapping.reason } : {}),
    ...(c.txHash ? { tx_hash: c.txHash } : {}),
    raw: { ...c.raw },
  };
}

/** Flat ProviderEvent.detail fields for a raw status (events.ts copies these onto every Connect event). */
export function rawDetail(r: ProviderRawStatus): Record<string, string | number> {
  return {
    rawStatus: r.status,
    ...(r.subStatus !== undefined ? { rawSubStatus: r.subStatus } : {}),
    ...(r.addendum !== undefined ? { rawAddendum: r.addendum } : {}),
    ...(r.reasonCode !== undefined ? { rawReasonCode: r.reasonCode } : {}),
    rawRank: r.rank,
    claimConfidence: r.claimConfidence,
    settlementClaim: r.settlementClaim,
    ...(r.objectVersion !== undefined ? { objectVersion: r.objectVersion } : {}),
    ...(r.txHashPreliminary !== undefined ? { rawTxHashPreliminary: r.txHashPreliminary } : {}),
  };
}

/** Side states (hold / information request) are not progress, so they never take part in rank comparisons. */
const SIDE_STATES: readonly string[] = ["payout.on_hold", "payout.information_requested", "payout.hold_released"];

/**
 * Generic adapter-level regression rule: an event with a NEWER ordering value than an earlier
 * accepted event of the same payout, whose raw rank is LOWER, is a regression. Returns the earlier
 * event it regresses from, or undefined. Late (older) events are not regressions.
 */
export function findRawRegression(ws: Workspace, intentId: string, p: SandboxWebhookPayload): ProviderEvent | undefined {
  if (!p.raw || SIDE_STATES.includes(p.type)) return undefined;
  let top: ProviderEvent | undefined;
  for (const e of ws.providerEvents) {
    if (e.intentId !== intentId || e.sequence >= p.sequence || typeof e.detail.rawRank !== "number" || SIDE_STATES.includes(e.normalizedType)) continue;
    if (e.processingOutcome !== "applied" && e.processingOutcome !== "recorded_no_state_change") continue;
    if (!top || (e.detail.rawRank as number) > (top.detail.rawRank as number)) top = e;
  }
  return top && p.raw.rank < (top.detail.rawRank as number) ? top : undefined;
}
