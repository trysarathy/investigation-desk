import "server-only";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client";
import * as t from "../db/schema";
import { FieldCryptoError, OrgCipher } from "./envelope";
import { kmsFromEnv, newKeyMaterial, type Kms } from "./kms";

/**
 * v1 Phase 5.3: per-organisation keys (table org_data_keys, migration 0083, was 0071). Each organisation has
 *  - data keys (purpose 'data', versions 1, 2, …): exactly one is active and seals new values; older (retired) ones
 *    still open what they sealed until the re-encrypt job has moved every value to the active one;
 *  - one blind-index key (purpose 'index', version 1): it is never rotated by a data-key rotation, so indexes stay
 *    stable and equality keeps working (rotating it is a full re-index; docs/runbooks/KEY_ROTATION.md).
 * Keys are stored wrapped by the KMS master key; unwrapped keys live only in this process's memory.
 *
 * Every call reads the organisation's key rows inside the caller's transaction (row-level security applies), so a
 * rotation made by another process is seen on the next transaction; only the unwrapping is cached.
 */
type Purpose = "data" | "index";
export const wrapContext = (orgId: string, purpose: Purpose, version: number) => `org:${orgId}|purpose:${purpose}|v:${version}`;

const unwrapped = new Map<string, Buffer>();
const MAX_CACHED = 2000;
/** Tests and shutdown: forget every unwrapped key. */
export function clearKeyCache() { unwrapped.clear(); }

async function unwrapCached(kms: Kms, orgId: string, r: { purpose: string; version: number; kekId: string; wrappedKey: string }): Promise<Buffer> {
  const k = `${orgId}|${r.purpose}|${r.version}|${r.kekId}|${createHash("sha256").update(r.wrappedKey).digest("hex")}`;
  const hit = unwrapped.get(k);
  if (hit) return hit;
  const key = await kms.unwrap({ kekId: r.kekId, wrapped: r.wrappedKey }, wrapContext(orgId, r.purpose as Purpose, r.version));
  if (key.length !== 32) throw new FieldCryptoError("An organisation key has the wrong length.");
  if (unwrapped.size >= MAX_CACHED) unwrapped.delete(unwrapped.keys().next().value as string);
  unwrapped.set(k, key);
  return key;
}

/** True when this server must never store these fields unencrypted (a staging or production deployment). */
export function encryptionRequired(env: Record<string, string | undefined> = process.env): boolean {
  return env.CLEARLINE_DEPLOY_ENV === "staging" || env.CLEARLINE_DEPLOY_ENV === "production";
}

export const KMS_REQUIRED = "Wallet addresses and customer references are never stored unencrypted on a staging or production deployment: CLEARLINE_KMS_KEYS (or a hosted KMS) is not configured.";

/**
 * The organisation's field cipher, or null when field encryption is off (no KMS configured; local, CI and demo only).
 * mode "write" creates the organisation's keys on first use and refuses on staging/production without a KMS; mode
 * "read" never writes (it returns null when the organisation has no keys yet).
 */
export async function cipherFor(tx: Tx, orgId: string, mode: "read" | "write", kms: Kms | null = kmsFromEnv()): Promise<OrgCipher | null> {
  if (!kms) {
    if (mode === "write" && encryptionRequired()) throw new FieldCryptoError(KMS_REQUIRED);
    return null;
  }
  let rows = await keyRows(tx, orgId);
  const has = (p: Purpose) => rows.some((r) => r.purpose === p && r.status === "active");
  if (mode === "write" && (!has("data") || !has("index"))) {
    for (const purpose of ["data", "index"] as const) {
      if (has(purpose)) continue;
      const w = await kms.wrap(newKeyMaterial(), wrapContext(orgId, purpose, 1));
      // two first writes at once: one insert wins, the other reads the winner's key (ON CONFLICT DO NOTHING)
      await tx.execute(sql`insert into org_data_keys (org_id, purpose, version, kek_id, wrapped_key, status) values (${orgId}, ${purpose}, 1, ${w.kekId}, ${w.wrapped}, 'active') on conflict do nothing`);
    }
    rows = await keyRows(tx, orgId);
  }
  const data = rows.filter((r) => r.purpose === "data");
  const index = rows.find((r) => r.purpose === "index" && r.status === "active");
  const active = data.find((r) => r.status === "active");
  if (!active || !index) {
    if (mode === "read" && !data.length) return null;
    throw new FieldCryptoError("This organisation's field-encryption keys are incomplete (no active data key or no index key).");
  }
  const dataKeys = new Map<number, Buffer>();
  for (const r of data) dataKeys.set(r.version, await unwrapCached(kms, orgId, r));
  return new OrgCipher(orgId, dataKeys, active.version, await unwrapCached(kms, orgId, index));
}

export async function keyRows(tx: Tx, orgId: string) {
  return tx.select({ purpose: t.orgDataKeys.purpose, version: t.orgDataKeys.version, kekId: t.orgDataKeys.kekId, wrappedKey: t.orgDataKeys.wrappedKey, status: t.orgDataKeys.status })
    .from(t.orgDataKeys).where(eq(t.orgDataKeys.orgId, orgId));
}
