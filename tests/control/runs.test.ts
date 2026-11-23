/**
 * rc7 phase 3a against PostgreSQL 16: reconciliation runs (recorded, idempotent, append-only, a code and counts but
 * never file contents) and rule-set versions (a new version or policy revision re-runs only the payments nobody
 * closed; a closed payment that would now be decided differently gets a notice instead of a change); runs and notices
 * of one merchant are invisible to another. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { decideWriteoff, proposeWriteoff, runReconciliation, updateMerchantPolicy } from "../../src/server/merchant";
import { addExceptionNote, decideMerchantApproval, requestMerchantResolution } from "../../src/server/merchant-ui";
import { ACTIVE_RULE_IDS, MERCHANT_ENGINE_VERSION, RULE_SET_VERSION, listRuns, ruleSetVersionOf } from "../../src/server/runs";
import { RULES } from "../../src/lib/clearline/merchant";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `rr-key-${++n}-${Date.now()}`;
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
/** Everything a run may write, by table: row count and a digest of the rows. */
async function state(orgId: string) {
  const out: Record<string, string> = {};
  for (const tb of ["match_records", "differences", "recon_exceptions", "writeoff_proposals", "merchant_journal_proposals", "approval_requests", "rule_change_notices"]) {
    out[tb] = String((await rows(sql`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from ${sql.identifier(tb)} x where org_id = ${orgId}`))[0].h);
  }
  return out;
}

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("reconciliation runs", () => {
  it("'Reconcile now' records a manual run: rule-set version, policy revision, input hash and counts", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const r = (await runReconciliation(ops, "ENT-SG-01", key())).body;
    expect(r).toMatchObject({ changed: true, status: "changed", ruleSetVersion: RULE_SET_VERSION, policyRevision: 1 });
    const [run] = await runsOf(seed.orgs.sg, "ENT-SG-01");
    const decided = await rows(sql`select m.decision, count(*)::int as n from match_records m join invoices i on i.org_id = m.org_id and i.order_id = m.order_id where m.org_id = ${seed.orgs.sg} and i.entity_id = 'ENT-SG-01' group by m.decision`);
    const count = (d: string) => Number(decided.find((x) => x.decision === d)?.n ?? 0);
    expect(run).toMatchObject({ id: r.runId, trigger: "manual", status: "changed", started_by: ops.userId, rule_set_version: RULE_SET_VERSION, policy_revision: 1, input_sha256: r.inputSha256, error_code: null,
      matched: count("matched"), with_difference: count("matched_with_difference"), review: count("suggested_for_review"), kept: 0, notices: 0 });
    expect(Number(run.with_difference)).toBeGreaterThan(0);
    expect(Number(run.exceptions)).toBe(Number((await rows(sql`select count(*)::int as n from recon_exceptions where org_id = ${seed.orgs.sg} and status <> 'resolved'`))[0].n));
    const listed = await listRuns(await ctx("finance@straits-demo.example", "sg"));
    expect(listed.runs.map((x) => [x.id, x.trigger, x.status])).toEqual([[r.runId, "manual", "changed"]]);
  });

  it("the same input under the same rule version writes nothing and the run says 'no change'", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const before = await state(seed.orgs.sg);
    const audit = (await rows(sql`select count(*)::int as n from audit_events where org_id = ${seed.orgs.sg}`))[0].n;
    const r = (await runReconciliation(ops, "ENT-SG-01", key())).body;
    expect(r).toMatchObject({ changed: false, status: "no_change", newDifferences: 0, newWriteoffs: 0 });
    expect(await state(seed.orgs.sg)).toEqual(before);
    expect((await rows(sql`select count(*)::int as n from audit_events where org_id = ${seed.orgs.sg}`))[0].n).toBe(audit);
    const runs = await runsOf(seed.orgs.sg, "ENT-SG-01");
    expect(runs.map((x) => x.status)).toEqual(["changed", "no_change"]);
    expect(runs[1]).toMatchObject({ input_sha256: runs[0].input_sha256, matched: runs[0].matched, with_difference: runs[0].with_difference, exceptions: runs[0].exceptions });
    // a retried request (same idempotency key) replays the same run: no second row
    const k = key();
    const a = await runReconciliation(ops, "ENT-SG-01", k);
    const b = await runReconciliation(ops, "ENT-SG-01", k);
    expect([b.replayed, b.body.runId]).toEqual([true, a.body.runId]);
    expect((await runsOf(seed.orgs.sg, "ENT-SG-01")).length).toBe(3);
  });

  it("a failed run is recorded with a code, never the message; runs are append-only and recorded for the signed-in member", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const k = key();
    await runReconciliation(ops, "ENT-SG-02", k);
    await expect(runReconciliation(ops, "ENT-US-02", k)).rejects.toBeInstanceOf(RequestRefused);
    const [failed] = await runsOf(seed.orgs.sg, "ENT-US-02");
    expect(failed).toMatchObject({ status: "failed", error_code: "IDEMPOTENCY_KEY_REUSED", input_sha256: null, matched: 0 });
    await dbRefuses(ownerDb().execute(sql`insert into reconciliation_runs (org_id, entity_id, trigger, started_by, rule_set_version, policy_revision, status, started_at, finished_at, error_code)
      values (${seed.orgs.sg}, 'ENT-US-02', 'manual', ${ops.userId}, 'x', 1, 'failed', now(), now(), 'Row 7: ACME Ltd paid 1,234.56')`), /reconciliation_runs_error_chk/);
    await dbRefuses(as(ops.userId, ops.orgId, sql`update reconciliation_runs set status = 'changed' where org_id = ${ops.orgId}`), /append-only|permission denied/);
    await dbRefuses(ownerDb().execute(sql`delete from reconciliation_runs where org_id = ${seed.orgs.sg}`), /append-only/);
    await dbRefuses(as(ops.userId, ops.orgId, sql`insert into reconciliation_runs (org_id, entity_id, trigger, started_by, rule_set_version, policy_revision, status, input_sha256, started_at, finished_at)
      values (${ops.orgId}, 'ENT-SG-01', 'manual', ${seed.users["finance@straits-demo.example"]}, 'x', 1, 'no_change', ${"0".repeat(64)}, now(), now())`), /row-level security/);
    // a member without the permission starts no run at all
    const runs = (await runsOf(seed.orgs.sg, "ENT-SG-01")).length;
    await expect(runReconciliation(await ctx("approver@straits-demo.example", "sg"), "ENT-SG-01", key())).rejects.toBeInstanceOf(AccessDenied);
    expect((await runsOf(seed.orgs.sg, "ENT-SG-01")).length).toBe(runs);
  });
});

