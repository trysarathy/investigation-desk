/**
 * rc7 uploads of real files: reusable column-mapping templates. A template belongs to a merchant (org_id) and, for a
 * provider's files, to the provider whose files it reads (provider_org_id = the merchant's provider, enforced by
 * trigger in drizzle/0017_mapping_templates_security.sql). Rows are immutable: a change is a new version.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const FILE_TYPES_SQL = sql.raw(`('provider_export','settlement_report','orders_invoices','bank_statement')`);

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
