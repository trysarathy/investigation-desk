/**
 * v1 phase 2.2: the provider API adapter against PostgreSQL 16 and a LOCAL stand-in provider (fictional; no external
 * network). End to end: stand-in API → pull (SSRF-safe client, paging, retries) → upload mapped with the connection's
 * template version → validated → a person confirms → normalised into the same provider-record tables → reconciliation,
 * which decides exactly as the same records uploaded as a file do. Plus: secrets by reference only, the webhook
 * receiver (signature, timestamp, replay, idempotency, audit, uniform refusals), mapping versions, and the database
 * guards. Every value is fictional.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetAndSeed, PASSWORD } from "./harness";
import { liveCtx, seedLiveMerchants, useTestStorage, type LiveSeed } from "./upload-harness";
import * as sc from "./upload-scenarios";
import { STANDIN_KEY, standinConfig, standinGet, startStandIn, type StandIn } from "../clearline/provider-api/standin";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { createUser, grantMembership } from "../../src/server/admin";
import { AccessDenied, withTenant, type TenantContext } from "../../src/server/tenant";
import { RequestRefused } from "../../src/server/errors";
import { createUpload, decideUpload, setUploadMapping, validateUpload } from "../../src/server/uploads";
import { normaliseUpload } from "../../src/server/normalise";
import { saveMappingTemplate } from "../../src/server/mapping-templates";
import { ingestAdapterOutput } from "../../src/server/merchant";
import { loadReconcileInput } from "../../src/server/merchant-store";
import {
  createProviderConnection, disableProviderConnection, listProviderConnections, listProviderPulls, pullProviderConnection, receiveProviderWebhook,
} from "../../src/server/provider-api";
import { POST as webhookRoute } from "../../src/app/api/control/provider-webhooks/[connectionId]/route";
import { reconcile, type ReconcileResult } from "../../src/lib/clearline/merchant";
import { readTabular } from "../../src/lib/clearline/ingest";
import { signWebhook, SIGNATURE_HEADER } from "../../src/lib/clearline/provider-api";
import type { FileType, Mapping } from "../../src/lib/clearline/mapping";

const WEBHOOK_SECRET = "fictional-standin-webhook-secret-01";
const ENV = { CLEARLINE_PROVIDER_API: "1", CLEARLINE_PROVIDER_KEY_STANDIN: STANDIN_KEY, CLEARLINE_PROVIDER_WEBHOOK_STANDIN: WEBHOOK_SECRET };
let s: LiveSeed;
let standin: StandIn;
let n = 0;
const key = () => `pa-key-${++n}-${Date.now()}`;
const captured: string[] = [];
const sleepless = { get: standinGet, sleep: async () => undefined, random: () => 0.5 };
const pullDeps = { pull: sleepless };
let finB: TenantContext, approverB: TenantContext, adminB: TenantContext, finA: TenantContext;
let connectionId = "";

async function refused(p: Promise<unknown>, code: string) {
  try { await p; } catch (e) {
    if (e instanceof RequestRefused) { expect(e.code).toBe(code); return; }
    if (e instanceof AccessDenied) { expect(`ACCESS_${e.status}`).toBe(code); return; }
    if (e instanceof Error && e.name === "ZodError") { expect("ZOD").toBe(code); return; }
    throw e;
  }
  throw new Error(`expected refusal ${code}`);
}
async function dbRefuses(p: Promise<unknown>, re: RegExp) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}`);
}
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];

/** The AE scenario's provider export as API records (one JSON object per payment, exact text). */
const aeRecords = () => (JSON.parse(new TextDecoder().decode(sc.aeExportJson())) as { data: unknown[] }).data.map((r) => JSON.stringify(r));
async function headersOf(records: string[]) { return (await readTabular(new TextEncoder().encode(`[${records.join(",")}]`), { fileName: "x.json" })).headers; }

