/**
 * rc7 uploads of real files: reusable column-mapping templates. A template belongs to a merchant (org_id) and, for a
 * provider's files, to the provider whose files it reads (provider_org_id = the merchant's provider, enforced by
 * trigger in drizzle/0017_mapping_templates_security.sql). Rows are immutable: a change is a new version.
 */
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";
import { merchantEntities } from "./merchant-schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const FILE_TYPES_SQL = sql.raw(`('provider_export','settlement_report','orders_invoices','bank_statement','ledger_invoices')`);

export const mappingTemplates = pgTable("mapping_templates", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: uuid("id").notNull().defaultRandom(),
  providerOrgId: uuid("provider_org_id").references(() => organizations.id),
  fileType: text("file_type").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
  /** sha256 of the normalised, sorted header list (normalisedHeaderList), for auto-apply. */
  headerSignature: text("header_signature").notNull(),
  mapping: jsonb("mapping").notNull(),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  uniqueIndex("mapping_templates_version_uq").on(t.orgId, t.fileType, t.name, t.version),
  index("mapping_templates_signature_idx").on(t.orgId, t.fileType, t.headerSignature),
  check("mapping_templates_type_chk", sql`${t.fileType} in ${FILE_TYPES_SQL}`),
  check("mapping_templates_provider_chk", sql`(${t.fileType} in ('provider_export','settlement_report')) = (${t.providerOrgId} is not null)`),
  check("mapping_templates_name_chk", sql`length(${t.name}) between 1 and 120`),
  check("mapping_templates_version_chk", sql`${t.version} >= 1`),
  check("mapping_templates_sig_chk", sql`${t.headerSignature} ~ '^[0-9a-f]{64}$'`),
]);

export const UPLOAD_STATUSES = ["stored", "mapped", "validated", "confirmed", "normalised", "rejected", "deleted"] as const;
export const UPLOAD_FORMATS = ["csv", "tsv", "xlsx", "json", "mt940", "camt053"] as const;
const inList = (xs: readonly string[]) => sql.raw(`(${xs.map((x) => `'${x}'`).join(",")})`);

/**
 * One uploaded file. The bytes live only in upload storage (src/server/storage), never in the database; this row
 * holds the sanitised name, size, hash, the random storage key, the mapping used and row counts. A bank statement is
 * confirmed by a second person (an Approver who did not upload it), enforced by trigger (drizzle/0019).
 */
export const uploads = pgTable("uploads", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: uuid("id").notNull().defaultRandom(),
  entityId: text("entity_id").notNull(),
  fileType: text("file_type").notNull(),
  fileFormat: text("file_format").notNull(),
  originalName: text("original_name").notNull(),
  byteSize: integer("byte_size").notNull(),
  contentSha256: text("content_sha256").notNull(),
  storageKey: text("storage_key"),
  encrypted: boolean("encrypted").notNull(),
  /** rc7 blind test: for a JSON file whose top-level object has several lists, the list the person chose (a file fact). */
  jsonList: text("json_list"),
  status: text("status").notNull().default("stored"),
  /** Why a file was refused (a stable code, never file content). */
  rejectionCode: text("rejection_code"),
  templateId: uuid("template_id"),
  templateVersion: integer("template_version"),
  /** The confirmed mapping (from a template or entered for this file). */
  mapping: jsonb("mapping"),
  /** Digest of the validation result (row number, status, row hash): what the confirmer reviewed. */
  rowsSha256: text("rows_sha256"),
  rowCount: integer("row_count").notNull().default(0),
  acceptedCount: integer("accepted_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  duplicateCount: integer("duplicate_count").notNull().default(0),
  /** File-level notes as codes (e.g. statement_not_balanced, total_rows_excluded). */
  notes: jsonb("notes").notNull().default([]),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id),
  confirmedBy: text("confirmed_by").references(() => users.id),
  confirmedAt: ts("confirmed_at"),
  decisionReason: text("decision_reason"),
  /** Rows created, existing, conflicting and skipped per target table, set once when the upload is normalised. */
  normalisedCounts: jsonb("normalised_counts"),
  normalisedAt: ts("normalised_at"),
  deleteAfter: ts("delete_after").notNull(),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  foreignKey({ columns: [t.orgId, t.entityId], foreignColumns: [merchantEntities.orgId, merchantEntities.id], name: "uploads_entity_fk" }),
  foreignKey({ columns: [t.orgId, t.templateId], foreignColumns: [mappingTemplates.orgId, mappingTemplates.id], name: "uploads_template_fk" }),
  uniqueIndex("uploads_content_uq").on(t.orgId, t.entityId, t.fileType, t.contentSha256).where(sql`${t.status} <> 'deleted'`),
  index("uploads_delete_after_idx").on(t.deleteAfter).where(sql`${t.status} <> 'deleted'`),
  check("uploads_type_chk", sql`${t.fileType} in ${FILE_TYPES_SQL}`),
  check("uploads_format_chk", sql`${t.fileFormat} in ${inList(UPLOAD_FORMATS)}`),
  check("uploads_status_chk", sql`${t.status} in ${inList(UPLOAD_STATUSES)}`),
  check("uploads_name_chk", sql`length(${t.originalName}) between 1 and 120`),
  check("uploads_size_chk", sql`${t.byteSize} > 0`),
  check("uploads_sha_chk", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
  check("uploads_key_chk", sql`${t.storageKey} is null or ${t.storageKey} ~ '^[0-9a-f]{32}$'`),
  check("uploads_json_list_chk", sql`${t.jsonList} is null or (${t.fileFormat} = 'json' and length(${t.jsonList}) between 1 and 200)`),
  check("uploads_confirmer_chk", sql`${t.confirmedBy} is null or ${t.fileType} <> 'bank_statement' or ${t.confirmedBy} <> ${t.uploadedBy}`),
]);

