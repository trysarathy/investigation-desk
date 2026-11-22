import { expect, test } from "@playwright/test";
import { settled, signIn } from "./helpers";
import { MERCHANT_PAGES, reconciledDemo } from "./setup";

/*
 * Load time on the local production build (`next start`) with the seeded, reconciled demo: for every page, five full
 * navigations; the median (from navigation start until the page is on screen with no loading state) must be under
 * one second. Results are attached to the test and printed.
 */
test("every merchant page loads in under 1 s (median of 5)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "measured once, at desktop size");
  test.setTimeout(600_000);
  await reconciledDemo(page, info);
  await signIn(page, "finance@straits-demo.example", info);
  const rows: { path: string; samples: number[]; median: number }[] = [];
  for (const path of MERCHANT_PAGES) {
    await page.goto(path); // warm-up (first compile of the route's server bundle)
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await page.goto(path);
      await settled(page);
      samples.push(Date.now() - t0);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    rows.push({ path, samples, median: sorted[2] });
  }
  const table = rows.map((r) => `${String(r.median).padStart(5)} ms  ${r.path}  [${r.samples.join(", ")}]`).join("\n");
  console.log(`merchant page load (median of 5):\n${table}`);
  await info.attach("load-times.json", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
  for (const r of rows) expect(r.median, r.path).toBeLessThan(1000);
});
