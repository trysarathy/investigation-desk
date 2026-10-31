// SECURITY BUG (qa-security-engineer, 31 Oct 2026, origin/main @ 8decb27):
// With the preview password set (PREVIEW_USER / PREVIEW_PASSWORD, the set-up SECURITY_OVERVIEW §3
// recommends for pilots), `src/middleware.ts` lets only `/pay/*` through. The payment page's own
// address checker posts to `/api/pay/<publicId>/check`, which gets 401, so the customer's
// look-alike (address-poisoning) warning silently stops working.
//
// Manual reproduction (scratch server only):
//   PREVIEW_USER=u PREVIEW_PASSWORD=p DESK_DATA_DIR=$(mktemp -d) npx next dev -p 3400
//   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3400/pay/anything                 # 200/404: page exempt
//   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' \
//        -d '{"address":"0x0000000000000000000000000000000000000000"}' \
//        http://localhost:3400/api/pay/anything/check                                         # 401 (bug)
//
// SECURITY BUG: remove .fails when fixed. The fix must exempt exactly /api/pay/<id>/check (POST),
// not every path starting with /api/pay; the second test guards that and passes today.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const saved = { PREVIEW_USER: process.env.PREVIEW_USER, PREVIEW_PASSWORD: process.env.PREVIEW_PASSWORD };
beforeAll(() => { process.env.PREVIEW_USER = "pilot"; process.env.PREVIEW_PASSWORD = "long-random-preview-password"; });
afterAll(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });

const call = (p: string, method = "GET") => middleware(new NextRequest(`http://desk.test${p}`, { method }));

describe("security: preview password gate and the customer's address checker", () => {
  // SECURITY BUG: remove .fails when fixed
  it.fails("POST /api/pay/<publicId>/check is reachable without the preview password, like /pay/<publicId>", () => {
    expect(call("/pay/AbCdEfGhIjKl").status).not.toBe(401); // the page itself is exempt today
    expect(call("/api/pay/AbCdEfGhIjKl/check", "POST").status).not.toBe(401);
  });

  it("everything else under /api still needs the preview password", () => {
    expect(call("/api/payments/clear", "POST").status).toBe(401);
    expect(call("/api/pay", "POST").status).toBe(401);
    expect(call("/api/payments/export.csv").status).toBe(401);
    expect(call("/api/demo/reset", "POST").status).toBe(401);
  });
});
