/**
 * rc6 phase 7 against PostgreSQL 16: the services behind the merchant screens. Exception assignment, notes and
 * attached evidence (append-only); resolutions through the rc5 two-person flow (subject kind merchant_resolution,
 * hash-bound; the preparer cannot approve, in the service AND the database); write-offs through the shared decision
 * endpoint; month-end; the evidence pack (JSON, CSV with formula cells escaped, PDF) and the sandbox journal file,
 * both audited. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { AccessDenied, resolveTenant, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { ZodError } from "zod";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { proposeWriteoff, runReconciliation } from "../../src/server/merchant";
import {
  addExceptionNote, assignException, csvCell, decideMerchantApproval, evidencePack, exceptionDetail, exceptionsView, journalExport, listBatches,
  listMerchantApprovals, merchantShell, monthEndView, paymentContext, requestMerchantResolution,
} from "../../src/server/merchant-ui";
import { contrast, safeTheme } from "../../src/lib/clearline/merchant/theme";

const LABEL = "Test mode · illustrative data";
let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `mu-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug, provider: MERCHANT_SEED_ORGS.provider.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];

async function refused(p: Promise<unknown>, code: string | RegExp) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toMatch(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toMatch(code); return; }
    if (e instanceof ZodError) { expect("INVALID_REQUEST").toMatch(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  const ops = await ctx("ops@straits-demo.example", "sg");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(ops, e, key());
  await runReconciliation(await ctx("ops@dunehaven-demo.example", "ae"), "ENT-AE-03", key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("white-label shell", () => {
  it("a merchant member reads only its provider's name and theme; a provider member reads its own", async () => {
    const m = await merchantShell(await ctx("finance@straits-demo.example", "sg"));
    expect(m).toMatchObject({ label: LABEL, kind: "merchant", providerName: "Northwind Pay (fictional)", theme: { name: "Northwind Pay (fictional)", primary: "#1F4E79", onPrimary: "#FFFFFF", logoText: "NW", fromProvider: true } });
    expect(m.entities.map((e) => [e.id, e.days])).toEqual([["ENT-SG-01", ["2026-11-24"]], ["ENT-SG-02", ["2026-11-25", "2026-11-26"]], ["ENT-US-02", ["2026-11-25"]]]);
    const p = await merchantShell(await ctx("admin@northwind-pay.example", "provider"));
    expect(p).toMatchObject({ kind: "provider", providerName: "Northwind Pay (fictional)", entities: [] });
  });
  it("a theme colour that would fail contrast falls back; garbage never reaches the page", () => {
    expect(safeTheme({ name: "X", colours: { primary: "#FFFF00" } }).primary).toBe("#FFFF00"); // dark text on yellow passes
    expect(safeTheme({ name: "X", colours: { primary: "#FFFF00" } }).onPrimary).toBe("#141414");
    expect(safeTheme({ name: "X", colours: { primary: "#777777" } })).toMatchObject({ primary: "#141414", onPrimary: "#FFFFFF" });
    expect(safeTheme({ name: "X", colours: { primary: "red; background:url(x)" } }).primary).toBe("#141414");
    const t = safeTheme({ name: "Northwind", colours: { primary: "#1F4E79" } });
    expect(contrast(t.primary, t.onPrimary)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("exceptions: assign, note, attach evidence", () => {
  it("lists open exceptions with owner, reason, next step and evidence counts", async () => {
    const v = await exceptionsView(await ctx("ops@straits-demo.example", "sg"));
    expect(v.exceptions.map((e) => [e.id, e.ownerRole, e.evidenceCount])).toEqual([["EX-BK-24823", "Payment Operations", 0], ["EX-BK-24830", "Payment Operations", 0], ["EX-BK-24871", "Treasury", 0]]);
    expect(v.needsReview.map((r) => r.orderId)).toEqual(["BK-24836"]);
  });
  it("assigns only to an active Payment Operations or Finance member; a viewer-like role or a stranger is refused", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const r = await assignException(ops, "EX-BK-24823", { ownerUserId: seed.users["finance@straits-demo.example"] }, key());
    expect(r.body).toMatchObject({ ownerName: "Lena Goh (fictional)" });
    await refused(assignException(ops, "EX-BK-24823", { ownerUserId: seed.users["approver@straits-demo.example"] }, key()), "OWNER_ROLE");
    await refused(assignException(ops, "EX-BK-24823", { ownerUserId: seed.users["finance@dunehaven-demo.example"] }, key()), "NOT_A_MEMBER");
    await refused(assignException(await ctx("approver@straits-demo.example", "sg"), "EX-BK-24823", { ownerUserId: null }, key()), "ACCESS_403");
    await refused(assignException(await ctx("ops@dunehaven-demo.example", "ae"), "EX-BK-24823", { ownerUserId: null }, key()), "ACCESS_404");
    // the database refuses a foreign owner even when the service is bypassed
    await dbRefuses(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`update recon_exceptions set owner_user_id = ${seed.users["finance@dunehaven-demo.example"]} where org_id = ${ops.orgId} and id = 'EX-BK-24823'`)), /active member/);
    expect((await exceptionDetail(ops, "EX-BK-24823")).exception.ownerName).toBe("Lena Goh (fictional)");
  });
  it("notes and evidence are append-only and recorded as the signed-in user", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const a = await addExceptionNote(ops, "EX-BK-24823", { kind: "note", body: "Customer emailed; balance link sent." }, key());
    const k = key();
    const b = await addExceptionNote(ops, "EX-BK-24823", { kind: "evidence", body: "Balance payment link BL-24823 issued (fictional).", reference: "BL-24823" }, k);
    expect((await addExceptionNote(ops, "EX-BK-24823", { kind: "evidence", body: "Balance payment link BL-24823 issued (fictional).", reference: "BL-24823" }, k)).replayed).toBe(true);
    expect(a.status).toBe(201);
    const id = (b.body as { id: string }).id;
    await dbRefuses(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`update recon_exception_notes set body = 'changed' where org_id = ${ops.orgId} and id = ${id}`)), /permission denied|append-only/);
    await dbRefuses(ownerDb().execute(sql`update recon_exception_notes set body = 'changed' where id = ${id}`), /append-only/);
    await dbRefuses(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`insert into recon_exception_notes (org_id, exception_id, kind, body, author_user_id) values (${ops.orgId}, 'EX-BK-24823', 'note', 'forged', ${seed.users["finance@straits-demo.example"]})`)), /row-level security/);
    await refused(addExceptionNote(await ctx("approver@straits-demo.example", "sg"), "EX-BK-24823", { kind: "note", body: "not allowed" }, key()), "ACCESS_403");
    const audit = await rows(sql`select action from audit_events where org_id = ${ops.orgId} and entity_id = 'EX-BK-24823' order by seq`);
    expect(audit.map((x) => x.action)).toEqual(["merchant_exception_assigned", "merchant_exception_noted", "merchant_exception_evidence_attached"]);
  });
});

describe("resolution: two people, bound by hash", () => {
  let requestId = "";
  let hash = "";
  it("needs at least one evidence item attached to THIS exception", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const other = (await addExceptionNote(ops, "EX-BK-24830", { kind: "evidence", body: "Refund agreed with the customer (fictional)." }, key())).body as { id: string };
    await refused(requestMerchantResolution(ops, { exceptionId: "EX-BK-24823", note: "Balance received through the link.", evidenceIds: [other.id] }, key()), "EVIDENCE_NOT_FOR_TARGET");
    await refused(requestMerchantResolution(ops, { exceptionId: "EX-BK-24823", note: "Balance received through the link.", evidenceIds: [] }, key()), "INVALID_REQUEST");
  });
  it("the preparer cannot approve (service and database); a different approver approves the exact hash", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const ev = (await exceptionDetail(ops, "EX-BK-24823")).notes.filter((x) => x.kind === "evidence").map((x) => x.id);
    const r = await requestMerchantResolution(ops, { exceptionId: "EX-BK-24823", note: "Customer paid the SGD 324.00 balance through link BL-24823.", evidenceIds: ev }, key());
    requestId = r.body.requestId; hash = r.body.payloadSha256;
    expect(r.body).toMatchObject({ version: 1, payload: { exception: { id: "EX-BK-24823" }, match: { decision: "exception" } } });
    expect((await exceptionDetail(ops, "EX-BK-24823")).exception.status).toBe("in_review");
    await refused(decideMerchantApproval(ops, requestId, { decision: "approve", reason: "self approval", payloadSha256: hash }, key()), "ACCESS_403");
    // a preparer who is also an approver elsewhere: the database refuses a decision by the requester
    await dbRefuses(withTenant({ userId: ops.userId, orgId: ops.orgId }, (tx) => tx.execute(sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256) values (${ops.orgId}, ${requestId}, ${ops.userId}, 'approve', 'self', ${hash})`)), /requester cannot decide|not an active approver/);
    const appr = await ctx("approver@straits-demo.example", "sg");
    await refused(decideMerchantApproval(appr, requestId, { decision: "approve", reason: "looks right", payloadSha256: "0".repeat(64) }, key()), "VERSION_MISMATCH");
    const d = await decideMerchantApproval(appr, requestId, { decision: "approve", reason: "Balance link and receipt reviewed.", payloadSha256: hash }, key());
    expect(d.body).toMatchObject({ status: "approved", exceptionId: "EX-BK-24823" });
    const ex = await rows(sql`select status, closed_at from recon_exceptions where org_id = ${appr.orgId} and id = 'EX-BK-24823'`);
    expect(ex[0].status).toBe("resolved");
    expect(ex[0].closed_at).not.toBeNull();
    await refused(decideMerchantApproval(await ctx("approver2@straits-demo.example", "sg"), requestId, { decision: "reject", reason: "late", payloadSha256: hash }, key()), "REQUEST_CLOSED");
  });
  it("a newer version supersedes the pending one, and the old hash can no longer be decided; a rejection reopens", async () => {
    const ops = await ctx("ops@straits-demo.example", "sg");
    const ev = (await addExceptionNote(ops, "EX-BK-24871", { kind: "evidence", body: "Provider ticket NW-5521: hold released (fictional).", reference: "NW-5521" }, key())).body as { id: string };
    const v1 = await requestMerchantResolution(ops, { exceptionId: "EX-BK-24871", note: "Provider released the hold; settles next batch.", evidenceIds: [ev.id] }, key());
    const v2 = await requestMerchantResolution(ops, { exceptionId: "EX-BK-24871", note: "Provider released the hold; settles in B-1126-SGD.", evidenceIds: [ev.id] }, key());
    expect(v2.body.version).toBe(2);
    const appr = await ctx("approver@straits-demo.example", "sg");
    await refused(decideMerchantApproval(appr, v1.body.requestId, { decision: "approve", reason: "old version", payloadSha256: v1.body.payloadSha256 }, key()), "REQUEST_CLOSED");
    await decideMerchantApproval(appr, v2.body.requestId, { decision: "reject", reason: "Wait for the bank line.", payloadSha256: v2.body.payloadSha256 }, key());
    expect((await exceptionDetail(ops, "EX-BK-24871")).exception.status).toBe("open");
    await refused(decideMerchantApproval(appr, "00000000-0000-4000-8000-000000000000", { decision: "approve", reason: "unknown request", payloadSha256: hash }, key()), "ACCESS_404");
  });
});

describe("write-offs through the shared decision endpoint", () => {
  it("Finance submits, the approvals list shows the hash, a different approver approves", async () => {
    const fin = await ctx("finance@dunehaven-demo.example", "ae");
    const before = await listMerchantApprovals(fin);
    expect(before.writeoffsToSubmit).toEqual([{ id: expect.stringMatching(/^WO-BK-25102@/), orderId: "BK-25102", amount: "AED 14.16" }]);
    const p = await proposeWriteoff(fin, before.writeoffsToSubmit[0].id, key());
    const list = await listMerchantApprovals(fin);
    expect(list.requests[0]).toMatchObject({ kind: "merchant_writeoff", status: "pending", payloadSha256: p.body.payloadSha256, amount: "AED 14.16", orderId: "BK-25102" });
    await refused(decideMerchantApproval(fin, p.body.requestId, { decision: "approve", reason: "self", payloadSha256: p.body.payloadSha256 }, key()), "ACCESS_403");
    const d = await decideMerchantApproval(await ctx("approver@dunehaven-demo.example", "ae"), p.body.requestId, { decision: "approve", reason: "Within policy; reviewed.", payloadSha256: p.body.payloadSha256 }, key());
    expect(d.body).toMatchObject({ status: "approved" });
  });
});

describe("read models", () => {
  it("batches with tie status; payment timeline and audit", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const bs = await listBatches(fin);
    expect(bs.map((b) => [b.batchId, b.tied])).toEqual([["B-1124-001", true], ["B-1124-SGD", true], ["B-1125-SGD", true], ["B-1125-USD", true]]);
    const p = await paymentContext(fin, "BK-24823");
    expect(p.timeline.map((x) => x.kind)).toEqual(expect.arrayContaining(["chain", "provider", "reconciliation", "exception", "note", "evidence", "approval", "decision"]));
    expect(p.audit.some((a) => a.action === "merchant_resolution_approved")).toBe(true);
    await refused(paymentContext(await ctx("finance@dunehaven-demo.example", "ae"), "BK-24823"), "ACCESS_404");
  });
  it("month-end: the held payment is a receivable from the provider; exceptions by age; FX note data", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const me = await monthEndView(fin, "ENT-SG-02", "2026-11", null);
    expect(me.receivableFromProvider).toEqual([{ batchId: "(no settlement batch)", orderIds: ["BK-24871"], creditedMinor: "120000", reason: "Held by the provider; in no settlement." }]);
    expect(me.exceptionAges.flatMap((a) => a.ids)).toEqual(["EX-BK-24871"]);
    expect(me.postingRuleStatus).toBe("pending_sign_off");
    expect(me.journals.length).toBeGreaterThan(0);
  });
  it("a provider user is refused every merchant read", async () => {
    const pv = await ctx("admin@northwind-pay.example", "provider");
    await refused(exceptionsView(pv), "ACCESS_403");
    await refused(listMerchantApprovals(pv), "ACCESS_403");
    await refused(evidencePack(pv, { kind: "payment", orderId: "BK-24817" }, "json"), "ACCESS_403");
  });
});

describe("evidence pack and journal file", () => {
  it("JSON carries the chain proof, provider record, bank line, approvals and audit trail; the export is audited", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const r = await evidencePack(fin, { kind: "payment", orderId: "BK-24823" }, "json");
    const p = JSON.parse(r.body as string);
    expect(p).toMatchObject({ label: LABEL, cutOffNote: "provider day = UTC" });
    expect(p.chainProof[0]).toMatchObject({ source: "recorded_fixture", finalised: true });
    expect(p.providerRecords[0]).toMatchObject({ note: "a claim, not proof" });
    expect(p.bankLines.length).toBeGreaterThan(0);
    expect(p.approvals[0]).toMatchObject({ kind: "merchant_resolution", status: "approved", decisions: [{ decision: "approve" }] });
    expect(p.auditTrail.some((a: { action: string }) => a.action === "merchant_resolution_requested")).toBe(true);
    const audit = await rows(sql`select summary from audit_events where org_id = ${fin.orgId} and action = 'merchant_evidence_pack_exported'`);
    expect(String(audit.at(-1)!.summary)).toContain(r.sha256.slice(0, 12));
  });
  it("CSV escapes formula cells; the month pack covers the entity's month", async () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("\"'+1\"");
    expect(csvCell("-135")).toBe("\"'-135\"");
    expect(csvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(csvCell("plain")).toBe("plain");
    const ops = await ctx("ops@straits-demo.example", "sg");
    await addExceptionNote(ops, "EX-BK-24830", { kind: "note", body: "=cmd|' /C calc'!A0" }, key());
    // rc8 founder decision 3: Payment Operations adds the note but may not export; Finance does
    await refused(evidencePack(ops, { kind: "month", entityId: "ENT-SG-01", month: "2026-11" }, "csv"), "ACCESS_403");
    const r = await evidencePack(await ctx("finance@straits-demo.example", "sg"), { kind: "month", entityId: "ENT-SG-01", month: "2026-11" }, "csv");
    const body = r.body as string;
    expect(body.split("\r\n")[0]).toBe("section,id,order_id,field_1,field_2,field_3,field_4,detail,marking");
    expect(body).toContain("\"'=cmd|' /C calc'!A0\"");
    expect(body).not.toMatch(/(^|,)=cmd/m);
    expect(body).toContain(LABEL);
    for (const o of ["BK-24817", "BK-24823", "BK-24830", "BK-24836"]) expect(body).toContain(o);
  });
  it("the PDF is a real PDF with the test-mode label", async () => {
    const r = await evidencePack(await ctx("finance@straits-demo.example", "sg"), { kind: "payment", orderId: "BK-24817" }, "pdf");
    const bytes = r.body as Uint8Array;
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getSubject()).toBe(LABEL);
  });
  it("the journal file is sandbox-only, pending sign-off, Finance/Approver/Admin only (rc8 decision 3), audited, and changes no journal status", async () => {
    const fin = await ctx("finance@straits-demo.example", "sg");
    const before = await rows(sql`select id, status from merchant_journal_proposals where org_id = ${fin.orgId} order by id`);
    const r = await journalExport(fin, "ENT-SG-01", "2026-11", "csv");
    expect(r.count).toBeGreaterThan(0);
    const lines = r.body.split("\r\n");
    expect(lines[0]).toBe("journal_id,entry_date,account_code,account_name,debit,credit,currency,memo,pattern,rule_id,requires_approval_of,evidence,posting_rule_status,marking");
    expect(r.body).toContain("SANDBOX-JP-SETL-B-1124-001");
    expect(r.body).toContain("sandbox/demo company only; posting rules pending sign-off");
    const j = JSON.parse((await journalExport(fin, "ENT-SG-01", "2026-11", "json")).body);
    expect(j).toMatchObject({ marking: "sandbox/demo company only; posting rules pending sign-off", postingRuleStatus: "pending_sign_off" });
    const setl = j.entries.find((e: { id: string }) => e.id === "JP-SETL-B-1124-001");
    expect(setl.lines.map((l: { side: string; accountCode: string; amountMinor: string }) => [l.side, l.accountCode, l.amountMinor])).toEqual([["debit", "bank", "596124"], ["debit", "payment_processing_fees", "6021"], ["credit", "provider_clearing", "602145"]]);
    expect(await rows(sql`select id, status from merchant_journal_proposals where org_id = ${fin.orgId} order by id`)).toEqual(before);
    await refused(journalExport(await ctx("ops@straits-demo.example", "sg"), "ENT-SG-01", "2026-11", "csv"), "ACCESS_403");
    // rc8 founder decision 3: an Approver and an Admin now export the journal file too (rc6: Finance only)
    for (const who of ["approver@straits-demo.example", "admin@straits-demo.example"]) expect((await journalExport(await ctx(who, "sg"), "ENT-SG-01", "2026-11", "csv")).body).toBe(r.body);
    await refused(journalExport(fin, "ENT-AE-03", "2026-12", "csv"), "ACCESS_404");
  });
});
