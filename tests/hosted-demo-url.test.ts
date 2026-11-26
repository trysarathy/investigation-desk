import { describe, expect, it } from "vitest";
import { hostedDemoRuntimeUrl } from "../src/server/db/hosted-demo-url";

describe("hosted demo runtime URL", () => {
  it("is null outside the hosted demo", () => expect(hostedDemoRuntimeUrl({ DATABASE_URL: "postgres://neondb_owner:x@h/neondb" })).toBeNull());
  it("always uses the clearline_runtime login on the demo database, never the Neon owner DATABASE_URL", () => {
    const url = new URL(hostedDemoRuntimeUrl({ CLEARLINE_HOSTED_DEMO: "1", PGHOST_UNPOOLED: "ep-x.ap-southeast-1.aws.neon.tech", CLEARLINE_DEMO_RUNTIME_PASSWORD: "p@ss/word", DATABASE_URL: "postgres://neondb_owner:x@h/neondb" })!);
    expect([url.username, decodeURIComponent(url.password), url.hostname, url.pathname, url.searchParams.get("sslmode")]).toEqual(["clearline_runtime", "p@ss/word", "ep-x.ap-southeast-1.aws.neon.tech", "/clearline_demo", "require"]);
  });
  it("refuses to start without the host or the runtime password (no fallback to the owner login)", () => {
    expect(() => hostedDemoRuntimeUrl({ CLEARLINE_HOSTED_DEMO: "1", DATABASE_URL: "postgres://neondb_owner:x@h/neondb" })).toThrow(/never used/);
    expect(() => hostedDemoRuntimeUrl({ CLEARLINE_HOSTED_DEMO: "1", PGHOST_UNPOOLED: "h;drop", CLEARLINE_DEMO_RUNTIME_PASSWORD: "p" })).toThrow();
  });
});
