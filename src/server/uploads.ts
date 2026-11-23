import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lte, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  IngestError, formatMinor, currencyPrecision, parseCamt053, parseMt940, preview as previewRows, readTabular, sniffFile,
  type BankParseResult, type ParsedTable,
} from "@/lib/clearline/ingest";
import { FILE_TYPES, applyMapping, validateMapping, type AppliedRow, type FileType, type Mapping, type MappedValue } from "@/lib/clearline/mapping";
import { dataLabel, type DataLabel } from "@/lib/clearline/data-mode";
import type { NetworkId, TokenConfig } from "@/lib/clearline/merchant/types";
import { stableJson } from "@/lib/clearline/merchant/adapters";
import type { Db, Tx } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { IdempotencyKey, canonical, idempotent, serverAudit } from "./control";
import { dataModeOf, suggestTemplate, type TemplateSuggestion } from "./mapping-templates";
import { AccessDenied, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";
import { StorageRefused, uploadStorage, type UploadStorage } from "./storage";
import { purgeDerivedRows } from "./upload-retention";

/**
 * rc7 uploads: a merchant's own files → storage → mapping → validation report → confirmation. The file's bytes live
 * only in upload storage (encrypted when CLEARLINE_UPLOAD_KEY is set) and are deleted on schedule (retention,
 * founder decision 6). The database holds the file's facts, the mapping and a validation report of reason codes and
 * hashes, never cell values; audit rows hold ids and counts only. Uploads go to live merchants only ("Your data").
 * Bank statements are confirmed by a second person (an Approver who did not upload them), enforced by trigger.
 */

export const PREVIEW_ROWS = 20;
export const DEFAULT_RETENTION_DAYS = 90;

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });
const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const UploadId = z.uuid();
export type UploadRow = typeof t.uploads.$inferSelect;
type Format = UploadRow["fileFormat"];

/** A display name only (never a path): last path segment, no control or reserved characters, at most 120 characters. */
export function sanitiseFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const clean = base.normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (!clean) return "upload";
  if (clean.length <= 120) return clean;
  const ext = /\.[A-Za-z0-9]{1,8}$/.exec(clean)?.[0] ?? "";
  return clean.slice(0, 120 - ext.length) + ext;
}

const refuse = (e: unknown): never => {
  if (e instanceof IngestError) throw new RequestRefused(422, `FILE_${e.code.toUpperCase()}`, e.message);
  throw e;
};

type Parsed = { format: "csv" | "tsv" | "xlsx" | "json"; table: ParsedTable } | { format: "mt940" | "camt053"; statement: BankParseResult };

/** Read a file with the rc7 ingest parsers (size, row and cell limits included). Statements are only bank statements. */
export async function parseUpload(bytes: Uint8Array, fileType: FileType, fileName?: string): Promise<Parsed> {
  try {
    const kind = sniffFile(bytes, fileName).kind;
    if (kind === "mt940" || kind === "camt053") {
      if (fileType !== "bank_statement") throw new RequestRefused(422, "FILE_NOT_A_TABLE", "This is a bank statement; upload it as a bank statement.");
      return { format: kind, statement: kind === "mt940" ? parseMt940(bytes) : parseCamt053(bytes) };
    }
    const table = await readTabular(bytes, { fileName });
    return { format: table.kind, table };
  } catch (e) { return refuse(e); }
}

async function tokensOf(tx: Tx): Promise<TokenConfig[]> {
  return (await tx.select().from(t.tokenConfig)).map((k) => ({ network: (k.network === "arbitrum-one" ? "arbitrum_one" : k.network) as NetworkId, contract: k.contract, symbol: k.symbol, decimals: k.decimals }));
}

export interface AnalysedRow extends AppliedRow { rowHash: string | null }
export interface Analysis { rows: AnalysedRow[]; notes: string[] }