/** A file through the upload pipeline (as normalise-e2e does). */
async function filePipeline(uploader: TenantContext, confirmer: TenantContext, fileType: FileType, fileName: string, bytes: Uint8Array, mapping?: Mapping, bankAccountId?: string) {
  const up = await createUpload(uploader, { entityId: sc.AE.entityId, fileType, fileName, bytes, ...(bankAccountId ? { bankAccountId } : {}) }, key());
  if (mapping) await setUploadMapping(uploader, up.upload.id, { mapping }, key());
  const v = (await validateUpload(uploader, up.upload.id, key())).body;
  await decideUpload(confirmer, up.upload.id, { decision: "confirm", reason: "Checked against the source (fictional)", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return (await normaliseUpload(confirmer, up.upload.id, key())).body;
}
const confirmAndNormalise = async (uploadId: string) => {
  const v = (await validateUpload(finB, uploadId, key())).body;
  await decideUpload(finB, uploadId, { decision: "confirm", reason: "Pulled from the provider API (fictional); checked", contentSha256: v.contentSha256, rowsSha256: v.rowsSha256! }, key());
  return (await normaliseUpload(finB, uploadId, key())).body;
};
const shape = (r: ReconcileResult) => r.records.map((x) => ({ o: x.orderId, d: x.explanation.decision, r: x.explanation.ruleId, diffs: x.explanation.differences.map((d) => [d.type, d.amountMinor]), tied: x.bank.batchTied, v: x.bank.settlementVerified }));
const webhook = (id: string, body: string, signature: string | null) => webhookRoute(
  new Request(`http://localhost/api/control/provider-webhooks/${id}`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { [SIGNATURE_HEADER]: signature } : {}) }, body }),
  { params: Promise.resolve({ connectionId: id }) });
const now = () => Math.floor(Date.now() / 1000);

beforeAll(async () => {
  useTestStorage(true);
  Object.assign(process.env, ENV);
  await resetAndSeed();
  s = await seedLiveMerchants(ownerDb());
  const adminId = await createUser(ownerDb(), { email: "admin@live-b.example", name: "admin (fictional)", password: PASSWORD });
  await grantMembership(ownerDb(), { orgSlug: s.slugs.b, email: "admin@live-b.example", role: "admin" });
  s.users["admin@live-b.example"] = adminId;
  [finB, approverB, adminB, finA] = await Promise.all([liveCtx(s, "finance@live-b.example", "b"), liveCtx(s, "approver@live-b.example", "b"), liveCtx(s, "admin@live-b.example", "b"), liveCtx(s, "finance@live-a.example", "a")]);
  standin = await startStandIn(aeRecords());
  // chain data a chain reader observed (as in normalise-e2e); the API never makes a transfer final
  await ingestAdapterOutput(finB, sc.AE.entityId, { transfers: sc.observedTransfers(sc.AE) }, key(), { finalised: () => true });
  for (const m of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { captured.push(a.map(String).join(" ")); });
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const k of Object.keys(ENV)) delete process.env[k];
  await standin?.close();
  await closeDatabase(); await closeOwner();
});

