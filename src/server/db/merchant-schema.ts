/**
 * rc6 Merchant Reconciliation schema. Tenancy: provider (organizations.kind = 'provider') → merchant (an rc5
 * organisation, kind = 'merchant', provider_org_id) → merchant_entity. Every merchant table carries org_id (the
 * merchant) and a composite key (org_id, id); RLS (drizzle/0007_merchant_security.sql) limits rows to the merchant's
 * members, plus read access for the provider ONLY under an explicit, unrevoked 'full' grant. Without one, a provider
 * sees aggregates only (SECURITY DEFINER function provider_merchant_health).
 *
 * Amounts: fiat in integer minor units (bigint); tokens in base units (numeric(78,0), exact) with their decimals;
 * rates as exact numeric. Nothing here moves or holds money.
 */
import { sql } from "drizzle-orm";
import {
  bigint, boolean, check, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => bigint(name, { mode: "bigint" });
const baseUnits = (name: string) => numeric(name, { precision: 78, scale: 0 });
const rate = (name: string) => numeric(name, { precision: 24, scale: 10 });
const org = () => uuid("org_id").notNull().references(() => organizations.id);
const CUR = (c: unknown) => sql`${c} ~ '^[A-Z]{3}$'`;
/**
 * rc7 provenance of a row normalised from an upload: which upload and row it came from, the mapping template used
 * and who uploaded it. Null for rows from other sources (seed, recorded chain data). Never changes (trigger, 0021).
 */
const fromUpload = () => ({
  uploadId: uuid("upload_id"), sourceRow: integer("source_row"), mappingTemplateId: uuid("mapping_template_id"),
  mappingTemplateVersion: integer("mapping_template_version"), uploadedBy: text("uploaded_by").references(() => users.id),
});

/** Global, read-only reference data (not tenant data). */
export const networkConfig = pgTable("network_config", {
  network: text("network").primaryKey(),
  displayName: text("display_name").notNull(),
  confirmationsRequired: integer("confirmations_required").notNull(),
  enabled: boolean("enabled").notNull().default(false),
}, (t) => [check("network_config_conf_chk", sql`${t.confirmationsRequired} between 1 and 10000`)]);

export const tokenConfig = pgTable("token_config", {
  network: text("network").notNull().references(() => networkConfig.network),
  contract: text("contract").notNull(),
  symbol: text("symbol").notNull(),
  decimals: integer("decimals").notNull(),
}, (t) => [primaryKey({ columns: [t.network, t.contract] }), check("token_config_dec_chk", sql`${t.decimals} between 0 and 36`)]);

/** A provider's merchants grant it read access: 'aggregates' (default, implicit) or 'full'. */
export const providerGrants = pgTable("provider_grants", {
  merchantOrgId: uuid("merchant_org_id").notNull().references(() => organizations.id),
  providerOrgId: uuid("provider_org_id").notNull().references(() => organizations.id),
  scope: text("scope").notNull(),
  grantedBy: text("granted_by").notNull().references(() => users.id),
  grantedAt: ts("granted_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
}, (t) => [
  primaryKey({ columns: [t.merchantOrgId, t.providerOrgId] }),
  check("provider_grants_scope_chk", sql`${t.scope} in ('aggregates','full')`),
]);

export const merchantEntities = pgTable("merchant_entities", {
  orgId: org(), id: text("id").notNull(),
  name: text("name").notNull(),
  functionalCurrency: text("functional_currency").notNull(),
  ledger: text("ledger").notNull(),
  timezone: text("timezone").notNull(),
  /** rc6 phase 6: the entity's fixed UTC offset (the engine's merchant day) [ASSUMPTION: no daylight saving]. */
  utcOffsetMinutes: integer("utc_offset_minutes").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("merchant_entities_cur_chk", CUR(t.functionalCurrency)),
  check("merchant_entities_ledger_chk", sql`${t.ledger} in ('xero','quickbooks','none')`),
]);

/**
 * Per-entity policy. rc7 founder decision: band = the LARGER of 0.5% or a fixed amount per currency (SGD 5.00,
 * USD 5.00, AED 20.00); the code sets the per-currency amount when an entity is created. Editable by an Admin.
 */
export const merchantPolicy = pgTable("merchant_policy", {
  orgId: org(), entityId: text("entity_id").notNull(),
  toleranceBps: integer("tolerance_bps").notNull().default(50),
  toleranceAbsMinor: money("tolerance_abs_minor").notNull().default(sql`500`),
  toleranceCombine: text("tolerance_combine").notNull().default("larger"),
  writeoffThresholdMinor: money("writeoff_threshold_minor").notNull().default(sql`500`),
  approverRoles: jsonb("approver_roles").notNull().default(["approver"]),
  /** rc5 open decision: an imported (csv_import) bank line never makes settlement verified unless this is on. */
  allowImportedBankLinesAsVerified: boolean("allow_imported_bank_lines_as_verified").notNull().default(false),
  senderFeeBoundBaseUnits: baseUnits("sender_fee_bound_base_units").notNull().default(sql`2000000`),
  revision: integer("revision").notNull().default(1),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.entityId] }),
  foreignKey({ columns: [t.orgId, t.entityId], foreignColumns: [merchantEntities.orgId, merchantEntities.id], name: "merchant_policy_entity_fk" }),
  check("merchant_policy_bps_chk", sql`${t.toleranceBps} between 0 and 1000`),
  check("merchant_policy_abs_chk", sql`${t.toleranceAbsMinor} >= 0`),
  check("merchant_policy_combine_chk", sql`${t.toleranceCombine} in ('smaller', 'larger')`),
]);

