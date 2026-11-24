/**
 * v1 phase 0 (rc6 carry-over, drizzle/0038) against PostgreSQL 16: entities and matching policies are created only by
 * the provisioning path (the admin CLI's functions on the schema OWNER connection). The runtime login, even as a
 * merchant's Admin in its own organisation, cannot insert an entity or a policy or change an entity; it can still read
 * both, and an Admin can still change a policy through the Settings service (one revision at a time). APPROVAL-ONLY:
 * this tightens a security control. Fictional values only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, resetBlank } from "./harness";
import { liveCtx, seedLiveMerchants, type LiveSeed } from "./upload-harness";
import { closeDatabase } from "../../src/server/db/client";
import { withTenant } from "../../src/server/tenant";
import { addEntity } from "../../src/server/merchant-setup";
import { updateMerchantPolicy } from "../../src/server/merchant";

let s: LiveSeed;
let n = 0;
const key = () => `pg-key-${++n}-${Date.now()}`;
const as = (userId: string, orgId: string, q: ReturnType<typeof sql>) => withTenant({ userId, orgId }, (tx) => tx.execute(q));
const rows = async (q: ReturnType<typeof sql>) => (await ownerDb().execute(q)).rows as Record<string, unknown>[];
async function dbRefuses(p: Promise<unknown>, re: RegExp, what?: string) {
  try { await p; } catch (e) { const err = e as Error & { cause?: Error }; expect(`${err.message} ${err.cause?.message ?? ""}`, what).toMatch(re); return; }
  throw new Error(`expected the database to refuse ${re}${what ? ` (${what})` : ""}`);
}

beforeAll(async () => {
  await resetBlank();
  s = await seedLiveMerchants(ownerDb());
}, 120_000);
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("entity and policy creation is provisioning-only", () => {
  it("grants: the runtime login reads entities and policies, updates policies only, and inserts neither; the jobs login has none", async () => {
    const priv = async (role: string, table: string, p: string) => (await rows(sql`select has_table_privilege(${role}, ${`public.${table}`}, ${p}) as ok`))[0].ok;
    const runtime = {
      merchant_entities: { SELECT: true, INSERT: false, UPDATE: false, DELETE: false },
      merchant_policy: { SELECT: true, INSERT: false, UPDATE: true, DELETE: false },
    } as const;
    for (const [table, ps] of Object.entries(runtime)) {
      for (const [p, want] of Object.entries(ps)) {
        expect(await priv("clearline_runtime", table, p), `runtime ${p} ${table}`).toBe(want);
        expect(await priv("clearline_jobs", table, p), `jobs ${p} ${table}`).toBe(false);
      }
    }
  });

  it("every merchant role, the Admin included, is refused a direct INSERT of an entity or a policy in its own organisation", async () => {
    for (const email of ["admin@live-a.example", "finance@live-a.example", "ops@live-a.example", "approver@live-a.example", "viewer@live-a.example"]) {
      const c = await liveCtx(s, email, "a");
      await dbRefuses(as(c.userId, c.orgId, sql`insert into merchant_entities (org_id, id, name, functional_currency, ledger, timezone) values (${c.orgId}, 'ENT-RUNTIME', 'Runtime (fictional)', 'SGD', 'none', 'UTC')`), /permission denied/, email);
      await dbRefuses(as(c.userId, c.orgId, sql`insert into merchant_policy (org_id, entity_id, tolerance_bps, tolerance_abs_minor) values (${c.orgId}, 'ENT-LIVE-SG', 1000, 1000000)`), /permission denied/, email);
    }
    expect((await rows(sql`select count(*)::int as n from merchant_entities where id = 'ENT-RUNTIME'`))[0].n).toBe(0);
  });

  it("the runtime login cannot change an entity (its currency or its day under its data)", async () => {
    const admin = await liveCtx(s, "admin@live-a.example", "a");
    await dbRefuses(as(admin.userId, admin.orgId, sql`update merchant_entities set functional_currency = 'USD' where id = 'ENT-LIVE-SG'`), /permission denied/);
    await dbRefuses(as(admin.userId, admin.orgId, sql`update merchant_entities set utc_offset_minutes = 0 where id = 'ENT-LIVE-SG'`), /permission denied/);
    expect(await rows(sql`select functional_currency, utc_offset_minutes from merchant_entities where org_id = ${s.orgs.a} and id = 'ENT-LIVE-SG'`)).toEqual([{ functional_currency: "SGD", utc_offset_minutes: 480 }]);
  });

  it("the legitimate path still works: add-entity (owner) creates the entity and its revision-1 policy; the Admin then changes the policy in Settings", async () => {
    const r = await addEntity(ownerDb(), { orgSlug: s.slugs.a, entityId: "ENT-LIVE-NEW", name: "New entity (fictional)", currency: "SGD", timezone: "Asia/Singapore" });
    expect(r).toMatchObject({ status: "created", entityId: "ENT-LIVE-NEW", policyRevision: 1 });
    const admin = await liveCtx(s, "admin@live-a.example", "a");
    expect((await as(admin.userId, admin.orgId, sql`select id from merchant_entities where id = 'ENT-LIVE-NEW'`)).rows).toEqual([{ id: "ENT-LIVE-NEW" }]);
    expect((await updateMerchantPolicy(admin, "ENT-LIVE-NEW", { toleranceAbsMinor: 400 }, 1, key())).body).toMatchObject({ revision: 2 });
    // a non-Admin is still refused by the trigger (0009), unchanged
    const fin = await liveCtx(s, "finance@live-a.example", "a");
    await dbRefuses(as(fin.userId, fin.orgId, sql`update merchant_policy set tolerance_abs_minor = 1, revision = revision + 1 where entity_id = 'ENT-LIVE-NEW'`), /only by an Admin/);
    expect(await rows(sql`select actor_user_id is null as operator from audit_events where action = 'merchant_entity_created' and entity_id = 'ENT-LIVE-NEW'`)).toEqual([{ operator: true }]);
  });
});
