/**
 * v1 phase 2.3: ledger connections (OAuth 2.0, tokens sealed), single-use OAuth states, the account mapping and the
 * DRAFT journals written to a ledger. Security, constraints and transitions: drizzle/0059_ledger_connections.sql and
 * drizzle/0060_ledger_journal_drafts.sql (hand-written).
 */
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const LEDGER_CONNECTION_STATUSES = ["choose_tenant", "active", "needs_reconnect", "disconnected"] as const;
export type LedgerConnectionStatus = (typeof LEDGER_CONNECTION_STATUSES)[number];

export const ledgerConnections = pgTable("ledger_connections", {
  orgId: uuid("org_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  provider: text("provider").notNull(),
  ledgerEnv: text("ledger_env").notNull(),
  status: text("status").notNull(),
  tenantId: text("tenant_id"),
  tenantName: text("tenant_name"),
  xeroConnectionId: text("xero_connection_id"),
  tenantChoices: jsonb("tenant_choices"),
  baseCurrency: text("base_currency"),
  accessTokenSealed: text("access_token_sealed"),
  refreshTokenSealed: text("refresh_token_sealed"),
  pendingTokensSealed: text("pending_tokens_sealed"),
  accessExpiresAt: ts("access_expires_at"),
  refreshExpiresAt: ts("refresh_expires_at"),
  scopes: text("scopes"),
  reconnectReason: text("reconnect_reason"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  connectedAt: ts("connected_at"),
  lastRefreshedAt: ts("last_refreshed_at"),
  disconnectedAt: ts("disconnected_at"),
}, (t) => [primaryKey({ columns: [t.orgId, t.id], name: "ledger_connections_pk" })]);

export const ledgerOauthStates = pgTable("ledger_oauth_states", {
  orgId: uuid("org_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  stateHash: text("state_hash").notNull(),
  browserHash: text("browser_hash").notNull(),
  provider: text("provider").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  pkceVerifierSealed: text("pkce_verifier_sealed"),
  nonce: text("nonce"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  consumedAt: ts("consumed_at"),
}, (t) => [primaryKey({ columns: [t.orgId, t.id], name: "ledger_oauth_states_pk" })]);

export const ledgerAccountMaps = pgTable("ledger_account_maps", {
  orgId: uuid("org_id").notNull(),
  connectionId: uuid("connection_id").notNull(),
  clearlineAccount: text("clearline_account").notNull(),
  ledgerAccountCode: text("ledger_account_code").notNull(),
  setBy: text("set_by").notNull(),
  setAt: ts("set_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.connectionId, t.clearlineAccount], name: "ledger_account_maps_pk" })]);

export const ledgerJournalDrafts = pgTable("ledger_journal_drafts", {
  orgId: uuid("org_id").notNull(),
  id: uuid("id").notNull().defaultRandom(),
  connectionId: uuid("connection_id").notNull(),
  ledgerTenantId: text("ledger_tenant_id").notNull(),
  entityId: text("entity_id").notNull(),
  proposalId: text("proposal_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestSha256: text("request_sha256").notNull(),
  postingRulesVersion: text("posting_rules_version").notNull(),
  status: text("status").notNull(),
  externalId: text("external_id"),
  failure: text("failure"),
  attempts: integer("attempts").notNull().default(1),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id], name: "ledger_journal_drafts_pk" })]);