export const invoices = pgTable("invoices", {
  orgId: org(), orderId: text("order_id").notNull(),
  entityId: text("entity_id").notNull(),
  amountMinor: money("amount_minor").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  issuedAt: ts("issued_at").notNull(),
  ...fromUpload(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.orderId] }),
  foreignKey({ columns: [t.orgId, t.entityId], foreignColumns: [merchantEntities.orgId, merchantEntities.id], name: "invoices_entity_fk" }),
  check("invoices_amount_chk", sql`${t.amountMinor} > 0`), check("invoices_cur_chk", CUR(t.currency)),
  check("invoices_status_chk", sql`${t.status} in ('open','part_paid','paid','closed_with_difference','overpaid','void')`),
]);

export const merchantQuotes = pgTable("merchant_quotes", {
  orgId: org(), quoteId: text("quote_id").notNull(),
  orderId: text("order_id").notNull(),
  network: text("network").notNull(), tokenContract: text("token_contract").notNull(),
  quotedBaseUnits: baseUnits("quoted_base_units").notNull(),
  rate: rate("rate").notNull(), rateSource: text("rate_source").notNull(), rateAt: ts("rate_at").notNull(),
  createdAt: ts("created_at").notNull(), expiresAt: ts("expires_at").notNull(),
  depositAddress: text("deposit_address").notNull(),
  ...fromUpload(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.quoteId] }),
  foreignKey({ columns: [t.orgId, t.orderId], foreignColumns: [invoices.orgId, invoices.orderId], name: "merchant_quotes_invoice_fk" }),
  foreignKey({ columns: [t.network, t.tokenContract], foreignColumns: [tokenConfig.network, tokenConfig.contract], name: "merchant_quotes_token_fk" }),
  check("merchant_quotes_window_chk", sql`${t.expiresAt} > ${t.createdAt}`),
  uniqueIndex("merchant_quotes_deposit_uq").on(t.orgId, t.network, t.depositAddress),
]);

export const paymentLinks = pgTable("payment_links", {
  orgId: org(), linkId: text("link_id").notNull(),
  orderId: text("order_id").notNull(), kind: text("kind").notNull(),
  network: text("network").notNull(), depositAddress: text("deposit_address").notNull(),
  requestedMinor: money("requested_minor").notNull(),
  // rc6 phase 6: what the engine needs of a link (its quote, token, amount and own validity window)
  quoteId: text("quote_id"), tokenContract: text("token_contract"), requestedBaseUnits: baseUnits("requested_base_units"),
  createdAt: ts("created_at"), expiresAt: ts("expires_at"),
  ...fromUpload(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.linkId] }),
  foreignKey({ columns: [t.orgId, t.orderId], foreignColumns: [invoices.orgId, invoices.orderId], name: "payment_links_invoice_fk" }),
  check("payment_links_kind_chk", sql`${t.kind} in ('full','balance')`),
  uniqueIndex("payment_links_deposit_uq").on(t.orgId, t.network, t.depositAddress),
]);

