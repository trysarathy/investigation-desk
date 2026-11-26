/**
 * v1 phase 5.6 test helper: a fictional merchant A with at least one row in EVERY table of the schema that can hold a
 * merchant's data (real code paths where the suite has them: uploads, normalisation, a reconciliation run, the engine
 * seed, a TOTP authenticator; raw owner inserts for the rest, with each table's insert-check triggers disabled for the
 * insert only — test set-up, never product code). Every free-text field carries the marker "Zephyrine" and A's
 * members get distinctive fictional names, so a scan can look for them. Fictional values only.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as t from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";
import { saveWorkspaceDiff } from "../../src/server/engine-store";
import { pilotSeedWorkspace } from "../../src/server/seed";
import { emptyWorkspace } from "../../src/lib/clearline";
import { keyHash } from "../../src/server/rate-limit";
import { enrolTestTotp, ownerDb, resetAndSeed } from "./harness";
import { liveCtx, seedLiveMerchants, type LiveSeed } from "./upload-harness";
import { pushFile, seedSgLive, type LiveSg } from "./live-data";
import type { Mapping } from "../../src/lib/clearline/mapping";

/**
 * Tables that hold no merchant's data at all (platform-wide reference data, or platform staff). Every other table must
 * hold a row of the seeded merchant, so a table added later fails the coverage check until it is seeded here.
 */
export const GLOBAL_TABLES: Record<string, string> = {
  network_config: "the chains Clearline reads (reference data)",
  token_config: "token contracts per chain (reference data)",
  roles: "the role codes (reference data)",
  platform_operators: "Clearline's own staff, never a merchant's member (a platform operator is never deleted with a merchant)",
  // wave 2 integration
  ops_worker_heartbeats: "one row per job worker process (worker id, start, last seen, passes): no organisation, member or data (e4)",
};

export const MARKER = "Zephyrine";
export interface ErasureSeed { s: LiveSeed; live: LiveSg; aUsers: string[]; aEmails: string[]; aNames: string[]; bUpload: string }

const LEDGER: Mapping = { fileType: "ledger_invoices", columns: { invoice_number: { header: "Invoice" }, total: { header: "Total" }, currency: { header: "Ccy" } } };
const hex = () => randomBytes(32).toString("hex");

async function raw(db: Db, table: string, q: ReturnType<typeof sql>) {
  await db.execute(sql`alter table ${sql.identifier(table)} disable trigger user`);
  try { await db.execute(q); } finally { await db.execute(sql`alter table ${sql.identifier(table)} enable trigger user`); }
}

