import { expect, test } from "@playwright/test";
import { guard, resetDemo, settled, signIn } from "./demo";
import { demoQuery } from "./db";
import { DEMO_USERS } from "./env";

/*
 * The three documented cases inside the seeded 30-day demo dataset, every number, on the demo build's screens and in
 * the demo database (read-only), from the seeded state; and the seed's calendar: every database-stamped time of the
 * seed is a demo date, never the machine's. Demo · fictional data.
 *   Case 1: BK-24817/24823/24830/24836 in batch B-1124-001, net SGD 5,961.24, tied.
 *   Case 2: B-1125-SGD bridge SGD 44,412.30 → … → 40,228.68, BK-24871 held by the provider (an exception).
 *   Case 3: BK-25102, two parts on two chains, AED 14.16 open = 12.86 underpayment + 1.30 rate difference.
 */
const bars = (page: import("@playwright/test").Page) => page.getByTestId("waterfall-step");

test.beforeAll(() => { resetDemo(); });

test("Case 1: four payments in B-1124-001, net SGD 5,961.24, tied", async ({ page }) => {
  const g = guard(page);
  const lines = await demoQuery<{ order_id: string }>("select distinct order_id from settlement_batch_lines where batch_id = 'B-1124-001' order by 1");
  expect(lines.map((l) => l.order_id)).toEqual(["BK-24817", "BK-24823", "BK-24830", "BK-24836"]);
  const [b] = await demoQuery<{ gross: string; fees: string; refunds: string; net: string; entity_id: string }>("select gross_minor::text gross, fees_minor::text fees, refunds_minor::text refunds, net_minor::text net, entity_id from settlement_batches where batch_id = 'B-1124-001'");
  expect(b).toEqual({ gross: "602145", fees: "6021", refunds: "0", net: "596124", entity_id: "NW-SG" });
  await signIn(page, DEMO_USERS.finance);
  await page.goto("/control/merchant/batches/B-1124-001");
  await settled(page);
  await expect(page.getByTestId("batch-tied")).toHaveText("Tied to the cent");
  await expect(bars(page)).toHaveText([/SGD 6,021\.45/, /SGD 6,021\.45/, /SGD -60\.21/, /SGD 5,961\.24/]);
  for (const o of ["BK-24817", "BK-24823", "BK-24830", "BK-24836"]) {
    const [m] = await demoQuery<{ batch: string | null }>("select bank->'batchIds'->>0 batch from match_records where order_id = $1", [o]);
    expect(m.batch, o).toBe("B-1124-001");
  }
  await page.goto("/control/merchant/payments/BK-24823");
  await expect(page.getByTestId("difference-row").first()).toContainText("SGD -324.00");
  g.check();
});

test("Case 2: B-1125-SGD bridge 44,412.30 → 40,228.68, BK-24871 held", async ({ page }) => {
  const g = guard(page);
  await signIn(page, DEMO_USERS.finance);
  await page.goto("/control/merchant/batches/B-1125-SGD");
  await settled(page);
  await expect(page.getByTestId("batch-tied")).toHaveText("Tied to the cent");
  await expect(bars(page)).toHaveText([
    /33 orders, merchant day 2026-11-25.*SGD 44,412\.30/s, /3 orders in the prior batch.*SGD -2,970\.00/s, /Held for review \(BK-24871\).*SGD -1,200\.00/s,
    /2 next-day orders.*SGD 1,620\.00/s, /Gross, batch B-1125-SGD \(31 payments\).*SGD 41,862\.30/s, /Provider fee.*SGD -418\.62/s,
    /Refund \(BK-24788\).*SGD -1,215\.00/s, /Net = bank credit.*SGD 40,228\.68/s,
  ]);
  await expect(page.getByTestId("bridge-exceptions")).toContainText("EX-BK-24871");
  const [held] = await demoQuery<{ decision: string; rule_id: string }>("select decision, rule_id from match_records where order_id = 'BK-24871'");
  expect(held).toEqual({ decision: "exception", rule_id: "M3.batch.held_by_provider" });
  const [ex] = await demoQuery<{ owner_role: string; reason: string; next_step: string; status: string; owner: string }>("select x.owner_role, x.reason, x.next_step, x.status, u.email owner from recon_exceptions x join users u on u.id = x.owner_user_id where x.id = 'EX-BK-24871'");
  expect(ex.status).toBe("open");
  expect(ex.owner).toBe(DEMO_USERS.finance);
  expect(ex.owner_role.length * ex.reason.length * ex.next_step.length).toBeGreaterThan(0);
  const [b] = await demoQuery<{ net: string }>("select net_minor::text net from settlement_batches where batch_id = 'B-1125-SGD'");
  expect(b.net).toBe("4022868");
  g.check();
});

