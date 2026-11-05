#!/usr/bin/env node
/*
 * Integration lead's acceptance journey for the pilot desk, against the REAL server and a real SQLite file.
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
  // Sessions persist in the database, so after a server restart the user may still be signed in.
  await page.goto(base + '/#/queue');
  await page.waitForSelector('#login-form, #pd-user:not([hidden])', { timeout: 10000 });
  if (await page.locator('#pd-user:not([hidden])').count()) {
    const me = await apiGet(page, '/api/me');
    if (me.status === 200 && me.json.user.email === who.email) { await settle(page); return; }
    await page.click('#pd-signout'); await page.waitForSelector('#login-form', { timeout: 10000 });
  }
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
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-lead-'));
const DB = path.join(DIR, 'pilot.db');
function envAt(clock) { return Object.assign({}, process.env, { PILOT_ENV: 'test', PILOT_DB: DB, PILOT_SECRET: 'lead-test-secret', PILOT_CLOCK: clock }); }
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

(async () => {
  cli(envAt(MON), ['migrate']); const seedOut = cli(envAt(MON), ['seed']);
  check('blank workspace: seed creates users and facilities but no cases', /no cases/i.test(seedOut), seedOut.trim());
  const browser = await chromium.launch(); const errors = [];
  let srv = await serve(MON); let page = await newPage(browser, errors); let caseId; const S = {};
  try {
    // ===== Phase 1 (Mon 09:00 SGT): operator creates an unseen invoice, evidences it, compares routes, requests review
    await signIn(page, srv.base, OP);
    const q0 = await apiGet(page, '/api/cases?q=');
    check('workspace starts with no cases', q0.status === 200 && JSON.stringify(q0.json).indexOf('CL-') === -1, JSON.stringify(q0.json).slice(0, 120));
    await page.goto(srv.base + '/#/new'); await page.waitForSelector('#nc-importer');
    await page.fill('#nc-importer', 'Tamarind Freight Holdings Pte Ltd');
    await page.fill('#nc-supplier', 'Ostrava Precision s.r.o.');
    await page.fill('#nc-payout_amount', '37,820.40'); await page.selectOption('#nc-payout_currency', 'USD');
    await page.fill('#nc-funding_amount', '51,276.15'); await page.selectOption('#nc-funding_currency', 'SGD');
    await page.fill('#nc-quote_ref', 'Q-TF-1129-03');
    await page.fill('#nc-deadline_tz', 'Asia/Singapore');
    await page.fill('#nc-deadline_local', '2026-12-04T18:00');
    await page.fill('#nc-window_a_local', '2026-12-01T10:00');
    await page.fill('#nc-window_a_cutoff_local', '2026-12-01T13:00');
    await page.fill('#nc-balance_amount', '9,800.00'); await page.selectOption('#nc-balance_currency', 'SGD');
    await page.fill('#nc-balance_as_of_local', '2026-11-30T08:00');
    await page.fill('#nc-balance_source', 'Importer bank portal screenshot (operator-entered)');
    await page.fill('#nc-expected_amount', '64,500.00'); await page.selectOption('#nc-expected_currency', 'SGD');
    await page.fill('#nc-expected_local', '2026-12-08T15:00');
    await page.fill('#nc-expected_payer', 'Brightwater Logistics (importer\'s customer)');
    await page.fill('#nc-reference', 'INV-OP-2026-1187');
    await page.fill('#nc-invoice_ref', 'INV-OP-2026-1187');
    await page.click('#nc-submit');
    await page.waitForSelector('#decision-headline', { timeout: 10000 });
    caseId = await domText(page, '#case-id');
    check('durable case id issued', /^CL-2026-[A-Z0-9]+-\d{5}$/.test(caseId), caseId);
    await page.setInputFiles('#ev-file', { name: 'tamarind-po-1187.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic purchase order PO-1187 (fictional) for pilot acceptance.\n') });
    await page.fill('#ev-desc', 'Purchase order from importer (external document)');
    const v0 = await page.getAttribute('#pd-view', 'data-version'); await page.click('#ev-upload');
    await page.waitForFunction((x) => document.getElementById('pd-view').getAttribute('data-version') !== x, v0, { timeout: 10000 });
    let v = await view(page, caseId);
    const ev = await domText(page, '#evidence');
    check('evidence lists the uploaded file and the operator-entered balance', ev.includes('tamarind-po-1187.txt') && /Operator-entered/.test(ev), ev.replace(/\s+/g, ' ').slice(0, 300));
    check('operator-entered vs external record distinguished', (await page.locator('#evidence .prov-operator').count()) >= 1 && (await page.locator('#evidence .prov-external').count()) >= 1);
    const routes = (v.routes || []).map((r) => r.key + ':' + r.status);
    check('three routes compared; A not feasible on a SGD 9,800.00 balance; C feasible', routes.length === 3 && !/A:feasible/.test(routes.join()) && /C:feasible/.test(routes.join()), routes.join(' '));
    check('page shows each route status', (await page.locator('.route').count()) === 3);
    await act(page, 'Request advance', (p) => fillAll(p, { reason: 'Importer balance SGD 9,800.00 cannot fund SGD 51,276.15 by Tue 13:00; customer receipt only expected 8 Dec.' }));
    v = await view(page, caseId); S.p1 = snap(v);
    check('request submitted; nothing reserved', v.exposure_panel.status === 'none', v.exposure_panel.status);
    // Authority is server-side: the operator calls the reviewer command directly.
    const forged = await apiPost(page, '/api/cases/' + caseId + '/commands', { type: 'approve_and_reserve', idempotency_key: 'forged-' + Date.now(), expected_version: v.version, reason: 'self-approve' });
    check('operator calling approve_and_reserve directly is refused by the server (403)', forged.status === 403, forged.status + ' ' + JSON.stringify(forged.json));
    await signOut(page);

    // ===== restart the server on the same DB
    await srv.stop(); srv = await serve(MON);
    // ===== Phase 2: a different user (reviewer) inspects and approves
    await signIn(page, srv.base, RV);
    const qv = await apiGet(page, '/api/queue');
    const awaiting = (qv.json.sections.find((s) => s.key === 'awaiting_review') || { rows: [] }).rows.map((r) => r.case_id);
    check('after restart: case is in the reviewer\'s "Awaiting review" queue', awaiting.includes(caseId), awaiting.join());
    v = await view(page, caseId); const p2 = snap(v);
    for (const k of ['id', 'owner', 'headline', 'evidence', 'exposure', 'routes', 'timeline']) check('after restart, ' + k + ' unchanged', p2[k] === S.p1[k], p2[k] + ' vs ' + S.p1[k]);
    await openCase(page, srv.base, caseId);
    check('reviewer sees the uploaded evidence', (await domText(page, '#evidence')).includes('tamarind-po-1187.txt'));
    await act(page, 'Approve and reserve capacity', (p) => fillAll(p, { reason: 'Balance fresh (1 h); facility headroom and funding cash cover SGD 51,276.15; policy POL-HL v2026.12-1.' }), { dblclick: true });
    v = await view(page, caseId); S.p2 = snap(v);
    const exp = await exposureText(page);
    check('reserved SGD 51,276.15 shown; nothing drawn', v.exposure_panel.status === 'reserved' && exp.includes('51,276.15') && /SGD 0\.00/.test(exp), exp.slice(0, 300));
    const fac = await apiGet(page, '/api/facilities');
    S.fac2 = JSON.stringify(fac.json); console.log('facility after reserve:', JSON.stringify(fac.json).slice(0, 400));
    await signOut(page);

    // ===== restart, next day
    await srv.stop(); srv = await serve(TUE);
    await signIn(page, srv.base, OP);
    v = await view(page, caseId); const p3 = snap(v);
    for (const k of ['id', 'owner', 'evidence', 'exposure', 'timeline']) check('next day after restart, ' + k + ' unchanged', p3[k] === S.p2[k], p3[k] + ' vs ' + S.p2[k]);
    console.log('TUE headline:', v.decision.headline, '| next:', v.decision.next_action);
    await openCase(page, srv.base, caseId);
    // ===== Phase 3 (Tue): draw once, sandbox payout that times out, then credit
    await act(page, 'Record draw', (p) => fillAll(p, { reference: 'DRW-TF-1187' }), { dblclick: true });
    v = await view(page, caseId);
    check('draw recorded once: principal SGD 51,276.15 + fee SGD 150.00 outstanding; nothing reserved', v.exposure_panel.status === 'outstanding' &&
      /51,276\.15/.test(JSON.stringify(v.exposure_panel.principal_outstanding)) && /150\.00/.test(JSON.stringify(v.exposure_panel.fees_outstanding)), JSON.stringify(v.exposure_panel));
    const draws = (v.timeline || []).filter((t) => /draw/i.test(JSON.stringify(t)) && /recorded|drew|draw_recorded|record_draw/i.test(JSON.stringify(t))).length;
    const f3 = (await apiGet(page, '/api/facilities')).json.facilities[0];
    check('facility: reserved back to 0, principal outstanding 51,276.15, available 448,723.85', f3.reserved === 'SGD 0.00' && f3.principal_outstanding === 'SGD 51,276.15' && f3.available === 'SGD 448,723.85', JSON.stringify(f3).slice(0, 300));
    const dup = await apiPost(page, '/api/cases/' + caseId + '/commands', { type: 'record_draw', idempotency_key: 'second-draw-' + Date.now(), expected_version: v.version, reference: 'DRW-TF-1187-again' });
    check('a second draw (new idempotency key) is refused', dup.status === 409, dup.status + ' ' + JSON.stringify(dup.json));
    await act(page, 'Instruct payout', (p) => fillAll(p, { route: 'sandbox', scenario: 'timeout_then_accept' }));
    v = await view(page, caseId);
    check('sandbox timeout → supplier status "unknown" (not failed, not paid)', v.supplier_panel.status === 'unknown', JSON.stringify(v.supplier_panel));
    const again = await apiPost(page, '/api/cases/' + caseId + '/commands', { type: 'instruct_payout', idempotency_key: 'retry-' + Date.now(), expected_version: v.version, route: 'sandbox', external_ref: 'PAY-TF-1187-2' });
    check('no second payout while the outcome is unknown (409)', again.status === 409, again.status + ' ' + JSON.stringify(again.json));
    check('next safe action is "Query payout status"', /Query payout status/.test(JSON.stringify(v.decision.next_action)), JSON.stringify(v.decision.next_action));
    await act(page, 'Query payout status', null);
    v = await view(page, caseId);
    check('query (same reference) → provider accepted; still not credited', v.supplier_panel.status === 'accepted', JSON.stringify(v.supplier_panel));
    await act(page, /Sandbox simulation/, null);
    v = await view(page, caseId); S.wed = v;
    const sup = await supplierText(page); const ex = await exposureText(page);
    console.log('CREDITED headline:', v.decision.headline, '| next:', JSON.stringify(v.decision.next_action), '| owner role:', v.decision.owner_role);
    check('supplier credited (sandbox event, labelled)', v.supplier_panel.status === 'credited' && /Sandbox/i.test(sup), sup.slice(0, 300));
    check('…while provider exposure is outstanding: SGD 51,426.15 owed by the importer', v.exposure_panel.status === 'outstanding' && ex.includes('51,426.15') && /Tamarind/.test(ex), ex.slice(0, 400));
    check('headline states both facts: "Supplier credited; <importer> owes the provider SGD 51,426.15, due …"', /^Supplier credited; Tamarind Freight Holdings Pte Ltd owes the provider SGD 51,426\.15, due /.test(v.decision.headline), v.decision.headline);
    check('next action and owner: operator records the repayment to the provider', /Record repayment to provider/.test(JSON.stringify(v.decision.next_action)) && v.decision.owner_role === 'operator', JSON.stringify(v.decision));
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, 'lead-credited-outstanding-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#decision-headline').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, 'lead-credited-outstanding-phone.png') }); await page.setViewportSize({ width: 1366, height: 768 });
    await signOut(page);

    // ===== restart, a week later: collections
    await srv.stop(); srv = await serve(WED);
    await signIn(page, srv.base, OP); await openCase(page, srv.base, caseId);
    v = await view(page, caseId);
    check('after restart on repayment day: still credited and outstanding SGD 51,426.15', v.supplier_panel.status === 'credited' && JSON.stringify(v.exposure_panel).includes('51,426.15'));
    await act(page, "Record customer receipt (importer's account)", (p) => fillAll(p, { amount: '64,500.00', currency: 'SGD', reference: 'BW-RCPT-0812' }));
    v = await view(page, caseId);
    check('customer receipt recorded, provider exposure unchanged', JSON.stringify(v.exposure_panel).includes('51,426.15') && (v.collections.customer_receipts || []).length === 1, JSON.stringify(v.exposure_panel));
    await act(page, 'Record repayment to provider', (p) => fillAll(p, { amount: '30,000.00', currency: 'SGD', bank_ref: 'TF-REPAY-01' }));
    v = await view(page, caseId);
    check('received but unmatched: exposure unchanged', JSON.stringify(v.exposure_panel).includes('51,426.15'));
    await act(page, /^Match repayment/, null);
    v = await view(page, caseId);
    const r1 = (v.collections.repayments || [])[0] || {};
    console.log('after partial match:', JSON.stringify(v.exposure_panel), JSON.stringify(r1.allocation));
    check('partial: fees SGD 150.00, principal SGD 29,850.00; remaining principal SGD 21,426.15, fees SGD 0.00',
      JSON.stringify(r1.allocation).includes('150.00') && JSON.stringify(r1.allocation).includes('29,850.00') &&
      JSON.stringify(v.exposure_panel.principal_outstanding).includes('21,426.15') && JSON.stringify(v.exposure_panel.fees_outstanding).includes('0.00'), JSON.stringify(v.exposure_panel));
    await act(page, 'Record repayment to provider', (p) => fillAll(p, { amount: '21,426.15', currency: 'SGD', bank_ref: 'TF-REPAY-02' }));
    await act(page, /^Match repayment/, null);
    v = await view(page, caseId);
    check('final repayment matched: exposure ended', v.exposure_panel.status === 'ended', JSON.stringify(v.exposure_panel));
    const f4 = (await apiGet(page, '/api/facilities')).json.facilities[0];
    check('capacity restored: available SGD 500,000.00, principal outstanding SGD 0.00', f4.available === 'SGD 500,000.00' && f4.principal_outstanding === 'SGD 0.00', JSON.stringify(f4).slice(0, 300));
    check('identities all hold', (v.identities || []).length > 0 && v.identities.every((i) => i.ok), JSON.stringify(v.identities));
    await act(page, 'Close case', null);
    v = await view(page, caseId);
    check('case closed', /closed/i.test(v.status), v.status);
    await page.screenshot({ path: path.join(SHOTS, 'lead-closed-desktop.png') });
    const exj = await apiGet(page, '/api/cases/' + caseId + '/export?format=json');
    fs.writeFileSync(path.join(DIR, 'export.json'), exj.text);
    const exh = await apiGet(page, '/api/cases/' + caseId + '/export?format=html');
    check('HTML history names both actors and reasons', /Olivia Tan/.test(exh.text) && /Ravi Menon/.test(exh.text) && /policy POL-HL/.test(exh.text), exh.status);
    // A reviewer reproduces the balances from the exported records alone (integer minor units).
    const X = JSON.parse(exj.text); const E = X.events;
    const sum = (t, k) => E.filter((e) => e.type === t).reduce((a, e) => a + (e.payload[k] || 0), 0);
    const drawn = sum('draw_recorded', 'principal_minor'), fee = sum('draw_recorded', 'fee_minor');
    const pr = sum('repayment_matched', 'principal_minor'), fr = sum('repayment_matched', 'fees_minor');
    const received = E.filter((e) => e.type === 'repayment_recorded').reduce((a, e) => a + e.payload.amount_minor, 0);
    check('from the export: drawn 5,127,615 minor = repaid principal; fee 15,000 = fees repaid; received 5,142,615 = matched', drawn === 5127615 && pr === drawn && fee === 15000 && fr === fee && received === pr + fr, [drawn, pr, fee, fr, received].join(' '));
    check('customer receipt is in the history but not in repayments', E.some((e) => e.type === 'customer_receipt_recorded' && e.payload.amount_minor === 6450000));
    const appr = E.find((e) => e.type === 'advance_approved');
    check('approval record: reviewer, reason, policy version and the evidence on file', appr.actor_name === 'Ravi Menon' && appr.actor_role === 'reviewer' && /POL-HL/.test(appr.payload.policy_version) && (appr.payload.evidence_ids || []).includes('EV-1') && appr.reason.length > 10, JSON.stringify(appr.payload));
    check('every event has effective_at, known_at, actor and provenance', E.every((e) => e.effective_at && e.known_at && e.actor_name && e.provenance));
    console.log('EXPORT', path.join(DIR, 'export.json'));

    // ===== Recovery paths on a second unscripted case: failed payout, then wrong-currency repayment
    const mk = await apiPost(page, '/api/cases', { importer: 'Pelican Marine Supplies Pte Ltd', supplier: 'Haverford Rope Works Ltd', payout_amount: '12,940.00', payout_currency: 'GBP',
      funding_amount: '22,311.80', funding_currency: 'SGD', quote_ref: 'Q-PM-1207-01', deadline_at: '2026-12-11T09:00:00Z', deadline_tz: 'Asia/Singapore',
      window_a_at: '2026-12-08T02:00:00Z', window_a_cutoff_at: '2026-12-08T05:00:00Z', later_permitted: false, contract_ref: 'MSA-PM-2026', facility_id: 'FAC-HL-01', reference: 'INV-HRW-5521', invoice_ref: 'INV-HRW-5521',
      observations: [{ kind: 'balance', amount: '4,100.00', currency: 'SGD', as_of: '2026-12-07T01:00:00Z', source: 'Operator-entered from importer email', provenance: 'operator_entered' }],
      idempotency_key: 'lead-pelican-1' });
    check('second case created via API', mk.status === 200 || mk.status === 201, mk.status + ' ' + JSON.stringify(mk.json).slice(0, 200));
    const c2 = mk.json.id;
    await openCase(page, srv.base, c2);
    await act(page, 'Request advance', (p) => fillAll(p, { reason: 'Importer short; customer pays after deadline.' }));
    await signOut(page); await signIn(page, srv.base, RV); await openCase(page, srv.base, c2);
    await act(page, 'Approve and reserve capacity', (p) => fillAll(p, { reason: 'Within limit; fresh balance.' }));
    await signOut(page); await signIn(page, srv.base, OP); await openCase(page, srv.base, c2);
    await act(page, 'Record draw', (p) => fillAll(p, { reference: 'DRW-PM-1' }));
    await act(page, 'Instruct payout', (p) => fillAll(p, { route: 'manual', external_ref: 'BANK-PM-0099' }));
    await act(page, 'Record payout failure', (p) => fillAll(p, { reference: 'BANK-PM-0099-REJ', location: 'Funds returned to provider SGD operating account (beneficiary account closed)' }));
    let w = await view(page, c2);
    console.log('FAILED:', w.decision.headline, '|', JSON.stringify(w.decision.next_action), '|', JSON.stringify(w.supplier_panel));
    check('failed payout: supplier not paid, money location and owner shown, exposure still outstanding', /failed|returned/.test(w.supplier_panel.status) && /returned to provider|Funds returned/i.test(JSON.stringify(w.supplier_panel)) && w.exposure_panel.status === 'outstanding', JSON.stringify(w.supplier_panel));
    check('recovery action offered: reviewer must authorise a new attempt (no automatic second payment)', /Authorize reinstruction/i.test(JSON.stringify(w.decision.next_action)) && !w.actions.find((a) => a.type === 'instruct_payout' && a.enabled));
    await signOut(page); await signIn(page, srv.base, RV); await openCase(page, srv.base, c2);
    await act(page, /Authori[sz]e reinstruction/, (p) => fillAll(p, { reason: 'Supplier confirmed new account details by phone call-back.' }));
    await signOut(page); await signIn(page, srv.base, OP); await openCase(page, srv.base, c2);
    await act(page, 'Instruct payout', (p) => fillAll(p, { route: 'manual', external_ref: 'BANK-PM-0100' }));
    w = await view(page, c2);
    check('second attempt instructed only after authorisation (attempt 2)', w.supplier_panel.status === 'instructed' && /2/.test(String(w.supplier_panel.attempt)), JSON.stringify(w.supplier_panel));
    await act(page, 'Record repayment to provider', (p) => fillAll(p, { amount: '300.00', currency: 'USD', bank_ref: 'PM-USD-01' }));
    await act(page, /^Match repayment/, null);
    w = await view(page, c2);
    check('USD repayment held as unmatched; principal unchanged at SGD 22,311.80', (w.collections.unmatched || []).some((u) => /USD 300\.00/.test(JSON.stringify(u))) && JSON.stringify(w.exposure_panel.principal_outstanding).includes('22,311.80'), JSON.stringify(w.collections.unmatched));
    check('close blocked while unmatched cash is open', !(w.actions.find((a) => a.type === 'close_case') || {}).enabled);
    await signOut(page); await signIn(page, srv.base, RV); await openCase(page, srv.base, c2);
    await act(page, /^Return unmatched amount/, (p) => fillAll(p, { reason: 'Wrong currency; return to payer.', reference: 'RTN-PM-USD-01' }));
    w = await view(page, c2);
    check('USD returned to payer; principal still SGD 22,311.80', (w.collections.unmatched || []).every((u) => /return/i.test(JSON.stringify(u.status))) && JSON.stringify(w.exposure_panel.principal_outstanding).includes('22,311.80'), JSON.stringify(w.collections.unmatched));
  } catch (e) { check('journey completed without exceptions', false, e.stack); }
  finally {
    await browser.close(); await srv.stop();
    const fail = results.filter((r) => !r.ok).length;
    check('no console errors', errors.length === 0, errors.join(' | '));
    console.log('\nlead journey: ' + results.filter((r) => r.ok).length + '/' + results.length + ' checks passed; DB ' + DB);
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  }
})();
