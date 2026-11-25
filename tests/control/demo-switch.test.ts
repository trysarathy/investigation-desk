/**
 * Demo build: the demo role switcher (POST /api/control/demo/switch) against a real PostgreSQL 16, through the real
 * route with real Better Auth sign-ins. The build constants are simulated as next.config.mjs inlines them.
 *   - switching signs in as the target user: the new cookie is a real session for that user (their own user id, their
 *     own role), the caller's session ends, and the switch is in the audit history;
 *   - refused (404) for a member of a sample or live organisation, for a member of a demo AND a live organisation, for
 *     a target outside demo organisations, and for an unknown target; 404 for everyone in a real build;
 *   - the second-person rule still holds after a switch: a request prepared by Finance cannot be decided by Finance
 *     signed in again through the switcher (the database's maker-checker check refuses it).
 * Fictional organisations and users only. Demo · fictional data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed, signInWithMfa } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import * as t from "../../src/server/db/schema";
import { currentPrincipal } from "../../src/server/auth";
import { POST as authPOST } from "../../src/app/api/auth/[...all]/route";
import { POST as switchPOST } from "../../src/app/api/control/demo/switch/route";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { resolveTenant, withTenant } from "../../src/server/tenant";

const ORIGIN = process.env.CLEARLINE_ORIGIN!;
const envBefore = { ...process.env };
const build = (demo: boolean) => { process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = demo ? "1" : ""; };
const noBuild = () => { for (const k of ["CLEARLINE_NEXT_BUILD", "CLEARLINE_TEST_BUILD", "CLEARLINE_DEMO_BUILD"]) { if (envBefore[k] === undefined) delete process.env[k]; else process.env[k] = envBefore[k]; } };

let ids: Record<string, string> = {};
let ip = 20;
async function signIn(email: string) {
  // v1 1.2: password, then the authenticator code when the account has MFA (tests/control/harness.ts)
  return signInWithMfa(email, PASSWORD, `198.51.100.${ip++}`);
}
const cookieFrom = (res: Response) => res.headers.getSetCookie().filter((c) => c.startsWith("clearline.session_token=")).map((c) => c.split(";")[0]).join("; ");
const sw = (cookie: string, email: unknown, origin = ORIGIN) => switchPOST(new Request(`${ORIGIN}/api/control/demo/switch`, { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify({ email }) }));

beforeAll(async () => {
  ids = await resetAndSeed(); // two SAMPLE organisations (lumen-demo, harbour-demo) with their members
  const db = ownerDb();
  await createOrganization(db, { slug: "nw-switch-demo", name: "Northwind (switch test, demo)", seed: "empty", dataMode: "demo" });
  await createOrganization(db, { slug: "pp-switch-demo", name: "Provider P (switch test, demo)", seed: "empty", dataMode: "demo" });
  await createOrganization(db, { slug: "live-switch", name: "Live (switch test)", seed: "empty", dataMode: "live" });
  for (const [email, org, role] of [
    ["finance@switch.demo", "nw-switch-demo", "finance"], ["approver@switch.demo", "nw-switch-demo", "approver"], ["ops@switch.demo", "pp-switch-demo", "provider_ops"],
    ["mixed@switch.demo", "nw-switch-demo", "viewer"], ["mixed@switch.demo", "live-switch", "viewer"], ["live@switch.example", "live-switch", "finance"],
  ] as const) {
    if (!ids[email]) ids[email] = await createUser(db, { email, name: `${email.split("@")[0]} (fictional)`, password: PASSWORD });
    await grantMembership(db, { orgSlug: org, email, role });
  }
});
afterAll(async () => { noBuild(); await closeDatabase(); await closeOwner(); });

describe("the demo role switcher", () => {
  it("is 404 in a real build, even for a demo member with a valid session", async () => {
    build(false);
    const c = await signIn("finance@switch.demo");
    const r = await sw(c, "approver@switch.demo");
    expect(r.status).toBe(404);
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(await currentPrincipal(new Headers({ cookie: c }))).toMatchObject({ email: "finance@switch.demo" });
  });

  it("signs in as the target: a real session for that user, the caller's session ends, the switch is audited", async () => {
    build(true);
    const finance = await signIn("finance@switch.demo");
    const r = await sw(finance, "approver@switch.demo");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ label: "Demo · fictional data", signedInAs: { email: "approver@switch.demo", role: "approver" }, next: "/control/merchant" });
    const raw = r.headers.getSetCookie();
    const session = raw.find((c) => c.startsWith("clearline.session_token="))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Strict/i);
    expect(raw.some((c) => /^clearline_org=;/.test(c) && /Max-Age=0/.test(c))).toBe(true);
    const approver = session.split(";")[0];
    // the new cookie is the approver's own session: their user id, and their role in the organisation
    const p = await currentPrincipal(new Headers({ cookie: approver }));
    expect(p).toMatchObject({ userId: ids["approver@switch.demo"], email: "approver@switch.demo" });
    expect((await resolveTenant(p!, undefined)).role).toBe("approver");
    // the caller's session is gone
    expect(await currentPrincipal(new Headers({ cookie: finance }))).toBeNull();
    const rows = await ownerDb().select().from(t.sessions).where(eq(t.sessions.userId, ids["approver@switch.demo"]));
    expect(rows.length).toBe(1);
    const audit = (await ownerDb().execute(sql`select a.summary, a.actor_user_id from audit_events a join organizations o on o.id = a.org_id where o.slug = 'nw-switch-demo' and a.action = 'demo_user_switched'`)).rows;
    expect(audit).toEqual([{ summary: "Demo switcher: finance@switch.demo signed out and signed in as approver@switch.demo (Approver)", actor_user_id: ids["finance@switch.demo"] }]);
  });

  it("switches across demo organisations (to the provider's ops login) and lands on the provider console", async () => {
    build(true);
    const r = await sw(await signIn("approver@switch.demo"), "ops@switch.demo");
    expect(r.status).toBe(200);
    expect((await r.json()).next).toBe("/control/merchant/provider");
  });

  it("refuses a member of a sample or live organisation, and a demo member who also belongs to a live one", async () => {
    build(true);
    for (const email of ["ops@lumen.example", "live@switch.example", "mixed@switch.demo"]) {
      const c = await signIn(email);
      const r = await sw(c, "finance@switch.demo");
      expect(r.status, email).toBe(404);
      expect(r.headers.getSetCookie(), email).toEqual([]);
      expect(await currentPrincipal(new Headers({ cookie: c })), email).toMatchObject({ email });
    }
  });

  it("refuses a target outside demo organisations, an unknown target and a bad request, and never says why", async () => {
    build(true);
    const c = await signIn("finance@switch.demo");
    for (const email of ["approver@lumen.example", "live@switch.example", "mixed@switch.demo", "nobody@switch.demo"]) {
      const r = await sw(c, email);
      expect(r.status, email).toBe(404);
      expect(await r.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
    }
    expect((await sw(c, 42)).status).toBe(400);
    expect((await sw(c, "finance@switch.demo")).status).toBe(400);
    expect((await sw(c, "approver@switch.demo", "https://evil.example")).status).toBe(403);
    expect((await sw("", "approver@switch.demo")).status).toBe(401);
    expect(await currentPrincipal(new Headers({ cookie: c }))).toMatchObject({ email: "finance@switch.demo" });
  });

  it("does not weaken the second-person rule: Finance, signed in again through the switcher, cannot decide her own request", async () => {
    build(true);
    const db = ownerDb();
    const [org] = await db.select().from(t.organizations).where(eq(t.organizations.slug, "nw-switch-demo"));
    // Finance prepares a request as herself (the runtime login, her tenant context)
    const finCtx = { userId: ids["finance@switch.demo"], orgId: org.id };
    const [req] = await withTenant(finCtx, (tx) => tx.insert(t.approvalRequests).values({
      orgId: org.id, subjectKind: "merchant_resolution", subjectId: "EX-SWITCH-1", version: 1, payload: { note: "fictional" }, payloadSha256: "a".repeat(64), requestedBy: finCtx.userId, status: "pending",
    }).returning());
    // Finance → Approver → Finance again, all through the switcher
    const approver = (await sw(await signIn("finance@switch.demo"), "approver@switch.demo")).headers.getSetCookie().find((c) => c.startsWith("clearline.session_token="))!.split(";")[0];
    const back = await sw(approver, "finance@switch.demo");
    expect(back.status).toBe(200);
    const financeAgain = back.headers.getSetCookie().find((c) => c.startsWith("clearline.session_token="))!.split(";")[0];
    const p = await currentPrincipal(new Headers({ cookie: financeAgain }));
    expect(p?.userId).toBe(ids["finance@switch.demo"]); // the same person who prepared it: no new identity
    const ctx = await resolveTenant(p!, "nw-switch-demo");
    await expect(withTenant(ctx, (tx) => tx.insert(t.approvalDecisions).values({ orgId: org.id, requestId: req.id, decision: "approve", reason: "self approval through the switcher", payloadSha256: "a".repeat(64), decidedBy: ctx.userId })))
      .rejects.toMatchObject({ cause: { message: expect.stringMatching(/maker-checker/) } });
  });
});
