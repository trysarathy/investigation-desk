/**
 * v1 phase 4: the month-end pack as PDF and XLSX, against PostgreSQL 16 with the Straits seed (fictional). Every
 * section is present; the totals reconcile across sections (bridges ↔ settlement journals, journals balanced, exceptions
 * by age, write-offs ↔ the journal lines waiting on them, evidence index by evidence level); the journals carry the
 * sign-off label; the XLSX totals equal the model's; the exports are role-checked and audited.
 * Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { closeOwner, enrolTestTotp, ownerDb, PASSWORD, resetAndSeed, signInWithMfa } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, MERCHANT_SEED_USERS, seedMerchantCases } from "../../src/server/merchant-seed";
import { decideWriteoff, proposeWriteoff, runReconciliation } from "../../src/server/merchant";
import { monthEndPackFile, monthEndPackModel } from "../../src/server/month-end-pack";
import { EVIDENCE_LEVELS, monthEndChecks } from "../../src/lib/clearline/exports/month-end-pack";
import { postingRulesCatalogue } from "../../src/lib/clearline/merchant/posting-rules";
import { GET as monthEndGET } from "../../src/app/api/control/merchant/exports/month-end/route";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const SLUG = MERCHANT_SEED_ORGS.sg.slug;
const FIN = "finance@straits-demo.example", APPROVER = "approver@straits-demo.example", OPS = "ops@straits-demo.example";
let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
const users: Record<string, string> = {};
let n = 0;
const key = () => `mep-key-${++n}-${Date.now()}`;
const ctx = (email: string): Promise<TenantContext> => resolveTenant({ userId: users[email], name: email, email }, SLUG);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
const model = async (email: string, entity: string) => { const c = await ctx(email); return withTenant({ userId: c.userId, orgId: c.orgId }, (tx) => monthEndPackModel(tx, c, entity, "2026-11"), { read: true }); };
let writeoffId = "";

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  for (const u of MERCHANT_SEED_USERS) { users[u.email] = seed.users[u.email]; if (u.role === "admin" || u.role === "approver") await enrolTestTotp(users[u.email]); }
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(await ctx(OPS), e, key());
  // a write-off prepared by Finance and approved by an Approver (two people)
  const [w] = await rows(sql`select w.id from writeoff_proposals w join invoices i on i.org_id = w.org_id and i.order_id = w.order_id where w.org_id = ${seed.orgs.sg} and i.entity_id = 'ENT-SG-01' and w.status = 'proposed' order by w.id limit 1`);
  writeoffId = String(w.id);
  const req = await proposeWriteoff(await ctx(FIN), writeoffId, key());
  await decideWriteoff(await ctx(APPROVER), req.body.requestId, { decision: "approve", reason: "Fictional test approval", payloadSha256: req.body.payloadSha256 }, key());
  await ownerDb().execute(sql`insert into fiat_rates (org_id, base_currency, quote_currency, rate, as_of, source_label, recorded_by)
    values (${seed.orgs.sg}, 'USD', 'SGD', 1.3600, '2026-11-30T09:00:00Z', 'Fictional Rate Desk', 'test')`);
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("the model: every section, and the totals reconcile across sections", () => {
  it.each(["ENT-SG-01", "ENT-SG-02", "ENT-US-02"])("%s, 2026-11: every check agrees", async (entity) => {
    const m = await model(FIN, entity);
    const checks = monthEndChecks(m);
    expect(checks.filter((c) => !c.agrees), JSON.stringify(checks.filter((c) => !c.agrees))).toEqual([]);
    expect(checks.map((c) => c.id)).toEqual(expect.arrayContaining(["journals.balanced", "journals.settlement_vs_bridges", "exceptions.ages", "writeoffs.vs_journals", "evidence.levels", "evidence.settled", "fx.proposals"]));
    expect(m.bridges.length + m.receivable.length).toBeGreaterThan(0);
    expect(m.journals.length).toBeGreaterThan(0);
    expect(m.evidence.length).toBeGreaterThan(0);
    expect(m.fx.available).toBe(true);
    // the settlement cross-check covers real batches wherever the month has a verified settlement journal
    const setl = checks.find((c) => c.id === "journals.settlement_vs_bridges")!;
    if (m.journals.some((j) => j.pattern === "settlement")) expect(setl.description).toMatch(/\(([1-9]\d*) batch/);
  });

  it("the write-off shows its preparer and its approver, and agrees with the journal line waiting on it", async () => {
    const m = await model(FIN, "ENT-SG-01");
    const w = m.writeoffs.find((x) => x.id === writeoffId)!;
    expect(w.status).toBe("approved");
    expect([w.preparedBy, w.approvedBy].every((x) => /fictional/i.test(x))).toBe(true);
    expect(w.preparedBy).not.toBe(w.approvedBy);
    const c = monthEndChecks(m).find((x) => x.id === "writeoffs.vs_journals")!;
    expect(c.left).not.toBe("SGD 0.00");
  });

  it("the FX section is the engine's: closing rates on file; nothing proposed without an other-currency balance", async () => {
    const m = await model(FIN, "ENT-SG-01");
    if (!m.fx.available) throw new Error("fx");
    expect(m.fx.rates.map((r) => r.pair)).toEqual(["USD/SGD"]);
    expect(m.fx.closingAt).toBe("2026-11-30T15:59:59.999Z");
    expect(m.fx.items).toEqual([]);
    expect(m.fx.proposalIds).toEqual([]);
  });

  it("the evidence index carries the bank evidence level of every payment", async () => {
    const m = await model(FIN, "ENT-SG-02");
    expect(m.evidence.every((e) => EVIDENCE_LEVELS.some(([k]) => k === e.bankEvidence))).toBe(true);
    expect(m.evidence.every((e) => e.packPath.startsWith("/api/control/merchant/evidence?order="))).toBe(true);
  });

  it("a tampered section is caught (the checks are not tautologies)", async () => {
    const m = await model(FIN, "ENT-SG-01");
    const broken = { ...m, bridges: m.bridges.map((b, i) => (i === 0 ? { ...b, netMinor: String(BigInt(b.netMinor) + 1n) } : b)) };
    expect(monthEndChecks(broken).filter((c) => !c.agrees).map((c) => c.id)).toEqual(expect.arrayContaining([`bridges.net.${m.bridges[0].currency}`]));
    const fewer = { ...m, exceptionBuckets: m.exceptionBuckets.map((b, i) => (i === 0 ? { ...b, count: b.count + 1 } : b)) };
    expect(monthEndChecks(fewer).find((c) => c.id === "exceptions.ages")!.agrees).toBe(false);
  });

  it("journals are labelled drafts until the current posting rules are signed, then proposals (still not posted)", async () => {
    expect((await model(FIN, "ENT-SG-01")).journals.every((j) => j.label === "Draft: posting rules not signed")).toBe(true);
    const cat = postingRulesCatalogue();
    const admin = MERCHANT_SEED_USERS.find((u) => u.role === "admin")!.email;
    await ownerDb().execute(sql`insert into posting_rules_signatures (org_id, version, version_sha256, catalogue, signed_by_user_id, signed_by_name, mfa_verified_at)
      values (${seed.orgs.sg}, ${cat.version}, ${cat.sha256}, '{}'::jsonb, ${users[admin]}, 'Admin (fictional)', now())`);
    const m = await model(FIN, "ENT-SG-01");
    expect(m.postingRules).toMatchObject({ signed: true, version: cat.version, signedBy: "Admin (fictional)" });
    expect(new Set(m.journals.map((j) => (j.requiresApprovalOf ? "pending" : j.label)))).toEqual(new Set(["Proposal; rules signed; not posted", "pending"]));
    expect(m.journals.filter((j) => j.requiresApprovalOf).every((j) => j.label.startsWith("Pending approval"))).toBe(true);
  });
});

describe("the files", () => {
  it("XLSX: every section is a sheet, and its totals equal the model's", async () => {
    const r = await monthEndPackFile(await ctx(FIN), "ENT-SG-02", "2026-11", "xlsx");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(r.body) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Bridges", "Receivable from provider", "Exceptions by age", "Write-offs", "FX revaluation", "Journals", "Evidence index"]);
    const bridges = wb.getWorksheet("Bridges")!;
    const total = bridges.getRows(1, bridges.rowCount)!.find((row) => row.getCell(1).value === "TOTAL" && row.getCell(3).value === "SGD")!;
    const net = r.model.bridges.filter((b) => b.currency === "SGD").reduce((s, b) => s + BigInt(b.netMinor), 0n);
    expect(Math.round(Number(total.getCell(7).value) * 100)).toBe(Number(net));
    const summary = wb.getWorksheet("Summary")!.getRows(1, 60)!.map((row) => `${row.getCell(1).value} ${row.getCell(2).value}`).join("\n");
    expect(summary).toMatch(/Check: .*AGREES/);
    expect(summary).not.toMatch(/DIFFERS/);
    expect(r.checks.every((c) => c.agrees)).toBe(true);
  });
  it("PDF: a real document with the sections", async () => {
    const r = await monthEndPackFile(await ctx(APPROVER), "ENT-SG-01", "2026-11", "pdf");
    expect(Buffer.from(r.body).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(r.body)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
  it("route: Finance gets PDF and XLSX; Payment Operations is refused; audited with ids, counts and hashes only", async () => {
    const before = (await rows(sql`select count(*)::int as n from audit_events where action = 'merchant_month_end_pack_exported'`))[0].n as number;
    const cookie = await signInWithMfa(FIN, PASSWORD, "198.51.100.91");
    for (const [format, type] of [["pdf", "application/pdf"], ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]) {
      const res = await monthEndGET(new Request(`${ORIGIN}/api/control/merchant/exports/month-end?entity=ENT-SG-01&month=2026-11&format=${format}`, { headers: { cookie: `${cookie}; clearline_org=${SLUG}` } }));
      expect(res.status, format).toBe(200);
      expect(res.headers.get("content-type")).toBe(type);
      expect(res.headers.get("content-disposition")).toMatch(new RegExp(`clearline-month-end-.*\\.${format}"$`));
      await res.arrayBuffer();
    }
    const bad = await monthEndGET(new Request(`${ORIGIN}/api/control/merchant/exports/month-end?entity=ENT-SG-01&month=2026-11&format=docx`, { headers: { cookie: `${cookie}; clearline_org=${SLUG}` } }));
    expect(bad.status).toBe(400);
    const audits = await rows(sql`select summary, details from audit_events where action = 'merchant_month_end_pack_exported' order by seq`);
    expect(audits.length).toBe(before + 2);
    for (const a of audits.slice(before)) expect(Object.keys(a.details as object).sort()).toEqual(["counts", "format", "month", "sha256"]);
    try { await monthEndPackFile(await ctx(OPS), "ENT-SG-01", "2026-11", "pdf"); throw new Error("expected 403"); } catch (e) { expect(e).toBeInstanceOf(AccessDenied); expect((e as AccessDenied).status).toBe(403); }
  });
});
