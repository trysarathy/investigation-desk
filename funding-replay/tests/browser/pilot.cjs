#!/usr/bin/env node
/*
 * Browser test for the Clearline pilot operating desk (pilot/static), against the REAL pilot server.
 *
 *   node tests/browser/pilot.cjs                 # starts its own server on a free port with a temp DB
 *   PILOT_URL=http://127.0.0.1:8123 node tests/browser/pilot.cjs   # use a server you started (seeded)
 *
 * Server start (from funding-replay/):
 *   PILOT_ENV=test PILOT_DB=<tmp> PILOT_SECRET=test PILOT_CLOCK=<fixed> python3 -m pilot.cli migrate
 *   ... python3 -m pilot.cli seed ; ... python3 -m pilot.cli serve --port <free>
 *
 * The test never computes money: every amount it asserts is a string the server returned in a read model,
 * compared with what the page shows. Screenshots go to docs/pilot/screenshots/. Exit code 0 only if every
 * check passes, no console errors occurred and no request left the server's origin.
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'docs', 'pilot', 'screenshots');
const CLOCK = process.env.PILOT_TEST_CLOCK || '2026-11-16T01:00:00Z';   // Mon 09:00 Asia/Singapore

const results = [];
function check(name, cond, info) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + String(info).slice(0, 500)));
  return !!cond;
}

// ------------------------------------------------------------------ server
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
async function waitHealthy(base, proc, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (proc && proc.exitCode !== null) throw new Error('server exited with ' + proc.exitCode);
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy at ' + base);
}
function cli(env, args) {
  const r = spawnSync('python3', ['-m', 'pilot.cli'].concat(args), { cwd: ROOT, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('pilot.cli ' + args.join(' ') + ' failed: ' + r.stderr + r.stdout);
  return r.stdout + r.stderr;
}
async function startServer() {
  if (process.env.PILOT_URL) return { base: process.env.PILOT_URL.replace(/\/$/, ''), stop() {}, seedOut: process.env.PILOT_SEED_OUT || '' };
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-ui-'));
  const env = Object.assign({}, process.env, { PILOT_ENV: 'test', PILOT_DB: path.join(dir, 'pilot.db'), PILOT_SECRET: 'test', PILOT_CLOCK: CLOCK });
  let proc; let seedOut = '';
  cli(env, ['migrate']);
  seedOut = cli(env, ['seed']);
  proc = spawn('python3', ['-m', 'pilot.cli', 'serve', '--port', String(port)], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  try { await waitHealthy(base, proc, 20000); } catch (e) { console.error(log); throw e; }
  return { base, env, dir, seedOut, log: () => log, stop() { try { proc.kill('SIGTERM'); } catch (e) { /* gone */ } } };
}

// Seeded synthetic users (pilot/cli.py seed, PILOT_ENV=test: password "pilot-dev-<role>"). Override with env.
const SEEDED = {
  operator: { email: process.env.PILOT_OPERATOR_EMAIL || 'operator@harbourline.test', password: process.env.PILOT_OPERATOR_PASSWORD || 'pilot-dev-operator' },
  reviewer: { email: process.env.PILOT_REVIEWER_EMAIL || 'reviewer@harbourline.test', password: process.env.PILOT_REVIEWER_PASSWORD || 'pilot-dev-reviewer' },
  viewer: { email: process.env.PILOT_VIEWER_EMAIL || 'viewer@harbourline.test', password: process.env.PILOT_VIEWER_PASSWORD || 'pilot-dev-viewer' },
  other: { email: process.env.PILOT_OTHER_EMAIL || 'operator@meridian.test', password: process.env.PILOT_OTHER_PASSWORD || 'pilot-dev-operator' }
};

