import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { currentTenantTx, withTenant } from "../tenant";
import type { StoredFile, UploadStorage } from "./index";
import { openUpload, sealUpload, StorageRefused, validAddress } from "./local";

/** The largest file the database store keeps (the file itself, before sealing). */
export const POSTGRES_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const POSTGRES_TOO_LARGE = "This file is larger than 10 MB, the largest file Clearline can keep. Split it into smaller files and upload each one. Nothing was stored.";

/** Who the store acts for when it is not called inside a tenant transaction. */
export interface PostgresStorageVia {
  /** The member and organisation the calling service acts for (a fresh tenant transaction, under row-level security). */
  tenant?: { userId: string; orgId: string };
  /** The schema owner connection of the cross-organisation jobs (orphan sweep, retention, merchant deletion, export). */
  owner?: Db;
}

type Conn = { execute: (q: SQL) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * Uploads in PostgreSQL (CLEARLINE_UPLOAD_STORE=postgres), for hosts whose functions share no disk (Vercel): one
 * upload_blobs row per file (drizzle/0087), holding exactly the sealed bytes LocalDiskStorage writes (sealUpload:
 * AES-256-GCM with CLEARLINE_UPLOAD_KEY, bound to the organisation and key). A row is written in one statement, so
 * there are no partial writes, and never updated.
 *
 * The store has no transaction parameter. It runs each call, in this order:
 *  1. inside the withTenant transaction the call is made from (src/server/tenant.ts, currentTenantTx), so a file is
 *     written and removed atomically with its uploads row and no second connection is taken;
 *  2. otherwise in a fresh withTenant transaction for `via.tenant` (the same set_config of app.user_id / app.org_id);
 *  3. otherwise on `via.owner`, the owner connection the cross-organisation jobs already use.
 * In 1 and 2 row-level security applies (merchant_isolation): a member of one organisation never reads, lists or
 * deletes another's file, and a call naming another organisation is refused before any query.
 */
export class PostgresStorage implements UploadStorage {
  constructor(private readonly key: Buffer | null, private readonly refusal?: string, private readonly via: PostgresStorageVia = {}) {}

  private async run<T>(orgId: string | null, write: boolean, fn: (c: Conn) => Promise<T>): Promise<T> {
    const scope = currentTenantTx();
    const tenant = scope ?? this.via.tenant;
    if (tenant) {
      if (orgId === null) throw new StorageRefused("Only the owner's maintenance jobs list the files of every organisation.");
      if (tenant.orgId !== orgId) throw new StorageRefused("This file belongs to another organisation.");
      if (scope) return fn(scope.tx);
      return withTenant({ userId: tenant.userId, orgId }, (tx) => fn(tx), { read: !write });
    }
    if (this.via.owner) return fn(this.via.owner);
    throw new StorageRefused("Uploads kept in the database are read only by a member of their organisation.");
  }

  private static check(orgId: string, storageKey: string) {
    if (!validAddress(orgId, storageKey)) throw new StorageRefused("Invalid storage address.");
  }

  async put(orgId: string, bytes: Uint8Array) {
    if (this.refusal) throw new StorageRefused(this.refusal);
    if (bytes.byteLength > POSTGRES_MAX_FILE_BYTES) throw new StorageRefused(POSTGRES_TOO_LARGE);
    const storageKey = randomBytes(16).toString("hex");
    PostgresStorage.check(orgId, storageKey);
    const body = sealUpload(this.key, orgId, storageKey, bytes);
    await this.run(orgId, true, (c) => c.execute(sql`insert into upload_blobs (org_id, storage_key, body, size_bytes, sha256)
      values (${orgId}, ${storageKey}, ${body}, ${body.length}, ${sha256(body)})`));
    return { storageKey, encrypted: this.key !== null };
  }

  async get(orgId: string, storageKey: string): Promise<Uint8Array> {
    PostgresStorage.check(orgId, storageKey);
    const r = await this.run(orgId, false, (c) => c.execute(sql`select body, sha256 from upload_blobs where org_id = ${orgId} and storage_key = ${storageKey}`));
    const row = r.rows[0];
    if (!row) throw new StorageRefused("The stored file is missing.");
    const body = Buffer.from(row.body as Uint8Array);
    if (sha256(body) !== row.sha256) throw new StorageRefused("The stored file is damaged.");
    return openUpload(this.key, orgId, storageKey, body);
  }

  async delete(orgId: string, storageKey: string): Promise<boolean> {
    PostgresStorage.check(orgId, storageKey);
    const r = await this.run(orgId, true, (c) => c.execute(sql`delete from upload_blobs where org_id = ${orgId} and storage_key = ${storageKey}`));
    return (r.rowCount ?? 0) > 0;
  }

  /** Every stored file of every organisation (owner connection only; addresses and times, never contents). */
  async list(): Promise<StoredFile[]> {
    const r = await this.run(null, false, (c) => c.execute(sql`select org_id, storage_key, created_at from upload_blobs order by org_id, storage_key`));
    return r.rows.map((x) => ({ orgId: String(x.org_id), storageKey: String(x.storage_key), partial: false, modifiedAt: new Date(x.created_at as string | Date) }));
  }

  /** An insert is atomic: there is never a partial write. */
  async deletePartial(): Promise<boolean> {
    return false;
  }

  async deleteOrganisation(orgId: string): Promise<number> {
    PostgresStorage.check(orgId, "0".repeat(32));
    const r = await this.run(orgId, true, (c) => c.execute(sql`delete from upload_blobs where org_id = ${orgId}`));
    return r.rowCount ?? 0;
  }
}
