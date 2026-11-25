/**
 * v1 phase 2.1 against PostgreSQL 16: scheduled pickup from a local SFTP stand-in (a folder) and a local inbox
 * stand-in (a Maildir). Files go through the same pipeline as a person's upload (allowlist, parsers, duplicate check,
 * encrypted storage, the same mapping and validation), nothing is confirmed by pickup, a bank statement still needs a
 * second person, nothing is read twice, and the database refuses spoofed or out-of-role pickup rows. Fictional data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { accountOf, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { RequestRefused } from "../../src/server/errors";
import { AccessDenied, withTenant } from "../../src/server/tenant";
import { revokeMembership } from "../../src/server/admin";
import { createUpload, decideUpload } from "../../src/server/uploads";
import { saveMappingTemplate } from "../../src/server/mapping-templates";
import { createPickupSource, listPickupSources, runPickup, setPickupSourceEnabled } from "../../src/server/upload-pickup";
import type { Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let root: string;
let n = 0;
const key = () => `pick-key-${++n}-${Date.now()}`;
const HEAD = "Invoice Number,Contact,Currency,Total,Amount Due,Invoice Date";
const ledger = (ids: number[]) => [HEAD, ...ids.map((i) => `INV-PICK-${i},Fictional Buyer ${i},SGD,${i}.00,${i}.00,2026-11-0${1 + (i % 8)}`)].join("\n") + "\n";
const MAPPING: Mapping = {
  fileType: "ledger_invoices",
  columns: { invoice_number: { header: "Invoice Number" }, contact: { header: "Contact" }, currency: { header: "Currency" }, total: { header: "Total", decimalSeparator: "." }, amount_due: { header: "Amount Due", decimalSeparator: "." }, issued_on: { header: "Invoice Date", dateFormat: "iso" } },
};
const MT940 = ":20:FICT-PICK\r\n:25:FICT0001/SGD\r\n:28C:1/1\r\n:60F:C261101SGD1000,00\r\n:61:2611021102C1250,50NTRFINV-PICK-1//FICT1\r\n:86:FICTIONAL PAYER\r\n:62F:C261102SGD2250,50\r\n";
const settle = (f: string) => { const t0 = new Date(Date.now() - 10 * 60_000); utimesSync(f, t0, t0); };
const put = (rel: string, body: string | Buffer) => { const f = path.join(root, rel); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); settle(f); };
function mail(from: string, fileName: string, body: string) {
  return Buffer.from([
    "Authentication-Results: mx.merchant.example; dkim=pass header.d=bank.example; dmarc=pass", `From: Statements (fictional) <${from}>`, "Subject: statement", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="Q"', "", "--Q", "Content-Type: text/plain", "", "Fictional statement.", "--Q",
    `Content-Disposition: attachment; filename="${fileName}"`, "Content-Transfer-Encoding: base64", "", Buffer.from(body).toString("base64"), "--Q--", "",
  ].join("\r\n"), "latin1");
}
const uploadsFrom = (sourceId: string) => ownerDb().select().from(t.uploads).where(eq(t.uploads.pickupSourceId, sourceId));
const itemsOf = (sourceId: string) => ownerDb().select().from(t.uploadPickupItems).where(eq(t.uploadPickupItems.sourceId, sourceId));
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

let sftpId: string, mailId: string, templateId: string;
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

beforeAll(async () => {
  useTestStorage(true);
  root = mkdtempSync(path.join(tmpdir(), "clearline-pickup-ctl-"));
  process.env.CLEARLINE_PICKUP_ROOT = root;
  process.env.CLEARLINE_PICKUP_MIN_AGE_SECONDS = "60";
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-pick");
});
afterAll(async () => { delete process.env.CLEARLINE_PICKUP_ROOT; await closeDatabase(); await closeOwner(); });

describe("configuring pickup sources", () => {
  it("an Admin adds sources for an uploading member; others cannot; the member must be able to upload", async () => {
    const admin = await liveCtx(s, "admin@live-a.example", "a");
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    templateId = (await saveMappingTemplate(fin, { fileType: "ledger_invoices", name: "Pickup ledger", headers: HEAD.split(","), mapping: MAPPING }, key())).body.id;
    const sftp = await createPickupSource(admin, { kind: "sftp", name: "Ledger SFTP (fictional)", entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", templateId, location: "a/ledger",
      runAsUserId: s.users["finance@live-a.example"], intervalMinutes: 15 }, key());
    sftpId = sftp.body.id;
    const inbox = await createPickupSource(admin, { kind: "email", name: "Bank statements inbox (fictional)", entityId: "ENT-LIVE-SG", fileType: "bank_statement",
      bankAccountId: await accountOf(s.orgs.a, "ENT-LIVE-SG"), location: "a/mail", allowedSenders: ["@bank.example"], runAsUserId: s.users["finance@live-a.example"], intervalMinutes: 60 }, key());
    mailId = inbox.body.id;
    expect((await listPickupSources(fin)).sources.map((x) => x.id)).toEqual([sftpId, mailId]);

    await refused(createPickupSource(fin, { kind: "sftp", name: "x", entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", location: "a/x", runAsUserId: s.users["finance@live-a.example"] }, key()), "ACCESS_403");
    await refused(createPickupSource(admin, { kind: "sftp", name: "x", entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", location: "a/x", runAsUserId: s.users["approver@live-a.example"] }, key()), "PICKUP_MEMBER_CANNOT_UPLOAD");
    await expect(createPickupSource(admin, { kind: "sftp", name: "x", entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", location: "../etc", runAsUserId: s.users["finance@live-a.example"] }, key())).rejects.toThrow();
    await expect(createPickupSource(admin, { kind: "email", name: "x", entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", location: "a/x", runAsUserId: s.users["finance@live-a.example"] }, key())).rejects.toThrow(/allowed sender/);
  });

  it("the database refuses a source written by a non-Admin, run as a non-uploader, or changed beyond on/off", async () => {
    const fin = s.users["finance@live-a.example"];
    const as = (userId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId: s.orgs.a }, (tx) => tx.execute(q));
    await dbRefuses(as(fin, sql`insert into upload_pickup_sources (org_id, kind, name, entity_id, file_type, location, run_as_user_id, created_by)
      values (${s.orgs.a}, 'sftp', 'x', 'ENT-LIVE-SG', 'ledger_invoices', 'a/x', ${fin}, ${fin})`), /created by the signed-in Admin/);
    await dbRefuses(ownerDb().execute(sql`insert into upload_pickup_sources (org_id, kind, name, entity_id, file_type, location, run_as_user_id, created_by)
      values (${s.orgs.a}, 'sftp', 'x', 'ENT-LIVE-SG', 'ledger_invoices', 'a/x', ${s.users["viewer@live-a.example"]}, ${fin})`), /Finance or Payment Operations member/);
    await dbRefuses(ownerDb().execute(sql`update upload_pickup_sources set location = 'a/other' where id = ${sftpId}`), /changes only its on\/off switch/);
    await dbRefuses(as(fin, sql`update upload_pickup_sources set enabled = false where id = ${sftpId}`), /switched on or off by an Admin/);
    await dbRefuses(ownerDb().execute(sql`delete from upload_pickup_sources where id = ${sftpId}`), /./);
  });
});

describe("the scheduled run", () => {
  it("picks up new files into the normal pipeline (mapped and validated by the source's template), never confirms, never reads twice", async () => {
    put("a/ledger/nov.csv", ledger([1, 2, 3]));
    put("a/ledger/nov-copy.csv", ledger([1, 2, 3])); // same content under another name: a duplicate upload
    put("a/ledger/payload.exe", ledger([9]));
    writeFileSync(path.join(root, "a/ledger/writing.csv"), ledger([4])); // too fresh: waits for the next run
    put("a/mail/new/1700000000.1.fict", mail("statements@bank.example", "nov.sta", MT940));
    put("a/mail/new/1700000000.2.fict", mail("someone@elsewhere.example", "x.sta", MT940));
    const lines: unknown[] = [];
    const r = await runPickup(ownerDb(), new Date(), { log: (l) => lines.push(l) });
    expect(r).toMatchObject({ sources: 2, stored: 2, duplicate: 1, refused: 2, validated: 2, unavailable: 0 });

    const [ledgerUp] = await uploadsFrom(sftpId);
    expect(ledgerUp).toMatchObject({ status: "validated", templateId, uploadedBy: s.users["finance@live-a.example"], confirmedBy: null, acceptedCount: 3 });
    const [stmt] = await uploadsFrom(mailId);
    expect(stmt).toMatchObject({ status: "validated", fileFormat: "mt940", confirmedBy: null });
    const codes = (await itemsOf(sftpId)).map((i) => `${i.outcome}:${i.code ?? ""}`).sort();
    expect(codes).toEqual(["duplicate:DUPLICATE_UPLOAD", "refused:FILE_EXTENSION_NOT_ALLOWED", "stored:"]);
    expect((await itemsOf(mailId)).map((i) => `${i.outcome}:${i.code ?? ""}`).sort()).toEqual(["refused:EMAIL_SENDER_NOT_ALLOWED", "stored:"]);

    // the statement still needs a second person: the run's member cannot confirm it, an Approver can
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const approver = await liveCtx(s, "approver@live-a.example", "a");
    const decision = { decision: "confirm" as const, reason: "checked against the fictional bank portal", contentSha256: stmt.contentSha256, rowsSha256: stmt.rowsSha256! };
    await refused(decideUpload(fin, stmt.id, decision, key()), "ACCESS_403");
    expect((await decideUpload(approver, stmt.id, decision, key())).body.status).toBe("confirmed");

    // not due yet: nothing runs; when due, only the file that has settled since is new
    expect((await runPickup(ownerDb(), new Date())).sources).toBe(0);
    settle(path.join(root, "a/ledger/writing.csv"));
    const again = await runPickup(ownerDb(), later(20));
    expect(again).toMatchObject({ sources: 1, items: 1, stored: 1 });
    expect((await uploadsFrom(sftpId)).length).toBe(2);
    const third = await runPickup(ownerDb(), later(200));
    expect(third).toMatchObject({ sources: 2, items: 0, stored: 0 });

    // logs and audit carry ids, codes and counts: never a file name, a sender or a cell value
    const audit = JSON.stringify(await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.a), sql`${t.auditEvents.action} like 'upload_pickup%'`)));
    expect(audit).toContain("upload_pickup_run");
    for (const secret of ["nov.csv", "payload.exe", "someone@elsewhere.example", "Fictional Buyer", "INV-PICK"]) {
      expect(audit).not.toContain(secret);
      expect(JSON.stringify(lines)).not.toContain(secret);
    }
  });

  it("a person cannot claim a pickup source; a disabled source does not run; a member who left stops the source", async () => {
    const ops = await liveCtx(s, "ops@live-a.example", "a");
    await dbRefuses(createUpload(ops, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "spoof.csv", bytes: new TextEncoder().encode(ledger([77])) }, key(), undefined, { pickupSourceId: sftpId }),
      /enabled source of its entity and file type, as that source's member/);

    const admin = await liveCtx(s, "admin@live-a.example", "a");
    await setPickupSourceEnabled(admin, sftpId, false, key());
    put("a/ledger/dec.csv", ledger([10, 11]));
    expect((await runPickup(ownerDb(), later(400))).sources).toBe(1); // the inbox only
    await setPickupSourceEnabled(admin, sftpId, true, key());

    await revokeMembership(ownerDb(), { orgSlug: s.slugs.a, email: "finance-pick@live-a.example" });
    const r = await runPickup(ownerDb(), later(600));
    expect(r).toMatchObject({ unavailable: 2, stored: 0 });
    const [a] = await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.a), eq(t.auditEvents.action, "upload_pickup_unavailable")));
    expect(a.details).toMatchObject({ code: "PICKUP_MEMBER_NOT_ACTIVE" });
  });

  it("a source whose folder is missing is recorded as unavailable and retried, not crashed", async () => {
    const admin = await liveCtx(s, "admin@live-a.example", "a");
    const src = await createPickupSource(admin, { kind: "sftp", name: "Missing folder (fictional)", entityId: "ENT-LIVE-US", fileType: "ledger_invoices", location: "a/missing",
      runAsUserId: s.users["ops@live-a.example"], intervalMinutes: 5 }, key());
    const lines: { code?: string }[] = [];
    const r = await runPickup(ownerDb(), later(700), { log: (l) => lines.push(l) });
    expect(r.unavailable).toBeGreaterThanOrEqual(1);
    expect(lines.find((l) => (l as { sourceId?: string }).sourceId === src.body.id)?.code).toBe("LOCATION_NOT_FOUND");
    mkdirSync(path.join(root, "a/missing"), { recursive: true });
    put("a/missing/us.csv", ledger([20]));
    const after = await runPickup(ownerDb(), later(720));
    expect(after.stored).toBe(1);
  });
});