// ------------------------------------------------------------------ page helpers
async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 10000 });
}
async function signIn(page, base, who) {
  await page.goto(base + '/#/queue');
  await page.waitForSelector('#login-form', { timeout: 10000 });
  await page.fill('#login-email', who.email);
  await page.fill('#login-password', who.password);
  await page.click('#login-submit');
  await page.waitForSelector('#pd-user:not([hidden])', { timeout: 10000 });
  await settle(page);
}
async function signOut(page) {
  await page.click('#pd-signout');
  await page.waitForSelector('#login-form', { timeout: 10000 });
}
async function apiGet(page, p) {
  return page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    return { status: r.status, json: j, text: t };
  }, p);
}
async function apiPost(page, p, body) {
  return page.evaluate(async (a) => {
    const me = await (await fetch('/api/me', { credentials: 'same-origin' })).json();
    const r = await fetch(a.p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf }, body: JSON.stringify(a.body) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
    return { status: r.status, json: j };
  }, { p, body });
}
async function view(page, id) { const r = await apiGet(page, '/api/cases/' + encodeURIComponent(id)); return r.json; }
async function openCase(page, base, id, focus) {
  await page.goto(base + '/#/case/' + encodeURIComponent(id) + (focus ? '?focus=' + focus : ''));
  await page.waitForSelector('#decision-headline, #case-error', { timeout: 10000 });
}
async function domText(page, sel) {
  const n = page.locator(sel);
  return (await n.count()) ? (await n.first().innerText()).trim() : '';
}
// State words are shown capitalised by CSS; compare the words case-insensitively.
async function stateWord(page, sel) { return (await domText(page, sel)).toLowerCase().replace(/\s+/g, '_'); }
function mt(v) { if (v === null || v === undefined || v === '') return '—'; if (typeof v === 'object') return v.display || v.text || v.formatted || (v.currency + ' ' + v.amount); return String(v); }
function rawAmount(v) { return mt(v).replace(/^[A-Z]{3}\s*/, ''); }