export const UPLOAD_ROW_STATUSES = ["accepted", "warning", "rejected", "duplicate"] as const;

/**
 * The validation report of an upload, one row per data row: status, reason codes and a hash of the normalised
 * values (for duplicates across uploads). No cell values. `target_ref` names the normalised row it became.
 */
export const uploadRows = pgTable("upload_rows", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  uploadId: uuid("upload_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  status: text("status").notNull(),
  reasonCodes: jsonb("reason_codes").notNull().default([]),
  rowHash: text("row_hash"),
  targetRef: text("target_ref"),
  /** rc7 normalise: created (a new row), existing (an identical row was already there), conflict, or skipped. */
  normaliseOutcome: text("normalise_outcome"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.uploadId, t.rowNumber] }),
  foreignKey({ columns: [t.orgId, t.uploadId], foreignColumns: [uploads.orgId, uploads.id], name: "upload_rows_upload_fk" }),
  index("upload_rows_hash_idx").on(t.orgId, t.rowHash),
  check("upload_rows_status_chk", sql`${t.status} in ${inList(UPLOAD_ROW_STATUSES)}`),
  check("upload_rows_outcome_chk", sql`${t.normaliseOutcome} is null or ${t.normaliseOutcome} in ('created','existing','conflict','skipped')`),
  check("upload_rows_hash_chk", sql`${t.rowHash} is null or ${t.rowHash} ~ '^[0-9a-f]{64}$'`),
]);

/** Per-merchant data settings. Retention of uploads: 90 days unless an Admin sets another period (founder decision 6). */
export const merchantDataSettings = pgTable("merchant_data_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id),
  retentionDays: integer("retention_days").notNull().default(90),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [check("merchant_data_settings_retention_chk", sql`${t.retentionDays} between 1 and 3650`)]);

/**
 * Which normalised rows each upload row became or confirmed (one row can feed an invoice, a quote, a provider record
 * and a claimed transfer). Retention deletes a normalised row only when no remaining upload refers to it.
 */
export const uploadRowTargets = pgTable("upload_row_targets", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  uploadId: uuid("upload_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  targetTable: text("target_table").notNull(),
  targetKey: text("target_key").notNull(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.uploadId, t.rowNumber, t.targetTable, t.targetKey] }),
  foreignKey({ columns: [t.orgId, t.uploadId, t.rowNumber], foreignColumns: [uploadRows.orgId, uploadRows.uploadId, uploadRows.rowNumber], name: "upload_row_targets_row_fk" }),
  index("upload_row_targets_target_idx").on(t.orgId, t.targetTable, t.targetKey),
  check("upload_row_targets_table_chk", sql`${t.targetTable} in ('invoices','merchant_quotes','payment_links','provider_payment_records','chain_transfers','settlement_batches','settlement_batch_lines','bank_lines','ledger_invoices')`),
]);
