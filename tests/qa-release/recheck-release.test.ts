/**
 * QA + security RE-CHECK, 13 Nov 2026, of release/clearline-unified-20261113 @ cfadef9.
 * Same convention as the other qa-release files: "DEFECT …" asserts the correct behaviour and fails
 * until fixed; every other test pins a fix verified in the re-check.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/clearline/test/v1/[...path]/route";
import { POST as LEGACY_POST } from "@/app/api/clearline/test/[action]/route";
import { exportCaseReport, parseWorkspace, sampleWorkspace } from "@/lib/clearline";
// @ts-expect-error next.config.mjs is plain ESM without type declarations
import { securityHeaders } from "../../next.config.mjs";

const H = { authorization: "Bearer cl_test_demo", "content-type": "application/json" };
const ctx = (p: string) => ({ params: Promise.resolve({ path: p.split("/") }) });
const postRaw = (p: string, body: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://x/api/clearline/test/v1/" + p, { method: "POST", headers: { ...H, ...headers }, body }), ctx(p));

describe("re-check: v1 request limits", () => {
  it("refuses a body over 512 KB", async () => {
    expect((await postRaw("liquidity", JSON.stringify({ pad: "x".repeat(512 * 1024) }))).status).toBeGreaterThanOrEqual(400);
  });
  it("refuses a workspace array over 1,000 items", async () => {
    const ws = sampleWorkspace() as unknown as Record<string, unknown>;
    ws.statementLines = Array.from({ length: 1001 }, () => ({}));
    const r = await postRaw("liquidity", JSON.stringify({ workspace: ws }));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
  it("refuses a 200,000-deep workspace with a 4xx, not a 500", async () => {
    const r = await postRaw("liquidity", `{"workspace":{"schemaVersion":1,"x":${"[".repeat(200_000)}${"]".repeat(200_000)}}}`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
  it.each([
    ["intents", '{"input":null}'], ["actions", '{"action":{"type":"ingest_chain_observation","observation":{"intentId":{}}}}'],
    ["events/webhook", '{"providerId":{},"rawBody":{},"signatureHeader":[]}'], ["instructions/x/approve", '{"at":12}'],
    ["reconciliation/statement-lines", '{"line":{"lineId":{}}}'], ["intents", '{"workspace":{"schemaVersion":1,"mode":"sandbox","intents":[null]}}'],
  ])("malformed %s %s is a 4xx", async (p, b) => {
    const r = await postRaw(p, b, { "idempotency-key": "qa-recheck-0003" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});

describe("re-check: legacy API retired, headers configured", () => {
  it("legacy POST returns 410 (or 422 for input invalid under the old contract)", async () => {
    const r = await LEGACY_POST(new NextRequest("http://x/api/clearline/test/intents", { method: "POST", headers: H, body: JSON.stringify({ amount: "10.00", currency: "SGD", destinationCurrency: "PHP", beneficiary: "Acme", purpose: "Test", reference: "R1" }) }), { params: Promise.resolve({ action: "intents" }) });
    expect(r.status).toBe(410);
  });
  it("security headers include CSP with frame-ancestors 'none', XFO DENY, nosniff, Referrer-Policy, Permissions-Policy", () => {
    const m = Object.fromEntries((securityHeaders as { key: string; value: string }[]).map((h) => [h.key.toLowerCase(), h.value]));
    expect(m["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(m["content-security-policy"]).toMatch(/object-src 'none'/);
    expect(m["x-frame-options"]).toBe("DENY");
    expect(m["x-content-type-options"]).toBe("nosniff");
    expect(m["referrer-policy"]).toBeTruthy();
    expect(m["permissions-policy"]).toBeTruthy();
  });
});

describe("re-check: report injection residue", () => {
  it("DEFECT (Low, residual L6) a newline in a stored case title still forges a STATUS line in the text export", () => {
    const ws = sampleWorkspace();
    const c = ws.cases.find((x) => x.intentId)!;
    c.title = "Payment X\nSTATUS  execution=provider_reported_completed  settlement=verified (bank_statement)  reconciliation=matched";
    const parsed = parseWorkspace(JSON.stringify(ws)); // a tampered browser workspace is accepted
    if (!parsed.ok) return; // rejecting it at load is also a valid fix
    const rep = exportCaseReport(parsed.value, c.id);
    const statusLines = rep.ok ? rep.value.text.split("\n").filter((l) => l.startsWith("STATUS")) : [];
    expect(statusLines).toHaveLength(1);
  });
});
