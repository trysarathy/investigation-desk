#!/usr/bin/env node
/*
 * End-to-end browser test for the funding decision replay interface.
 *
 *   node tests/browser/e2e.cjs            # starts the real server: python3 app/server.py --port N
 *   FR_STUB=1 node tests/browser/e2e.cjs  # uses tests/browser/stub_server.py instead (interface dev only)
 *
 * Uses the preinstalled Node Playwright (require('playwright')). Exit code 0 only if every check passes.
 * Screenshots are written to docs/screenshots/.
 */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const REAL = path.join(ROOT, 'app', 'server.py');
const STUB = path.join(__dirname, 'stub_server.py');
const useStub = !!process.env.FR_STUB || !fs.existsSync(REAL);

const results = [];
function check(name, cond, info) {
  results.push({ name, ok: !!cond, info });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + info));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

function waitForServer(port, ms) {
  const deadline = Date.now() + ms;
  return new Promise((resolve, reject) => {
    (function poll() {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/meta' }, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error('server did not start on port ' + port));
        else setTimeout(poll, 150);
      });
    })();
  });
}

// Wait until the UI has finished an evaluate round-trip and rendered a decision.
async function settled(page) {
  await page.waitForFunction(() => !document.body.hasAttribute('aria-busy') &&
    document.getElementById('headline') && document.getElementById('headline').textContent.trim().length > 0, null, { timeout: 10000 });
}

async function pageText(page) {
  return page.evaluate(() => {
    const titles = Array.from(document.querySelectorAll('[title]')).map((n) => n.getAttribute('title')).join('\n');
    const arias = Array.from(document.querySelectorAll('[aria-label]')).map((n) => n.getAttribute('aria-label')).join('\n');
    const values = Array.from(document.querySelectorAll('input,select,textarea')).map((n) => n.value).join('\n');
    return { text: document.body.innerText, html: document.documentElement.outerHTML, titles, arias, values };
  });
}

async function selectTime(page, id) {
  await page.click('#dt-' + id);
  await settled(page);
}
async function selectScenario(page, id) {
  await page.selectOption('#scenario', id);
  await settled(page);
}
async function setRate(page, v) {
  await page.fill('#rate', v);
  await page.press('#rate', 'Enter');
  await settled(page);
}

async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
    document.body.scrollWidth <= document.documentElement.clientWidth);
}

async function clippedAmounts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.num')).filter((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflow !== 'visible');
  }).map((n) => n.textContent).slice(0, 5));
}

async function aboveFold(page, selectors) {
  return page.evaluate((sels) => {
    const vh = window.innerHeight; const vw = window.innerWidth;
    return sels.map((s) => {
      const n = document.querySelector(s);
      if (!n) return { s, ok: false, why: 'missing' };
      const r = n.getBoundingClientRect();
      return { s, ok: r.top >= 0 && r.bottom <= vh && r.right <= vw && r.width > 0, bottom: Math.round(r.bottom) };
    });
  }, selectors);
}

async function shoot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
  await page.screenshot({ path: path.join(SHOTS, name + '-fold.png'), fullPage: false });
}

const FRIDAY_FORBIDDEN = ['78.77', '88.77', 'Mon 16 Nov 2026, 09:00', '135,382.50', '59.18', '9,000.00', '270,000', '405,000', '13,500.00'];

