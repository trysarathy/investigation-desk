/**
 * Demo build: POST /api/control/demo/reset answers 404 in any build without CLEARLINE_DEMO_BUILD=1 (the build
 * constants are simulated as next.config.mjs inlines them). In a demo build it goes on to the usual mutation checks
 * (exact Origin first), and the demo reset itself only ever touches <name> and <name>_template. Demo · fictional data.
 */
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/control/demo/reset/route";
import { DemoResetRefused, demoResetConfigFromEnv, resetDemoDatabase } from "@/server/demo-reset";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const build = (demo: boolean) => { process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = demo ? "1" : ""; };
const req = (origin?: string) => new Request("http://127.0.0.1:3100/api/control/demo/reset", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: "{}" });

describe("POST /api/control/demo/reset", () => {
  it("is 404 in a real build, whatever the run-time environment says", async () => {
    build(false);
    process.env.CLEARLINE_ORIGIN = "http://127.0.0.1:3100";
    process.env.CLEARLINE_DEMO_RESET_URL = "postgres://postgres:x@127.0.0.1:1/postgres"; process.env.CLEARLINE_DEMO_DB = "clearline_demo";
    const r = await POST(req("http://127.0.0.1:3100"));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });
  it("is 404 outside a Next build too (no demo build)", async () => {
    delete process.env.CLEARLINE_NEXT_BUILD; process.env.CLEARLINE_DEMO_BUILD = "1";
    expect((await POST(req("http://127.0.0.1:3100"))).status).toBe(404);
  });
  it("in a demo build goes on to the mutation checks: a foreign Origin is refused first", async () => {
    build(true);
    process.env.CLEARLINE_ORIGIN = "http://127.0.0.1:3100";
    const r = await POST(req("http://evil.example"));
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("CSRF_ORIGIN");
  });
});

describe("the reset itself", () => {
  it("needs its configuration, and only ever recreates <name> from <name>_template", async () => {
    expect(() => demoResetConfigFromEnv({})).toThrow(DemoResetRefused);
    expect(() => demoResetConfigFromEnv({ CLEARLINE_DEMO_RESET_URL: "postgres://x@127.0.0.1/postgres", CLEARLINE_DEMO_DB: "Robert'); drop table" })).toThrow(DemoResetRefused);
    await expect(resetDemoDatabase({ adminUrl: "postgres://x@127.0.0.1:1/postgres", database: "clearline_demo", template: "clearline_live" })).rejects.toThrow(DemoResetRefused);
  });
});
