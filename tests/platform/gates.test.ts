/**
 * rc3 platform, QA L3: the test API is excluded from the middleware matcher and enforces the
 * deployment gates itself. These tests prove (1) the shared deploymentGate() answers exactly as the
 * pre-rc3 middleware did, for every mode, path and credential below; (2) both test-API routes give the
 * middleware's exact refusal before reading any body byte; (3) the matcher excludes only strict-charset
 * test-API paths; (4) bodies are bounded (Content-Length and streamed).
 * Real-server proof (next start, RSS) is in tests/platform/*.spec.ts.
 */
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config, deploymentGate, TEST_API_EXCLUSION } from "@/middleware";
import { referenceMiddleware, referenceConfig } from "./reference-middleware-cf8732e";
import * as v1 from "@/app/api/clearline/test/v1/[...path]/route";
import * as legacy from "@/app/api/clearline/test/[action]/route";

const KEYS = ["CLEARLINE_CUSTOMER_PREVIEW", "CLEARLINE_FUNDING_ONLY", "PREVIEW_USER", "PREVIEW_PASSWORD"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
}
afterEach(() => setEnv(saved as never));

const MODES: Record<string, Partial<Record<(typeof KEYS)[number], string>>> = {
  "full app": {},
  "customer preview": { CLEARLINE_CUSTOMER_PREVIEW: "1" },
  "funding only": { CLEARLINE_FUNDING_ONLY: "1" },
  "basic auth": { PREVIEW_USER: "demo", PREVIEW_PASSWORD: "correct-horse-battery" },
  "preview + basic auth": { CLEARLINE_CUSTOMER_PREVIEW: "1", PREVIEW_USER: "demo", PREVIEW_PASSWORD: "correct-horse-battery" },
  "funding + basic auth": { CLEARLINE_FUNDING_ONLY: "1", PREVIEW_USER: "demo", PREVIEW_PASSWORD: "correct-horse-battery" },
};
const AUTHS: Record<string, string | undefined> = {
  none: undefined,
  "valid basic": "Basic " + btoa("demo:correct-horse-battery"),
  "wrong basic": "Basic " + btoa("demo:wrong-password-123"),
  "malformed basic": "Basic %%%",
  "sandbox bearer": "Bearer cl_test_demo",
};
const PATHS = [
  "/", "/clearline", "/clearline/trial", "/clearline/docs", "/mentor-demo", "/clearlinex", "/books", "/funding", "/api/funding",
  "/pay/abc", "/favicon.ico", "/icon.svg", "/_next/static/x.js", "/_next/imagex", "/API/funding",
  "/api/clearline/test/v1/health", "/api/clearline/test/v1/liquidity", "/api/clearline/test/v1/intents/pi_00001/quotes",
  "/api/clearline/test/health", "/api/clearline/test/intents", "/api/clearline/test/v1",
];
const req = (path: string, auth?: string, init: RequestInit = {}) =>
  new NextRequest("http://127.0.0.1:3284" + path, { ...init, headers: { ...(auth ? { authorization: auth } : {}), ...(init.headers as Record<string, string> | undefined) } } as never);

async function shape(r: Response) {
  return {
    status: r.status,
    body: r.status === 200 ? "" : await r.clone().text(),
    location: r.headers.get("location"),
    wwwAuthenticate: r.headers.get("www-authenticate"),
    cacheControl: r.status === 200 ? null : r.headers.get("cache-control"),
    consoleShell: r.headers.get("x-middleware-request-x-clearline-mentor-demo-route"),
  };
}

describe("deploymentGate() == the pre-rc3 middleware (differential)", () => {
  for (const [mode, env] of Object.entries(MODES))
    for (const [authName, auth] of Object.entries(AUTHS))
      it(`${mode}, auth ${authName}: same answer on ${PATHS.length} paths`, async () => {
        setEnv(env);
        for (const p of PATHS) expect(await shape(middleware(req(p, auth))), `${mode} ${authName} ${p}`).toEqual(await shape(referenceMiddleware(req(p, auth))));
      });
});

