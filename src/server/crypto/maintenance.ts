import "server-only";
import { sql, type SQL } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { FieldCryptoError, sealedVersion, type OrgCipher } from "./envelope";
import { ENCRYPTED_TABLES, openOne, sealOne, type EncryptedTable, type EncryptedTableName } from "./fields";
import { kmsFromEnv, newKeyMaterial, type Kms } from "./kms";
import { cipherFor, clearKeyCache, keyRows, wrapContext } from "./org-keys";

/**
 * v1 Phase 5.3: key maintenance, run by the schema OWNER (scripts/crypto/keys.ts), never by the web app:
 *   backfill      seal every value written before encryption was on (expand step), in batches
 *   reencrypt     the lazy re-encrypt job: move every value sealed with a retired data key to the active one
 *   rotateDataKey new data key version per organisation (old one retired: it still opens, nothing new is sealed with it)
 *   rewrap        re-wrap every organisation key under the KMS's active master key (master key rotation)
 *   verify        open every sealed value, compare it with its plaintext copy and its blind index
 *   status        counts per organisation / table / key version
 * All of them run while the app serves: each batch is its own short transaction, and the app reads both the old and
 * the new form (a retired key still opens; a value not yet sealed falls back to its plaintext copy).
 * Results are counts only: never a value, a key or a row id.
 */
type Row = Record<string, unknown>;
const TABLES = Object.keys(ENCRYPTED_TABLES) as EncryptedTableName[];
const spec = (n: EncryptedTableName) => ENCRYPTED_TABLES[n] as EncryptedTable;
const id = (s: string) => sql.identifier(s);
const toCamel = (r: Row, s: EncryptedTable): Row => {
  const out: Row = {};
  for (const k of s.key) out[k.prop] = r[k.column];
  for (const c of s.columns) { out[c.prop] = r[c.column]; out[c.encProp] = r[c.encColumn]; if (c.bidxProp) out[c.bidxProp] = r[c.bidxColumn!]; }
  return out;
};
const selectList = (s: EncryptedTable) => sql.join([...new Set([...s.key.map((k) => k.column), ...s.columns.flatMap((c) => [c.column, c.encColumn, ...(c.bidxColumn ? [c.bidxColumn] : [])])])].map(id), sql`, `);
const keyMatch = (s: EncryptedTable, r: Row): SQL => sql.join(s.key.map((k) => sql`${id(k.column)} = ${r[k.prop] instanceof Date ? (r[k.prop] as Date).toISOString() : r[k.prop]}`), sql` and `);

export interface BatchOptions { batchSize?: number; kms?: Kms | null; orgIds?: string[] }

async function orgsWith(db: Db, orgIds?: string[]): Promise<string[]> {
  if (orgIds) return orgIds;
  const r = await db.execute(sql`select id from organizations order by id`);
  return (r.rows as { id: string }[]).map((x) => x.id);
}

/** Rows of one organisation and table that need sealing (`missing`) or re-sealing under the active version (`stale`). */
function workWhere(s: EncryptedTable, active: number): SQL {
  const parts = s.columns.flatMap((c) => [
    sql`(${id(c.column)} is not null and ${id(c.encColumn)} is null)`,
    sql`(${id(c.encColumn)} is not null and split_part(${id(c.encColumn)}, '.', 2)::int <> ${active})`,
  ]);
  return sql.join(parts, sql` or `);
}

/**
 * Backfill and re-encrypt in one pass (the same job): every value of every encrypted column ends up sealed with the
 * organisation's active data key, with its blind index. A value already sealed is first opened (and checked against
 * its plaintext copy); a blind index already written is kept (the trigger refuses any change to it).
 */
