/**
 * Clearline Control — PostgreSQL 16 schema (Drizzle). Migrations in `drizzle/` are generated from this file plus
 * one hand-written SQL migration for roles, row-level security, append-only triggers and grants.
 *
 * Tenancy: every tenant table has `org_id` and a composite primary key `(org_id, id)`. Child rows reference their
 * parent with composite foreign keys that include `org_id`, so a row can never point at another organisation's row.
 * RLS (`drizzle/0001_security.sql`) restricts every tenant table to `app.org_id`, set per transaction from the
 * authenticated membership (src/server/tenant.ts).
 *
 * Engine records: the financial engine (src/lib/clearline) operates on its own record shapes. Each row stores the
 * engine record verbatim in `record` (jsonb) plus extracted, constrained columns for queries and integrity. The rows
 * are the authoritative store; src/server/engine-store.ts rebuilds the engine workspace from them for every action.
 */
import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });

// ---------------------------------------------------------------------------------------------
// Identity (Better Auth tables, plural names; the library owns their writes)
// ---------------------------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("accounts_user_idx").on(t.userId)]);

/** Failed sign-ins per account (keyed by a hash of the e-mail), shared by every instance: the per-account limit. */
export const loginFailures = pgTable("login_failures", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  emailSha256: text("email_sha256").notNull(),
  at: ts("at").notNull().defaultNow(),
}, (t) => [index("login_failures_email_at_idx").on(t.emailSha256, t.at)]);

export const verifications = pgTable("verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------------------------
// Organisations, roles, memberships
// ---------------------------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull(),
  fictional: boolean("fictional").notNull().default(true),
  /** rc6: a merchant (the default, rc5 organisations) or a payment provider that offers Clearline to its merchants. */
  kind: text("kind").notNull().default("merchant"),
  /** rc6: the provider a merchant belongs to (null for a provider, or a merchant without one). */
  providerOrgId: uuid("provider_org_id"),
  /** rc6: white-label theme of a provider (name, logoUrl, colours); never secrets. */
  theme: jsonb("theme"),
  /** rc7: 'sample' (seeded, "Test mode · illustrative data") or 'live' (real uploads, "Your data"). Set by an operator. */
  dataMode: text("data_mode").notNull().default("sample"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  check("organizations_slug_chk", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}$'`),
  check("organizations_kind_chk", sql`${t.kind} in ('merchant','provider')`),
  check("organizations_data_mode_chk", sql`${t.dataMode} in ('sample','live','demo')`),
  check("organizations_provider_chk", sql`${t.kind} = 'merchant' or ${t.providerOrgId} is null`),
  foreignKey({ columns: [t.providerOrgId], foreignColumns: [t.id], name: "organizations_provider_fk" }),
]);

export const roles = pgTable("roles", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
});

export const organizationMemberships = pgTable("organization_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  userId: text("user_id").notNull().references(() => users.id),
  role: text("role").notNull().references(() => roles.code),
  createdAt: ts("created_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
}, (t) => [
  uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId),
  index("memberships_user_idx").on(t.userId),
]);

/** Per-organisation engine state that is not a record collection (counters, config, the engine's own idempotency). */
export const orgEngineState = pgTable("org_engine_state", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id),
  version: bigint("version", { mode: "number" }).notNull().default(0),
  state: jsonb("state").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------------------------
// Engine record tables (authoritative). `ord` keeps the engine's collection order.
// ---------------------------------------------------------------------------------------------

const CURRENCY = (c: unknown) => sql`${c} ~ '^[A-Z]{3,4}$'`;

export const paymentIntents = pgTable("payment_intents", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  internalReference: text("internal_reference").notNull(),
  beneficiaryName: text("beneficiary_name").notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull(),
  execution: text("execution").notNull(),
  settlement: text("settlement").notNull(),
  reconciliation: text("reconciliation").notNull(),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("payment_intents_amount_chk", sql`${t.amountMinor} >= 0`),
  check("payment_intents_currency_chk", CURRENCY(t.currency)),
  index("payment_intents_ref_idx").on(t.orgId, t.internalReference),
]);

