#!/usr/bin/env node
/*
 * Brief v2 browser proofs: scenario A (exact + different amounts) in a CLI-provisioned blank org, and the B/C contrast, against the REAL server and a real SQLite file.
 * A previously unseen invoice (not in any fixture or other test), two separately signed-in users, and the
 * server process stopped and restarted between phases on the same database (with the clock moved forward a day).
 *   node tests/browser/pilot_lead_journey.cjs
 * Exit 0 only if every check passes. Amounts asserted are server strings shown on the page.
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os'); const net = require('net');
const { spawn, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'docs', 'pilot', 'screenshots');
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

// ---------------------------------------------------------------- server on a persistent DB file, restartable
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-brief-'));
const DB = path.join(DIR, 'pilot.db');
function envAt(clock) { return Object.assign({}, process.env, { PILOT_ENV: 'test', PILOT_DB: DB, PILOT_SECRET: 'brief-test-secret', PILOT_CLOCK: clock }); }
async function serve(clock) {
  const port = await freePort();
  const proc = spawn('python3', ['-m', 'pilot.cli', 'serve', '--port', String(port)], { cwd: ROOT, env: envAt(clock), stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = 'http://127.0.0.1:' + port;
  await waitHealthy(base, proc, 20000);
  return { base, pid: proc.pid, log: () => log, stop: () => new Promise((res) => { proc.on('exit', res); proc.kill('SIGTERM'); }) };
}
const OP = { email: 'operator@harbourline.test', password: 'pilot-dev-operator' };
const RV = { email: 'reviewer@harbourline.test', password: 'pilot-dev-reviewer' };
const OTHER = { email: 'operator@meridian.test', password: 'pilot-dev-operator' };
const MON = '2026-11-30T01:00:00Z';   // Mon 30 Nov 09:00 SGT
const TUE = '2026-12-01T01:30:00Z';   // Tue 1 Dec 09:30 SGT (next day)
const FRI = '2026-12-04T03:00:00Z';   // Fri 4 Dec 11:00 SGT
const WED = '2026-12-07T02:00:00Z';   // Mon 7 Dec 10:00 SGT (repayment due 17:00 that day)
function snap(v) {
  return { id: v.id, owner: JSON.stringify(v.header.owner), headline: v.decision.headline, status: v.status,
    evidence: JSON.stringify((v.evidence || []).map((e) => [e.id, e.kind || e.filename, e.provenance])),
    exposure: JSON.stringify(v.exposure_panel), supplier: JSON.stringify(v.supplier_panel),
    routes: JSON.stringify((v.routes || []).map((r) => [r.key, r.status])), timeline: (v.timeline || []).length };
}
async function newPage(browser, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|404|409|422|429)/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return p;
}
async function exposureText(page) { return (await domText(page, '#exposure-panel')).replace(/\s+/g, ' '); }
async function supplierText(page) { return (await domText(page, '#supplier-panel')).replace(/\s+/g, ' '); }
// ------------------------------------------------------------- blank org provisioned only through the CLI
function cliPw(env, args, pw) { const e = Object.assign({}, env, { PILOT_NEW_PASSWORD: pw }); return cli(e, args); }
const PRIYA = { email: 'ops@saltmarsh.test', password: 'brief-operator-pass-1' };
const DANIEL = { email: 'credit@saltmarsh.test', password: 'brief-reviewer-pass-1' };
// Each run uses its own week so the server clock only moves forward on the shared database.
function shiftIso(iso, days) { const d = new Date(iso); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().replace('.000Z', 'Z'); }
function shiftLocal(local, days) { const d = new Date(local + ':00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 16); }
const T_MON = '2026-12-07T01:00:00Z', T_TUE = '2026-12-08T01:30:00Z', T_FRI = '2026-12-11T02:00:00Z';
const SHOTDIR = SHOTS;
async function shot(page, name) {
  fs.mkdirSync(SHOTDIR, { recursive: true });
  for (const [w, h, tag] of [[1366, 768, 'desktop'], [390, 844, 'phone']]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOTDIR, 'brief-' + name + '-' + tag + '.png') });
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}
async function fillCase(page, d) {
  await page.goto(page.url().split('#')[0] + '#/new'); await page.waitForSelector('#nc-importer');
  const f = async (id, v) => { if (await page.locator(id).count()) { const tag = await page.locator(id).evaluate((x) => x.tagName); if (tag === 'SELECT') await page.selectOption(id, v); else await page.fill(id, v); } else throw new Error('missing field ' + id); };
  await f('#nc-importer', d.importer); await f('#nc-supplier', d.supplier);
  await f('#nc-payout_amount', d.payout); await f('#nc-payout_currency', 'USD');
  await f('#nc-funding_amount', d.funding); await f('#nc-funding_currency', 'SGD');
  await f('#nc-quote_ref', d.quote); await f('#nc-invoice_ref', d.invoice);
  if (await page.locator('#nc-quote_source').count()) await f('#nc-quote_source', 'Provider FX desk (operator-entered)');
  if (await page.locator('#nc-customer_ref').count()) await f('#nc-customer_ref', d.customer || '');
  await f('#nc-deadline_tz', 'Asia/Singapore'); await f('#nc-deadline_local', d.deadline);
  await f('#nc-window_a_local', d.winA); await f('#nc-window_a_cutoff_local', d.winAcut);
  if (await page.locator('#nc-facility_id').count()) await f('#nc-facility_id', d.facility);
  await f('#nc-balance_amount', d.balance); await f('#nc-balance_currency', 'SGD');
  await f('#nc-balance_as_of_local', d.balanceAt); await f('#nc-balance_source', 'Importer bank portal (operator-entered)');
  await f('#nc-reference', d.invoice);
  await page.click('#nc-submit'); await page.waitForSelector('#decision-headline', { timeout: 10000 });
  return domText(page, '#case-id');
}

(async () => {
  const env = envAt(T_MON);
  cli(env, ['migrate']);
  cli(env, ['create-org', '--name', 'Saltmarsh Payments (Synthetic)', '--id', 'ORG-SM']);
  cliPw(env, ['create-user', '--org', 'ORG-SM', '--email', PRIYA.email, '--name', 'Priya Nair', '--role', 'operator'], PRIYA.password);
  cliPw(env, ['create-user', '--org', 'ORG-SM', '--email', DANIEL.email, '--name', 'Daniel Koh', '--role', 'reviewer'], DANIEL.password);
  cli(env, ['create-facility', '--org', 'ORG-SM', '--id', 'FAC-SM-01', '--name', 'Supplier advance (Synthetic)', '--currency', 'SGD', '--limit', '120,000.00',
    '--fee-flat', '60.00', '--fee-bps', '0', '--allocation', 'fees_first', '--funding-cash', '80,000.00', '--policy-version', 'POL-SM v1', '--required-evidence', 'balance']);
  cli(env, ['create-facility', '--org', 'ORG-SM', '--id', 'FAC-SM-02', '--name', 'Small-ticket advance (Synthetic)', '--currency', 'SGD', '--limit', '100,000.00',
    '--fee-flat', '45.00', '--fee-bps', '0', '--allocation', 'fees_first', '--funding-cash', '25,000.00', '--policy-version', 'POL-SM2 v1', '--required-evidence', 'balance,invoice']);
  const browser = await chromium.launch(); const errors = [];
  let srv = await serve(T_MON); let pOp = await newPage(browser, errors); let pRv = await newPage(browser, errors);
  try {
    await signIn(pOp, srv.base, PRIYA); await signIn(pRv, srv.base, DANIEL);
    check('blank org: no cases', JSON.stringify((await apiGet(pOp, '/api/cases?q=')).json).indexOf('CL-') === -1);
    const runs = [
      { tag: 'exact', week: 0, invoice: 'INV-FA-2026-0042', payout: '12,400.00', funding: '16,800.00', repay1: '6,000.00', owed: 'SGD 16,860.00', p1: 'SGD 5,940.00', rem: 'SGD 10,860.00' },
      { tag: 'different', week: 7, invoice: 'INV-FA-2026-0917', payout: '7,315.55', funding: '9,912.47', repay1: '3,333.33', owed: 'SGD 9,972.47', p1: 'SGD 3,273.33', rem: 'SGD 6,639.14' }];
    for (const R of runs) {
      const MON = shiftIso(T_MON, R.week), TUE = shiftIso(T_TUE, R.week), FRI = shiftIso(T_FRI, R.week), L = (x) => shiftLocal(x, R.week);
      if (R.week) { await srv.stop(); srv = await serve(MON); await signIn(pOp, srv.base, PRIYA); await signIn(pRv, srv.base, DANIEL); }
      const cid = await fillCase(pOp, { importer: 'Halyard Coffee Traders Pte Ltd', supplier: 'Finca Altamira Exportadora', payout: R.payout, funding: R.funding,
        quote: 'Q-' + R.invoice, invoice: R.invoice, customer: 'HCT-PO-' + R.invoice.slice(-4), deadline: L('2026-12-10T17:00'), winA: L('2026-12-08T10:00'), winAcut: L('2026-12-08T13:00'),
        facility: 'FAC-SM-01', balance: '1,250.00', balanceAt: L('2026-12-07T08:30') });
      check(R.tag + ': case created in the blank org', /^CL-2026-SM-\d{5}$/.test(cid), cid);
      if (R.tag === 'exact') await shot(pOp, 'intake');
      await act(pOp, 'Request advance', (p) => fillAll(p, { reason: 'Importer cash SGD 1,250.00; receivable lands after the deadline.' }));
      // restart; the reviewer (separate session) recovers the same case
      await srv.stop(); srv = await serve(MON);
      await signIn(pRv, srv.base, DANIEL); await openCase(pRv, srv.base, cid);
      check(R.tag + ': reviewer recovers the case after restart', (await domText(pRv, '#case-id')) === cid);
      if (R.tag === 'exact') await shot(pRv, 'review');
      await act(pRv, 'Approve and reserve capacity', (p) => fillAll(p, { reason: 'Fresh balance; within POL-SM v1.' }), { dblclick: true });
      let v = await view(pRv, cid);
      check(R.tag + ': reserved SGD ' + R.funding + ', principal SGD 0.00', v.exposure_panel.reserved === 'SGD ' + R.funding && v.exposure_panel.principal_outstanding === 'SGD 0.00', JSON.stringify(v.exposure_panel));
      await srv.stop(); srv = await serve(TUE);
      await signIn(pOp, srv.base, PRIYA); await openCase(pOp, srv.base, cid);
      await act(pOp, 'Record draw', (p) => fillAll(p, { reference: 'DRW-' + R.invoice }), { dblclick: true });
      v = await view(pOp, cid);
      check(R.tag + ': drawn once, principal SGD ' + R.funding, v.exposure_panel.principal_outstanding === 'SGD ' + R.funding && v.exposure_panel.reserved === 'SGD 0.00', JSON.stringify(v.exposure_panel));
      await act(pOp, 'Instruct payout', (p) => fillAll(p, { route: 'manual', external_ref: 'BANK-' + R.invoice }));
      await act(pOp, 'Record provider acceptance', (p) => fillAll(p, { reference: 'ACK-' + R.invoice, location: 'Provider payout system' }));
      v = await view(pOp, cid);
      check(R.tag + ': instruction + acceptance are not supplier credit', v.supplier_panel.status === 'accepted' && !/credited/i.test(v.decision.headline), v.decision.headline);
      await act(pOp, 'Record beneficiary credit', (p) => fillAll(p, { reference: 'MT103-' + R.invoice, location: 'Beneficiary account' }));
      v = await view(pOp, cid);
      check(R.tag + ': supplier paid, provider owed ' + R.owed, v.supplier_panel.status === 'credited' && v.exposure_panel.total_outstanding === R.owed && v.decision.headline.includes(R.owed), v.decision.headline);
      if (R.tag === 'exact') await shot(pOp, 'delivered-unpaid');
      await srv.stop(); srv = await serve(FRI);
      await signIn(pOp, srv.base, PRIYA); await openCase(pOp, srv.base, cid);
      await act(pOp, "Record customer receipt (importer's account)", (p) => fillAll(p, { amount: '40,000.00', currency: 'SGD', reference: 'CUST-' + R.invoice }));
      v = await view(pOp, cid);
      check(R.tag + ': importer\'s own receipt leaves exposure at ' + R.owed, v.exposure_panel.total_outstanding === R.owed);
      await act(pOp, 'Record repayment to provider', (p) => fillAll(p, { amount: R.repay1, currency: 'SGD', bank_ref: 'RP1-' + R.invoice }));
      await act(pOp, /^Match repayment/, null);
      v = await view(pOp, cid); const al = v.collections.repayments[0].allocation;
      check(R.tag + ': partial: fee SGD 60.00 + principal ' + R.p1 + '; remaining principal ' + R.rem, al.fees === 'SGD 60.00' && al.principal === R.p1 && v.exposure_panel.principal_outstanding === R.rem, JSON.stringify(al) + ' ' + v.exposure_panel.principal_outstanding);
      await act(pOp, 'Record repayment to provider', (p) => fillAll(p, { amount: R.rem.slice(4), currency: 'SGD', bank_ref: 'RP2-' + R.invoice }));
      await act(pOp, /^Match repayment/, null);
      v = await view(pOp, cid);
      check(R.tag + ': exposure ended, no held cash', v.exposure_panel.status === 'ended' && (v.collections.unmatched || []).length === 0);
      await act(pOp, 'Close case', null);
      if (R.tag === 'exact') await shot(pOp, 'closed');
      const X = (await apiGet(pOp, '/api/cases/' + cid + '/export?format=json')).json; const E = X.events;
      const sum = (t, k) => E.filter((e) => e.type === t).reduce((a, e) => a + (e.payload[k] || 0), 0);
      const fundMinor = Math.round(Number(R.funding.replace(/,/g, '')) * 100);
      check(R.tag + ': export reconstructs drawn, fee, matched and received', sum('draw_recorded', 'principal_minor') === fundMinor && sum('draw_recorded', 'fee_minor') === 6000 &&
        sum('repayment_matched', 'principal_minor') === fundMinor && sum('repayment_matched', 'fees_minor') === 6000 && sum('repayment_recorded', 'amount_minor') === fundMinor + 6000);
    }

    // ===== Second proof: the same new evidence → one case eligible for review, the other blocked by cash
    await srv.stop(); srv = await serve(shiftIso(T_MON, 14)); await signIn(pOp, srv.base, PRIYA); await signIn(pRv, srv.base, DANIEL);
    const base = { importer: 'Corvid Lab Supplies Pte Ltd', supplier: 'Nordlys Instruments AS', quote: 'Q-CL-12', deadline: '2026-12-24T17:00', winA: '2026-12-22T10:00', winAcut: '2026-12-22T13:00', facility: 'FAC-SM-02', balance: '900.00', balanceAt: '2026-12-21T08:30' };
    const cB = await fillCase(pOp, Object.assign({}, base, { invoice: 'INV-NI-7001', payout: '13,250.00', funding: '18,000.00' }));
    const cC = await fillCase(pOp, Object.assign({}, base, { invoice: 'INV-NI-7002', payout: '22,080.00', funding: '30,000.00' }));
    let vB = await view(pOp, cB), vC = await view(pOp, cC);
    const rc = (v) => v.routes.find((r) => r.key === 'C');
    check('B before: route C blocked on missing policy evidence (invoice)', rc(vB).status !== 'feasible' && JSON.stringify(rc(vB).blockers || []).match(/invoice/i), JSON.stringify(rc(vB)));
    for (const [cid, amt] of [[cB, '13,250.00'], [cC, '22,080.00']]) {
      await openCase(pOp, srv.base, cid);
      await act(pOp, 'Add observation', (p) => fillAll(p, { kind: 'invoice', amount: amt, currency: 'USD', invoice_ref: cid === cB ? 'INV-NI-7001' : 'INV-NI-7002', issuer: 'Nordlys Instruments AS', issued_at: '2026-12-18T09:00', record_ref: 'Supplier invoice PDF (operator-entered)' }));
    }
    vB = await view(pOp, cB); vC = await view(pOp, cC);
    check('B after the invoice: route C feasible → can go to human review', rc(vB).status === 'feasible', JSON.stringify(rc(vB)));
    check('B decision record shows the evidence blocker cleared', JSON.stringify(vB.decision_record || {}).match(/invoice/i) && (vB.decision_record.changed || []).length > 0, JSON.stringify(vB.decision_record).slice(0, 300));
    check('C after the same evidence: still blocked; binding constraint is cash', rc(vC).status === 'infeasible' && JSON.stringify(rc(vC).blockers).match(/cash/i) && /25,000\.00/.test(JSON.stringify(rc(vC))) , JSON.stringify(rc(vC)));
    await openCase(pOp, srv.base, cB); await shot(pOp, 'evidence-clears-blocker');
    await openCase(pOp, srv.base, cC);
    const onScreen = (await domText(pOp, 'body')).replace(/\s+/g, ' ');
    check('C: the cash constraint is named on screen', /funding cash/i.test(onScreen) && onScreen.includes('25,000.00'), onScreen.slice(0, 200));
    await shot(pOp, 'cash-still-blocks');
    await openCase(pOp, srv.base, cB);
    await act(pOp, 'Request advance', (p) => fillAll(p, { reason: 'Invoice now on record; policy evidence complete.' }));
    await openCase(pRv, srv.base, cB);
    await act(pRv, 'Decline', (p) => fillAll(p, { reason: 'Importer concentration too high this month (reviewer judgement).' }));
    vB = await view(pRv, cB);
    check('a reviewer may still decline an eligible case; nothing reserved', /declin/i.test(JSON.stringify(vB.decision)) && vB.exposure_panel.status === 'none');
    const firstCp = (await view(pRv, cB)).decision_record.checkpoints[0];
    const rp = await apiGet(pRv, '/api/cases/' + cB + '?as_of=' + encodeURIComponent(firstCp.at));
    check('replay at the first checkpoint shows no knowledge of the later invoice record', rp.status === 200 && rp.json.replay && !JSON.stringify(rp.json.evidence).includes('INV-NI-7001","issuer') && (rp.json.actions || []).length === 0 && rc(rp.json).status !== 'feasible', JSON.stringify(rp.json && rp.json.replay));
  } catch (e) { check('run completed without exceptions', false, e.stack); }
  finally {
    await browser.close(); await srv.stop();
    check('no console errors', errors.length === 0, errors.join(' | '));
    console.log('\nbrief scenarios: ' + results.filter((r) => r.ok).length + '/' + results.length + ' checks passed; DB ' + DB);
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  }
})();
