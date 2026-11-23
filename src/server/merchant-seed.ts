import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { MerchantEntity, MerchantPolicy, ReconcileInput } from "@/lib/clearline/merchant";
import { TEST_MODE_LABEL } from "@/lib/clearline/merchant/types";
import {
  NORTHWIND_EXPORT_MAPPING, RecordedChainClient, chainRecording, fxFeed, providerExportRows, readChainTransfers, readFxRates, readProviderExport,
  readSettlementReports, settlementReport, toCsv, watchedAddresses, type AdapterResult,
} from "@/lib/clearline/merchant/adapters";
import { case1 } from "@/lib/clearline/merchant/fixtures/case1";
import { case2Sgd, case2Usd } from "@/lib/clearline/merchant/fixtures/case2";
import { case3, case3AfterPart1 } from "@/lib/clearline/merchant/fixtures/case3";
import type { Db, Tx } from "./db/client";
import * as t from "./db/schema";
import { createOrganization, createUser, grantMembership } from "./admin";
import type { AppRole } from "./authz";
import { type IngestParts, writeIngested } from "./merchant-store";

/**
 * FICTIONAL rc6 merchant seed (schema OWNER connection, like src/server/admin.ts; never the web app). A fictional
 * provider with a white-label theme, two fictional merchants (SG: Case 1, Case 2 SGD and its USD book; UAE: Case 3)
 * and fictional users. Case data goes in through the SAME adapters a provider's files would use (provider export
 * CSV, settlement report, recorded chain client, FX feed). Test mode · illustrative data.
 */

export const NORTHWIND_THEME = {
  label: TEST_MODE_LABEL, name: "Northwind Pay (fictional)", colours: { primary: "#1F4E79", accent: "#F2A900", surface: "#F7F9FB", text: "#14212B" },
  logo: { kind: "placeholder", text: "NW", alt: "Northwind Pay (fictional) logo placeholder" },
};

export const MERCHANT_SEED_USERS: { email: string; name: string; org: "provider" | "sg" | "ae"; role: AppRole }[] = [
  { email: "finance@straits-demo.example", name: "Lena Goh (fictional)", org: "sg", role: "finance" },
  { email: "ops@straits-demo.example", name: "Ravi Pillai (fictional)", org: "sg", role: "payment_ops" },
  { email: "approver@straits-demo.example", name: "Hana Lim (fictional)", org: "sg", role: "approver" },
  { email: "approver2@straits-demo.example", name: "Omar Rahman (fictional)", org: "sg", role: "approver" },
  { email: "admin@straits-demo.example", name: "Wei Jie Tan (fictional)", org: "sg", role: "admin" },
  { email: "finance@dunehaven-demo.example", name: "Layla Haddad (fictional)", org: "ae", role: "finance" },
  { email: "ops@dunehaven-demo.example", name: "Karim Aziz (fictional)", org: "ae", role: "payment_ops" },
  { email: "approver@dunehaven-demo.example", name: "Noor Saleh (fictional)", org: "ae", role: "approver" },
  { email: "admin@northwind-pay.example", name: "Ines Moreau (fictional)", org: "provider", role: "provider_admin" },
  { email: "ops@northwind-pay.example", name: "Jonas Berg (fictional)", org: "provider", role: "provider_ops" },
];

export const MERCHANT_SEED_ORGS = {
  provider: { slug: "northwind-pay", name: "Northwind Pay (fictional)" },
  sg: { slug: "straits-demo-sg", name: "Straits Demo Group (fictional)" },
  ae: { slug: "dunehaven-demo-ae", name: "Dunehaven Demo Trading (fictional)" },
} as const;

function assertClean(name: string, r: AdapterResult<unknown>) {
  if (r.errors.length) throw new Error(`seed: ${name} adapter refused ${r.errors.length} item(s): ${r.errors.map((e) => e.reason).join("; ")}`);
}

/** Run a fixture through the adapters and return what they produced, as one ingestion. */
export async function adapterParts(input: ReconcileInput): Promise<{ parts: IngestParts; finalised: Map<string, boolean> }> {
  const rows = providerExportRows(input);
  const provider = await readProviderExport([{ id: "northwind-export.csv", read: () => toCsv(rows, Object.keys(NORTHWIND_EXPORT_MAPPING.columns)) }], NORTHWIND_EXPORT_MAPPING, { entityId: input.entity.id });
  const settlement = await readSettlementReports([{ id: "northwind-settlement.json", read: () => settlementReport(input) }]);
  const chain = await readChainTransfers(new RecordedChainClient(chainRecording(input)), watchedAddresses(provider), { since: "2026-01-01T00:00:00.000Z", tokens: input.tokens, networks: input.networks });
  const fx = await readFxRates([{ id: "fx-feed.json", read: () => fxFeed(input) }]);
  for (const [n, r] of [["provider export", provider], ["settlement", settlement], ["chain", chain], ["fx", fx]] as const) assertClean(n, r);
  const finalised = new Map(chain.accepted.map((x) => [`${x.network}|${x.txHash}|${x.logIndex}`, x.finalised]));
  return {
    parts: {
      invoices: provider.invoices, quotes: provider.quotes, paymentLinks: provider.paymentLinks, providerRecords: provider.providerRecords,
      transfers: chain.accepted.map(({ finalised: f, ...x }) => (void f, x)), batches: settlement.batches, batchLines: settlement.batchLines,
      fxRates: fx.accepted, bankLines: input.bankLines, addressFacts: input.addressFacts,
    },
    finalised,
  };
}