export async function sealAll(db: Db, opts: BatchOptions = {}): Promise<{ sealed: number; resealed: number; tables: Record<string, number> }> {
  const kms = opts.kms === undefined ? kmsFromEnv() : opts.kms;
  if (!kms) throw new FieldCryptoError("Key maintenance needs a KMS (CLEARLINE_KMS_KEYS).");
  const size = opts.batchSize ?? 500;
  let sealed = 0, resealed = 0;
  const tables: Record<string, number> = {};
  for (const orgId of await orgsWith(db, opts.orgIds)) {
    for (const name of TABLES) {
      const s = spec(name);
      for (;;) {
        const n = await db.transaction(async (tx) => {
          // an organisation with no keys gets them only when it has something to seal
          let cipher = await cipherFor(tx, orgId, "read", kms);
          if (!cipher) {
            const any = await tx.execute(sql`select 1 from ${id(s.table)} where org_id = ${orgId} and (${sql.join(s.columns.map((c) => sql`${id(c.column)} is not null`), sql` or `)}) limit 1`);
            if (!any.rows.length) return 0;
            cipher = (await cipherFor(tx, orgId, "write", kms))!;
          }
          const rows = (await tx.execute(sql`select ${selectList(s)} from ${id(s.table)} where org_id = ${orgId} and (${workWhere(s, cipher.activeVersion)}) limit ${size} for update`)).rows as Row[];
          for (const raw of rows) {
            const r = toCamel(raw, s);
            const wasSealed = s.columns.some((c) => r[c.encProp] !== null);
            const next = resealRow(cipher, s, r);
            const set = sql.join(s.columns.flatMap((c) => [sql`${id(c.encColumn)} = ${next[c.encProp] as string | null}`, ...(c.bidxColumn ? [sql`${id(c.bidxColumn)} = ${next[c.bidxProp!] as string | null}`] : [])]), sql`, `);
            await tx.execute(sql`update ${id(s.table)} set ${set} where org_id = ${orgId} and ${keyMatch(s, r)}`);
            if (wasSealed) resealed++; else sealed++;
          }
          return rows.length;
        });
        if (n) tables[name] = (tables[name] ?? 0) + n;
        if (n < size) break;
      }
    }
  }
  return { sealed, resealed, tables };
}

/** One row → its values sealed under the active key; existing blind indexes kept (and checked). */
function resealRow(cipher: OrgCipher, s: EncryptedTable, r: Row): Row {
  const plain = openOne(cipher, s, r); // opens sealed values (and checks them against the plaintext copies)
  const fresh = sealOne(cipher, s, plain);
  for (const c of s.columns) {
    if (!c.bidxProp || r[c.bidxProp] === null || r[c.bidxProp] === undefined) continue;
    if (fresh[c.bidxProp] !== r[c.bidxProp]) throw new FieldCryptoError(`${s.table}.${c.column}: a stored blind index does not match its value.`);
  }
  return fresh;
}

/**
 * Data-key rotation: per organisation, the active data key is retired and a new version becomes active, in one
 * transaction (the one-active index makes it atomic). Running servers pick the new key up on their next transaction;
 * values sealed with the retired key keep opening until `sealAll` has moved them.
 */
export async function rotateDataKeys(db: Db, opts: { kms?: Kms | null; orgIds?: string[] } = {}): Promise<{ rotated: number }> {
  const kms = opts.kms === undefined ? kmsFromEnv() : opts.kms;
  if (!kms) throw new FieldCryptoError("Key rotation needs a KMS (CLEARLINE_KMS_KEYS).");
  let rotated = 0;
  for (const orgId of await orgsWith(db, opts.orgIds)) {
    await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`select version, status from org_data_keys where org_id = ${orgId} and purpose = 'data' order by version for update`)).rows as { version: number; status: string }[];
      if (!rows.length) return; // no keys yet: the first write creates version 1
      const version = Math.max(...rows.map((r) => r.version)) + 1;
      const w = await kms.wrap(newKeyMaterial(), wrapContext(orgId, "data", version));
      await tx.execute(sql`update org_data_keys set status = 'retired', retired_at = now() where org_id = ${orgId} and purpose = 'data' and status = 'active'`);
      await tx.execute(sql`insert into org_data_keys (org_id, purpose, version, kek_id, wrapped_key, status) values (${orgId}, 'data', ${version}, ${w.kekId}, ${w.wrapped}, 'active')`);
      rotated++;
    });
  }
  return { rotated };
}

/**
 * Master-key rotation: every organisation key wrapped under another master key is unwrapped and wrapped again under
 * the KMS's active one. No field value changes. Needs both master keys configured while it runs (new one first).
 */
export async function rewrapAll(db: Db, opts: { kms?: Kms | null } = {}): Promise<{ rewrapped: number; remainingOther: number }> {
  const kms = opts.kms === undefined ? kmsFromEnv() : opts.kms;
  if (!kms) throw new FieldCryptoError("Re-wrapping needs a KMS (CLEARLINE_KMS_KEYS).");
  const active = kms.activeKekId();
  let rewrapped = 0;
  for (;;) {
    const n = await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`select org_id, purpose, version, kek_id, wrapped_key from org_data_keys where kek_id <> ${active} order by org_id, purpose, version limit 200 for update`)).rows as { org_id: string; purpose: "data" | "index"; version: number; kek_id: string; wrapped_key: string }[];
      for (const r of rows) {
        const ctx = wrapContext(r.org_id, r.purpose, r.version);
        const key = await kms.unwrap({ kekId: r.kek_id, wrapped: r.wrapped_key }, ctx);
        const w = await kms.wrap(key, ctx);
        await tx.execute(sql`update org_data_keys set kek_id = ${w.kekId}, wrapped_key = ${w.wrapped}, rewrapped_at = clock_timestamp() where org_id = ${r.org_id} and purpose = ${r.purpose} and version = ${r.version}`);
      }
      return rows.length;
    });
    rewrapped += n;
    if (n < 200) break;
  }
  clearKeyCache();
  const left = await db.execute(sql`select count(*)::int as n from org_data_keys where kek_id <> ${active}`);
  return { rewrapped, remainingOther: (left.rows[0] as { n: number }).n };
}

