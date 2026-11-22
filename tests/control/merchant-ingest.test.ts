/**
 * rc6 phase 6 against PostgreSQL 16: the three cases end to end through the adapters, the database and the engine,
 * with every figure read back from the persisted rows; idempotent reruns; imported bank lines. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { MERCHANT_SEED_ORGS, adapterParts, finalisedFrom, seedMerchantCases, seedMerchantEntity } from "../../src/server/merchant-seed";
import {
  bankLinesFromImport, batchBridge, dailyReport, exceptionsQueue, ingestAdapterOutput, listMerchantPayments, merchantPaymentDetail, monthEnd, pilotMetrics,
  recordMatchReview, logMinutes, runReconciliation, updateMerchantPolicy,
} from "../../src/server/merchant";
import { decideStatementImport, importStatementCsv, STATEMENT_COLUMNS, type ImportAccepted } from "../../src/server/imports";
import { case1 } from "../../src/lib/clearline/merchant/fixtures/case1";
import { case3 } from "../../src/lib/clearline/merchant/fixtures/case3";

const LABEL = "Test mode · illustrative data";
let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `mi-key-${++n}-${Date.now()}`;
const slugOf = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug, provider: MERCHANT_SEED_ORGS.provider.slug, imp: "import-demo-sg" };
const users: Record<string, string> = {};
const ctx = (email: string, org: keyof typeof slugOf): Promise<TenantContext> => resolveTenant({ userId: users[email], name: email, email }, slugOf[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const mr = async (orgId: string, orderId: string) => (await rows(sql`select * from match_records where org_id = ${orgId} and order_id = ${orderId}`))[0] as Record<string, never>;

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD, case3: "after_part_1" });
  Object.assign(users, seed.users);
  const ops = await ctx("ops@straits-demo.example", "sg");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) expect((await runReconciliation(ops, e, key())).body).toMatchObject({ changed: true, label: LABEL });
  expect((await runReconciliation(await ctx("ops@dunehaven-demo.example", "ae"), "ENT-AE-03", key())).body).toMatchObject({ changed: true });
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("seed: fictional provider, merchants and users, through the adapters", () => {
  it("a fictional provider with a white-label theme, two merchants under it, every row labelled fictional", async () => {
    const orgs = await rows(sql`select slug, name, kind, provider_org_id, theme from organizations where slug in (${slugOf.provider}, ${slugOf.sg}, ${slugOf.ae}) order by slug`);
    expect(orgs.map((o) => [o.slug, o.kind])).toEqual([["dunehaven-demo-ae", "merchant"], ["northwind-pay", "provider"], ["straits-demo-sg", "merchant"]]);
    expect(orgs.every((o) => String(o.name).endsWith("(fictional)"))).toBe(true);
    expect(orgs.find((o) => o.slug === "northwind-pay")!.theme).toMatchObject({ label: LABEL, name: "Northwind Pay (fictional)", logo: { kind: "placeholder" } });
    expect(orgs.filter((o) => o.kind === "merchant").every((o) => o.provider_org_id === seed.orgs.provider)).toBe(true);
    const ents = await rows(sql`select org_id, id from merchant_entities where org_id in (${seed.orgs.sg}, ${seed.orgs.ae}) order by id`);
    expect(ents.map((e) => e.id)).toEqual(["ENT-AE-03", "ENT-SG-01", "ENT-SG-02", "ENT-US-02"]);
    const sources = await rows(sql`select distinct source from chain_transfers where org_id in (${seed.orgs.sg}, ${seed.orgs.ae})`);
    expect(sources).toEqual([{ source: "recorded_fixture" }]);
  });
});

describe("Case 1 through the database (SGD, batch B-1124-001)", () => {
  it("persists the five parts, the deciding rule, the input hash and the engine version", async () => {
    const r = await mr(seed.orgs.sg, "BK-24817");
    expect(r).toMatchObject({ decision: "matched_with_difference", deciding_step: 4, rule_id: "M4.tolerance.within_band", engine_version: "rc6-merchant-engine/1" });
    expect(r.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.ledger).toMatchObject({ creditedMinor: "134865", openBalanceMinor: "135" });
    expect(r.bank).toMatchObject({ status: "in_batch", batchIds: ["B-1124-001"], batchTied: true, settlementVerified: true });
    expect((r.provider as { note: string }).note).toBe("provider statuses are claims, not proof");
    expect((await mr(seed.orgs.sg, "BK-24823")).decision).toBe("exception");
    expect((await mr(seed.orgs.sg, "BK-24836")).decision).toBe("suggested_for_review");
  });
  it("differences, exceptions (owner, reason, next step), the write-off and journals pending sign-off", async () => {
    const ds = await rows(sql`select id, type, amount_minor::text as a from differences where org_id = ${seed.orgs.sg} and order_id in ('BK-24817','BK-24823','BK-24830') order by id`);
    expect(ds.map((d) => [String(d.id).split("@")[0], d.type, d.a])).toEqual([["BK-24817.D1", "sender_side_fee", "-135"], ["BK-24823.D1", "underpayment", "-32400"], ["BK-24830.D1", "overpayment", "14580"]]);
    expect(ds.every((d) => /^BK-\d+\.D\d@[0-9a-f]{10}$/.test(String(d.id)))).toBe(true);
    const ex = await rows(sql`select id, owner_role, reason, next_step, status from recon_exceptions where org_id = ${seed.orgs.sg} and order_id like 'BK-248_%' and order_id < 'BK-24850' order by id`);
    expect(ex.map((e) => [e.id, e.owner_role, e.status])).toEqual([["EX-BK-24823", "Payment Operations", "open"], ["EX-BK-24830", "Payment Operations", "open"]]);
    expect(String(ex[0].next_step)).toContain("SGD 324.00");
    const wo = await rows(sql`select id, amount_minor::text as a, status, difference_ids from writeoff_proposals where org_id = ${seed.orgs.sg}`);
    expect(wo).toEqual([{ id: expect.stringMatching(/^WO-BK-24817@[0-9a-f]{10}$/), a: "135", status: "proposed", difference_ids: [ds[0].id] }]);
    const js = await rows(sql`select id, status, posting_rule_status, lines from merchant_journal_proposals where org_id = ${seed.orgs.sg} and entity_id = 'ENT-SG-01' order by id`);
    expect(js.every((j) => j.status === "proposed" && j.posting_rule_status === "pending_sign_off")).toBe(true);
    const setl = js.find((j) => j.id === "JP-SETL-B-1124-001")!.lines as { side: string; account: string; amountMinor: string }[];
    expect(setl.map((l) => [l.side, l.account, l.amountMinor])).toEqual([["debit", "bank", "596124"], ["debit", "payment_processing_fees", "6021"], ["credit", "provider_clearing", "602145"]]);
  });
  it("the bridge nets 5,961.24 and ties to the cent; the daily report says so with the cut-off note", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const b = await batchBridge(fin, "B-1124-001");
    expect(b).toMatchObject({ label: LABEL, tied: true, settlementVerified: true, cutOffNote: "provider day = UTC" });
    expect(b.lines.find((l) => l.kind === "net")!.amountMinor).toBe("596124");
    const d = await dailyReport(fin, "ENT-SG-01", "2026-11-24");
    expect(d).toMatchObject({ label: LABEL, cutOffNote: "provider day = UTC", summary: "4 payments · 1 settlement tied · 2 exceptions · 1 write-off awaiting approval" });
  });
});

describe("Case 2 through the database (one settlement, many payments; USD book)", () => {
  it("B-1125-SGD bridges 41,862.30 gross to 40,228.68 net, tied; B-1125-USD nets 9,355.50, tied", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const sgd = await batchBridge(fin, "B-1125-SGD");
    expect(sgd.tied).toBe(true);
    const line = (k: string) => sgd.lines.find((l) => l.kind === k)!.amountMinor;
    expect([line("gross"), line("provider_fee"), line("refund_netted"), line("net")]).toEqual(["4186230", "-41862", "-121500", "4022868"]);
    const usd = await batchBridge(fin, "B-1125-USD");
    expect(usd.tied).toBe(true);
    expect(usd.lines.find((l) => l.kind === "net")!.amountMinor).toBe("935550");
    const js = await rows(sql`select lines from merchant_journal_proposals where org_id = ${seed.orgs.sg} and id = 'JP-SETL-B-1125-SGD'`);
    expect((js[0].lines as { account: string; amountMinor: string }[]).map((l) => [l.account, l.amountMinor])).toEqual([["bank", "4022868"], ["payment_processing_fees", "41862"], ["sales_refunds", "121500"], ["provider_clearing", "4186230"]]);
  });
  it("the held order is an exception for Treasury; every other order matched", async () => {
    const all = await listMerchantPayments(await ctx("ops@straits-demo.example", "sg"), { entityId: "ENT-SG-02" });
    expect(all).toHaveLength(35);
    expect(all.filter((p) => p.decision !== "matched").map((p) => [p.orderId, p.decision])).toEqual([["BK-24871", "exception"]]);
    expect((await rows(sql`select owner_role from recon_exceptions where org_id = ${seed.orgs.sg} and id = 'EX-BK-24871'`))[0].owner_role).toBe("Treasury");
    const usd = await listMerchantPayments(await ctx("ops@straits-demo.example", "sg"), { entityId: "ENT-US-02", batchId: "B-1125-USD" });
    expect(usd.map((p) => p.decision)).toEqual(Array(7).fill("matched"));
  });
});

describe("Case 3 through the database (two parts, two chains, two links)", () => {
  it("after part 1 the open balance is 7,347.50", async () => {
    expect((await mr(seed.orgs.ae, "BK-25102")).ledger).toMatchObject({ creditedMinor: "1101750", openBalanceMinor: "734750" });
  });
  it("after part 2 arrives through the adapters: 14.16 short, matched with difference, write-off 14.16 proposed", async () => {
    const ops = await ctx("ops@dunehaven-demo.example", "ae");
    const { parts, finalised } = await adapterParts(case3());
    const ing = await ingestAdapterOutput(ops, "ENT-AE-03", parts, key(), { finalised: finalisedFrom(finalised) });
    expect(ing.body.written).toMatchObject({ providerRecords: 1, batches: 1, bankLines: 1, invoices: 0, quotes: 0 });
    expect((await runReconciliation(ops, "ENT-AE-03", key())).body).toMatchObject({ changed: true, newWriteoffs: 1 });
    const r = await mr(seed.orgs.ae, "BK-25102");
    expect(r.decision).toBe("matched_with_difference");
    expect(r.ledger).toMatchObject({ creditedMinor: "1835084", openBalanceMinor: "1416" });
    const wo = await rows(sql`select amount_minor::text as a, currency, difference_ids from writeoff_proposals where org_id = ${seed.orgs.ae}`);
    expect(wo.map((w) => [w.a, w.currency])).toEqual([["1416", "AED"]]);
    // the part-1 difference (7,347.50 still open) stays appended; the write-off cites the two new ones: 12.86 + 1.30 = 14.16
    const ds = await rows(sql`select id, type, amount_minor::text as a from differences where org_id = ${seed.orgs.ae} order by type`);
    expect(ds.map((d) => [d.type, d.a])).toEqual([["partial_payment_open", "-734750"], ["rate_difference", "-130"], ["underpayment", "-1286"]]);
    expect([...(wo[0].difference_ids as string[])].sort()).toEqual(ds.filter((d) => d.type !== "partial_payment_open").map((d) => d.id).sort());
    const detail = await merchantPaymentDetail(ops, "BK-25102");
    expect(detail.label).toBe(LABEL);
    expect(((detail.parts.chain as { transfers: { network: string }[] }).transfers).map((x) => x.network).sort()).toEqual(["ethereum", "tron"]);
  });
});

describe("idempotent reruns", () => {
  it("an identical rerun produces no changes: same input hash, nothing new, nothing audited", async () => {
    const snapshot = async () => rows(sql`select (select count(*) from match_records)::int as m, (select max(computed_at) from match_records)::text as t,
      (select count(*) from differences)::int as d, (select count(*) from recon_exceptions)::int as e, (select count(*) from writeoff_proposals)::int as w,
      (select count(*) from merchant_journal_proposals)::int as j, (select count(*) from audit_events)::int as a`);
    const before = await snapshot();
    const hashBefore = (await mr(seed.orgs.sg, "BK-24817")).input_sha256;
    const r = await runReconciliation(await ctx("ops@straits-demo.example", "sg"), "ENT-SG-01", key());
    expect(r.body).toMatchObject({ changed: false, inputSha256: hashBefore });
    expect(await snapshot()).toEqual(before);
  });
  it("the same idempotency key replays the stored response", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const k = key();
    const a = await runReconciliation(ops, "ENT-US-02", k);
    const b = await runReconciliation(ops, "ENT-US-02", k);
    expect(b.replayed).toBe(true);
    expect(b.body).toEqual(a.body);
  });
});

describe("read models", () => {
  it("filters by result, difference type, network, token, batch and search (order, tx hash, deposit address)", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    expect((await listMerchantPayments(ops, { result: "exception" })).map((p) => p.orderId)).toEqual(["BK-24823", "BK-24830", "BK-24871"]);
    expect((await listMerchantPayments(ops, { differenceType: "requote_after_expiry" })).map((p) => p.orderId)).toEqual(["BK-24836"]);
    expect((await listMerchantPayments(ops, { entityId: "ENT-SG-01", network: "ethereum" })).map((p) => p.orderId)).toEqual(["BK-24830"]);
    expect((await listMerchantPayments(ops, { entityId: "ENT-SG-01", token: "USDT" })).map((p) => p.orderId)).toEqual(["BK-24817", "BK-24823", "BK-24836"]);
    expect((await listMerchantPayments(ops, { search: "fict_tron_tx_24823" })).map((p) => p.orderId)).toEqual(["BK-24823"]);
    expect((await listMerchantPayments(ops, { search: "T_FICTIONAL_DEP_BK-24836" })).map((p) => p.orderId)).toEqual(["BK-24836"]);
    expect((await listMerchantPayments(ops, { entityId: "ENT-SG-01", asOf: "2026-11-30T00:00:00.000Z", minAgeDays: 5 })).length).toBe(4);
    expect((await listMerchantPayments(ops, { entityId: "ENT-SG-01", asOf: "2026-11-30T00:00:00.000Z", maxAgeDays: 4 })).length).toBe(0);
  });
  it("exceptions queue, month end, pilot metrics, reviews and minutes", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const q = await exceptionsQueue(fin);
    expect(q.exceptions.map((e) => e.id)).toEqual(expect.arrayContaining(["EX-BK-24823", "EX-BK-24830", "EX-BK-24871"]));
    expect(q.needsReview.map((r) => r.orderId)).toEqual(["BK-24836"]);
    const m = await monthEnd(fin, "ENT-SG-01", "2026-11");
    expect(m).toMatchObject({ label: LABEL, postingRuleStatus: "pending_sign_off", openExceptions: 2, writeoffs: { pending: 1, approved: 0 } });
    expect(m.balances.bank).toBe("596124");
    await recordMatchReview(await ctx("approver@straits-demo.example", "sg"), "BK-24817", { verdict: "correct" });
    await recordMatchReview(fin, "BK-24836", { verdict: "wrong", note: "fictional review" });
    await logMinutes(fin, { day: "2026-11-25", minutes: 25 });
    const p = await pilotMetrics(fin);
    expect(p).toMatchObject({ label: LABEL, payments: 46, reviewedSample: 2, wrongInSample: 1, batches: 4, batchesTiedToTheCent: 4, minutesLogged: 25 });
    expect(p.autoMatchedPct).toBe(Math.round((42 * 1000) / 46) / 10); // 41 matched + 1 matched with difference of 46
    expect(p.exceptionsPer100).toBe(Math.round((3 * 1000) / 46) / 10);
  });
});

describe("imported bank lines", () => {
  let fin: TenantContext, appr: TenantContext, admin: TenantContext, ops: TenantContext, orgId: string;
  beforeAll(async () => {
    orgId = await createOrganization(ownerDb(), { slug: slugOf.imp, name: "Import Demo (fictional)", seed: "empty" });
    const input = case1();
    await seedMerchantEntity(ownerDb(), orgId, { ...input, bankLines: [] });
    for (const [email, role] of [["fin@import-demo.example", "finance"], ["appr@import-demo.example", "approver"], ["admin@import-demo.example", "admin"], ["ops@import-demo.example", "payment_ops"]] as const) {
      users[email] = await createUser(ownerDb(), { email, name: `${email} (fictional)`, password: PASSWORD });
      await grantMembership(ownerDb(), { orgSlug: slugOf.imp, email, role });
    }
    [fin, appr, admin, ops] = await Promise.all(["fin", "appr", "admin", "ops"].map((u) => ctx(`${u}@import-demo.example`, "imp")));
    const d = { line_id: "SIMBANK-1125-01", account_ref: "SGD-OPS-FICT-001", value_date: "2026-11-25", direction: "credit", kind: "payment", amount: "5961.24", currency: "SGD", reference: "Fictional Pay Provider settlement B-1124-001", counterparty: "Fictional Pay Provider" };
    const bytes = new TextEncoder().encode([STATEMENT_COLUMNS.join(","), STATEMENT_COLUMNS.map((c) => d[c]).join(",")].join("\n") + "\n");
    const up = (await importStatementCsv(fin, { fileName: "statement-2026-11-25.csv", bytes }, key())).body as ImportAccepted;
    await decideStatementImport(appr, up.importId, { decision: "confirm", reason: "Checked against the fictional statement", fileSha256: up.fileSha256, linesSha256: up.linesSha256 }, key());
    const br = await bankLinesFromImport(fin, up.importId, "ENT-SG-01", key());
    expect(br.body).toMatchObject({ bankLineIds: ["IMP-SIMBANK-1125-01"], bankLineLabel: "imported, not bank-authenticated" });
  });

  it("a confirmed csv_import line ties the batch but cannot make settlement verified (flag off)", async () => {
    expect(await rows(sql`select source, import_id is not null as has_import from bank_lines where org_id = ${orgId}`)).toEqual([{ source: "csv_import", has_import: true }]);
    await runReconciliation(ops, "ENT-SG-01", key());
    const b = await batchBridge(ops, "B-1124-001");
    expect(b).toMatchObject({ tied: true, settlementVerified: false, bankLineLabel: "imported, not bank-authenticated" });
    const r = await mr(orgId, "BK-24817");
    expect(r).toMatchObject({ decision: "suggested_for_review", rule_id: "M5.bank.imported_not_verified" });
    expect(r.bank).toMatchObject({ settlementVerified: false, bankLineLabels: ["imported, not bank-authenticated"] });
    const all = await rows(sql`select count(*)::int as n from match_records where org_id = ${orgId} and (bank->>'settlementVerified')::boolean`);
    expect(all[0].n).toBe(0);
    expect(await rows(sql`select id from merchant_journal_proposals where org_id = ${orgId} and pattern = 'settlement'`)).toEqual([]);
  });

  it("with the Admin's policy flag on, the same line can make settlement verified", async () => {
    await updateMerchantPolicy(admin, "ENT-SG-01", { allowImportedBankLinesAsVerified: true }, 1, key());
    expect((await runReconciliation(ops, "ENT-SG-01", key())).body).toMatchObject({ changed: true });
    expect(await batchBridge(ops, "B-1124-001")).toMatchObject({ tied: true, settlementVerified: true });
    expect(await mr(orgId, "BK-24817")).toMatchObject({ decision: "matched_with_difference" });
  });
});
