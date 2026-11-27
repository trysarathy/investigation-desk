import "server-only";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  PullConfig, PullError, pullRecords, recordsFile, resolveSecret, verifyWebhook, API_KEY_REF_RE, WEBHOOK_SECRET_REF_RE,
  type PullDeps, type PullResult,
} from "@/lib/clearline/provider-api";
import type { Tx } from "./db/client";
import { database } from "./db/client";
import * as t from "./db/schema";
import { can, type Permission } from "./authz";
import { IdempotencyKey, idempotent, serverAudit } from "./control";
import { AccessDenied, assertRuntimeRole, inEntityScope, requireEntity, type TenantContext, withTenant } from "./tenant";
import { RequestRefused } from "./errors";
import { dataModeOf } from "./mapping-templates";
import { createUpload, setUploadMapping, validateUpload, type UploadSummary } from "./uploads";
import type { UploadStorage } from "./storage";

/**
 * v1 phase 2.2: the provider API adapter. A merchant Admin connects the merchant's OWN provider's REST API (the API key
 * stays a server secret, named by reference); Finance or Payment Operations pull from it. A pull is the same flow as
 * a file a person uploads, like the ledger pull (src/server/ledger.ts): the records become a JSON upload (stored,
 * hashed, retained), mapped with the connection's mapping template (its current VERSION, recorded on the pull, the
 * upload and every row normalised from it) and validated. A person then confirms the upload and it is normalised into
 * the same provider-record tables the matching rules read. Nothing here changes a matching rule or confirms anything.
 *
 * A provider webhook is a signal, never data: once its signature, timestamp and event id are checked, the event is
 * recorded (once per event id) as "a pull is due", and the next pull picks the change up from the API itself. A
 * delivery's body is never stored, logged or trusted as a record.
 *
 * Off unless CLEARLINE_PROVIDER_API=1. Audit rows carry ids and counts only.
 */

export const PROVIDER_API_FLAG = "CLEARLINE_PROVIDER_API";
export const providerApiEnabled = (env: Readonly<Record<string, string | undefined>> = process.env) => env[PROVIDER_API_FLAG] === "1";
/** A pull left running this long (a process that died mid-pull) no longer blocks the next one. */
export const STALE_PULL_MINUTES = 15;

function require(ctx: TenantContext, p: Permission) {
  if (!can(ctx.role, p)) throw new AccessDenied(403, `Your role (${ctx.role}) does not allow this.`);
}
const tenantTx = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn);
const tenantRead = <T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) => withTenant({ userId: ctx.userId, orgId: ctx.orgId }, fn, { read: true });
const off = () => new RequestRefused(409, "PROVIDER_API_OFF", `Reading from a provider's API is off (${PROVIDER_API_FLAG} is not set). Upload the provider's export instead.`);
const ConnectionId = z.uuid();
const dbCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;

async function requireLive(tx: Tx, orgId: string) {
  if ((await dataModeOf(tx, orgId)).dataMode !== "live") throw new RequestRefused(409, "SAMPLE_ORGANISATION", "This organisation holds sample data; connect a provider API to your live organisation.");
}

// ---------------------------------------------------------------------------------------------
// Connections (merchant Admin)
// ---------------------------------------------------------------------------------------------

export const ConnectionInput = z.object({
  entityId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  fileType: z.enum(["provider_export", "settlement_report", "settlement_payments"]),
  /** The mapping template (by name) every pull applies, in its current version at the time of the pull. */
  templateName: z.string().trim().min(1).max(120),
  config: z.unknown(),
  apiKeyRef: z.string().regex(API_KEY_REF_RE, "The API key is named by a server secret CLEARLINE_PROVIDER_KEY_<NAME>, never entered here."),
  webhookSecretRef: z.string().regex(WEBHOOK_SECRET_REF_RE, "The webhook secret is named by a server secret CLEARLINE_PROVIDER_WEBHOOK_<NAME>.").optional(),
}).strict();

