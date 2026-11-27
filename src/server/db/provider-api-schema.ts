/**
 * v1 phase 2.2: the provider API adapter's tables (drizzle/0075_provider_api.sql; security in 0076; were 0057/0058). A connection
 * stores secret REFERENCES only (names of server secrets), never a key; a webhook event stores the body's SHA-256,
 * never the body.
 */
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";
import { merchantEntities } from "./merchant-schema";
import { mappingTemplates, uploads } from "./upload-schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const providerApiConnections = pgTable("provider_api_connections", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: uuid("id").notNull().defaultRandom().unique("provider_api_connections_id_uq"),
  entityId: text("entity_id").notNull(),
  providerOrgId: uuid("provider_org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  fileType: text("file_type").notNull(),
  templateName: text("template_name").notNull(),
  config: jsonb("config").notNull(),
  apiKeyRef: text("api_key_ref").notNull(),
  webhookSecretRef: text("webhook_secret_ref"),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  disabledBy: text("disabled_by").references(() => users.id),
  disabledAt: ts("disabled_at"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  uniqueIndex("provider_api_connections_name_uq").on(t.orgId, t.name),
  foreignKey({ name: "provider_api_connections_entity_fk", columns: [t.orgId, t.entityId], foreignColumns: [merchantEntities.orgId, merchantEntities.id] }),
  check("provider_api_connections_type_chk", sql`${t.fileType} in ('provider_export','settlement_report','settlement_payments')`),
  check("provider_api_connections_status_chk", sql`${t.status} in ('active','disabled')`),
]);

export const providerPulls = pgTable("provider_pulls", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(),
  entityId: text("entity_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull().default("running"),
  templateId: uuid("template_id").notNull(),
  templateVersion: integer("template_version").notNull(),
  startCursor: text("start_cursor"),
  nextCursor: text("next_cursor"),
  pages: integer("pages").notNull().default(0),
  records: integer("records").notNull().default(0),
  requests: integer("requests").notNull().default(0),
  retries: integer("retries").notNull().default(0),
  eventsConsumed: integer("events_consumed").notNull().default(0),
  uploadId: uuid("upload_id"),
  errorCode: text("error_code"),
  startedBy: text("started_by").notNull().references(() => users.id),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  uniqueIndex("provider_pulls_key_uq").on(t.orgId, t.idempotencyKey),
  index("provider_pulls_connection_idx").on(t.orgId, t.connectionId, t.startedAt),
  foreignKey({ name: "provider_pulls_connection_fk", columns: [t.orgId, t.connectionId], foreignColumns: [providerApiConnections.orgId, providerApiConnections.id] }),
  foreignKey({ name: "provider_pulls_template_fk", columns: [t.orgId, t.templateId], foreignColumns: [mappingTemplates.orgId, mappingTemplates.id] }),
  foreignKey({ name: "provider_pulls_upload_fk", columns: [t.orgId, t.uploadId], foreignColumns: [uploads.orgId, uploads.id] }),
  check("provider_pulls_status_chk", sql`${t.status} in ('running','succeeded','unchanged','failed')`),
]);

export const providerWebhookEvents = pgTable("provider_webhook_events", {
  orgId: uuid("org_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  eventId: text("event_id").notNull(),
  entityId: text("entity_id").notNull(),
  bodySha256: text("body_sha256").notNull(),
  signedAt: ts("signed_at").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
  pullId: uuid("pull_id"),
}, (t) => [
  primaryKey({ name: "provider_webhook_events_pk", columns: [t.orgId, t.connectionId, t.eventId] }),
  foreignKey({ name: "provider_webhook_events_connection_fk", columns: [t.orgId, t.connectionId], foreignColumns: [providerApiConnections.orgId, providerApiConnections.id] }),
  foreignKey({ name: "provider_webhook_events_pull_fk", columns: [t.orgId, t.pullId], foreignColumns: [providerPulls.orgId, providerPulls.id] }),
]);