/** A row's identity for duplicates: its normalised values plus its occurrence among identical rows of the same file. */
function hashRows(fileType: FileType, rows: AppliedRow[]): AnalysedRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.status === "rejected") return { ...r, rowHash: null };
    const body = stableJson({ fileType, values: r.values });
    const n = seen.get(body) ?? 0;
    seen.set(body, n + 1);
    return { ...r, rowHash: sha256(`${body}#${n}`) };
  });
}

/**
 * The validation of an upload: statements are read by the bank parsers (no mapping), tables through the confirmed
 * mapping. Deterministic: the same file and mapping always give the same rows and hashes.
 */
export async function analyseUpload(tx: Tx, u: Pick<UploadRow, "fileType" | "fileFormat" | "mapping" | "originalName">, bytes: Uint8Array): Promise<Analysis> {
  const fileType = u.fileType as FileType;
  const parsed = await parseUpload(bytes, fileType, u.originalName);
  const notes: string[] = [];
  if ("statement" in parsed) {
    const s = parsed.statement;
    if (s.statements.some((x) => x.balanced === false)) notes.push("statement_not_balanced");
    if (s.skipped.length) notes.push("statement_entries_skipped");
    const rows: AppliedRow[] = s.lines.map((l) => {
      const values: Record<string, MappedValue> = { bank_account: l.account, value_date: l.valueDate, amount: l.amountMinor, currency: l.currency, direction: l.direction, reference: l.reference };
      for (const [k, v] of [["booking_date", l.bookingDate], ["counterparty", l.counterparty], ["bank_reference", l.bankReference], ["description", l.narrative]] as const) if (v) values[k] = v;
      const warnings = l.amountMinor === 0n ? [{ field: "amount", code: "zero_amount" }] : [];
      return { rowNumber: l.sourceRow, status: warnings.length ? "warning" : "accepted", values, errors: [], warnings };
    });
    return { rows: hashRows(fileType, rows), notes };
  }
  if (!u.mapping) throw new RequestRefused(409, "NOT_MAPPED", "Map the file's columns first.");
  const applied = applyMapping(parsed.table, u.mapping, { tokens: await tokensOf(tx) });
  if (!applied.ok) throw new RequestRefused(422, "MAPPING_INVALID", applied.issues.map((i) => i.message).join(" "));
  if (parsed.table.excludedRows.length) notes.push("total_rows_excluded");
  if (parsed.table.blankRowsSkipped) notes.push("blank_rows_skipped");
  for (const c of applied.columnIssues) notes.push(`column:${c.field}:${c.code}`);
  return { rows: hashRows(fileType, applied.rows), notes };
}

export const rowsDigest = (rows: { rowNumber: number; status: string; rowHash: string | null; reasonCodes: unknown }[]) =>
  sha256(canonical(rows.map((r) => [r.rowNumber, r.status, r.rowHash, r.reasonCodes])));

async function retentionDays(tx: Tx, orgId: string): Promise<number> {
  const [s] = await tx.select({ d: t.merchantDataSettings.retentionDays }).from(t.merchantDataSettings).where(eq(t.merchantDataSettings.orgId, orgId));
  return s?.d ?? DEFAULT_RETENTION_DAYS;
}

export async function loadUpload(tx: Tx, ctx: TenantContext, id: string, lock = false): Promise<UploadRow> {
  if (!UploadId.safeParse(id).success) throw new AccessDenied(404, "Not found.");
  const q = tx.select().from(t.uploads).where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.id, id)));
  const [u] = lock ? await q.for("update") : await q;
  if (!u || u.status === "deleted") throw new AccessDenied(404, "Not found.");
  return u;
}

