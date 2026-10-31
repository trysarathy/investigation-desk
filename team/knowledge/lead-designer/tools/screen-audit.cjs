// Screen + accessibility audit for any served page set (website or product).
// Usage: NODE_PATH=$(npm root -g) node screen-audit.cjs <baseUrl> <outDir> <path> [<path> ...]
//   optional env: AXE=/path/to/node_modules/axe-core/axe.min.js  (runs axe-core WCAG 2.x A/AA rules too)
// For each path, at 1280x800 and 390x844: full-page screenshot (after scrolling so scroll-reveal content shows),
// horizontal-overflow check, rendered-text contrast (computed colour vs nearest opaque background),
// target-size check (WCAG 2.2 2.5.8: 24x24 CSS px, or spacing exception), focus-visible check on the
// first 15 tab stops, and reduced-motion check (animations stop when prefers-reduced-motion: reduce).
// Writes <outDir>/audit.json and prints a summary. Never point it at a site you don't own.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [base, outDir, ...paths] = process.argv.slice(2);
if (!base || !outDir || !paths.length) { console.error("usage: screen-audit.cjs <baseUrl> <outDir> <path>..."); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const VIEWPORTS = [{ name: "desktop-1280", width: 1280, height: 800 }, { name: "phone-390", width: 390, height: 844 }];

async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0); await new Promise((r) => setTimeout(r, 900));
  });
}

// Runs in the page: contrast of every visible text node's element against its nearest opaque ancestor background.
function pageContrast() {
  const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const blend = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  function bgOf(el) {
    const layers = []; let hasImage = false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") hasImage = true;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    const root = parse(getComputedStyle(document.body).backgroundColor); if (root && root.a === 1 && !layers.some((l) => l.a === 1)) layers.push(root);
    for (let i = layers.length - 1; i >= 0; i--) out = layers[i].a >= 1 ? layers[i] : blend(layers[i], out);
    return { c: out, hasImage };
  }
  const seen = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    if (el.closest("[aria-hidden=true], .sr-only")) continue;
    let fg = parse(cs.color); if (!fg) continue;
    if (cs.webkitTextFillColor && cs.webkitTextFillColor.includes("rgba(0, 0, 0, 0)")) continue; // gradient-clipped text: check by eye
    const { c: bg, hasImage } = bgOf(el);
    if (fg.a < 1) fg = blend(fg, bg);
    const l1 = L(fg), l2 = L(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
    const key = `${hex(fg)}|${hex(bg)}|${size}|${weight}`;
    const rec = seen.get(key) || { fg: hex(fg), bg: hex(bg), size, weight, ratio: +ratio.toFixed(2), need, pass: ratio >= need, bgImage: hasImage, count: 0, sample: t.textContent.trim().slice(0, 60) };
    rec.count++; seen.set(key, rec);
  }
  return [...seen.values()].sort((a, b) => a.ratio - b.ratio);
}

function pageTargets() {
  const out = [];
  const els = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex='-1'])")];
  const rects = els.map((e) => e.getBoundingClientRect());
  els.forEach((e, i) => {
    const r = rects[i]; const cs = getComputedStyle(e);
    if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || e.closest(".sr-only")) return;
    if (r.width >= 24 && r.height >= 24) return;
    // inline links inside a sentence are exempt (WCAG 2.5.8 "Inline" exception)
    const inline = cs.display === "inline" && e.parentElement && e.parentElement.textContent.trim().length > e.textContent.trim().length + 10;
    // spacing exception: a 24px circle centred on the target must not overlap another target
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const crowded = rects.some((o, j) => j !== i && o.width && o.height && Math.max(o.left - cx, 0, cx - o.right) ** 2 + Math.max(o.top - cy, 0, cy - o.bottom) ** 2 < 12 * 12);
    out.push({ text: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), inline, spacingOk: !crowded });
  });
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const report = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    for (const p of paths) {
      const page = await ctx.newPage();
      const url = base.replace(/\/$/, "") + p;
      await page.goto(url, { waitUntil: "networkidle" });
      await scrollThrough(page);
      const slug = (p.replace(/\//g, "-").replace(/^-|-$/g, "") || "home") + "-" + vp.name;
      await page.screenshot({ path: path.join(outDir, slug + ".png"), fullPage: true });
      const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, offenders: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== "fixed").slice(0, 5).map((e) => e.tagName + "." + String(e.className).slice(0, 40)) }));
      const contrast = await page.evaluate(pageContrast);
      const targets = await page.evaluate(pageTargets);
      // focus: tab through the first 15 stops; record whether an outline or box-shadow is visible
      const focus = [];
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("Tab");
        const f = await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { el: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 ? `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` : "none", boxShadow: cs.boxShadow !== "none", border: cs.borderColor }; });
        if (f) focus.push(f);
      }
      let axe = null;
      if (process.env.AXE) {
        await page.addScriptTag({ path: process.env.AXE });
        axe = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) })); });
      }
      report.push({ url, viewport: vp.name, screenshot: slug + ".png", overflow, contrastFails: contrast.filter((c) => !c.pass), contrastAll: contrast, smallTargets: targets, focus, axe });
      await page.close();
    }
    await ctx.close();
  }
  // reduced motion: does every running animation stop?
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const rmPage = await rm.newPage();
  await rmPage.goto(base.replace(/\/$/, "") + paths[0], { waitUntil: "networkidle" });
  const running = await rmPage.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").map((a) => (a.animationName || a.constructor.name) + " on " + (a.effect && a.effect.target ? a.effect.target.className : "?")));
  const smooth = await rmPage.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
  report.push({ reducedMotion: { path: paths[0], runningAnimations: running, scrollBehavior: smooth } });
  await browser.close();
  fs.writeFileSync(path.join(outDir, "audit.json"), JSON.stringify(report, null, 2));
  for (const r of report) {
    if (r.reducedMotion) { console.log("reduced-motion:", JSON.stringify(r.reducedMotion)); continue; }
    console.log(`\n${r.url} @ ${r.viewport}: scrollWidth ${r.overflow.scrollWidth} / clientWidth ${r.overflow.clientWidth}${r.overflow.scrollWidth > r.overflow.clientWidth ? " HORIZONTAL SCROLL " + r.overflow.offenders.join(", ") : " (no horizontal scroll)"}`);
    console.log(`  text pairs checked: ${r.contrastAll.length}; failing: ${r.contrastFails.length}`); r.contrastFails.slice(0, 8).forEach((c) => console.log(`   FAIL ${c.fg} on ${c.bg} ${c.ratio}:1 (needs ${c.need}) ${c.size}px w${c.weight} x${c.count}${c.bgImage ? " [bg image: verify by eye]" : ""} "${c.sample}"`));
    console.log(`  lowest 3: ${r.contrastAll.slice(0, 3).map((c) => `${c.fg}/${c.bg} ${c.ratio}`).join("; ")}`);
    console.log(`  targets < 24px: ${r.smallTargets.length} (${r.smallTargets.filter((t) => !t.inline && !t.spacingOk).length} without inline/spacing exception)`); r.smallTargets.filter((t) => !t.inline && !t.spacingOk).slice(0, 5).forEach((t) => console.log(`   ${t.w}x${t.h} "${t.text}"`));
    console.log(`  focus stops: ${r.focus.length}; without outline or shadow: ${r.focus.filter((f) => f.outline === "none" && !f.boxShadow).map((f) => f.el).join(" | ") || "none"}`);
    if (r.axe) console.log(`  axe violations: ${r.axe.length ? r.axe.map((v) => `${v.id}(${v.impact}) x${v.nodes}`).join(", ") : "none"}`);
  }
})();
