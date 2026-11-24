import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { a11y, guard, resetDemo, settled, signIn } from "./demo";
import { DEMO_E2E, DEMO_USERS } from "./env";

/*
 * Every page of the demo journey on the demo build, from the seeded state: the median of 5 loads (after one warm-up
 * load; navigation start to the page on screen, streamed parts included) must be under 1 s, and axe (WCAG 2.2 AA)
 * finds nothing at 1280 px and 390 px (390 px on the phone project). The times are written to
 * test-results/demo-page-times-<project>.json and printed. Demo · fictional data.
 */

export const JOURNEY_PAGES: { who: keyof typeof DEMO_USERS; path: string }[] = [
  { who: "finance", path: "/control/sign-in" },
  { who: "finance", path: "/control/merchant/overview" },
  { who: "finance", path: "/control/merchant?date=2026-12-07" },
  { who: "finance", path: "/control/merchant/payments" },
  { who: "finance", path: "/control/merchant/payments?result=exception&network=tron&token=USDT" },
  { who: "finance", path: "/control/merchant/payments?search=BK-24823" },
  { who: "finance", path: "/control/merchant/payments/BK-24823" },
  { who: "finance", path: "/control/merchant/exceptions" },
  { who: "finance", path: "/control/merchant/exceptions/EX-BK-24823" },
  { who: "finance", path: "/control/merchant/approvals" },
  { who: "finance", path: "/control/merchant/batches" },
  { who: "finance", path: "/control/merchant/batches/B-1125-SGD" },
  { who: "finance", path: "/control/merchant/payments/BK-25102" },
  { who: "finance", path: "/control/merchant/month-end?entity=NW-SG&month=2026-11" },
  { who: "finance", path: "/control/merchant/accounting?entity=NW-SG&month=2026-11" },
  { who: "finance", path: "/control/merchant/evidence" },
  { who: "finance", path: "/control/merchant/uploads" },
  { who: "finance", path: "/control/merchant/runs" },
  { who: "finance", path: "/control/merchant/settings" },
  { who: "approver", path: "/control/merchant/approvals" },
  { who: "ops", path: "/control/merchant/provider" },
  { who: "ops", path: "/control/merchant/provider/pilot" },
];

async function timed(page: Page, url: string): Promise<number> {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load" });
  await settled(page);
  return Date.now() - t0;
}

test("every journey page: median of 5 loads under 1 s, and axe finds nothing", async ({ page }, info) => {
  test.setTimeout(900_000);
  resetDemo();
  const g = guard(page);
  const results: { who: string; path: string; medianMs: number; loadsMs: number[] }[] = [];
  let who: string | null = null;
  for (const p of JOURNEY_PAGES) {
    if (p.path !== "/control/sign-in" && who !== p.who) {
      if (who) await page.context().clearCookies();
      await signIn(page, DEMO_USERS[p.who]);
      who = p.who;
    }
    if (p.path === "/control/sign-in") await page.context().clearCookies();
    await timed(page, p.path); // warm-up
    const loads: number[] = [];
    for (let i = 0; i < 5; i++) loads.push(await timed(page, p.path));
    const medianMs = [...loads].sort((a, b) => a - b)[2];
    results.push({ who: p.who, path: p.path, medianMs, loadsMs: loads });
    // the sign-in page has no organisation, so it carries the demo label in its own words
    await a11y(page, info, `${p.path} as ${p.who}`, { label: p.path === "/control/sign-in" ? /^Demo · fictional data: / : undefined });
    g.check();
  }
  const out = path.join(DEMO_E2E.root, "test-results", `demo-page-times-${info.project.name}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ project: info.project.name, at: new Date().toISOString(), results }, null, 2)}\n`);
  console.log(results.map((r) => `${String(r.medianMs).padStart(5)} ms  ${r.who.padEnd(8)} ${r.path}`).join("\n"));
  for (const r of results) expect(r.medianMs, `${r.path} as ${r.who}: loads ${r.loadsMs.join(", ")} ms`).toBeLessThan(1000);
});
