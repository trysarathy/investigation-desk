/**
 * QA + security release review, 13 Nov 2026: test-mode API (legacy + v1) and preview middleware.
 * "DEFECT …" tests assert the correct behaviour and FAIL until fixed; "DOCUMENTED …" tests pin a
 * design property of the stateless sandbox that the release notes must state; the rest are resisted attacks.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/clearline/test/v1/[...path]/route";
import { POST as LEGACY_POST } from "@/app/api/clearline/test/[action]/route";
import { middleware, config as mwConfig } from "@/middleware";
import { emptyWorkspace, sampleWorkspace, type Workspace } from "@/lib/clearline";

const H = { authorization: "Bearer cl_test_demo", "content-type": "application/json" };
const ctx = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });
const postRaw = (p: string, body: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://x/api/clearline/test/v1/" + p, { method: "POST", headers: { ...H, ...headers }, body }), ctx(p));
const post = (p: string, body: unknown, headers: Record<string, string> = {}) => postRaw(p, JSON.stringify(body), headers);
const legacy = (action: string, body: unknown) =>
  LEGACY_POST(new NextRequest("http://x/api/clearline/test/" + action, { method: "POST", headers: H, body: JSON.stringify(body) }), { params: Promise.resolve({ action }) });

const input = { internalReference: "INV-QA-API", amountMinor: 1_000_000, sourceCurrency: "SGD", destinationCurrency: "PHP", purpose: "Supplier invoice", beneficiaryRef: "BEN-QA-1", beneficiaryName: "QA Supplier (fictional)", destinationCountry: "PH", requestedExecutionDate: "2026-11-20" };

async function toInstruction(ws?: Workspace, headers: Record<string, string> = {}) {
  let j = await (await post("intents", { input, ...(ws ? { workspace: ws } : {}) }, { "idempotency-key": "qa-api-00001", ...headers })).json();
  const id = j.data.id;
  j = await (await post(`intents/${id}/quotes`, { workspace: j.workspace }, headers)).json();
  const q = j.data.find((x: { eligible: boolean }) => x.eligible);
  j = await (await post("instructions", { workspace: j.workspace, intentId: id, quoteId: q.id }, headers)).json();
  return { ws: j.workspace as Workspace, ins: j.data.id as string, id };
}

describe("v1 API: authentication, parsing and limits", () => {
  it("requires the example key and JSON", async () => {
    expect((await post("intents", { input }, { authorization: "" })).status).toBe(401);
    expect((await postRaw("intents", "{}", { "content-type": "text/plain" })).status).toBe(422);
    expect((await postRaw("intents", "{not json")).status).toBe(422);
    expect((await postRaw("intents", "[1,2]")).status).toBe(422);
  });
  it("refuses bodies over 2 MB", async () => {
    const r = await postRaw("intents", JSON.stringify({ pad: "x".repeat(2_000_100) }));
    expect(r.status).toBe(422);
  });
  it("refuses a workspace that is not a sandbox workspace", async () => {
    for (const workspace of [{}, { ...emptyWorkspace(), mode: "live" }, { ...emptyWorkspace(), organization: { id: "o", fictional: false } }, { ...emptyWorkspace(), intents: "x" }]) {
      const r = await post("intents", { input, workspace }, { "idempotency-key": "qa-api-00002" });
      expect(r.status).toBe(422);
    }
  });
  it("unknown action types and endpoints are refused", async () => {
    expect((await post("actions", { action: { type: "transfer_funds" } })).status).toBe(422);
    expect((await post("admin/reset", {})).status).toBe(404);
    expect((await GET(new NextRequest("http://x/api/clearline/test/v1/../../funding", { headers: H }), ctx("..%2F..%2Ffunding"))).status).toBe(404);
  });
  it("Idempotency-Key header and body key must agree", async () => {
    const r = await post("intents", { input: { ...input, idempotencyKey: "qa-api-body-1" } }, { "idempotency-key": "qa-api-head-1" });
    expect(r.status).toBe(409);
  });
  it("DEFECT (Low) malformed workspace array items crash the handler instead of returning 4xx", async () => {
    const workspace = { ...emptyWorkspace(), intents: [null] };
    let status = 0;
    try { status = (await post("intents", { input, workspace }, { "idempotency-key": "qa-api-00003" })).status; } catch { status = 500; }
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
  it("DEFECT (Low) a deeply nested workspace crashes the handler (stack overflow) instead of returning 4xx", async () => {
    const deep = "[".repeat(100_000) + "]".repeat(100_000);
    let status = 0;
    try { status = (await postRaw("intents", `{"input":{},"workspace":${deep}}`)).status; } catch { status = 500; }
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
  it("DEFECT (Medium) a ~190 KB workspace keeps POST /liquidity busy for far longer than a request should (cubic cost)", async () => {
    const ws = emptyWorkspace() as unknown as Record<string, unknown>;
    const asOf = (ws as unknown as Workspace).asOf;
    const [S, I, N] = [400, 800, 800];
    ws.liquidity = Array.from({ length: S }, (_, k) => ({ id: "l" + k, providerId: "p", currency: "SGD", eligibleMinor: 1, restrictedMinor: 0, safeguardedMinor: 0, asOf }));
    ws.intents = Array.from({ length: I }, (_, k) => ({ id: "i" + k, sourceCurrency: "SGD", instructionId: "z", status: { execution: "approved" }, amountMinor: 1 }));
    ws.instructions = Array.from({ length: N }, (_, k) => ({ id: "n" + k, providerId: "p", status: "approved" }));
    const body = JSON.stringify({ workspace: ws });
    expect(body.length).toBeLessThan(200_000);
    const t = Date.now();
    const r = await postRaw("liquidity", body);
    const ms = Date.now() - t;
    // Measured 491 ms here and 16.5 s for a 736 KB body on `next start` (event loop blocked).
    // Cost doubles x8 per doubling of size; the 2 MB cap admits multi-minute requests.
    expect(r.status === 422 || ms < 100).toBe(true);
  }, 60_000);
});

describe("v1 API: maker/checker over a stateless API", () => {
  it("self-approval with the sample actors is refused (403)", async () => {
    const { ws, ins } = await toInstruction();
    const r = await post(`instructions/${ins}/approve`, { workspace: ws }, { "x-clearline-actor": "usr_maya" });
    expect(r.status).toBe(403);
  });
  it("DOCUMENTED: the caller chooses the actor id (header or body) — maker/checker is not an authentication boundary", async () => {
    const { ws, ins } = await toInstruction();
    const r = await post(`instructions/${ins}/approve`, { workspace: ws, actorId: "usr_daniel" });
    expect(r.status).toBe(200);
  });
  it("DOCUMENTED: a caller-supplied workspace may grant itself both roles under two invented ids", async () => {
    const forged = { ...emptyWorkspace(), actors: [{ id: "me_maker", name: "Me", role: "operator" }, { id: "me_checker", name: "Also me", role: "approver" }] } as Workspace;
    const { ws, ins } = await toInstruction(forged, { "x-clearline-actor": "me_maker" });
    const r = await post(`instructions/${ins}/approve`, { workspace: ws }, { "x-clearline-actor": "me_checker" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.persisted).toBe(false); // nothing leaves the response; only the caller's own copy changes
  });
});

describe("legacy test API", () => {
  it("refuses extra intent fields, bad amounts and invalid transitions", async () => {
    expect((await legacy("intents", { amount: "10.00", currency: "SGD", destinationCurrency: "PHP", beneficiary: "Acme", purpose: "Test", reference: "R1", admin: true })).status).toBe(422);
    expect((await legacy("intents", { amount: "0", currency: "SGD", destinationCurrency: "PHP", beneficiary: "Acme", purpose: "Test", reference: "R1" })).status).toBe(422);
    const p = { id: "pi_test_x", status: "completed", timeline: [], createdAt: "2026-11-13T00:00:00Z" };
    expect((await legacy("transitions", { payment: p, to: "in_transit" })).status).toBe(422);
  });
  it("DEFECT (Low) legacy /quotes returns eligible quotes for an unsupported currency", async () => {
    const r = await legacy("quotes", { amountMinor: 100, currency: "BTC", destinationCurrency: "PHP", kycTier: 3 });
    expect(r.status).toBe(422);
  });
});

describe("preview middleware (CLEARLINE_CUSTOMER_PREVIEW=1)", () => {
  const call = (path: string) => {
    process.env.CLEARLINE_CUSTOMER_PREVIEW = "1";
    try { return middleware(new NextRequest("http://x" + path)); } finally { delete process.env.CLEARLINE_CUSTOMER_PREVIEW; }
  };
  it.each(["/api/funding", "/api/payments/export.csv", "/api/requests", "/api/accounting/import", "/api/uploads/x", "/api/inbox/routes", "/api/demo/reset", "/books", "/funding", "/requests", "/settings", "/inbox", "/pay/abc", "/API/funding", "/clearlinex"])("404s %s", (p) => {
    expect(call(p).status).toBe(404);
  });
  it("/ redirects only to the same-origin console", () => {
    const r = call("/?next=https://evil.example");
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get("location")!).pathname).toBe("/clearline");
    expect(new URL(r.headers.get("location")!).host).toBe("x");
  });
  it("DEFECT (Low) the matcher skips middleware for any path that merely starts with favicon.ico / _next/image", () => {
    const re = new RegExp("^" + mwConfig.matcher[0].replace("/((?!", "/(?!").replace(").*)", ").*") + "$");
    for (const p of ["/favicon.icox", "/favicon.ico/../books", "/_next/imagex"]) expect(re.test(p)).toBe(true);
  });
});