export interface ConnectionView {
  id: string; entityId: string; name: string; fileType: string; templateName: string; status: string; config: PullConfig;
  apiKeyRef: string; webhookSecretRef: string | null;
  /** Whether the server holds the named secrets now (never their values). */
  apiKeyConfigured: boolean; webhookSecretConfigured: boolean | null;
  pendingWebhookEvents: number; createdBy: string; createdAt: string; disabledAt: string | null;
}
const connectionView = (r: typeof t.providerApiConnections.$inferSelect, pending: number): ConnectionView => ({
  id: r.id, entityId: r.entityId, name: r.name, fileType: r.fileType, templateName: r.templateName, status: r.status, config: r.config as PullConfig,
  apiKeyRef: r.apiKeyRef, webhookSecretRef: r.webhookSecretRef, apiKeyConfigured: resolveSecret("api_key", r.apiKeyRef) !== null,
  webhookSecretConfigured: r.webhookSecretRef ? resolveSecret("webhook_secret", r.webhookSecretRef) !== null : null,
  pendingWebhookEvents: pending, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), disabledAt: r.disabledAt?.toISOString() ?? null,
});

async function latestTemplate(tx: Tx, orgId: string, fileType: string, name: string) {
  const [tpl] = await tx.select().from(t.mappingTemplates).where(and(eq(t.mappingTemplates.orgId, orgId), eq(t.mappingTemplates.fileType, fileType), eq(t.mappingTemplates.name, name)))
    .orderBy(desc(t.mappingTemplates.version)).limit(1);
  if (!tpl) return undefined;
  const ok = (await tx.execute(sql`select mapping_template_usable(${orgId}, ${tpl.id}) as ok`)).rows[0]?.ok === true;
  return ok ? tpl : undefined;
}

/** Connect the merchant's own provider's API for one entity. The configuration is checked (https, allowlist, paging). */
export async function createProviderConnection(ctx: TenantContext, input: z.input<typeof ConnectionInput>, idempotencyKey: string) {
  require(ctx, "manage_provider_api");
  if (!providerApiEnabled()) throw off();
  const key = IdempotencyKey.parse(idempotencyKey);
  const v = ConnectionInput.parse(input);
  requireEntity(ctx, v.entityId);
  const parsed = PullConfig.safeParse(v.config);
  if (!parsed.success) throw new RequestRefused(422, "CONNECTION_CONFIG_INVALID", parsed.error.issues.map((i) => i.message).join(" "));
  const config = parsed.data;
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "provider_connection_create", ...v, config }, async () => {
    await requireLive(tx, ctx.orgId);
    const [org] = await tx.select({ providerOrgId: t.organizations.providerOrgId }).from(t.organizations).where(eq(t.organizations.id, ctx.orgId));
    if (!org?.providerOrgId) throw new RequestRefused(409, "NO_PROVIDER", "This merchant has no payment provider to connect.");
    const [ent] = await tx.select({ id: t.merchantEntities.id }).from(t.merchantEntities).where(and(eq(t.merchantEntities.orgId, ctx.orgId), eq(t.merchantEntities.id, v.entityId)));
    if (!ent) throw new AccessDenied(404, "Not found.");
    if (!(await latestTemplate(tx, ctx.orgId, v.fileType, v.templateName))) {
      throw new RequestRefused(409, "NO_MAPPING_TEMPLATE", "Save a mapping template with this name for this file type first (Finance or Payment Operations).");
    }
    const [dup] = await tx.select({ id: t.providerApiConnections.id }).from(t.providerApiConnections).where(and(eq(t.providerApiConnections.orgId, ctx.orgId), eq(t.providerApiConnections.name, v.name)));
    if (dup) throw new RequestRefused(409, "CONNECTION_NAME_TAKEN", "A provider API connection with this name already exists.");
    const [row] = await tx.insert(t.providerApiConnections).values({
      orgId: ctx.orgId, entityId: v.entityId, providerOrgId: org.providerOrgId, name: v.name, fileType: v.fileType, templateName: v.templateName, config,
      apiKeyRef: v.apiKeyRef, webhookSecretRef: v.webhookSecretRef ?? null, createdBy: ctx.userId,
    }).returning();
    await serverAudit(tx, ctx, "provider_connection_created", "provider_api_connection", row.id, `Provider API connection created for ${v.entityId} (${v.fileType}; ${config.allowedHosts.length} allowed host(s); webhook ${v.webhookSecretRef ? "on" : "off"})`,
      { connectionId: row.id, entityId: v.entityId, fileType: v.fileType, allowedHosts: config.allowedHosts.length, webhook: !!v.webhookSecretRef });
    return { status: 201, body: connectionView(row, 0) };
  }));
}