export interface UploadSummary {
  id: string; entityId: string; fileType: FileType; fileFormat: Format; originalName: string; byteSize: number; contentSha256: string; encrypted: boolean;
  status: string; templateId: string | null; templateVersion: number | null; mapping: Mapping | null; rowsSha256: string | null;
  counts: { rows: number; accepted: number; rejected: number; warning: number; duplicate: number }; notes: string[];
  uploadedBy: string; confirmedBy: string | null; deleteAfter: string; createdAt: string;
}
export const summary = (u: UploadRow): UploadSummary => ({
  id: u.id, entityId: u.entityId, fileType: u.fileType as FileType, fileFormat: u.fileFormat, originalName: u.originalName, byteSize: u.byteSize, contentSha256: u.contentSha256,
  encrypted: u.encrypted, status: u.status, templateId: u.templateId, templateVersion: u.templateVersion, mapping: (u.mapping as Mapping | null) ?? null, rowsSha256: u.rowsSha256,
  counts: { rows: u.rowCount, accepted: u.acceptedCount, rejected: u.rejectedCount, warning: u.warningCount, duplicate: u.duplicateCount }, notes: u.notes as string[],
  uploadedBy: u.uploadedBy, confirmedBy: u.confirmedBy, deleteAfter: u.deleteAfter.toISOString(), createdAt: u.createdAt.toISOString(),
});
const counts = (u: UploadSummary) => ({ ...u.counts });

export interface Preview {
  headers: string[]; rows: string[][]; totalRows: number; excludedRows: number; sheet?: string; sheets?: string[]; warnings: string[];
  /** What the reader detected, for the person to check (CSV/TSV: encoding, byte-order mark, delimiter; tables: the header row). */
  encoding?: string; bom?: boolean; delimiter?: string; headerRow?: number;
}

/** First rows of a parsed file, for the person who maps it (served to them, never logged or stored). */
function previewOf(p: Parsed, n = PREVIEW_ROWS): Preview {
  if ("table" in p) {
    const v = previewRows(p.table, n);
    return { headers: v.headers, rows: v.rows.map((r) => r.cells), totalRows: p.table.rows.length, excludedRows: p.table.excludedRows.length, sheet: p.table.sheet, sheets: p.table.sheets, warnings: p.table.warnings.map((w) => w.code),
      encoding: p.table.encoding, bom: p.table.bom, delimiter: p.table.delimiter, headerRow: p.table.headerRowNumber };
  }
  const lines = p.statement.lines;
  const amount = (minor: bigint, cur: string) => { const pr = currencyPrecision(cur); return pr.ok ? formatMinor(minor, pr.value) : minor.toString(); };
  return {
    headers: ["Account", "Value date", "Direction", "Amount", "Currency", "Reference", "Counterparty"],
    rows: lines.slice(0, n).map((l) => [l.account, l.valueDate, l.direction, amount(l.amountMinor, l.currency), l.currency, l.reference, l.counterparty ?? ""]),
    totalRows: lines.length, excludedRows: 0, warnings: p.statement.warnings.map((w) => w.code),
  };
}

export const CreateUpload = z.object({ entityId: z.string().min(1).max(64), fileType: z.enum(FILE_TYPES), fileName: z.string().min(1).max(1000) }).strict();

export interface UploadResult { upload: UploadSummary; label: DataLabel; preview: Preview; suggestion: TemplateSuggestion | null }

/**
 * Store a merchant's file. Refused before anything is stored: a sample organisation, an unknown entity, an
 * unreadable or oversized file (with the parser's plain-English reason), or the same file already uploaded for this
 * entity and file type. Returns the preview (first 20 rows) and the template / header suggestions to confirm.
 */
