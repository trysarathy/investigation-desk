// Examiner: page scrollWidth at given widths for a list of paths. Usage: node widths.cjs <baseURL> <w,w> <path...>
const { chromium } = require('playwright');
(async () => { const [base, ws, ...paths] = process.argv.slice(2); const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) for (const w of ws.split(',').map(Number)) { const out = [];
    for (const p of paths) { const pg = await b.newPage({ viewport: { width: w, height: 900 }, colorScheme: scheme }); await pg.goto(base + p, { waitUntil: 'networkidle' }); const sw = await pg.evaluate(() => document.documentElement.scrollWidth); if (sw > w) out.push(`${p} ${sw}`); await pg.close(); }
    console.log(`${scheme} ${w}: overflow on ${out.length}/${paths.length}${out.length ? ': ' + out.join(', ') : ''}`); }
  await b.close(); })();