// Click an enabled action by its visible label, fill its dialog, confirm, wait for the new version.
async function act(page, label, fill, opts) {
  opts = opts || {};
  const before = await page.getAttribute('#pd-view', 'data-version');
  const btn = (label instanceof RegExp ? page.locator('#actions-enabled').getByRole('button', { name: label })
    : page.locator('#actions-enabled').getByRole('button', { name: label, exact: true })).first();
  if (!(await btn.count())) {
    const dis = await page.locator('#actions-disabled').innerText().catch(() => '');
    throw new Error('No enabled action "' + label + '". Disabled: ' + dis.replace(/\s+/g, ' ').slice(0, 400));
  }
  await btn.click();
  await page.waitForSelector('#pd-dialog[open]');
  if (fill) await fill(page);
  const confirm = page.locator('#pd-dialog-confirm');
  if (opts.dblclick) await confirm.dblclick(); else await confirm.click();
  if (opts.expectError) {
    await page.waitForSelector('#pd-dialog-error:not([hidden])', { timeout: 10000 });
    return null;
  }
  await page.waitForFunction((v) => !document.querySelector('#pd-dialog[open]') && document.getElementById('pd-view').getAttribute('data-version') !== v, before, { timeout: 10000 })
    .catch(async (e) => { throw new Error('"' + label + '" did not complete: ' + (await domText(page, '#pd-dialog-error')) + ' ' + e.message); });
  await page.waitForSelector('#decision-headline');
}
async function setVal(page, name, value) {
  const n = page.locator('#pd-dialog-fields [name="' + name + '"]');
  if (!(await n.count())) return false;
  const tag = await n.evaluate((x) => x.tagName);
  if ((await n.getAttribute('type')) === 'hidden') return (await n.inputValue()) === String(value);
  if (tag === 'SELECT') await n.selectOption(String(value)); else await n.fill(String(value));
  return true;
}
async function fillAll(page, values) { for (const k of Object.keys(values)) await setVal(page, k, values[k]); }
async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
async function shots(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const vp = page.viewportSize();
  for (const [w, h, tag] of [[1366, 768, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    check(name + ' @' + w + ': no horizontal page scroll', await noHorizontalScroll(page),
      await page.evaluate(() => document.documentElement.scrollWidth + ' > ' + window.innerWidth));
    await page.screenshot({ path: path.join(SHOTS, name + '-' + tag + '.png'), fullPage: false });
  }
  await page.setViewportSize(vp);
}
async function scrollTo(page, sel) { await page.locator(sel).first().scrollIntoViewIfNeeded(); }

// ------------------------------------------------------------------ main
(async () => {
  const srv = await startServer();
  const base = srv.base;
  const op = SEEDED.operator; const rv = SEEDED.reviewer; const vw = SEEDED.viewer; const other = SEEDED.other;
  console.log('server ' + base + '  users: ' + [op, rv, vw].map((u) => u.email).join(', '));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const consoleErrors = []; const external = [];
  const origin = new URL(base).origin;
  ctx.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  const page = await ctx.newPage();
  const watch = (p) => {
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (401|404|409|422|429)/.test(m.text())) consoleErrors.push(m.text()); });
    p.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  };
  watch(page);
  let caseId = null;
  try {
    // ---------------- sign-in screen and banner
    await page.goto(base + '/');
    await page.waitForSelector('#login-form');
    check('sign-in screen shown when signed out', await page.isVisible('#login-email'));
    check('sandbox banner', (await domText(page, '#pd-banner')) === 'Pilot workspace — sandbox payouts are simulated; no live payments.');
    await page.fill('#login-email', op.email); await page.fill('#login-password', 'wrong-password');
    await page.click('#login-submit');
    await page.waitForSelector('#login-error:not([hidden])');
    check('wrong password shows an error, stays signed out', await page.isHidden('#pd-user'));

    await signIn(page, base, op);
    const me = (await apiGet(page, '/api/me')).json;
    check('header shows user, role and org', (await domText(page, '#pd-user-name')) === (me.user.name || me.user.email) &&
      (await domText(page, '#pd-user-role')) === me.user.role && (await domText(page, '#pd-user-org')) === me.org.name, JSON.stringify(me.user));

    // ---------------- queue
    const q = (await apiGet(page, '/api/queue')).json;
    const keys = ['awaiting_review', 'evidence_requested', 'approaching_cutoff', 'uncertain_delivery', 'overdue_repayment', 'unmatched_cash', 'my_open', 'all_open'];
    check('queue renders every section from /api/queue', keys.every((k) => q.sections.some((s) => s.key === k)) &&
      (await page.locator('.q-section').count()) === q.sections.length, q.sections.map((s) => s.key).join(','));
    const rowsTotal = q.sections.reduce((n, s) => n + s.rows.length, 0);
    check('every queue row has a next-action button', (await page.locator('.q-section tbody tr').count()) === rowsTotal &&
      (await page.locator('.q-section tbody tr .row-action').count()) === q.sections.reduce((n, s) => n + s.rows.filter((r) => r.next_action && r.next_action.label).length, 0));

    // ---------------- new case
    await page.click('#pd-new-case');
    await page.waitForSelector('#new-case-form');
    // first submit with a bad amount -> inline server error
    const ncFill = async (payout) => {
      await page.fill('#nc-importer', 'Kestrel Instruments Pte Ltd');
      await page.fill('#nc-supplier', 'Lindqvist Optics AB');
      await page.fill('#nc-payout_amount', payout); await page.selectOption('#nc-payout_currency', 'EUR');
      await page.fill('#nc-funding_amount', '89,450.25'); await page.selectOption('#nc-funding_currency', 'SGD');
      await page.fill('#nc-quote_ref', 'Q-KI-2611-07');
      await page.fill('#nc-deadline_tz', 'Asia/Singapore');
      await page.fill('#nc-deadline_local', '2026-11-19T17:00');
      await page.fill('#nc-window_a_local', '2026-11-17T09:00');
      await page.fill('#nc-window_a_cutoff_local', '2026-11-17T12:00');
      await page.fill('#nc-balance_amount', '12,300.00'); await page.selectOption('#nc-balance_currency', 'SGD');
      await page.fill('#nc-balance_as_of_local', '2026-11-16T08:30');
      await page.fill('#nc-balance_source', 'Bank portal export');
      await page.fill('#nc-expected_amount', '95,000.00'); await page.selectOption('#nc-expected_currency', 'SGD');
      await page.fill('#nc-expected_local', '2026-12-10T12:00');
      await page.fill('#nc-expected_payer', 'Harbourline Labs');
      await page.fill('#nc-reference', 'INV-LO-44817');
    };
    await ncFill('61,400.001');
    await page.click('#nc-submit');
    await page.waitForSelector('[aria-invalid="true"], #nc-error:not([hidden])', { timeout: 10000 });
    check('invalid amount -> inline field error from the server', (await page.getAttribute('#nc-payout_amount', 'aria-invalid')) === 'true',
      await domText(page, '#nc-error'));
    await page.fill('#nc-payout_amount', '61,400.00');
    await page.click('#nc-submit');
    await page.waitForSelector('#decision-headline', { timeout: 10000 });
    caseId = await domText(page, '#case-id');
    let v = await view(page, caseId);
    check('case created: header shows server payout and funding strings', (await domText(page, '.case-strip')).includes(mt(v.header.payout)) &&
      (await domText(page, '.case-strip')).includes(mt(v.header.funding)) && /EUR/.test(mt(v.header.payout)) && /SGD/.test(mt(v.header.funding)), mt(v.header.payout) + ' / ' + mt(v.header.funding));
    check('deadline shown with zone', (await domText(page, '.strip-clock')).includes('Asia/Singapore'));
    check('two panels side by side: supplier delivery and provider exposure', (await page.locator('#supplier-panel').count()) === 1 && (await page.locator('#exposure-panel').count()) === 1);
    check('three routes A/B/C', (await page.locator('.route').count()) === 3);

    // ---------------- evidence upload
    await page.setInputFiles('#ev-file', { name: 'kestrel-balance-2611.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic bank balance extract for a fictional pilot test. SGD balance as of 16 Nov 08:30 SGT.\n') });
    await page.fill('#ev-desc', 'Bank balance extract');
    const vBefore = await page.getAttribute('#pd-view', 'data-version');
    await page.click('#ev-upload');
    await page.waitForFunction((x) => document.getElementById('pd-view').getAttribute('data-version') !== x && document.getElementById('evidence') &&
      document.getElementById('evidence').innerText.includes('kestrel-balance-2611.txt'), vBefore, { timeout: 10000 }).catch(() => {});
    check('uploaded file listed in evidence', (await domText(page, '#evidence')).includes('kestrel-balance-2611.txt'));
    v = await view(page, caseId);
    const opEntered = await page.locator('#evidence tbody .prov-operator').count();
    check('operator-entered records carry the Operator-entered badge (not bank-confirmed)', opEntered >= 1 && (await page.locator('#evidence tbody .prov-operator').first().innerText()) === 'Operator-entered' &&
      (await page.locator('#evidence tbody tr.ev-file .prov-external').count()) >= 1);

    // ---------------- request advance
    await act(page, 'Request advance', (p) => fillAll(p, { reason: 'Balance short of funding amount before the original window; customer receipt only expected after the deadline.' }));
    v = await view(page, caseId);
    check('advance requested (no reservation yet)', v.exposure_panel.status === 'none' && (await stateWord(page, '#exposure-status')) === 'none', v.exposure_panel.status);
    await signOut(page);

    // ---------------- reviewer
    await signIn(page, base, rv);
    const q2 = (await apiGet(page, '/api/queue')).json;
    const ar = q2.sections.find((s) => s.key === 'awaiting_review');
    check('case appears in awaiting review', ar && ar.rows.some((r) => r.case_id === caseId));
    const rowBtn = page.locator('#q-awaiting_review tr[data-case="' + caseId + '"] .row-action');
    check('awaiting-review row has its next-action button', (await rowBtn.count()) === 1);
    await shots(page, 'queue');
    await rowBtn.click();
    await page.waitForSelector('#decision-headline');
    await page.waitForTimeout(200);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-action'));
    check('next-action opens the case focused on that action', focused === 'approve_and_reserve', focused);
    v = await view(page, caseId);
    const rc = v.routes.find((r) => (r.key || r.route || r.id) === 'C');
    check('reviewer sees route C with its status and capacity/cash checks', rc && (await domText(page, '#route-C')).toLowerCase().includes(String(rc.status).replace(/_/g, ' ')) && (await page.locator('#route-C').innerText()).includes('Capacity ok'));
    await scrollTo(page, '#decision');
    await shots(page, 'case-decision');

    // double-click approve: one reservation
    await act(page, 'Approve and reserve capacity', (p) => fillAll(p, { reason: 'Route C feasible; four-eyes review of balance extract and quote.' }), { dblclick: true });
    v = await view(page, caseId);
    check('reserved shown in provider exposure', v.exposure_panel.status === 'reserved' && (await stateWord(page, '#exposure-status')) === 'reserved');
    check('reserved amount is the server string', (await domText(page, '#exposure-panel .m-reserved')) === mt(v.exposure_panel.reserved), mt(v.exposure_panel.reserved));
    check('drawn principal is 0 while reserved', /^([A-Z]{3}\s*)?0(\.0+)?$/.test(mt(v.exposure_panel.principal_outstanding)) &&
      (await domText(page, '#exposure-panel .m-principal')) === mt(v.exposure_panel.principal_outstanding), mt(v.exposure_panel.principal_outstanding));
    check('reserved is not styled like drawn', !(await page.locator('#exposure-panel').getAttribute('class')).includes('exp-outstanding'));
    const ex1 = await apiGet(page, '/api/cases/' + caseId + '/export?format=json');
    const evs = (ex1.json && (ex1.json.events || ex1.json.history)) || [];
    check('double-click on "Approve and reserve capacity" made one reservation', evs.filter((e) => /approve|reserv/.test(e.type) && !/release|expire/.test(e.type)).length === 1,
      evs.map((e) => e.type).join(','));
    const facs = (await apiGet(page, '/api/facilities')).json;
    check('facilities page data available', !!facs);
    await page.click('a[data-nav="facilities"]');
    await page.waitForSelector('#pd-facilities:not([aria-busy])');
    check('facilities page shows reserved vs principal outstanding', (await domText(page, '#pd-facilities')).includes('Reserved (held, not drawn)'));
    await signOut(page);

    // ---------------- operator: draw, payout, delivery
    await signIn(page, base, op);
    await openCase(page, base, caseId);
    await act(page, 'Record draw', (p) => fillAll(p, { reference: 'DRW-KI-0001' }));
    v = await view(page, caseId);
    check('draw recorded: exposure outstanding', v.exposure_panel.status === 'outstanding' && (await stateWord(page, '#exposure-status')) === 'outstanding');
    await act(page, 'Instruct payout', (p) => fillAll(p, { route: 'manual', external_ref: 'EXT-LO-7781' }));
    v = await view(page, caseId);
    check('manual payout: supplier panel says instructed, not credited', v.supplier_panel.status === 'instructed' && (await stateWord(page, '#supplier-status')) === 'instructed' &&
      !(await page.locator('#supplier-panel').getAttribute('class')).includes('sup-ok'), v.supplier_panel.status);
    await act(page, 'Record provider acceptance', (p) => fillAll(p, { status: 'accepted', reference: 'ACK-7781', location: 'Payout provider (sandbox ledger)' }));
    v = await view(page, caseId);
    check('acceptance is not credit', v.supplier_panel.status === 'accepted' && (await stateWord(page, '#supplier-status')) === 'accepted' &&
      !(await page.locator('#supplier-panel').getAttribute('class')).includes('sup-ok'));
    await act(page, 'Record beneficiary credit', (p) => fillAll(p, { status: 'credited', reference: 'CRD-7781', location: 'Lindqvist Optics AB account' }));
    v = await view(page, caseId);
    check('supplier credited AND provider exposure outstanding at the same time', v.supplier_panel.status === 'credited' && v.exposure_panel.status === 'outstanding' &&
      (await stateWord(page, '#supplier-status')) === 'credited' && (await stateWord(page, '#exposure-status')) === 'outstanding');
    check('outstanding total shown as server string', (await domText(page, '#exposure-panel .m-total')) === mt(v.exposure_panel.total_outstanding));
    await scrollTo(page, '#supplier-panel');
    await shots(page, 'supplier-credited-outstanding');

    // ---------------- customer receipt (does not reduce debt)
    const totalBefore = mt(v.exposure_panel.total_outstanding);
    await act(page, "Record customer receipt (importer's account)", (p) => fillAll(p, { amount: '95,000.00', currency: 'SGD', reference: 'HL-RCPT-0091' }));
    v = await view(page, caseId);
    check('customer receipt leaves exposure unchanged', mt(v.exposure_panel.total_outstanding) === totalBefore && (await domText(page, '#exposure-panel .m-total')) === totalBefore, mt(v.exposure_panel.total_outstanding));
    check('customer receipt listed under "not repayment", not under repayments', (await domText(page, '#customer-receipts')).includes('HL-RCPT-0091') && !(await domText(page, '#repayments')).includes('HL-RCPT-0091'));

    // ---------------- partial repayment + match
    await act(page, 'Record repayment to provider', (p) => fillAll(p, { amount: '40,000.00', currency: 'SGD', bank_ref: 'BNK-KI-5501' }));
    v = await view(page, caseId);
    check('repayment listed as an unallocated item, exposure unchanged until matched', (await domText(page, '#repayments')).includes('BNK-KI-5501') && mt(v.exposure_panel.total_outstanding) === totalBefore);
    await act(page, /^Match repayment/, null);
    v = await view(page, caseId);
    check('partial match: remaining principal and fees are the server strings', v.exposure_panel.status === 'outstanding' &&
      (await domText(page, '#exposure-panel .m-principal')) === mt(v.exposure_panel.principal_outstanding) &&
      (await domText(page, '#exposure-panel .m-fees')) === mt(v.exposure_panel.fees_outstanding) && mt(v.exposure_panel.total_outstanding) !== totalBefore,
      mt(v.exposure_panel.principal_outstanding) + ' / ' + mt(v.exposure_panel.fees_outstanding));
    const rep1 = (v.collections.repayments || []).find((r) => r.bank_ref === 'BNK-KI-5501');
    check('repayment allocation fees/principal shown', rep1 && (await domText(page, '#repayments tr[data-repayment="' + rep1.id + '"]')).includes(mt(rep1.allocation && rep1.allocation.fees)));

    // ---------------- balance repayment + match -> ended
    const rest = rawAmount(v.exposure_panel.total_outstanding);
    await act(page, 'Record repayment to provider', (p) => fillAll(p, { amount: rest, currency: 'SGD', bank_ref: 'BNK-KI-5502' }));
    {
      const v2 = await view(page, caseId); const r2 = v2.collections.repayments.find((r) => r.bank_ref === 'BNK-KI-5502');
      await act(page, new RegExp('^Match repayment' + (r2 && v2.actions.some((a) => a.preset) ? ' ' + r2.id + '\\b' : '')), async (p) => { if (r2) await setVal(p, 'repayment_id', r2.id); });
    }
    v = await view(page, caseId);
    check('balance matched: provider exposure ended', v.exposure_panel.status === 'ended' && (await stateWord(page, '#exposure-status')) === 'ended', v.exposure_panel.status);
    const idn = v.identities || [];
    check('identities reconciled n/n', (await domText(page, '#recon-count')) === 'Reconciled: ' + idn.filter((i) => i.ok).length + '/' + idn.length && idn.every((i) => i.ok));

    // ---------------- close + export
    await act(page, 'Close case', null);
    v = await view(page, caseId);
    check('case closed', /closed/.test(v.status) && (await domText(page, '.crumbs')).toLowerCase().includes('closed'), v.status);
    check('no enabled actions on a closed case except notes', (await page.locator('#actions-enabled button').count()) === 0);
    await scrollTo(page, '#identities');
    await shots(page, 'reconciled-closed');
    check('export buttons JSON/CSV/HTML', (await page.locator('#exports a[data-export]').count()) === 3);
    const html = await apiGet(page, '/api/cases/' + caseId + '/export?format=html');
    const opName = me.user.name; const rvName = (await (async () => { return rv.name; })()) || null;
    check('HTML export lists actors (operator and reviewer)', html.status === 200 && html.text.includes(opName) && /reviewer/i.test(html.text), html.status);
    const csvx = await apiGet(page, '/api/cases/' + caseId + '/export?format=csv');
    check('CSV export available', csvx.status === 200 && csvx.text.split('\n').length > 5);
    void rvName;

    // ---------------- other pages at phone width, and the light colour scheme
    for (const [hash, sel, name] of [['#/new', '#new-case-form', 'new case'], ['#/import', '#imp-file', 'import'], ['#/facilities', '#pd-facilities:not([aria-busy])', 'facilities'], ['#/search?q=Kestrel', '#pd-search-results:not([aria-busy])', 'search']]) {
      await page.goto(base + '/' + hash); await page.waitForSelector(sel);
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
      check(name + ' page @390: no horizontal page scroll', await noHorizontalScroll(page));
      await page.setViewportSize({ width: 1366, height: 768 });
    }
    check('search finds the case by importer', (await domText(page, '#pd-search-results')).includes(caseId));
    // screenshots above use the light scheme; check the dark scheme renders too
    await page.emulateMedia({ colorScheme: 'dark' });
    await openCase(page, base, caseId);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('prefers-color-scheme: dark gives a dark background', /rgb\(([0-9]|[1-4][0-9]), ([0-9]|[1-4][0-9]), ([0-9]|[1-4][0-9])\)/.test(bg), bg);
    await page.screenshot({ path: path.join(SHOTS, 'reconciled-closed-dark-desktop.png') });
    await page.emulateMedia({ colorScheme: 'light' });

    // ---------------- decline path + keyboard-only command
    const created = await apiPost(page, '/api/cases', {
      importer: 'Kestrel Instruments Pte Ltd', supplier: 'Lindqvist Optics AB', payout_amount: '18,200.00', payout_currency: 'EUR',
      funding_amount: '26,530.40', funding_currency: 'SGD', quote_ref: 'Q-KI-2611-09', deadline_at: '2026-11-19T09:00:00Z', deadline_tz: 'Asia/Singapore',
      window_a_at: '2026-11-17T01:00:00Z', window_a_cutoff_at: '2026-11-17T04:00:00Z', later_permitted: false, contract_ref: null,
      facility_id: (v.facility_id || undefined), reference: 'INV-LO-44821',
      observations: [{ kind: 'balance', amount: '3,100.00', currency: 'SGD', as_of: '2026-11-16T00:30:00Z', source: 'Bank portal export' }],
      idempotency_key: 'pilot-ui-decline-' + Date.now()
    });
    const id2 = created.json && (created.json.id || (created.json.case_view && created.json.case_view.id));
    check('second case created for the decline path', created.status === 200 || created.status === 201, JSON.stringify(created.json).slice(0, 300));
    await openCase(page, base, id2);
    // keyboard only: Tab to "Request advance", Enter, type the reason, Tab to confirm, Space
    await page.focus('#case-h1');
    let reached = false;
    for (let i = 0; i < 200 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-action') === 'request_advance');
    }
    check('keyboard: Tab reaches "Request advance"', reached);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#pd-dialog[open]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('pd-dialog').open);
    check('Escape closes the dialog and returns focus to the action', await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-action') === 'request_advance'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('#pd-dialog[open]');
    check('dialog focuses its first field', await page.evaluate(() => document.activeElement && document.activeElement.name === 'reason'));
    await page.keyboard.type('Short balance; asking for review.');
    const ver2 = await page.getAttribute('#pd-view', 'data-version');
    let onConfirm = false;
    for (let i = 0; i < 20 && !onConfirm; i++) { await page.keyboard.press('Tab'); onConfirm = await page.evaluate(() => document.activeElement && document.activeElement.id === 'pd-dialog-confirm'); }
    await page.keyboard.press('Space');
    await page.waitForFunction((x) => document.getElementById('pd-view').getAttribute('data-version') !== x, ver2, { timeout: 10000 });
    check('keyboard-only command recorded (Request advance)', onConfirm && (await view(page, id2)).actions.every((a) => a.type !== 'request_advance' || !a.enabled));

    // stale version: a second tab changes the case first
    const page2 = await ctx.newPage(); watch(page2);
    await openCase(page2, base, id2);
    await apiPost(page, '/api/cases/' + id2 + '/commands', { type: 'add_note', text: 'Changed elsewhere', idempotency_key: 'pilot-ui-note-' + Date.now(), expected_version: (await view(page, id2)).version });
    await page2.click('#btn-add-note');
    await page2.waitForSelector('#pd-dialog[open]');
    await page2.fill('#pd-dialog-fields [name="text"]', 'From a stale tab');
    await page2.click('#pd-dialog-confirm');
    await page2.waitForSelector('#pd-alert:not([hidden])', { timeout: 10000 });
    check('409 stale_version: "Case changed since you loaded it — reloaded"', (await domText(page2, '#pd-alert')).includes('Case changed since you loaded it — reloaded'));
    await page2.close();

    // correction: supersede the balance; the old record stays, struck through
    await page.reload(); await page.waitForSelector('#decision-headline');
    {
      const vb = await view(page, id2);
      const bal = (vb.observations || []).find((o) => o.kind === 'balance' && !o.superseded_by);
      await act(page, 'Correct an observation', async (p) => {
        await setVal(p, 'event_id', String(bal.event_id));
        await p.locator('#pd-dialog-fields [name="event_id"]').dispatchEvent('change');
        await fillAll(p, { amount: '3,450.00', currency: 'SGD', as_of: '2026-11-16T08:45', source: 'Corrected bank portal export', reason: 'Balance re-read from the portal; earlier figure mistyped.' });
      });
      const va = await view(page, id2);
      const old = (va.observations || []).find((o) => o.event_id === bal.event_id);
      check('superseded observation kept and struck through', old && old.superseded_by &&
        (await page.locator('#ev-' + bal.event_id + '.superseded .struck').count()) === 1, JSON.stringify(old));
      check('correction shown in the timeline', (await domText(page, '#timeline')).includes('Corrects event #' + bal.event_id));
    }
    // hand-off: assign owner + note
    {
      const users = (await apiGet(page, '/api/users')).json.users;
      const target = users.find((u) => u.role === 'reviewer');
      const ver = await page.getAttribute('#pd-view', 'data-version');
      await page.click('#btn-assign');
      await page.waitForSelector('#pd-dialog[open]');
      await page.waitForSelector('#pd-dialog-fields select[name="user_id"] option[value="' + target.id + '"]', { state: 'attached' });
      await page.selectOption('#pd-dialog-fields select[name="user_id"]', String(target.id));
      await page.fill('#pd-dialog-fields [name="note"]', 'Handing over for the afternoon review.');
      await page.click('#pd-dialog-confirm');
      await page.waitForFunction((x) => document.getElementById('pd-view').getAttribute('data-version') !== x, ver, { timeout: 10000 });
      check('hand-off: owner shown in header and recorded in history', (await domText(page, '#case-owner')) === target.name && (await domText(page, '#timeline')).includes('Handing over for the afternoon review.'));
    }

    // CSV import: invalid file -> row errors, nothing created; valid file -> dry run, then import
    {
      const before = (await apiGet(page, '/api/cases?q=')).json;
      const n0 = ((before && (before.results || before.cases)) || []).length;
      await page.click('a[data-nav="import"]');
      await page.waitForSelector('#imp-file');
      await page.setInputFiles('#imp-file', path.join(ROOT, 'docs', 'pilot', 'sample_cases_invalid.csv'));
      await page.waitForFunction(() => document.getElementById('imp-csv').value.length > 0);
      await page.click('#imp-dry');
      await page.waitForSelector('#imp-errors');
      const errText = await domText(page, '#imp-errors');
      check('import: invalid CSV lists row errors and imports nothing', /Row \d+/.test(errText) && (await page.isDisabled('#imp-go')) &&
        (((await apiGet(page, '/api/cases?q=')).json.results || []).length === n0), errText.slice(0, 200));
      // a valid file whose times suit the test clock (fictional parties)
      const header = fs.readFileSync(path.join(ROOT, 'docs', 'pilot', 'sample_cases.csv'), 'utf8').split(/\r?\n/)[0];
      const csvOk = header + '\n' +
        'Kestrel Instruments Pte Ltd,Lindqvist Optics AB,"12,800.00",EUR,"18,650.10",SGD,Q-KI-IMP-01,2026-11-20 17:00,Asia/Singapore,2026-11-18 10:00,2026-11-18 12:00,no,,,,"20,000.00",2026-11-25 12:00,"4,000.00",2026-11-16 08:00,Bank portal export,INV-LO-IMP-01\n' +
        'Kestrel Instruments Pte Ltd,Lindqvist Optics AB,"7,300.00",EUR,"10,640.00",SGD,Q-KI-IMP-02,2026-11-21 17:00,Asia/Singapore,2026-11-19 10:00,2026-11-19 12:00,no,,,,,,"2,500.00",2026-11-16 08:00,Bank portal export,INV-LO-IMP-02\n';
      await page.setInputFiles('#imp-file', { name: 'kestrel-import.csv', mimeType: 'text/csv', buffer: Buffer.from(csvOk) });
      await page.waitForFunction(() => document.getElementById('imp-csv').value.indexOf('Q-KI-IMP-01') >= 0);
      await page.click('#imp-dry');
      await page.waitForSelector('#imp-ok');
      check('import: dry run passes and creates nothing yet', (((await apiGet(page, '/api/cases?q=')).json.results || []).length === n0) && !(await page.isDisabled('#imp-go')));
      await page.click('#imp-go');
      await page.waitForSelector('#imp-done');
      const nLinks = await page.locator('#imp-done a').count();
      check('import: all rows created, each linked', nLinks === 2 && (((await apiGet(page, '/api/cases?q=')).json.results || []).length === n0 + nLinks), nLinks);
    }
    await signOut(page);

    await signIn(page, base, rv);
    await openCase(page, base, id2, 'decline');
    await act(page, 'Decline', (p) => fillAll(p, { reason: 'Balance and receipt timing do not support an advance under policy.' }));
    const vd = await view(page, id2);
    check('decline: nothing reserved, exposure none', vd.exposure_panel.status === 'none' && (await stateWord(page, '#exposure-status')) === 'none', vd.exposure_panel.status);
    await signOut(page);

    // ---------------- viewer
    await signIn(page, base, vw);
    await openCase(page, base, caseId);
    check('viewer sees the case', (await domText(page, '#case-id')) === caseId);
    await openCase(page, base, id2);
    check('viewer sees no enabled actions', (await page.locator('#actions-enabled button').count()) === 0 && (await page.locator('#pd-view button.abtn:not([disabled])').count()) === 0);
    check('viewer has no upload or new-case controls', (await page.locator('#ev-form').count()) === 0 && (await page.locator('#pd-new-case').count()) === 0);
    await signOut(page);

    // ---------------- second org
    const oth = other;
    if (check('second-org user available', !!oth)) {
      await signIn(page, base, oth);
      await openCase(page, base, caseId);
      check("second org's user gets \"not found\" for the first org's case URL", (await domText(page, '#case-error')).includes('Not found') && (await domText(page, '#pd-view')).indexOf('Kestrel') === -1);
      const sr = (await apiGet(page, '/api/cases?q=' + encodeURIComponent(caseId))).json;
      const srRows = Array.isArray(sr) ? sr : (sr && (sr.cases || sr.rows || sr.results)) || [];
      check('second org search for the id finds nothing', srRows.length === 0);
      await signOut(page);
    }
  } catch (e) {
    check('journey completed without exceptions', false, e.stack || e.message);
    try { await page.screenshot({ path: path.join(os.tmpdir(), 'pilot-ui-failure.png'), fullPage: true }); console.log('failure screenshot: ' + path.join(os.tmpdir(), 'pilot-ui-failure.png')); } catch (e2) { /* ignore */ }
  }

  check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
  check('no external requests', external.length === 0, external.join(' | '));
  await browser.close();
  srv.stop();
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed' + (caseId ? ' (case ' + caseId + ')' : ''));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