describe("connections: Admin only, secrets by reference only", () => {
  it("is refused while the flag is off, for Finance, for a key reference outside the reserved namespace, and for an unsafe configuration", async () => {
    await saveMappingTemplate(finB, { fileType: "provider_export", name: "Stand-in payments", headers: await headersOf(aeRecords()), mapping: sc.AE_EXPORT_MAPPING }, key());
    const input = { entityId: sc.AE.entityId, name: "Stand-in payments API", fileType: "provider_export" as const, templateName: "Stand-in payments", config: standinConfig(standin), apiKeyRef: "CLEARLINE_PROVIDER_KEY_STANDIN", webhookSecretRef: "CLEARLINE_PROVIDER_WEBHOOK_STANDIN" };
    delete process.env.CLEARLINE_PROVIDER_API;
    await refused(createProviderConnection(adminB, input, key()), "PROVIDER_API_OFF");
    process.env.CLEARLINE_PROVIDER_API = "1";
    await refused(createProviderConnection(finB, input, key()), "ACCESS_403");
    await refused(createProviderConnection(adminB, { ...input, apiKeyRef: "DATABASE_URL" }, key()), "ZOD");
    await refused(createProviderConnection(adminB, { ...input, apiKeyRef: STANDIN_KEY }, key()), "ZOD");
    await refused(createProviderConnection(adminB, { ...input, config: { ...standinConfig(standin), baseUrl: `http://${standin.baseUrl.slice(7)}` } }, key()), "CONNECTION_CONFIG_INVALID");
    await refused(createProviderConnection(adminB, { ...input, config: { ...standinConfig(standin), allowedHosts: ["10.0.0.1"], baseUrl: "https://10.0.0.1" } }, key()), "CONNECTION_CONFIG_INVALID");
    await refused(createProviderConnection(adminB, { ...input, templateName: "No such template" }, key()), "NO_MAPPING_TEMPLATE");
    const c = await createProviderConnection(adminB, input, key());
    expect(c.status).toBe(201);
    connectionId = c.body.id;
    expect(c.body).toMatchObject({ apiKeyConfigured: true, webhookSecretConfigured: true, status: "active" });
    // the database row holds the references, never a secret value
    const [row] = await rows(sql`select row_to_json(c)::text as j from provider_api_connections c where id = ${connectionId}`);
    expect(String(row.j)).toContain("CLEARLINE_PROVIDER_KEY_STANDIN");
    expect(String(row.j)).not.toContain(STANDIN_KEY);
    expect(String(row.j)).not.toContain(WEBHOOK_SECRET);
    await refused(createProviderConnection(adminB, input, key()), "CONNECTION_NAME_TAKEN");
  });

  it("SECURITY: the database refuses a key-shaped reference, a connection by Finance, and any change but disabling", async () => {
    const base = { orgId: s.orgs.b, entityId: sc.AE.entityId, providerOrgId: s.orgs.providerB, fileType: "provider_export", templateName: "Stand-in payments", config: {} };
    await dbRefuses(withTenant({ userId: adminB.userId, orgId: s.orgs.b }, (tx) => tx.insert(t.providerApiConnections).values({ ...base, name: "x1", apiKeyRef: STANDIN_KEY, createdBy: adminB.userId })), /provider_api_connections_key_ref_chk/);
    await dbRefuses(withTenant({ userId: finB.userId, orgId: s.orgs.b }, (tx) => tx.insert(t.providerApiConnections).values({ ...base, name: "x2", apiKeyRef: "CLEARLINE_PROVIDER_KEY_X", createdBy: finB.userId })), /created by the signed-in merchant Admin/);
    await dbRefuses(withTenant({ userId: adminB.userId, orgId: s.orgs.b }, (tx) => tx.insert(t.providerApiConnections).values({ ...base, name: "x3", providerOrgId: s.orgs.providerA, apiKeyRef: "CLEARLINE_PROVIDER_KEY_X", createdBy: adminB.userId })), /its own provider only/);
    await dbRefuses(withTenant({ userId: adminB.userId, orgId: s.orgs.b }, (tx) => tx.update(t.providerApiConnections).set({ config: { baseUrl: "https://elsewhere.example" } }).where(eq(t.providerApiConnections.id, connectionId))), /permission denied/);
    await dbRefuses(withTenant({ userId: adminB.userId, orgId: s.orgs.b }, (tx) => tx.delete(t.providerApiConnections).where(eq(t.providerApiConnections.id, connectionId))), /permission denied/);
    // merchant A sees nothing of B's
    expect((await listProviderConnections(finA)).connections).toEqual([]);
    expect((await withTenant({ userId: finA.userId, orgId: s.orgs.b }, (tx) => tx.execute(sql`select count(*)::int as n from provider_api_connections`))).rows[0].n).toBe(0);
    await refused(pullProviderConnection(finA, connectionId, key(), pullDeps), "ACCESS_404");
  });
});

