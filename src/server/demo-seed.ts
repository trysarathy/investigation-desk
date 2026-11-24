import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { createOrganization } from "./admin";
import { addEntity, addMember, linkProvider } from "./merchant-setup";
import { writeIngested } from "./merchant-store";
import { runReconciliation, proposeWriteoff, decideWriteoff } from "./merchant";
import { assignException } from "./merchant-ui";
import { resolveTenant, type TenantContext } from "./tenant";
import { RecordingChainClient } from "@/lib/clearline/merchant/chain";
import { DEMO_ENTITIES, DEMO_MERCHANT, DEMO_PROVIDER, DEMO_THEME, demoWorld } from "@/lib/clearline/demo/world";
import { partsByDay, windowDays } from "@/lib/clearline/demo/days";
import { DEMO_NOW } from "@/lib/clearline/demo/clock";

/**
 * Seeds the demo world (src/lib/clearline/demo/world.ts) into a migrated database: Provider P (demo) and Northwind
 * Travel (demo), both data_mode 'demo' ("Demo · fictional data"), their entities with the default policy (the
 * imported-bank-line flag OFF), the demo users, and then 30 days of data, one day at a time, each day followed by a
 * reconciliation run per entity — the same services the app uses (runReconciliation on the RUNTIME login, under
 * row-level security, chain verification against the recorded chain file). Run by `npm run demo` only, with the
 * OWNER connection for setup and ingestion, as the admin CLI and the benchmark do.
 *
 * Bank lines are a simulated bank feed, stored with source 'seed_fictional' (as the rc6 sample seed does) and the
 * provenance "Demo bank feed (simulated, fictional)": they are not imported statements. Nothing here changes a
 * matching rule or a policy; outcomes come from the data alone.
 */

export const DEMO_USERS = [
  { email: "finance@northwind.demo", name: "Finance (demo)", org: "merchant", role: "finance" },
  { email: "approver@northwind.demo", name: "Approver (demo)", org: "merchant", role: "approver" },
  { email: "viewer@northwind.demo", name: "Viewer (demo)", org: "merchant", role: "viewer" },
  { email: "admin@northwind.demo", name: "Admin (demo)", org: "merchant", role: "admin" },
  { email: "ops@providerp.demo", name: "Provider ops (demo)", org: "provider", role: "provider_ops" },
] as const;

export interface DemoSeedOptions {
  /** The shared demo password (fictional, local). Never printed here. */
  password: string;
  /** The recorded chain file (every demo transfer). */
  recording: unknown;
  /** Called with the simulated instant before each step, so the caller's clock follows the demo days. */
  setClock?: (iso: string) => void;
  log?: (line: string) => void;
  /** Slug and email suffix, so a test can seed the demo twice in one database (determinism). */
  suffix?: string;
}

export interface DemoSeedResult { orgs: { provider: string; merchant: string }; days: number; runs: number; writeoffsProposed: number; writeoffsApproved: number; exceptionsAssigned: number }

const runAt = (d: string) => new Date(Date.parse(`${d}T00:00:00.000Z`) + 25 * 3_600_000).toISOString(); // 01:00 UTC the next day