export async function createUpload(ctx: TenantContext, input: z.input<typeof CreateUpload> & { bytes: Uint8Array }, idempotencyKey: string, storage: UploadStorage = uploadStorage()): Promise<UploadResult & { status: number; replayed: boolean }> {
  require(ctx, "merchant_upload");
  const key = IdempotencyKey.parse(idempotencyKey);
  const v = CreateUpload.parse({ entityId: input.entityId, fileType: input.fileType, fileName: input.fileName });
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array)) throw new RequestRefused(400, "INVALID_FILE", "The upload is not a file.");
  const originalName = sanitiseFileName(v.fileName);
  const contentSha256 = sha256(bytes);
  const parsed = await parseUpload(bytes, v.fileType, originalName).catch(async (e) => {
    await tenantTx(ctx, (tx) => serverAudit(tx, ctx, "upload_refused", "upload", null, `Upload refused before storing (${e instanceof RequestRefused ? e.code : "error"})`,
      { code: e instanceof RequestRefused ? e.code : "error", byteSize: bytes.byteLength, fileType: v.fileType, entityId: v.entityId }));
    throw e;
  });
  const fileFormat = parsed.format;
  const r = await tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "upload_create", ...v, contentSha256 }, async () => {
    if ((await dataModeOf(tx, ctx.orgId)).dataMode !== "live") throw new RequestRefused(409, "SAMPLE_ORGANISATION", "This organisation holds sample data (Test mode · illustrative data); upload your files to your live organisation.");
    const [ent] = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, v.entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.orgId}|upload|${contentSha256}`}))`);
    const [dup] = await tx.select({ id: t.uploads.id, status: t.uploads.status }).from(t.uploads).where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.entityId, v.entityId),
      eq(t.uploads.fileType, v.fileType), eq(t.uploads.contentSha256, contentSha256), ne(t.uploads.status, "deleted")));
    if (dup) {
      await serverAudit(tx, ctx, "upload_duplicate", "upload", dup.id, "Duplicate upload refused (same file, entity and file type)", { existingUploadId: dup.id, contentSha256 });
      throw new RequestRefused(409, "DUPLICATE_UPLOAD", `This file was already uploaded for ${v.entityId} as a ${v.fileType.replace("_", " ")} (upload ${dup.id}, ${dup.status}). Nothing was stored again.`);
    }
    const days = await retentionDays(tx, ctx.orgId);
    const stored = await storage.put(ctx.orgId, bytes).catch((e) => {
      if (e instanceof StorageRefused) throw new RequestRefused(409, "STORAGE_REFUSED", e.message);
      throw e;
    });
    const [u] = await tx.insert(t.uploads).values({
      orgId: ctx.orgId, entityId: v.entityId, fileType: v.fileType, fileFormat, originalName, byteSize: bytes.byteLength, contentSha256,
      storageKey: stored.storageKey, encrypted: stored.encrypted, status: "stored", uploadedBy: ctx.userId, deleteAfter: new Date(Date.now() + days * 86_400_000),
    }).returning().catch(async (e) => { await storage.delete(ctx.orgId, stored.storageKey); throw e; });
    await serverAudit(tx, ctx, "upload_stored", "upload", u.id, `File stored for ${v.entityId} (${v.fileType}, ${fileFormat}, ${bytes.byteLength} bytes${stored.encrypted ? ", encrypted" : ""}); deleted after ${days} days`,
      { uploadId: u.id, entityId: v.entityId, fileType: v.fileType, fileFormat, byteSize: bytes.byteLength, encrypted: stored.encrypted, retentionDays: days });
    return { status: 201, body: summary(u) };
  }));
  const suggestion = "table" in parsed ? await suggestTemplate(ctx, { fileType: v.fileType, headers: parsed.table.headers }) : null;
  return { status: r.status, replayed: r.replayed, upload: r.body, label: dataLabel("live"), preview: previewOf(parsed), suggestion };
}

/** One upload's status and counts (no file contents). */
export async function getUpload(ctx: TenantContext, id: string) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => ({ label: (await dataModeOf(tx, ctx.orgId)).label, upload: summary(await loadUpload(tx, ctx, id)) }));
}

export async function listUploads(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => ({
    label: (await dataModeOf(tx, ctx.orgId)).label,
    uploads: (await tx.select().from(t.uploads).where(and(eq(t.uploads.orgId, ctx.orgId), ne(t.uploads.status, "deleted"))).orderBy(asc(t.uploads.createdAt))).map(summary),
  }));
}

