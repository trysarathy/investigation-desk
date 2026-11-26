import { describe, expect, it } from "vitest";
import { neonLoginUrl } from "../src/server/db/neon-logins";

const owner = "postgres://neondb_owner:x@h/neondb";
describe("hosted Neon logins", () => {
  it("is off without the flag", () => expect(neonLoginUrl("runtime", { DATABASE_URL: owner })).toBeNull());
  it("always uses the Clearline login, never the Neon owner DATABASE_URL", () => {
    const u = new URL(neonLoginUrl("runtime", { CLEARLINE_DB_FROM_NEON: "1", PGHOST_UNPOOLED: "ep-x.ap-southeast-1.aws.neon.tech", CLEARLINE_RUNTIME_PASSWORD: "p@ss/w", DATABASE_URL: owner })!);
    expect([u.username, decodeURIComponent(u.password), u.hostname, u.pathname, u.searchParams.get("sslmode")]).toEqual(["clearline_runtime", "p@ss/w", "ep-x.ap-southeast-1.aws.neon.tech", "/clearline", "verify-full"]);
    expect(new URL(neonLoginUrl("provisioning", { CLEARLINE_DB_FROM_NEON: "1", PGHOST_UNPOOLED: "h", CLEARLINE_PROVISIONING_PASSWORD: "q" })!).username).toBe("clearline_provisioning");
  });
  it("refuses without the host or the login's password (no fallback to the owner)", () => {
    expect(() => neonLoginUrl("runtime", { CLEARLINE_DB_FROM_NEON: "1", DATABASE_URL: owner })).toThrow(/never used/);
    expect(() => neonLoginUrl("runtime", { CLEARLINE_DB_FROM_NEON: "1", PGHOST_UNPOOLED: "h;x", CLEARLINE_RUNTIME_PASSWORD: "p" })).toThrow();
  });
});
