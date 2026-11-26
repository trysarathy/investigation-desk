/**
 * Demo build: the presenter guide, "Note feedback" and its route exist only in a build made with
 * CLEARLINE_DEMO_BUILD=1 (the build constants simulated as next.config.mjs inlines them). The demo-only modules are
 * imported only inside the build-constant branch, so a real build drops them (the bundle check,
 * scripts/build/check-chain-recording.mjs --marker demo, proves it on a finished build). Also: the guide's 13 steps
 * and the feedback export's format. Demo · fictional data.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { POST as feedbackPOST } from "@/app/api/control/demo/feedback/route";
import { POST as resetPOST } from "@/app/api/control/demo/reset/route";
import { POST as switchPOST } from "@/app/api/control/demo/switch/route";
import { FeedbackInput, listDemoFeedback, saveDemoFeedback } from "@/server/demo-feedback";
import { GUIDE_LOGINS, GUIDE_STEPS } from "@/lib/clearline/demo/guide";
import { feedbackMarkdown } from "../../scripts/demo/feedback";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const build = (demo: boolean) => { process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = demo ? "1" : ""; };
const ORIGIN = "http://127.0.0.1:3100";
const req = (url: string, body: unknown) => new Request(`${ORIGIN}${url}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });
const src = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");
const ctx = { userId: "u-1", name: "Finance (demo)", email: "finance@northwind.demo", orgId: "00000000-0000-4000-8000-000000000001", orgSlug: "northwind-demo", orgName: "Northwind Travel (demo)", role: "finance" as const };
const BRANCH = 'if (process.env.CLEARLINE_NEXT_BUILD === "1" ? process.env.CLEARLINE_DEMO_BUILD === "1" : false) {';

describe("in a real build every demo convenience is off", () => {
  it("the feedback, reset and switch routes answer 404", async () => {
    build(false);
    process.env.CLEARLINE_ORIGIN = ORIGIN;
    for (const [post, url, body] of [[feedbackPOST, "/api/control/demo/feedback", { screen: "Payments", route: "/control/merchant/payments", note: "x" }], [resetPOST, "/api/control/demo/reset", {}], [switchPOST, "/api/control/demo/switch", { email: "approver@northwind.demo" }]] as const) {
      const r = await post(req(url, body));
      expect(r.status, url).toBe(404);
      expect(await r.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
    }
  });
  it("saving or listing feedback refuses before touching the database", async () => {
    build(false);
    await expect(saveDemoFeedback(ctx, { screen: "Payments", route: "/control/merchant/payments", note: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(listDemoFeedback(ctx)).rejects.toMatchObject({ status: 404 });
    delete process.env.CLEARLINE_NEXT_BUILD; process.env.CLEARLINE_DEMO_BUILD = "1"; // outside a Next build: no demo build either
    await expect(saveDemoFeedback(ctx, { screen: "Payments", route: "/control/merchant/payments", note: "x" })).rejects.toMatchObject({ status: 404 });
  });
  it("the guide, the feedback button and the feedback route are imported only inside the build-constant branch", () => {
    for (const [file, dynamics] of [
      ["src/app/api/control/demo/feedback/route.ts", ["@/server/demo-feedback-http"]],
      ["src/components/merchant/DemoBar.tsx", ["./PresenterGuide", "./FeedbackNote", "./ResetDemoButton", "./DemoSwitcher", "@/server/demo-switch"]],
    ] as const) {
      const s = src(file);
      expect(s).not.toMatch(/^import .*(PresenterGuide|FeedbackNote|demo-feedback|ResetDemoButton|DemoSwitcher|demo-switch)/m);
      const at = s.indexOf(BRANCH);
      expect(at, file).toBeGreaterThan(0);
      for (const d of dynamics) expect(s.indexOf(`import("${d}")`), `${file} ${d}`).toBeGreaterThan(at);
    }
    for (const f of ["src/app/control/merchant/layout.tsx", "src/app/control/merchant/page.tsx"]) expect(src(f), f).not.toMatch(/PresenterGuide|FeedbackNote|demo-feedback/);
    expect(src("src/server/demo-feedback.ts")).toContain("clearline-demo[demo-build-only]");
  });
});

describe("feedback input", () => {
  it("needs a screen, a path on this site and a note; nothing else is accepted", () => {
    expect(FeedbackInput.safeParse({ screen: "Payments", route: "/control/merchant/payments?x=1", note: " Hard to read. " }).success).toBe(true);
    expect(FeedbackInput.safeParse({ screen: "Payments", route: "https://elsewhere.example/", note: "x" }).success).toBe(false);
    expect(FeedbackInput.safeParse({ screen: "Payments", route: "/x", note: "   " }).success).toBe(false);
    expect(FeedbackInput.safeParse({ screen: "Payments", route: "/x", note: "x", role: "admin" }).success).toBe(false); // the role comes from the session
    expect(FeedbackInput.safeParse({ screen: "Payments", route: "/x", note: "x".repeat(2001) }).success).toBe(false);
  });
  it("exports to Markdown grouped by screen, oldest first, with the login, role, time and route", () => {
    const md = feedbackMarkdown([
      { id: "b", created_at: "2026-11-24T10:05:00.000Z", role: "approver", screen: "Approvals", route: "/control/merchant/approvals", note: "Show the hash shorter.", email: "approver@northwind.demo", name: "Approver (demo)", org: "Northwind Travel (demo)" },
      { id: "a", created_at: "2026-11-24T10:00:00.000Z", role: "finance", screen: "Payments", route: "/control/merchant/payments?result=exception", note: "Line one\nLine two", email: "finance@northwind.demo", name: "Finance (demo)", org: "Northwind Travel (demo)" },
    ], "2026-11-24");
    expect(md).toContain("# Demo feedback, 2026-11-24");
    expect(md).toContain("2 note(s) on 2 screen(s).");
    expect(md.indexOf("## Payments (`/control/merchant/payments`)")).toBeLessThan(md.indexOf("## Approvals"));
    expect(md).toContain("- 2026-11-24 10:00 UTC · Finance (finance@northwind.demo) · `/control/merchant/payments?result=exception`\n  > Line one\n  > Line two");
  });
});

describe("the presenter guide", () => {
  it("has the 13 journey steps in order, each with a screen, a demo login and two or three talking points, 10 minutes in all", () => {
    expect(GUIDE_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(GUIDE_STEPS.map((s) => s.slug)).toEqual(["overview", "daily-report", "payments", "payment-bk-24823", "exception", "approval", "batch-b-1125-sgd", "case-bk-25102", "month-end", "exports", "upload", "provider-console", "settings"]);
    for (const s of GUIDE_STEPS) {
      expect(s.path, s.title).toMatch(/^\/control\/merchant(\/|\?|$)/);
      expect(GUIDE_LOGINS[s.as].email).toMatch(/@(northwind|providerp)\.demo$/);
      expect(s.points.length, s.title).toBeGreaterThanOrEqual(2);
      expect(s.points.length, s.title).toBeLessThanOrEqual(3);
    }
    expect(GUIDE_STEPS.find((s) => s.slug === "approval")!.as).toBe("approver");
    expect(GUIDE_STEPS.find((s) => s.slug === "provider-console")!.as).toBe("ops");
    expect(GUIDE_STEPS.reduce((a, s) => a + s.minutes, 0)).toBe(10);
  });
});
