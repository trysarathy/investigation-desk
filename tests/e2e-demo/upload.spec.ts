import { expect, test } from "@playwright/test";
import { a11y, guard, resetDemo, settled, signIn } from "./demo";
import { decisionsOf, demoQuery } from "./db";
import { DEMO_USERS } from "./env";
import { EXPECTED, liveUpload } from "./upload";

/*
 * The live upload of demo-files/ on its own (step 11 of the journey), from the seeded state, through the browser as a
 * presenter does it: the outcomes must be exactly demo-files/expected-outcomes.json (written by
 * tests/control/demo.test.ts through the services): rows per file, decisions before and after, every decision and
 * rule, each new order's result, the two batches tied but not verified (imported, not bank-authenticated), and the
 * statement lines stored as imported. Demo · fictional data.
 */
test("demo-files give exactly expected-outcomes.json", async ({ page }, info) => {
  test.setTimeout(900_000);
  resetDemo();
  const g = guard(page);
  const check = async (where: string) => { await a11y(page, info, where); g.check(); };
  expect(await decisionsOf("NW-SG")).toEqual(EXPECTED.decisionsBefore);
  await signIn(page, DEMO_USERS.finance);
  const ids = await liveUpload(page, check);

  // every file's rows, as validated and as brought in
  const ups = await demoQuery<{ id: string; original_name: string; row_count: number; accepted_count: number; rejected_count: number; warning_count: number; duplicate_count: number; status: string }>(
    "select id, original_name, row_count, accepted_count, rejected_count, warning_count, duplicate_count, status from uploads where id = any($1::uuid[])", [Object.values(ids)]);
  expect(ups).toHaveLength(3);
  for (const u of ups) {
    const want = EXPECTED.uploads[u.original_name];
    expect(want, u.original_name).toBeTruthy();
    expect({ rows: u.row_count, accepted: u.accepted_count, rejected: u.rejected_count, warning: u.warning_count, duplicate: u.duplicate_count }, u.original_name).toEqual(want.rows);
    expect(u.status, u.original_name).toBe("normalised");
  }
  // decisions and rules after one reconciliation of NW-SG
  expect(await decisionsOf("NW-SG")).toEqual(EXPECTED.decisionsAfter);
  expect(await decisionsOf("NW-SG", true)).toEqual(EXPECTED.rulesAfter);
  const run = await demoQuery<{ matched: number; with_difference: number; review: number; exceptions: number; unpaid: number; kept: number; notices: number }>("select matched, with_difference, review, exceptions, unpaid, kept, notices from reconciliation_runs where entity_id = 'NW-SG' and trigger <> 'schedule'");
  expect(run).toHaveLength(1); // the presenter's one "Run reconciliation for NW-SG" (the seed's runs are scheduled)
  expect({ matched: run[0].matched, withDifference: run[0].with_difference, review: run[0].review, exceptions: run[0].exceptions, unpaid: run[0].unpaid, kept: run[0].kept, notices: run[0].notices }).toEqual(EXPECTED.run.runCounts);
  const orders = await demoQuery<{ order_id: string; k: string }>("select order_id, decision || ' ' || rule_id k from match_records where order_id like 'BK-390%' order by 1");
  expect(Object.fromEntries(orders.map((r) => [r.order_id, r.k]))).toEqual(EXPECTED.newOrders);
  expect(await demoQuery("select source, count(*)::int n from bank_lines where value_date = '2026-12-08' group by 1")).toEqual([{ source: "file_import", n: 2 }]);

  // the two batches the statement ties: tied, never verified, labelled as imported
  for (const [batch, want] of Object.entries(EXPECTED.batches)) {
    await page.goto(`/control/merchant/batches/${batch}`);
    await settled(page);
    await expect(page.getByTestId("batch-tied"), batch).toHaveText(want.tied ? "Tied to the cent" : /not tied/i);
    await expect(page.locator("#main"), batch).toContainText(want.bankLineLabel);
    await check(`batch ${batch}`);
  }
  // the underpaid one on its own page
  await page.goto("/control/merchant/payments/BK-39021");
  await expect(page.getByTestId("deciding-step")).toContainText(EXPECTED.newOrders["BK-39021"].split(" ")[1]);
  await check("payment BK-39021");
});