describe("rule versions", () => {
  it("the rule-set version is derived from the engine version and the active rule ids", () => {
    expect(ACTIVE_RULE_IDS).toEqual(expect.arrayContaining(Object.keys(RULES)));
    expect(RULE_SET_VERSION).toBe(ruleSetVersionOf(ACTIVE_RULE_IDS));
    expect(RULE_SET_VERSION.startsWith(`${MERCHANT_ENGINE_VERSION}#`)).toBe(true);
    expect(ruleSetVersionOf(ACTIVE_RULE_IDS.filter((id) => id !== "M4.tolerance.sender_side_fee"))).not.toBe(RULE_SET_VERSION);
    expect(ruleSetVersionOf([...ACTIVE_RULE_IDS].reverse())).toBe(RULE_SET_VERSION);
  });

  it("a new rule-set version or a new policy revision re-runs the same input", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    expect((await runReconciliation(ops, "ENT-SG-01", key())).body.status).toBe("no_change");
    const v2 = (await runReconciliation(ops, "ENT-SG-01", key(), { ruleSetVersion: "test-rules#2" })).body;
    expect(v2).toMatchObject({ status: "changed", ruleSetVersion: "test-rules#2" });
    expect((await runReconciliation(ops, "ENT-SG-01", key(), { ruleSetVersion: "test-rules#2" })).body.status).toBe("no_change");
    expect((await runReconciliation(ops, "ENT-SG-01", key())).body).toMatchObject({ status: "changed", ruleSetVersion: RULE_SET_VERSION });
    expect((await runReconciliation(ops, "ENT-SG-01", key())).body.status).toBe("no_change");
    // the same values saved again: a new revision with an identical input hash still re-runs
    const admin = await ctx("admin@straits-demo.example", "sg");
    await updateMerchantPolicy(admin, "ENT-SG-01", { toleranceBps: 50 }, await policyRevision(seed.orgs.sg, "ENT-SG-01"), key());
    const p = (await runReconciliation(ops, "ENT-SG-01", key())).body;
    expect(p).toMatchObject({ status: "changed", inputSha256: v2.inputSha256, policyRevision: 2, ruleSetVersion: RULE_SET_VERSION });
  });

  it("a rule change re-runs only unclosed payments: an approved write-off and an approved resolution keep their decision, and a different new decision becomes a notice", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const fin = await ctx("finance@straits-demo.example", "sg");
    const appr = await ctx("approver@straits-demo.example", "sg");
    // a person closes BK-24817 (write-off approved) and BK-24823 (resolution approved)
    const wo = String((await rows(sql`select id from writeoff_proposals where org_id = ${seed.orgs.sg} and order_id = 'BK-24817' and status = 'proposed'`))[0].id);
    const req = (await proposeWriteoff(fin, wo, key())).body;
    await decideWriteoff(appr, req.requestId, { decision: "approve", reason: "Sender-side fee confirmed (fictional)", payloadSha256: req.payloadSha256 }, key());
    const ev = (await addExceptionNote(ops, "EX-BK-24823", { kind: "evidence", body: "Balance receipt reviewed (fictional)." }, key())).body as { id: string };
    const rr = (await requestMerchantResolution(ops, { exceptionId: "EX-BK-24823", note: "Customer paid the balance through the link (fictional).", evidenceIds: [ev.id] }, key())).body;
    await decideMerchantApproval(appr, rr.requestId, { decision: "approve", reason: "Receipt reviewed (fictional).", payloadSha256: rr.payloadSha256 }, key());
    const closedBefore = await rows(sql`select order_id, decision, rule_id, input_sha256, explanation::text as e from match_records where org_id = ${seed.orgs.sg} and order_id in ('BK-24817', 'BK-24823') order by order_id`);
    const openBefore = await rows(sql`select order_id, input_sha256 from match_records m where org_id = ${seed.orgs.sg} and order_id not in ('BK-24817', 'BK-24823') and exists (select 1 from invoices i where i.org_id = m.org_id and i.order_id = m.order_id and i.entity_id = 'ENT-SG-01')`);
    expect(openBefore.length).toBeGreaterThan(0);

    // the Admin lowers the write-off threshold below BK-24817's 1.35 fee: under the new policy it would go to review
    const admin = await ctx("admin@straits-demo.example", "sg");
    await updateMerchantPolicy(admin, "ENT-SG-01", { writeoffThresholdMinor: 100 }, await policyRevision(seed.orgs.sg, "ENT-SG-01"), key());
    const r = (await runReconciliation(ops, "ENT-SG-01", key(), { trigger: "rule_change" })).body;
    expect(r).toMatchObject({ status: "changed", kept: 2, notices: 1 });

    // closed payments are exactly as they were; the approved write-off and the resolution stand
    expect(await rows(sql`select order_id, decision, rule_id, input_sha256, explanation::text as e from match_records where org_id = ${seed.orgs.sg} and order_id in ('BK-24817', 'BK-24823') order by order_id`)).toEqual(closedBefore);
    expect((await rows(sql`select status from writeoff_proposals where org_id = ${seed.orgs.sg} and id = ${wo}`))[0].status).toBe("approved");
    expect((await rows(sql`select status from recon_exceptions where org_id = ${seed.orgs.sg} and id = 'EX-BK-24823'`))[0].status).toBe("resolved");
    // every other payment of the entity was re-run on the new input
    for (const o of openBefore) expect((await rows(sql`select input_sha256 from match_records where org_id = ${seed.orgs.sg} and order_id = ${o.order_id}`))[0].input_sha256, String(o.order_id)).toBe(r.inputSha256);
    // the notice names the payment, the stored decision and what the new rules would decide
    const notices = await rows(sql`select order_id, stored_decision, new_decision, new_rule_id, run_id, policy_revision from rule_change_notices where org_id = ${seed.orgs.sg}`);
    expect(notices).toEqual([{ order_id: "BK-24817", stored_decision: "matched_with_difference", new_decision: "suggested_for_review", new_rule_id: "M4.tolerance.writeoff_threshold", run_id: r.runId, policy_revision: r.policyRevision }]);
    const [run] = (await runsOf(seed.orgs.sg, "ENT-SG-01")).slice(-1);
    expect(run).toMatchObject({ trigger: "rule_change", kept: 2, notices: 1 });
    // the same difference is noticed once, not at every run
    expect((await runReconciliation(ops, "ENT-SG-01", key(), { ruleSetVersion: "test-rules#3" })).body).toMatchObject({ status: "changed", notices: 0, kept: 2 });
    expect((await listRuns(fin)).notices.map((x) => [x.orderId, x.storedDecision, x.newDecision])).toEqual([["BK-24817", "matched_with_difference", "suggested_for_review"]]);
  });
});

