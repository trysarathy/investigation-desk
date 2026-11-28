import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, settled, signIn, signOut } from "./helpers";
import { MERCHANT_E2E } from "./env";
import { MERCHANT_PAGES, reconciledDemo } from "./setup";

/*
 * design-fluid quality gate (runs only with CLEARLINE_SCREENS=1): every merchant workspace screen, in the light and the
 * dark theme, at 1280 px and 390 px wide. Each one has no horizontal scroll and no axe violation (WCAG 2.2 AA incl.
 * colour contrast computed by axe from the rendered colours). A screenshot of each is saved to
 * CLEARLINE_SCREENS_DIR (default docs/design/screenshots). Fictional seed data only.
 */
const THEME_COOKIE = process.env.CLEARLINE_THEME_COOKIE ?? "clearline_theme";
const OUT = path.resolve(process.env.CLEARLINE_SCREENS_DIR ?? "docs/design/screenshots");
const WIDTHS = [1280, 390] as const;
const FINANCE_PAGES = [...new Set([
  "/control/merchant/overview", ...MERCHANT_PAGES, "/control/merchant/uploads", "/control/merchant/getting-started",
  "/control/merchant/ledger", "/control/merchant/posting-rules", "/control/merchant/notifications", "/control/security",
])];
const ADMIN_PAGES = ["/control/merchant/admin", "/control/merchant/setup", "/control/merchant/access-review", "/control/merchant/settings"];
const PUBLIC_PAGES = ["/control/sign-in"];

const slug = (p: string) => p.replace(/^\/control\/?/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "control";

async function check(page: Page, theme: string, p: string, failures: string[]) {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
    const r = await page.goto(p);
    if (!r || r.status() >= 400) { failures.push(`${theme} ${w} ${p}: HTTP ${r?.status()}`); continue; }
    await settled(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme ?? "light"), `${p} theme`).toBe(theme);
    const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    if (o.scroll > o.client) failures.push(`${theme} ${w} ${p}: horizontal scroll ${o.scroll} > ${o.client}`);
    try { await expectNoAxeViolations(page, `${theme} ${w} ${p}`); } catch (e) { failures.push(`${theme} ${w} ${p}: ${(e as Error).message.split("\n").slice(0, 6).join(" | ")}`); }
    await page.screenshot({ path: path.join(OUT, `${theme}-${w}-${slug(p)}.jpg`), fullPage: false, type: "jpeg", quality: 70 });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`every screen, ${theme} theme, 1280 and 390 px: no horizontal scroll, no axe violation`, async ({ page }, info) => {
    test.skip(process.env.CLEARLINE_SCREENS !== "1" || info.project.name !== "desktop", "design gate: CLEARLINE_SCREENS=1, run once");
    test.setTimeout(1_800_000);
    mkdirSync(OUT, { recursive: true });
    const origin = new URL(MERCHANT_E2E.origin);
    await page.context().addCookies([{ name: THEME_COOKIE, value: theme, domain: origin.hostname, path: "/" }]);
    const failures: string[] = [];
    if (theme === "light") await reconciledDemo(page, info);
    for (const p of PUBLIC_PAGES) await check(page, theme, p, failures);
    await signIn(page, "finance@straits-demo.example", info);
    for (const p of FINANCE_PAGES) await check(page, theme, p, failures);
    await signOut(page);
    await signIn(page, "admin@straits-demo.example", info);
    for (const p of ADMIN_PAGES) await check(page, theme, p, failures);
    await signOut(page);
    info.attachments.push({ name: `failures-${theme}`, contentType: "text/plain", body: Buffer.from(failures.join("\n") || "none") });
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