/** The first 20 rows of the stored file and the mapping suggestions: for the merchant's own members only. */
export async function uploadPreview(ctx: TenantContext, id: string, storage: UploadStorage = uploadStorage()) {
  require(ctx, "read");
  const u = await tenantRead(ctx, (tx) => loadUpload(tx, ctx, id));
  const parsed = await parseUpload(await storage.get(ctx.orgId, u.storageKey!), u.fileType as FileType, u.originalName);
  const suggestion = "table" in parsed ? await suggestTemplate(ctx, { fileType: u.fileType as FileType, headers: parsed.table.headers }) : null;
  return { label: dataLabel("live"), upload: summary(u), preview: previewOf(parsed), suggestion };
}

export const SetMapping = z.union([
  z.object({ templateId: z.uuid() }).strict(),
  z.object({ mapping: z.unknown() }).strict(),
]);

/** Confirm the column mapping for a table upload: a template (its current version) or a mapping entered for this file. */
export async function setUploadMapping(ctx: TenantContext, id: string, input: z.input<typeof SetMapping>, idempotencyKey: string, storage: UploadStorage = uploadStorage()) {
  require(ctx, "merchant_upload");
  const key = IdempotencyKey.parse(idempotencyKey);
  const v = SetMapping.parse(input);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "upload_map", id, ...v }, async () => {
    const u = await loadUpload(tx, ctx, id, true);
    if (!["stored", "mapped", "validated"].includes(u.status)) throw new RequestRefused(409, "UPLOAD_DECIDED", `This upload is ${u.status}; its mapping cannot change.`);
    if (u.fileFormat === "mt940" || u.fileFormat === "camt053") throw new RequestRefused(409, "NO_MAPPING_NEEDED", "MT940 and camt.053 statements need no column mapping; validate the upload.");
    let mapping: unknown, templateId: string | null = null, templateVersion: number | null = null;
    if ("templateId" in v) {
      const [tpl] = await tx.select().from(t.mappingTemplates).where(and(eq(t.mappingTemplates.orgId, ctx.orgId), eq(t.mappingTemplates.id, v.templateId)));
      const ok = tpl && (await tx.execute(sql`select mapping_template_usable(${ctx.orgId}, ${tpl.id}) as ok`)).rows[0]?.ok === true;
      if (!tpl || !ok) throw new AccessDenied(404, "Not found.");
      ({ mapping } = tpl); templateId = tpl.id; templateVersion = tpl.version;
    } else mapping = v.mapping;
    const parsed = await parseUpload(await storage.get(ctx.orgId, u.storageKey!), u.fileType as FileType, u.originalName);
    if (!("table" in parsed)) throw new RequestRefused(409, "NO_MAPPING_NEEDED", "This statement needs no column mapping.");
    const check = validateMapping(mapping, parsed.table.headers);
    if (!check.ok) throw new RequestRefused(422, "MAPPING_INVALID", check.issues.map((i) => i.message).join(" "));
    if (check.mapping.fileType !== u.fileType) throw new RequestRefused(422, "MAPPING_INVALID", "The mapping is for another file type.");
    if (u.status === "validated" || u.status === "mapped") await tx.delete(t.uploadRows).where(and(eq(t.uploadRows.orgId, ctx.orgId), eq(t.uploadRows.uploadId, id)));
    const [row] = await tx.update(t.uploads).set({ status: "mapped", mapping: check.mapping, templateId, templateVersion, rowsSha256: null, rowCount: 0, acceptedCount: 0, rejectedCount: 0, warningCount: 0, duplicateCount: 0, notes: [] })
      .where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.id, id))).returning();
    await serverAudit(tx, ctx, "upload_mapped", "upload", id, `Upload mapped (${Object.keys(check.mapping.columns).length} fields${templateId ? `, template version ${templateVersion}` : ""})`, { uploadId: id, templateId, templateVersion, fields: Object.keys(check.mapping.columns).length });
    return { status: 200, body: summary(row) };
  }));
}

/**
 * Validate an upload: every row accepted, accepted with warnings, rejected (reason codes per field) or a duplicate of
 * a row already in another upload of the same entity and file type (it is never imported twice). Writes the report.
 */
