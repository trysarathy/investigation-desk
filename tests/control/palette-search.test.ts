/**
 * v1 design-fluid against PostgreSQL 16: the command palette's server search (src/server/palette-search.ts) goes through
 * the tenant RLS read path. A member of org B never sees org A's payment references, exception ids or batch ids, even
 * searching for them by exact id. Test mode · illustrative data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeOwner, ownerDb, PASSWORD, resetAndSeed } from "./harness";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";
import { runReconciliation } from "../../src/server/merchant";
import { paletteSearch } from "../../src/server/palette-search";

let seed: Awaited<ReturnType<typeof seedMerchantCases>>;
let n = 0;
const key = () => `ps-key-${++n}-${Date.now()}`;
const SLUG = { sg: MERCHANT_SEED_ORGS.sg.slug, ae: MERCHANT_SEED_ORGS.ae.slug };
const ctx = (email: string, org: keyof typeof SLUG): Promise<TenantContext> => resolveTenant({ userId: seed.users[email], name: email, email }, SLUG[org]);
const ids = async (table: string, col: string, slug: string) =>
  ((await ownerDb().execute(sql.raw(`select ${col} as id from ${table} where org_id = (select id from organizations where slug = '${slug}') order by 1`))).rows as { id: string }[]).map((r) => r.id);

beforeAll(async () => {
  await resetAndSeed();
  seed = await seedMerchantCases(ownerDb(), { password: PASSWORD });
  const ops = await ctx("ops@straits-demo.example", "sg");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(ops, e, key());
  await runReconciliation(await ctx("ops@dunehaven-demo.example", "ae"), "ENT-AE-03", key());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

describe("command palette search", () => {
  it("finds the member's own payment references, exception ids and batch ids", async () => {
    const r = await paletteSearch(await ctx("finance@straits-demo.example", "sg"), "BK-248");
    expect(r.payments.length).toBeGreaterThan(0);
    expect(r.payments.every((id) => id.includes("BK-248"))).toBe(true);
    expect((await paletteSearch(await ctx("finance@straits-demo.example", "sg"), "EX-BK-24823")).exceptions).toEqual(["EX-BK-24823"]);
    const batches = await ids("settlement_batches", "batch_id", SLUG.sg);
    expect(batches.length).toBeGreaterThan(0);
    expect((await paletteSearch(await ctx("ops@straits-demo.example", "sg"), batches[0])).batches).toContain(batches[0]);
  });

  it("org B's search never returns org A's ids, even searched for exactly", async () => {
    const a = { payments: await ids("invoices", "order_id", SLUG.sg), exceptions: await ids("recon_exceptions", "id", SLUG.sg), batches: await ids("settlement_batches", "batch_id", SLUG.sg) };
    const bOwn = { payments: await ids("invoices", "order_id", SLUG.ae), exceptions: await ids("recon_exceptions", "id", SLUG.ae), batches: await ids("settlement_batches", "batch_id", SLUG.ae) };
    expect(a.payments.length + a.exceptions.length + a.batches.length).toBeGreaterThan(3);
    const onlyA = (k: keyof typeof a) => a[k].filter((x) => !bOwn[k].includes(x));
    for (const email of ["finance@dunehaven-demo.example", "ops@dunehaven-demo.example", "approver@dunehaven-demo.example"]) {
      const b = await ctx(email, "ae");
      for (const k of ["payments", "exceptions", "batches"] as const) {
        for (const id of onlyA(k).slice(0, 6)) {
          const r = await paletteSearch(b, id);
          expect(r[k], `${email} searching ${id}`).not.toContain(id);
          for (const kk of ["payments", "exceptions", "batches"] as const) for (const got of r[kk]) expect(bOwn[kk]).toContain(got);
        }
      }
      for (const q of ["BK", "EX", "B-", "%", "__"]) {
        const r = await paletteSearch(b, q);
        for (const kk of ["payments", "exceptions", "batches"] as const) for (const got of r[kk]) expect(bOwn[kk], `${email} ${q}`).toContain(got);
      }
    }
  });

  it("a short query returns nothing, and LIKE wildcards are literal", async () => {
    const f = await ctx("finance@straits-demo.example", "sg");
    expect(await paletteSearch(f, "B")).toEqual({ payments: [], exceptions: [], batches: [] });
    expect(await paletteSearch(f, "%%")).toEqual({ payments: [], exceptions: [], batches: [] });
    expect(await paletteSearch(f, "__")).toEqual({ payments: [], exceptions: [], batches: [] });
  });
});
