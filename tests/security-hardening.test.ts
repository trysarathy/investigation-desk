// SECURITY GAPS (qa-security-engineer, 31 Oct 2026, origin/main @ 8decb27): hardening.
//
// (a) No security headers. `next.config.mjs` has no `headers()`, so no CSP / frame-ancestors,
//     X-Frame-Options, X-Content-Type-Options or Referrer-Policy. The payment page that shows the
//     receiving address can be framed (clickjacking). Reproduction (scratch server):
//       DESK_DATA_DIR=$(mktemp -d) npx next dev -p 3400
//       curl -sI localhost:3400/ | grep -iE 'content-security-policy|x-frame-options|x-content-type-options|referrer-policy'
//       curl -sI localhost:3400/pay/anything | grep -iE 'content-security-policy|x-frame-options'
//       # both print nothing
//     The unit test checks the config, which is where the fix belongs; HSTS belongs at the host.
//
// (b) Xero tokens are written with the default file mode. `writeAtomic` (`src/lib/lock.ts`) calls
//     writeFile with no mode, so `xero-tokens.json` (access + refresh token) is 0666 minus umask:
//     0644, readable by every local user, under the usual umask 022. Reproduction: connect Xero, then
//     `stat -c %a "$DESK_DATA_DIR/xero-tokens.json"` -> 644.
//
// (c) The public address checker POST /api/pay/<publicId>/check has no rate limit: every call
//     rewrites requests.json and a look-alike adds an activity row. Reproduction (scratch server,
//     after `curl -X POST localhost:3400/api/requests/demo -d '{"kind":"reset"}'` and taking a
//     publicId from a /pay/ link on /requests):
//       for i in $(seq 200); do curl -s -o /dev/null -w '%{http_code}\n' -X POST \
//         -H 'content-type: application/json' -d '{"address":"0x0000000000000000000000000000000000000000"}' \
//         localhost:3400/api/pay/<publicId>/check; done | sort | uniq -c        # 200 x 200, never 429
//
// SECURITY BUG: remove .fails when fixed.

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const saved = { DESK_DATA_DIR: process.env.DESK_DATA_DIR, DEMO_MODE: process.env.DEMO_MODE };
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "desk-sec-hard-"));
  process.env.DESK_DATA_DIR = dir;
  delete process.env.DEMO_MODE;
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

describe("security: response headers", () => {
  // SECURITY BUG: remove .fails when fixed
  it.fails("next.config sets anti-framing, nosniff and referrer headers on every route", async () => {
    // @ts-expect-error next.config.mjs is plain JS with no type declarations
    const cfg = (await import("../next.config.mjs")).default as { headers?: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    expect(typeof cfg.headers, "next.config.mjs has no headers()").toBe("function");
    const rules = await cfg.headers!();
    const all = rules.filter((r) => r.source === "/:path*" || r.source === "/(.*)").flatMap((r) => r.headers);
    const get = (k: string) => all.find((h) => h.key.toLowerCase() === k)?.value ?? "";
    expect(/frame-ancestors\s+'none'|frame-ancestors\s+'self'/.test(get("content-security-policy")) || /DENY|SAMEORIGIN/i.test(get("x-frame-options"))).toBe(true);
    expect(get("x-content-type-options")).toBe("nosniff");
    expect(get("referrer-policy")).not.toBe("");
  });
});

describe("security: Xero token file permissions", () => {
  // SECURITY BUG: remove .fails when fixed
  it.fails("xero-tokens.json is written owner-only (0600) even under umask 022", async () => {
    let old: number | undefined;
    try { old = process.umask(0o022); } catch { /* worker thread: the default umask applies */ }
    try {
      const { completeConnection } = await import("@/lib/accounting/providers/xero-auth");
      const fake = async (url: string) => ({
        ok: true, status: 200,
        json: async () => url.includes("/connections")
          ? [{ tenantId: "T-1", tenantName: "Demo Company (Global)", tenantType: "ORGANISATION" }]
          : { access_token: "test-access", refresh_token: "test-refresh", expires_in: 1800 },
      });
      await completeConnection("code", "http://desk.test/api/accounting/xero/callback", fake as never);
      const mode = (await stat(path.join(dir, "xero-tokens.json"))).mode & 0o777;
      expect(mode.toString(8), "token file readable by group/others").toBe("600");
    } finally {
      if (old !== undefined) process.umask(old);
    }
  });
});

describe("security: public address checker rate limit", () => {
  // SECURITY BUG: remove .fails when fixed
  it.fails("200 rapid checks from one client on one payment link are throttled (some 429)", async () => {
    const demo = await import("@/app/api/requests/demo/route");
    await demo.POST(new Request("http://desk.test/api/requests/demo", { method: "POST", body: JSON.stringify({ kind: "reset" }) }));
    const { requestsStore } = await import("@/lib/requests/service");
    const data = await requestsStore().load();
    const publicId = Object.values(data.requests).find((r) => r.publicId)!.publicId;
    const { POST } = await import("@/app/api/pay/[publicId]/check/route");
    const statuses: number[] = [];
    for (let i = 0; i < 200; i++) {
      const res = await POST(new Request(`http://desk.test/api/pay/${publicId}/check`, {
        method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
        body: JSON.stringify({ address: "0x0000000000000000000000000000000000000000" }),
      }), { params: Promise.resolve({ publicId }) });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 200).length, "every one of 200 calls accepted").toBeLessThan(200);
    expect(statuses).toContain(429);
  });
});