export async function validateUpload(ctx: TenantContext, id: string, idempotencyKey: string, storage: UploadStorage = uploadStorage()) {
  require(ctx, "merchant_upload");
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "upload_validate", id }, async () => {
    const u = await loadUpload(tx, ctx, id, true);
    if (!["stored", "mapped", "validated"].includes(u.status)) throw new RequestRefused(409, "UPLOAD_DECIDED", `This upload is ${u.status}.`);
    if (u.status === "stored" && u.fileFormat !== "mt940" && u.fileFormat !== "camt053") throw new RequestRefused(409, "NOT_MAPPED", "Map the file's columns first.");
    const analysis = await analyseUpload(tx, u, await storage.get(ctx.orgId, u.storageKey!));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.orgId}|upload-rows|${u.entityId}|${u.fileType}`}))`);
    const hashes = [...new Set(analysis.rows.map((r) => r.rowHash).filter((h): h is string => h !== null))];
    const known = new Set<string>();
    for (let i = 0; i < hashes.length; i += 1000) {
      const found = await tx.select({ h: t.uploadRows.rowHash }).from(t.uploadRows)
        .innerJoin(t.uploads, and(eq(t.uploads.orgId, t.uploadRows.orgId), eq(t.uploads.id, t.uploadRows.uploadId)))
        .where(and(eq(t.uploadRows.orgId, ctx.orgId), inArray(t.uploadRows.rowHash, hashes.slice(i, i + 1000)), ne(t.uploads.id, id), eq(t.uploads.entityId, u.entityId),
          eq(t.uploads.fileType, u.fileType), notInArray(t.uploads.status, ["deleted", "rejected"]), inArray(t.uploadRows.status, ["accepted", "warning", "duplicate"])));
      for (const f of found) if (f.h) known.add(f.h);
    }
    const rows = analysis.rows.map((r) => ({
      rowNumber: r.rowNumber, rowHash: r.rowHash, status: r.rowHash && known.has(r.rowHash) ? "duplicate" : r.status,
      reasonCodes: [...r.errors.map((e) => ({ ...e, level: "error" })), ...r.warnings.map((w) => ({ ...w, level: "warning" }))],
    }));
    if (u.status === "validated") await tx.update(t.uploads).set({ status: "mapped" }).where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.id, id)));
    await tx.delete(t.uploadRows).where(and(eq(t.uploadRows.orgId, ctx.orgId), eq(t.uploadRows.uploadId, id)));
    for (let i = 0; i < rows.length; i += 1000) await tx.insert(t.uploadRows).values(rows.slice(i, i + 1000).map((r) => ({ orgId: ctx.orgId, uploadId: id, ...r })));
    const n = (s: string) => rows.filter((r) => r.status === s).length;
    const [row] = await tx.update(t.uploads).set({
      status: "validated", rowsSha256: rowsDigest(rows), rowCount: rows.length, acceptedCount: n("accepted"), rejectedCount: n("rejected"), warningCount: n("warning"), duplicateCount: n("duplicate"), notes: analysis.notes,
    }).where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.id, id))).returning();
    const s = summary(row);
    await serverAudit(tx, ctx, "upload_validated", "upload", id, `Upload validated: ${s.counts.rows} rows, ${s.counts.accepted} accepted, ${s.counts.warning} with warnings, ${s.counts.rejected} rejected, ${s.counts.duplicate} duplicates`, { uploadId: id, ...counts(s), notes: analysis.notes });
    return { status: 200, body: s };
  }));
}

export const ReportQuery = z.object({ page: z.number().int().min(1).max(100_000).default(1), pageSize: z.number().int().min(1).max(500).default(100), status: z.enum(["accepted", "warning", "rejected", "duplicate"]).optional() }).strict();

