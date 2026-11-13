import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/clearline/test/v1/[...path]/route";
import { GET as LEGACY_GET } from "@/app/api/clearline/test/[action]/route";
import { getAdapter, sampleWorkspace, type Workspace } from "@/lib/clearline";

const H = { authorization: "Bearer cl_test_demo", "content-type": "application/json" };
const ctx = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });
const post = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://x/api/clearline/test/v1/" + p, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify(body) }), ctx(p));
const get = (p: string, headers: Record<string, string> = H) => GET(new NextRequest("http://x/api/clearline/test/v1/" + p, { headers }), ctx(p));

const input = { internalReference: "INV-API-1", amountMinor: 1_000_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-API-1", beneficiaryName: "API Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-11-20" };

describe("test-mode API v1", () => {
  it("health is public; everything else needs the example key", async () => {
    expect((await get("health", {})).status).toBe(200);
    expect((await get("workspace", {})).status).toBe(401);
    expect((await post("intents", {}, { authorization: "Bearer nope" })).status).toBe(401);
  });
  it("creates an intent statelessly with Idempotency-Key; replays and conflicts", async () => {
    const r1 = await post("intents", { input }, { "idempotency-key": "api-key-00001" });
    expect(r1.status).toBe(201);
    const j1 = await r1.json();
    expect(j1.persisted).toBe(false);
    expect(j1.data.status.execution).toBe("created");
    const ws: Workspace = j1.workspace;
    const r2 = await post("intents", { input, workspace: ws }, { "idempotency-key": "api-key-00001" });
    expect(r2.status).toBe(200);
    expect((await r2.json()).outcome).toBe("idempotent_replay");
    const r3 = await post("intents", { input: { ...input, amountMinor: 5 }, workspace: ws }, { "idempotency-key": "api-key-00001" });
    expect(r3.status).toBe(409);
    expect((await r3.json()).error.code).toBe("idempotency_conflict");
  });
  it("full flow: quotes → instruction → maker-checker → submit → simulate → statement", async () => {
    let j = await (await post("intents", { input }, { "idempotency-key": "api-key-00002" })).json();
    const id = j.data.id;
    j = await (await post(`intents/${id}/quotes`, { workspace: j.workspace })).json();
    const quote = j.data.find((q: { eligible: boolean; providerId: string }) => q.eligible && q.providerId === "prv_northline");
    j = await (await post("instructions", { workspace: j.workspace, intentId: id, quoteId: quote.id })).json();
    const ins = j.data.id;
    const selfApprove = await post(`instructions/${ins}/approve`, { workspace: j.workspace }, { "x-clearline-actor": "usr_maya" });
    expect(selfApprove.status).toBe(403);
    j = await (await post(`instructions/${ins}/approve`, { workspace: j.workspace })).json();
    j = await (await post(`instructions/${ins}/submit`, { workspace: j.workspace })).json();
    const ppid = j.data.providerPaymentId;
    j = await (await post("events/simulate", { workspace: j.workspace, intentId: id })).json();
    j = await (await post("events/simulate", { workspace: j.workspace, intentId: id })).json();
    j = await (await post("reconciliation/statement-lines", { workspace: j.workspace, line: { lineId: "API-L1", source: "bank_statement", accountRef: "BANK-SGD", direction: "debit", kind: "payment", amountMinor: 1_000_000, currency: "SGD", reference: ppid, counterparty: "Northline", valueDate: "2026-11-13" } })).json();
    expect(j.outcome).toBe("allocated");
    const inv = await (await post(`investigations/${id}`, { workspace: j.workspace })).json();
    expect(inv.data.status).toMatchObject({ settlement: "verified", reconciliation: "matched" });
  });
  it("webhook ingestion rejects bad signatures; verifier endpoint works", async () => {
    const ws = sampleWorkspace();
    const raw = JSON.stringify({ id: "X", type: "payout.completed", provider_payment_id: "NLPO-X", sequence: 9, occurred_at: ws.asOf });
    const sig = getAdapter("prv_northline")!.signWebhook(raw, Math.floor(Date.parse(ws.asOf) / 1000));
    const v = await (await post("webhooks/verify", { providerId: "prv_northline", rawBody: raw, signatureHeader: sig, at: ws.asOf })).json();
    expect(v.data.valid).toBe(true);
    const bad = await (await post("events/webhook", { providerId: "prv_northline", rawBody: raw, signatureHeader: sig.replace(/.$/, "0") === sig ? sig.replace(/.$/, "1") : sig.replace(/.$/, "0") })).json();
    expect(bad.outcome).toBe("rejected_signature");
  });
  it("read endpoints over the sample: exceptions, liquidity, funding, repayments", async () => {
    const ex = await (await get("exceptions")).json();
    expect(ex.data.length).toBeGreaterThan(0);
    const liq = await (await get("liquidity")).json();
    expect(liq.data.staleExcluded).toContain("liq_harbour_usd");
    const fund = await (await get("funding-advances")).json();
    expect(fund.data.rows[0].outstanding).toEqual({ amountMinor: 2_000_000, currency: "SGD" });
    const rep = await (await post("repayments", { line: { lineId: "R-X", source: "bank_statement", accountRef: "BANK-SGD", direction: "credit", kind: "payment", amountMinor: 2_000_000, currency: "SGD", reference: "", counterparty: "SEABRIGHT", valueDate: "2026-11-13" } })).json();
    expect(rep.data.rows[0].outstanding.amountMinor).toBe(2_000_000);
    expect((await get("nope")).status).toBe(404);
  });
  it("legacy unversioned endpoints are retired with 410 (review M10)", async () => {
    const r = await LEGACY_GET();
    expect(r.status).toBe(410);
    expect((await r.json()).error.replacement).toBe("/api/clearline/test/v1");
  });
  it("malformed input and invalid clocks never produce a 500 (review M6/M8)", async () => {
    expect((await post("liquidity", { at: "garbage" })).status).toBe(400);
    expect((await post("actions", { action: { type: "advance_clock", to: "2026-11-14T00:00:00Z" }, at: "not-a-time" })).status).toBe(400);
    const damaged = JSON.parse(JSON.stringify(sampleWorkspace()));
    damaged.intents = [{}];
    const r = await post("actions", { workspace: damaged, action: { type: "advance_clock", to: "2026-11-14T00:00:00Z" } });
    expect(r.status).toBe(422);
    expect((await r.json()).error.code).toBe("invalid_field");
    const weird = await post("events/webhook", { providerId: "prv_northline", rawBody: { not: "a string" }, signatureHeader: 5 });
    expect(weird.status).toBeLessThan(500);
    const chain = await post("actions", { action: { type: "ingest_chain_observation", observation: { intentId: 5 } } });
    expect(chain.status).toBe(422);
    const nullAction = await post("actions", { action: null });
    expect(nullAction.status).toBe(422);
  });
});
