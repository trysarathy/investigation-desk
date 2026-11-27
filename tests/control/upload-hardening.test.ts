/**
 * v1 phase 2.1 against PostgreSQL 16 and a temporary upload folder: the strict file allowlist (content first, then
 * the name's extension), the optional malware scan (a fake clamd speaking the real INSTREAM protocol over TCP;
 * infected and unavailable both refuse, nothing stored), and orphan cleanup in both directions with a dry run and
 * audit rows. Fictional data only, built in the test.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { existsSync, utimesSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { cleanupOrphans } from "../../src/server/upload-orphans";
import { uploadStorage } from "../../src/server/storage";
import { interpret } from "../../src/server/malware";
import type { Mapping } from "../../src/lib/clearline/mapping";

let s: LiveSeed;
let dir: string;
let n = 0;
const key = () => `hard-key-${++n}-${Date.now()}`;
const utf8 = (x: string) => new TextEncoder().encode(x);
const csv = (marker: string) => utf8(`Invoice Number,Contact,Currency,Total,Amount Due,Invoice Date\nINV-${marker},Fictional Buyer,SGD,10.00,10.00,2026-11-02\n`);
async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) { if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; } throw e; }
  throw new Error(`expected refusal ${code}`);
}
const uploadsOfA = async () => (await ownerDb().select({ n: sql<number>`count(*)::int` }).from(t.uploads).where(eq(t.uploads.orgId, s.orgs.a)))[0].n;
const auditOf = async (action: string) => ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.a), eq(t.auditEvents.action, action)));

/** A fake clamd: reads "zINSTREAM\0" and length-prefixed chunks; answers FOUND when the stream holds the marker. */
function fakeClamd(mode: "scan" | "error" | "silent") {
  const seen: number[] = [];
  const server: Server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (mode === "silent") return;
      const head = "zINSTREAM\0";
      if (buf.length < head.length) return;
      if (buf.subarray(0, head.length).toString() !== head) { sock.end("UNKNOWN COMMAND\0"); return; }
      let p = head.length;
      const body: Buffer[] = [];
      for (;;) {
        if (buf.length < p + 4) return;
        const len = buf.readUInt32BE(p);
        if (len === 0) break;
        if (buf.length < p + 4 + len) return;
        body.push(buf.subarray(p + 4, p + 4 + len));
        p += 4 + len;
      }
      const all = Buffer.concat(body);
      seen.push(all.length);
      if (mode === "error") sock.end("INSTREAM size limit exceeded. ERROR\0");
      else sock.end(all.includes("FICTIONAL-MALWARE-TEST-MARKER") ? "stream: Clearline.Test.Marker FOUND\0" : "stream: OK\0");
    });
  });
  return new Promise<{ port: number; seen: number[]; close: () => Promise<void> }>((resolve) => server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as { port: number }).port;
    resolve({ port, seen, close: () => new Promise((r) => server.close(() => r())) });
  }));
}
function withClamd(port: number | null, extra: Record<string, string> = {}) {
  const keys = ["CLEARLINE_CLAMD_HOST", "CLEARLINE_CLAMD_PORT", "CLEARLINE_CLAMD_SOCKET", "CLEARLINE_MALWARE_SCAN", "CLEARLINE_CLAMD_TIMEOUT_MS"];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  if (port !== null) { process.env.CLEARLINE_CLAMD_HOST = "127.0.0.1"; process.env.CLEARLINE_CLAMD_PORT = String(port); }
  Object.assign(process.env, extra);
  return () => { for (const k of keys) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } };
}

