/* Recipient test for the exported tester edition.
 * node tests/browser/recipient.cjs /absolute/path/to/export [http://127.0.0.1:PORT/]  (second arg optional)
 * Opens the exported copy (file:// and, if given, a static HTTP origin) in a fresh browser context and checks
 * what a tester sees. Never uses the Python development server. */
const {chromium} = require('playwright');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const dir = process.argv[2];
const httpBase = process.argv[3];
const shotDir = process.env.SHOTS || '';
let pass = 0; const fails = [];
function check(name, ok, detail) { if (ok) { pass++; console.log('PASS ' + name); } else { fails.push(name); console.log('FAIL ' + name + (detail ? ' :: ' + detail : '')); } }

async function run(url, label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({viewport: {width: 1366, height: 768}});
  const page = await ctx.newPage();
  const errors = [], remote = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const u = r.url(); if (!(u.startsWith('file:') || (httpBase && u.startsWith(httpBase)))) remote.push(u); });
  await page.goto(url);
  const wait = () => page.waitForFunction(() => !document.body.hasAttribute('aria-busy') && document.querySelector('#headline')?.textContent);
  const headline = async () => (await page.locator('#headline').innerText()).trim();
  const everything = async () => page.evaluate(() => {
    const attrs = [];
    document.querySelectorAll('*').forEach(e => { for (const a of ['title', 'aria-label', 'data-tip']) { const v = e.getAttribute(a); if (v) attrs.push(v); } });
    return document.documentElement.outerHTML + '\n' + attrs.join('\n');
  });
  const pick = async (scenario, time, rate) => {
    if (scenario) { await page.selectOption('#scenario', scenario); await wait(); }
    if (time) { await page.click('#dt-' + time); await wait(); }
    if (rate) { await page.click('[data-rate="' + rate + '"]'); await wait(); }
  };
  await wait();

  // First screen, reference Friday, above the fold at 1366x768
  check(label + ': opens on Friday reference: Keep Friday’s funding window', /Keep Friday’s funding window/.test(await headline()));
  const fold = await page.evaluate(() => {
    const vis = sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.height > 0; };
    return {route: vis('#fact-route'), net: vis('#fact-net'), deadline: vis('#fact-deadline'), headline: vis('#headline'),
            time: !!document.querySelector('#dt-friday[aria-checked="true"], #dt-friday.is-selected'), banner: vis('#banner')};
  });
  check(label + ': route, USD amount, deadline (SGT + New York), decision time, headline and banner above the fold',
        fold.route && fold.net && fold.deadline && fold.headline && fold.time && fold.banner, JSON.stringify(fold));
  const pay = await page.locator('#payment-body').innerText();
  check(label + ': payment card shows corridor, USD 100,000.00 net and both time zones',
        /Singapore → United States/.test(pay) && /USD 100,000\.00 net/.test(pay) && /23:00 SGT/.test(pay) && /10:00 EST/.test(pay));
  const fri = await everything();
  check(label + ': Friday shows no 78.77, 88.77 or Monday records', !/78\.77|88\.77|405,000|Q-MON|CAP-MON|CASH-MON/.test(fri));
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'tester-first-screen-laptop.png')});

  // Retrospective at 8% and 0%
  await pick(null, 'retro', '8');
  const comp = await page.locator('#comparison').innerText();
  check(label + ': retro 8% shows 3 fewer days, 405,000 SGD-days, 88.77 − 10.00 = 78.77, hindsight label',
        /405,000/.test(comp) && /88\.77/.test(comp) && /10\.00/.test(comp) && /78\.77/.test(comp) && /Hindsight/i.test(comp) && /5 days vs/.test(comp) && /2 days/.test(comp));
  check(label + ': retro never calls it a saving', !/sav(e|ing)/i.test(await page.locator('main').innerText()));
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'tester-retrospective-laptop.png'), fullPage: true});
  await pick(null, null, '0');
  check(label + ': retro 0%: waiting costs SGD 10.00 more', /waiting costs SGD 10\.00 more/.test(await page.locator('#comparison').innerText()));
  await pick(null, null, '8');

  // Friday → retro → Friday clears hindsight everywhere
  await pick(null, 'friday');
  check(label + ': back to Friday removes the retrospective result everywhere (page, attributes, evidence)', !/78\.77|88\.77|405,000|Q-MON|CAP-MON/.test(await everything()));
  check(label + ': comparison panel empty on Friday', (await page.locator('#comparison').innerText()).trim() === '');

  // Monday delayed receipt
  await pick('delayed_receivable', 'monday');
  const main1 = await page.locator('main').innerText();
  check(label + ': delayed receipt Monday: 130,000.00 vs 135,382.50, short 5,382.50',
        /130,000\.00/.test(main1) && /135,382\.50/.test(main1) && /5,382\.50/.test(main1) && /would have been short/i.test(await headline()));
  check(label + ': delayed receipt: no economic comparison on Monday', (await page.locator('#comparison').innerText()).trim() === '');
  await pick(null, 'retro');
  check(label + ': delayed receipt retro: Tuesday receipt cannot finance Monday', /Tuesday receipt cannot finance Monday/.test(await page.locator('main').innerText()));

  // Monday stale balance
  await pick('stale_balance', 'monday');
  const main2 = await page.locator('main').innerText();
  check(label + ': stale balance: asks for a newer balance, 73 h 00 min vs 24 h demo policy, not short',
        (await headline()) === 'We need a newer bank balance to assess Monday’s funding.' && /73 h 00 min/.test(main2) &&
        /24 h before the funding slot \(demo policy\)/.test(main2) && /does not show the account is short/.test(main2));
  check(label + ': stale balance: no Feasible chip for Monday and no comparison',
        !(await page.locator('.status-chip-feasible').allInnerTexts()).length || !/Feasible/.test((await page.locator('#options').innerText()).split('Fund Mon')[1] || ''));
  if (shotDir) await page.screenshot({path: path.join(shotDir, 'tester-stale-balance-laptop.png')});

  // Pre-agreed Friday
  await pick('preagreed', 'friday');
  const main3 = await page.locator('main').innerText();
  check(label + ': pre-agreed Friday: Manual review before waiting, reservation cost as a question, no figure',
        /Manual review before waiting/.test(await headline()) && /reservation cost SGD 25\.00/.test(main3) && !/53\.77|88\.77/.test(await everything()));

  // No green tick on simulated delivery
  await pick('reference', 'retro');
  const simOk = await page.evaluate(() => [...document.querySelectorAll('.check')].filter(li => /Simulated delivery/.test(li.innerText)).every(li => li.classList.contains('check-simulated')));
  check(label + ': simulated delivery bound is never shown as a green tick', simOk);

  // Every scenario x checkpoint x preset renders; no clipped amounts; phone layout
  const scenarios = await page.locator('#scenario option').evaluateAll(xs => xs.map(x => x.value));
  let states = 0, clipped = [];
  for (const s of scenarios) for (const t of ['friday', 'monday', 'retro']) for (const r of ['0', '8']) {
    await pick(s, t, r); states++;
    const c = await page.evaluate(() => [...document.querySelectorAll('.num, dd, .fact-main')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').map(e => e.textContent.trim().slice(0, 40)));
    if (c.length) clipped.push(s + '/' + t + '/' + r + ': ' + c.join('|'));
    if (!(await headline())) clipped.push(s + '/' + t + '/' + r + ': no headline');
  }
  check(label + ': all ' + states + ' scenario × checkpoint × preset states render without clipped amounts', !clipped.length && states === scenarios.length * 6, clipped.slice(0, 3).join(' ; '));

  // Keyboard: decision time reachable and switchable with the keyboard
  await pick('reference', 'friday', '8');
  await page.focus('#dt-friday'); await page.keyboard.press('ArrowRight'); await wait();
  const kb = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check(label + ': keyboard arrow moves decision time (focus on ' + kb + ')', kb === 'dt-monday' && /would have been feasible/.test(await headline()));
  await page.keyboard.press('Tab');
  check(label + ': visible focus ring on keyboard focus', await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return s.outlineStyle !== 'none' || s.boxShadow !== 'none'; }));

  // Contrast (WCAG AA 4.5:1) on key text
  const contrast = await page.evaluate(() => {
    function rgb(c) { const m = c.match(/[\d.]+/g).map(Number); return m; }
    function lum([r, g, b]) { return [r, g, b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0); }
    function bg(e) { while (e) { const c = getComputedStyle(e).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; e = e.parentElement; } return 'rgb(255,255,255)'; }
    const out = [];
    for (const sel of ['#headline', '.reason', '#fact-net .fact-main', '#fact-deadline .fact-sub', '.fact-label', '.as-of', '#banner', '.qa dt', '.qa dd', '.check-detail', 'table.evidence td', '.footer']) {
      const e = document.querySelector(sel); if (!e) continue;
      const a = lum(rgb(getComputedStyle(e).color)), b = lum(rgb(bg(e)));
      out.push([sel, ((Math.max(a, b) + .05) / (Math.min(a, b) + .05)).toFixed(2)]);
    }
    return out;
  });
  const low = contrast.filter(([, r]) => Number(r) < 4.5);
  check(label + ': text contrast ≥ 4.5:1 on key elements', !low.length, JSON.stringify(low));

  // Phone width
  await page.setViewportSize({width: 390, height: 844});
  let wide = [];
  for (const [s, t] of [['reference', 'friday'], ['reference', 'retro'], ['stale_balance', 'monday'], ['delayed_receivable', 'monday']]) {
    await pick(s, t);
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))) wide.push(s + '/' + t);
  }
  check(label + ': phone 390 px: no horizontal scroll', !wide.length, wide.join(','));
  if (shotDir) { await pick('reference', 'friday'); await page.screenshot({path: path.join(shotDir, 'tester-first-screen-phone.png')}); }

  check(label + ': no remote requests', !remote.length, remote.slice(0, 3).join(','));
  check(label + ': no browser errors', !errors.length, errors.slice(0, 3).join(','));
  check(label + ': CSV upload and Data panel not offered', !(await page.locator('#open-data').isVisible()) && !(await page.locator('#data').isVisible()));
  await browser.close();
}

(async () => {
  await run(pathToFileURL(path.resolve(dir, 'index.html')).href, 'file://');
  if (httpBase) await run(httpBase, 'static http');
  console.log('\n' + pass + '/' + (pass + fails.length) + ' recipient checks passed');
  if (fails.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
