// Load-time + a11y + keyboard baseline for Clearline's finance-controller screens.
// Usage: AXE=<axe.min.js> NODE_PATH=$(npm root -g) node measure.cjs <baseUrl> <outDir> <n> route...
// Method: Chromium headless, 1280x800, local `next start` production build, demo data loaded.
// Per route: 1 warm-up navigation (discarded), then n navigations, each in a fresh browser context
// (empty HTTP cache, warm server). Metrics from the Navigation Timing and LCP APIs. Median reported.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [base, out, nStr, ...routes] = process.argv.slice(2);
const N = Number(nStr || 5);
const CPU = Number(process.env.CPU || 1); // CDP CPU throttling rate (1 = none)
const AXE = process.env.AXE;
fs.mkdirSync(out, { recursive: true });
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const slug = (r) => r.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/-+$/, "").slice(0, 60) || "root";

async function timeOnce(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  if (CPU > 1) { const c = await ctx.newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: CPU }); }
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = Math.max(window.__lcp, e.startTime); })
      .observe({ type: "largest-contentful-paint", buffered: true });
  });
  const resp = await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(300); // let the LCP entry land
  const m = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, lcp: window.__lcp, finalUrl: location.pathname + location.search };
  });
  m.status = resp ? resp.status() : 0;
  await ctx.close();
  return m;
}

async function a11y(browser, url, name, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(out, `${name}-${width}.png`), fullPage: true });
  const res = { width };
  res.hscroll = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  res.demoLabel = await page.evaluate(() => /Demo data|Demo mode/.test(document.body.innerText));
  if (AXE) {
    await page.addScriptTag({ path: AXE });
    const r = await page.evaluate(async () => {
      const x = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
      return x.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(" "), summary: (n.failureSummary || "").split("\n").slice(1, 2).join(" ").slice(0, 160) })) }));
    });
    res.axe = r;
  }
  if (width === 1280) {
    // Keyboard: Tab through the page; record each stop, whether focus is visible, and traps.
    const focusables = await page.evaluate(() => [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
      .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return (r.width > 0 || r.height > 0) && s.visibility !== "hidden"; }).length);
    const stops = []; let same = 0, last = null, trap = false, wrapped = false;
    for (let i = 0; i < Math.min(focusables + 5, 150); i++) {
      await page.keyboard.press("Tab");
      const s = await page.evaluate(() => {
        const e = document.activeElement; if (!e || e === document.body) return { body: true };
        const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
        const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
        const id = e.tagName + "|" + (e.getAttribute("href") || e.getAttribute("data-testid") || e.getAttribute("aria-label") || (e.textContent || "").trim().slice(0, 40));
        return { id, visible, w: Math.round(r.width), h: Math.round(r.height) };
      });
      if (s.body) { wrapped = true; break; }
      if (s.id === last) { same++; if (same >= 3) { trap = true; break; } } else same = 0;
      last = s.id; stops.push(s);
    }
    const ids = new Set(stops.map((s) => s.id));
    res.keyboard = { focusables, stops: stops.length, unique: ids.size, focusInvisible: stops.filter((s) => !s.visible).map((s) => s.id).slice(0, 10), invisibleCount: stops.filter((s) => !s.visible).length, trap, reachedEnd: wrapped };
  }
  await ctx.close();
  return res;
}

(async () => {
  const browser = await chromium.launch();
  const all = [];
  for (const r of routes) {
    const url = base + r;
    await timeOnce(browser, url); // warm-up (compiles nothing in prod; warms server caches)
    const runs = [];
    for (let i = 0; i < N; i++) runs.push(await timeOnce(browser, url));
    const row = { route: r, finalUrl: runs[0].finalUrl, status: runs[0].status, n: N, cpu: CPU,
      median: { ttfb: median(runs.map((x) => x.ttfb)), dcl: median(runs.map((x) => x.dcl)), load: median(runs.map((x) => x.load)), lcp: median(runs.map((x) => x.lcp)) },
      max: { load: Math.max(...runs.map((x) => x.load)), lcp: Math.max(...runs.map((x) => x.lcp)) }, runs };
    if (!process.env.TIMING_ONLY) {
      row.a11y = [await a11y(browser, url, slug(r), 1280, 800), await a11y(browser, url, slug(r), 390, 844)];
    }
    all.push(row);
    const ax = row.a11y ? row.a11y.map((a) => (a.axe || []).map((v) => `${v.id}x${v.nodes}`).join(",") || "0").join(" | ") : "";
    console.log(`${r} -> ${row.finalUrl} [${row.status}] ttfb ${row.median.ttfb.toFixed(0)} dcl ${row.median.dcl.toFixed(0)} load ${row.median.load.toFixed(0)} lcp ${row.median.lcp.toFixed(0)} (max load ${row.max.load.toFixed(0)}) ${ax}`);
  }
  fs.writeFileSync(path.join(out, process.env.OUTFILE || "measure.json"), JSON.stringify(all, null, 2));
  await browser.close();
})();