describe("pull → records → reconciliation (local end to end)", () => {
  let firstUploadId = "";
  it("only Finance or Payment Operations pull; a pull becomes a validated upload read with template version 1", async () => {
    await refused(pullProviderConnection(adminB, connectionId, key(), pullDeps), "ACCESS_403");
    await refused(pullProviderConnection(approverB, connectionId, key(), pullDeps), "ACCESS_403");
    standin.rateLimitNext = 1; standin.failNext = 1; // the pull rides out a 429 and a 503
    const k = key();
    const r = await pullProviderConnection(finB, connectionId, k, pullDeps);
    expect(r.status).toBe(201);
    expect(r.body.pull).toMatchObject({ status: "succeeded", records: 2, pages: 1, retries: 2, templateVersion: 1 });
    expect(r.body.upload).toMatchObject({ status: "validated", fileType: "provider_export", fileFormat: "json", templateVersion: 1, counts: { rows: 2, accepted: 2, rejected: 0, duplicate: 0 } });
    firstUploadId = r.body.upload!.id;
    // replay with the same key: the same pull, no second request to the provider
    const before = standin.requests.length;
    const again = await pullProviderConnection(finB, connectionId, k, pullDeps);
    expect(again).toMatchObject({ replayed: true, body: { pull: { id: r.body.pull.id } } });
    expect(standin.requests.length).toBe(before);
    // nothing reaches the matching tables until a person confirms
    expect((await rows(sql`select count(*)::int as n from provider_payment_records where org_id = ${s.orgs.b}`))[0].n).toBe(0);
  });

  it("confirmed and normalised, the API records reconcile exactly as the same export uploaded as a file", async () => {
    const norm = await confirmAndNormalise(firstUploadId);
    expect(norm).toMatchObject({ changed: true });
    const acct = (await ownerDb().select({ id: t.bankAccounts.id }).from(t.bankAccounts).where(eq(t.bankAccounts.orgId, s.orgs.b)))[0].id;
    await filePipeline(finB, finB, "settlement_report", "settlement.json", sc.aeSettlementJson(), sc.AE_SETTLEMENT_MAPPING);
    await filePipeline(finB, approverB, "bank_statement", "camt053.xml", sc.aeCamt053(), undefined, acct);
    const r = reconcile(await withTenant({ userId: finB.userId, orgId: s.orgs.b }, (tx) => loadReconcileInput(tx, s.orgs.b, sc.AE.entityId), { read: true }));
    expect(Object.fromEntries(r.records.map((x) => [x.orderId, `${x.explanation.decision} ${x.explanation.ruleId}`]))).toEqual({
      "AE-3001": "matched M5.grouping.matched_settlement_unlinked",
      "AE-3002": "matched M5.grouping.matched_settlement_unlinked",
    });
    // the same decisions as the scenario's values handed to the engine directly (the file route's reference)
    expect(shape(r)).toEqual(shape(reconcile(sc.engineInput(sc.AE))));
    // provenance: every provider record names the pull's upload and the template version it was read with
    const recs = await ownerDb().select().from(t.providerPaymentRecords).where(eq(t.providerPaymentRecords.orgId, s.orgs.b));
    expect(recs.map((x) => [x.providerPaymentId, x.uploadId, x.mappingTemplateVersion, x.uploadedBy])).toEqual([["P-AE-1", firstUploadId, 1, finB.userId], ["P-AE-2", firstUploadId, 1, finB.userId]]);
    // the API's transfer hash stays a provider CLAIM: unconfirmed, never final
    const claims = await ownerDb().select().from(t.chainTransfers).where(and(eq(t.chainTransfers.orgId, s.orgs.b), eq(t.chainTransfers.source, "provider_export")));
    for (const c of claims) expect(c).toMatchObject({ finalised: false, confirmations: 0, uploadId: firstUploadId });
  });

  it("the same records again are 'unchanged'; a template change is a new version that later records keep, earlier records keep theirs", async () => {
    const same = await pullProviderConnection(finB, connectionId, key(), pullDeps);
    expect(same.body).toMatchObject({ pull: { status: "unchanged", records: 2, uploadId: null }, upload: null });
    // a mapping change: version 2 (status "completed" also read as paid)
    const v2: Mapping = { ...sc.AE_EXPORT_MAPPING, columns: { ...sc.AE_EXPORT_MAPPING.columns, status: { header: "payment.status", statusValueMap: { paid: "paid", completed: "paid" } } } };
    const tpl = await saveMappingTemplate(finB, { fileType: "provider_export", name: "Stand-in payments", headers: await headersOf(aeRecords()), mapping: v2 }, key());
    expect(tpl.body.version).toBe(2);
    // the provider adds a payment (fictional; its transfer has not been read from the chain)
    const extra = JSON.parse(aeRecords()[1]) as Record<string, Record<string, unknown>>;
    extra.order = { ...extra.order, id: "AE-3003" }; extra.quote = { ...extra.quote, id: "Q-AE-3", address: sc.tron(33) }; extra.payment = { ...extra.payment, id: "P-AE-3", status: "completed", tx: { hash: sc.hash(77), index: 0 } };
    standin.records.push(JSON.stringify(extra));
    const r = await pullProviderConnection(finB, connectionId, key(), pullDeps);
    expect(r.body.pull).toMatchObject({ status: "succeeded", records: 3, pages: 2, templateVersion: 2 });
    expect(r.body.upload).toMatchObject({ templateVersion: 2, counts: { rows: 3, accepted: 1, duplicate: 2 } });
    expect(await confirmAndNormalise(r.body.upload!.id)).toMatchObject({ changed: true, counts: { conflict: 0 } });
    const recs = await ownerDb().select().from(t.providerPaymentRecords).where(eq(t.providerPaymentRecords.orgId, s.orgs.b));
    expect(Object.fromEntries(recs.map((x) => [x.providerPaymentId, x.mappingTemplateVersion]))).toEqual({ "P-AE-1": 1, "P-AE-2": 1, "P-AE-3": 2 });
    // the new payment's claim is not proof: nothing about it is matched without a chain read
    const res = reconcile(await withTenant({ userId: finB.userId, orgId: s.orgs.b }, (tx) => loadReconcileInput(tx, s.orgs.b, sc.AE.entityId), { read: true }));
    expect(res.records.find((x) => x.orderId === "AE-3003")?.explanation.decision).not.toMatch(/^matched/);
    // the next pull resumes from the last page's cursor
    const [lastPull] = await ownerDb().select().from(t.providerPulls).where(eq(t.providerPulls.id, r.body.pull.id));
    expect(lastPull.nextCursor).toBe("c_2");
  });

  it("failures store nothing and are recorded with a code: a refused key, a missing key, an address that is not public", async () => {
    const uploads = async () => (await rows(sql`select count(*)::int as n from uploads where org_id = ${s.orgs.b}`))[0].n;
    const before = await uploads();
    await refused(pullProviderConnection(finB, connectionId, key(), { ...pullDeps, env: { ...ENV, CLEARLINE_PROVIDER_KEY_STANDIN: "fictional-wrong-key-00000000" } }), "PROVIDER_PULL_FAILED");
    await refused(pullProviderConnection(finB, connectionId, key(), { ...pullDeps, env: { CLEARLINE_PROVIDER_API: "1" } }), "PROVIDER_KEY_UNAVAILABLE");
    await refused(pullProviderConnection(finB, connectionId, key(), { pull: { ...sleepless, http: { resolver: async () => [{ address: "169.254.169.254", family: 4 }] } } }), "PROVIDER_PULL_FAILED");
    expect(await uploads()).toBe(before);
    const failed = (await listProviderPulls(finB, connectionId)).pulls.filter((p) => p.status === "failed").map((p) => p.errorCode);
    expect(failed).toEqual(["http_address_refused", "key_unavailable", "unauthorised"]);
    // a finished pull never changes
    await dbRefuses(withTenant({ userId: finB.userId, orgId: s.orgs.b }, (tx) => tx.update(t.providerPulls).set({ status: "succeeded", errorCode: null }).where(eq(t.providerPulls.errorCode, "unauthorised"))), /finishes once/);
  });
});