export const finalisedFrom = (m: Map<string, boolean>) => (x: { network: string; txHash: string; logIndex: number }) => m.get(`${x.network}|${x.txHash}|${x.logIndex}`) ?? false;

/** [ASSUMPTION] the fixtures' ledger codes are not ledger products; Singapore books keep Xero, the UAE book QuickBooks. */
async function addEntity(tx: Tx, orgId: string, e: MerchantEntity, policy: MerchantPolicy, ledger: "xero" | "quickbooks") {
  await tx.insert(t.merchantEntities).values({ orgId, id: e.id, name: e.name, functionalCurrency: e.functionalCurrency, ledger, timezone: e.timeZone.name, utcOffsetMinutes: e.timeZone.utcOffsetMinutes });
  await tx.insert(t.merchantPolicy).values({
    orgId, entityId: e.id, toleranceBps: policy.tolerancePct, toleranceAbsMinor: policy.toleranceAbsMinor, toleranceCombine: policy.toleranceCombine, writeoffThresholdMinor: policy.writeoffThresholdMinor,
    approverRoles: [...policy.approverRoles], allowImportedBankLinesAsVerified: policy.allowImportedBankLinesAsVerified, senderFeeBoundBaseUnits: policy.senderFeeBoundBaseUnits.toString(),
  });
}

/** One fictional entity, its policy, and its case data through the adapters (owner connection). */
export async function seedMerchantEntity(db: Db, orgId: string, input: ReconcileInput, ledger: "xero" | "quickbooks" = "xero") {
  const { parts, finalised } = await adapterParts(input);
  return db.transaction(async (tx) => {
    await addEntity(tx, orgId, input.entity, input.policy, ledger);
    return writeIngested(tx, orgId, input.entity.id, parts, { chainSource: "recorded_fixture", bankSource: "seed_fictional", finalised: finalisedFrom(finalised) });
  });
}

export interface MerchantSeedOptions {
  /** Password for the fictional users; when absent a random one is used (never printed). */
  password?: string;
  /** "after_part_1" seeds Case 3 before its balance payment (the open balance 7,347.50); default "full". */
  case3?: "full" | "after_part_1";
  /** Slug suffix, so a test can seed more than once in one database. */
  suffix?: string;
}

export async function seedMerchantCases(db: Db, opts: MerchantSeedOptions = {}) {
  const sfx = opts.suffix ?? "";
  const slug = (k: keyof typeof MERCHANT_SEED_ORGS) => MERCHANT_SEED_ORGS[k].slug + sfx;
  const orgs: Record<"provider" | "sg" | "ae", string> = {
    provider: await createOrganization(db, { slug: slug("provider"), name: MERCHANT_SEED_ORGS.provider.name, seed: "empty" }),
    sg: await createOrganization(db, { slug: slug("sg"), name: MERCHANT_SEED_ORGS.sg.name, seed: "empty" }),
    ae: await createOrganization(db, { slug: slug("ae"), name: MERCHANT_SEED_ORGS.ae.name, seed: "empty" }),
  };
  await db.update(t.organizations).set({ kind: "provider", theme: NORTHWIND_THEME }).where(eq(t.organizations.id, orgs.provider));
  await db.update(t.organizations).set({ providerOrgId: orgs.provider }).where(eq(t.organizations.id, orgs.sg));
  await db.update(t.organizations).set({ providerOrgId: orgs.provider }).where(eq(t.organizations.id, orgs.ae));
  const cases: [string, () => ReconcileInput, "xero" | "quickbooks"][] = [
    [orgs.sg, case1, "xero"], [orgs.sg, case2Sgd, "xero"], [orgs.sg, case2Usd, "xero"],
    [orgs.ae, opts.case3 === "after_part_1" ? case3AfterPart1 : case3, "quickbooks"],
  ];
  const written: Record<string, Record<string, number>> = {};
  for (const [orgId, fixture, ledger] of cases) { const input = fixture(); written[input.entity.id] = await seedMerchantEntity(db, orgId, input, ledger); }
  const password = opts.password ?? `fictional-${randomUUID()}`;
  const users: Record<string, string> = {};
  for (const u of MERCHANT_SEED_USERS) {
    users[u.email] = await createUser(db, { email: u.email.replace("@", `${sfx}@`), name: u.name, password });
    await grantMembership(db, { orgSlug: slug(u.org), email: u.email.replace("@", `${sfx}@`), role: u.role });
  }
  return { label: TEST_MODE_LABEL, orgs, users, written };
}
