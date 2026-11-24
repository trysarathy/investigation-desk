/**
 * rc7 test helpers: LIVE fictional merchants for uploads (sample organisations refuse uploads), with entities,
 * per-currency default policies and fictional users. Owner connection, like the admin CLI.
 */
import { and, asc, eq } from "drizzle-orm";
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
import { ownerDb, PASSWORD } from "./harness";

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
    await addTestBankAccount(db, orgs[e.org], e.id, e.currency);
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

/** v1: one fictional bank account for a test entity (owner connection, as `add-bank-account` writes it). */
export async function addTestBankAccount(db: Db, orgId: string, entityId: string, currency: string, name = `${entityId} operating account (fictional)`, last4 = "0001") {
  const [a] = await db.insert(t.bankAccounts).values({ orgId, entityId, currency, displayName: name, accountLast4: last4, bankName: "Fictional Test Bank" }).returning({ id: t.bankAccounts.id });
  return a.id;
}

/** v1: the first active bank account of an entity (a bank statement upload names one). */
export async function accountOf(orgId: string, entityId: string): Promise<string> {
  const [a] = await ownerDb().select({ id: t.bankAccounts.id }).from(t.bankAccounts)
    .where(and(eq(t.bankAccounts.orgId, orgId), eq(t.bankAccounts.entityId, entityId), eq(t.bankAccounts.status, "active"))).orderBy(asc(t.bankAccounts.createdAt)).limit(1);
  if (!a) throw new Error(`test setup: entity ${entityId} has no active bank account`);
  return a.id;
}

/** The upload fields a file of this type needs: a bank statement names its entity's bank account. */
export const accountFields = async (ctx: { orgId: string }, entityId: string, fileType: string): Promise<{ bankAccountId?: string }> =>
  fileType === "bank_statement" ? { bankAccountId: await accountOf(ctx.orgId, entityId) } : {};
