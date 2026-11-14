/**
 * QA L3 on a real `next start` (production build, CLEARLINE_CUSTOMER_PREVIEW=1, the trial deployment).
 * Before rc3 (cf8732e) a 20 MB chunked POST to v1 was received in full (QA: RSS 303 → 372 MB; here
 * 183.8 → 254.7 MB peak). Now the server must refuse it and its RSS must not grow by more than a few MB.
 */
import { test, expect } from "@playwright/test";
import { chunkedUpload, raw, rssMB, scriptSrc, startServer, SECURITY_HEADERS, type Server } from "./server";

const MB = 1024 * 1024;
/** "A few MB": the allowed growth of the server's peak RSS while it refuses one oversized body. */
const MAX_RSS_GROWTH_MB = 8;
const H = { "content-type": "application/json", authorization: "Bearer cl_test_demo" };

test.describe.configure({ mode: "serial" });
let server: Server;
test.beforeAll(async () => {
  server = await startServer({ CLEARLINE_CUSTOMER_PREVIEW: "1" });
  // Warm-up: load the route modules and render a page once, so module loading is not counted as body memory.
  for (const p of ["/api/clearline/test/v1/liquidity", "/api/clearline/test/intents"]) await raw("POST", p, H, "{}");
  await raw("GET", "/clearline");
  await raw("POST", "/clearline", { "content-type": "application/json" }, "{}");
});
test.afterAll(async () => server?.stop());

for (const [path, expected] of [["/api/clearline/test/v1/liquidity", "Request body exceeds 512 KB."], ["/api/clearline/test/v1/intents", "Request body exceeds 512 KB."], ["/api/clearline/test/intents", "Test payload exceeds 12 KB."]] as const)
  for (const size of [20 * MB, 50 * MB])
    test(`${size / MB} MB chunked POST to ${path}: refused, connection closed, RSS grows < ${MAX_RSS_GROWTH_MB} MB`, async () => {
      const r = await chunkedUpload(server.pid, path, size);
      test.info().annotations.push({ type: "measurement", description: JSON.stringify({ path, sizeMB: size / MB, status: r.status, sentMB: r.sentMB, rssBeforeMB: r.rssBeforeMB, rssPeakMB: r.rssPeakMB, peakDeltaMB: r.peakDeltaMB }) });
      console.log(`[L3] ${path} ${size / MB} MB → ${r.status}; client sent ${r.sentMB} MB before the server closed; RSS ${r.rssBeforeMB} → peak ${r.rssPeakMB} MB (+${r.peakDeltaMB})`);
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body).error.message).toBe(expected);
      expect(r.responseHeaders.connection).toBe("close");
      expect(r.peakDeltaMB).toBeLessThan(MAX_RSS_GROWTH_MB);
      expect(r.sentMB, "the server stopped receiving long before the end of the body").toBeLessThan(size / MB);
    });

test("a declared Content-Length over 512 KB is refused at once (nothing read)", async () => {
  const before = rssMB(server.pid);
  const r = await raw("POST", "/api/clearline/test/v1/liquidity", { ...H, "content-length": String(20 * MB) }, "{}");
  expect(r.status).toBe(422);
  expect(r.headers.connection).toBe("close");
  expect(rssMB(server.pid) - before).toBeLessThan(MAX_RSS_GROWTH_MB);
});

test("20 MB chunked POSTs to a console page (through the middleware) hold at most the preview's 64 KB copy", async () => {
  // Next copies at most middlewareClientMaxBodySize (64 KB in the preview) for the middleware and reads and
  // discards the rest, because a page answers without reading the body (Next strips `Connection` from
  // middleware responses, so the discard cannot be cut short there). Before rc3 the copy limit was 21 MB
  // (two copies): one 20 MB POST to /clearline cost +38 MB of peak RSS. The first large body after start
  // grows the heap once (about 20 MB, measured); after that each one must cost only a few MB.
  await chunkedUpload(server.pid, "/clearline", 20 * MB);
  for (let i = 0; i < 3; i++) {
    const r = await chunkedUpload(server.pid, "/clearline", 20 * MB);
    console.log(`[L3] /clearline 20 MB (#${i + 1} after warm-up) → ${r.status}; RSS ${r.rssBeforeMB} → peak ${r.rssPeakMB} MB (+${r.peakDeltaMB})`);
    expect(r.status).toBe(200);
    expect(r.peakDeltaMB).toBeLessThan(MAX_RSS_GROWTH_MB);
  }
  expect(server.output()).toContain("Request body exceeded 64KB for /clearline");
});

test("the v1 API still works under the limit, with every security header, on every kind of response", async () => {
  const cases: [string, string, Record<string, string>, string | undefined, number][] = [
    ["GET", "/api/clearline/test/v1/health", {}, undefined, 200],
    ["GET", "/api/clearline/test/v1/intents", { authorization: "Bearer cl_test_demo" }, undefined, 200],
    ["GET", "/api/clearline/test/v1/intents", {}, undefined, 401],
    ["POST", "/api/clearline/test/v1/liquidity", H, "{}", 200],
    ["POST", "/api/clearline/test/v1/liquidity", H, "x".repeat(512 * 1024 + 1), 422],
    ["POST", "/api/clearline/test/v1/nope", H, "{}", 404],
    ["PUT", "/api/clearline/test/v1/health", H, "{}", 405],
    ["OPTIONS", "/api/clearline/test/v1/health", {}, undefined, 204],
    ["HEAD", "/api/clearline/test/v1/health", {}, undefined, 200],
    ["GET", "/api/clearline/test/health", {}, undefined, 410],
    ["POST", "/api/clearline/test/quotes", H, JSON.stringify({ amountMinor: 1, currency: "BTC", destinationCurrency: "PHP", kycTier: 3 }), 422],
  ];
  for (const [method, path, headers, body, status] of cases) {
    const r = await raw(method, path, headers, body);
    expect(r.status, `${method} ${path}`).toBe(status);
    for (const h of SECURITY_HEADERS) expect(r.headers[h], `${method} ${path} ${h}`).toBeTruthy();
    expect(r.headers["content-security-policy"], `${method} ${path}`).toMatch(/frame-ancestors 'none'/);
    expect(scriptSrc(r.headers["content-security-policy"] as string), `${method} ${path}`).not.toContain("'unsafe-inline'");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  }
  const ok = await raw("POST", "/api/clearline/test/v1/liquidity", H, "{}");
  expect(JSON.parse(ok.body).mode).toBe("synthetic");
  expect(ok.headers["x-clearline-mode"]).toBe("synthetic-test-only");
});