describe("isolation between merchants", () => {
  it("runs and notices of one merchant are invisible to another, and cannot be written for it", async () => {
    const ae = await ctx("ops@dunehaven-demo.example", "ae");
    await runReconciliation(ae, "ENT-AE-03", key());
    expect((await listRuns(ae)).runs.map((r) => r.entityId)).toEqual(["ENT-AE-03"]);
    expect((await listRuns(ae)).notices).toEqual([]);
    expect(Number((await rows(sql`select count(*)::int as n from rule_change_notices where org_id = ${seed.orgs.sg}`))[0].n)).toBeGreaterThan(0);
    for (const tb of ["reconciliation_runs", "rule_change_notices"]) {
      expect((await as(ae.userId, ae.orgId, sql`select count(*)::int as n from ${sql.identifier(tb)} where org_id = ${seed.orgs.sg}`)).rows[0].n, tb).toBe(0);
      // forcing the other merchant into the context does not help a non-member
      expect((await as(ae.userId, seed.orgs.sg, sql`select count(*)::int as n from ${sql.identifier(tb)}`)).rows[0].n, tb).toBe(0);
    }
    await dbRefuses(as(ae.userId, ae.orgId, sql`insert into reconciliation_runs (org_id, entity_id, trigger, started_by, rule_set_version, policy_revision, status, input_sha256, started_at, finished_at)
      values (${seed.orgs.sg}, 'ENT-SG-01', 'manual', ${ae.userId}, 'x', 1, 'no_change', ${"0".repeat(64)}, now(), now())`), /row-level security/);
    await dbRefuses(as(ae.userId, seed.orgs.sg, sql`insert into rule_change_notices (org_id, entity_id, order_id, run_id, rule_set_version, policy_revision, stored_decision, stored_rule_id, new_decision, new_rule_id, fingerprint)
      values (${seed.orgs.sg}, 'ENT-SG-01', 'BK-24817', gen_random_uuid(), 'x', 1, 'matched', 'x', 'exception', 'x', 'forged')`), /row-level security/);
  });
});