/** The validation report: counts and notes, and one page of rows with their reason codes (no cell values). */
export async function validationReport(ctx: TenantContext, id: string, query: z.input<typeof ReportQuery> = {}) {
  require(ctx, "read");
  const q = ReportQuery.parse(query);
  return tenantRead(ctx, async (tx) => {
    const u = await loadUpload(tx, ctx, id);
    const where = and(eq(t.uploadRows.orgId, ctx.orgId), eq(t.uploadRows.uploadId, id), ...(q.status ? [eq(t.uploadRows.status, q.status)] : []));
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(t.uploadRows).where(where);
    const rows = await tx.select({ rowNumber: t.uploadRows.rowNumber, status: t.uploadRows.status, reasonCodes: t.uploadRows.reasonCodes, targetRef: t.uploadRows.targetRef })
      .from(t.uploadRows).where(where).orderBy(asc(t.uploadRows.rowNumber)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return { label: dataLabel("live"), upload: summary(u), page: q.page, pageSize: q.pageSize, total, rows };
  });
}

export const UploadDecision = z.object({
  decision: z.enum(["confirm", "decline"]), reason: z.string().trim().min(3).max(1000),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/), rowsSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

/**
 * Confirm (or decline) a validated upload; the decision binds the file hash and the validation report the person
 * reviewed. A bank statement needs a second person: an Approver who did not upload it (also enforced by trigger).
 */
export async function decideUpload(ctx: TenantContext, id: string, input: z.input<typeof UploadDecision>, idempotencyKey: string) {
  const key = IdempotencyKey.parse(idempotencyKey);
  const d = UploadDecision.parse(input);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "upload_decide", id, ...d }, async () => {
    const u = await loadUpload(tx, ctx, id, true);
    const bank = u.fileType === "bank_statement";
    require(ctx, bank ? "confirm_import" : "merchant_upload");
    if (bank && u.uploadedBy === ctx.userId) throw new RequestRefused(409, "MAKER_CANNOT_CONFIRM", "You uploaded this bank statement; another approver must confirm it.");
    if (u.status !== "validated") throw new RequestRefused(409, "UPLOAD_NOT_VALIDATED", `This upload is ${u.status}; only a validated upload can be decided.`);
    if (u.contentSha256 !== d.contentSha256 || u.rowsSha256 !== d.rowsSha256) throw new RequestRefused(409, "VERSION_MISMATCH", "The file or validation report you reviewed does not match this upload.");
    if (d.decision === "confirm" && u.acceptedCount + u.warningCount === 0) throw new RequestRefused(409, "NOTHING_TO_CONFIRM", "No row of this upload was accepted.");
    const [row] = await tx.update(t.uploads).set({ status: d.decision === "confirm" ? "confirmed" : "rejected", confirmedBy: ctx.userId, confirmedAt: new Date(), decisionReason: d.reason })
      .where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.id, id))).returning();
    await serverAudit(tx, ctx, d.decision === "confirm" ? "upload_confirmed" : "upload_declined", "upload", id,
      `Upload ${d.decision === "confirm" ? "confirmed" : "declined"}${bank ? " by a second person" : ""}: ${row.acceptedCount + row.warningCount} row(s) ${d.decision === "confirm" ? "to import" : "not imported"}`,
      { uploadId: id, uploadedBy: u.uploadedBy, decidedBy: ctx.userId, ...counts(summary(row)) });
    return { status: 200, body: summary(row) };
  }));
}

/** Delete an upload that is not confirmed: the file, its validation rows; the row stays as 'deleted' for audit. */
export async function deleteUpload(ctx: TenantContext, id: string, idempotencyKey: string, storage: UploadStorage = uploadStorage()) {
  require(ctx, "merchant_upload");
  const key = IdempotencyKey.parse(idempotencyKey);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "upload_delete", id }, async () => {
    const u = await loadUpload(tx, ctx, id, true);
    if (u.status === "confirmed" || u.status === "normalised") throw new RequestRefused(409, "UPLOAD_CONFIRMED", "Confirmed data is deleted on the retention schedule.");
    if (u.storageKey) await storage.delete(ctx.orgId, u.storageKey);
    const gone = await tx.delete(t.uploadRows).where(and(eq(t.uploadRows.orgId, ctx.orgId), eq(t.uploadRows.uploadId, id))).returning({ n: t.uploadRows.rowNumber });
    await tx.update(t.uploads).set({ status: "deleted", storageKey: null, deletedAt: new Date() }).where(and(eq(t.uploads.orgId, ctx.orgId), eq(t.uploads.id, id)));
    await serverAudit(tx, ctx, "upload_deleted", "upload", id, `Upload deleted: file removed, ${gone.length} validation row(s) removed`, { uploadId: id, rowsRemoved: gone.length });
    return { status: 200, body: { id, status: "deleted" } };
  }));
}