const v1Ctx = (path: string) => ({ params: Promise.resolve({ path: path.replace("/api/clearline/test/v1/", "").split("/") }) });
const legacyCtx = (path: string) => ({ params: Promise.resolve({ action: path.replace("/api/clearline/test/", "") }) });
const API_PATHS = ["/api/clearline/test/v1/health", "/api/clearline/test/v1/liquidity", "/api/clearline/test/health", "/api/clearline/test/intents"];
const handlerFor = (path: string, method: string) => {
  const mod = path.startsWith("/api/clearline/test/v1/") ? v1 : legacy;
  const ctx = mod === v1 ? v1Ctx(path) : legacyCtx(path);
  const fn = (mod as unknown as Record<string, (r: Request, c: unknown) => Promise<Response>>)[method];
  return (r: Request) => fn(r, ctx);
};

describe("the test-API routes enforce the same gates themselves (they are outside the matcher)", () => {
  for (const [mode, env] of Object.entries(MODES))
    it(`${mode}: every refusal the middleware would give, the route gives byte-for-byte; otherwise the route answers`, async () => {
      setEnv(env);
      for (const [, auth] of Object.entries(AUTHS))
        for (const p of API_PATHS)
          for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
            const init = method === "GET" || method === "OPTIONS" ? { method } : { method, body: "{}", headers: { "content-type": "application/json" } };
            const ref = referenceMiddleware(req(p, auth, init));
            const got = await handlerFor(p, method)(req(p, auth, init));
            if (ref.status !== 200) {
              const a = await shape(got);
              const b = await shape(ref);
              expect({ ...a, consoleShell: null }, `${mode} ${method} ${p}`).toEqual({ ...b, consoleShell: null });
            } else {
              // Allowed through: the route answers itself (JSON), never with a gate refusal.
              expect(got.headers.get("www-authenticate"), `${mode} ${method} ${p}`).toBeNull();
              expect(await got.clone().text(), `${mode} ${method} ${p}`).not.toBe("Not found");
            }
          }
    });

  it("no deployment gate decision changes for an API path between middleware and route (same function)", () => {
    for (const env of Object.values(MODES))
      for (const auth of Object.values(AUTHS))
        for (const p of API_PATHS) {
          setEnv(env);
          const d = deploymentGate(p, auth ?? null, process.env);
          expect(d.action === "next" ? 200 : d.action === "unauthorized" ? 401 : d.action === "not_found" ? 404 : 307).toBe(referenceMiddleware(req(p, auth)).status);
        }
  });
});

describe("matcher: only strict-charset test-API paths skip the middleware", () => {
  const re = new RegExp("^" + config.matcher[0].replace("/((?!", "/(?!").replace(").*)", ").*") + "$");
  const runs = (p: string) => re.test(p);
  it("excludes clean v1 and legacy paths", () => {
    for (const p of ["/api/clearline/test/v1/health", "/api/clearline/test/v1/liquidity", "/api/clearline/test/v1/intents/pi_00001/quotes", "/api/clearline/test/v1/reconciliation/statement-lines", "/api/clearline/test/health", "/api/clearline/test/v1"])
      expect(runs(p), p).toBe(false);
  });
  it("keeps every encoded, dotted, empty-segment or non-API path behind the middleware", () => {
    for (const p of [
      "/api/clearline/test/v1/%2e%2e/%2e%2e/%2e%2e/funding", "/api/clearline/test/v1/../../../funding", "/api/clearline/test/%2e%2e",
      "/api/clearline/test/v1/health.json", "/api/clearline/test/v1/health.rsc", "/api/clearline/test/v1%2fhealth", "/api/clearline/test/v1/",
      "/api/clearline/test/v1//health", "/api/clearline/test/a/b", "/api/clearline/test", "/api/clearline/test/", "/API/clearline/test/v1/health",
      "/clearline", "/api/funding", "/favicon.icox", "/_next/imagex", "/mentor-demo",
    ]) expect(runs(p), p).toBe(true);
  });
  it("still skips exactly the static assets the pre-rc3 matcher skipped", () => {
    const old = new RegExp("^" + referenceConfig.matcher[0].replace("/((?!", "/(?!").replace(").*)", ").*") + "$");
    for (const p of ["/favicon.ico", "/_next/image", "/_next/static/chunks/app.js", "/favicon.icox", "/books"]) expect(runs(p), p).toBe(old.test(p));
  });
  it("TEST_API_EXCLUSION is the literal used in the matcher (Next needs a static literal)", () => {
    expect(config.matcher[0]).toContain(TEST_API_EXCLUSION);
  });
});

