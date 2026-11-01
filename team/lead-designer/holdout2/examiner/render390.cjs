// Examiner's Playwright check. SCHEME=dark env renders prefers-color-scheme: dark. Usage: node render390.cjs <static-dir> <path...>
// <static-dir> may be a base URL (e.g. http://127.0.0.1:3111 for `next start`). Serves a static export, loads each path at 390 and 1280, reports horizontal overflow,
// elements wider than the viewport, small interactive targets (<24px) and low-contrast text
// (computed colour vs nearest opaque ancestor background, alpha composited).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = process.argv[2]; const pages = process.argv.slice(3);
const types = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.mp4':'video/mp4','.webm':'video/webm','.json':'application/json' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); let f = path.join(root, p); if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
srv.listen(0, async () => {
  const port = srv.address().port; const base = root.startsWith('http') ? root.replace(/\/$/, '') : `http://127.0.0.1:${port}`; const b = await chromium.launch();
  for (const w of [390, 1280]) for (const p of pages) {
    const pg = await b.newPage({ viewport: { width: w, height: 900 }, reducedMotion: 'reduce', colorScheme: process.env.SCHEME === 'dark' ? 'dark' : 'light' });
    await pg.goto(`${base}${p}`, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(400);
    const r = await pg.evaluate((vw) => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
      const parse = c => { if (!c || c === 'transparent') return null; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const L = a => 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]);
      const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3]));
      const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (getComputedStyle(e).backgroundImage !== 'none') stack.push('img'); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let base = [10, 12, 17]; for (let i = stack.length - 1; i >= 0; i--) if (stack[i] !== 'img') base = over(stack[i], base); return { base, hasImg: stack.includes('img') }; };
      const out = { scrollW: document.documentElement.scrollWidth, wide: [], small: [], lowc: [] };
      for (const el of document.querySelectorAll('body *')) {
        const rc = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || rc.width === 0) continue;
        if (rc.right > vw + 1 && out.wide.length < 12) out.wide.push(`${el.tagName.toLowerCase()}.${(el.className && el.className.baseVal === undefined ? el.className : '').toString().slice(0, 60)} right=${Math.round(rc.right)}`);
        if (el.matches('a,button,input,select,textarea,summary,[role=button]')) { const inline = cs.display === 'inline' && el.closest('p,li'); if (!inline && (rc.width < 24 || rc.height < 24) && out.small.length < 20) out.small.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(rc.width)}x${Math.round(rc.height)}`); }
        const txt = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
        if (txt) { const fg = parse(cs.color); const { base, hasImg } = bgOf(el); const op = parseFloat(cs.opacity); const f = over([fg[0], fg[1], fg[2], fg[3] * (isNaN(op) ? 1 : op)], base); const cr = ratio(f, base); const size = parseFloat(cs.fontSize), wt = parseInt(cs.fontWeight); const large = size >= 24 || (size >= 18.66 && wt >= 700); const need = large ? 3 : 4.5; if (cr < need && out.lowc.length < 30) out.lowc.push(`${cr.toFixed(2)} need ${need} ${size}px/${wt}${hasImg ? ' (bg-image: check by hand)' : ''} "${txt.slice(0, 50)}" color=${cs.color}`); }
      }
      return out;
    }, w);
    console.log(`\n### ${p} @ ${w}px  scrollWidth=${r.scrollW} ${r.scrollW > w ? 'HORIZONTAL SCROLL' : 'ok'}`);
    if (r.wide.length) console.log(' wider than viewport:', r.wide.join(' | '));
    if (r.small.length) console.log(' small targets:', r.small.join(' | '));
    if (r.lowc.length) console.log(' low contrast:\n  ' + r.lowc.join('\n  '));
    await pg.close();
  }
  await b.close(); srv.close();
});
