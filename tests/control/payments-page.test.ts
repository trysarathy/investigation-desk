/**
 * The payments page computes only the page it shows (merchantPaymentsPage). Its output must be identical to the
 * earlier way of building the page: every payment through listMerchantPayments, every record summary through
 * partsSummaries, then the `orders` restriction and the page slice. Same rows, same values, same order, same
 * counts, on the seeded sample data, across filters, searches and pages. Fictional data only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeOwner, ownerDb, resetAndSeed } from "./harness";
import { liveKey } from "./live-data";
import { closeDatabase } from "../../src/server/db/client";
import { resolveTenant, type TenantContext } from "../../src/server/tenant";
import { listMerchantPayments, merchantPaymentsPage, runReconciliation } from "../../src/server/merchant";
import { partsSummaries, partsSummaryOf } from "../../src/server/merchant-ui";
import { MERCHANT_SEED_ORGS, seedMerchantCases } from "../../src/server/merchant-seed";

let fin: TenantContext;

beforeAll(async () => {
  await resetAndSeed();
  const sample = await seedMerchantCases(ownerDb(), { password: "fictional-test-pass-01" });
  const ctxOf = (email: string) => resolveTenant({ userId: sample.users[email], name: email, email }, MERCHANT_SEED_ORGS.sg.slug);
  fin = await ctxOf("finance@straits-demo.example");
  const ops = await ctxOf("ops@straits-demo.example");
  for (const e of ["ENT-SG-01", "ENT-SG-02", "ENT-US-02"]) await runReconciliation(ops, e, liveKey());
});
afterAll(async () => { await closeDatabase(); await closeOwner(); });

type Filters = Parameters<typeof listMerchantPayments>[1];

/** The page as it was built before: everything, then restrict, then slice (src/app/control/merchant/payments/page.tsx). */
async function oldPage(ctx: TenantContext, filters: Filters, orders: string[], page: number, size: number) {
  const [rows, parts] = await Promise.all([listMerchantPayments(ctx, filters), partsSummaries(ctx)]);
  const shown = orders.length ? rows.filter((r) => orders.includes(r.orderId)) : rows;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const pageNo = Math.min(pages, Math.max(1, page));
  const visible = shown.slice((pageNo - 1) * size, pageNo * size);
  return { total: rows.length, shown: shown.length, pages, pageNo, rows: visible, parts: visible.map((r) => parts.get(r.orderId)) };
}
async function newPage(ctx: TenantContext, filters: Filters, orders: string[], page: number, size: number) {
  const p = await merchantPaymentsPage(ctx, filters ?? {}, { orders, page, pageSize: size });
  return { total: p.total, shown: p.shown, pages: p.pages, pageNo: p.pageNo, rows: p.rows, parts: p.records.map(partsSummaryOf) };
}

describe("payments page: one page computed, identical output", () => {
  it("is identical for every filter, search and page", async () => {
    const all = await listMerchantPayments(fin, { asOf: "2026-11-27T00:00:00.000Z" });
    expect(all.length).toBeGreaterThan(20);
    const some = [all[3].orderId, all[1].orderId, all[all.length - 1].orderId, "NO-SUCH-ORDER"];
    const asOf = "2026-11-27T00:00:00.000Z";
    const cases: Filters[] = [
      {}, { asOf }, { asOf, result: "exception" }, { asOf, result: "matched" }, { asOf, entityId: "ENT-SG-02" }, { asOf, network: "tron" }, { asOf, network: "ethereum", token: "USDC" },
      { asOf, token: "usdt" }, { asOf, differenceType: "underpayment" }, { asOf, batchId: "B-1125-SGD" }, { asOf, minAgeDays: 2 }, { asOf, maxAgeDays: 3 }, { asOf, minAgeDays: 1, maxAgeDays: 4 },
      { asOf, search: "BK-248" }, { asOf, search: "fict_tron_tx_24823" }, { asOf, search: "T_FICTIONAL_DEP_BK-24823" }, { asOf, search: "zzz-nothing" }, { asOf, result: "exception", network: "tron", token: "USDT" },
    ];
    let compared = 0;
    for (const f of cases) {
      for (const orders of [[], some]) {
        for (const [page, size] of [[1, 100], [1, 7], [2, 7], [3, 7], [99, 7], [0, 5]] as const) {
          const [a, b] = await Promise.all([oldPage(fin, f, orders, page, size), newPage(fin, f, orders, page, size)]);
          expect(b, JSON.stringify({ f, orders, page, size })).toEqual(a);
          compared += b.rows.length;
        }
      }
    }
    expect(compared).toBeGreaterThan(500);
  }, 120_000);

  it("is identical for an entity-scoped member", async () => {
    // the scope is applied as the database applies it: the same membership, narrowed to one entity
    const scoped: TenantContext = { ...fin, entityScope: ["ENT-SG-01"] };
    for (const f of [{}, { result: "exception" as const }, { search: "BK" }]) {
      expect(await newPage(scoped, f, [], 1, 10)).toEqual(await oldPage(scoped, f, [], 1, 10));
    }
  });
});