/** Disable a connection (once; it is never re-enabled: a change is a new connection). */
export async function disableProviderConnection(ctx: TenantContext, connectionId: string, idempotencyKey: string) {
  require(ctx, "manage_provider_api");
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!ConnectionId.safeParse(connectionId).success) throw new AccessDenied(404, "Not found.");
  return tenantTx(ctx, (tx) => idempotent(tx, ctx, key, { op: "provider_connection_disable", connectionId }, async () => {
    const [c] = await tx.select().from(t.providerApiConnections).where(and(eq(t.providerApiConnections.orgId, ctx.orgId), eq(t.providerApiConnections.id, connectionId))).for("update");
    if (!c) throw new AccessDenied(404, "Not found.");
    requireEntity(ctx, c.entityId);
    if (c.status !== "active") throw new RequestRefused(409, "CONNECTION_DISABLED", "This connection is already disabled.");
    const [row] = await tx.update(t.providerApiConnections).set({ status: "disabled", disabledBy: ctx.userId, disabledAt: new Date() })
      .where(and(eq(t.providerApiConnections.orgId, ctx.orgId), eq(t.providerApiConnections.id, connectionId))).returning();
    await serverAudit(tx, ctx, "provider_connection_disabled", "provider_api_connection", connectionId, "Provider API connection disabled", { connectionId });
    return { status: 200, body: connectionView(row, 0) };
  }));
}

/** The merchant's connections in the member's entity scope, with their pending webhook events. */
export async function listProviderConnections(ctx: TenantContext) {
  require(ctx, "read");
  return tenantRead(ctx, async (tx) => {
    const rows = (await tx.select().from(t.providerApiConnections).where(eq(t.providerApiConnections.orgId, ctx.orgId)).orderBy(t.providerApiConnections.name)).filter((c) => inEntityScope(ctx, c.entityId));
    const pending = rows.length ? await tx.select({ id: t.providerWebhookEvents.connectionId, n: sql<number>`count(*)::int` }).from(t.providerWebhookEvents)
      .where(and(eq(t.providerWebhookEvents.orgId, ctx.orgId), isNull(t.providerWebhookEvents.pullId), inArray(t.providerWebhookEvents.connectionId, rows.map((r) => r.id))))
      .groupBy(t.providerWebhookEvents.connectionId) : [];
    return { enabled: providerApiEnabled(), connections: rows.map((r) => connectionView(r, pending.find((p) => p.id === r.id)?.n ?? 0)) };
  });
}

// ---------------------------------------------------------------------------------------------
// Pulls (Finance or Payment Operations)
// ---------------------------------------------------------------------------------------------

export interface PullView {
  id: string; connectionId: string; entityId: string; status: string; templateId: string; templateVersion: number; pages: number; records: number;
  requests: number; retries: number; eventsConsumed: number; uploadId: string | null; errorCode: string | null; startedBy: string; startedAt: string; finishedAt: string | null;
}
const pullView = (p: typeof t.providerPulls.$inferSelect): PullView => ({
  id: p.id, connectionId: p.connectionId, entityId: p.entityId, status: p.status, templateId: p.templateId, templateVersion: p.templateVersion, pages: p.pages, records: p.records,
  requests: p.requests, retries: p.retries, eventsConsumed: p.eventsConsumed, uploadId: p.uploadId, errorCode: p.errorCode, startedBy: p.startedBy,
  startedAt: p.startedAt.toISOString(), finishedAt: p.finishedAt?.toISOString() ?? null,
});

export interface ProviderPullDeps {
  pull?: PullDeps;
  env?: Readonly<Record<string, string | undefined>>;
  storage?: UploadStorage;
  now?: () => Date;
}

type Finish = { status: "succeeded" | "unchanged" | "failed"; errorCode?: string; result?: PullResult; uploadId?: string | null };