/** Shared shape of a tenant record table that may point at a payment intent. */
function intentChild<T extends string>(name: T, extra: Record<string, ReturnType<typeof text> | ReturnType<typeof money>> = {}) {
  return pgTable(name, {
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    id: text("id").notNull(),
    ord: integer("ord").notNull(),
    intentId: text("intent_id"),
    ...extra,
    record: jsonb("record").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  }, (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    foreignKey({ columns: [t.orgId, t.intentId], foreignColumns: [paymentIntents.orgId, paymentIntents.id], name: `${name}_intent_fk` }),
    index(`${name}_intent_idx`).on(t.orgId, t.intentId),
  ]);
}

export const providerEvents = intentChild("provider_events", { eventType: text("event_type").notNull() });

/** Statement lines, chain observations and attached evidence. `provenance` says where the record came from. */
export const settlementEvidence = pgTable("settlement_evidence", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  kind: text("kind").notNull(),
  intentId: text("intent_id"),
  amountMinor: money("amount_minor"),
  currency: text("currency"),
  provenance: text("provenance").notNull(),
  importId: uuid("import_id"),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("settlement_evidence_kind_chk", sql`${t.kind} in ('statement_line','chain_observation','evidence_record')`),
  check("settlement_evidence_provenance_chk", sql`${t.provenance} in ('engine_action','seed_fictional','csv_import')`),
  check("settlement_evidence_amount_chk", sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
  foreignKey({ columns: [t.orgId, t.intentId], foreignColumns: [paymentIntents.orgId, paymentIntents.id], name: "settlement_evidence_intent_fk" }),
  index("settlement_evidence_kind_idx").on(t.orgId, t.kind),
]);

export const reconciliationRecords = intentChild("reconciliation_records", { lineId: text("line_id").notNull() });
export const exceptions = intentChild("exceptions", { category: text("category").notNull(), status: text("status").notNull(), ownerId: text("owner_id") });

