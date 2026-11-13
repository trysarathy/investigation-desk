/**
 * rc3 platform: deployment-config validation (Task 3), the nonce CSP (R2), the preview body cap (L3)
 * and the clearline-release.json wiring in next.config.mjs.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware, newNonce, nonceContentSecurityPolicy } from "@/middleware";
// @ts-expect-error next.config.mjs is plain ESM without type declarations
import nextConfig, { assertDeploymentConfig, contentSecurityPolicy, deploymentConfigProblems, middlewareBodyLimit, PREVIEW_MIDDLEWARE_BODY_MAX, securityHeaders } from "../../next.config.mjs";
// @ts-expect-error plain ESM
import { loadRelease, resolveReleaseUrls } from "../../release-urls.mjs";
import { REQUEST_MAX_BYTES } from "@/lib/limits";

const directives = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
const ok = { CLEARLINE_CUSTOMER_PREVIEW: "1" };
const problems = (env: Record<string, string | undefined>) => deploymentConfigProblems(env) as string[];

describe("deployment configuration validation", () => {
  it("accepts the configurations the app actually uses", () => {
    for (const env of [
      {},
      ok,
      { CLEARLINE_FUNDING_ONLY: "1" },
      { PREVIEW_USER: "demo", PREVIEW_PASSWORD: "correct-horse-battery" },
      { CLEARLINE_CUSTOMER_PREVIEW: "", CLEARLINE_FUNDING_ONLY: "" },
      { CLEARLINE_CUSTOMER_PREVIEW: "1", DEMO_MODE: "on", QBO_ENV: "sandbox", LIVE_LOOKUPS: "off" },
      { DEMO_MODE: "off", XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y", QBO_ENV: "sandbox" }, // the legacy desk in live mode
    ]) expect(problems(env), JSON.stringify(env)).toEqual([]);
  });
  it.each([
    [{ CLEARLINE_CUSTOMER_PREVIEW: "true" }, /CLEARLINE_CUSTOMER_PREVIEW is "true"; only "1"/],
    [{ CLEARLINE_CUSTOMER_PREVIEW: "0" }, /CLEARLINE_CUSTOMER_PREVIEW is "0"/],
    [{ CLEARLINE_CUSTOMER_PREVIEW: " 1" }, /CLEARLINE_CUSTOMER_PREVIEW is " 1"/],
    [{ CLEARLINE_FUNDING_ONLY: "yes" }, /CLEARLINE_FUNDING_ONLY is "yes"/],
    [{ CLEARLINE_CUSTOMER_PREVIEW: "1", CLEARLINE_FUNDING_ONLY: "1" }, /both "1"/],
    [{ PREVIEW_USER: "demo" }, /Only PREVIEW_USER is set/],
    [{ PREVIEW_PASSWORD: "correct-horse-battery" }, /Only PREVIEW_PASSWORD is set/],
    [{ PREVIEW_USER: "demo", PREVIEW_PASSWORD: "elevenchars" }, /PREVIEW_PASSWORD is shorter than 12 characters/],
    [{ CLEARLINE_CUSTOMER_PREVIEW: "1", PREVIEW_USER: "demo", PREVIEW_PASSWORD: "correct-horse-battery" }, /CLEARLINE_CUSTOMER_PREVIEW=1 bypasses the password gate/],
    [{ CLEARLINE_FUNDING_ONLY: "1", PREVIEW_USER: "demo", PREVIEW_PASSWORD: "correct-horse-battery" }, /CLEARLINE_FUNDING_ONLY=1 bypasses the password gate/],
    [{ QBO_ENV: "production" }, /QBO_ENV=production would post to a live QuickBooks company/],
    [{ ...ok, DEMO_MODE: "off" }, /DEMO_MODE="off" switches to live mode/],
    [{ ...ok, DEMO_MODE: "Live" }, /switches to live mode/],
    [{ ...ok, XERO_CLIENT_ID: "x", XERO_CLIENT_SECRET: "y" }, /XERO_CLIENT_ID, XERO_CLIENT_SECRET are set; the customer preview is fictional-only/],
    [{ ...ok, QBO_ACCESS_TOKEN: "t" }, /QBO_ACCESS_TOKEN is set/],
  ])("refuses %j", (env, message) => {
    expect(problems(env).join("\n")).toMatch(message);
  });
  it("never prints a password or credential value", () => {
    const msg = (() => { try { assertDeploymentConfig({ CLEARLINE_CUSTOMER_PREVIEW: "1", PREVIEW_USER: "demo", PREVIEW_PASSWORD: "s3cret-PASS", XERO_CLIENT_SECRET: "xero-SECRET-value", QBO_ACCESS_TOKEN: "qbo-TOKEN-value" }); return ""; } catch (e) { return (e as Error).message; } })();
    expect(msg).toMatch(/^Invalid Clearline deployment configuration:/);
    for (const secret of ["s3cret-PASS", "xero-SECRET-value", "qbo-TOKEN-value"]) expect(msg).not.toContain(secret);
  });
  it("throws one error listing every problem", () => {
    expect(() => assertDeploymentConfig({ CLEARLINE_CUSTOMER_PREVIEW: "yes", PREVIEW_PASSWORD: "short" })).toThrow(/CLEARLINE_CUSTOMER_PREVIEW is "yes"[\s\S]*Only PREVIEW_PASSWORD[\s\S]*shorter than 12/);
  });
});

describe("clearline-release.json is wired into next.config.mjs", () => {
  it("the env block is exactly resolveReleaseUrls(process.env, clearline-release.json)", () => {
    const r = resolveReleaseUrls(process.env, loadRelease(new URL("../../clearline-release.json", import.meta.url)));
    expect(nextConfig.env).toEqual({
      NEXT_PUBLIC_CLEARLINE_PRODUCT_URL: r.product,
      NEXT_PUBLIC_CLEARLINE_MARKETING_URL: r.marketing,
      NEXT_PUBLIC_CLEARLINE_FUNDING_DESK_URL: r.fundingDesk,
      NEXT_PUBLIC_CLEARLINE_RELEASE_SOURCE: r.source,
    });
    for (const k of ["NEXT_PUBLIC_CLEARLINE_PRODUCT_URL", "NEXT_PUBLIC_CLEARLINE_MARKETING_URL", "NEXT_PUBLIC_CLEARLINE_FUNDING_DESK_URL"]) expect(nextConfig.env[k]).toMatch(/^https:\/\/[a-z0-9.-]+$/);
  });
  it("an invalid URL override fails at config load, not at runtime", () => {
    expect(() => resolveReleaseUrls({ CLEARLINE_PRODUCT_URL: "http://evil.example/x" }, loadRelease(new URL("../../clearline-release.json", import.meta.url)))).toThrow(/must be an https origin/);
  });
});

describe("L3: middleware body copy limit", () => {
  it("is 64 KB in a customer-preview deployment and REQUEST_MAX_BYTES otherwise", () => {
    expect(PREVIEW_MIDDLEWARE_BODY_MAX).toBe(64 * 1024);
    expect(middlewareBodyLimit({ CLEARLINE_CUSTOMER_PREVIEW: "1" })).toBe(64 * 1024);
    for (const env of [{}, { CLEARLINE_FUNDING_ONLY: "1" }, { PREVIEW_USER: "u", PREVIEW_PASSWORD: "correct-horse-battery" }]) expect(middlewareBodyLimit(env)).toBe(REQUEST_MAX_BYTES);
  });
});

describe("R2: Content-Security-Policy", () => {
  it("the production nonce policy has no 'unsafe-inline' or 'unsafe-eval' in script-src and uses 'strict-dynamic'", () => {
    const d = directives(nonceContentSecurityPolicy("abc", false));
    expect(d["script-src"]).toBe("'self' 'nonce-abc' 'strict-dynamic'");
    expect(d["object-src"]).toBe("'none'");
    expect(d["base-uri"]).toBe("'self'");
    expect(d["frame-ancestors"]).toBe("'none'");
  });
  it("the static fallback (test API, static files, gate refusals) has no 'unsafe-inline' scripts either", () => {
    expect(directives(contentSecurityPolicy)["script-src"]).not.toMatch(/unsafe-inline/);
    expect(securityHeaders.find((h: { key: string }) => h.key === "Content-Security-Policy").value).toBe(contentSecurityPolicy);
  });
  it("nonce and static policies agree on every directive except script-src", () => {
    const dyn = directives(nonceContentSecurityPolicy("abc"));
    const stat = directives(contentSecurityPolicy);
    delete dyn["script-src"];
    delete stat["script-src"];
    expect(dyn).toEqual(stat);
  });
  it("nonces are 128-bit and unique", () => {
    const seen = new Set(Array.from({ length: 1000 }, newNonce));
    expect(seen.size).toBe(1000);
    for (const n of seen) expect(atob(n)).toHaveLength(16);
  });
  it("the middleware sends the nonce policy and hands the same nonce to Next (request CSP) and the layout (x-nonce)", () => {
    for (const env of [{ CLEARLINE_CUSTOMER_PREVIEW: "1" }, {}]) {
      const saved = process.env.CLEARLINE_CUSTOMER_PREVIEW;
      if (env.CLEARLINE_CUSTOMER_PREVIEW) process.env.CLEARLINE_CUSTOMER_PREVIEW = "1"; else delete process.env.CLEARLINE_CUSTOMER_PREVIEW;
      try {
        const r = middleware(new NextRequest("http://x/clearline", { headers: { "x-nonce": "attacker-chosen" } }));
        const csp = r.headers.get("content-security-policy")!;
        const nonce = /'nonce-([^']+)'/.exec(csp)![1];
        expect(r.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
        expect(nonce).not.toBe("attacker-chosen");
        expect(r.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
        expect(middleware(new NextRequest("http://x/clearline")).headers.get("content-security-policy")).not.toBe(csp); // fresh per request
      } finally {
        if (saved === undefined) delete process.env.CLEARLINE_CUSTOMER_PREVIEW; else process.env.CLEARLINE_CUSTOMER_PREVIEW = saved;
      }
    }
  });
});
