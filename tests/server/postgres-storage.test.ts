/**
 * Uploads in PostgreSQL (src/server/storage/postgres.ts), without a database: an in-memory stand-in for the owner
 * connection records every statement. The same sealed bytes as local disk, refusals before any query, and the store
 * selection. Against a real PostgreSQL 16 (row-level security, rollback, the pipeline): tests/control/upload-blobs.test.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { RefusingStorage, StorageRefused, uploadStorage } from "@/server/storage";
import { openUpload } from "@/server/storage/local";
import { PostgresStorage, POSTGRES_MAX_FILE_BYTES } from "@/server/storage/postgres";
import type { Db } from "@/server/db/client";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const bytes = new TextEncoder().encode("Order,Amount\nORD-FICTIONAL-1,10.00\n");
const dialect = new PgDialect();

/** A fake owner connection over a Map, keyed "<org>/<key>"; `log` keeps each statement's text. */
function fakeOwner() {
  const rows = new Map<string, { body: Buffer; size: number; sha256: string; at: Date }>();
  const log: string[] = [];
  const execute = async (q: SQL) => {
    const { sql: text, params } = dialect.sqlToQuery(q);
    log.push(text);
    const p = params as unknown[];
    if (text.startsWith("insert into upload_blobs")) {
      const id = `${p[0]}/${p[1]}`;
      if (rows.has(id)) throw new Error("duplicate key");
      rows.set(id, { body: p[2] as Buffer, size: p[3] as number, sha256: p[4] as string, at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("select body")) {
      const r = rows.get(`${p[0]}/${p[1]}`);
      return { rows: r ? [{ body: r.body, sha256: r.sha256 }] : [], rowCount: r ? 1 : 0 };
    }
    if (text.startsWith("select org_id")) {
      return { rows: [...rows].map(([id, r]) => ({ org_id: id.split("/")[0], storage_key: id.split("/")[1], created_at: r.at })), rowCount: rows.size };
    }
    if (text.startsWith("delete from upload_blobs") && p.length === 2) return { rows: [], rowCount: rows.delete(`${p[0]}/${p[1]}`) ? 1 : 0 };
    if (text.startsWith("delete from upload_blobs")) {
      let n = 0;
      for (const id of [...rows.keys()]) if (id.startsWith(`${p[0]}/`)) { rows.delete(id); n++; }
      return { rows: [], rowCount: n };
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  return { db: { execute } as unknown as Db, rows, log };
}

describe("PostgresStorage", () => {
  it("stores the same sealed bytes as local disk (AES-256-GCM bound to organisation and key) and reads them back", async () => {
    const f = fakeOwner();
    const key = randomBytes(32);
    const org = randomUUID();
    const st = new PostgresStorage(key, undefined, { owner: f.db });
    const a = await st.put(org, bytes);
    const b = await st.put(org, bytes);
    expect(a).toMatchObject({ encrypted: true, storageKey: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(a.storageKey).not.toBe(b.storageKey);
    const row = f.rows.get(`${org}/${a.storageKey}`)!;
    expect(row.body.subarray(0, 4).toString()).toBe("CLU1");
    expect(row.body.includes(Buffer.from("ORD-FICTIONAL-1"))).toBe(false);
    expect(row.size).toBe(row.body.length);
    expect(openUpload(key, org, a.storageKey, row.body)).toEqual(bytes);
    expect(await st.get(org, a.storageKey)).toEqual(bytes);
    // the statements name the columns of drizzle/0087 and pass every value as a parameter
    expect(f.log[0]).toMatch(/^insert into upload_blobs \(org_id, storage_key, body, size_bytes, sha256\)\s+values \(\$1, \$2, \$3, \$4, \$5\)$/);
  });

  it("without a key (development only) the body is CLU0 and not encrypted", async () => {
    const f = fakeOwner();
    const org = randomUUID();
    const st = new PostgresStorage(null, undefined, { owner: f.db });
    const a = await st.put(org, bytes);
    expect(a.encrypted).toBe(false);
    expect(f.rows.get(`${org}/${a.storageKey}`)!.body.subarray(0, 4).toString()).toBe("CLU0");
    expect(await st.get(org, a.storageKey)).toEqual(bytes);
  });

  it("delete, list, deleteOrganisation; a missing, damaged or moved file is refused", async () => {
    const f = fakeOwner();
    const key = randomBytes(32);
    const org = randomUUID(), other = randomUUID();
    const st = new PostgresStorage(key, undefined, { owner: f.db });
    const a = await st.put(org, bytes);
    const b = await st.put(other, bytes);
    expect((await st.list()).map((x) => `${x.orgId}/${x.storageKey}/${x.partial}`).sort()).toEqual([`${org}/${a.storageKey}/false`, `${other}/${b.storageKey}/false`].sort());
    expect(await st.deletePartial()).toBe(false);
    // the sealed body of another organisation's file, copied under this organisation's address, does not open
    f.rows.set(`${org}/${b.storageKey}`, { ...f.rows.get(`${other}/${b.storageKey}`)! });
    await expect(st.get(org, b.storageKey)).rejects.toThrow();
    f.rows.get(`${org}/${a.storageKey}`)!.sha256 = "0".repeat(64);
    await expect(st.get(org, a.storageKey)).rejects.toThrow(/damaged/);
    expect(await st.delete(org, a.storageKey)).toBe(true);
    expect(await st.delete(org, a.storageKey)).toBe(false);
    await expect(st.get(org, a.storageKey)).rejects.toThrow(/missing/);
    expect(await st.deleteOrganisation(other)).toBe(1);
    expect((await st.list()).map((x) => x.orgId)).toEqual([org]);
  });

  it("refuses before any query: invalid addresses, the production refusal, files over 10 MB", async () => {
    const f = fakeOwner();
    const st = new PostgresStorage(randomBytes(32), undefined, { owner: f.db });
    await expect(st.put("not-a-uuid", bytes)).rejects.toThrow(/Invalid storage address/);
    await expect(st.get(randomUUID(), "../../etc/passwd")).rejects.toThrow(/Invalid storage address/);
    await expect(st.delete(randomUUID(), "0".repeat(31))).rejects.toThrow(/Invalid storage address/);
    await expect(st.put(randomUUID(), new Uint8Array(POSTGRES_MAX_FILE_BYTES + 1))).rejects.toThrow(/larger than 10 MB, the largest file Clearline can keep\. Split it into smaller files/);
    const refusing = new PostgresStorage(null, "Uploads are refused: no key.", { owner: f.db });
    await expect(refusing.put(randomUUID(), bytes)).rejects.toThrow(/no key/);
    expect(f.log).toEqual([]);
    expect(f.rows.size).toBe(0);
    await expect(st.put(randomUUID(), new Uint8Array(POSTGRES_MAX_FILE_BYTES))).resolves.toMatchObject({ encrypted: true });
  });

  it("a store bound to a member refuses another organisation's address and the cross-organisation listing", async () => {
    const org = randomUUID();
    const st = new PostgresStorage(randomBytes(32), undefined, { tenant: { userId: "user-fictional", orgId: org } });
    await expect(st.get(randomUUID(), "0".repeat(32))).rejects.toThrow(/another organisation/);
    await expect(st.delete(randomUUID(), "0".repeat(32))).rejects.toThrow(/another organisation/);
    await expect(st.put(randomUUID(), bytes)).rejects.toThrow(/another organisation/);
    await expect(st.list()).rejects.toThrow(/owner's maintenance jobs/);
    await expect(new PostgresStorage(null).put(org, bytes)).rejects.toThrow(/member of their organisation/);
  });

  it("uploadStorage(): CLEARLINE_UPLOAD_STORE=postgres selects it; production without CLEARLINE_UPLOAD_KEY refuses; local stays the default", async () => {
    const f = fakeOwner();
    process.env.CLEARLINE_UPLOAD_STORE = "postgres";
    process.env.CLEARLINE_UPLOAD_KEY = randomBytes(32).toString("base64");
    expect(uploadStorage({ owner: f.db })).toBeInstanceOf(PostgresStorage);
    expect((await uploadStorage({ owner: f.db }).put(randomUUID(), bytes)).encrypted).toBe(true);
    delete process.env.CLEARLINE_UPLOAD_KEY;
    (process.env as Record<string, string>).NODE_ENV = "production";
    await expect(uploadStorage({ owner: f.db }).put(randomUUID(), bytes)).rejects.toThrow(/CLEARLINE_UPLOAD_KEY is not set/);
    await expect(uploadStorage({ owner: f.db }).put(randomUUID(), bytes)).rejects.toBeInstanceOf(StorageRefused);
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.CLEARLINE_UPLOAD_STORE = "Postgres";
    expect(uploadStorage()).toBeInstanceOf(RefusingStorage);
    delete process.env.CLEARLINE_UPLOAD_STORE;
    expect(uploadStorage({ owner: f.db })).not.toBeInstanceOf(PostgresStorage);
    expect(uploadStorage().constructor.name).toBe("LocalDiskStorage");
  });
});