async function finishPull(ctx: TenantContext, pullId: string, connectionId: string, f: Finish) {
  return tenantTx(ctx, async (tx) => {
    let consumed = 0;
    if (f.status !== "failed") {
      // every webhook event pending now is answered by this pull (attached once; never processed twice)
      const ev = await tx.update(t.providerWebhookEvents).set({ pullId })
        .where(and(eq(t.providerWebhookEvents.orgId, ctx.orgId), eq(t.providerWebhookEvents.connectionId, connectionId), isNull(t.providerWebhookEvents.pullId))).returning({ e: t.providerWebhookEvents.eventId });
      consumed = ev.length;
    }
    const r = f.result;
    const [row] = await tx.update(t.providerPulls).set({
      status: f.status, errorCode: f.errorCode ?? null, finishedAt: new Date(), uploadId: f.uploadId ?? null, eventsConsumed: consumed,
      ...(r ? { pages: r.pages, records: r.records.length, requests: r.requests, retries: r.retries, nextCursor: r.nextCursor } : {}),
    }).where(and(eq(t.providerPulls.orgId, ctx.orgId), eq(t.providerPulls.id, pullId))).returning();
    await serverAudit(tx, ctx, "provider_pull_finished", "provider_pull", pullId,
      `Provider API pull ${f.status}${f.errorCode ? ` (${f.errorCode})` : ""}: ${row.pages} page(s), ${row.records} record(s), ${row.retries} retr${row.retries === 1 ? "y" : "ies"}, ${consumed} webhook event(s) answered`,
      { pullId, connectionId, status: f.status, errorCode: f.errorCode ?? null, pages: row.pages, records: row.records, requests: row.requests, retries: row.retries, eventsConsumed: consumed, uploadId: row.uploadId });
    return row;
  });
}

const PULL_MESSAGE: Record<string, string> = {
  key_unavailable: "The server does not hold this connection's API key. Nothing was read.",
  unauthorised: "The provider refused the API key. Nothing was stored.",
  rate_limited: "The provider kept rate-limiting the requests. Nothing was stored; try again later.",
  provider_error: "The provider's API kept failing. Nothing was stored; try again later.",
};

/**
 * Pull the connection's records from the provider's API into a new upload (mapped with the template's current version
 * and validated), for a person to confirm. Records already imported are reported as duplicates by validation, and
 * normalising them again changes nothing. Idempotent per key.
 */
