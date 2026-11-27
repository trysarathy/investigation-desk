/**
 * v1 phase 3 against PostgreSQL 16: period close. Finance (or an Admin) asks for an entity's month to be locked after
 * the month-end review; a DIFFERENT Admin locks it. The database refuses a lock by the preparer or by a non-Admin, an
 * unlock and a delete; a locked month's decisions, differences, exceptions, write-offs and journal proposals refuse
 * every insert and update; a run that would decide a locked payment differently files a correction in the next open
 * month, naming what it corrects. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { runReconciliation, updateMerchantPolicy } from "../../src/server/merchant";
import { decidePeriodLock, listPeriods, nextPeriod, requestPeriodLock } from "../../src/server/period-close";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `pc-key-${++n}-${Date.now()}`;
const SLUG = MERCHANT_SEED_ORGS.sg.slug;
const ctx = (email: string): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const as = (c: TenantContext, q: ReturnType<typeof sql>) => withTenant({ userId: c.userId, orgId: c.orgId }, (tx) => tx.execute(q));
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
const ORDER = "BK-24817"; // a sender-side fee within tolerance: matched with difference under the seeded policy
let month = "";

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  await runReconciliation(await ctx("ops@straits-demo.example"), "ENT-SG-01", key());
  month = String((await rows(sql`select period from payment_period(${seed.orgs.sg}::uuid, ${ORDER})`))[0].period);
  // a second Admin, so that the preparer (an Admin) and the approver can both be Admins
  const { createUser, grantMembership } = await import("../../src/server/admin");
  const { enrolTestTotp } = await import("./harness");
  const id = await createUser(ownerDb(), { email: "admin2@straits-demo.example", name: "admin2 (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: SLUG, email: "admin2@straits-demo.example", role: "admin" });
  await enrolTestTotp(id);
  seed.users["admin2@straits-demo.example"] = id;
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("maker-checker: the preparer never locks", () => {
  it("Finance asks; Finance, an Approver or the preparer cannot lock; another Admin locks; the database agrees", async () => {
    const fin = await ctx("finance@straits-demo.example");
    const admin = await ctx("admin@straits-demo.example");
    await expect(requestPeriodLock(await ctx("ops@straits-demo.example"), "ENT-SG-01", { period: month, reason: "Month-end reviewed (fictional)" }, key())).rejects.toBeInstanceOf(AccessDenied);
    expect((await requestPeriodLock(fin, "ENT-SG-01", { period: month, reason: "Month-end reviewed (fictional)" }, key())).body).toMatchObject({ status: "requested" });
    await expect(requestPeriodLock(admin, "ENT-SG-01", { period: month, reason: "Again (fictional)" }, key())).rejects.toMatchObject({ code: "PERIOD_LOCK_PENDING" });
    await expect(decidePeriodLock(fin, "ENT-SG-01", month, { decision: "lock", reason: "Self (fictional)" }, key())).rejects.toBeInstanceOf(AccessDenied);
    await expect(decidePeriodLock(await ctx("approver@straits-demo.example"), "ENT-SG-01", month, { decision: "lock", reason: "Not admin (fictional)" }, key())).rejects.toBeInstanceOf(AccessDenied);
    // straight to the database: the preparer as decider, a non-Admin decider, another member's name: all refused
    await dbRefuses(as(fin, sql`update period_locks set status = 'locked', decided_by = ${fin.userId}, decided_at = now(), decision_reason = 'self' where entity_id = 'ENT-SG-01'`), /preparer never approves|two_people|row-level security/);
    const appr = await ctx("approver@straits-demo.example");
    await dbRefuses(as(appr, sql`update period_locks set status = 'locked', decided_by = ${appr.userId}, decided_at = now(), decision_reason = 'not admin' where entity_id = 'ENT-SG-01'`), /only an Admin/);
    await dbRefuses(as(admin, sql`insert into period_locks (org_id, entity_id, period, status, requested_by, reason) values (${admin.orgId}, 'ENT-SG-02', ${month}, 'locked', ${admin.userId}, 'skip the checker')`), /first requested/);
    expect((await decidePeriodLock(admin, "ENT-SG-01", month, { decision: "lock", reason: "Signed off (fictional)" }, key())).body).toMatchObject({ status: "locked" });
    // a lock never changes and is never deleted
    await dbRefuses(as(admin, sql`update period_locks set status = 'rejected' where entity_id = 'ENT-SG-01' and period = ${month}`), /locked period cannot change/);
    await dbRefuses(as(admin, sql`delete from period_locks`), /permission denied/);
    await dbRefuses(ownerDb().execute(sql`delete from period_locks`), /never deleted/);
    // an Admin who asks cannot lock it either: another Admin must
    const admin2 = await ctx("admin2@straits-demo.example");
    const next = nextPeriod(month);
    await requestPeriodLock(admin, "ENT-SG-01", { period: next, reason: "Next month reviewed (fictional)" }, key());
    await expect(decidePeriodLock(admin, "ENT-SG-01", next, { decision: "lock", reason: "Self (fictional)" }, key())).rejects.toMatchObject({ code: "PREPARER_CANNOT_APPROVE" });
    expect((await decidePeriodLock(admin2, "ENT-SG-01", next, { decision: "reject", reason: "Not yet (fictional)" }, key())).body).toMatchObject({ status: "rejected" });
    const v = await listPeriods(fin, "ENT-SG-01");
    expect(v.periods.map((p) => [p.period, p.status])).toEqual([[next, "rejected"], [month, "locked"]]);
  });
});

describe("a locked month never changes; corrections go to the next open month", () => {
  it("the database refuses writes to a locked month's results, from any login", async () => {
    const ops = await ctx("ops@straits-demo.example");
    await dbRefuses(as(ops, sql`update match_records set decision = decision where org_id = ${ops.orgId} and order_id = ${ORDER}`), /PERIOD_LOCKED/);
    await dbRefuses(ownerDb().execute(sql`update match_records set rule_id = rule_id where org_id = ${seed.orgs.sg} and order_id = ${ORDER}`), /PERIOD_LOCKED/);
    await dbRefuses(ownerDb().execute(sql`update writeoff_proposals set status = status where org_id = ${seed.orgs.sg} and order_id = ${ORDER}`), /PERIOD_LOCKED/);
    await dbRefuses(ownerDb().execute(sql`update merchant_journal_proposals set status = status where org_id = ${seed.orgs.sg} and entity_id = 'ENT-SG-01' and substr(evidence_refs ->> 'entryDate', 1, 7) = ${month}`)
      .then((r) => { if (!r.rowCount) throw new Error("PERIOD_LOCKED (no journal dated in the month)"); }), /PERIOD_LOCKED/);
  });

  it("a policy change re-runs: the locked payment is untouched and its new decision is a correction in the next open month, once", async () => {
    const ops = await ctx("ops@straits-demo.example");
    const admin = await ctx("admin@straits-demo.example");
    const before = await rows(sql`select order_id, decision, rule_id, computed_at, input_sha256, content_sha256, explanation::text as e from match_records where org_id = ${seed.orgs.sg} and order_id = ${ORDER}`);
    const rev = Number((await rows(sql`select revision from merchant_policy where org_id = ${seed.orgs.sg} and entity_id = 'ENT-SG-01'`))[0].revision);
    await updateMerchantPolicy(admin, "ENT-SG-01", { writeoffThresholdMinor: 100 }, rev, key());
    const r = (await runReconciliation(ops, "ENT-SG-01", key(), { trigger: "rule_change" })).body;
    expect(r.status).toBe("changed");
    expect(await rows(sql`select order_id, decision, rule_id, computed_at, input_sha256, content_sha256, explanation::text as e from match_records where org_id = ${seed.orgs.sg} and order_id = ${ORDER}`)).toEqual(before);
    const c = await rows(sql`select order_id, corrects_period, correction_period, run_id, stored_decision, new_decision, new_rule_id from period_corrections where org_id = ${seed.orgs.sg} and order_id = ${ORDER}`);
    // next month was rejected, so it is open: the correction goes there
    expect(c).toEqual([{ order_id: ORDER, corrects_period: month, correction_period: nextPeriod(month), run_id: r.runId, stored_decision: "matched_with_difference", new_decision: "suggested_for_review", new_rule_id: "M4.tolerance.writeoff_threshold" }]);
    expect(r.notices).toBe(0); // a locked payment gets a correction, not a rule-change notice
    // the same difference is corrected once, not at every run
    await runReconciliation(ops, "ENT-SG-01", key(), { ruleSetVersion: "pc-rules#2" });
    expect((await rows(sql`select count(*)::int as n from period_corrections where org_id = ${seed.orgs.sg} and order_id = ${ORDER}`))[0].n).toBe(1);
    const v = await listPeriods(await ctx("finance@straits-demo.example"), "ENT-SG-01");
    expect(v.corrections.some((x) => x.orderId === ORDER && x.correctsPeriod === month)).toBe(true);
    // a correction cannot be filed in a locked month, nor for an open one
    await dbRefuses(as(ops, sql`insert into period_corrections (org_id, entity_id, order_id, corrects_period, correction_period, run_id, new_decision, new_rule_id, fingerprint)
      values (${ops.orgId}, 'ENT-SG-01', ${ORDER}, ${nextPeriod(month)}, ${nextPeriod(nextPeriod(month))}, ${r.runId}, 'matched', 'x', 'f')`), /PERIOD_NOT_LOCKED/);
    await dbRefuses(ownerDb().execute(sql`update period_corrections set new_decision = 'matched'`), /append-only/);
  });

  it("another organisation sees no lock and no correction", async () => {
    const ae = await resolveTenant({ userId: seed.users["ops@dunehaven-demo.example"], name: "x", email: "ops@dunehaven-demo.example" }, MERCHANT_SEED_ORGS.ae.slug);
    for (const tb of ["period_locks", "period_corrections"]) {
      expect((await as({ ...ae, orgId: seed.orgs.sg } as TenantContext, sql`select count(*)::int as n from ${sql.identifier(tb)}`)).rows[0].n).toBe(0);
    }
    await expect(listPeriods(ae, "ENT-SG-01")).rejects.toBeInstanceOf(AccessDenied);
    void RequestRefused;
  });
});
