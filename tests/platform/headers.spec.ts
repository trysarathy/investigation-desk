/**
 * v1 E1 (phase 5.2): the security headers on key routes of a PRODUCTION build (`npx next build` first), read over
 * raw HTTP from `next start`. Every answer (pages, API, static files, gate refusals, 404s) carries the full set; every
 * document carries a production CSP with no 'unsafe-inline' (except style attributes) and no 'unsafe-eval'.
 */
import { test, expect } from "@playwright/test";
import { raw, startServer, SECURITY_HEADERS, type RawResponse, type Server } from "./server";

test.describe.configure({ mode: "serial" });

const directives = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).filter((p) => p[0]).map(([k, ...v]) => [k, v.join(" ")]));

function assertHeaders(r: RawResponse, label: string) {
  for (const h of SECURITY_HEADERS) expect(r.headers[h], `${label}: ${h}`).toBeTruthy();
  expect(r.headers["strict-transport-security"], label).toBe("max-age=63072000; includeSubDomains");
  expect(r.headers["x-content-type-options"], label).toBe("nosniff");
  expect(r.headers["x-frame-options"], label).toBe("DENY");
  expect(r.headers["cross-origin-opener-policy"], label).toBe("same-origin");
  expect(r.headers["cross-origin-resource-policy"], label).toBe("same-origin");
  expect(r.headers["x-powered-by"], label).toBeUndefined();
  const d = directives(String(r.headers["content-security-policy"]));
  expect(d["object-src"], label).toBe("'none'");
  expect(d["base-uri"], label).toBe("'none'");
  expect(d["frame-ancestors"], label).toBe("'none'");
  expect(d["form-action"], label).toBe("'self'");
  expect(d["style-src"], label).toBe("'self'");
  for (const [k, v] of Object.entries(d)) {
    expect(v, `${label} ${k}`).not.toMatch(/unsafe-eval/);
    if (k !== "style-src-attr") expect(v, `${label} ${k}`).not.toMatch(/unsafe-inline/);
  }
}

const isDocument = (r: RawResponse) => String(r.headers["content-type"] ?? "").startsWith("text/html") && r.status === 200;

for (const [mode, env, paths] of [
  ["full app", {}, ["/", "/funding", "/clearline", "/clearline/docs", "/api/clearline/test/v1/health", "/favicon.ico", "/no-such-page", "/control", "/api/control/session"]],
  ["customer preview", { CLEARLINE_CUSTOMER_PREVIEW: "1" }, ["/", "/clearline", "/clearline/payments", "/clearline/docs", "/api/clearline/test/v1/health", "/funding", "/clearline/no-such-page"]],
] as const) {
  test(`${mode}: every key route answers with the full security header set and a strict production CSP`, async () => {
    let server: Server | undefined;
    try {
      server = await startServer(env);
      let documents = 0;
      for (const p of paths) {
        const r = await raw("GET", p);
        expect(r.status, p).toBeLessThan(500);
        assertHeaders(r, `${mode} ${p} (${r.status})`);
        if (isDocument(r)) {
          documents++;
          expect(directives(String(r.headers["content-security-policy"]))["script-src"], p).toMatch(/^'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'$/);
          // A static asset the document links to carries the headers too (CORP same-origin, nosniff).
          const asset = /\/_next\/static\/[^"']+\.(?:js|css)/.exec(r.body)?.[0];
          if (asset) assertHeaders(await raw("GET", asset), `${mode} ${asset}`);
        }
      }
      expect(documents, "at least one HTML document checked").toBeGreaterThan(0);
    } finally {
      await server?.stop();
    }
  });
}