describe("webhook receiver", () => {
  const event = (id: string) => JSON.stringify({ id, type: "payment.updated", data: { object: "payment", id: "P-AE-1" } });

  it("a signed delivery is recorded once (a pull is due); a replay is answered but not processed twice", async () => {
    const body = event("evt_fict_0001");
    const sig = signWebhook(WEBHOOK_SECRET, body, now());
    const first = await webhook(connectionId, body, sig);
    expect([first.status, await first.json()]).toEqual([200, { received: true }]);
    const replay = await webhook(connectionId, body, sig);
    expect([replay.status, await replay.json()]).toEqual([200, { received: true }]);
    const ev = await ownerDb().select().from(t.providerWebhookEvents).where(eq(t.providerWebhookEvents.connectionId, connectionId));
    expect(ev.map((e) => [e.eventId, e.pullId])).toEqual([["evt_fict_0001", null]]);
    expect(ev[0].bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await listProviderConnections(finB)).connections[0].pendingWebhookEvents).toBe(1);
    const audit = await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.b), eq(t.auditEvents.entityId, connectionId)));
    expect(audit.filter((a) => a.action.startsWith("provider_webhook")).map((a) => a.action)).toEqual(["provider_webhook_received", "provider_webhook_duplicate"]);
    // the body was never stored
    expect(JSON.stringify(audit)).not.toContain("payment.updated");
  });

  it("every failure gets the same answer and a refusal for a known connection is audited with its reason only", async () => {
    const body = event("evt_fict_0002");
    const answers = await Promise.all([
      webhook(connectionId, body, signWebhook("fictional-wrong-secret-000000000", body, now())),
      webhook(connectionId, body, signWebhook(WEBHOOK_SECRET, body, now() - 3600)),
      webhook(connectionId, body, null),
      webhook(connectionId, body.replace("0002", "0003"), signWebhook(WEBHOOK_SECRET, body, now())),
      webhook("00000000-0000-4000-8000-000000000000", body, signWebhook(WEBHOOK_SECRET, body, now())),
      webhook("not-a-uuid", body, signWebhook(WEBHOOK_SECRET, body, now())),
    ]);
    for (const a of answers) expect([a.status, await a.json()]).toEqual([400, { error: "Refused." }]);
    const reasons = (await ownerDb().select().from(t.auditEvents).where(and(eq(t.auditEvents.orgId, s.orgs.b), eq(t.auditEvents.action, "provider_webhook_refused"))))
      .map((a) => (a.details as { reason: string }).reason).sort();
    expect(reasons).toEqual(["bad_signature", "bad_signature", "malformed_signature", "stale_timestamp"]);
    expect((await ownerDb().select().from(t.providerWebhookEvents).where(eq(t.providerWebhookEvents.connectionId, connectionId))).length).toBe(1);
    // an oversized delivery is refused before it is read
    const big = await webhook(connectionId, `{"id":"evt_big","pad":"${"x".repeat(300_000)}"}`, null);
    expect(big.status).toBe(400);
  });

  it("the next pull answers the pending event once; the runtime role cannot write an event itself", async () => {
    const r = await pullProviderConnection(finB, connectionId, key(), pullDeps);
    expect(r.body.pull.eventsConsumed).toBe(1);
    const [ev] = await ownerDb().select().from(t.providerWebhookEvents).where(eq(t.providerWebhookEvents.eventId, "evt_fict_0001"));
    expect(ev.pullId).toBe(r.body.pull.id);
    expect((await pullProviderConnection(finB, connectionId, key(), pullDeps)).body.pull.eventsConsumed).toBe(0);
    await dbRefuses(withTenant({ userId: finB.userId, orgId: s.orgs.b }, (tx) => tx.insert(t.providerWebhookEvents).values({ orgId: s.orgs.b, connectionId, eventId: "evt_forged", entityId: sc.AE.entityId, bodySha256: "0".repeat(64), signedAt: new Date() })), /permission denied/);
    await dbRefuses(withTenant({ userId: finB.userId, orgId: s.orgs.b }, (tx) => tx.update(t.providerWebhookEvents).set({ pullId: null }).where(eq(t.providerWebhookEvents.eventId, "evt_fict_0001"))), /attached to one pull, once/);
  });

  it("a disabled connection refuses deliveries and pulls; the service refuses with the flag off", async () => {
    await refused(disableProviderConnection(finB, connectionId, key()), "ACCESS_403");
    await disableProviderConnection(adminB, connectionId, key());
    const body = event("evt_fict_0004");
    const a = await webhook(connectionId, body, signWebhook(WEBHOOK_SECRET, body, now()));
    expect(a.status).toBe(400);
    await refused(pullProviderConnection(finB, connectionId, key(), pullDeps), "CONNECTION_DISABLED");
    expect(await receiveProviderWebhook(connectionId, { signature: signWebhook(WEBHOOK_SECRET, body, now()), body: new TextEncoder().encode(body) }, { env: {} })).toEqual({ status: 400, body: { error: "Refused." } });
  });

  it("no log line carries the API key, the webhook secret or a record value", () => {
    const all = captured.join("\n");
    for (const secret of [STANDIN_KEY, WEBHOOK_SECRET, "P-AE-1", "AE-3001"]) expect(all).not.toContain(secret);
  });
});
