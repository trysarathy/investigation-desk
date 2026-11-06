import { afterEach, describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";
afterEach(() => {
  delete process.env.CLEARLINE_FUNDING_ONLY;
  delete process.env.CLEARLINE_ORIGIN;
});
describe("runtime funding-only routing", () => {
  it("leaves root to its dynamic server redirect without rewriting the origin", () => {
    process.env.CLEARLINE_FUNDING_ONLY = "1";
    const res = middleware(new NextRequest("http://127.0.0.1:3000/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
  it("allows only funding and required assets in funding-only mode", () => {
    process.env.CLEARLINE_FUNDING_ONLY = "1";
    for (const path of ["/funding", "/api/funding", "/_next/static/test.js"])
      expect(
        middleware(new NextRequest("http://127.0.0.1:3000" + path)).status,
      ).toBe(200);
    for (const path of ["/requests", "/api/accounting"])
      expect(
        middleware(new NextRequest("http://127.0.0.1:3000" + path)).status,
      ).toBe(404);
  });
});