export async function pullProviderConnection(ctx: TenantContext, connectionId: string, idempotencyKey: string, deps: ProviderPullDeps = {}) {
  require(ctx, "merchant_upload");
  const key = IdempotencyKey.parse(idempotencyKey);
  if (!providerApiEnabled(deps.env)) throw off();
  if (!ConnectionId.safeParse(connectionId).success) throw new AccessDenied(404, "Not found.");
  const now = deps.now ?? (() => new Date());

  const start = await tenantTx(ctx, async (tx) => {
    await requireLive(tx, ctx.orgId);
    const [conn] = await tx.select().from(t.providerApiConnections).where(and(eq(t.providerApiConnections.orgId, ctx.orgId), eq(t.providerApiConnections.id, connectionId)));
    if (!conn) throw new AccessDenied(404, "Not found.");
    requireEntity(ctx, conn.entityId);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${ctx.orgId}|provider-pull|${connectionId}`}))`);
    const [prev] = await tx.select().from(t.providerPulls).where(and(eq(t.providerPulls.orgId, ctx.orgId), eq(t.providerPulls.idempotencyKey, key)));
    if (prev) {
      if (prev.connectionId !== connectionId || prev.startedBy !== ctx.userId) throw new RequestRefused(409, "IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request.");
      return { replay: prev } as const;
    }
    if (conn.status !== "active") throw new RequestRefused(409, "CONNECTION_DISABLED", "This provider API connection is disabled.");
    const stale = await tx.update(t.providerPulls).set({ status: "failed", errorCode: "abandoned", finishedAt: now() })
      .where(and(eq(t.providerPulls.orgId, ctx.orgId), eq(t.providerPulls.connectionId, connectionId), eq(t.providerPulls.status, "running"),
        lt(t.providerPulls.startedAt, new Date(now().getTime() - STALE_PULL_MINUTES * 60_000)))).returning({ id: t.providerPulls.id });
    for (const s of stale) await serverAudit(tx, ctx, "provider_pull_finished", "provider_pull", s.id, "Provider API pull failed (abandoned: still running after the time limit)", { pullId: s.id, connectionId, status: "failed", errorCode: "abandoned" });
    const [running] = await tx.select({ id: t.providerPulls.id }).from(t.providerPulls)
      .where(and(eq(t.providerPulls.orgId, ctx.orgId), eq(t.providerPulls.connectionId, connectionId), eq(t.providerPulls.status, "running")));
    if (running) throw new RequestRefused(409, "PULL_RUNNING", "A pull from this connection is already running.");
    const tpl = await latestTemplate(tx, ctx.orgId, conn.fileType, conn.templateName);
    if (!tpl) throw new RequestRefused(409, "NO_MAPPING_TEMPLATE", "This connection's mapping template no longer exists or no longer reads this merchant's provider.");
    // resume from where the last completed pull ended (the last page is read again: never skip a record)
    const [last] = await tx.select({ c: t.providerPulls.nextCursor }).from(t.providerPulls)
      .where(and(eq(t.providerPulls.orgId, ctx.orgId), eq(t.providerPulls.connectionId, connectionId), inArray(t.providerPulls.status, ["succeeded", "unchanged"])))
      .orderBy(desc(t.providerPulls.startedAt)).limit(1);
    const [pull] = await tx.insert(t.providerPulls).values({
      orgId: ctx.orgId, connectionId, entityId: conn.entityId, idempotencyKey: key, templateId: tpl.id, templateVersion: tpl.version, startCursor: last?.c ?? null, startedBy: ctx.userId,
    }).returning();
    await serverAudit(tx, ctx, "provider_pull_started", "provider_pull", pull.id, `Provider API pull started (mapping template version ${tpl.version})`,
      { pullId: pull.id, connectionId, templateId: tpl.id, templateVersion: tpl.version, resumed: last?.c != null });
    return { conn, pull } as const;
  }).catch((e) => {
    if (dbCode(e) === "23505") throw new RequestRefused(409, "PULL_RUNNING", "A pull from this connection is already running.");
    throw e;
  });

  const label = (await tenantRead(ctx, (tx) => dataModeOf(tx, ctx.orgId))).label;
  if ("replay" in start) return { status: 200, replayed: true, body: { label, pull: pullView(start.replay!), upload: null as UploadSummary | null } };
  const { conn, pull } = start;
  const fail = async (errorCode: string, result?: PullResult, apiCode = "PROVIDER_PULL_FAILED") => {
    await finishPull(ctx, pull.id, connectionId, { status: "failed", errorCode, result });
    throw new RequestRefused(409, apiCode, PULL_MESSAGE[errorCode] ?? `The provider API pull failed (${errorCode}). Nothing was stored.`);
  };

  const apiKey = resolveSecret("api_key", conn.apiKeyRef, deps.env ?? process.env);
  if (!apiKey) return fail("key_unavailable", undefined, "PROVIDER_KEY_UNAVAILABLE");
  let result: PullResult;
  try {
    result = await pullRecords(PullConfig.parse(conn.config), apiKey, pull.startCursor, deps.pull);
  } catch (e) {
    if (e instanceof PullError) return fail(e.code);
    await finishPull(ctx, pull.id, connectionId, { status: "failed", errorCode: "internal" }).catch(() => undefined);
    throw e;
  }
  if (!result.records.length) {
    const row = await finishPull(ctx, pull.id, connectionId, { status: "unchanged", result });
    return { status: 200, replayed: false, body: { label, pull: pullView(row), upload: null as UploadSummary | null } };
  }

  const day = now().toISOString().slice(0, 10);
  const k = key.slice(0, 100);
  let uploadId: string | undefined;
  try {
    const up = await createUpload(ctx, { entityId: conn.entityId, fileType: conn.fileType as "provider_export", fileName: `${conn.name} API pull ${day}.json`, bytes: recordsFile(result.records) }, `${k}:store`, deps.storage);
    uploadId = up.upload.id;
    await setUploadMapping(ctx, uploadId, { templateId: pull.templateId }, `${k}:map`, deps.storage);
    const validated = await validateUpload(ctx, uploadId, `${k}:validate`, deps.storage);
    const row = await finishPull(ctx, pull.id, connectionId, { status: "succeeded", result, uploadId });
    return { status: 201, replayed: false, body: { label, pull: pullView(row), upload: validated.body as UploadSummary | null } };
  } catch (e) {
    if (e instanceof RequestRefused && e.code === "DUPLICATE_UPLOAD") {
      // exactly these records were pulled before: nothing new to import
      const row = await finishPull(ctx, pull.id, connectionId, { status: "unchanged", result });
      return { status: 200, replayed: false, body: { label, pull: pullView(row), upload: null as UploadSummary | null } };
    }
    const code = e instanceof RequestRefused ? e.code.toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 60) : "internal";
    await finishPull(ctx, pull.id, connectionId, { status: "failed", errorCode: code, result }).catch(() => undefined);
    if (e instanceof RequestRefused && uploadId) {
      throw new RequestRefused(e.status, e.code, `${e.message} The pulled records are kept as upload ${uploadId} (not mapped); map it by hand or delete it.`);
    }
    throw e;
  }
}