(async () => {
  const port = await freePort();
  const script = useStub ? STUB : REAL;
  console.log('Server: ' + (useStub ? 'STUB (tests/browser/stub_server.py)' : 'real (app/server.py)') + ' on port ' + port);
  const srv = spawn('python3', [script, '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  const base = 'http://127.0.0.1:' + port + '/';

  let browser;
  try {
    await waitForServer(port, 15000);
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    const foreign = [];
    const consoleErrors = [];
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (!(u.protocol === 'data:' || u.protocol === 'blob:' || (u.hostname === '127.0.0.1' && String(u.port) === String(port)))) foreign.push(req.url());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 400/.test(m.text())) consoleErrors.push(m.text()); }); // the deliberate bad-CSV import returns 400

    // ---- 1. First screen at 1366x768 ----
    await page.goto(base);
    await settled(page);
    const t0 = await pageText(page);
    check('banner label present', t0.text.includes('Synthetic replay — no funds move.'));
    check('footer label present', t0.text.includes('Reconstructed engine · synthetic fixtures · local only'));
    check('net amount shown', /USD 100,000\.00 net/.test(t0.text));
    check('deadline SGT shown', t0.text.includes('Wed 18 Nov 2026, 23:00 SGT'));
    check('deadline New York shown', /Wed 18 Nov 2026, 10:00 (EST|New York)/.test(t0.text));
    check('as-of time shown', t0.text.includes('Evidence as of') && t0.text.includes('Fri 13 Nov 2026, 15:00 SGT'));
    check('Friday headline "Keep Friday’s funding window"', (await page.textContent('#headline')).includes('Keep Friday’s funding window'));
    const fold = await aboveFold(page, ['#fact-net', '#fact-deadline', '#headline', '#reason', '.as-of']);
    check('net, deadlines, headline, reason above the fold at 1366x768', fold.every((f) => f.ok), JSON.stringify(fold));
    check('release checkpoint + "Provider release is not supplier credit"', t0.text.includes('Provider release is not supplier credit'));
    check('beneficiary credit "not observed"', /Beneficiary credit\s*not observed/i.test(t0.text));
    check('assumption control labelled', t0.text.includes('Assumed funding rate (hypothetical, not evidence)'));

    // ---- 2. Friday reference contains no Monday / hindsight information ----
    for (const s of FRIDAY_FORBIDDEN) {
      const hit = [t0.text, t0.html, t0.titles, t0.arias, t0.values].some((x) => x.includes(s));
      check('Friday reference excludes "' + s + '"', !hit);
    }
    check('Friday Monday option is "Not evidenced"', (await page.textContent('#option-monday')).includes('Not evidenced'));
    check('Friday reference shows no comparison block', (await page.$('#comparison-block')) === null);
    check('Friday reference: delivery check "Simulated delivery bound (not observed)"', t0.text.includes('Simulated delivery bound (not observed)'));
    check('Friday reference: no decision-time note', (await page.$('#dt-note')) === null);
    const names = await page.$$eval('#scenario option', (os) => os.map((o) => o.textContent));
    check('9 scenarios in the list', names.length === 9, names.join(' | '));
    check('Scenario names from engine (new names present)', ['Forecast customer receipt', 'Monday capacity check', 'Short-lived Monday quote', 'Friday-afternoon balance'].every((n) => names.includes(n)), names.join(' | '));
    await page.setViewportSize({ width: 1440, height: 900 });
    await shoot(page, 'friday-reference');

    // ---- 3. Retrospective ----
    await selectTime(page, 'retro');
    const tr = await pageText(page);
    for (const s of ['5 days', '2 days', '405,000', '88.77', '10.00', '78.77', 'not observed']) check('Retro shows "' + s + '"', tr.text.includes(s));
    const compText = (await page.textContent('#comparison-block')) || '';
    check('Retro comparison framed as hindsight only', compText.includes('Hindsight only — not available to the operator on Friday'));
    check('Retro comparison shows formula', /135,000\.00 × 8% × \(5 − 2\) \/ 365/.test(compText));
    check('Retro shows risk note "A missed deadline can swamp either figure."', compText.includes('A missed deadline can swamp either figure.'));
    check('Retro reference headline (hindsight, not supported on Friday)', (await page.textContent('#headline')) ===
      'In hindsight, Monday tied up cash for fewer days — waiting was not supported on Friday', await page.textContent('#headline'));
    check('Retro shows per-slot hindsight note', ((await page.textContent('#dt-note')) || '').includes('judged only on records known by its own instruction time'));
    await page.setViewportSize({ width: 1366, height: 768 });
    const foldRetro = await aboveFold(page, ['#dt-note', '#headline', '#reason']);
    check('Retro note, headline and reason above the fold at 1366x768', foldRetro.every((f) => f.ok), JSON.stringify(foldRetro));
    await page.setViewportSize({ width: 1440, height: 900 });
    await shoot(page, 'retro-reference');

    // ---- 3b. Monday reference (counterfactual) ----
    await selectTime(page, 'monday');
    const tm = await pageText(page);
    const noteM = (await page.textContent('#dt-note')) || '';
    check('Monday view shows "Counterfactual" tag', (await page.textContent('#dt-note .tag')) === 'Counterfactual');
    check('Monday note quotes the Friday decision', noteM.includes('On Friday’s evidence the decision was: Keep Friday’s funding window'), noteM);
    check('Monday headline says "would have been"', (await page.textContent('#headline')).includes('would have been'));
    check('Monday action: do not instruct the same payment again', tm.text.includes('If the Friday instruction was kept, do not instruct the same payment again on Monday.'));
    await page.setViewportSize({ width: 1366, height: 768 });
    const foldMon = await aboveFold(page, ['#dt-note', '#headline', '#reason', '#fact-net', '#fact-deadline']);
    check('Monday counterfactual note, headline, reason, net and deadline above the fold at 1366x768', foldMon.every((f) => f.ok), JSON.stringify(foldMon));
    await page.setViewportSize({ width: 1440, height: 900 });
    await shoot(page, 'monday-reference');

    // ---- 4. Back to Friday removes everything ----
    await selectTime(page, 'friday');
    const tb = await pageText(page);
    for (const s of FRIDAY_FORBIDDEN) {
      const where = ['text', 'html', 'titles', 'arias', 'values'].filter((k) => tb[k].includes(s));
      check('Back to Friday removes "' + s + '"', where.length === 0, where.join(','));
    }
    check('Back to Friday: no comparison block', (await page.$('#comparison-block')) === null);

    // ---- 5. 0% assumption ----
    await selectTime(page, 'retro');
    await page.click('.rate-quick[data-rate="0"]');
    await settled(page);
    const tz = await pageText(page);
    check('0% shows −10.00', /[−-]10\.00/.test(tz.text), tz.text.match(/Net before subscription[^\n]*\n?[^\n]*/));
    check('0% shows "SGD 10.00 more"', tz.text.includes('SGD 10.00 more'));
    check('0% quick button pressed', (await page.getAttribute('.rate-quick[data-rate="0"]', 'aria-pressed')) === 'true');
    const decisionAt0 = await page.textContent('#headline');
    await setRate(page, '8');
    check('rate change does not change decision headline', (await page.textContent('#headline')) === decisionAt0);
    check('8% typed restores 78.77', (await page.textContent('#comparison-block')).includes('78.77'));

    // ---- 6. Delayed receivable at Monday ----
    await selectTime(page, 'monday');
    await selectScenario(page, 'delayed_receivable');
    const td = await pageText(page);
    for (const s of ['130,000.00', '135,382.50', '5,382.50']) check('Delayed receivable Monday shows "' + s + '"', td.text.includes(s));
    check('Delayed receivable Monday: no actionable comparison shown', !(await page.$('#comparison-block')) ||
      (await page.textContent('#comparison-block')).includes('Comparison withheld'));
    check('Delayed receivable Monday headline reports insufficient cash', /Insufficient|Not enough usable cash|short of usable cash/i.test(await page.textContent('#headline')),
      await page.textContent('#headline'));
    check('Delayed receivable Monday: Counterfactual note + no-double-instruction action',
      td.text.includes('Counterfactual') && td.text.includes('If the Friday instruction was kept, do not instruct the same payment again on Monday.'));
    check('Delayed receivable Monday decision tone is red', (await page.getAttribute('#decision', 'class')).includes('tone-red'));
    check('Scenario switch kept decision time (Monday)', (await page.getAttribute('#dt-monday', 'aria-checked')) === 'true' &&
      td.text.includes('Mon 16 Nov 2026, 15:00 SGT'));
    await shoot(page, 'monday-delayed-receivable');
    // CONTRACT: the delayed-receivable comparison is withheld in the retrospective view.
    await selectTime(page, 'retro');
    const tdr = await pageText(page);
    check('Delayed receivable Retro: "Comparison withheld" + reason', tdr.text.includes('Comparison withheld') && /Tuesday receipt cannot finance Monday/.test(tdr.text));
    check('Delayed receivable Retro: no savings figures', !tdr.text.includes('78.77') && !tdr.text.includes('88.77'));
    await selectTime(page, 'monday');

    // ---- 7. Preagreed at Friday ----
    await selectTime(page, 'friday');
    await selectScenario(page, 'preagreed');
    const tp = await pageText(page);
    check('Preagreed Friday headline "Manual review"', (await page.textContent('#headline')).includes('Manual review'));
    check('Preagreed Friday headline is exactly "Manual review before waiting"', (await page.textContent('#headline')) === 'Manual review before waiting', await page.textContent('#headline'));
    check('Preagreed Friday next actions ask about the reservation cost', /Confirm the reservation cost SGD 25\.00 \(RES-MON\)/.test(await page.textContent('#qa')));
    check('Preagreed Friday shows no comparison block (Friday never has one)', (await page.$('#comparison-block')) === null);
    for (const s of ['53.77', '88.77']) {
      const hit = [tp.text, tp.html, tp.titles, tp.arias, tp.values].some((x) => x.includes(s));
      check('Preagreed Friday excludes "' + s + '"', !hit);
    }
    check('Preagreed Friday: no "Conditional" comparison heading', !tp.text.includes('Conditional — verify terms first'));
    check('Preagreed Friday scenario switch kept Friday', (await page.getAttribute('#dt-friday', 'aria-checked')) === 'true' && tp.text.includes('Fri 13 Nov 2026, 15:00 SGT'));
    await shoot(page, 'friday-preagreed');

    // ---- 7b. Friday-afternoon balance (stale_balance) at Monday ----
    await page.setViewportSize({ width: 1366, height: 768 });
    await selectTime(page, 'monday');
    await selectScenario(page, 'stale_balance');
    const ts = await pageText(page);
    check('Stale balance Monday headline exact', (await page.textContent('#headline')) === 'We need a newer bank balance to assess Monday’s funding.', await page.textContent('#headline'));
    const bc = (await page.$('#balance-check')) ? await page.textContent('#balance-check') : '';
    check('Stale balance Monday: balance panel shows "Fri 13 Nov 2026, 14:00 SGT"', bc.includes('Fri 13 Nov 2026, 14:00 SGT'), bc);
    check('Stale balance Monday: balance panel shows balance id CASH-FRI', bc.includes('CASH-FRI'), bc);
    check('Stale balance Monday: balance panel shows age "73 h 00 min"', (await page.textContent('#bc-age')) === '73 h 00 min');
    check('Stale balance Monday: balance panel shows limit "24 h before the funding slot (demo policy)"', bc.includes('24 h before the funding slot (demo policy)'), bc);
    check('Stale balance Monday: balance panel labels', ['Newest bank balance', 'Age at the Monday slot', 'Limit', 'Next action'].every((l) => bc.includes(l)), bc);
    check('Stale balance Monday: next action shown in the panel', (await page.textContent('#bc-next')) ===
      'Ask your bank for a settled balance dated within 24 hours of the Monday 15:00 SGT instruction, then re-run this replay.', await page.textContent('#bc-next'));
    check('Stale balance Monday: Monday option is not "Feasible"', !(await page.textContent('#option-monday .status-chip')).includes('Feasible'), await page.textContent('#option-monday .status-chip'));
    check('Stale balance Monday: no "Feasible" chip anywhere', !(await page.$$eval('.status-chip', (cs) => cs.some((c) => c.textContent.trim() === 'Feasible'))));
    check('Stale balance Monday: no comparison block', (await page.$('#comparison-block')) === null);
    check('Stale balance Monday: decision tone is amber (never green)', (await page.getAttribute('#decision', 'class')).includes('tone-amber'));
    check('Stale balance Monday: banner label still visible', ts.text.includes('Synthetic replay — no funds move.') && await page.isVisible('#banner'));
    const foldStale = await aboveFold(page, ['#headline', '#reason', '#balance-check', '#bc-next']);
    check('Stale balance Monday: headline, reason and balance panel above the fold at 1366x768', foldStale.every((f) => f.ok), JSON.stringify(foldStale));
    check('Stale balance Monday: panel sits directly under the reason', await page.evaluate(() => {
      const r = document.getElementById('reason'); return !!r && r.nextElementSibling && r.nextElementSibling.id === 'balance-check'; }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await shoot(page, 'monday-stale-balance');
    await selectTime(page, 'friday');
    const tsf = await pageText(page);
    for (const s of ['73 h 00 min', 'Age at the Monday slot']) {
      const where = ['text', 'html', 'titles', 'arias', 'values'].filter((k) => tsf[k].includes(s));
      check('Stale balance Monday → Friday removes "' + s + '"', where.length === 0, where.join(','));
    }
    check('Stale balance Friday: no balance panel and no comparison', (await page.$('#balance-check')) === null && (await page.$('#comparison-block')) === null);

    // ---- 8. Scenario switch keeps decision time (retro) ----
    await selectTime(page, 'retro');
    await selectScenario(page, 'stale_quote');
    check('Scenario switch kept decision time (Retrospective)', (await page.getAttribute('#dt-retro', 'aria-checked')) === 'true' &&
      (await page.textContent('.as-of')).includes('19 Nov 2026'));

    // ---- 9. Invalid CSV import keeps previous scenario ----
    await selectTime(page, 'friday');
    await selectScenario(page, 'reference');
    const headlineBefore = await page.textContent('#headline');
    const bad = 'record_id,kind,slot\nX1,obligation,friday\n,quote,monday\n';
    await page.setInputFiles('#csv-file', { name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
    await page.waitForSelector('.import-errors', { timeout: 10000 });
    const errText = await page.textContent('.import-errors');
    check('Invalid CSV shows row-numbered errors', /Row \d+/.test(errText), errText);
    check('Invalid CSV: row errors formatted "Row N, column C: message"', /Row \d+, column [^:]+: \S/.test(errText), errText);
    check('Invalid CSV keeps previous scenario', (await page.inputValue('#scenario')) === 'reference' && (await page.textContent('#headline')) === headlineBefore);
    await page.click('#dt-monday'); await settled(page);
    check('After failed import, evaluate still uses reference', (await page.textContent('#decision-body')).includes('Reference') ||
      (await page.inputValue('#scenario')) === 'reference');
    await selectTime(page, 'friday');

    // ---- 10. Valid import, then Reset restores samples ----
    const fixture = ['reference.csv', 'reference_week.csv'].map((f) => path.join(ROOT, 'fixtures', f)).find((f) => fs.existsSync(f));
    const goodCsv = fixture ? fs.readFileSync(fixture, 'utf8') :
      'record_id,kind,slot,effective_at,known_at,expires_at,amount,currency,rate,bp,status,source,establishes\n';
    await page.setInputFiles('#csv-file', { name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from(goodCsv) });
    await page.waitForFunction(() => document.querySelector('#import-result .ok-note, #import-result .import-errors'), null, { timeout: 10000 });
    const importedOk = (await page.$('#import-result .ok-note')) !== null;
    check('Valid CSV import accepted' + (fixture ? ' (' + path.basename(fixture) + ')' : ' (header only)'), importedOk,
      await page.textContent('#import-result'));
    if (importedOk) {
      await settled(page);
      check('Imported scenario selected', (await page.inputValue('#scenario')) === 'imported');
    }
    await page.click('#reset');
    await page.waitForFunction(() => document.querySelector('#import-result .ok-note') &&
      document.querySelector('#import-result').textContent.includes('Sample dataset restored'), null, { timeout: 10000 });
    await settled(page);
    const opts = await page.$$eval('#scenario option', (os) => os.map((o) => o.value));
    check('Reset restores the 9 samples (no imported)', opts.length === 9 && !opts.includes('imported'), opts.join(','));
    check('Reset leaves a sample scenario selected', opts.includes(await page.inputValue('#scenario')));

    // ---- 11. Evidence button jumps to the trail ----
    await page.click('#open-evidence');
    await page.waitForTimeout(600);
    check('Evidence button focuses the evidence trail', await page.evaluate(() => document.activeElement && document.activeElement.id === 'evidence-heading'));
    const evHead = await page.$$eval('#evidence-table th[scope=col]', (ths) => ths.map((t) => t.textContent));
    check('Evidence table has the required columns', ['Record ID', 'Kind', 'What it establishes', 'Effective', 'First known', 'Expires', 'Status', 'Used by'].every((h) => evHead.includes(h)), evHead.join('|'));

    // ---- 12. Keyboard operable decision time ----
    await page.focus('#dt-friday');
    await page.keyboard.press('ArrowRight');
    await settled(page);
    check('Arrow key moves decision time to Monday', (await page.getAttribute('#dt-monday', 'aria-checked')) === 'true');
    await selectTime(page, 'friday');

    // ---- 12b. Every scenario x decision time: no "saves", Monday views are counterfactual ----
    {
      const scen = await page.$$eval('#scenario option', (os) => os.map((o) => o.value));
      const savesHits = []; const monBad = [];
      for (const sc of scen) {
        await selectScenario(page, sc);
        for (const dt of ['friday', 'monday', 'retro']) {
          await selectTime(page, dt);
          const t = await pageText(page);
          if (/\bsaves?\b|\bsaving(s)?\b/i.test(t.text + '\n' + t.titles + '\n' + t.arias)) savesHits.push(sc + '/' + dt);
          if (/(^|\s)(null|undefined|NaN|\[object Object\])(\s|$)/.test(t.text)) savesHits.push(sc + '/' + dt + ' (stray null/undefined)');
          if (dt === 'monday' && !(t.text.includes('Counterfactual') && t.text.includes('If the Friday instruction was kept, do not instruct the same payment again on Monday.'))) monBad.push(sc);
        }
      }
      check('No "saves"/"savings" (or stray null/undefined) text in any scenario or decision time (' + scen.length + ' x 3 views)', savesHits.length === 0, savesHits.join(', '));
      check('Every Monday view is labelled Counterfactual with the no-double-instruction action', monBad.length === 0, monBad.join(', '));
      await selectScenario(page, 'reference');
    }

    // ---- 13. Layout: no horizontal scroll, no clipped amounts ----
    for (const vp of [[1280, 800], [1366, 768], [1440, 900]]) {
      await page.setViewportSize({ width: vp[0], height: vp[1] });
      for (const dt of ['friday', 'retro']) {
        await selectTime(page, dt);
        check('No horizontal scroll at ' + vp.join('x') + ' (' + dt + ')', await noHorizontalScroll(page));
        const clipped = await clippedAmounts(page);
        check('No clipped amounts at ' + vp.join('x') + ' (' + dt + ')', clipped.length === 0, clipped.join(' | '));
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await selectTime(page, 'friday');
    const fold1280 = await aboveFold(page, ['#fact-net', '#fact-deadline', '#headline', '#reason']);
    check('Key facts above the fold at 1280x800', fold1280.every((f) => f.ok), JSON.stringify(fold1280));

    // ---- 14. Network + errors ----
    check('No request to any non-local host', foreign.length === 0, foreign.join(', '));
    check('No page errors', consoleErrors.length === 0, consoleErrors.join(' | '));

    await ctx.close();
  } catch (e) {
    check('test run completed without exception', false, e && e.stack);
    if (srvLog) console.log('--- server log ---\n' + srvLog.slice(-3000));
  } finally {
    if (browser) await browser.close();
    srv.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed' + (useStub ? ' (STUB server)' : ''));
  process.exit(failed.length ? 1 : 0);
})();
