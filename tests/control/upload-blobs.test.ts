/**
 * Uploads kept in PostgreSQL (CLEARLINE_UPLOAD_STORE=postgres, drizzle/0087, src/server/storage/postgres.ts) against a
 * real PostgreSQL 16: the sealed bytes round trip, one organisation never reads, lists or deletes another's file (the
 * store and the database both refuse), a blob written in a failed transaction disappears with it, production without
 * CLEARLINE_UPLOAD_KEY refuses, files over 10 MB are refused, and an upload goes through validate, confirm and
 * normalise with no disk at all. Every value is fictional.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { accountFields, liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { closeDatabase } from "../../src/server/db/client";
import { withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { StorageRefused, uploadStorage } from "../../src/server/storage";
import { PostgresStorage, POSTGRES_MAX_FILE_BYTES } from "../../src/server/storage/postgres";
import { createUpload, decideUpload, deleteUpload, purgeExpiredUploads, setUploadMapping, sweepOrphanFiles, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";

let s: LiveSeed;
let dir: string;
let fin: TenantContext, finB: TenantContext;
let n = 0;
const key = () => `blob-key-${++n}-${Date.now()}`;
const bytes = new TextEncoder().encode("Invoice,Total,Currency,Issued\nFICT-1,10.00,SGD,2026-11-01T00:00:00Z\n");
const owner = () => ownerDb();
const asMember = (c: TenantContext, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId: c.userId, orgId }, (tx) => tx.execute(q));
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}

beforeAll(async () => {
  dir = useTestStorage(true);
  process.env.CLEARLINE_UPLOAD_STORE = "postgres";
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb(), "-blob");
  [fin, finB] = await Promise.all([liveCtx(s, "finance@live-a.example", "a"), liveCtx(s, "finance@live-b.example", "b")]);
});
afterEach(() => { (process.env as Record<string, string>).NODE_ENV = "test"; });
afterAll(async () => { delete process.env.CLEARLINE_UPLOAD_STORE; await closeDatabase(); await closeOwner(); });

describe("the store", () => {
  it("is selected by CLEARLINE_UPLOAD_STORE=postgres; local stays the default", () => {
    expect(uploadStorage({ tenant: fin })).toBeInstanceOf(PostgresStorage);
    delete process.env.CLEARLINE_UPLOAD_STORE;
    expect(uploadStorage()).not.toBeInstanceOf(PostgresStorage);
    process.env.CLEARLINE_UPLOAD_STORE = "postgres";
  });

  it("put → get round trips; the row holds the sealed bytes only (never the file), with their size and digest", async () => {
    const st = uploadStorage({ tenant: fin });
    const put = await st.put(fin.orgId, bytes);
    expect(put).toMatchObject({ encrypted: true, storageKey: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(Buffer.from(await st.get(fin.orgId, put.storageKey))).toEqual(Buffer.from(bytes));
    const [row] = (await owner().execute(sql`select body, size_bytes, sha256 from upload_blobs where org_id = ${fin.orgId} and storage_key = ${put.storageKey}`)).rows;
    const body = row.body as Buffer;
    expect(body.subarray(0, 4).toString()).toBe("CLU1");
    expect(body.includes(Buffer.from("FICT-1"))).toBe(false);
    expect(row.size_bytes).toBe(body.length);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]); // nothing on disk
  });

  it("organisation B never reads, lists or deletes organisation A's file: the store refuses, and the database shows nothing", async () => {
    const put = await uploadStorage({ tenant: fin }).put(fin.orgId, bytes);
    const asB = uploadStorage({ tenant: finB });
    await expect(asB.get(fin.orgId, put.storageKey)).rejects.toThrow(/another organisation/);
    await expect(asB.delete(fin.orgId, put.storageKey)).rejects.toThrow(/another organisation/);
    await expect(asB.deleteOrganisation!(fin.orgId)).rejects.toThrow(/another organisation/);
    await expect(asB.list!()).rejects.toThrow(/owner's maintenance jobs/);
    // inside B's own transaction (the ambient tenant transaction), a call naming A is refused as well
    await expect(withTenant({ userId: finB.userId, orgId: finB.orgId }, () => uploadStorage().get(fin.orgId, put.storageKey))).rejects.toThrow(/another organisation/);
    // the database: B's member, in B's organisation, sees no blob of A's; naming A's organisation makes B no member there
    expect((await asMember(finB, finB.orgId, sql`select count(*)::int as n from upload_blobs where org_id = ${fin.orgId}`)).rows[0].n).toBe(0);
    expect((await asMember(finB, fin.orgId, sql`select count(*)::int as n from upload_blobs`)).rows[0].n).toBe(0);
    expect((await asMember(finB, fin.orgId, sql`delete from upload_blobs where org_id = ${fin.orgId}`)).rowCount).toBe(0);
    await dbRefuses(asMember(finB, fin.orgId, sql`insert into upload_blobs (org_id, storage_key, body, size_bytes, sha256) values (${fin.orgId}, ${"a".repeat(32)}, '\\x00', 1, ${"0".repeat(64)})`), /row-level security/);
    // no context at all: the runtime login reads nothing
    expect((await withTenant({ userId: finB.userId }, (tx) => tx.execute(sql`select count(*)::int as n from upload_blobs`))).rows[0].n).toBe(0);
    // and the file is still there for A
    expect(Buffer.from(await uploadStorage({ tenant: fin }).get(fin.orgId, put.storageKey))).toEqual(Buffer.from(bytes));
  });

  it("a blob is immutable: the runtime role has no UPDATE, and a sealed body moved to another key fails to open", async () => {
    const st = uploadStorage({ tenant: fin });
    const a = await st.put(fin.orgId, bytes);
    await dbRefuses(asMember(fin, fin.orgId, sql`update upload_blobs set sha256 = sha256 where org_id = ${fin.orgId}`), /permission denied/);
    const b = await st.put(fin.orgId, new TextEncoder().encode("other"));
    await owner().execute(sql`update upload_blobs set body = (select body from upload_blobs where org_id = ${fin.orgId} and storage_key = ${a.storageKey}),
      size_bytes = (select size_bytes from upload_blobs where org_id = ${fin.orgId} and storage_key = ${a.storageKey}),
      sha256 = (select sha256 from upload_blobs where org_id = ${fin.orgId} and storage_key = ${a.storageKey}) where org_id = ${fin.orgId} and storage_key = ${b.storageKey}`);
    await expect(st.get(fin.orgId, b.storageKey)).rejects.toThrow();
    await owner().execute(sql`update upload_blobs set sha256 = ${"0".repeat(64)} where org_id = ${fin.orgId} and storage_key = ${a.storageKey}`);
    await expect(st.get(fin.orgId, a.storageKey)).rejects.toThrow(/damaged/);
  });

  it("delete removes the file once (true, then false); a missing file is refused plainly", async () => {
    const st = uploadStorage({ tenant: fin });
    const put = await st.put(fin.orgId, bytes);
    expect(await st.delete(fin.orgId, put.storageKey)).toBe(true);
    expect(await st.delete(fin.orgId, put.storageKey)).toBe(false);
    await expect(st.get(fin.orgId, put.storageKey)).rejects.toThrow(/missing/);
  });

  it("a blob written inside a tenant transaction that fails is rolled back with it", async () => {
    let written = "";
    await expect(withTenant({ userId: fin.userId, orgId: fin.orgId }, async () => {
      written = (await uploadStorage().put(fin.orgId, bytes)).storageKey;
      throw new Error("fictional failure after the write");
    })).rejects.toThrow(/fictional failure/);
    expect(written).toMatch(/^[0-9a-f]{32}$/);
    expect((await owner().execute(sql`select count(*)::int as n from upload_blobs where storage_key = ${written}`)).rows[0].n).toBe(0);
  });

  it("outside any tenant transaction, with no member and no owner connection, it refuses", async () => {
    await expect(uploadStorage().put(fin.orgId, bytes)).rejects.toThrow(/member of their organisation/);
  });

  it("refuses to store in production without CLEARLINE_UPLOAD_KEY (as local disk does)", async () => {
    const saved = process.env.CLEARLINE_UPLOAD_KEY;
    delete process.env.CLEARLINE_UPLOAD_KEY;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      await expect(uploadStorage({ tenant: fin }).put(fin.orgId, bytes)).rejects.toThrow(/CLEARLINE_UPLOAD_KEY is not set/);
    } finally { process.env.CLEARLINE_UPLOAD_KEY = saved; }
  });

  it("refuses a file over 10 MB with a plain-English message; 10 MB itself is kept", async () => {
    const st = uploadStorage({ tenant: fin });
    await expect(st.put(fin.orgId, new Uint8Array(POSTGRES_MAX_FILE_BYTES + 1))).rejects.toThrow(/larger than 10 MB.*Split it into smaller files/);
    await expect(st.put(fin.orgId, new Uint8Array(POSTGRES_MAX_FILE_BYTES + 1))).rejects.toBeInstanceOf(StorageRefused);
    const ok = await st.put(fin.orgId, randomBytes(POSTGRES_MAX_FILE_BYTES));
    expect((await st.get(fin.orgId, ok.storageKey)).byteLength).toBe(POSTGRES_MAX_FILE_BYTES);
    expect(await st.delete(fin.orgId, ok.storageKey)).toBe(true);
  });

  it("the owner connection lists every organisation's files and removes one organisation's", async () => {
    const b = await uploadStorage({ tenant: finB }).put(finB.orgId, bytes);
    const st = uploadStorage({ owner: owner() });
    const listed = await st.list!();
    expect(listed.some((f) => f.orgId === finB.orgId && f.storageKey === b.storageKey && !f.partial)).toBe(true);
    expect(listed.some((f) => f.orgId === fin.orgId)).toBe(true);
    expect(await st.deleteOrganisation!(finB.orgId)).toBeGreaterThanOrEqual(1);
    expect((await st.list!()).some((f) => f.orgId === finB.orgId)).toBe(false);
  });
});

describe("the upload pipeline with CLEARLINE_UPLOAD_STORE=postgres", () => {
  it("upload → map → validate → confirm → normalise, with no file on disk; delete and the orphan sweep work on the blobs", async () => {
    const up = await createUpload(fin, { entityId: sc.SG.entityId, fileType: "orders_invoices", fileName: "orders.csv", bytes: sc.sgOrdersCsv(), ...(await accountFields(fin, sc.SG.entityId, "orders_invoices")) }, key());
    expect(up.upload).toMatchObject({ status: "stored", encrypted: true });
    const [u] = (await owner().execute(sql`select storage_key from uploads where id = ${up.upload.id}`)).rows;
    expect((await owner().execute(sql`select count(*)::int as n from upload_blobs where org_id = ${fin.orgId} and storage_key = ${u.storage_key}`)).rows[0].n).toBe(1);
    await setUploadMapping(fin, up.upload.id, { mapping: sc.SG_ORDERS_MAPPING }, key());
    const v = (await validateUpload(fin, up.upload.id, key())).body;
    await decideUpload(fin, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
    const norm = (await normaliseUpload(fin, up.upload.id, key())).body;
    expect(norm).toMatchObject({ changed: true, counts: { created: 4 } });
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);

    // another organisation's member cannot normalise or read it
    await expect(normaliseUpload(finB, up.upload.id, key())).rejects.toThrow();

    // an unconfirmed upload is deleted with its blob, in the same transaction
    const other = await createUpload(fin, { entityId: sc.SG.entityId, fileType: "orders_invoices", fileName: "orders-2.csv", bytes: sc.sgOrdersCsv(["SG-1999,99.00,SGD,2026-11-01T00:00:00Z"]), ...(await accountFields(fin, sc.SG.entityId, "orders_invoices")) }, key());
    const [o] = (await owner().execute(sql`select storage_key from uploads where id = ${other.upload.id}`)).rows;
    await deleteUpload(fin, other.upload.id, key());
    expect((await owner().execute(sql`select count(*)::int as n from upload_blobs where storage_key = ${o.storage_key}`)).rows[0].n).toBe(0);

    // the owner's sweep removes a blob no upload names (once old enough) and keeps the one that is named
    const orphan = await uploadStorage({ tenant: fin }).put(fin.orgId, bytes);
    await owner().execute(sql`update upload_blobs set created_at = now() - interval '2 hours' where storage_key = ${orphan.storageKey}`);
    const swept = await sweepOrphanFiles(owner(), new Date());
    expect(swept.removed).toBeGreaterThanOrEqual(1);
    expect((await owner().execute(sql`select count(*)::int as n from upload_blobs where storage_key = ${orphan.storageKey}`)).rows[0].n).toBe(0);
    expect((await owner().execute(sql`select count(*)::int as n from upload_blobs where storage_key = ${u.storage_key}`)).rows[0].n).toBe(1);

    // retention (owner) removes the confirmed upload's blob
    const purged = await purgeExpiredUploads(owner(), new Date(Date.now() + 4000 * 86_400_000), { orgId: fin.orgId });
    expect(purged).toMatchObject({ uploads: 1, files: 1 });
    expect((await owner().execute(sql`select count(*)::int as n from upload_blobs where storage_key = ${u.storage_key}`)).rows[0].n).toBe(0);
  });

  it("an upload over 10 MB is refused before anything is recorded (409 STORAGE_REFUSED, plain English)", async () => {
    // a well-formed orders file (every cell under the reader's limits) just over 10 MB
    const big = sc.sgOrdersCsv(Array.from({ length: 1100 }, (_, i) => `SG-B${i}-${"X".repeat(9_600)},1.00,SGD,2026-11-01T00:00:00Z`));
    expect(big.byteLength).toBeGreaterThan(POSTGRES_MAX_FILE_BYTES);
    const before = (await owner().execute(sql`select count(*)::int as n from uploads where org_id = ${fin.orgId}`)).rows[0].n;
    try {
      await createUpload(fin, { entityId: sc.SG.entityId, fileType: "orders_invoices", fileName: "big.csv", bytes: big, ...(await accountFields(fin, sc.SG.entityId, "orders_invoices")) }, key());
      throw new Error("expected a refusal");
    } catch (e) {
      if (!(e instanceof RequestRefused)) throw e;
      expect(e).toMatchObject({ status: 409, code: "STORAGE_REFUSED" });
      expect(e.message).toMatch(/larger than 10 MB/);
    }
    expect((await owner().execute(sql`select count(*)::int as n from uploads where org_id = ${fin.orgId}`)).rows[0].n).toBe(before);
  });
});
