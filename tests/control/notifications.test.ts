/**
 * rc7 phase 3b: in-app notifications against PostgreSQL 16. Raised by the database on real events (a run, new
 * exceptions, a bank statement waiting for a second person, an approval request, a rule-change notice); each member
 * sees only those of their CURRENT role in their own organisation; reads are per member; the runtime role cannot
 * forge one; an Approver who did not prepare the run acknowledges a rule-change notice. Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { liveKey, seedSgLive, sgChain, type LiveSg } from "./live-data";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { acknowledgeRuleChange, listNotifications, markNotificationsRead, unreadCount } from "../../src/server/notifications";
import { proposeWriteoff, runReconciliation, updateMerchantPolicy } from "../../src/server/merchant";
import { RULE_SET_VERSION } from "../../src/server/runs";

let s: LiveSeed;
let live: LiveSg;
let finB: TenantContext, approverB: TenantContext;
const kinds = async (c: TenantContext) => (await listNotifications(c)).notifications.map((n) => n.kind).sort();

async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}

beforeAll(async () => {
  useTestStorage();
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-notify");
  live = await seedSgLive(s);
  finB = await liveCtx(s, "finance@live-b.example", "b");
  approverB = await liveCtx(s, "approver@live-b.example", "b");
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("raised by the database, shown by role", () => {
  it("a finished run and the exceptions it opened reach Payment Operations and Finance by owner role", async () => {
    const ops = await kinds(live.ops), fin = await kinds(live.fin);
    expect(ops).toContain("run_finished");
    expect(fin).toContain("run_finished");
    const ex = await ownerDb().select().from(t.reconExceptions).where(eq(t.reconExceptions.orgId, live.ops.orgId));
    const opsEx = (await listNotifications(live.ops)).notifications.filter((n) => n.kind === "exception_assigned").map((n) => n.subjectId).sort();
    const finEx = (await listNotifications(live.fin)).notifications.filter((n) => n.kind === "exception_assigned").map((n) => n.subjectId).sort();
    expect(opsEx).toEqual(ex.filter((e) => e.ownerRole === "Payment Operations").map((e) => e.id).sort());
    expect(finEx).toEqual(ex.filter((e) => e.ownerRole !== "Payment Operations").map((e) => e.id).sort());
    expect(opsEx.length + finEx.length).toBe(ex.length);
  });

  it("a validated bank statement waits for an Approver; viewers and admins see nothing", async () => {
    expect(await kinds(live.approver)).toContain("bank_statement_waiting");
    expect((await listNotifications(live.viewer)).notifications).toEqual([]);
    expect((await listNotifications(live.admin)).notifications).toEqual([]);
  });

  it("a run that changes nothing raises nothing; a failed run reaches Payment Operations and Finance", async () => {
    const before = (await listNotifications(live.ops)).notifications.length;
    expect((await runReconciliation(live.ops, live.entityId, liveKey(), { chain: sgChain() })).body.status).toBe("no_change");
    expect((await listNotifications(live.ops)).notifications.length).toBe(before);
    await ownerDb().insert(t.reconciliationRuns).values({ orgId: live.ops.orgId, entityId: live.entityId, trigger: "schedule", startedBy: live.ops.userId, ruleSetVersion: RULE_SET_VERSION,
      policyRevision: 1, status: "failed", startedAt: new Date(), finishedAt: new Date(), errorCode: "CHAIN_UNAVAILABLE" });
    const failed = (await listNotifications(live.fin)).notifications.find((n) => n.kind === "run_failed")!;
    expect(failed.title).toBe(`Reconciliation of ${live.entityId} failed (CHAIN_UNAVAILABLE)`);
  });

  it("an approval request reaches the Approvers", async () => {
    await updateMerchantPolicy(live.admin, live.entityId, { allowImportedBankLinesAsVerified: true }, 1, liveKey());
    await runReconciliation(live.ops, live.entityId, liveKey(), { chain: sgChain() });
    const [wo] = await ownerDb().select().from(t.writeoffProposals).where(and(eq(t.writeoffProposals.orgId, live.fin.orgId), eq(t.writeoffProposals.status, "proposed")));
    const req = (await proposeWriteoff(live.fin, wo.id, liveKey())).body;
    const n = (await listNotifications(live.approver)).notifications.find((x) => x.kind === "approval_waiting")!;
    expect(n).toMatchObject({ subjectId: req.requestId, href: "/control/merchant/approvals" });
    expect(await kinds(live.ops)).not.toContain("approval_waiting");
  });
});

describe("isolation", () => {
  it("another merchant's members see none of these, even with the same role; a member cannot read another organisation's", async () => {
    expect((await listNotifications(finB)).notifications).toEqual([]);
    expect((await listNotifications(approverB)).notifications).toEqual([]);
    const cross = await withTenant({ userId: live.fin.userId, orgId: finB.orgId }, (tx) => tx.select().from(t.notifications), { read: true });
    expect(cross).toEqual([]);
    const own = await withTenant({ userId: finB.userId, orgId: live.fin.orgId }, (tx) => tx.select().from(t.notifications), { read: true });
    expect(own).toEqual([]);
  });

  it("the runtime role cannot write, change or delete a notification", async () => {
    await expect(withTenant({ userId: live.fin.userId, orgId: live.fin.orgId }, (tx) => tx.insert(t.notifications).values({
      orgId: live.fin.orgId, kind: "run_failed", audienceRole: "finance", subjectType: "run", subjectId: "x", title: "Forged notification", dedupeKey: "forged" }))).rejects.toThrow();
    await expect(withTenant({ userId: live.fin.userId, orgId: live.fin.orgId }, (tx) => tx.execute(sql`update notifications set title = 'changed' where org_id = ${live.fin.orgId}`))).rejects.toThrow();
    await expect(withTenant({ userId: live.fin.userId, orgId: live.fin.orgId }, (tx) => tx.execute(sql`delete from notifications where org_id = ${live.fin.orgId}`))).rejects.toThrow();
    await expect(withTenant({ userId: live.fin.userId, orgId: live.fin.orgId }, (tx) => tx.execute(sql`select raise_notification(${live.fin.orgId}::uuid, 'run_failed', array['finance'], null, null, 'run', 'x', 'Forged', 'forged2')`))).rejects.toThrow();
  });

  it("reads are per member; a notification of another role cannot be marked read", async () => {
    const before = await unreadCount(live.fin);
    expect(before).toBeGreaterThan(0);
    const opsIds = (await listNotifications(live.ops)).notifications.map((n) => n.id);
    expect((await markNotificationsRead(live.fin, { ids: opsIds })).marked).toBe(0); // one row per audience role: none of these is Finance's
    const finIds = (await listNotifications(live.fin)).notifications.map((n) => n.id);
    expect((await markNotificationsRead(live.fin, { ids: finIds })).marked).toBe(finIds.length);
    expect(await unreadCount(live.fin)).toBe(0);
    expect(await unreadCount(live.ops)).toBe(opsIds.length);
    await expect(withTenant({ userId: live.fin.userId, orgId: live.fin.orgId }, (tx) => tx.insert(t.notificationReads).values({ orgId: live.fin.orgId, notificationId: opsIds[0], userId: live.fin.userId }))).rejects.toThrow();
  });

  it("a revoked member sees nothing; a member whose role changed sees the new role's notifications only", async () => {
    await ownerDb().update(t.organizationMemberships).set({ role: "viewer" }).where(and(eq(t.organizationMemberships.orgId, live.ops.orgId), eq(t.organizationMemberships.userId, live.ops.userId)));
    const asViewer = await resolveTenant({ userId: live.ops.userId, name: "ops", email: "ops" }, s.slugs.a);
    expect((await listNotifications(asViewer)).notifications).toEqual([]);
    await ownerDb().update(t.organizationMemberships).set({ role: "payment_ops" }).where(and(eq(t.organizationMemberships.orgId, live.ops.orgId), eq(t.organizationMemberships.userId, live.ops.userId)));
  });
});

describe("rule-change notices: acknowledged by an Approver who did not prepare the run", () => {
  it("raises a notice for Finance and Approvers; Finance cannot acknowledge; the Approver can, once", async () => {
    const [run] = await ownerDb().select().from(t.reconciliationRuns).where(and(eq(t.reconciliationRuns.orgId, live.ops.orgId), eq(t.reconciliationRuns.status, "changed"))).limit(1);
    const [notice] = await ownerDb().insert(t.ruleChangeNotices).values({ orgId: live.ops.orgId, entityId: live.entityId, orderId: "SG-1002", runId: run.id, ruleSetVersion: RULE_SET_VERSION,
      policyRevision: 2, storedDecision: "matched_with_difference", storedRuleId: "M4.tolerance.within_band", newDecision: "suggested_for_review", newRuleId: "M4.tolerance.writeoff_threshold", fingerprint: "fp-1" }).returning();
    const n = (await listNotifications(live.approver)).notifications.find((x) => x.kind === "rule_change")!;
    expect(n.notice).toEqual({ orderId: "SG-1002", acknowledged: null });
    expect(await kinds(live.fin)).toContain("rule_change");
    await refused(acknowledgeRuleChange(live.fin, notice.id, {}, liveKey()), "ACCESS_403");
    await acknowledgeRuleChange(live.approver, notice.id, { note: "Seen (fictional)" }, liveKey());
    expect((await listNotifications(live.approver)).notifications.find((x) => x.kind === "rule_change")!.notice!.acknowledged).toMatchObject({ by: expect.any(String) });
    await refused(acknowledgeRuleChange(await liveCtx(s, "approver2@live-a.example", "a"), notice.id, {}, liveKey()), "ALREADY_ACKNOWLEDGED");
    await refused(acknowledgeRuleChange(approverB, notice.id, {}, liveKey()), "ACCESS_404");
  });

  it("the member who started the run cannot acknowledge its notice (database check too)", async () => {
    const [run] = await ownerDb().insert(t.reconciliationRuns).values({ orgId: live.ops.orgId, entityId: live.entityId, trigger: "manual", startedBy: live.approver.userId, ruleSetVersion: RULE_SET_VERSION,
      policyRevision: 2, status: "failed", startedAt: new Date(), finishedAt: new Date(), errorCode: "INTERNAL" }).returning();
    const [notice] = await ownerDb().insert(t.ruleChangeNotices).values({ orgId: live.ops.orgId, entityId: live.entityId, orderId: "SG-1001", runId: run.id, ruleSetVersion: RULE_SET_VERSION,
      policyRevision: 2, storedDecision: "matched", storedRuleId: "M5.batch.tied_verified", newDecision: "exception", newRuleId: "M1.chain.unavailable", fingerprint: "fp-2" }).returning();
    await refused(acknowledgeRuleChange(live.approver, notice.id, {}, liveKey()), "PREPARER_CANNOT_ACKNOWLEDGE");
    await expect(withTenant({ userId: live.approver.userId, orgId: live.approver.orgId }, (tx) => tx.insert(t.ruleChangeAcks).values({ orgId: live.approver.orgId, noticeId: notice.id, ackedBy: live.approver.userId })))
      .rejects.toThrow();
    await expect(withTenant({ userId: live.fin.userId, orgId: live.fin.orgId }, (tx) => tx.insert(t.ruleChangeAcks).values({ orgId: live.fin.orgId, noticeId: notice.id, ackedBy: live.fin.userId })))
      .rejects.toThrow();
  });
});
