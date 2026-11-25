import "server-only";
import { createHash, createHmac } from "node:crypto";

/**
 * v1 phase 5.6: the minimal form in which a deleted merchant's audit events and approvals are kept for the retention
 * period ([ASSUMPTION — founder to confirm with a lawyer] 7 years from when each happened). Documented in
 * docs/privacy/RECORDS_OF_PROCESSING.md ("Retained after deletion").
 *
 * What is kept: the kind of event (action and entity type codes), when it happened, which source wrote it, numbers
 * and yes/no facts of its details, and for approvals the subject kind, version, status, decision, timestamps and the
 * SHA-256 of the approved payload. What is NOT kept: names, e-mail addresses, summaries and any other free text,
 * order, invoice or wallet references, the organisation id and user ids. Each identifier is replaced by
 * HMAC-SHA256(key = the organisation id, kind|value): records of the same person or subject stay linkable to each
 * other (so "the preparer never approves" can still be checked), and only someone who holds the organisation id —
 * the merchant, from its export — can recompute a reference to find its own records.
 */

export const AUDIT_RETENTION_YEARS = 7;

/** The receipt's organisation reference: sha256('clearline-org|' + org id). */
export const orgRef = (orgId: string) => createHash("sha256").update(`clearline-org|${orgId}`).digest("hex");

/** A keyed digest of one identifier (user, entity, subject, request) under the organisation's id. */
export function pseudonym(orgId: string, kind: string, value: string): string {
  return createHmac("sha256", orgId).update(`${kind}|${value}`).digest("hex");
}

/** `at` plus whole calendar years, in UTC (29 February rolls to 1 March). */
export function retainUntil(at: Date, years = AUDIT_RETENTION_YEARS): Date {
  const d = new Date(at.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

const CODE = /^[a-z][a-z0-9_.:-]{0,63}$/;
/** An action or type code as written by the code base; anything else (free text) becomes "other". */
const code = (v: unknown): string | null => (v == null ? null : typeof v === "string" && CODE.test(v) ? v : "other");

/**
 * Only top-level numbers and booleans of an audit event's details, under plain word keys (letters and underscores:
 * a key that carries digits could be a reference, and is dropped). Strings, arrays and objects are dropped.
 */
export function factsOnly(details: unknown): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  if (!details || typeof details !== "object" || Array.isArray(details)) return out;
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (!/^[A-Za-z_]{1,40}$/.test(k)) continue;
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) out[k] = v;
  }
  return out;
}

const iso = (d: Date | string | null | undefined) => (d == null ? null : new Date(d).toISOString());

export interface AuditRow { orgId: string; source: string; actorUserId: string | null; action: string; entityType: string | null; entityId: string | null; at: Date; details: unknown }
export interface ApprovalRequestRow { id: string; subjectKind: string; subjectId: string; version: number; payloadSha256: string; requestedBy: string; status: string; createdAt: Date; closedAt: Date | null }
export interface ApprovalDecisionRow { requestId: string; decidedBy: string; decision: string; reason: string; payloadSha256: string; createdAt: Date }

/**
 * `key` is the deleted merchant's organisation id. An event that another organisation wrote about this merchant (a
 * provider's invitation, say) keeps its own organisation only as `orgRef` (that organisation can recompute it).
 */
export function minimiseAudit(key: string, e: AuditRow): Record<string, unknown> {
  return {
    ...(e.orgId !== key ? { otherOrgRef: orgRef(e.orgId) } : {}),
    source: code(e.source), action: code(e.action), entityType: code(e.entityType),
    entityRef: e.entityId == null ? null : pseudonym(key, "entity", `${e.entityType ?? ""}:${e.entityId}`),
    actorRef: e.actorUserId == null ? null : pseudonym(key, "user", e.actorUserId),
    at: iso(e.at), facts: factsOnly(e.details),
  };
}

export function minimiseApprovalRequest(key: string, r: ApprovalRequestRow): Record<string, unknown> {
  return {
    requestRef: pseudonym(key, "approval_request", r.id), subjectKind: code(r.subjectKind),
    subjectRef: pseudonym(key, "subject", `${r.subjectKind}:${r.subjectId}`), version: r.version, status: code(r.status),
    payloadSha256: /^[0-9a-f]{64}$/.test(r.payloadSha256) ? r.payloadSha256 : null,
    requestedByRef: pseudonym(key, "user", r.requestedBy), createdAt: iso(r.createdAt), closedAt: iso(r.closedAt),
  };
}

export function minimiseApprovalDecision(key: string, d: ApprovalDecisionRow): Record<string, unknown> {
  return {
    requestRef: pseudonym(key, "approval_request", d.requestId), decision: code(d.decision),
    decidedByRef: pseudonym(key, "user", d.decidedBy), payloadSha256: /^[0-9a-f]{64}$/.test(d.payloadSha256) ? d.payloadSha256 : null,
    reasonRef: pseudonym(key, "reason", d.reason), createdAt: iso(d.createdAt),
  };
}
