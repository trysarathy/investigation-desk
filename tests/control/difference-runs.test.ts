/**
 * v1 phase 0 against PostgreSQL 16: every difference names the run and rule-set version that produced it; a run that
 * re-decides a payment marks the payment's earlier rows superseded (when, by which run) instead of deleting or
 * changing them; pages, exports and month-end count the current rows only, once; the superseded rows stay in the
 * evidence and audit views; a payment a person closed is never touched. Case 3 (two parts on two chains) is the
 * scenario: after part 1 one difference (the open 7,347.50); after part 2 two new ones and the first superseded.
 * Also: the database refuses every other change to a difference. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, adapterParts, finalisedFrom, seedMerchantCases } from "../../src/server/merchant-seed";
import { decideWriteoff, ingestAdapterOutput, merchantPaymentDetail, monthEnd, proposeWriteoff, runReconciliation } from "../../src/server/merchant";
import { evidencePack } from "../../src/server/merchant-ui";
import { RULE_SET_VERSION } from "../../src/server/runs";
import { case3 } from "../../src/lib/clearline/merchant/fixtures/case3";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `dr-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug, provider: MERCHANT_SEED_ORGS.provider.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const as = (userId: string, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(q));
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
const diffsOf = (orgId: string, orderId: string) => rows(sql`select id, type, amount_minor::text as a, currency, reason, rule_id, run_id, rule_set_version, stamp_source,
  superseded_at, superseded_by_run_id from differences where org_id = ${orgId} and order_id = ${orderId} order by type, id`);
const csvSections = (csv: string, orderId: string) => csv.split("\n").filter((l) => l.includes(orderId)).map((l) => l.split(",")[0]);

let run1 = "";
let run2 = "";

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD, case3: "after_part_1" });
  const ops = await ctx("ops@dunehaven-demo.example", "ae");
  run1 = (await runReconciliation(ops, "ENT-AE-03", key())).body.runId;
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(await ctx("ops@straits-demo.example", "sg"), e, key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("every difference names the run and rule-set version that produced it", () => {
  it("after part 1: one current difference, written by the first run, under the code's rule-set version", async () => {
    const ds = await diffsOf(seed.orgs.ae, "BK-25102");
    expect(ds.map((d) => [d.type, d.a, d.run_id, d.rule_set_version, d.stamp_source, d.superseded_at, d.superseded_by_run_id]))
      .toEqual([["partial_payment_open", "-734750", run1, RULE_SET_VERSION, "run", null, null]]);
    // every row of every organisation is stamped by a run recorded for that organisation
    const unstamped = await rows(sql`select count(*)::int as n from differences d where d.stamp_source <> 'run'
      or not exists (select 1 from reconciliation_runs r where r.org_id = d.org_id and r.id = d.run_id and r.rule_set_version = d.rule_set_version)`);
    expect(unstamped[0].n).toBe(0);
  });
});

describe("a run that re-decides a payment supersedes its earlier rows (kept, never deleted, amounts unchanged)", () => {
  it("after part 2: two new rows from the second run; the part-1 row is superseded by it, with its amount and reason as they were", async () => {
    const ops = await ctx("ops@dunehaven-demo.example", "ae");
    const before = await diffsOf(seed.orgs.ae, "BK-25102");
    const { parts, finalised } = await adapterParts(case3());
    await ingestAdapterOutput(ops, "ENT-AE-03", parts, key(), { finalised: finalisedFrom(finalised) });
    const r = (await runReconciliation(ops, "ENT-AE-03", key())).body;
    run2 = r.runId;
    expect(r).toMatchObject({ changed: true, newDifferences: 2, supersededDifferences: 1 });
    const ds = await diffsOf(seed.orgs.ae, "BK-25102");
    expect(ds).toHaveLength(3);
    const old = ds.find((d) => d.id === before[0].id)!;
    expect(old).toMatchObject({ type: "partial_payment_open", a: "-734750", reason: before[0].reason, rule_id: before[0].rule_id, run_id: run1, superseded_by_run_id: run2 });
    expect(old.superseded_at).not.toBeNull();
    expect(ds.filter((d) => d.superseded_at === null).map((d) => [d.type, d.a, d.run_id, d.rule_set_version])).toEqual([["rate_difference", "-130", run2, RULE_SET_VERSION], ["underpayment", "-1286", run2, RULE_SET_VERSION]]);
    // the current rows are exactly the ones the stored decision names
    const named = await rows(sql`select jsonb_array_elements(explanation->'differences')->>'persistedId' as id from match_records where org_id = ${seed.orgs.ae} and order_id = 'BK-25102' order by 1`);
    expect(named.map((x) => x.id)).toEqual(ds.filter((d) => d.superseded_at === null).map((d) => d.id).sort());
  });

  it("the payment page reads the current rows only and shows the superseded one apart; nothing is counted twice", async () => {
    const fin = await ctx("finance@dunehaven-demo.example", "ae");
    const d = await merchantPaymentDetail(fin, "BK-25102");
    const cur = d.differences as unknown as { type: string; amountMinor: string }[];
    expect(cur.map((x) => [x.type, x.amountMinor]).sort()).toEqual([["rate_difference", "-130"], ["underpayment", "-1286"]]);
    expect((d.supersededDifferences as unknown as { type: string; supersededByRunId: string }[]).map((x) => [x.type, x.supersededByRunId])).toEqual([["partial_payment_open", run2]]);
    // the current differences sum to the open balance (14.16); with the superseded row it would be 7,361.66
    expect(cur.reduce((a, x) => a + BigInt(x.amountMinor), 0n)).toBe(-1416n);
    const ledger = d.parts.ledger as { openBalanceMinor: string };
    expect(ledger.openBalanceMinor).toBe("1416");
  });

  it("exports and month-end: current differences counted once; superseded ones in their own evidence section", async () => {
    const fin = await ctx("finance@dunehaven-demo.example", "ae");
    for (const scope of [{ kind: "payment" as const, orderId: "BK-25102" }, { kind: "month" as const, entityId: "ENT-AE-03", month: "2026-12" }]) {
      const json = JSON.parse(String((await evidencePack(fin, scope, "json")).body)) as { differences: { orderId: string; type: string; runId: string }[]; supersededDifferences: { orderId: string; type: string; supersededByRunId: string }[] };
      expect(json.differences.filter((x) => x.orderId === "BK-25102").map((x) => [x.type, x.runId]).sort()).toEqual([["rate_difference", run2], ["underpayment", run2]]);
      expect(json.supersededDifferences.filter((x) => x.orderId === "BK-25102").map((x) => [x.type, x.supersededByRunId])).toEqual([["partial_payment_open", run2]]);
      const csv = String((await evidencePack(fin, scope, "csv")).body);
      const sec = csvSections(csv, "BK-25102");
      expect(sec.filter((x) => x === "difference")).toHaveLength(2);
      expect(sec.filter((x) => x === "difference_superseded")).toHaveLength(1);
    }
    const me = await monthEnd(fin, "ENT-AE-03", "2026-12");
    // month-end reads the current decisions: what is still owed is the 14.16 of the current differences
    expect(me.openReceivablesMinor).toBe("1416");
  });

  it("an identical rerun under a new rule-set version re-decides the payment the same way: no new row, nothing superseded", async () => {
    const ops = await ctx("ops@dunehaven-demo.example", "ae");
    const before = await diffsOf(seed.orgs.ae, "BK-25102");
    const r = (await runReconciliation(ops, "ENT-AE-03", key(), { ruleSetVersion: `${RULE_SET_VERSION}-test-rerun` })).body;
    expect(r).toMatchObject({ changed: true, newDifferences: 0, supersededDifferences: 0 });
    expect(await diffsOf(seed.orgs.ae, "BK-25102")).toEqual(before);
  });

  it("an approved write-off's payment is never touched by a later run: its rows are neither superseded nor rewritten", async () => {
    const fin = await ctx("finance@dunehaven-demo.example", "ae");
    const appr = await ctx("approver@dunehaven-demo.example", "ae");
    const [wo] = await rows(sql`select id from writeoff_proposals where org_id = ${seed.orgs.ae} and order_id = 'BK-25102' and status = 'proposed'`);
    const req = (await proposeWriteoff(fin, String(wo.id), key())).body;
    await decideWriteoff(appr, req.requestId, { decision: "approve", reason: "Rate difference and short payment confirmed (fictional)", payloadSha256: req.payloadSha256 }, key());
    const before = await diffsOf(seed.orgs.ae, "BK-25102");
    const ops = await ctx("ops@dunehaven-demo.example", "ae");
    const r = (await runReconciliation(ops, "ENT-AE-03", key(), { ruleSetVersion: `${RULE_SET_VERSION}-test-after-approval` })).body;
    expect(r).toMatchObject({ changed: true, kept: 1, supersededDifferences: 0 });
    expect(await diffsOf(seed.orgs.ae, "BK-25102")).toEqual(before);
  });
});

describe("the database keeps differences append-only (only the supersede marking, once, by a run)", () => {
  it("refuses a delete, an amount change, a change through the supersede columns' grant, and undoing a supersede", async () => {
    const u = seed.users["ops@dunehaven-demo.example"];
    const o = seed.orgs.ae;
    await dbRefuses(as(u, o, sql`delete from differences where order_id = 'BK-25102'`), /permission denied|append-only/);
    await dbRefuses(as(u, o, sql`update differences set amount_minor = 0 where order_id = 'BK-25102'`), /permission denied/);
    await dbRefuses(as(u, o, sql`update differences set reason = 'changed', superseded_at = now(), superseded_by_run_id = ${run2} where order_id = 'BK-25102'`), /permission denied/);
    await dbRefuses(as(u, o, sql`update differences set superseded_at = null, superseded_by_run_id = null where order_id = 'BK-25102' and superseded_at is not null`), /append-only/);
    await dbRefuses(as(u, o, sql`update differences set superseded_at = now(), superseded_by_run_id = ${run1} where order_id = 'BK-25102' and superseded_at is not null`), /append-only/);
    // the schema owner (no grant needed) is refused just the same by the trigger
    await dbRefuses(ownerDb().execute(sql`update differences set amount_minor = 0 where org_id = ${o} and order_id = 'BK-25102'`), /append-only/);
    await dbRefuses(ownerDb().execute(sql`delete from differences where org_id = ${o}`), /append-only/);
  });
  it("refuses to supersede a difference an approved write-off relies on, and a supersede without a run", async () => {
    const u = seed.users["ops@dunehaven-demo.example"];
    const o = seed.orgs.ae;
    await dbRefuses(as(u, o, sql`update differences set superseded_at = now(), superseded_by_run_id = ${run2} where order_id = 'BK-25102' and superseded_at is null`), /approved write-off/);
    await dbRefuses(as(u, o, sql`update differences set superseded_at = now() where order_id = 'BK-25102' and superseded_at is null`), /append-only/);
  });
  it("refuses a new row without a run, with a legacy stamp, or born superseded", async () => {
    const u = seed.users["ops@dunehaven-demo.example"];
    const o = seed.orgs.ae;
    const ins = (cols: ReturnType<typeof sql>) => as(u, o, sql`insert into differences (org_id, id, order_id, type, amount_minor, currency, reason, rule_id, run_id, rule_set_version, stamp_source, superseded_at, superseded_by_run_id)
      values (${o}, ${`X-${++n}`}, 'BK-25102', 'unexplained', 1, 'AED', 'fictional test row', 'M4.test', ${cols})`);
    await dbRefuses(ins(sql`null, ${RULE_SET_VERSION}, 'run', null, null`), /names the run/);
    await dbRefuses(ins(sql`${run2}, 'legacy:unknown', 'backfill_unknown', null, null`), /names the run/);
    await dbRefuses(ins(sql`${run2}, ${RULE_SET_VERSION}, 'run', now(), ${run2}`), /names the run/);
  });
  it("another organisation's member cannot supersede (or see) this organisation's rows", async () => {
    const sgOps = seed.users["ops@straits-demo.example"];
    const r = await as(sgOps, seed.orgs.sg, sql`update differences set superseded_at = now(), superseded_by_run_id = ${run2} where org_id = ${seed.orgs.ae}`);
    expect(r.rowCount ?? 0).toBe(0);
    expect((await as(sgOps, seed.orgs.sg, sql`select count(*)::int as n from differences where org_id = ${seed.orgs.ae}`)).rows[0].n).toBe(0);
  });
  it("the app role's write grants on differences are INSERT and UPDATE of the two supersede columns only", async () => {
    const g = await rows(sql`select privilege_type from information_schema.role_table_grants where grantee = 'clearline_app' and table_name = 'differences' order by 1`);
    expect(g.map((x) => x.privilege_type)).toEqual(["INSERT", "SELECT"]);
    const c = await rows(sql`select column_name from information_schema.column_privileges where grantee = 'clearline_app' and table_name = 'differences' and privilege_type = 'UPDATE' order by 1`);
    expect(c.map((x) => x.column_name)).toEqual(["superseded_at", "superseded_by_run_id"]);
  });
});
