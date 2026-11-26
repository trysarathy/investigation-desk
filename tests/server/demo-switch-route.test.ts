/**
 * Demo build: POST /api/control/demo/switch (the demo role switcher) answers 404 in any build without
 * CLEARLINE_DEMO_BUILD=1 (the build constants simulated as next.config.mjs inlines them), and the demo-only code is
 * imported only inside the build-constant branch, so a real build drops it (the bundle check, scripts/build/
 * check-chain-recording.mjs --marker demo, proves it on a finished build). Demo · fictional data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/control/demo/switch/route";
import { demoSwitchAllowed, switchDemoUser } from "@/server/demo-switch";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const build = (demo: boolean) => { process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = demo ? "1" : ""; };
const req = (origin?: string) => new Request("http://127.0.0.1:3100/api/control/demo/switch", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify({ email: "approver@northwind.demo" }) });
const who = { userId: "u-1", name: "Finance (demo)", email: "finance@northwind.demo" };
const src = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");

describe("POST /api/control/demo/switch", () => {
  it("is 404 in a real build, whatever the run-time environment says", async () => {
    build(false);
    process.env.CLEARLINE_ORIGIN = "http://127.0.0.1:3100";
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

describe("outside a demo build the switcher does nothing", () => {
  it("is not offered and refuses before touching the database", async () => {
    build(false);
    expect(await demoSwitchAllowed(who)).toBe(false);
    await expect(switchDemoUser(who, "s-1", "approver@northwind.demo")).rejects.toMatchObject({ status: 404 });
  });
  it("the demo-only modules are imported only inside the inlined build-constant branch", () => {
    const BRANCH = 'if (process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false) {';
    for (const [file, dynamic] of [["src/app/api/control/demo/switch/route.ts", "@/server/demo-switch-http"], ["src/components/merchant/DemoBar.tsx", "@/server/demo-switch"]] as const) {
      const s = src(file);
      expect(s).not.toMatch(/^import .*demo-switch/m);
      expect(s).not.toMatch(/^import .*(ResetDemoButton|DemoSwitcher)/m);
      const at = s.indexOf(BRANCH);
      expect(at, file).toBeGreaterThan(0);
      expect(s.indexOf(`import("${dynamic}")`), file).toBeGreaterThan(at);
    }
    // the layout reaches the demo controls only through DemoBar
    const layout = src("src/app/control/merchant/layout.tsx");
    expect(layout).not.toMatch(/ResetDemoButton|DemoSwitcher|demo-switch/);
    expect(src("src/server/demo-switch.ts")).toContain("clearline-demo[demo-build-only]");
  });
});
