/**
 * rc7 upload journeys: a fictional LIVE merchant ("Your data") for the upload screens, its fictional provider, a
 * second live merchant (tenant isolation) and fictional users. Chain transfers, FX rates and address facts come from
 * the synthetic generator's small preset and are written as a chain reader would (Phase 2 readers; recorded here):
 * uploads never carry chain facts. Owner connection, like the admin CLI. Nothing here is real.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { writeIngested } from "../../src/server/merchant-store";
import type { AppRole } from "../../src/server/authz";
import { smallWorld, toEnginePolicy, transferKey } from "../../src/lib/clearline/synthetic";

export const LIVE = {
  provider: { slug: "kestrel-provider-live", name: "Kestrel Settle (fictional)" },
  merchant: { slug: "kestrelbay-live", name: "Kestrelbay Synthetic (fictional, live)" },
  other: { slug: "otherbay-live", name: "Otherbay Synthetic (fictional, live)" },
  users: [
    ["finance@kestrelbay-live.example", "merchant", "finance", "Ines Vale (fictional)"],
    ["ops@kestrelbay-live.example", "merchant", "payment_ops", "Omar Reyes (fictional)"],
    ["approver@kestrelbay-live.example", "merchant", "approver", "Ada Lindqvist (fictional)"],
    ["viewer@kestrelbay-live.example", "merchant", "viewer", "Vik Moreau (fictional)"],
    ["admin@kestrelbay-live.example", "merchant", "admin", "Hana Iwata (fictional)"],
    ["finance@otherbay-live.example", "other", "finance", "Olu Park (fictional)"],
  ] as const satisfies readonly (readonly [string, "merchant" | "other", AppRole, string])[],
} as const;

const THEME = { name: "Kestrel Settle (fictional)", colours: { primary: "#234E52", accent: "#E9B949", surface: "#F7F9FB", text: "#14212B" }, logo: { kind: "placeholder", text: "KS", alt: "Kestrel Settle (fictional) logo placeholder" } };

export async function seedLiveMerchant(db: Db, password: string) {
  const world = smallWorld();
  const provider = await createOrganization(db, { slug: LIVE.provider.slug, name: LIVE.provider.name, seed: "empty" });
  const merchant = await createOrganization(db, { slug: LIVE.merchant.slug, name: LIVE.merchant.name, seed: "empty", dataMode: "live" });
  const other = await createOrganization(db, { slug: LIVE.other.slug, name: LIVE.other.name, seed: "empty", dataMode: "live" });
  await db.update(t.organizations).set({ kind: "provider", theme: THEME }).where(eq(t.organizations.id, provider));
  await db.update(t.organizations).set({ providerOrgId: provider }).where(eq(t.organizations.id, merchant));
  await db.update(t.organizations).set({ providerOrgId: provider }).where(eq(t.organizations.id, other));
  const ents = [...world.entities.map((e) => ({ org: merchant, e })), { org: other, e: { ...world.entities[0], id: "ENT-OTHER-SYN", name: "Otherbay Synthetic (fictional)" } }];
  for (const { org, e } of ents) {
    const p = toEnginePolicy(world.policy, e.functionalCurrency);
    await db.insert(t.merchantEntities).values({ orgId: org, id: e.id, name: e.name, functionalCurrency: e.functionalCurrency, ledger: "xero", timezone: e.timeZone.name, utcOffsetMinutes: e.timeZone.utcOffsetMinutes });
    await db.insert(t.merchantPolicy).values({
      orgId: org, entityId: e.id, toleranceBps: p.tolerancePct, toleranceAbsMinor: p.toleranceAbsMinor, toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor,
      approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: p.senderFeeBoundBaseUnits.toString(),
    });
  }
  // What the merchant's chain readers observed (not an upload): every transfer seen for each entity, FX rates, address facts.
  for (const e of world.entities) {
    const keys = new Set(world.transferMeta.filter((m) => m.entityId === e.id).map((m) => m.key));
    await db.transaction((tx) => writeIngested(tx, merchant, e.id, {
      transfers: world.transfers.filter((x) => keys.has(transferKey(x))), fxRates: world.fxRates.filter((r) => r.pair.endsWith(`/${e.functionalCurrency}`)), addressFacts: world.addressFacts,
    }, { chainSource: "recorded_fixture" }));
  }
  const orgs = { merchant: LIVE.merchant.slug, other: LIVE.other.slug };
  for (const [email, org, role, name] of LIVE.users) {
    await createUser(db, { email, name, password });
    await grantMembership(db, { orgSlug: orgs[org], email, role });
  }
  return { provider, merchant, other };
}
