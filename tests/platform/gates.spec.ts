/**
 * QA L3 on real `next start` servers, one per deployment mode: the test API is outside the middleware
 * matcher, and every gate that applied to it before rc3 still applies, for every method. Encoded or
 * dotted paths cannot use the matcher exclusion to skip a gate. Invalid configurations fail fast.
 */
import { test, expect } from "@playwright/test";
import { BASIC, MODE_ENV, raw, startExpectingExit, startServer, SECURITY_HEADERS, type Mode, type RawResponse, type Server } from "./server";

test.describe.configure({ mode: "serial" });

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const API = ["/api/clearline/test/v1/health", "/api/clearline/test/v1/liquidity", "/api/clearline/test/v1/intents/pi_00001/quotes", "/api/clearline/test/health", "/api/clearline/test/intents", "/api/clearline/test/v1"];
const send = (method: string, path: string, headers: Record<string, string> = {}) =>
  raw(method, path, { "content-type": "application/json", ...headers }, method === "GET" || method === "HEAD" || method === "OPTIONS" ? undefined : "{}");

const isBasic401 = (r: RawResponse) => r.status === 401 && /^Basic realm="Investigation Desk preview"/.test(String(r.headers["www-authenticate"])) && r.body === "Sign in to view this preview.";
const isPlain404 = (r: RawResponse, noStore: boolean) => r.status === 404 && r.body === "Not found" && (r.headers["cache-control"] === "no-store") === noStore;
function securityHeaders(r: RawResponse, label: string) {
  for (const h of SECURITY_HEADERS) expect(r.headers[h], `${label}: ${h}`).toBeTruthy();
}

/** Paths that try to reach another route via the matcher exclusion. None may answer 200 or render a page. */
const BYPASS = [
  "/api/clearline/test/v1/%2e%2e/%2e%2e/%2e%2e/funding", "/api/clearline/test/v1/%2E%2E/%2E%2E/%2E%2E/books", "/api/clearline/test/v1/..%2f..%2f..%2ffunding",
  "/api/clearline/test/v1/%2e%2e/%2e%2e/%2e%2e/api/funding", "/api/clearline/test/%2e%2e/%2e%2e/%2e%2e/funding", "/api/clearline/test/v1/./health",
  "/api/clearline/test/v1/health.json", "/api/clearline/test/v1/health.rsc", "/api/clearline/test/v1%2fhealth", "/api/clearline/test/v1/%68ealth",
  "/_next/data/x/api/clearline/test/y.json", "/_next/data/x/api/clearline/test/v1/y.json", "/api/clearline/test/a/b", "/api/clearline/test",
  "/API/clearline/test/v1/health", "/api/clearline/test/v1/health%00", "/api/clearline/test/v1/health;x", "/api/clearline/test/v1/health%20",
];

