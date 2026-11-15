/**
 * rc4 Connect — outbound idempotency semantics per provider (P2).
 *
 * Providers differ: some replay the first response for a repeated key, others reject the repeat;
 * key formats, maximum lengths and retention (TTL) differ. Clearline derives ONE deterministic
 * provider key per instruction, so every retry of the same instruction carries the same key, and
 * after the provider's TTL it never blindly retries: it polls the status first (a retry after the
 * TTL could create a second payout).
 */
import { sha256Hex } from "../sha256";
import type { AdapterDescriptor, IdempotencySemantics } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PRINTABLE_RE = /^[\x21-\x7e]+$/;

export function isValidProviderKey(sem: IdempotencySemantics, key: string): boolean {
  if (typeof key !== "string" || key.length < 1 || key.length > sem.maxLength) return false;
  return sem.format === "uuid" ? UUID_RE.test(key) : PRINTABLE_RE.test(key);
}

/** Deterministic provider idempotency key for one instruction, valid for the provider's format and length. */
export function providerIdempotencyKey(d: AdapterDescriptor, clearlineKey: string, instructionId: string): string {
  const h = sha256Hex(`connect-idem:${d.providerId}:${clearlineKey}:${instructionId}`);
  const sem = d.idempotency;
  if (sem.format === "uuid") {
    // RFC 9562 layout with version 8 (custom, deterministic) and the RFC variant bits.
    const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  return ("cl_" + h).slice(0, Math.min(sem.maxLength, 67));
}

export interface IdempotencyRecord {
  key: string;
  bodyHash: string;
  firstAt: string;
  response: string;
}

export type IdempotencyOutcome =
  | { outcome: "created"; response: string }
  | { outcome: "replayed"; response: string }
  | { outcome: "rejected_duplicate" }
  | { outcome: "rejected_body_mismatch" }
  | { outcome: "rejected_key_format" };

/**
 * What the fictional provider does with a request carrying `key` (pure; returns the new store).
 * After the TTL the provider has forgotten the key, so the same key creates a NEW object: that is
 * why `retryDecision` sends Clearline to `fetchStatus` instead of retrying after the TTL.
 */
export function simulateProviderIdempotency(
  sem: IdempotencySemantics,
  store: readonly IdempotencyRecord[],
  req: { key: string; bodyHash: string; at: string; response: string },
): { result: IdempotencyOutcome; store: IdempotencyRecord[] } {
  if (!isValidProviderKey(sem, req.key)) return { result: { outcome: "rejected_key_format" }, store: [...store] };
  const ttlMs = sem.ttlHours * 3_600_000;
  const live = store.filter((r) => Date.parse(req.at) - Date.parse(r.firstAt) < ttlMs);
  const prior = live.find((r) => r.key === req.key);
  if (!prior) return { result: { outcome: "created", response: req.response }, store: [...live, { key: req.key, bodyHash: req.bodyHash, firstAt: req.at, response: req.response }] };
  if (prior.bodyHash !== req.bodyHash) return { result: { outcome: "rejected_body_mismatch" }, store: live };
  return sem.onRepeat === "replay_first_response" ? { result: { outcome: "replayed", response: prior.response }, store: live } : { result: { outcome: "rejected_duplicate" }, store: live };
}

/** Whether Clearline may retry a submission with the same key, or must poll the provider's status first. */
export function retryDecision(sem: IdempotencySemantics, firstAttemptAt: string, now: string): "retry_with_same_key" | "poll_status_first" {
  return Date.parse(now) - Date.parse(firstAttemptAt) < sem.ttlHours * 3_600_000 && sem.onRepeat === "replay_first_response" ? "retry_with_same_key" : "poll_status_first";
}