beforeAll(async () => {
  dir = useTestStorage(true);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-hard");
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("strict file allowlist", () => {
  it("content decides the kind; a disallowed extension is refused even for valid CSV content; nothing is stored", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const before = await uploadsOfA();
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "invoices.exe", bytes: csv("EXE") }, key()), "FILE_EXTENSION_NOT_ALLOWED");
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "invoices.html", bytes: csv("HTML") }, key()), "FILE_EXTENSION_NOT_ALLOWED");
    // HTML content named .csv: the content is refused (not a table)
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "invoices.csv", bytes: utf8("<html><body>fictional</body></html>") }, key()), "FILE_UNSUPPORTED_FILE");
    // an executable named .csv: binary content is refused
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "invoices.csv", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0]) }, key()), "FILE_UNSUPPORTED_FILE");
    // a statement format is only a bank statement
    await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "s.sta", bytes: utf8(":20:FICT\r\n:25:FICT/SGD\r\n:60F:C261101SGD1,00\r\n:62F:C261101SGD1,00\r\n") }, key()), "FILE_NOT_A_TABLE");
    expect(await uploadsOfA()).toBe(before);
    // accepted: no extension, a digits-only extension, .txt
    for (const name of ["invoices", "invoices.2026.11", "invoices.txt"]) {
      const r = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: name, bytes: csv(`OK-${name}`) }, key());
      expect(r.upload.fileFormat).toBe("csv");
    }
  });
});

describe("malware scanning (optional, local clamd, fail closed)", () => {
  it("parses clamd replies; anything but OK or FOUND means the scanner is unavailable", () => {
    expect(interpret("stream: OK")).toEqual({ clean: true });
    expect(interpret("stream: Eicar-Test-Signature FOUND")).toEqual({ clean: false, signature: "Eicar-Test-Signature" });
    expect(() => interpret("stream: size limit exceeded. ERROR")).toThrow();
    expect(() => interpret("")).toThrow();
  });

  it("a clean file is stored after a scan; a flagged file is refused and audited with the signature, never stored", async () => {
    const clamd = await fakeClamd("scan");
    const restore = withClamd(clamd.port);
    try {
      const fin = await liveCtx(s, "finance@live-a.example", "a");
      const ok = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "clean.csv", bytes: csv("CLEAN") }, key());
      expect(ok.upload.status).toBe("stored");
      const before = await uploadsOfA();
      await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "bad.csv", bytes: csv("FICTIONAL-MALWARE-TEST-MARKER") }, key()), "FILE_MALWARE_FOUND");
      expect(await uploadsOfA()).toBe(before);
      expect(clamd.seen.length).toBe(2);
      const a = (await auditOf("upload_refused")).find((e) => (e.details as { code?: string }).code === "FILE_MALWARE_FOUND");
      expect(a?.details).toMatchObject({ code: "FILE_MALWARE_FOUND", scanner: "clamd", signature: "Clearline.Test.Marker" });
      expect(JSON.stringify(a)).not.toContain("FICTIONAL-MALWARE-TEST-MARKER");
    } finally { restore(); await clamd.close(); }
  });

  it("an error reply, a silent scanner, an unreachable scanner, and 'required' with none configured all refuse", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const before = await uploadsOfA();
    const err = await fakeClamd("error");
    let restore = withClamd(err.port);
    try { await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "a.csv", bytes: csv("ERR") }, key()), "MALWARE_SCAN_UNAVAILABLE"); } finally { restore(); await err.close(); }
    const silent = await fakeClamd("silent");
    restore = withClamd(silent.port, { CLEARLINE_CLAMD_TIMEOUT_MS: "300" });
    try { await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "a.csv", bytes: csv("SILENT") }, key()), "MALWARE_SCAN_UNAVAILABLE"); } finally { restore(); await silent.close(); }
    restore = withClamd(1); // nothing listens on port 1
    try { await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "a.csv", bytes: csv("DOWN") }, key()), "MALWARE_SCAN_UNAVAILABLE"); } finally { restore(); }
    restore = withClamd(null, { CLEARLINE_MALWARE_SCAN: "required" });
    try { await refused(createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "a.csv", bytes: csv("REQ") }, key()), "MALWARE_SCAN_UNAVAILABLE"); } finally { restore(); }
    expect(await uploadsOfA()).toBe(before);
  });
});