const MODES: [Mode, (s: Server) => Promise<void>][] = [
  ["preview", async () => {
    for (const m of METHODS) {
      const health = await send(m, "/api/clearline/test/v1/health");
      expect(health.status, `${m} health`).toBe(m === "GET" || m === "HEAD" ? 200 : m === "OPTIONS" ? 204 : m === "POST" ? 401 : 405);
      securityHeaders(health, `${m} health`);
      const legacy = await send(m, "/api/clearline/test/health");
      expect(legacy.status, `${m} legacy`).toBe(m === "OPTIONS" ? 204 : 410);
      securityHeaders(legacy, `${m} legacy`);
    }
    expect(JSON.parse((await send("GET", "/api/clearline/test/v1/health")).body).canMoveMoney).toBe(false);
    expect(JSON.parse((await send("GET", "/api/clearline/test/health")).body).error.code).toBe("endpoint_retired");
    expect((await send("POST", "/api/clearline/test/v1/liquidity", { authorization: "Bearer cl_test_demo" })).status).toBe(200);
    for (const p of ["/api/funding", "/books", "/funding", "/api/payments/export.csv", "/pay/abc"]) {
      const r = await send("GET", p);
      expect(isPlain404(r, true), `${p} → ${r.status}`).toBe(true);
      securityHeaders(r, p);
    }
    // The allow-list admits every /api/clearline/test/ path, so bypass paths only reach test-API answers or 404s.
    for (const p of BYPASS) {
      const r = await send("GET", p);
      expect([200, 308, 400, 401, 404, 410], `${p} → ${r.status}`).toContain(r.status);
      expect(r.body, p).not.toMatch(/Investigation desk|data-demo-actor|Stablecoin payment requests/);
      securityHeaders(r, p);
    }
  }],
  ["funding", async () => {
    for (const p of API) for (const m of METHODS) {
      const r = await send(m, p, { authorization: "Bearer cl_test_demo" });
      expect(m === "HEAD" ? r.status === 404 : isPlain404(r, false), `${m} ${p} → ${r.status} ${r.body.slice(0, 60)}`).toBe(true);
      securityHeaders(r, `${m} ${p}`);
    }
    for (const p of BYPASS) {
      const r = await send("GET", p);
      // RESIDUAL, pre-existing (see SECURITY_PLATFORM_RC3.md): a dot-segment path the gate sees normalised as
      // /funding (allowed) is routed raw by Next and renders the funding layout's 404 page. Never a 200, never
      // the legacy shell, never the test API.
      expect([404, 308], `${p} → ${r.status}`).toContain(r.status);
      expect(r.body, p).not.toMatch(/data-demo-actor|Investigation desk|synthetic-test-only|canMoveMoney/);
    }
    expect((await send("GET", "/funding")).status).toBe(200);
  }],
  ["basic", async () => {
    for (const p of API) for (const m of METHODS) {
      const r = await send(m, p, { authorization: "Bearer cl_test_demo" });
      expect(m === "HEAD" ? r.status === 401 : isBasic401(r), `${m} ${p} → ${r.status} ${r.body.slice(0, 60)}`).toBe(true);
      securityHeaders(r, `${m} ${p}`);
      const wrong = await send(m, p, { authorization: "Basic " + Buffer.from("demo:wrong-password-xyz").toString("base64") });
      expect(wrong.status, `${m} ${p} wrong password`).toBe(401);
    }
    // With the password, the API answers; it still wants its own Bearer key on the same header (unchanged since before rc3).
    const health = await send("GET", "/api/clearline/test/v1/health", { authorization: BASIC });
    expect(health.status).toBe(200);
    expect((await send("GET", "/api/clearline/test/v1/intents", { authorization: BASIC })).status).toBe(401);
    expect(JSON.parse((await send("GET", "/api/clearline/test/v1/intents", { authorization: BASIC })).body).error.code).toBe("unauthenticated");
    expect((await send("GET", "/api/clearline/test/health", { authorization: BASIC })).status).toBe(410);
    for (const p of BYPASS) {
      const r = await send("GET", p);
      expect(isBasic401(r) || r.status === 308, `${p} → ${r.status} ${r.body.slice(0, 60)}`).toBe(true);
    }
  }],
  ["full", async () => {
    expect((await send("GET", "/api/clearline/test/v1/health")).status).toBe(200);
    expect((await send("POST", "/api/clearline/test/v1/liquidity", { authorization: "Bearer cl_test_demo" })).status).toBe(200);
    expect((await send("GET", "/api/clearline/test/health")).status).toBe(410);
    expect((await send("PUT", "/api/clearline/test/v1/health")).status).toBe(405);
  }],
];

for (const [mode, check] of MODES)
  test(`${mode} mode: every gate applies to the test API, for every method`, async () => {
    const server = await startServer(MODE_ENV[mode]);
    try {
      await check(server);
    } finally {
      await server.stop();
    }
  });

test("an invalid deployment configuration stops `next start` with a clear message (and no secret in it)", async () => {
  for (const [env, message] of [
    [{ CLEARLINE_CUSTOMER_PREVIEW: "true" }, 'CLEARLINE_CUSTOMER_PREVIEW is "true"; only "1"'],
    [{ PREVIEW_USER: "demo", PREVIEW_PASSWORD: "short-pw" }, "PREVIEW_PASSWORD is shorter than 12 characters"],
    [{ CLEARLINE_CUSTOMER_PREVIEW: "1", XERO_CLIENT_SECRET: "xero-fixture-value" }, "must not hold accounting write credentials"],
  ] as const) {
    const r = await startExpectingExit(env);
    expect(r.code, JSON.stringify(env)).not.toBe(0);
    expect(r.output).toContain("Invalid Clearline deployment configuration:");
    expect(r.output).toContain(message);
    expect(r.output).not.toContain("short-pw");
    expect(r.output).not.toContain("xero-fixture-value");
  }
});