/** The pulls of one connection, newest first. */
export async function listProviderPulls(ctx: TenantContext, connectionId: string) {
  require(ctx, "read");
  if (!ConnectionId.safeParse(connectionId).success) throw new AccessDenied(404, "Not found.");
  return tenantRead(ctx, async (tx) => {
    const [c] = await tx.select({ entityId: t.providerApiConnections.entityId }).from(t.providerApiConnections).where(and(eq(t.providerApiConnections.orgId, ctx.orgId), eq(t.providerApiConnections.id, connectionId)));
    if (!c) throw new AccessDenied(404, "Not found.");
    requireEntity(ctx, c.entityId);
    const rows = await tx.select().from(t.providerPulls).where(and(eq(t.providerPulls.orgId, ctx.orgId), eq(t.providerPulls.connectionId, connectionId))).orderBy(desc(t.providerPulls.startedAt)).limit(200);
    return { pulls: rows.map(pullView) };
  });
}

// ---------------------------------------------------------------------------------------------
// Webhook receiver (no session: the delivery proves itself with its signature)
// ---------------------------------------------------------------------------------------------

export type WebhookAnswer = { status: 200; body: { received: true } } | { status: 400; body: { error: "Refused." } };
const REFUSED: WebhookAnswer = { status: 400, body: { error: "Refused." } };
const RECEIVED: WebhookAnswer = { status: 200, body: { received: true } };

/**
 * Verify and record one webhook delivery. Every failure gets the same answer (no detail); a refusal for a known
 * connection is audited with its reason code. A second delivery of the same event id is answered "received" and is
 * not processed again.
 */
export async function receiveProviderWebhook(connectionId: string, delivery: { signature: string | null; body: Uint8Array }, deps: { env?: Readonly<Record<string, string | undefined>>; nowSeconds?: number } = {}): Promise<WebhookAnswer> {
  if (!providerApiEnabled(deps.env) || !ConnectionId.safeParse(connectionId).success) return REFUSED;
  await assertRuntimeRole();
  const db = database();
  const [target] = (await db.execute(sql`select org_id, webhook_secret_ref from provider_webhook_target(${connectionId})`)).rows as { org_id: string; webhook_secret_ref: string }[];
  if (!target) return REFUSED;
  const verdict = verifyWebhook({
    secret: resolveSecret("webhook_secret", target.webhook_secret_ref, deps.env ?? process.env), body: delivery.body, signature: delivery.signature,
    nowSeconds: deps.nowSeconds ?? Math.floor(Date.now() / 1000),
  });
  if (!verdict.ok) {
    await db.execute(sql`select provider_webhook_refused(${connectionId}, ${verdict.reason})`);
    return REFUSED;
  }
  const [r] = (await db.execute(sql`select provider_webhook_record(${connectionId}, ${verdict.eventId}, ${verdict.bodySha256}, ${verdict.signedAt.toISOString()}::timestamptz) as outcome`)).rows as { outcome: string }[];
  return r?.outcome === "accepted" || r?.outcome === "duplicate" ? RECEIVED : REFUSED;
}