export async function seedEveryTable(suffix: string): Promise<ErasureSeed> {
  const db = ownerDb();
  await resetAndSeed();
  const s = await seedLiveMerchants(db, suffix);
  const live = await seedSgLive(s, `${MARKER}-LIVE`);
  const A = s.orgs.a, P = s.orgs.providerA;
  const aKeys = Object.keys(s.users).filter((e) => e.endsWith("@live-a.example"));
  const aUsers = aKeys.map((e) => s.users[e]);
  const aEmails = aKeys.map((e) => e.replace("@", `${suffix}@`));
  // distinctive fictional names for A's members (merchant B's members are called "finance (fictional)" too)
  const aNames = aKeys.map((_, i) => `${MARKER} Quillfeather ${i} (fictional)`);
  for (let i = 0; i < aUsers.length; i++) await db.update(t.users).set({ name: aNames[i] }).where(eq(t.users.id, aUsers[i]));
  const [fin, ops, approver, approver2, viewer, admin] = ["finance", "ops", "approver", "approver2", "viewer", "admin"].map((r) => s.users[`${r}@live-a.example`]);
  const providerAdmin = s.users["admin@provider-a.example"];
  const ent = live.entityId;

  // engine records (payment intents, exceptions, investigations, funding, accounting …) through the engine store
  await db.transaction(async (tx) => {
    const ws = pilotSeedWorkspace();
    await saveWorkspaceDiff(tx, A, emptyWorkspace(), ws, { provenance: "seed_fictional", actorUserId: null, seedActors: ws.actors });
  });
  // a ledger file through the real upload path; and one of merchant B, which must survive
  const finCtx = await liveCtx(s, "finance@live-a.example", "a");
  await pushFile(finCtx, finCtx, ent, "ledger_invoices", "ledger.csv", new TextEncoder().encode("Invoice,Total,Ccy\nZQ-1,10.00,SGD\nZQ-2,12.00,SGD\n"), LEDGER);
  const finB = await liveCtx(s, "finance@live-b.example", "b");
  const bUpload = await pushFile(finB, finB, "ENT-LIVE-AE", "ledger_invoices", "b-ledger.csv", new TextEncoder().encode("Invoice,Total,Ccy\nAE-1,20.00,AED\n"), LEDGER);
  await enrolTestTotp(approver2);

  const order = String((await db.execute(sql`select order_id from invoices where org_id = ${A} order by order_id limit 1`)).rows[0].order_id);
  const batch = String((await db.execute(sql`select batch_id from settlement_batches where org_id = ${A} limit 1`)).rows[0].batch_id);
  const upload = live.uploadIds[2];
  const exc = (await db.execute(sql`select id from recon_exceptions where org_id = ${A} limit 1`)).rows[0];
  const excId = exc ? String(exc.id) : `EXC-${MARKER}`;
  if (!exc) await raw(db, "recon_exceptions", sql`insert into recon_exceptions (org_id, id, order_id, owner_role, reason, next_step, opened_at, entity_id) values (${A}, ${excId}, ${order}, 'finance', ${`${MARKER} reason`}, 'call them', now(), ${ent})`);
  const notif = String((await db.execute(sql`select id from notifications where org_id = ${A} limit 1`)).rows[0].id);
  const reqId = randomUUID(), noticeId = randomUUID();
  const payload = { orderId: order, amountMinor: 100, note: `${MARKER} write-off` };
  const payloadSha = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const now = new Date();
  const later = new Date(now.getTime() + 3_600_000);

  await raw(db, "approval_requests", sql`insert into approval_requests (org_id, id, subject_kind, subject_id, version, payload, payload_sha256, requested_by, status, closed_at)
    values (${A}, ${reqId}, 'merchant_writeoff', ${`WO-${order}@1`}, 1, ${JSON.stringify(payload)}::jsonb, ${payloadSha}, ${fin}, 'approved', now())`);
  await raw(db, "approval_decisions", sql`insert into approval_decisions (org_id, request_id, decided_by, decision, reason, payload_sha256) values (${A}, ${reqId}, ${approver}, 'approve', ${`${MARKER} looks right`}, ${payloadSha})`);
  await raw(db, "writeoff_proposals", sql`insert into writeoff_proposals (org_id, id, order_id, amount_minor, currency, difference_ids, prepared_by, approval_request_id, status) values (${A}, ${`WO-${order}`}, ${order}, 100, 'SGD', '[]'::jsonb, ${fin}, ${reqId}, 'approved')`);
  await raw(db, "investigation_notes", sql`insert into investigation_notes (org_id, target_kind, target_id, author_user_id, body) values (${A}, 'exception', ${excId}, ${ops}, ${`${MARKER} called the payer`})`);
  await raw(db, "recon_exception_notes", sql`insert into recon_exception_notes (org_id, exception_id, kind, body, author_user_id) values (${A}, ${excId}, 'note', ${`${MARKER} note`}, ${ops})`);
  await raw(db, "match_reviews", sql`insert into match_reviews (org_id, order_id, reviewer_user_id, verdict, note) values (${A}, ${order}, ${approver}, 'correct', ${`${MARKER} ok`})`);
  await raw(db, "payment_links", sql`insert into payment_links (org_id, link_id, order_id, kind, network, deposit_address, requested_minor, created_at) values (${A}, ${`LNK-${MARKER}`}, ${order}, 'full', 'ethereum', '0x00000000000000000000000000000000000fe11c', 100, now())`);
  await raw(db, "settlement_payment_lines", sql`insert into settlement_payment_lines (org_id, entity_id, provider_payment_id, batch_id, order_id, currency, gross_minor, fee_minor, net_minor, upload_id, source_row, uploaded_by)
    values (${A}, ${ent}, ${`PP-${MARKER}`}, ${batch}, ${order}, 'SGD', 100, 1, 99, ${upload}, 1, ${fin})`);
  await raw(db, "rule_change_notices", sql`insert into rule_change_notices (org_id, id, entity_id, order_id, run_id, rule_set_version, policy_revision, stored_decision, stored_rule_id, new_decision, new_rule_id, fingerprint)
    values (${A}, ${noticeId}, ${ent}, ${order}, ${live.runId}, 'v-test', 1, 'matched', 'R1', 'review', 'R2', ${hex()})`);
  await raw(db, "rule_change_acks", sql`insert into rule_change_acks (org_id, notice_id, acked_by, note) values (${A}, ${noticeId}, ${fin}, ${`${MARKER} seen`})`);
  await raw(db, "notification_reads", sql`insert into notification_reads (org_id, notification_id, user_id) values (${A}, ${notif}, ${fin})`);
  await raw(db, "jobs", sql`insert into jobs (org_id, entity_id, trigger, dedupe_key, run_as, run_after) values (${A}, ${ent}, 'schedule', 'day:2026-11-25', ${ops}, now())`);
  await raw(db, "reconciliation_schedules", sql`insert into reconciliation_schedules (org_id, entity_id, run_as) values (${A}, ${ent}, ${ops})`);
  await raw(db, "mapping_templates", sql`insert into mapping_templates (org_id, file_type, name, version, header_signature, mapping, created_by) values (${A}, 'orders_invoices', ${`${MARKER} orders`}, 1, ${hex()}, '{}'::jsonb, ${fin})`);
  await raw(db, "merchant_data_settings", sql`insert into merchant_data_settings (org_id, retention_days, updated_by) values (${A}, 30, ${admin})`);
  await raw(db, "membership_entity_scopes", sql`insert into membership_entity_scopes (org_id, user_id, entity_id, granted_by) values (${A}, ${viewer}, ${ent}, ${admin})`);
  await raw(db, "org_security_settings", sql`insert into org_security_settings (org_id, require_mfa_all, updated_by) values (${A}, true, ${admin})`);
  await raw(db, "org_setup_steps", sql`insert into org_setup_steps (org_id, step, done_by) values (${A}, 'entities', ${admin})`);
  await raw(db, "org_invitations", sql`insert into org_invitations (org_id, email, role, token_sha256, invited_by, invited_via, expires_at) values (${A}, ${`invitee-${MARKER.toLowerCase()}@live-a.example`}, 'viewer', ${hex()}, ${admin}, 'merchant_admin', now() + interval '1 day')`);
  await raw(db, "merchant_invitations", sql`insert into merchant_invitations (org_id, merchant_org_id, email, role, invited_by) values (${P}, ${A}, ${`viewer-${MARKER.toLowerCase()}@live-a.example`}, 'viewer', ${providerAdmin})`);
  await raw(db, "merchant_onboarding", sql`insert into merchant_onboarding (org_id, merchant_org_id, column_mapping, policy_defaults, updated_by) values (${P}, ${A}, '{}'::jsonb, '{}'::jsonb, ${providerAdmin})`);
  await raw(db, "provider_grants", sql`insert into provider_grants (merchant_org_id, provider_org_id, scope, granted_by) values (${A}, ${P}, 'aggregates', ${admin})`);
  await raw(db, "statement_imports", sql`insert into statement_imports (org_id, file_sha256, file_name, size_bytes, row_count, accepted_count, rejected_count, status, errors, imported_by)
    values (${A}, ${hex()}, ${`${MARKER} statement.csv`}, 10, 1, 1, 0, 'pending_confirmation', '[]'::jsonb, ${fin})`);
  await raw(db, "fiat_rates", sql`insert into fiat_rates (org_id, base_currency, quote_currency, rate, as_of, source_label, recorded_by) values (${A}, 'USD', 'SGD', 1.35, now(), 'fictional desk', ${`${MARKER} admin`})`);
  await raw(db, "fx_rates", sql`insert into fx_rates (org_id, pair, rate, source, observed_at, entity_id) values (${A}, 'USDC/SGD', 1.35, 'fictional', now(), ${ent})`);
  await raw(db, "address_facts", sql`insert into address_facts (org_id, network, address, fact) values (${A}, 'ethereum', '0x00000000000000000000000000000000000fe11c', 'registered_wallet')`);
  await raw(db, "chain_reads_unpartitioned", sql`insert into chain_reads_unpartitioned (org_id, entity_id, network, address, status, source, at) values (${A}, ${ent}, 'ethereum', '0x00000000000000000000000000000000000fe11c', 'ok', 'recorded', now())`);
  await raw(db, "accounting_exports", sql`insert into accounting_exports (org_id, id, ord, record) values (${A}, ${`EXP-${MARKER}`}, 0, ${JSON.stringify({ note: `${MARKER} export` })}::jsonb)`);
  await raw(db, "pilot_time_log", sql`insert into pilot_time_log (org_id, user_id, day, minutes, note) values (${A}, ${fin}, '2026-11-25', 30, ${`${MARKER} time`})`);
  await raw(db, "demo_feedback", sql`insert into demo_feedback (org_id, user_id, role, screen, route, note) values (${A}, ${fin}, 'finance', 'Inbox', '/control', ${`${MARKER} feedback`})`);
  // wave 2 integration: the tables of c1 (pickup), c2 (provider API), c3 (ledger), d1 (worker, period close), d2 (sign-off,
  // Auditor) and e2 (data keys), one row of A each, so the deletion is shown to leave none of them behind
  const jobId = String((await db.execute(sql`select id from jobs where org_id = ${A} limit 1`)).rows[0].id);
  await raw(db, "job_events", sql`insert into job_events (org_id, job_id, event, stage, attempt) values (${A}, ${jobId}, 'claimed', 'load', 1)`);
  const tpl = String((await db.execute(sql`select id from mapping_templates where org_id = ${A} limit 1`)).rows[0].id);
  const pickup = randomUUID();
  await raw(db, "upload_pickup_sources", sql`insert into upload_pickup_sources (org_id, id, kind, name, entity_id, file_type, location, run_as_user_id, created_by)
    values (${A}, ${pickup}, 'sftp', ${`${MARKER} sftp`}, ${ent}, 'orders_invoices', 'inbox/a', ${fin}, ${admin})`);
  await raw(db, "upload_pickup_items", sql`insert into upload_pickup_items (org_id, source_id, item_key, outcome, code) values (${A}, ${pickup}, ${hex()}, 'refused', 'FILE_TYPE_NOT_ALLOWED')`);
  const papi = randomUUID(), pull = randomUUID();
  await raw(db, "provider_api_connections", sql`insert into provider_api_connections (org_id, id, entity_id, provider_org_id, name, file_type, template_name, config, api_key_ref, created_by)
    values (${A}, ${papi}, ${ent}, ${P}, ${`${MARKER} provider API`}, 'provider_export', 'orders', '{}'::jsonb, 'CLEARLINE_PROVIDER_KEY_TEST', ${admin})`);
  await raw(db, "provider_pulls", sql`insert into provider_pulls (org_id, id, connection_id, entity_id, idempotency_key, status, template_id, template_version, started_by, finished_at)
    values (${A}, ${pull}, ${papi}, ${ent}, ${`pull-${MARKER}-1`}, 'succeeded', ${tpl}, 1, ${fin}, now())`);
  await raw(db, "provider_webhook_events", sql`insert into provider_webhook_events (org_id, connection_id, event_id, entity_id, body_sha256, signed_at, pull_id) values (${A}, ${papi}, 'evt-1', ${ent}, ${hex()}, now(), ${pull})`);
  const lconn = randomUUID();
  await raw(db, "ledger_connections", sql`insert into ledger_connections (org_id, id, provider, ledger_env, status, tenant_name, created_by) values (${A}, ${lconn}, 'xero', 'standin', 'needs_reconnect', ${`${MARKER} ledger`}, ${admin})`);
  await raw(db, "ledger_oauth_states", sql`insert into ledger_oauth_states (org_id, state_hash, browser_hash, provider, redirect_uri, created_by, expires_at) values (${A}, ${hex()}, ${hex()}, 'xero', 'http://127.0.0.1/cb', ${admin}, now() + interval '5 minutes')`);
  await raw(db, "ledger_account_maps", sql`insert into ledger_account_maps (org_id, connection_id, clearline_account, ledger_account_code, set_by) values (${A}, ${lconn}, 'bank', '090', ${fin})`);
  const jp = `JP-${MARKER}`;
  await raw(db, "merchant_journal_proposals", sql`insert into merchant_journal_proposals (org_id, id, entity_id, pattern, currency, lines, evidence_refs)
    values (${A}, ${jp}, ${ent}, 'provider_confirmation', 'SGD', '[]'::jsonb, ${JSON.stringify({ entryDate: "2026-11-05", memo: `${MARKER} journal` })}::jsonb)`);
  await raw(db, "ledger_journal_drafts", sql`insert into ledger_journal_drafts (org_id, connection_id, ledger_tenant_id, entity_id, proposal_id, idempotency_key, request_sha256, posting_rules_version, status, failure, created_by)
    values (${A}, ${lconn}, 'tenant-1', ${ent}, ${jp}, ${`cl-jd-${hex().slice(0, 40)}`}, ${hex()}, 'PR-000000000000', 'failed', 'rate limited', ${fin})`);
  await raw(db, "posting_rules_signatures", sql`insert into posting_rules_signatures (org_id, version, version_sha256, catalogue, signed_by_user_id, signed_by_name, mfa_verified_at)
    values (${A}, 'PR-000000000000', ${"0".repeat(64)}, '{}'::jsonb, ${admin}, ${aNames[5]}, now())`);
  await raw(db, "auditor_grants", sql`insert into auditor_grants (org_id, user_id, period_start, period_end, expires_at, granted_by) values (${A}, ${viewer}, '2026-11-01', '2026-11-30', now() + interval '30 days', ${`${MARKER} operator`})`);
  await raw(db, "period_locks", sql`insert into period_locks (org_id, entity_id, period, status, requested_by, reason, decided_by, decided_at) values (${A}, ${ent}, '2026-10', 'locked', ${fin}, ${`${MARKER} month end`}, ${admin}, now())`);
  await raw(db, "period_corrections", sql`insert into period_corrections (org_id, entity_id, order_id, corrects_period, correction_period, run_id, new_decision, new_rule_id, fingerprint)
    values (${A}, ${ent}, ${order}, '2026-10', '2026-11', ${live.runId}, 'review', 'R2', ${hex()})`);
  await raw(db, "org_data_keys", sql`insert into org_data_keys (org_id, purpose, version, kek_id, wrapped_key) values (${A}, 'data', 1, 'ctest', ${`wrapped-${hex()}`})`);
  // things held about A's members as people (outside A's own tables)
  await db.insert(t.sessions).values({ id: randomUUID(), token: hex(), userId: fin, expiresAt: later, createdAt: now, updatedAt: now, ipAddress: "198.51.100.7", userAgent: `${MARKER}-browser` });
  await db.insert(t.passkeys).values({ userId: fin, credentialId: `cred${MARKER}0123456789`, publicKeySpki: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE", alg: -7, name: `${MARKER} key` });
  await raw(db, "auth_tokens", sql`insert into auth_tokens (purpose, token_sha256, user_id, email, expires_at) values ('verify_email', ${hex()}, ${fin}, ${aEmails[0]}, now() + interval '1 hour')`);
  await db.insert(t.verifications).values({ id: randomUUID(), identifier: aEmails[0], value: fin, expiresAt: later });
  await db.insert(t.loginFailures).values({ emailSha256: createHash("sha256").update(aEmails[0]).digest("hex") });
  await db.insert(t.authRateEvents).values({ scope: "mfa_account", keyHash: keyHash("mfa_account", approver2) });
  await db.insert(t.emailOutbox).values({ toAddress: aEmails[1], subject: "Verify your e-mail (fictional)", textBody: `Hello ${aNames[1]}` });
  // a provider's own audit event about merchant A (it names A): kept only in minimal form after the deletion
  await db.insert(t.auditEvents).values({ orgId: P, source: "server", action: "merchant_invited", entityType: "organization", entityId: A, actorUserId: providerAdmin,
    summary: `Invited Merchant A (fictional) admin ${aEmails[5]}`, at: now, details: { invitations: 1, email: aEmails[5] } });
  void approver2; void viewer;
  return { s, live, aUsers, aEmails, aNames, bUpload };
}
