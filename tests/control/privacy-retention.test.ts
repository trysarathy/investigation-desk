/**
 * v1 phase 5.6: the retention job. Uploads go after their merchant's retention (here 10 days for merchant A, the
 * 90-day default for B), with their files and an audit event each; stored files no upload names go after an hour;
 * audit events and approvals go after 7 years (an approval a write-off still names is kept); a deleted merchant's
 * minimal records go after their retain_until, then the empty receipt. A dry run counts exactly what a real run
 * removes and changes nothing; a second run removes nothing; every run is recorded with counts only.
 * Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, utimesSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { liveKey, pushFile } from "./live-data";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { setRetentionDays } from "../../src/server/uploads";
import { allTables } from "../../src/server/merchant-deletion";
import { runRetention } from "../../src/server/privacy/retention";
import { uploadStorage } from "../../src/server/storage";
import type { Mapping } from "../../src/lib/clearline/mapping";

const LEDGER: Mapping = { fileType: "ledger_invoices", columns: { invoice_number: { header: "Invoice" }, total: { header: "Total" }, currency: { header: "Ccy" } } };
const OLD = new Date("2018-03-01T00:00:00Z");
let s: LiveSeed;
let dir: string;
let aUpload: string, bUpload: string, orphanKey: string;
let oldReq: string, keptReq: string, youngReq: string, oldDeletion: string, youngDeletion: string;
const now = () => new Date(Date.now() + 11 * 86_400_000);

async function raw(table: string, q: ReturnType<typeof sql>) {
  await ownerDb().execute(sql`alter table ${sql.identifier(table)} disable trigger user`);
  try { await ownerDb().execute(q); } finally { await ownerDb().execute(sql`alter table ${sql.identifier(table)} enable trigger user`); }
}
/** Every table's rows (hashed) and every stored file: to show a dry run changes nothing. */
async function snapshot() {
  const out: Record<string, string> = {};
  for (const tb of await allTables(ownerDb())) {
    if (tb === "retention_runs") continue;
    const rows = (await ownerDb().execute(sql`select x::text as r from ${sql.identifier(tb)} x order by 1`)).rows.map((r) => String(r.r));
    out[tb] = createHash("sha256").update(rows.join("\n")).digest("hex");
  }
  out.storage = JSON.stringify((await uploadStorage().list!()).map((f) => `${f.orgId}/${f.storageKey}`).sort());
  return out;
}

