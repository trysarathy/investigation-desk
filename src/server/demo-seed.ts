import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import type { Db } from "./db/client";
import * as t from "./db/schema";
import { createOrganization } from "./admin";
import { addBankAccount, addEntity, addMember, linkProvider } from "./merchant-setup";
import { writeIngested } from "./merchant-store";
import { runReconciliation, proposeWriteoff, decideWriteoff } from "./merchant";
import { assignException } from "./merchant-ui";
import { resolveTenant, type TenantContext } from "./tenant";
import { RecordingChainClient } from "@/lib/clearline/merchant/chain";
import { DEMO_BANK_ACCOUNTS, DEMO_ENTITIES, DEMO_MERCHANT, DEMO_PROVIDER, DEMO_SEED_MARKER, DEMO_THEME, demoWorld } from "@/lib/clearline/demo/world";
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

/**
 * One step of the seed on the simulated clock: the demo instant it stands for, and the database clock just before
 * and just after it ran. Rows that a database default (now()) stamped during the step carry a time inside
 * [dbFrom, dbTo]; restampDemoSeed moves exactly those to `at`.
 */
export interface DemoStampWindow { at: string; dbFrom: string; dbTo: string }

export interface DemoSeedResult { orgs: { provider: string; merchant: string }; days: number; runs: number; writeoffsProposed: number; writeoffsApproved: number; exceptionsAssigned: number; stampWindows: DemoStampWindow[] }

const runAt = (d: string) => new Date(Date.parse(`${d}T00:00:00.000Z`) + 25 * 3_600_000).toISOString(); // 01:00 UTC the next day

export async function seedDemo(owner: Db, opts: DemoSeedOptions): Promise<DemoSeedResult> {
  const log = opts.log ?? (() => undefined);
  const setClock = opts.setClock ?? (() => undefined);
  // the database's own clock, which its now() defaults use (the simulated clock only reaches this process)
  const dbClock = async () => {
    const r = (await owner.execute(sql`select clock_timestamp()::text as t`)) as unknown as { rows: { t: string }[] };
    return r.rows[0].t;
  };
  const stampWindows: DemoStampWindow[] = [];
  let open: { at: string; dbFrom: string } | null = null;
  const closeWindow = async () => { if (open) stampWindows.push({ ...open, dbTo: await dbClock() }); open = null; };
  const clock = async (at: string) => { await closeWindow(); setClock(at); open = { at, dbFrom: await dbClock() }; };
  const days = windowDays();
  await clock(`${days[0]}T00:00:00.000Z`);
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
    // v1: the entity's bank account as a row (masked number only); its statement lines still name the text reference
    const a = DEMO_BANK_ACCOUNTS[e.id];
    await addBankAccount(owner, { orgSlug: merchantSlug, entityId: e.id, name: a.name, currency: e.currency, last4: a.last4, bankName: a.bankName });
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
    await clock(at);
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
  await clock(new Date(Date.parse(DEMO_NOW) - 30 * 60_000).toISOString());
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
  const openEx = await owner.select({ id: t.reconExceptions.id }).from(t.reconExceptions).where(and(eq(t.reconExceptions.orgId, merchant), eq(t.reconExceptions.status, "open")));
  for (const [i, x] of openEx.entries()) await assignException(users.finance, x.id, { ownerUserId: users.finance.userId }, `demo-seed${sfx}-assign-${i}`);
  log(`${prepare.length} write-offs prepared (${approved} approved), ${openEx.length} exceptions assigned`);
  await closeWindow();
  return { orgs: { provider, merchant }, days: days.length, runs, writeoffsProposed: prepare.length, writeoffsApproved: approved, exceptionsAssigned: openEx.length, stampWindows };
}

/**
 * `npm run demo` only, right after seedDemo: the demo's seed data must read on the demo calendar, but columns filled
 * by a database default (now(): approval requests and decisions, notifications raised by triggers, chain transfers'
 * observed time, the policy's first revision, users and memberships) took the machine's clock, since the simulated
 * clock only reaches the seed process. This moves each such value, and only those, to the demo instant of the step
 * that wrote it: a column qualifies only when its default is now() and its value lies inside that step's window of
 * the database clock (and is not itself a demo instant). It touches no amount, decision, rule or policy value.
 *
 * It runs as the demo cluster's superuser with session_replication_role = replica for this one transaction, because
 * the append-only triggers (approval decisions, notifications, chain facts) rightly refuse updates from the app's
 * logins. Never used by the app or by a real install; the database name is checked like the reset's.
 */
export async function restampDemoSeed(superUrl: string, database: string, windows: DemoStampWindow[]): Promise<{ rows: number; columns: Record<string, number> }> {
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(database)) throw new Error("bad demo database name");
  const u = new URL(superUrl); u.pathname = `/${database}`;
  const c = new Client({ connectionString: u.toString() });
  await c.connect();
  const columns: Record<string, number> = {};
  let rows = 0;
  try {
    const { rows: dataMode } = await c.query("select count(*)::int as n from organizations where data_mode <> 'demo'");
    if (dataMode[0].n !== 0) throw new Error(`restampDemoSeed: this database holds a non-demo organisation; refusing (${DEMO_SEED_MARKER})`);
    const { rows: cols } = await c.query(`select table_name as t, column_name as c from information_schema.columns
      where table_schema = 'public' and data_type like 'timestamp%' and column_default ilike '%now()%' order by 1, 2`);
    const instants = windows.map((w) => w.at);
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    for (const { t: table, c: col } of cols as { t: string; c: string }[]) {
      let n = 0;
      for (const w of windows) {
        const r = await c.query(`update "${table}" set "${col}" = $1::timestamptz where "${col}" between $2::timestamptz and $3::timestamptz and "${col}" <> all($4::timestamptz[])`, [w.at, w.dbFrom, w.dbTo, instants]);
        n += r.rowCount ?? 0;
      }
      if (n) columns[`${table}.${col}`] = n;
      rows += n;
    }
    await c.query("commit");
  } catch (e) { await c.query("rollback").catch(() => undefined); throw e; } finally { await c.end(); }
  return { rows, columns };
}
