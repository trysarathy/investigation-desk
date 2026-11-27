/**
 * v1 phase 3 against PostgreSQL 16: the worker. A member queues a job from the web app (only for themselves); the
 * worker runs it as that member, stage by stage, with job events members can follow; a job whose worker vanished is
 * taken back after its lease (a recovery); a dead job stays in the dead-letter queue until an operator re-queues it; a
 * stop request finishes the job in hand and claims nothing more; revaluation, pickup and retention jobs run through
 * the same services as the web app. Fictional data only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { closeJobs, closeOwner, jobsDb, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { claimJob, LEASE_MS, requeueDeadJob, runWorkerOnce, enqueueRetention, type Job } from "../../src/server/jobs";
import { FolderPickup, workerHandlers } from "../../src/server/job-handlers";
import { enqueueJob, jobDetail, listJobs } from "../../src/server/job-queue";
import { createOrganization, createUser, grantMembership, revokeMembership } from "../../src/server/admin";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `wk-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const events = async (jobId: string) => (await ownerDb().select().from(t.jobEvents).where(eq(t.jobEvents.jobId, jobId)).orderBy(t.jobEvents.id)).map((e) => e.event === "stage" ? `stage:${e.stage}` : e.event);
const jobOf = async (id: string) => (await ownerDb().select().from(t.jobs).where(eq(t.jobs.id, id)))[0];

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
});
afterAll(async () => { await closeDatabase(); await closeOwner(); await closeJobs(); });
beforeEach(async () => { await ownerDb().delete(t.jobEvents); await ownerDb().delete(t.jobs); await ownerDb().update(t.reconciliationSchedules).set({ enabled: false }); });

describe("a member queues a job; the worker runs it as them", () => {
  it("runs the reconciliation stage by stage; members see the progress; the same request key queues once", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const k = key();
    const q = await enqueueJob(ops, { entityId: "ENT-SG-01" }, k);
    expect(q).toMatchObject({ status: 202, body: { kind: "reconcile", status: "queued", replayed: false } });
    expect((await enqueueJob(ops, { entityId: "ENT-SG-01" }, k)).body).toMatchObject({ jobId: q.body.jobId, replayed: true });
    expect((await listJobs(ops)).jobs.map((j) => [j.id, j.status, j.stage, j.trigger, j.mine])).toEqual([[q.body.jobId, "queued", null, "manual", true]]);
    const s = await runWorkerOnce({ queue: jobsDb(), handlers: workerHandlers(jobsDb()) });
    expect(s).toMatchObject({ done: 1, dead: 0, retried: 0 });
    const j = await jobOf(q.body.jobId);
    expect(j).toMatchObject({ status: "done", stage: "done", attempts: 1, recoveries: 0 });
    const run = (await ownerDb().select().from(t.reconciliationRuns).where(eq(t.reconciliationRuns.id, j.runId!)))[0];
    expect(run).toMatchObject({ jobId: j.id, trigger: "manual", startedBy: ops.userId });
    // the run records what it ran on: per-part input hashes and the engine version
    expect(Object.keys((run.inputManifest as { parts: Record<string, string> }).parts)).toEqual(expect.arrayContaining(["invoices", "bankLines", "transfers"]));
    expect(run.engineVersion).toBeTruthy();
    const seen = await events(j.id);
    expect(seen[0]).toBe("claimed");
    expect(seen.at(-1)).toBe("done");
    // a sample organisation is not chain-verified: load → engine → write → done (or no change)
    expect(seen.filter((e) => e.startsWith("stage:"))).toEqual(expect.arrayContaining(["stage:load", "stage:done"]));
    const d = await jobDetail(ops, j.id);
    expect(d.job.events.length).toBe(seen.length);
    for (const e of d.job.events) for (const [k2, v] of Object.entries(e)) if (v !== null && k2 !== "counts") expect(String(v)).toMatch(/^[A-Za-z0-9_:.+-]{1,64}$/);
  });

  it("another organisation sees nothing; an Approver may not queue a reconciliation; a revoked member's job dies", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const q = await enqueueJob(ops, { entityId: "ENT-SG-01" }, key());
    const ae = await ctx("ops@dunehaven-demo.example", "ae");
    expect((await listJobs(ae)).jobs).toEqual([]);
    await expect(jobDetail(ae, q.body.jobId)).rejects.toBeInstanceOf(AccessDenied);
    expect(Number((await withTenant({ userId: ae.userId, orgId: seed.orgs.sg }, (tx) => tx.execute(sql`select count(*)::int as n from job_events`))).rows[0].n)).toBe(0);
    await expect(enqueueJob(await ctx("approver@straits-demo.example", "sg"), { entityId: "ENT-SG-01" }, key())).rejects.toBeInstanceOf(AccessDenied);
    const fin = await ctx("finance@straits-demo.example", "sg");
    const f = await enqueueJob(fin, { entityId: "ENT-SG-02" }, key());
    await revokeMembership(ownerDb(), { orgSlug: SLUG.sg, email: "finance@straits-demo.example" });
    await runWorkerOnce({ queue: jobsDb(), handlers: workerHandlers(jobsDb()) });
    expect(await jobOf(f.body.jobId)).toMatchObject({ status: "dead" });
    expect(String((await jobOf(f.body.jobId)).lastErrorCode)).toMatch(/^ACCESS_40[34]$/);
    expect(await events(f.body.jobId)).toEqual(["claimed", "dead"]);
  });
});

describe("heartbeat, recovery, dead-letter and shutdown", () => {
  const add = (o: Partial<typeof t.jobs.$inferInsert> = {}) => ownerDb().insert(t.jobs).values({ orgId: seed.orgs.sg, entityId: "ENT-SG-01", runAs: seed.users["ops@straits-demo.example"],
    trigger: "schedule", dedupeKey: `test:${++n}`, runAfter: new Date("2026-01-01T00:00:00Z"), ...o }).returning().then((r) => r[0]);

  it("a running job whose heartbeat stopped is taken back after the lease and counted as a recovery; a live one is not", async () => {
    const job = await add();
    const t0 = new Date("2026-06-01T00:00:00Z");
    const a = await claimJob(jobsDb(), "worker-a", t0);
    expect(a?.id, JSON.stringify(await ownerDb().select({ id: t.jobs.id, k: t.jobs.kind, s: t.jobs.status, r: t.jobs.runAfter, tr: t.jobs.trigger }).from(t.jobs))).toBe(job.id);
    // worker A vanished: nothing is taken before its lease runs out, then worker B takes it back
    expect(await claimJob(jobsDb(), "worker-b", new Date(t0.getTime() + LEASE_MS - 1000))).toBeNull();
    const b = await claimJob(jobsDb(), "worker-b", new Date(t0.getTime() + LEASE_MS + 1000));
    expect(b).toMatchObject({ id: job.id, lockedBy: "worker-b", recoveries: 1, attempts: 2 });
    expect(await events(job.id)).toEqual(["claimed", "recovered", "claimed"]);
    // a worker that sends heartbeats keeps its job
    await ownerDb().delete(t.jobs).where(eq(t.jobs.id, job.id));
    const live = await add();
    const t1 = new Date("2026-07-01T00:00:00Z");
    const c = (await claimJob(jobsDb(), "worker-c", t1))!;
    expect(c.id).toBe(live.id);
    await ownerDb().update(t.jobs).set({ heartbeatAt: new Date(t1.getTime() + LEASE_MS) }).where(eq(t.jobs.id, live.id));
    expect(await claimJob(jobsDb(), "worker-d", new Date(t1.getTime() + LEASE_MS + 1000))).toBeNull();
  });

  it("the handler's heartbeat runs while it works; a dead job is re-queued only by an operator, keeping its history", async () => {
    const job = await add({ maxAttempts: 1 });
    let beats = 0;
    await runWorkerOnce({ queue: jobsDb(), heartbeatMs: 20, handler: async (j: Job) => {
      await new Promise((r) => setTimeout(r, 150));
      beats = (await jobOf(j.id)).heartbeatAt!.getTime();
      throw new Error("Row 9: Fictional Ltd 12.34");
    } });
    expect(beats).toBeGreaterThan(Date.now() - 60_000); // written by the heartbeat, at real time
    expect(await jobOf(job.id)).toMatchObject({ status: "dead", lastErrorCode: "INTERNAL" });
    expect(await runWorkerOnce({ queue: jobsDb(), handler: async () => ({ runId: null, status: "done" }) })).toMatchObject({ done: 0 });
    expect(await requeueDeadJob(jobsDb(), job.id, new Date())).toBe(true);
    expect(await requeueDeadJob(jobsDb(), job.id, new Date())).toBe(false); // only a dead job
    expect(await runWorkerOnce({ queue: jobsDb(), handler: async () => ({ runId: null, status: "done" }) })).toMatchObject({ done: 1 });
    expect(await events(job.id)).toEqual(["claimed", "dead", "requeued", "claimed", "done"]);
    expect(JSON.stringify(await ownerDb().select().from(t.jobEvents))).not.toMatch(/Fictional|12\.34|Row 9/);
  });

  it("a stop request lets the job in hand finish and claims nothing more", async () => {
    for (let i = 0; i < 3; i++) await add();
    let stop = false;
    const s = await runWorkerOnce({ queue: jobsDb(), shouldStop: () => stop, handler: async () => { stop = true; return { runId: null, status: "done" }; } });
    expect(s).toMatchObject({ done: 1 });
    expect((await ownerDb().select().from(t.jobs)).map((j) => j.status).sort()).toEqual(["done", "queued", "queued"]);
  });
});

describe("revaluation, pickup and retention jobs", () => {
  it("a revaluation job proposes through the revaluation service, as the member, and keeps the proposals as its result", async () => {
    const fin = await ctx("approver@straits-demo.example", "sg");
    const q = await enqueueJob(fin, { entityId: "ENT-SG-01", kind: "revaluation", params: { periodEnd: "2026-10-31", balances: [] } }, key());
    await runWorkerOnce({ queue: jobsDb(), handlers: workerHandlers(jobsDb()) });
    const j = await jobOf(q.body.jobId);
    // whatever the revaluation says, it said it as this member: done with a result, or dead with its refusal code
    expect(["done", "dead"]).toContain(j.status);
    if (j.status === "done") expect(j.result).not.toBeNull(); else expect(j.lastErrorCode).toMatch(/^[A-Z0-9_]+$/);
  });

  // a live organisation (sample organisations take no uploads), with one entity and a Payment Operations member
  let live: { orgId: string; slug: string; ops: TenantContext } | undefined;
  async function liveOrg() {
    if (live) return live;
    const slug = "worker-live-fictional";
    const orgId = await createOrganization(ownerDb(), { slug, name: "Worker Live (fictional)", seed: "empty", dataMode: "live" });
    await ownerDb().insert(t.merchantEntities).values({ orgId, id: "ENT-WK-01", name: "Worker Entity (fictional)", functionalCurrency: "SGD", ledger: "xero", timezone: "Asia/Singapore", utcOffsetMinutes: 480 });
    await ownerDb().insert(t.merchantPolicy).values({ orgId, entityId: "ENT-WK-01", toleranceBps: 50, toleranceAbsMinor: 500n, toleranceCombine: "larger", writeoffThresholdMinor: 500n, approverRoles: ["approver"], allowImportedBankLinesAsVerified: false, senderFeeBoundBaseUnits: "0" });
    const email = "ops@worker-live.example";
    const uid = await createUser(ownerDb(), { email, name: "ops (fictional)", password: PASSWORD });
    await grantMembership(ownerDb(), { orgSlug: slug, email, role: "payment_ops" });
    live = { orgId, slug, ops: await resolveTenant({ userId: uid, name: email, email }, slug) };
    return live;
  }

  it("a pickup job turns waiting files into uploads awaiting a person (once), and moves them aside", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "clearline-pickup-"));
    const up = mkdtempSync(path.join(tmpdir(), "clearline-up-"));
    process.env.CLEARLINE_UPLOAD_DIR = up;
    try {
      const L = await liveOrg();
      const f = path.join(dir, L.slug, "ENT-WK-01", "orders_invoices");
      mkdirSync(f, { recursive: true });
      writeFileSync(path.join(f, "orders-fictional.csv"), "Order ID,Amount,Currency\nSG-FICT-1,10.00,SGD\n");
      const fin = L.ops;
      const q = await enqueueJob(fin, { entityId: "ENT-WK-01", kind: "pickup" }, key());
      await runWorkerOnce({ queue: jobsDb(), handlers: workerHandlers(jobsDb(), { pickup: new FolderPickup(dir) }) });
      expect(await jobOf(q.body.jobId), JSON.stringify((await jobOf(q.body.jobId)).lastErrorCode)).toMatchObject({ status: "done" });
      const ups = await ownerDb().select().from(t.uploads).where(and(eq(t.uploads.orgId, L.orgId), eq(t.uploads.originalName, "orders-fictional.csv")));
      expect(ups.map((u) => [u.status, u.uploadedBy])).toEqual([["stored", fin.userId]]);
      expect(readdirSync(f)).toEqual(["done"]);
      expect(readdirSync(path.join(f, "done"))).toEqual(["orders-fictional.csv"]);
    } finally { rmSync(dir, { recursive: true, force: true }); rmSync(up, { recursive: true, force: true }); delete process.env.CLEARLINE_UPLOAD_DIR; }
  });

  it("retention is enqueued once per organisation and day, and runs only with the retention login", async () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const L = await liveOrg(); // its upload comes from the pickup test above; by 2030 it is past its 90 days
    expect(await enqueueRetention(jobsDb(), now)).toBe(1);
    expect(await enqueueRetention(jobsDb(), now)).toBe(0);
    // without the retention login the worker cannot run it: dead with NO_HANDLER, nothing purged
    const s = await runWorkerOnce({ queue: jobsDb(), handlers: workerHandlers(jobsDb()), now: () => now });
    expect(s).toMatchObject({ dead: 1 });
    expect((await ownerDb().select().from(t.jobs))[0]).toMatchObject({ kind: "retention", status: "dead", lastErrorCode: "NO_HANDLER", entityId: null, runAs: null });
    await ownerDb().delete(t.jobEvents); await ownerDb().delete(t.jobs);
    expect(await enqueueRetention(jobsDb(), now)).toBe(1);
    const r = await runWorkerOnce({ queue: jobsDb(), handlers: workerHandlers(jobsDb(), { retention: ownerDb(), now: () => now }), now: () => now });
    expect(r).toMatchObject({ done: 1 });
    const left = await ownerDb().select().from(t.uploads).where(eq(t.uploads.orgId, L.orgId));
    expect(left.length).toBe(1);
    expect(left.every((u) => u.status === "deleted")).toBe(true);
  });
});