beforeAll(async () => {
  dir = useTestStorage();
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-ret");
  const adminA = await liveCtx(s, "admin@live-a.example", "a");
  await setRetentionDays(adminA, 10, liveKey());
  const finA = await liveCtx(s, "finance@live-a.example", "a"), finB = await liveCtx(s, "finance@live-b.example", "b");
  aUpload = await pushFile(finA, finA, "ENT-LIVE-SG", "ledger_invoices", "a.csv", new TextEncoder().encode("Invoice,Total,Ccy\nRT-1,10.00,SGD\n"), LEDGER);
  bUpload = await pushFile(finB, finB, "ENT-LIVE-AE", "ledger_invoices", "b.csv", new TextEncoder().encode("Invoice,Total,Ccy\nRT-2,20.00,AED\n"), LEDGER);
  // a stored file no upload names, two hours old
  orphanKey = (await uploadStorage().put(s.orgs.a, new TextEncoder().encode("fictional orphan"))).storageKey;
  const old = new Date(Date.now() - 2 * 3_600_000);
  utimesSync(path.join(dir, s.orgs.a, orphanKey), old, old);

  const A = s.orgs.a, B = s.orgs.b;
  const fin = s.users["finance@live-a.example"], appr = s.users["approver@live-a.example"];
  for (const org of [A, B]) await ownerDb().insert(t.auditEvents).values({ orgId: org, source: "server", action: "fictional_old_event", summary: "old (fictional)", at: OLD });
  [oldReq, keptReq, youngReq] = [randomUUID(), randomUUID(), randomUUID()];
  const sha = "a".repeat(64);
  for (const [id, at] of [[oldReq, OLD], [keptReq, OLD], [youngReq, new Date()]] as const) {
    await raw("approval_requests", sql`insert into approval_requests (org_id, id, subject_kind, subject_id, version, payload, payload_sha256, requested_by, status, created_at, closed_at)
      values (${A}, ${id}, 'merchant_writeoff', ${`WO-${id}@1`}, 1, '{}'::jsonb, ${sha}, ${fin}, 'approved', ${at}, ${at})`);
    await raw("approval_decisions", sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256, created_at) values (${A}, ${id}, ${appr}, 'approve', 'fictional', ${sha}, ${at})`);
  }
  await raw("invoices", sql`insert into invoices (org_id, order_id, entity_id, amount_minor, currency, status, issued_at) values (${A}, 'ORD-RT-1', 'ENT-LIVE-SG', 100, 'SGD', 'open', now())`);
  await raw("writeoff_proposals", sql`insert into writeoff_proposals (org_id, id, order_id, amount_minor, currency, difference_ids, prepared_by, approval_request_id, status) values (${A}, 'WO-RT-1', 'ORD-RT-1', 100, 'SGD', '[]'::jsonb, ${fin}, ${keptReq}, 'approved')`);
  // a deleted merchant's minimal records: one past its retention period (deleted in 2018), one still inside it
  [oldDeletion, youngDeletion] = [randomUUID(), randomUUID()];
  await ownerDb().insert(t.merchantDeletions).values([{ id: oldDeletion, orgRef: "b".repeat(64), deletedAt: OLD, counts: {}, retained: 1 }, { id: youngDeletion, orgRef: "c".repeat(64), deletedAt: new Date(), counts: {}, retained: 1 }]);
  await ownerDb().insert(t.retainedRecords).values([
    { deletionId: oldDeletion, kind: "audit_event", position: 0, occurredAt: new Date("2010-01-01T00:00:00Z"), retainUntil: new Date("2017-01-01T00:00:00Z"), record: { action: "x" } },
    { deletionId: youngDeletion, kind: "audit_event", position: 0, occurredAt: new Date(), retainUntil: new Date(Date.now() + 7 * 365 * 86_400_000), record: { action: "x" } },
  ]);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

const EXPECTED = { uploads: 1, files: 1, orphanFiles: 1, auditEvents: 2, approvalRequests: 1, approvalsKeptReferenced: 1, retainedRecords: 1 };

describe("retention job", () => {
  it("a dry run counts what would go and changes nothing; it is recorded as a dry run", async () => {
    const before = await snapshot();
    const r = await runRetention(ownerDb(), { now: now(), dryRun: true });
    expect(r.counts).toEqual(EXPECTED);
    expect(await snapshot()).toEqual(before);
    const [run] = await ownerDb().select().from(t.retentionRuns).where(eq(t.retentionRuns.id, r.runId));
    expect(run).toMatchObject({ dryRun: true, status: "done", counts: EXPECTED, errorCode: null });
  });

  it("removes exactly that, keeps everything else, and audits it", async () => {
    const r = await runRetention(ownerDb(), { now: now() });
    expect(r.counts).toMatchObject({ ...EXPECTED, approvalDecisions: 1, deletionReceipts: 1 });
    const status = async (id: string) => (await ownerDb().select({ s: t.uploads.status }).from(t.uploads).where(eq(t.uploads.id, id)))[0].s;
    expect(await status(aUpload)).toBe("deleted");
    expect(await status(bUpload)).not.toBe("deleted"); // B keeps the 90-day default
    expect(readdirSync(path.join(dir, s.orgs.a))).toEqual([]);
    expect(readdirSync(path.join(dir, s.orgs.b)).length).toBe(1);
    expect(existsSync(path.join(dir, s.orgs.a, orphanKey))).toBe(false);
    expect((await ownerDb().select().from(t.auditEvents).where(eq(t.auditEvents.action, "fictional_old_event"))).length).toBe(0);
    const reqs = (await ownerDb().select({ id: t.approvalRequests.id }).from(t.approvalRequests).where(eq(t.approvalRequests.orgId, s.orgs.a))).map((x) => x.id).sort();
    expect(reqs).toEqual([keptReq, youngReq].sort());
    expect((await ownerDb().select().from(t.approvalDecisions).where(eq(t.approvalDecisions.requestId, oldReq))).length).toBe(0);
    expect((await ownerDb().select().from(t.retainedRecords)).map((x) => x.deletionId)).toEqual([youngDeletion]);
    expect((await ownerDb().select().from(t.merchantDeletions)).map((x) => x.id)).toEqual([youngDeletion]);
    // each organisation's own log says what went (counts only); the upload purge is audited per upload
    for (const org of [s.orgs.a, s.orgs.b]) {
      const [ev] = await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, org), eq(t.auditEvents.action, "retention_purged")));
      expect(ev.details).toEqual(org === s.orgs.a ? { auditEvents: 1, approvals: 1, years: 7 } : { auditEvents: 1, approvals: 0, years: 7 });
    }
    expect((await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.a), eq(t.auditEvents.action, "upload_purged")))).length).toBe(1);
    // append-only again
    await expect(ownerDb().execute(sql`delete from audit_events where org_id = ${s.orgs.b}`)).rejects.toThrow();
  });

  it("a second run removes nothing (idempotent); all runs are kept, append-only", async () => {
    const r = await runRetention(ownerDb(), { now: now() });
    expect(Object.entries(r.counts).filter(([, n]) => n !== 0)).toEqual([["approvalsKeptReferenced", 1]]); // still kept, nothing removed
    const runs = await ownerDb().select().from(t.retentionRuns).orderBy(desc(t.retentionRuns.startedAt));
    expect(runs.map((x) => x.dryRun)).toEqual([false, false, true]);
    await expect(ownerDb().execute(sql`delete from retention_runs`)).rejects.toThrow();
    await expect(runRetention(ownerDb(), { now: now(), auditYears: 0 })).rejects.toThrow(/one whole year/);
  });
});