/** On-chain facts, read-only. Sender/receiver addresses are recorded as facts, never judged. */
export const chainTransfers = pgTable("chain_transfers", {
  orgId: org(), network: text("network").notNull(), txHash: text("tx_hash").notNull(), logIndex: integer("log_index").notNull(),
  tokenContract: text("token_contract").notNull(),
  fromAddress: text("from_address").notNull(), toAddress: text("to_address").notNull(),
  amountBaseUnits: baseUnits("amount_base_units").notNull(), decimals: integer("decimals").notNull(),
  block: bigint("block", { mode: "number" }).notNull(), blockTime: ts("block_time").notNull(),
  confirmations: integer("confirmations").notNull(), finalised: boolean("finalised").notNull(),
  source: text("source").notNull(),
  observedAt: ts("observed_at").notNull().defaultNow(),
  entityId: text("entity_id"), claimedSymbol: text("claimed_symbol"), priorHops: jsonb("prior_hops"),
  ...fromUpload(),
  // rc7 phase 2: where a chain_client fact was read (host only, never a key), when, and the block's hash
  evidenceSource: text("evidence_source"), evidenceHost: text("evidence_host"), evidenceEndpoint: text("evidence_endpoint"),
  fetchedAt: ts("fetched_at"), blockHash: text("block_hash"),
}, (t) => [
  // rc7: the source is part of the key, so a provider's claim and the chain's fact about one transfer are two rows
  primaryKey({ columns: [t.orgId, t.network, t.txHash, t.logIndex, t.source] }),
  check("chain_transfers_evidence_chk", sql`${t.source} <> 'chain_client' or (${t.evidenceSource} is not null and ${t.evidenceHost} is not null and ${t.evidenceEndpoint} is not null and ${t.fetchedAt} is not null)`),
  check("chain_transfers_amount_chk", sql`${t.amountBaseUnits} > 0`),
  // rc7: 'provider_export' = a transfer a provider's file CLAIMS (by tx hash); never finalised by the file (trigger, 0021)
  check("chain_transfers_source_chk", sql`${t.source} in ('recorded_fixture','chain_client','seed_fictional','provider_export')`),
  index("chain_transfers_to_idx").on(t.orgId, t.network, t.toAddress),
]);

export const providerPaymentRecords = pgTable("provider_payment_records", {
  orgId: org(), providerPaymentId: text("provider_payment_id").notNull(),
  quoteId: text("quote_id"), linkId: text("link_id"),
  statusClaim: text("status_claim").notNull(),
  receivedBaseUnits: baseUnits("received_base_units"),
  creditedMinor: money("credited_minor"), creditedCurrency: text("credited_currency"),
  executedRate: rate("executed_rate"), feeMinor: money("fee_minor"),
  batchId: text("batch_id"),
  importId: uuid("import_id"),
  record: jsonb("record").notNull(),
  ...fromUpload(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.providerPaymentId] }),
  check("provider_payment_records_claim_chk", sql`${t.statusClaim} in ('paid','underpaid','overpaid','held_for_review','re_quoted','partially_paid','refunded','pending','failed')`),
  check("provider_payment_records_ref_chk", sql`${t.quoteId} is not null or ${t.linkId} is not null`),
]);

export const settlementBatches = pgTable("settlement_batches", {
  orgId: org(), batchId: text("batch_id").notNull(),
  dayStart: ts("day_start").notNull(), dayEnd: ts("day_end").notNull(), dayTimezone: text("day_timezone").notNull(),
  currency: text("currency").notNull(), targetBankAccount: text("target_bank_account").notNull(),
  grossMinor: money("gross_minor").notNull(), feesMinor: money("fees_minor").notNull(),
  refundsMinor: money("refunds_minor").notNull(), netMinor: money("net_minor").notNull(),
  entityId: text("entity_id"), dayUtcOffsetMinutes: integer("day_utc_offset_minutes").notNull().default(0),
  ...fromUpload(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.batchId] }),
  check("settlement_batches_arith_chk", sql`${t.grossMinor} - ${t.feesMinor} - ${t.refundsMinor} = ${t.netMinor}`),
  check("settlement_batches_cur_chk", CUR(t.currency)),
]);

