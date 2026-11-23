/**
 * rc7 phase 3a against PostgreSQL 16: the job queue (two workers never take the same job; a failure retries with
 * backoff, then the job is dead), the daily schedule (once per merchant day, from 02:00 merchant time by default), a
 * re-run after a rule or policy change, the worker acting as the member who set the schedule (re-checked at every
 * run), logs with ids and counts only, and isolation between merchants. Test mode · illustrative data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { revokeMembership } from "../../src/server/admin";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { runReconciliation } from "../../src/server/merchant";
import { RULE_SET_VERSION, listRuns, setRunSchedule } from "../../src/server/runs";
import { backoffMs, claimJob, enqueueDue, runWorkerOnce, type Job, type WorkerLog } from "../../src/server/jobs";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `jq-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const as = (userId: string, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(q));
const runsOf = (orgId: string, entityId: string) => rows(sql`select * from reconciliation_runs where org_id = ${orgId} and entity_id = ${entityId} order by started_at, finished_at`);
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
async function policyRevision(orgId: string, entityId: string) {
  return Number((await rows(sql`select revision from merchant_policy where org_id = ${orgId} and entity_id = ${entityId}`))[0].revision);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const addJob = (o: Partial<typeof t.jobs.$inferInsert> & { orgId: string; entityId: string; runAs: string }) =>
  ownerDb().insert(t.jobs).values({ trigger: "schedule", dedupeKey: `test:${++n}`, runAfter: new Date("2026-01-01T00:00:00Z"), ...o }).returning().then((r) => r[0]);

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  // ENT-SG-01's last run was under another rule-set version (as after a deploy that changed the rules)
  await runReconciliation(await ctx("ops@straits-demo.example", "sg"), "ENT-SG-01", key(), { ruleSetVersion: "test-rules#3" });
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("job queue", () => {
  beforeEach(async () => { await ownerDb().delete(t.jobs); });

  it("two workers never take the same job (SELECT … FOR UPDATE SKIP LOCKED)", async () => {
    const runAs = seed.users["ops@straits-demo.example"];
    const a1 = await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-01", runAs });
    const a2 = await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-02", runAs });
    const now = new Date("2026-06-01T00:00:00Z");
    let second: Promise<Job | null> | undefined;
    const first = await ownerDb().transaction(async (tx) => {
      const j = await claimJob(tx, "worker-a", now);
      second = claimJob(ownerDb(), "worker-b", now); // while worker A still holds its job
      await sleep(300);
      return j;
    });
    const other = await second!;
    expect(first?.id).toBeDefined();
    expect(other?.id).toBeDefined();
    expect(new Set([first!.id, other!.id])).toEqual(new Set([a1.id, a2.id]));
    expect([first!.lockedBy, other!.lockedBy].sort()).toEqual(["worker-a", "worker-b"]);
    // many jobs, two concurrent workers: each job runs exactly once
    await ownerDb().delete(t.jobs);
    for (let i = 0; i < 12; i++) await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-01", runAs });
    const seen: string[] = [];
    const handler = async (j: Job) => { seen.push(j.id); await sleep(5); return { runId: null, status: "done" as const }; };
    await Promise.all(["w1", "w2"].map((w) => runWorkerOnce({ owner: ownerDb(), handler, workerId: w, now: () => now })));
    expect(seen.length).toBe(12);
    expect(new Set(seen).size).toBe(12);
    expect((await rows(sql`select status, attempts, count(*)::int as n from jobs group by status, attempts`))).toEqual([{ status: "done", attempts: 1, n: 12 }]);
  });

  it("a failure retries with backoff, then the job is dead after max attempts; a refused member's job dies at once", async () => {
    const runAs = seed.users["ops@straits-demo.example"];
    const job = await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-01", runAs, maxAttempts: 3 });
    let now = new Date("2026-06-01T00:00:00Z");
    const boom = async () => { throw new Error("Row 7: ACME Ltd, 1234.56"); };
    const w = () => runWorkerOnce({ owner: ownerDb(), handler: boom, workerId: "w", now: () => now });
    expect(await w()).toMatchObject({ retried: 1, dead: 0 });
    let [j] = await ownerDb().select().from(t.jobs).where(eq(t.jobs.id, job.id));
    expect(j).toMatchObject({ status: "queued", attempts: 1, lastErrorCode: "INTERNAL", lockedBy: null });
    expect(j.runAfter.getTime() - now.getTime()).toBe(backoffMs(1));
    expect(await w()).toMatchObject({ retried: 0, dead: 0 }); // not due yet
    now = new Date(j.runAfter.getTime());
    expect(await w()).toMatchObject({ retried: 1 });
    [j] = await ownerDb().select().from(t.jobs).where(eq(t.jobs.id, job.id));
    expect(j.runAfter.getTime() - now.getTime()).toBe(backoffMs(2));
    expect(backoffMs(2)).toBe(2 * backoffMs(1));
    now = new Date(j.runAfter.getTime());
    expect(await w()).toMatchObject({ dead: 1 });
    [j] = await ownerDb().select().from(t.jobs).where(eq(t.jobs.id, job.id));
    expect(j).toMatchObject({ status: "dead", attempts: 3, lastErrorCode: "INTERNAL" });
    now = new Date(now.getTime() + 86_400_000);
    expect(await w()).toMatchObject({ retried: 0, dead: 0, done: 0 }); // a dead job is never taken again
    const refused = await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-01", runAs });
    await runWorkerOnce({ owner: ownerDb(), handler: async () => { throw new AccessDenied(403, "no"); }, now: () => now });
    expect((await ownerDb().select().from(t.jobs).where(eq(t.jobs.id, refused.id)))[0]).toMatchObject({ status: "dead", attempts: 1, lastErrorCode: "ACCESS_403" });
  });

  it("the daily schedule enqueues an entity's run once per merchant day, from 02:00 merchant time by default", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    await setRunSchedule(ops, "ENT-SG-02", {}, key());
    const s = (await listRuns(ops)).schedules.find((x) => x.entityId === "ENT-SG-02");
    expect(s).toMatchObject({ localTime: "02:00", enabled: true });
    const sched = (now: string) => enqueueDue(ownerDb(), new Date(now));
    // Singapore merchant day is UTC+08:00: 02:00 on 25 November is 18:00Z on the 24th
    expect((await sched("2026-11-24T17:59:00Z")).daily).toBe(0);
    expect((await sched("2026-11-24T18:00:00Z")).daily).toBe(1);
    expect((await sched("2026-11-24T23:00:00Z")).daily).toBe(0);
    expect((await sched("2026-11-25T15:59:00Z")).daily).toBe(0); // 23:59 on the 25th
    expect((await sched("2026-11-25T18:30:00Z")).daily).toBe(1);
    expect((await rows(sql`select dedupe_key from jobs where org_id = ${seed.orgs.sg} and entity_id = 'ENT-SG-02' and trigger = 'schedule' order by dedupe_key`)).map((x) => x.dedupe_key)).toEqual(["day:2026-11-25", "day:2026-11-26"]);
    // a direct second enqueue of the same day is refused by the unique key
    await dbRefuses(ownerDb().insert(t.jobs).values({ orgId: seed.orgs.sg, entityId: "ENT-SG-02", runAs: ops.userId, trigger: "schedule", dedupeKey: "day:2026-11-25", runAfter: new Date() }), /jobs_dedupe_idx/);
    // the time is configurable per entity; turned off, nothing is enqueued
    await setRunSchedule(ops, "ENT-SG-02", { localTime: "06:30" }, key());
    expect((await sched("2026-11-26T22:00:00Z")).daily).toBe(0); // 06:00 on the 27th
    expect((await sched("2026-11-26T22:30:00Z")).daily).toBe(1);
    await setRunSchedule(ops, "ENT-SG-02", { enabled: false }, key());
    expect((await sched("2026-11-28T22:30:00Z")).daily).toBe(0);
    // only Payment Operations or Finance set a schedule, and only for themselves
    await expect(setRunSchedule(await ctx("approver@straits-demo.example", "sg"), "ENT-SG-02", {}, key())).rejects.toBeInstanceOf(AccessDenied);
    await dbRefuses(as(ops.userId, ops.orgId, sql`update reconciliation_schedules set run_as = ${seed.users["finance@straits-demo.example"]} where entity_id = 'ENT-SG-02'`), /row-level security/);
  });

  it("a rule-set version or policy revision different from the last run enqueues one re-run", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    await setRunSchedule(ops, "ENT-SG-01", { localTime: "23:59" }, key());
    const now = new Date("2026-11-24T00:00:00Z");
    expect(await enqueueDue(ownerDb(), now)).toEqual({ daily: 0, ruleChange: 1 }); // the last run was under test-rules#3
    expect(await enqueueDue(ownerDb(), now)).toEqual({ daily: 0, ruleChange: 0 });
    expect(await enqueueDue(ownerDb(), now, "test-rules#4")).toEqual({ daily: 0, ruleChange: 1 });
    expect((await rows(sql`select trigger, dedupe_key from jobs where org_id = ${seed.orgs.sg} order by dedupe_key`))).toEqual([
      { trigger: "rule_change", dedupe_key: `rules:${RULE_SET_VERSION}/p${await policyRevision(seed.orgs.sg, "ENT-SG-01")}` },
      { trigger: "rule_change", dedupe_key: `rules:test-rules#4/p${await policyRevision(seed.orgs.sg, "ENT-SG-01")}` },
    ]);
  });

  it("the worker runs a due job as the member who set the schedule; logs carry ids and counts only", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    await setRunSchedule(ops, "ENT-US-02", { localTime: "02:00" }, key());
    await setRunSchedule(ops, "ENT-SG-01", { enabled: false }, key());
    const logs: WorkerLog[] = [];
    const now = new Date("2026-11-30T19:00:00Z");
    const s = await runWorkerOnce({ owner: ownerDb(), now: () => now, log: (l) => logs.push(l) });
    expect(s).toMatchObject({ done: 1, dead: 0, retried: 0 });
    const [job] = await ownerDb().select().from(t.jobs).where(and(eq(t.jobs.orgId, seed.orgs.sg), eq(t.jobs.entityId, "ENT-US-02")));
    expect(job).toMatchObject({ status: "done", trigger: "schedule", dedupeKey: "day:2026-12-01", attempts: 1 });
    const [run] = (await runsOf(seed.orgs.sg, "ENT-US-02")).filter((x) => x.status !== "failed");
    expect(run).toMatchObject({ id: job.runId, trigger: "schedule", job_id: job.id, started_by: ops.userId, status: "changed" });
    // a failing job's log never quotes the error; every line holds ids, codes and counts only
    const bad = await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-02", runAs: ops.userId, maxAttempts: 1 });
    await runWorkerOnce({ owner: ownerDb(), now: () => now, log: (l) => logs.push(l), handler: async () => { throw new Error("Row 7: ACME Ltd paid 1,234.56 to 0xabc"); } });
    expect(logs.map((l) => l.event)).toEqual(["scheduled", "job_claimed", "job_done", "job_claimed", "job_dead"]);
    expect(logs.at(-1)).toEqual({ event: "job_dead", jobId: bad.id, orgId: seed.orgs.sg, entityId: "ENT-SG-02", attempt: 1, code: "INTERNAL" });
    const text = JSON.stringify(logs);
    for (const bit of ["ACME", "1,234.56", "0xabc", "Row 7", "@", "fictional", "BK-"]) expect(text).not.toContain(bit);
    for (const l of logs) for (const [k, v] of Object.entries(l)) {
      expect(["event", "jobId", "orgId", "entityId", "runId", "attempt", "status", "code", "counts"]).toContain(k);
      if (k === "counts") for (const x of Object.values(v as object)) expect(typeof x).toBe("number");
      else expect(String(v)).toMatch(/^[A-Za-z0-9._:#/-]{1,128}$/);
    }
  });

  it("a revoked member's scheduled job dies; a schedule changed after enqueue cancels its job", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    await setRunSchedule(fin, "ENT-SG-02", { localTime: "02:00" }, key());
    const j = await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-02", runAs: fin.userId });
    const ops = await ctx("ops@straits-demo.example", "sg");
    const stale = await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-02", runAs: ops.userId });
    await revokeMembership(ownerDb(), { orgSlug: SLUG.sg, email: "finance@straits-demo.example" });
    const now = new Date("2026-06-01T00:00:00Z");
    await runWorkerOnce({ owner: ownerDb(), now: () => now });
    const got = Object.fromEntries((await ownerDb().select().from(t.jobs)).map((x) => [x.id, [x.status, x.lastErrorCode]]));
    expect(got[j.id][0]).toBe("dead");
    expect(String(got[j.id][1])).toMatch(/^ACCESS_40[34]$/);
    expect(got[stale.id]).toEqual(["cancelled", "SCHEDULE_CHANGED"]);
  });
});

describe("isolation between merchants", () => {
  it("jobs and schedules of one merchant are invisible to another; members can neither enqueue nor change jobs", async () => {
    const ae = await ctx("ops@dunehaven-demo.example", "ae");
    const sg = await ctx("ops@straits-demo.example", "sg");
    await setRunSchedule(sg, "ENT-SG-01", { localTime: "02:00" }, key());
    await addJob({ orgId: seed.orgs.sg, entityId: "ENT-SG-01", runAs: sg.userId });
    for (const tb of ["jobs", "reconciliation_schedules"]) {
      expect((await as(ae.userId, ae.orgId, sql`select count(*)::int as n from ${sql.identifier(tb)} where org_id = ${seed.orgs.sg}`)).rows[0].n, tb).toBe(0);
      expect((await as(ae.userId, seed.orgs.sg, sql`select count(*)::int as n from ${sql.identifier(tb)}`)).rows[0].n, tb).toBe(0);
      expect(Number((await as(sg.userId, sg.orgId, sql`select count(*)::int as n from ${sql.identifier(tb)}`)).rows[0].n), tb).toBeGreaterThan(0);
    }
    expect((await listRuns(ae)).schedules).toEqual([]);
    await dbRefuses(as(sg.userId, sg.orgId, sql`insert into jobs (org_id, entity_id, trigger, dedupe_key, run_as, run_after) values (${sg.orgId}, 'ENT-SG-01', 'schedule', 'forged', ${sg.userId}, now())`), /permission denied/);
    await dbRefuses(as(sg.userId, sg.orgId, sql`update jobs set status = 'done'`), /permission denied/);
    await dbRefuses(as(ae.userId, seed.orgs.sg, sql`insert into reconciliation_schedules (org_id, entity_id, run_as) values (${seed.orgs.sg}, 'ENT-SG-02', ${ae.userId})`), /row-level security/);
  });
});