export interface VerifyResult { checked: number; unsealed: number; problems: { table: string; column: string; kind: string }[] }

/** Open every sealed value and compare it with its plaintext copy and its blind index (counts and table names only). */
export async function verifyAll(db: Db, opts: BatchOptions = {}): Promise<VerifyResult> {
  const kms = opts.kms === undefined ? kmsFromEnv() : opts.kms;
  const out: VerifyResult = { checked: 0, unsealed: 0, problems: [] };
  for (const orgId of await orgsWith(db, opts.orgIds)) {
    await db.transaction(async (tx: Tx) => {
      const cipher = await cipherFor(tx, orgId, "read", kms);
      for (const name of TABLES) {
        const s = spec(name);
        const rows = (await tx.execute(sql`select ${selectList(s)} from ${id(s.table)} where org_id = ${orgId}`)).rows as Row[];
        for (const raw of rows) {
          const r = toCamel(raw, s);
          for (const c of s.columns) if (r[c.prop] !== null && r[c.prop] !== undefined && (r[c.encProp] === null || r[c.encProp] === undefined)) out.unsealed++;
          if (!s.columns.some((c) => r[c.encProp] !== null && r[c.encProp] !== undefined)) continue;
          out.checked++;
          try {
            const plain = openOne(cipher, s, r);
            if (cipher) {
              const again = sealOne(cipher, s, plain);
              for (const c of s.columns) if (c.bidxProp && r[c.bidxProp] !== null && again[c.bidxProp] !== r[c.bidxProp]) out.problems.push({ table: s.table, column: c.column, kind: "blind_index_mismatch" });
            }
          } catch (e) {
            out.problems.push({ table: s.table, column: "*", kind: e instanceof FieldCryptoError ? "does_not_open_or_disagrees" : "error" });
          }
        }
      }
    });
  }
  return out;
}

export interface KeyStatus { orgId: string; dataVersions: { version: number; status: string; kekId: string }[]; sealedByVersion: Record<string, number>; unsealed: number }

/** Per organisation: its data key versions and how many values each version sealed (to see when a retired key is free). */
export async function keyStatus(db: Db, opts: { orgIds?: string[] } = {}): Promise<KeyStatus[]> {
  const out: KeyStatus[] = [];
  for (const orgId of await orgsWith(db, opts.orgIds)) {
    const keys = await db.transaction((tx) => keyRows(tx, orgId));
    const sealedByVersion: Record<string, number> = {};
    let unsealed = 0;
    for (const name of TABLES) {
      const s = spec(name);
      for (const c of s.columns) {
        const r = await db.execute(sql`select split_part(${id(c.encColumn)}, '.', 2) as v, count(*)::int as n from ${id(s.table)} where org_id = ${orgId} and ${id(c.encColumn)} is not null group by 1`);
        for (const x of r.rows as { v: string; n: number }[]) sealedByVersion[x.v] = (sealedByVersion[x.v] ?? 0) + x.n;
        const u = await db.execute(sql`select count(*)::int as n from ${id(s.table)} where org_id = ${orgId} and ${id(c.column)} is not null and ${id(c.encColumn)} is null`);
        unsealed += (u.rows[0] as { n: number }).n;
      }
    }
    if (!keys.length && !unsealed) continue;
    out.push({ orgId, dataVersions: keys.filter((k) => k.purpose === "data").sort((a, b) => a.version - b.version).map((k) => ({ version: k.version, status: k.status, kekId: k.kekId })), sealedByVersion, unsealed });
  }
  return out;
}

/** Remove retired data keys no stored value uses any more (crypto-shredding of what they sealed is then complete). */
export async function purgeRetiredKeys(db: Db, opts: { orgIds?: string[] } = {}): Promise<{ purged: number }> {
  let purged = 0;
  for (const st of await keyStatus(db, opts)) {
    for (const k of st.dataVersions) {
      if (k.status !== "retired" || (st.sealedByVersion[String(k.version)] ?? 0) > 0) continue;
      const r = await db.execute(sql`delete from org_data_keys where org_id = ${st.orgId} and purpose = 'data' and version = ${k.version} and status = 'retired'`);
      purged += r.rowCount ?? 0;
    }
  }
  return { purged };
}

export { sealedVersion };