/** Investigation cases. priority / next_action / due_date are Clearline Control fields kept outside the engine record. */
export const investigations = pgTable("investigations", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  intentId: text("intent_id"),
  status: text("status").notNull(),
  ownerId: text("owner_id"),
  priority: text("priority").notNull().default("normal"),
  nextAction: text("next_action"),
  dueDate: text("due_date"),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("investigations_priority_chk", sql`${t.priority} in ('low','normal','high','urgent')`),
  check("investigations_due_chk", sql`${t.dueDate} is null or ${t.dueDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  foreignKey({ columns: [t.orgId, t.intentId], foreignColumns: [paymentIntents.orgId, paymentIntents.id], name: "investigations_intent_fk" }),
]);

/** Append-only index of notes (the engine record keeps the same notes). */
export const investigationNotes = pgTable("investigation_notes", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: uuid("id").notNull().defaultRandom(),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  authorUserId: text("author_user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("investigation_notes_target_chk", sql`${t.targetKind} in ('case','exception')`),
  check("investigation_notes_body_chk", sql`length(${t.body}) between 1 and 4000`),
]);

export const fundingObligations = pgTable("funding_obligations", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  kind: text("kind").notNull(),
  intentId: text("intent_id"),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("funding_obligations_kind_chk", sql`${t.kind} in ('advance','obligation')`),
  foreignKey({ columns: [t.orgId, t.intentId], foreignColumns: [paymentIntents.orgId, paymentIntents.id], name: "funding_obligations_intent_fk" }),
]);

export const repaymentAllocations = pgTable("repayment_allocations", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

export const accountingProposals = pgTable("accounting_proposals", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  status: text("status").notNull(),
  rule: text("rule").notNull(),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

export const accountingExports = pgTable("accounting_exports", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

/** Less central engine collections (quotes, instructions, holds, routes, liquidity, funding decisions). */
export const engineRecords = pgTable("engine_records", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  collection: text("collection").notNull(),
  id: text("id").notNull(),
  ord: integer("ord").notNull(),
  record: jsonb("record").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.collection, t.id] }),
  check("engine_records_collection_chk", sql`${t.collection} in ('routes','quotes','instructions','holds','liquidity','fundingDecisions')`),
]);

// ---------------------------------------------------------------------------------------------
// Server-enforced maker-checker
// ---------------------------------------------------------------------------------------------

export const approvalRequests = pgTable("approval_requests", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: uuid("id").notNull().defaultRandom(),
  subjectKind: text("subject_kind").notNull(),
  subjectId: text("subject_id").notNull(),
  version: integer("version").notNull(),
  payload: jsonb("payload").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  requestedBy: text("requested_by").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("approval_requests_kind_chk", sql`${t.subjectKind} in ('investigation_resolution','merchant_writeoff','merchant_resolution')`),
  check("approval_requests_status_chk", sql`${t.status} in ('pending','approved','rejected','superseded')`),
  check("approval_requests_sha_chk", sql`${t.payloadSha256} ~ '^[0-9a-f]{64}$'`),
  uniqueIndex("approval_requests_version_uq").on(t.orgId, t.subjectKind, t.subjectId, t.version),
  uniqueIndex("approval_requests_one_pending_uq").on(t.orgId, t.subjectKind, t.subjectId).where(sql`${t.status} = 'pending'`),
]);

export const approvalDecisions = pgTable("approval_decisions", {
  orgId: uuid("org_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  decidedBy: text("decided_by").notNull().references(() => users.id),
  decision: text("decision").notNull(),
  reason: text("reason").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  foreignKey({ columns: [t.orgId, t.requestId], foreignColumns: [approvalRequests.orgId, approvalRequests.id], name: "approval_decisions_request_fk" }),
  uniqueIndex("approval_decisions_one_per_request_uq").on(t.orgId, t.requestId),
  check("approval_decisions_decision_chk", sql`${t.decision} in ('approve','reject')`),
]);

// ---------------------------------------------------------------------------------------------
// Audit, idempotency, statement imports
// ---------------------------------------------------------------------------------------------

/** Append-only: UPDATE and DELETE are refused by trigger, and the runtime role has INSERT/SELECT only. */
export const auditEvents = pgTable("audit_events", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  engineId: text("engine_id"),
  source: text("source").notNull(),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  summary: text("summary").notNull(),
  at: ts("at").notNull(),
  details: jsonb("details"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.seq] }),
  check("audit_events_source_chk", sql`${t.source} in ('engine','server','auth')`),
  uniqueIndex("audit_events_engine_uq").on(t.orgId, t.engineId),
  index("audit_events_entity_idx").on(t.orgId, t.entityType, t.entityId),
]);

export const idempotencyRecords = pgTable("idempotency_records", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  key: text("key").notNull(),
  userId: text("user_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  statusCode: integer("status_code").notNull(),
  response: jsonb("response").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.key] }),
  check("idempotency_key_chk", sql`${t.key} ~ '^[A-Za-z0-9._:-]{8,128}$'`),
]);

export const statementImports = pgTable("statement_imports", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  id: uuid("id").notNull().defaultRandom(),
  fileSha256: text("file_sha256").notNull(),
  fileName: text("file_name").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  rowCount: integer("row_count").notNull(),
  acceptedCount: integer("accepted_count").notNull(),
  rejectedCount: integer("rejected_count").notNull(),
  status: text("status").notNull(),
  errors: jsonb("errors").notNull(),
  importedBy: text("imported_by").notNull().references(() => users.id),
  /** Validated lines held until a second person confirms the import; only then does the engine ingest them. */
  lines: jsonb("lines").notNull().default([]),
  /** SHA-256 of the canonical staged lines: what the confirming approver reviewed and what is ingested. */
  linesSha256: text("lines_sha256"),
  confirmedBy: text("confirmed_by").references(() => users.id),
  confirmedAt: ts("confirmed_at"),
  decisionReason: text("decision_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  uniqueIndex("statement_imports_file_uq").on(t.orgId, t.fileSha256),
  check("statement_imports_status_chk", sql`${t.status} in ('pending_confirmation','imported','rejected','declined')`),
  check("statement_imports_confirmer_chk", sql`${t.confirmedBy} is null or ${t.confirmedBy} <> ${t.importedBy}`),
  check("statement_imports_size_chk", sql`${t.sizeBytes} between 1 and 1048576`),
]);

export * from "./merchant-schema";
export * from "./upload-schema";
export * from "./ops-schema";
export * from "./ledger-schema";
export * from "./notify-schema";
export * from "./demo-schema";
