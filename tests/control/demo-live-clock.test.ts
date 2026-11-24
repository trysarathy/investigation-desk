/**
 * v1: live demo actions on the demo calendar, against a real PostgreSQL 16 (src/server/demo-live-clock.ts,
 * scripts/demo/live-clock-db.ts). The build constants are simulated as next.config.mjs inlines them.
 *   - demo build + demo organisation: a note's database-stamped time (now() default) and the app's stamp are on the
 *     demo day (2026-12-08 in Singapore), never before DEMO_NOW;
 *   - demo build + live organisation: unchanged, even if the database setting were forced;
 *   - real build + demo organisation: unchanged (the app never sets the setting);
 *   - the installer refuses a database with a non-demo organisation unless told it is this test, and the uninstall puts
 *     every default back to now() (the rest of the suite runs on unchanged defaults).
 * Fictional organisations and users only. Demo · fictional data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Client } from "pg";
import { closeOwner, ownerDb, PASSWORD, resetBlank } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { createOrganization, createUser, grantMembership } from "../../src/server/admin";
import { resolveTenant, withTenant } from "../../src/server/tenant";
import { stampNow } from "../../src/server/live-clock";
import { saveDemoFeedback } from "../../src/server/demo-feedback";
import { resetProcessDayOffset } from "../../src/server/demo-live-clock";
import { DEMO_NOW, DEMO_TODAY } from "../../src/lib/clearline/demo/clock";
import { installDemoLiveClock, uninstallDemoLiveClock } from "../../scripts/demo/live-clock-db";

const envBefore = { ...process.env };
const build = (demo: boolean) => { process.env.CLEARLINE_NEXT_BUILD = "1"; process.env.CLEARLINE_TEST_BUILD = ""; process.env.CLEARLINE_DEMO_BUILD = demo ? "1" : ""; };
const noBuild = () => { for (const k of ["CLEARLINE_NEXT_BUILD", "CLEARLINE_TEST_BUILD", "CLEARLINE_DEMO_BUILD"]) { if (envBefore[k] === undefined) delete process.env[k]; else process.env[k] = envBefore[k]; } };
/** The calendar date in Singapore (the demo merchant's zone). */
const sgDay = (d: Date) => new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

const owner = () => new Client({ connectionString: process.env.CLEARLINE_TEST_OWNER_URL });
let demoOrg = "", liveOrg = "", user = "";

beforeAll(async () => {
  await resetBlank();
  const db = ownerDb();
  demoOrg = await createOrganization(db, { slug: "nw-clock-demo", name: "Northwind (clock test, demo)", seed: "empty", dataMode: "demo" });
  liveOrg = await createOrganization(db, { slug: "live-clock", name: "Live (clock test)", seed: "empty", dataMode: "live" });
  user = await createUser(db, { email: "finance@clock.demo", name: "Finance (fictional)", password: PASSWORD });
  await grantMembership(db, { orgSlug: "nw-clock-demo", email: "finance@clock.demo", role: "finance" });
  await grantMembership(db, { orgSlug: "live-clock", email: "finance@clock.demo", role: "finance" });
});
afterAll(async () => {
  noBuild();
  const c = owner(); await c.connect();
  try { await uninstallDemoLiveClock(c); } finally { await c.end(); }
  await closeDatabase(); await closeOwner();
});

describe("the database half (demo databases only)", () => {
  it("refuses a database that holds a non-demo organisation", async () => {
    const c = owner(); await c.connect();
    try { await expect(installDemoLiveClock(c)).rejects.toThrow(/non-demo organisation; refusing/); } finally { await c.end(); }
  });

  it("installs the function as the default of every now()-stamped column, idempotently", async () => {
    const c = owner(); await c.connect();
    try {
      const a = await installDemoLiveClock(c, { allowNonDemoOrgs: true });
      expect(a.columns.length).toBeGreaterThan(10);
      expect(a.columns).toContain("demo_feedback.created_at");
      expect(a.columns).toContain("approval_requests.created_at");
      const b = await installDemoLiveClock(c, { allowNonDemoOrgs: true });
      expect(b.columns).toEqual(a.columns);
    } finally { await c.end(); }
  });
});

describe("a demo build", () => {
  it("stamps a demo organisation's live note on the demo day, in the database and in the app", async () => {
    build(true); resetProcessDayOffset();
    const ctx = await resolveTenant({ userId: user, name: "Finance (fictional)", email: "finance@clock.demo" }, "nw-clock-demo");
    const saved = await saveDemoFeedback(ctx, { screen: "Overview", route: "/control/merchant", note: "live note (fictional)" });
    const at = new Date(saved.at);
    expect(sgDay(at)).toBe(DEMO_TODAY);
    expect(at.getTime()).toBeGreaterThanOrEqual(Date.parse(DEMO_NOW));
    const app = await withTenant({ userId: user, orgId: demoOrg }, async (tx) => {
      const r = await tx.execute(sql`select clearline_demo_now() as d, now() as n`);
      return { stamp: stampNow(), db: new Date(r.rows[0].d as string), now: new Date(r.rows[0].n as string) };
    });
    expect(sgDay(app.stamp)).toBe(DEMO_TODAY);
    expect(sgDay(app.db)).toBe(DEMO_TODAY);
    // the same formula on both sides: whole days apart from the real clock, the same time of day (or both DEMO_NOW)
    expect(Math.abs(app.stamp.getTime() - app.db.getTime())).toBeLessThan(60_000);
  });

  it("leaves a live organisation on the machine clock, even if the database setting were forced", async () => {
    build(true); resetProcessDayOffset();
    const r = await withTenant({ userId: user, orgId: liveOrg }, async (tx) => {
      const s = stampNow();
      await tx.execute(sql`select set_config('clearline.demo_offset_days', '14', true)`);
      const q = await tx.execute(sql`select clearline_demo_now() = now() as same, current_setting('clearline.demo_offset_days', true) as forced`);
      return { s, same: q.rows[0].same, forced: q.rows[0].forced };
    });
    expect(r.forced).toBe("14");
    expect(r.same).toBe(true);
    expect(Math.abs(r.s.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it("reads stay on the machine clock (no setting in a read-only snapshot)", async () => {
    build(true); resetProcessDayOffset();
    const q = await withTenant({ userId: user, orgId: demoOrg }, (tx) => tx.execute(sql`select clearline_demo_now() = now() as same`), { read: true });
    expect(q.rows[0].same).toBe(true);
  });
});

describe("a real build", () => {
  it("never moves a demo organisation's stamps", async () => {
    build(false); resetProcessDayOffset();
    const r = await withTenant({ userId: user, orgId: demoOrg }, async (tx) => {
      const q = await tx.execute(sql`select clearline_demo_now() = now() as same, current_setting('clearline.demo_offset_days', true) as setting`);
      return { s: stampNow(), same: q.rows[0].same, setting: q.rows[0].setting };
    });
    expect(r.same).toBe(true);
    expect(r.setting ?? "").toBe("");
    expect(Math.abs(r.s.getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe("uninstall", () => {
  it("puts every default back to now() and drops the function", async () => {
    const c = owner(); await c.connect();
    try {
      const u = await uninstallDemoLiveClock(c);
      expect(u.columns).toContain("demo_feedback.created_at");
      const { rows } = await c.query("select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_default like '%clearline_demo_now%'");
      expect(rows[0].n).toBe(0);
      const f = await c.query("select count(*)::int as n from pg_proc where proname = 'clearline_demo_now'");
      expect(f.rows[0].n).toBe(0);
    } finally { await c.end(); }
  });
});
