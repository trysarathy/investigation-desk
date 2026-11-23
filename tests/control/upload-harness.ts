/**
 * rc7 test helpers: LIVE fictional merchants for uploads (sample organisations refuse uploads), with entities,
 * per-currency default policies and fictional users. Owner connection, like the admin CLI.
 */
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import * as t from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { defaultPolicyFor } from "../../src/lib/clearline/merchant/config";
import type { FiatCurrency } from "../../src/lib/clearline/merchant/types";
import type { AppRole } from "../../src/server/authz";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { PASSWORD } from "./harness";

/** Upload storage for this test run: a fresh temporary folder and a random (test-only) encryption key. */
export function useTestStorage(encrypted = true) {
  const dir = mkdtempSync(path.join(tmpdir(), "clearline-uploads-"));
  process.env.CLEARLINE_UPLOAD_DIR = dir;
  if (encrypted) process.env.CLEARLINE_UPLOAD_KEY = randomBytes(32).toString("base64");
  else delete process.env.CLEARLINE_UPLOAD_KEY;
  return dir;
}

export interface LiveSeed { orgs: Record<"providerA" | "providerB" | "a" | "b", string>; slugs: Record<"providerA" | "providerB" | "a" | "b", string>; users: Record<string, string> }

const ENTITIES: { org: "a" | "b"; id: string; currency: FiatCurrency; tz: string; offset: number }[] = [
  { org: "a", id: "ENT-LIVE-SG", currency: "SGD", tz: "Asia/Singapore", offset: 480 },
  { org: "a", id: "ENT-LIVE-US", currency: "USD", tz: "UTC", offset: 0 },
  { org: "b", id: "ENT-LIVE-AE", currency: "AED", tz: "Asia/Dubai", offset: 240 },
];
const USERS: [string, "a" | "b" | "providerA", AppRole][] = [
  ["finance@live-a.example", "a", "finance"], ["ops@live-a.example", "a", "payment_ops"], ["approver@live-a.example", "a", "approver"],
  ["approver2@live-a.example", "a", "approver"], ["viewer@live-a.example", "a", "viewer"], ["admin@live-a.example", "a", "admin"],
  ["finance@live-b.example", "b", "finance"], ["approver@live-b.example", "b", "approver"], ["admin@provider-a.example", "providerA", "provider_admin"],
];

export async function seedLiveMerchants(db: Db, suffix = ""): Promise<LiveSeed> {
  const slugs = { providerA: `live-provider-a${suffix}`, providerB: `live-provider-b${suffix}`, a: `live-merchant-a${suffix}`, b: `live-merchant-b${suffix}` };
  const orgs = {
    providerA: await createOrganization(db, { slug: slugs.providerA, name: "Provider A (fictional)", seed: "empty" }),
    providerB: await createOrganization(db, { slug: slugs.providerB, name: "Provider B (fictional)", seed: "empty" }),
    a: await createOrganization(db, { slug: slugs.a, name: "Merchant A (fictional)", seed: "empty", dataMode: "live" }),
    b: await createOrganization(db, { slug: slugs.b, name: "Merchant B (fictional)", seed: "empty", dataMode: "live" }),
  };
  await db.update(t.organizations).set({ kind: "provider" }).where(eq(t.organizations.id, orgs.providerA));
  await db.update(t.organizations).set({ kind: "provider" }).where(eq(t.organizations.id, orgs.providerB));
  await db.update(t.organizations).set({ providerOrgId: orgs.providerA }).where(eq(t.organizations.id, orgs.a));
  await db.update(t.organizations).set({ providerOrgId: orgs.providerB }).where(eq(t.organizations.id, orgs.b));
  for (const e of ENTITIES) {
    const p = defaultPolicyFor(e.currency);
    await db.insert(t.merchantEntities).values({ orgId: orgs[e.org], id: e.id, name: `${e.id} (fictional)`, functionalCurrency: e.currency, ledger: "xero", timezone: e.tz, utcOffsetMinutes: e.offset });
    await db.insert(t.merchantPolicy).values({
      orgId: orgs[e.org], entityId: e.id, toleranceBps: p.tolerancePct, toleranceAbsMinor: p.toleranceAbsMinor, toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor,
      approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: p.senderFeeBoundBaseUnits.toString(),
    });
  }
  const users: Record<string, string> = {};
  for (const [email, org, role] of USERS) {
    const e = email.replace("@", `${suffix}@`);
    users[email] = await createUser(db, { email: e, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
    await grantMembership(db, { orgSlug: slugs[org], email: e, role });
  }
  return { orgs, slugs, users };
}

export const liveCtx = (s: LiveSeed, email: string, org: keyof LiveSeed["slugs"]): Promise<TenantContext> =>
  resolveTenant({ userId: s.users[email], name: email, email }, s.slugs[org]);
