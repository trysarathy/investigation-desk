// Examiner: reproduce the 390px sideways scroll on the wrong-network case and test the one-line fix.
// Usage (app running in demo mode with the demo day loaded): node verify_fix_1044.cjs http://127.0.0.1:3111
const { chromium } = require('playwright');
(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:3111'; const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) for (const w of [390, 1280]) {
    const pg = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    await pg.goto(base + '/requests/DEMO-1044', { waitUntil: 'networkidle' });
    const before = await pg.evaluate(() => document.documentElement.scrollWidth);
    await pg.addStyleTag({ content: '.message p { overflow-wrap: anywhere; }' });
    const after = await pg.evaluate(() => document.documentElement.scrollWidth);
    // Neighbour check for the small "At a glance" breadcrumb target (WCAG 2.5.8 spacing exception).
    const t = await pg.evaluate(() => { const a = [...document.querySelectorAll('a')].filter(x => x.innerText.trim() === 'At a glance').sort((p, q) => p.getBoundingClientRect().height - q.getBoundingClientRect().height)[0]; if (!a) return null; const r = a.getBoundingClientRect(); const c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      let min = 1e9; for (const o of document.querySelectorAll('a,button,input,select,summary')) { if (o === a) continue; const q = o.getBoundingClientRect(); if (!q.width) continue; const dx = Math.max(q.left - c.x, 0, c.x - q.right), dy = Math.max(q.top - c.y, 0, c.y - q.bottom); min = Math.min(min, Math.hypot(dx, dy)); } return `${Math.round(r.width)}x${Math.round(r.height)}, nearest other target edge ${Math.round(min)}px from its centre`; });
    console.log(`${scheme} ${w}px: scrollWidth before ${before}, after fix ${after}; "At a glance" ${t}`);
    await pg.close();
  }
  await b.close();
})();
