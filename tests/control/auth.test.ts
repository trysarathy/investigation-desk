import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { auth, currentPrincipal } from "../../src/server/auth";
import { POST as authPOST } from "../../src/app/api/auth/[...all]/route";
import { revokeSessions } from "../../src/server/admin";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
let ids: Record<string, string>;
beforeAll(async () => { ids = await resetAndSeed(); });
afterAll(async () => { await closeDatabase(); await closeOwner(); });

let ip = 10;
async function signIn(email: string, password: string, origin = ORIGIN, from = `198.51.100.${ip++}`) {
  const res = await authPOST(new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, "x-forwarded-for": from },
    body: JSON.stringify({ email, password }),
  }));
  return res;
}
const cookieFrom = (res: Response) => (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""]).map((c) => c.split(";")[0]).join("; ");
const session = (cookie: string) => currentPrincipal(new Headers({ cookie }));

describe("real sign-in (Better Auth, database sessions)", () => {
  it("signs in with the right password and sets an HttpOnly, SameSite=Strict session cookie", async () => {
    const res = await signIn("ops@lumen.example", PASSWORD);
    expect(res.status).toBe(200);
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("clearline.session_token="))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    const p = await session(cookieFrom(res));
    expect(p).toMatchObject({ userId: ids["ops@lumen.example"], email: "ops@lumen.example" });
  });

  it("refuses a wrong password and an unknown user with the same generic answer", async () => {
    const a = await signIn("ops@lumen.example", "wrong-password-123");
    const b = await signIn("nobody@lumen.example", "wrong-password-123");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect((await a.json()).message).toBe((await b.json()).message);
  });

  it("refuses a sign-in from a foreign origin (CSRF)", async () => {
    const res = await signIn("ops@lumen.example", PASSWORD, "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("there is no public sign-up", async () => {
    const res = await authPOST(new Request(`${ORIGIN}/api/auth/sign-up/email`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify({ email: "new@lumen.example", password: "a-long-password-1", name: "x" }) }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const n = (await ownerDb().execute(sql`select count(*)::int as n from users where email = 'new@lumen.example'`)).rows[0].n;
    expect(n).toBe(0);
  });

  it("an expired session is not accepted", async () => {
    const c = cookieFrom(await signIn("viewer@lumen.example", PASSWORD));
    expect(await session(c)).not.toBeNull();
    await ownerDb().execute(sql`update sessions set expires_at = now() - interval '1 minute' where user_id = ${ids["viewer@lumen.example"]}`);
    expect(await session(c)).toBeNull();
  });

  it("revoking sessions signs the user out everywhere at once", async () => {
    const c1 = cookieFrom(await signIn("finance@lumen.example", PASSWORD));
    const c2 = cookieFrom(await signIn("finance@lumen.example", PASSWORD));
    expect(await session(c1)).not.toBeNull();
    expect(await revokeSessions(ownerDb(), "finance@lumen.example")).toBeGreaterThanOrEqual(2);
    expect(await session(c1)).toBeNull();
    expect(await session(c2)).toBeNull();
  });

  it("sign-out deletes the server-side session; the old cookie no longer works", async () => {
    const c = cookieFrom(await signIn("approver@lumen.example", PASSWORD));
    const out = await authPOST(new Request(`${ORIGIN}/api/auth/sign-out`, { method: "POST", headers: { cookie: c, origin: ORIGIN, "content-type": "application/json" }, body: "{}" }));
    expect(out.status).toBe(200);
    expect(await session(c)).toBeNull();
  });

  it("a sign-out with a session cookie from a foreign origin is refused (CSRF), and the session survives", async () => {
    const c = cookieFrom(await signIn("viewer@lumen.example", PASSWORD));
    const out = await authPOST(new Request(`${ORIGIN}/api/auth/sign-out`, { method: "POST", headers: { cookie: c, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
    expect(out.status).toBe(403);
    // and Better Auth's own check (not only ours) refuses it too
    const direct = await auth().handler(new Request(`${ORIGIN}/api/auth/sign-out`, { method: "POST", headers: { cookie: c, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
    expect(direct.status).toBe(403);
    expect(await session(c)).not.toBeNull();
  });

  it("a forged or random cookie is not a session", async () => {
    expect(await session("clearline.session_token=forged.value")).toBeNull();
    expect(await session("")).toBeNull();
  });

  it("limits failed sign-ins PER ACCOUNT, even when every attempt claims a different X-Forwarded-For (review H1)", async () => {
    const statuses: number[] = [];
    // signIn() rotates the X-Forwarded-For address on every call: the limit must not depend on it
    for (let i = 0; i < 7; i++) statuses.push((await signIn("admin@lumen.example", "wrong-password-123")).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // while locked, even the right password is refused; another account is unaffected
    expect((await signIn("admin@lumen.example", PASSWORD)).status).toBe(429);
    expect((await signIn("approver2@lumen.example", PASSWORD)).status).toBe(200);
  });

  it("a session older than 8 hours is refused even if Better Auth refreshed its expiry (absolute lifetime, review M6)", async () => {
    await revokeSessions(ownerDb(), "approver2@lumen.example"); // start from exactly one session
    const c = cookieFrom(await signIn("approver2@lumen.example", PASSWORD));
    expect(await session(c)).not.toBeNull();
    await ownerDb().execute(sql`update sessions set created_at = now() - interval '9 hours', expires_at = now() + interval '7 hours' where user_id = ${ids["approver2@lumen.example"]}`);
    expect(await session(c)).toBeNull();
    const n = (await ownerDb().execute(sql`select count(*)::int as n from sessions where user_id = ${ids["approver2@lumen.example"]} and created_at < now() - interval '8 hours'`)).rows[0].n;
    expect(n).toBe(0);
  });
});