/** Admin: how long this merchant's uploads (and the data derived only from them) are kept. Applies to new uploads. */
export async function setRetentionDays(ctx: TenantContext, days: number, idempotencyKey: string) {
  require(ctx, "manage_retention");
  const key = IdempotencyKey.parse(idempotencyKey);
  const v = z.number().int().min(1).max(3650).parse(days);
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "retention_set", days: v }, async () => {
    await tx.insert(t.merchantDataSettings).values({ orgId: ctx.orgId, retentionDays: v, updatedBy: ctx.userId })
      .onConflictDoUpdate({ target: t.merchantDataSettings.orgId, set: { retentionDays: v, updatedBy: ctx.userId, updatedAt: new Date() } });
    await serverAudit(tx, ctx, "retention_set", "organization", ctx.orgId, `Upload retention set to ${v} days (new uploads)`, { retentionDays: v });
    return { status: 200, body: { retentionDays: v } };
  }));
}

/** Data derived from an upload, removed by retention (src/server/upload-retention.ts). */
export type DerivedPurge = (tx: Db | Tx, u: UploadRow) => Promise<Record<string, number>>;

/**
 * Retention (founder decision 6): for every upload past its delete_after, remove the stored file, its validation rows
 * and the data derived only from it, and mark it deleted. Runs with the schema OWNER connection (a scheduled job,
 * like the admin CLI), across organisations. Audit rows record counts only.
 */
export async function purgeExpiredUploads(db: Db, now: Date, opts: { storage?: UploadStorage; derived?: DerivedPurge } = {}) {
  const storage = opts.storage ?? uploadStorage();
  const derived = opts.derived ?? purgeDerivedRows;
  const due = await db.select().from(t.uploads).where(and(ne(t.uploads.status, "deleted"), lte(t.uploads.deleteAfter, now))).orderBy(asc(t.uploads.deleteAfter));
  const total = { uploads: 0, files: 0, rows: 0 } as Record<string, number>;
  for (const u of due) {
    const file = u.storageKey ? await storage.delete(u.orgId, u.storageKey) : false;
    await db.transaction(async (tx) => {
      const removed = await derived(tx, u);
      const rows = await tx.delete(t.uploadRows).where(and(eq(t.uploadRows.orgId, u.orgId), eq(t.uploadRows.uploadId, u.id))).returning({ n: t.uploadRows.rowNumber });
      await tx.update(t.uploads).set({ status: "deleted", storageKey: null, deletedAt: now }).where(and(eq(t.uploads.orgId, u.orgId), eq(t.uploads.id, u.id)));
      const details = { uploadId: u.id, fileRemoved: file, validationRows: rows.length, ...removed };
      await tx.insert(t.auditEvents).values({ orgId: u.orgId, source: "server", action: "upload_purged", entityType: "upload", entityId: u.id, at: now, details,
        summary: `Retention: upload deleted (file ${file ? "removed" : "already absent"}, ${rows.length} validation row(s)${Object.entries(removed).map(([k, n]) => `, ${n} ${k}`).join("")})` });
      total.uploads++; total.files += file ? 1 : 0; total.rows += rows.length;
      for (const [k, n] of Object.entries(removed)) total[k] = (total[k] ?? 0) + n;
    });
  }
  return total;
}