test("Case 3: BK-25102, two parts on two chains, AED 14.16 explained", async ({ page }) => {
  const g = guard(page);
  const [m] = await demoQuery<{ decision: string; rule_id: string; open: string; credited: string }>("select decision, rule_id, ledger->>'openBalanceMinor' open, ledger->>'creditedMinor' credited from match_records where order_id = 'BK-25102'");
  expect(m).toEqual({ decision: "matched_with_difference", rule_id: "M4.tolerance.within_band", open: "1416", credited: "1835084" });
  const diffs = await demoQuery<{ type: string; amount: string; reason: string }>("select type, amount_minor::text amount, reason from differences where id in (select jsonb_array_elements(explanation->'differences')->>'persistedId' from match_records where order_id = 'BK-25102') order by type");
  expect(diffs.map((d) => [d.type, d.amount])).toEqual([["rate_difference", "-130"], ["underpayment", "-1286"]]);
  // display text names each part's token (one part is USDC), not only the quote's
  expect(diffs.find((d) => d.type === "underpayment")!.reason).toBe("Customer paid 3,000.00 USDT + 1,996.50 USDC (4,996.50 together) of 5,000.00 USDT (0.1% short). AED 12.86 at the quoted rate is still owed.");
  await signIn(page, DEMO_USERS.finance);
  await page.goto("/control/merchant/payments/BK-25102");
  await expect(page.getByRole("heading", { name: "Paid in 2 parts on 2 chains" })).toBeVisible();
  await expect(page.getByTestId("part")).toHaveText([/3,000\.00 USDT on TRON/, /1,996\.50 USDC on Ethereum/]);
  await expect(page.getByTestId("parts-gap")).toContainText("The AED 14.16 still open is underpayment of AED 12.86");
  await expect(page.getByTestId("parts-gap")).toContainText("rate difference of AED 1.30");
  g.check();
});

test("the seed is on the demo calendar: no machine-clock times, the BK-25102 write-off approved after its payments", async () => {
  const cols = await demoQuery<{ t: string; c: string }>("select table_name t, column_name c from information_schema.columns where table_schema = 'public' and data_type like 'timestamp%' and column_default ilike '%now()%' order by 1, 2");
  expect(cols.length).toBeGreaterThan(10);
  const outside: string[] = [];
  for (const { t, c } of cols) {
    const [r] = await demoQuery<{ n: number }>(`select count(*)::int n from "${t}" where "${c}" < '2026-11-08T00:00:00Z' or "${c}" > '2026-12-08T02:00:00Z'`);
    if (r.n) outside.push(`${t}.${c}: ${r.n}`);
  }
  expect(outside, "database-stamped times outside the demo window 2026-11-08 … 2026-12-08 10:00 SGT").toEqual([]);
  const [wo] = await demoQuery<{ requested: string; decided: string; paid: string }>(`select r.created_at::text requested, d.created_at::text decided,
      (select max((t->>'timestamp')::timestamptz) from match_records m, jsonb_array_elements(m.chain->'transfers') t where m.order_id = 'BK-25102')::text paid
    from approval_requests r join approval_decisions d on d.request_id = r.id where r.subject_id like 'WO-BK-25102@%'`);
  expect(Date.parse(wo.decided)).toBeGreaterThanOrEqual(Date.parse(wo.requested));
  expect(Date.parse(wo.requested)).toBeGreaterThan(Date.parse(wo.paid));
  expect(wo.decided.slice(0, 10)).toBe("2026-12-08");
});
