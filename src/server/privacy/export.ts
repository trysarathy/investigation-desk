import "server-only";
import { createHash, type KeyObject } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as t from "../db/schema";
import { uploadStorage, type UploadStorage } from "../storage";
import { orgScopedTables } from "../merchant-deletion";
import { seal, tar, type ExportSignature, type TarEntry } from "./archive";

/**
 * v1 phase 5.6: export everything Clearline holds for ONE merchant (owner-only:
 * `npm run control:admin -- export-merchant <org-slug> --out <file>`), as a signed, encrypted archive
 * (src/server/privacy/archive.ts):
 *  - tables/<table>.jsonl — every row of every table with an org_id or merchant_org_id column equal to the merchant
 *    (read from information_schema, so a table added later is exported without a code change; partitions through
 *    their parent), the audit log, approvals and the minimal personal data of the merchant's own records included;
 *  - people/users.jsonl — the profile of each person who is or was a member (id, name, e-mail, verified, created,
 *    last sign-in, whether a second factor is on);
 *  - files/<upload id> — every uploaded file still in storage, decrypted (its name, type and digest are in the
 *    uploads table and the manifest);
 *  - manifest.json — counts and SHA-256 of every part, and what is deliberately left out (EXCLUDED).
 * Secrets are never exported: password hashes, authenticator secrets and recovery codes, session tokens, invitation
 * and e-mail token digests. The export is recorded in the merchant's audit log with counts only.
 */

export const EXPORT_FORMAT = "clearline-merchant-export/1";
/** Columns never exported (credentials or their digests). */
// upload_blobs.body: the sealed file (CLEARLINE_UPLOAD_STORE=postgres); the file itself is exported under files/
const REDACTED: Record<string, string[]> = { org_invitations: ["token_sha256"], upload_blobs: ["body"] };
export const EXCLUDED = [
  "password hashes and sign-in accounts (accounts)",
  "authenticator secrets and recovery codes (two_factors), passkey public keys (passkeys)",
  "session tokens and sign-in history (sessions); e-mail verification and reset tokens (auth_tokens, verifications)",
  "invitation token digests (org_invitations.token_sha256)",
  "sign-in failure and rate-limit counters (login_failures, auth_rate_events: keyed digests, kept at most a day)",
  "copies of e-mails in the local stand-in outbox (email_outbox)",
  "other organisations' records (a provider's own audit log and settings), Clearline's reference data (networks, tokens, roles)",
];

export interface ExportSummary { tables: Record<string, number>; people: number; files: number; missingFiles: number; bytes: number; archiveSha256: string }

async function merchant(db: Db, slug: string) {
  const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, slug));
  if (!org) throw new Error("No organisation has that slug.");
  if (org.kind !== "merchant") throw new Error("Only a merchant organisation can be exported with this command.");
  return org;
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const jsonl = (rows: unknown[]) => new TextEncoder().encode(rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));

/** The plain archive entries (manifest first) and the counts. Reads only. */
export async function collectMerchantExport(db: Db, slug: string, opts: { storage?: UploadStorage; now?: Date } = {}) {
  const org = await merchant(db, slug);
  const now = opts.now ?? new Date();
  const storage = opts.storage ?? uploadStorage({ owner: db });
  const entries: TarEntry[] = [];
  const manifestTables: Record<string, { rows: number; sha256: string }> = {};
  const byTable = new Map<string, unknown[]>();
  for (const x of await orgScopedTables(db)) {
    const rows = (await db.execute(sql`select row_to_json(r) as j from ${sql.identifier(x.table)} r where ${sql.identifier(x.column)} = ${org.id} order by r::text`)).rows
      .map((r) => { const j = r.j as Record<string, unknown>; for (const c of REDACTED[x.table] ?? []) delete j[c]; return j; });
    byTable.set(x.table, [...(byTable.get(x.table) ?? []), ...rows]);
  }
  byTable.set("organizations", [org]);
  for (const [table, rows] of [...byTable].sort(([a], [b]) => a.localeCompare(b))) {
    if (!rows.length) continue;
    const data = jsonl(rows);
    entries.push({ name: `tables/${table}.jsonl`, data });
    manifestTables[table] = { rows: rows.length, sha256: sha(data) };
  }
  const people = (await db.execute(sql`select row_to_json(p) as j from (select u.id, u.name, u.email, u.email_verified, u.created_at, u.last_sign_in_at, u.two_factor_enabled
    from users u where exists (select 1 from organization_memberships m where m.user_id = u.id and m.org_id = ${org.id}) order by u.id) p`)).rows.map((r) => r.j);
  const peopleData = jsonl(people);
  entries.push({ name: "people/users.jsonl", data: peopleData });
  const files: { path: string; uploadId: string; bytes: number; sha256: string }[] = [];
  const missing: string[] = [];
  for (const u of await db.select({ id: t.uploads.id, key: t.uploads.storageKey }).from(t.uploads).where(and(eq(t.uploads.orgId, org.id), isNotNull(t.uploads.storageKey))).orderBy(t.uploads.id)) {
    let data: Uint8Array;
    try { data = await storage.get(org.id, u.key!); } catch { missing.push(u.id); continue; }
    const name = `files/${u.id}`;
    entries.push({ name, data });
    files.push({ path: name, uploadId: u.id, bytes: data.byteLength, sha256: sha(data) });
  }
  const manifest = {
    format: EXPORT_FORMAT, exportedAt: now.toISOString(), organisation: { id: org.id, slug: org.slug, name: org.name },
    tables: manifestTables, people: { rows: people.length, sha256: sha(peopleData) }, files, missingFiles: missing, excluded: EXCLUDED,
    notes: [
      "Every table file is JSON Lines: one row per line, column names as in the database.",
      "Uploaded files are as they were uploaded; their names and types are in tables/uploads.jsonl (match on the upload id).",
      "Imported bank statements are 'imported, not bank-authenticated'.",
    ],
  };
  entries.unshift({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return { org, entries, summary: { tables: Object.fromEntries(Object.entries(manifestTables).map(([k, v]) => [k, v.rows])), people: people.length, files: files.length, missingFiles: missing.length } };
}

/** Build, encrypt and sign the export; record it in the merchant's audit log (counts only). */
export async function exportMerchant(db: Db, slug: string, o: { passphrase: string; signingKey: KeyObject; storage?: UploadStorage; now?: Date }): Promise<{ archive: Buffer; signature: ExportSignature; summary: ExportSummary }> {
  const now = o.now ?? new Date();
  const c = await collectMerchantExport(db, slug, { storage: o.storage, now });
  const { archive, signature } = seal(tar(c.entries, Math.floor(now.getTime() / 1000)), { passphrase: o.passphrase, signingKey: o.signingKey, now });
  const summary: ExportSummary = { ...c.summary, bytes: archive.length, archiveSha256: signature.archiveSha256 };
  await db.insert(t.auditEvents).values({ orgId: c.org.id, source: "server", action: "merchant_exported", entityType: "organization", entityId: c.org.id, at: now,
    summary: `Data export made (${Object.keys(summary.tables).length} tables, ${summary.files} files)`,
    details: { tables: Object.keys(summary.tables).length, rows: Object.values(summary.tables).reduce((a, b) => a + b, 0), people: summary.people, files: summary.files, missingFiles: summary.missingFiles, bytes: summary.bytes } });
  return { archive, signature, summary };
}
