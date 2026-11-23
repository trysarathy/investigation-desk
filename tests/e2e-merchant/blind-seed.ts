/**
 * rc7 Phase 5 blind test: a blank fictional LIVE merchant (served by the upload journeys' fictional provider) ("Your data") with the synthetic month's two entities, their
 * default policies (the imported-bank-line flag off), FX rates and address facts (not uploads), and three fictional
 * users (Finance, Approver, Admin). No upload, mapping template or reconciled row: everything else goes through the UI.
 * The month's chain transfers are added to the recording the server's verify step reads (rc7 phase 2), next to the
 * upload journeys' own. Owner connection, like the admin CLI. Nothing here is real.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { writeIngested } from "../../src/server/merchant-store";
import { toEnginePolicy } from "../../src/lib/clearline/synthetic";
import { recordingOf } from "../../src/lib/clearline/merchant/chain/recording";
import { MERCHANT_E2E } from "./env";
import { BLIND, blindWorld } from "./blind-world";
import { LIVE } from "./live-seed";

export async function seedBlindMerchant(db: Db, password: string) {
  const { world } = blindWorld();
  const org = await createOrganization(db, { slug: BLIND.org.slug, name: BLIND.org.name, seed: "empty", dataMode: "live" });
  // served by the upload journeys' fictional provider (a provider's files are mapped with templates tied to it)
  const [provider] = await db.select({ id: t.organizations.id }).from(t.organizations).where(eq(t.organizations.slug, LIVE.provider.slug));
  await db.update(t.organizations).set({ providerOrgId: provider.id }).where(eq(t.organizations.id, org));
  for (const e of world.entities) {
    const p = toEnginePolicy(world.policy, e.functionalCurrency);
    await db.insert(t.merchantEntities).values({ orgId: org, id: e.id, name: e.name, functionalCurrency: e.functionalCurrency, ledger: "xero", timezone: e.timeZone.name, utcOffsetMinutes: e.timeZone.utcOffsetMinutes });
    await db.insert(t.merchantPolicy).values({
      orgId: org, entityId: e.id, toleranceBps: p.tolerancePct, toleranceAbsMinor: p.toleranceAbsMinor, toleranceCombine: p.toleranceCombine, writeoffThresholdMinor: p.writeoffThresholdMinor,
      approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: p.senderFeeBoundBaseUnits.toString(),
    });
    await db.transaction((tx) => writeIngested(tx, org, e.id, { fxRates: world.fxRates.filter((r) => r.pair.endsWith(`/${e.functionalCurrency}`)), addressFacts: world.addressFacts }, { chainSource: "recorded_fixture" }));
  }
  // the server reads chain data through the recording; keep the upload journeys' transfers and add this month's
  const prior = existsSync(MERCHANT_E2E.chainRecording) ? (JSON.parse(readFileSync(MERCHANT_E2E.chainRecording, "utf8")) as { transfers: unknown[] }).transfers : [];
  const rec = recordingOf(world.transfers);
  writeFileSync(MERCHANT_E2E.chainRecording, JSON.stringify({ ...rec, transfers: [...prior, ...rec.transfers] }));
  for (const [email, role, name] of BLIND.users) {
    await createUser(db, { email, name, password });
    await grantMembership(db, { orgSlug: BLIND.org.slug, email, role });
  }
  return org;
}