export const settlementBatchLines = pgTable("settlement_batch_lines", {
  orgId: org(), batchId: text("batch_id").notNull(), lineNo: integer("line_no").notNull(),
  kind: text("kind").notNull(), ref: text("ref").notNull(), amountMinor: money("amount_minor").notNull(),
  orderId: text("order_id"),
  ...fromUpload(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.batchId, t.lineNo] }),
  foreignKey({ columns: [t.orgId, t.batchId], foreignColumns: [settlementBatches.orgId, settlementBatches.batchId], name: "settlement_batch_lines_batch_fk" }),
  check("settlement_batch_lines_kind_chk", sql`${t.kind} in ('payment','refund')`),
]);

/** Bank lines: 'bank_feed' or 'csv_import' (imported, not bank-authenticated) with provenance. */
export const bankLines = pgTable("bank_lines", {
  orgId: org(), lineId: text("line_id").notNull(),
  account: text("account").notNull(), currency: text("currency").notNull(), valueDate: text("value_date").notNull(),
  amountMinor: money("amount_minor").notNull(), description: text("description").notNull(),
  source: text("source").notNull(), importId: uuid("import_id"),
  entityId: text("entity_id"), provenance: text("provenance"),
  ...fromUpload(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.lineId] }),
  // rc7: 'file_import' = a line from an uploaded statement (CSV, XLSX, MT940, camt.053): imported, not bank-authenticated
  check("bank_lines_source_chk", sql`${t.source} in ('bank_feed','csv_import','seed_fictional','file_import')`),
  check("bank_lines_import_chk", sql`${t.source} <> 'csv_import' or ${t.importId} is not null`),
  check("bank_lines_upload_chk", sql`${t.source} <> 'file_import' or ${t.uploadId} is not null`),
  check("bank_lines_date_chk", sql`${t.valueDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
]);

export const fxRates = pgTable("fx_rates", {
  orgId: org(), pair: text("pair").notNull(), rate: rate("rate").notNull(), source: text("source").notNull(), observedAt: ts("observed_at").notNull(),
  entityId: text("entity_id"),
}, (t) => [primaryKey({ columns: [t.orgId, t.pair, t.source, t.observedAt] }), check("fx_rates_pair_chk", sql`${t.pair} ~ '^[A-Z]{3,4}/[A-Z]{3}$'`)]);

/** rc6 phase 6: facts about an address (registered, intermediate, exchange hot wallet). Recorded, never judged. */
export const addressFacts = pgTable("address_facts", {
  orgId: org(), network: text("network").notNull(), address: text("address").notNull(), fact: text("fact").notNull(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.network, t.address, t.fact] }),
  check("address_facts_fact_chk", sql`${t.fact} in ('registered_wallet','intermediate_wallet','exchange_hot_wallet','unknown')`),
]);

/** One per payment (invoice): five linked parts, never merged into one status. */
export const matchRecords = pgTable("match_records", {
  orgId: org(), orderId: text("order_id").notNull(),
  decision: text("decision").notNull(), decidingStep: integer("deciding_step").notNull(), ruleId: text("rule_id").notNull(),
  chain: jsonb("chain").notNull(), provider: jsonb("provider").notNull(), bank: jsonb("bank").notNull(),
  ledger: jsonb("ledger").notNull(), explanation: jsonb("explanation").notNull(),
  engineVersion: text("engine_version").notNull(), inputSha256: text("input_sha256").notNull(),
  computedAt: ts("computed_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.orderId] }),
  foreignKey({ columns: [t.orgId, t.orderId], foreignColumns: [invoices.orgId, invoices.orderId], name: "match_records_invoice_fk" }),
  check("match_records_decision_chk", sql`${t.decision} in ('matched','matched_with_difference','suggested_for_review','exception')`),
  check("match_records_step_chk", sql`${t.decidingStep} between 1 and 5`),
]);

export const DIFFERENCE_TYPES = ["sender_side_fee", "underpayment", "overpayment", "requote_after_expiry", "rate_difference", "provider_fee",
  "refund_netted", "timing_prior_batch", "timing_next_batch", "held_by_provider", "partial_payment_open", "unexplained"] as const;

export const differences = pgTable("differences", {
  orgId: org(), id: text("id").notNull(), orderId: text("order_id").notNull(),
  type: text("type").notNull(), amountMinor: money("amount_minor").notNull(), currency: text("currency").notNull(),
  reason: text("reason").notNull(), ruleId: text("rule_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  foreignKey({ columns: [t.orgId, t.orderId], foreignColumns: [invoices.orgId, invoices.orderId], name: "differences_invoice_fk" }),
  check("differences_type_chk", sql.raw(`type in (${DIFFERENCE_TYPES.map((x) => `'${x}'`).join(",")})`)),
  check("differences_reason_chk", sql`length(${t.reason}) between 3 and 1000`),
]);

/** Exceptions of the merchant product: every one has an owner, a plain-English reason and a next step. */
export const reconExceptions = pgTable("recon_exceptions", {
  orgId: org(), id: text("id").notNull(), orderId: text("order_id"),
  ownerRole: text("owner_role").notNull(), ownerUserId: text("owner_user_id").references(() => users.id),
  reason: text("reason").notNull(), nextStep: text("next_step").notNull(),
  status: text("status").notNull().default("open"), openedAt: ts("opened_at").notNull(), closedAt: ts("closed_at"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("recon_exceptions_status_chk", sql`${t.status} in ('open','in_review','resolved')`),
  check("recon_exceptions_text_chk", sql`length(${t.reason}) >= 3 and length(${t.nextStep}) >= 3 and length(${t.ownerRole}) >= 3`),
]);

/** Write-offs use the rc5 two-person flow: approval_requests (subject_kind 'merchant_writeoff') + decision triggers. */
export const writeoffProposals = pgTable("writeoff_proposals", {
  orgId: org(), id: text("id").notNull(), orderId: text("order_id").notNull(),
  amountMinor: money("amount_minor").notNull(), currency: text("currency").notNull(),
  differenceIds: jsonb("difference_ids").notNull(),
  preparedBy: text("prepared_by").references(() => users.id),
  approvalRequestId: uuid("approval_request_id"),
  status: text("status").notNull().default("proposed"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  foreignKey({ columns: [t.orgId, t.orderId], foreignColumns: [invoices.orgId, invoices.orderId], name: "writeoff_proposals_invoice_fk" }),
  check("writeoff_proposals_amount_chk", sql`${t.amountMinor} > 0`),
  check("writeoff_proposals_status_chk", sql`${t.status} in ('proposed','awaiting_approval','approved','rejected','superseded')`),
]);

/** Merchant journal proposals (Accounting Bridge extension). Posting rules are PENDING the founder's sign-off. */
export const merchantJournalProposals = pgTable("merchant_journal_proposals", {
  orgId: org(), id: text("id").notNull(), entityId: text("entity_id").notNull(),
  pattern: text("pattern").notNull(), lines: jsonb("lines").notNull(), currency: text("currency").notNull(),
  evidenceRefs: jsonb("evidence_refs").notNull(),
  status: text("status").notNull().default("proposed"), postingRuleStatus: text("posting_rule_status").notNull().default("pending_sign_off"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("merchant_journal_status_chk", sql`${t.status} in ('proposed','approved','exported','rejected','superseded')`),
  check("merchant_journal_rule_chk", sql`${t.postingRuleStatus} = 'pending_sign_off'`),
]);

/**
 * rc7 phase 2: every chain read the verify step made for an entity (append-only): a deposit address (listing) or a
 * transaction hash. `unavailable` reads feed ReconcileInput.chainUnavailable until a later read of the same target
 * succeeds. Host and endpoint only, never a key or a URL.
 */
export const chainReads = pgTable("chain_reads", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(), entityId: text("entity_id").notNull(),
  network: text("network").notNull(), address: text("address"), txHash: text("tx_hash"),
  status: text("status").notNull(), reason: text("reason"), source: text("source").notNull(),
  host: text("host"), endpoint: text("endpoint"), transfers: integer("transfers").notNull().default(0), at: ts("at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  foreignKey({ columns: [t.orgId, t.entityId], foreignColumns: [merchantEntities.orgId, merchantEntities.id], name: "chain_reads_entity_fk" }),
  check("chain_reads_target_chk", sql`(${t.address} is null) <> (${t.txHash} is null)`),
  check("chain_reads_status_chk", sql`${t.status} in ('ok','unavailable','not_found','failed_transaction','reorged')`),
  index("chain_reads_entity_idx").on(t.orgId, t.entityId, t.at),
]);

/** Optional "minutes spent today" log for the pilot's time-saved measurement. */
export const pilotTimeLog = pgTable("pilot_time_log", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(), userId: text("user_id").notNull().references(() => users.id),
  day: text("day").notNull(), minutes: integer("minutes").notNull(), note: text("note"),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] }), check("pilot_time_log_min_chk", sql`${t.minutes} between 0 and 1440`)]);

/** Reviewer marks of sampled matches (pilot metric: wrong matches in a reviewed sample). */
export const matchReviews = pgTable("match_reviews", {
  orgId: org(), orderId: text("order_id").notNull(), reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id),
  verdict: text("verdict").notNull(), note: text("note"), reviewedAt: ts("reviewed_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.orderId, t.reviewerUserId] }),
  check("match_reviews_verdict_chk", sql`${t.verdict} in ('correct','wrong')`),
]);

/**
 * rc6 phase 7: notes and attached evidence on a merchant exception (append-only). An attachment is a description and
 * a reference given by a person: it is recorded as "attached by a person", never as independent evidence, and no
 * file is stored.
 */
export const reconExceptionNotes = pgTable("recon_exception_notes", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(),
  exceptionId: text("exception_id").notNull(),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  reference: text("reference"),
  authorUserId: text("author_user_id").notNull().references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  foreignKey({ columns: [t.orgId, t.exceptionId], foreignColumns: [reconExceptions.orgId, reconExceptions.id], name: "recon_exception_notes_exception_fk" }),
  check("recon_exception_notes_kind_chk", sql`${t.kind} in ('note','evidence')`),
  check("recon_exception_notes_body_chk", sql`length(${t.body}) between 1 and 2000`),
  check("recon_exception_notes_ref_chk", sql`${t.reference} is null or length(${t.reference}) between 1 and 120`),
  index("recon_exception_notes_exception_idx").on(t.orgId, t.exceptionId),
]);

/**
 * rc6 phase 8: a provider's onboarding of one of its merchants, kept in the PROVIDER's tenancy (org_id = the
 * provider). "Connect exports" is a column-mapping config (JSON, validated against the provider-export adapter's
 * mapping schema); nothing connects to anything live. Policy defaults are only a proposal: the merchant's own Admin
 * sets the matching policy.
 */
export const merchantOnboarding = pgTable("merchant_onboarding", {
  orgId: org(), merchantOrgId: uuid("merchant_org_id").notNull().references(() => organizations.id),
  columnMapping: jsonb("column_mapping"),
  policyDefaults: jsonb("policy_defaults"),
  revision: integer("revision").notNull().default(1),
  updatedBy: text("updated_by").notNull().references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.merchantOrgId] })]);

/** An invitation record (no email is sent): an operator accepts it with `admin.ts accept-invitation <id>`. */
export const merchantInvitations = pgTable("merchant_invitations", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(),
  merchantOrgId: uuid("merchant_org_id").notNull().references(() => organizations.id),
  email: text("email").notNull(), role: text("role").notNull(),
  invitedBy: text("invited_by").notNull().references(() => users.id),
  status: text("status").notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(), acceptedAt: ts("accepted_at"),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.id] }),
  check("merchant_invitations_role_chk", sql`${t.role} in ('admin','payment_ops','finance','approver','viewer')`),
  check("merchant_invitations_status_chk", sql`${t.status} in ('pending','accepted','revoked')`),
  check("merchant_invitations_email_chk", sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' and length(${t.email}) <= 254`),
  uniqueIndex("merchant_invitations_pending_uq").on(t.orgId, t.merchantOrgId, t.email).where(sql`${t.status} = 'pending'`),
]);