describe("orphan cleanup in both directions", () => {
  const age = (file: string, minutes: number) => { const t0 = new Date(Date.now() - minutes * 60_000); utimesSync(file, t0, t0); };
  const MAPPING: Mapping = {
    fileType: "ledger_invoices",
    columns: { invoice_number: { header: "Invoice Number" }, contact: { header: "Contact" }, currency: { header: "Currency" }, total: { header: "Total", decimalSeparator: "." }, amount_due: { header: "Amount Due", decimalSeparator: "." }, issued_on: { header: "Invoice Date", dateFormat: "iso" } },
  };

  it("dry run reports and changes nothing; the real run removes orphan files, closes open uploads without a file and only reports confirmed ones", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const store = uploadStorage();
    // (1) a stored file with no row, two hours old
    const orphan = await store.put(s.orgs.a, utf8("fictional orphan bytes"));
    age(path.join(dir, s.orgs.a, orphan.storageKey), 120);
    // (2) an open upload whose file vanished
    const open = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "open.csv", bytes: csv("OPEN") }, key());
    // (3) a confirmed upload whose file vanished
    const conf = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "conf.csv", bytes: csv("CONF") }, key());
    await setUploadMapping(fin, conf.upload.id, { mapping: MAPPING }, key());
    const v = (await validateUpload(fin, conf.upload.id, key())).body;
    await decideUpload(fin, conf.upload.id, { decision: "confirm", reason: "fictional check", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
    const keyOf = async (id: string) => (await ownerDb().select({ k: t.uploads.storageKey }).from(t.uploads).where(and(eq(t.uploads.orgId, s.orgs.a), eq(t.uploads.id, id))))[0].k!;
    await store.delete(s.orgs.a, await keyOf(open.upload.id));
    await store.delete(s.orgs.a, await keyOf(conf.upload.id));
    // the rows are "old": the sweep only looks at rows older than its age
    const later = new Date(Date.now() + 2 * 60 * 60_000);

    const dry = await cleanupOrphans(ownerDb(), later, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.byOrg[s.orgs.a]).toEqual({ orphanFiles: expect.arrayContaining([orphan.storageKey]), closedUploads: [open.upload.id], confirmedWithoutFile: [conf.upload.id] });
    expect(existsSync(path.join(dir, s.orgs.a, orphan.storageKey))).toBe(true);
    const [openRow] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, open.upload.id));
    expect(openRow.status).toBe("stored");
    expect((await auditOf("upload_orphans_dry_run")).length).toBe(1);

    const real = await cleanupOrphans(ownerDb(), later);
    expect(real.rows).toMatchObject({ closed: 1, reported: 1 });
    expect(real.files.removed).toBeGreaterThanOrEqual(1);
    expect(existsSync(path.join(dir, s.orgs.a, orphan.storageKey))).toBe(false);
    const [closed] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, open.upload.id));
    expect(closed).toMatchObject({ status: "deleted", storageKey: null });
    const [kept] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, conf.upload.id));
    expect(kept.status).toBe("confirmed"); // evidence is never changed by the sweep
    const [audit] = await auditOf("upload_orphans_cleaned");
    expect(audit.details).toMatchObject({ dryRun: false, closedUploads: [open.upload.id], confirmedWithoutFile: [conf.upload.id] });
    expect(JSON.stringify(audit)).not.toMatch(/open\.csv|conf\.csv|Fictional Buyer/);

    // a second run: nothing left to close; the confirmed one is reported again
    const again = await cleanupOrphans(ownerDb(), later);
    expect(again.rows).toMatchObject({ closed: 0, reported: 1 });
    expect(again.files.removed).toBe(0);
  });

  it("young rows and files are left alone", async () => {
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    const young = await createUpload(fin, { entityId: "ENT-LIVE-SG", fileType: "ledger_invoices", fileName: "young.csv", bytes: csv("YOUNG") }, key());
    const [row] = await ownerDb().select().from(t.uploads).where(eq(t.uploads.id, young.upload.id));
    await uploadStorage().delete(s.orgs.a, row.storageKey!);
    const r = await cleanupOrphans(ownerDb(), new Date(), { dryRun: true });
    expect(r.byOrg[s.orgs.a]?.closedUploads ?? []).not.toContain(young.upload.id);
    expect(r.rows.tooRecent).toBeGreaterThanOrEqual(1);
  });
});
