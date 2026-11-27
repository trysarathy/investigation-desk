/**
 * v1 phase 5.5 against PostgreSQL 16 (drizzle/0081, was 0075): the worker heartbeat, the readiness check read through the runtime
 * login, the alert metrics read through the jobs login, and exactly which login may do what with the new objects.
 * Every row here is fictional.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { closeJobs, closeOwner, jobsDb, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { collectMetrics, recordHeartbeat, runAlertsOnce } from "../../src/server/ops/monitor";
import { readLastSeen, readyResponse, healthResponse } from "../../src/server/ops/health";
import { MemoryAlertStateStore, type AlertNotification } from "../../src/server/ops/alerts";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function refused(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected a refusal matching ${re}`);
}

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  await ownerDb().execute(sql`delete from ops_worker_heartbeats`);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); await closeJobs(); });

describe("who may do what with the operations objects", () => {
  it("runtime: EXECUTE on ops_worker_last_seen() only; no table access, no metrics", async () => {
    expect(await rows(sql`select has_function_privilege('clearline_runtime', 'ops_worker_last_seen()', 'EXECUTE') as last_seen,
      has_function_privilege('clearline_runtime', 'ops_alert_metrics(timestamptz, timestamptz)', 'EXECUTE') as metrics,
      has_table_privilege('clearline_runtime', 'ops_worker_heartbeats', 'SELECT') as sel, has_table_privilege('clearline_runtime', 'ops_worker_heartbeats', 'INSERT') as ins`))
      .toEqual([{ last_seen: true, metrics: false, sel: false, ins: false }]);
    const runtime = new Pool({ connectionString: process.env.CLEARLINE_TEST_RUNTIME_URL, max: 1 });
    try {
      await refused(runtime.query("select * from ops_worker_heartbeats"), /permission denied/);
      await refused(runtime.query("select ops_alert_metrics(now(), now())"), /permission denied/);
      // the function returns one value: a timestamp (or null), nothing about which worker
      const r = await runtime.query("select ops_worker_last_seen() as t");
      expect(r.fields.map((f) => f.name)).toEqual(["t"]);
    } finally { await runtime.end(); }
  });

  it("jobs: reads and writes heartbeats and reads metrics; provisioning: nothing", async () => {
    expect(await rows(sql`select has_table_privilege('clearline_jobs', 'ops_worker_heartbeats', 'SELECT,INSERT,UPDATE,DELETE') as rw,
      has_table_privilege('clearline_jobs', 'ops_worker_heartbeats', 'TRUNCATE') as trunc,
      has_function_privilege('clearline_jobs', 'ops_alert_metrics(timestamptz, timestamptz)', 'EXECUTE') as metrics`))
      .toEqual([{ rw: true, trunc: false, metrics: true }]);
    const prov = await rows(sql`select exists (select 1 from pg_roles where rolname = 'clearline_provisioning') as e`);
    if (prov[0].e) {
      expect(await rows(sql`select has_table_privilege('clearline_provisioning', 'ops_worker_heartbeats', 'SELECT') as s,
        has_function_privilege('clearline_provisioning', 'ops_worker_last_seen()', 'EXECUTE') as f,
        has_function_privilege('clearline_provisioning', 'ops_alert_metrics(timestamptz, timestamptz)', 'EXECUTE') as m`)).toEqual([{ s: false, f: false, m: false }]);
    }
    expect(await rows(sql`select relrowsecurity as on, relforcerowsecurity as forced from pg_class where relname = 'ops_worker_heartbeats'`)).toEqual([{ on: true, forced: true }]);
  });

  it("the table refuses an id that is not id-shaped", async () => {
    await refused(jobsDb().execute(sql`insert into ops_worker_heartbeats (worker_id) values ('pat@example.test')`), /ops_worker_heartbeats_id_chk/);
  });
});

describe("heartbeat and readiness", () => {
  it("no heartbeat yet: health 200 degraded, ready 503", async () => {
    await ownerDb().execute(sql`delete from ops_worker_heartbeats`);
    expect(await readLastSeen()).toBeNull();
    expect((await healthResponse()).status).toBe(200);
    expect(await (await readyResponse()).json()).toEqual({ status: "not_ready", checks: { database: "ok", worker: "stale" } });
  });

  it("a worker pass makes it ready; passes are counted; the newest pass wins", async () => {
    const now = new Date();
    await recordHeartbeat(jobsDb(), "worker-test-a", new Date(now.getTime() - 60_000));
    await recordHeartbeat(jobsDb(), "worker-test-a", now);
    await recordHeartbeat(jobsDb(), "worker-test-b", new Date(now.getTime() - 120_000));
    expect(await rows(sql`select worker_id, passes::int as passes from ops_worker_heartbeats order by worker_id`)).toEqual([{ worker_id: "worker-test-a", passes: 2 }, { worker_id: "worker-test-b", passes: 1 }]);
    expect((await readLastSeen())?.getTime()).toBe(now.getTime());
    const r = await readyResponse();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ready", checks: { database: "ok", worker: "ok" } });
  });

  it("a worker silent for a week is forgotten on the next heartbeat", async () => {
    await ownerDb().execute(sql`update ops_worker_heartbeats set last_seen_at = now() - interval '8 days' where worker_id = 'worker-test-b'`);
    await recordHeartbeat(jobsDb(), "worker-test-a", new Date());
    expect((await rows(sql`select worker_id from ops_worker_heartbeats`)).map((r) => r.worker_id)).toEqual(["worker-test-a"]);
  });
});

describe("alert metrics (counts only) and a full alert pass", () => {
  it("counts failed sign-ins, dead jobs, backlog and chain reads per network; nothing identifying", async () => {
    const now = new Date();
    const runAs = seed.users["ops@straits-demo.example"];
    const org = seed.orgs.sg;
    await ownerDb().delete(t.jobs);
    await ownerDb().insert(t.jobs).values([
      { orgId: org, entityId: "ENT-SG-01", runAs, trigger: "schedule", dedupeKey: "ops:dead", status: "dead", runAfter: now, finishedAt: now, lastErrorCode: "INTERNAL" },
      { orgId: org, entityId: "ENT-SG-01", runAs, trigger: "schedule", dedupeKey: "ops:q1", runAfter: new Date(now.getTime() - 45 * 60_000) },
      { orgId: org, entityId: "ENT-SG-02", runAs, trigger: "schedule", dedupeKey: "ops:q2", runAfter: new Date(now.getTime() + 3_600_000) },
    ]);
    await ownerDb().execute(sql`delete from login_failures`);
    for (let i = 0; i < 3; i++) await ownerDb().execute(sql`insert into login_failures (email_sha256) values (${"f".repeat(64)})`);
    await ownerDb().execute(sql`delete from chain_reads where at >= now() - interval '1 hour'`).catch(() => undefined);
    for (const [status, tx] of [["ok", "a"], ["unavailable", "b"], ["unavailable", "c"]] as const) {
      await ownerDb().execute(sql`insert into chain_reads (org_id, entity_id, network, tx_hash, status, source, at) values (${org}, 'ENT-SG-01', 'tron', ${tx.repeat(64)}, ${status}, 'fictional-test', ${now})`);
    }
    const m = await collectMetrics(jobsDb(), new Date(now.getTime() + 1000), { windowMinutes: 15 });
    expect(m).toMatchObject({ deadJobs: 1, loginFailures: 3, queuedDue: 1, chain: { tron: { total: 3, unavailable: 2 } } });
    expect(m.oldestDueSeconds).toBeGreaterThanOrEqual(45 * 60);
    expect(m.workerLastSeen).toBeInstanceOf(Date);
    const raw = JSON.stringify((await jobsDb().execute(sql`select ops_alert_metrics(now() - interval '15 minutes', now()) as m`)).rows[0]);
    for (const secret of [org, runAs, "ENT-SG-01", MERCHANT_SEED_ORGS.sg.slug, "f".repeat(64)]) expect(raw).not.toContain(secret);
  });

  it("runAlertsOnce through the jobs login: fires, then stays quiet, with counts-only notifications", async () => {
    const sent: AlertNotification[] = [];
    const sink = { async send(n: AlertNotification) { sent.push(n); } };
    const store = new MemoryAlertStateStore();
    const env = { CLEARLINE_ALERT_CHAIN_MIN_READS: "3", CLEARLINE_DEPLOY_ENV: "local" };
    const r = await runAlertsOnce({ db: jobsDb(), now: new Date(Date.now() + 1000), sink, store, env });
    expect(r.rules).toEqual(["failed_runs", "job_backlog", "chain_provider_outage:tron"]);
    expect(r.sent).toBe(3);
    expect((await runAlertsOnce({ db: jobsDb(), now: new Date(Date.now() + 2000), sink, store, env })).sent).toBe(0);
    const text = JSON.stringify(sent);
    for (const secret of [seed.orgs.sg, seed.users["ops@straits-demo.example"], "ENT-SG-01", "ops@straits-demo.example"]) expect(text).not.toContain(secret);
  });
});