export async function seedDemo(owner: Db, opts: DemoSeedOptions): Promise<DemoSeedResult> {
  const log = opts.log ?? (() => undefined);
  const clock = opts.setClock ?? (() => undefined);
  const days = windowDays();
  clock(`${days[0]}T00:00:00.000Z`);
  const { inputs } = demoWorld();
  const sfx = opts.suffix ?? "";
  const providerSlug = DEMO_PROVIDER.slug + sfx, merchantSlug = DEMO_MERCHANT.slug + sfx;

  // organisations, entities, policies, members (owner connection, the admin CLI's own functions)
  const provider = await createOrganization(owner, { slug: providerSlug, name: DEMO_PROVIDER.name, seed: "empty", dataMode: "demo" });
  await owner.update(t.organizations).set({ kind: "provider", theme: DEMO_THEME, timezone: "UTC" }).where(eq(t.organizations.id, provider));
  const merchant = await createOrganization(owner, { slug: merchantSlug, name: DEMO_MERCHANT.name, seed: "empty", dataMode: "demo" });
  await owner.update(t.organizations).set({ timezone: DEMO_MERCHANT.timezone }).where(eq(t.organizations.id, merchant));
  for (const e of DEMO_ENTITIES) {
    await addEntity(owner, { orgSlug: merchantSlug, entityId: e.id, name: e.name, currency: e.currency, timezone: e.timeZone.name, utcOffset: e.timeZone.utcOffsetMinutes === 480 ? "+08:00" : "+04:00", ledger: e.ledgerProduct });
  }
  await linkProvider(owner, { orgSlug: merchantSlug, providerSlug });
  const users: Record<string, TenantContext> = {};
  for (const u of DEMO_USERS) {
    const slug = u.org === "provider" ? providerSlug : merchantSlug;
    const email = u.email.replace("@", `${sfx}@`);
    const r = await addMember(owner, { orgSlug: slug, email, role: u.role, name: u.name, password: opts.password });
    users[u.role] = await resolveTenant({ userId: r.userId, name: u.name, email }, slug);
  }
  log(`organisations and ${DEMO_USERS.length} users created`);

  // address facts once; then each day's rows, and a run per entity the next morning
  for (const input of inputs) await owner.transaction((tx) => writeIngested(tx, merchant, input.entity.id, { addressFacts: input.addressFacts }, { chainSource: "chain_client" }));
  const byEntity = inputs.map((i) => ({ id: i.entity.id, days: partsByDay(i) }));
  let runs = 0;
  for (const d of days) {
    const at = runAt(d);
    clock(at);
    for (const e of byEntity) {
      const parts = e.days.get(d);
      if (parts) await owner.transaction((tx) => writeIngested(tx, merchant, e.id, parts, { chainSource: "chain_client", bankSource: "seed_fictional" }));
      const chain = new RecordingChainClient(opts.recording, { now: at });
      await runReconciliation(users.finance, e.id, `demo-seed${sfx}-${e.id}-${d}`, { chain, now: new Date(at), trigger: "schedule" });
      runs++;
    }
    log(`day ${d}: reconciled ${byEntity.length} entities`);
  }

  // the morning of the demo day: Finance prepares write-offs, the Approver has approved the older ones; every open
  // exception has an owner (the engine already gives each one its owner team, reason and next step)
  clock(new Date(Date.parse(DEMO_NOW) - 30 * 60_000).toISOString());
  const wos = await owner.select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, merchant), eq(t.writeoffProposals.status, "proposed")));
  wos.sort((a, b) => (a.id < b.id ? -1 : 1));
  const prepare = wos.slice(0, 24);
  let approved = 0;
  for (const [i, w] of prepare.entries()) {
    const r = await proposeWriteoff(users.finance, w.id, `demo-seed${sfx}-wo-${i}`);
    if (i < 10) {
      await decideWriteoff(users.approver, r.body.requestId, { decision: "approve", reason: "Within the entity's tolerance; evidence reviewed (demo)", payloadSha256: r.body.payloadSha256 }, `demo-seed${sfx}-wo-ok-${i}`);
      approved++;
    }
  }
  const open = await owner.select({ id: t.reconExceptions.id }).from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, merchant), eq(t.reconExceptions.status, "open")));
  for (const [i, x] of open.entries()) await assignException(users.finance, x.id, { ownerUserId: users.finance.userId }, `demo-seed${sfx}-assign-${i}`);
  log(`${prepare.length} write-offs prepared (${approved} approved), ${open.length} exceptions assigned`);
  return { orgs: { provider, merchant }, days: days.length, runs, writeoffsProposed: prepare.length, writeoffsApproved: approved, exceptionsAssigned: open.length };
}