/** A body stream that counts how many bytes the route pulled. `total` Infinity = an endless chunked upload. */
function countingBody(total: number, chunk = 64 * 1024) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (state.pulled >= total) return c.close();
      state.pulled += chunk;
      c.enqueue(new Uint8Array(chunk).fill(0x20));
    },
    cancel() { state.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, state };
}
const post = (path: string, body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
  new NextRequest("http://127.0.0.1:3284" + path, { method: "POST", body, duplex: "half", headers: { "content-type": "application/json", authorization: "Bearer cl_test_demo", ...headers } } as never);

describe("bounded bodies in the routes", () => {
  it("v1: a declared Content-Length over 512 KB is refused (422) before a single byte is read, and the connection is closed", async () => {
    setEnv({ CLEARLINE_CUSTOMER_PREVIEW: "1" });
    const { stream, state } = countingBody(20 * 1024 * 1024);
    const r = await v1.POST(post("/api/clearline/test/v1/liquidity", stream, { "content-length": String(20 * 1024 * 1024) }), v1Ctx("/api/clearline/test/v1/liquidity"));
    expect(r.status).toBe(422);
    expect((await r.json()).error.message).toBe("Request body exceeds 512 KB.");
    expect(r.headers.get("connection")).toBe("close");
    expect(state.pulled).toBe(0);
  });
  it("v1: an endless chunked body is cut off just past 512 KB (422, stream cancelled, connection closed)", async () => {
    setEnv({ CLEARLINE_CUSTOMER_PREVIEW: "1" });
    const { stream, state } = countingBody(Infinity);
    const r = await v1.POST(post("/api/clearline/test/v1/liquidity", stream), v1Ctx("/api/clearline/test/v1/liquidity"));
    expect(r.status).toBe(422);
    expect(r.headers.get("connection")).toBe("close");
    expect(state.pulled).toBeLessThanOrEqual(512 * 1024 + 64 * 1024);
    expect(state.cancelled).toBe(true);
  });
  it("v1: a gate refusal reads no body (funding-only 404, basic-auth 401)", async () => {
    for (const env of [{ CLEARLINE_FUNDING_ONLY: "1" }, { PREVIEW_USER: "demo", PREVIEW_PASSWORD: "correct-horse-battery" }]) {
      setEnv(env);
      const { stream, state } = countingBody(Infinity);
      const r = await v1.POST(post("/api/clearline/test/v1/liquidity", stream), v1Ctx("/api/clearline/test/v1/liquidity"));
      expect([401, 404]).toContain(r.status);
      expect(r.headers.get("connection")).toBe("close");
      expect(state.pulled).toBe(0);
    }
  });
  it("v1: a valid body under the limit still works (200)", async () => {
    setEnv({ CLEARLINE_CUSTOMER_PREVIEW: "1" });
    const r = await v1.POST(new NextRequest("http://x/api/clearline/test/v1/liquidity", { method: "POST", body: "{}", headers: { "content-type": "application/json", authorization: "Bearer cl_test_demo" } }), v1Ctx("/api/clearline/test/v1/liquidity"));
    expect(r.status).toBe(200);
    expect(r.headers.get("connection")).toBeNull();
  });
  it("legacy: an endless chunked body is cut off at 48 KB and refused (422); valid old-contract input still gets 410", async () => {
    setEnv({ CLEARLINE_CUSTOMER_PREVIEW: "1" });
    const { stream, state } = countingBody(Infinity);
    const r = await legacy.POST(post("/api/clearline/test/intents", stream), legacyCtx("/api/clearline/test/intents"));
    expect(r.status).toBe(422);
    expect(state.pulled).toBeLessThanOrEqual(48_000 + 64 * 1024);
    const ok = await legacy.POST(new NextRequest("http://x/api/clearline/test/quotes", { method: "POST", body: JSON.stringify({ amountMinor: 100, currency: "SGD", destinationCurrency: "PHP", kycTier: 3 }) }), legacyCtx("/api/clearline/test/quotes"));
    expect(ok.status).toBe(410);
  });
  it("legacy: 12,000 multi-byte characters (the old limit, up to 48 KB) are still accepted as input", async () => {
    setEnv({});
    const body = JSON.stringify({ type: "x", pad: "€".repeat(11_900) });
    expect(body.length).toBeLessThanOrEqual(12_000);
    const r = await legacy.POST(new NextRequest("http://x/api/clearline/test/webhooks", { method: "POST", body }), legacyCtx("/api/clearline/test/webhooks"));
    expect(r.status).toBe(422);
    expect((await r.json()).error.message).toBe("Unknown webhook event type."); // read in full and validated, not refused on size
  });
});
