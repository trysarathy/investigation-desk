#!/usr/bin/env node
/*
 * Browser test for the provider funding lifecycle desk, against an exported static site.
 *
 *   node tests/browser/lifecycle.cjs <exported-site-dir>
 *
 * Opens <dir>/index.html from file:// with the preinstalled Node Playwright and drives the reference journey
 * by clicking action buttons by their visible label. Every value the page shows is compared with the view
 * JSON in the state file the page loaded (states/lc-<case>-<state>.js); the test never computes money.
 * Screenshots go to docs/screenshots/lifecycle/. Exit code 0 only if every check passes.
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const SITE = path.resolve(process.argv[2] || '');
const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots', 'lifecycle');
if (!process.argv[2] || !fs.existsSync(path.join(SITE, 'index.html'))) {
  console.error('usage: node tests/browser/lifecycle.cjs <exported-site-dir>  (needs index.html)');
  process.exit(2);
}
const INDEX = pathToFileURL(path.join(SITE, 'index.html')).href;

const results = [];
function check(name, cond, info) {
  results.push({ name, ok: !!cond });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : '  -> ' + String(info).slice(0, 400)));
}

// The view JSON behind the page right now (read from the exported file named by the URL hash).
function viewFor(caseId, stateId) {
  const file = path.join(SITE, 'states', 'lc-' + caseId + '-' + stateId + '.js');
  const src = fs.readFileSync(file, 'utf8');
  const i = src.indexOf('deliver(');
  return JSON.parse(src.slice(i + 'deliver('.length, src.lastIndexOf(')')));
}
function meta() {
  const src = fs.readFileSync(path.join(SITE, 'lc-meta.js'), 'utf8');
  return JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
}
async function position(page) {
  const h = await page.evaluate(() => location.hash);
  const m = /^#([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(h);
  return m ? { caseId: m[1], stateId: m[2] } : null;
}
async function currentView(page) {
  const p = await position(page);
  return p ? viewFor(p.caseId, p.stateId) : null;
}

async function settled(page) {
  await page.waitForFunction(() => !document.body.hasAttribute('aria-busy') &&
    document.getElementById('lc-headline') && document.getElementById('lc-headline').textContent.trim().length > 0,
    null, { timeout: 10000 });
}
async function domDump(page) {
  return page.evaluate(() => {
    const attrs = [];
    document.querySelectorAll('*').forEach((n) => { for (const a of n.attributes) attrs.push(a.value); });
    return { text: document.body.innerText, html: document.documentElement.outerHTML, attrs: attrs.join('\n') };
  });
}
async function text(page, sel) {
  const n = page.locator(sel);
  return (await n.count()) ? (await n.first().innerText()).trim() : '';
}

// Click the action whose visible button label matches `label` (string = exact, RegExp = pattern).
async function act(page, label, opts) {
  const v = await currentView(page);
  const m = (x) => (label instanceof RegExp ? label.test(x.label) : x.label === label);
  const a = (v.actions || []).find((x) => m(x) && x.enabled) || (v.actions || []).find(m);
  if (!a) throw new Error('No action matching ' + label + ' in ' + v.state_id + '; have: ' + (v.actions || []).map((x) => x.label + (x.enabled ? '' : ' (disabled)')).join(' | '));
  const btn = page.locator('#lc-actions').getByRole('button', { name: a.label, exact: true });
  if (!a.enabled) throw new Error('Action "' + a.label + '" is disabled: ' + a.disabled_reason);
  if (opts && opts.keyboard) { await btn.focus(); await page.keyboard.press('Enter'); } else await btn.click();
  await settled(page);
  const after = await position(page);
  if (!after || after.stateId !== a.next) throw new Error('After "' + a.label + '" expected state ' + a.next + ', got ' + JSON.stringify(after));
  return currentView(page);
}
function findAction(v, re) { return (v.actions || []).find((x) => re.test(x.label) && x.enabled) || (v.actions || []).find((x) => re.test(x.label)); }
// First enabled action matching any pattern, in the order given (labels are the engine's).
function pick(v, ...res) {
  for (const re of res) { const a = (v.actions || []).find((x) => x.enabled && x.next !== v.state_id && re.test(x.label)); if (a) return a; }
  return null;
}
// Ask for the advance and have the reviewer reserve it (one action if the engine offers "Reserve capacity" directly).
async function reserve(page, v) {
  if (!pick(v, RESERVE)) { const req = pick(v, /^Request advance/i); if (req) v = await act(page, req.label); }
  return v;
}
const RESERVE = /^(Reserve capacity|Approve and reserve)/i;

// Generic per-state checks: everything shown is the view's, and colour rules hold.
async function stateChecks(page, tag) {
  const v = await currentView(page);
  const d = v.decision || {};
  const f = v.facts || {};
  check(tag + ': headline is the engine’s', (await text(page, '#lc-headline')) === d.headline, await text(page, '#lc-headline'));
  check(tag + ': decision tone class', (await page.getAttribute('#lc-decision', 'class')).includes('tone-' + d.tone));
  check(tag + ': clock shown', (await text(page, '#lc-clock')).includes(v.clock.sgt));
  check(tag + ': "Simulated — no funds move." visible', await page.locator('#lc-label').isVisible() && (await text(page, '#lc-label')).includes('no funds move'));
  const deliveryGreen = (await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-ok');
  check(tag + ': delivery is green only when credited', deliveryGreen === ((f.delivery || {}).status === 'credited'), (f.delivery || {}).status);
  for (const k of ['authorization', 'cash', 'delivery', 'repayment']) {
    check(tag + ': fact ' + k + ' status/label', (await page.getAttribute('#lc-fact-' + k, 'data-status')) === (f[k] || {}).status &&
      (await text(page, '#lc-fact-' + k)).includes((f[k] || {}).label || ''));
  }
  if (v.exposure) {
    check(tag + ': exposure amount + owner shown (amber)', (await text(page, '#lc-exposure')).includes(v.exposure.amount) &&
      (await text(page, '#lc-exposure')).includes(v.exposure.owner));
  } else {
    check(tag + ': no draw yet: exposure says "No advance drawn"', (await text(page, '#lc-exposure-status')) === 'No advance drawn' &&
      (await page.getAttribute('#lc-exposure', 'data-status')) === 'none');
  }
  // Every action shows its exact label, role tag and consequence before clicking; disabled ones show why.
  const items = page.locator('#lc-actions li.lc-action');
  check(tag + ': one control per action', (await items.count()) === (v.actions || []).length);
  for (let i = 0; i < (v.actions || []).length; i++) {
    const a = v.actions[i];
    const li = page.locator('#lc-actions li.lc-action[data-action="' + a.id + '"]');
    const t = (await li.innerText());
    const btn = li.getByRole('button');
    const okLabel = (await btn.innerText()).trim() === a.label;
    const roleText = a.role === 'Simulated event' ? 'Simulated event' : 'Simulated role: ' + a.role;
    const okRole = t.includes(roleText);
    const okCons = !a.enabled || !a.consequence || t.includes(a.consequence);
    const okDis = a.enabled ? await btn.isEnabled() : (!(await btn.isEnabled()) && (!a.disabled_reason || t.includes(a.disabled_reason)));
    check(tag + ': action "' + a.label + '" label/role/consequence/' + (a.enabled ? 'enabled' : 'reason'), okLabel && okRole && okCons && okDis, t);
  }
  const fac = v.facility;
  if (fac) {
    const ft = await text(page, '#lc-facility');
    check(tag + ': facility limits shown with currency', ['company_limit', 'company_available', 'reserved', 'principal_outstanding', 'funding_available_cash', 'funding_reserved']
      .every((k) => ft.includes(fac[k])) && ft.includes('(' + fac.denomination + ')'));
  }
  const inv = v.invariants || [];
  const allOk = inv.length && inv.every((i) => i.ok === true);
  if (allOk) check(tag + ': invariants summary', (await text(page, '#lc-inv-summary')) === 'Reconciled: ' + inv.length + '/' + inv.length + ' identities hold');
  else check(tag + ': invariants not all hold -> not shown as reconciled', !(await text(page, '#lc-inv-summary')).startsWith('Reconciled'));
  return v;
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const pos = await position(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, name + '-1366.png') });
  const ctx = page.context();
  const phone = await ctx.newPage();
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.goto(INDEX + '#' + pos.caseId + '/' + pos.stateId);
  await settled(phone);
  const wide = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(name + ': no horizontal scroll at 390 px', !wide);
  await phone.screenshot({ path: path.join(SHOTS, name + '-390.png') });
  await phone.close();
}

async function openCase(page, caseId) {
  await page.selectOption('#lc-case', caseId);
  await settled(page);
  const pos = await position(page);
  check(caseId + ': case selector loads the case start', pos && pos.caseId === caseId && pos.stateId === meta().cases.find((c) => c.id === caseId).start);
  return currentView(page);
}

(async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const errors = [], remote = [];
  context.on('page', (p) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  });
  context.on('request', (r) => { if (!r.url().startsWith('file:')) remote.push(r.url()); });
  const page = await context.newPage();
  try {
    await page.goto(INDEX);
    await settled(page);
    const M = meta();
    let pos = await position(page);
    check('boot: opens the reference case at its start', pos && pos.caseId === 'reference' && pos.stateId === M.cases.find((c) => c.id === 'reference').start);
    check('header: importer view link points to replay/index.html', (await page.getAttribute('a.lc-link', 'href')) === 'replay/index.html');
    check('header: the importer replay is exported alongside', fs.existsSync(path.join(SITE, 'replay', 'index.html')));

    // ---------- Friday decision ----------
    let v = await stateChecks(page, 'friday');
    const startHeadline = v.decision.headline;
    let dump = await domDump(page);
    check('friday: no Thursday receipt anywhere in DOM or attributes', !/Thu 19 Nov/.test(dump.html) && !/Thu 19 Nov/.test(dump.attrs));
    check('friday: three funding options A/B/C side by side', (await page.locator('#lc-options article').count()) === 3 &&
      ['A', 'B', 'C'].every((k) => (v.options || []).some((o) => o.key === k)));
    for (const o of v.options) {
      const t = await text(page, '#lc-option-' + o.key);
      check('friday: option ' + o.key + ' shows whose money/committed/amount/duration/cost/risk',
        [o.title, o.whose_money, o.committed_at, o.amount, o.duration, o.modeled_cost, o.risk_bearer].every((x) => !x || t.includes(x)) &&
        (o.disqualifiers || []).every((x) => t.includes(typeof x === 'string' ? x : (x.text || x.label || ''))), t);
      for (const id of (o.evidence || [])) {
        const href = await page.locator('#lc-option-' + o.key + ' a.record-id', { hasText: id }).first().getAttribute('href');
        check('friday: option ' + o.key + ' evidence ' + id + ' links to the evidence panel', href === '#ev-' + id && (await page.locator('[id="ev-' + id + '"]').count()) === 1);
      }
    }
    if (v.options_note) check('friday: options note shown', (await text(page, '#lc-options-note')) === v.options_note);
    check('friday: decision region is aria-live', (await page.getAttribute('#lc-decision-body', 'aria-live')) === 'polite');
    await shot(page, 'decision-friday');

    // Friday: neutral decision, three routes, and they fit on the first laptop screen.
    check('friday: neutral decision tone (decide), not blocked/red', v.decision.tone === 'decide' && (await page.textContent('#lc-tone')) === 'Decision needed');
    const optsBottom = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll('#lc-options article')).map((n) => n.getBoundingClientRect().bottom)));
    check('friday: the three options fit within 1366x768 without scrolling', optsBottom <= 768, 'bottom ' + Math.round(optsBottom));
    check('friday: exposure says "No advance drawn"', (await text(page, '#lc-exposure-status')) === 'No advance drawn');
    const fridayId = (await position(page)).stateId;

    // ---------- Request advance -> Reserve capacity (reviewer, by keyboard) ----------
    v = await act(page, 'Request advance');
    await stateChecks(page, 'requested');
    check('requested: next step is the reviewer’s (role switch labelled)', (await text(page, '#lc-actions li[data-action="approve_reserve"] .lc-role')) === 'Simulated role: Reviewer');
    v = await act(page, 'Reserve capacity', { keyboard: true });
    await stateChecks(page, 'reserved');
    check('reserved: authorisation reserved', (await page.getAttribute('#lc-fact-authorization', 'data-status')) === 'reserved');
    check('reserved: facility shows reserved SGD 135,382.50', (await text(page, '#lc-fac-reserved')) === 'SGD 135,382.50', await text(page, '#lc-fac-reserved'));
    check('reserved: principal outstanding SGD 0.00 (no draw)', (await text(page, '#lc-fac-principal')) === 'SGD 0.00' && (await text(page, '#lc-rep-principal')) === 'SGD 0.00');
    check('reserved: cash not drawn, supplier not paid', (await page.getAttribute('#lc-fact-cash', 'data-status')) === 'none' &&
      (await page.getAttribute('#lc-fact-delivery', 'data-status')) === 'none' && !(await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-ok'));
    check('reserved: exposure still "No advance drawn"', (await text(page, '#lc-exposure-status')) === 'No advance drawn');
    await shot(page, 'approval-reserved');

    // Double-click on a clock action must apply exactly one step (no second advance onto the new button).
    {
      const reservedId = (await position(page)).stateId;
      const adv = pick(v, /^Advance to /);
      check('double-click: reserved state offers a clock action', !!adv);
      if (adv) {
        // Human-speed double-click: the second press arrives after the next state has already rendered
        // (file:// loads in a few ms), at the same spot, with click count 2.
        const box = await page.locator('#lc-actions').getByRole('button', { name: adv.label, exact: true }).boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await page.mouse.click(x, y);
        await settled(page);
        await page.waitForTimeout(60);
        await page.mouse.click(x, y, { clickCount: 2 });
        await page.locator('#lc-actions').getByRole('button', { name: adv.label, exact: true }).dblclick().catch(() => {});
        await settled(page);
        await page.waitForTimeout(400);
        await settled(page);
        const after = await position(page);
        check('double-click "' + adv.label + '" advances exactly one step', after.stateId === adv.next,
          'expected ' + adv.next + ', got ' + after.stateId);
        check('double-click: clock shows the one-step time', (await text(page, '#lc-clock .lc-pay-main')) === viewFor('reference', adv.next).clock.sgt);
        // Same for keyboard: Enter pressed twice quickly on a focused action applies one step.
        await page.goto(INDEX + '#reference/' + reservedId);
        await settled(page);
        const b2 = page.locator('#lc-actions').getByRole('button', { name: adv.label, exact: true });
        await b2.focus();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await settled(page);
        await page.waitForTimeout(400);
        await settled(page);
        check('double Enter on "' + adv.label + '" advances exactly one step', (await position(page)).stateId === adv.next);
      }
      await page.goto(INDEX + '#reference/' + reservedId);
      await settled(page);
      v = await currentView(page);
    }

    // ---------- draw -> instruct -> accept -> credit ----------
    v = await act(page, 'Record simulated draw');
    await stateChecks(page, 'drawn');
    check('drawn: principal outstanding SGD 135,382.50 on screen', (await text(page, '#lc-fac-principal')) === 'SGD 135,382.50' && (await text(page, '#lc-rep-principal')) === 'SGD 135,382.50');
    check('drawn: reservation consumed (reserved back to SGD 0.00)', (await text(page, '#lc-fac-reserved')) === 'SGD 0.00');
    check('drawn: exposure Outstanding', (await text(page, '#lc-exposure-status')) === 'Outstanding');
    v = await act(page, 'Instruct payout');
    await stateChecks(page, 'instructed');
    v = await act(page, 'Provider accepts payout');
    await stateChecks(page, 'accepted');
    check('accepted: provider acceptance is not supplier credit (not green)', (await page.getAttribute('#lc-fact-delivery', 'data-status')) === 'accepted' &&
      !(await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-ok'));
    v = await act(page, 'Record beneficiary credit');
    await stateChecks(page, 'credited');

    // ---------- Wednesday screen ----------
    async function exposureFigures(tag, amount, principal, fees) {
      const t = await text(page, '#lc-exposure');
      check(tag + ': exposure Outstanding ' + amount + ' (principal ' + principal + ', fees ' + fees + ')',
        (await text(page, '#lc-exposure-status')) === 'Outstanding' && t.includes(amount) && t.includes('principal ' + principal) && t.includes('fees ' + fees), t);
      check(tag + ': remaining principal and fees shown separately', (await text(page, '#lc-rep-principal')) === principal && (await text(page, '#lc-rep-fees')) === fees);
    }
    check('wednesday: clock is Wed 18 Nov', /^Wed 18 Nov/.test(await text(page, '#lc-clock .lc-pay-main')));
    check('wednesday: headline "Supplier credited; importer repayment outstanding"', (await text(page, '#lc-headline')) === 'Supplier credited; importer repayment outstanding');
    await exposureFigures('wednesday', 'SGD 135,532.50', 'SGD 135,382.50', 'SGD 150.00');
    const who = await text(page, '#lc-exposure');
    check('wednesday: who is exposed: provider FAC-NW-01, owed by Northwind', /Provider/.test(who) && who.includes('FAC-NW-01') && who.includes('Northwind'));
    check('wednesday: next action and owner shown', (await text(page, '#lc-next')) === v.decision.next_action && v.decision.next_action.length > 0 && (await text(page, '#lc-owner')) === v.decision.owner);
    check('wednesday: supplier delivery half complete (credited, green)', (await page.getAttribute('#lc-fact-delivery', 'data-status')) === 'credited' &&
      (await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-ok') && (await text(page, '#lc-h-delivery')) === 'Supplier delivery');
    check('wednesday: provider exposure half stays open (amber)', (await page.getAttribute('.half-provider', 'class')).includes('half-exposure') &&
      (await text(page, '#lc-h-provider')).includes('Outstanding SGD 135,532.50'));
    const known = await page.evaluate(() => ['lc-decision', 'lc-facts', 'lc-options', 'lc-evidence', 'lc-timeline', 'lc-facility', 'lc-warnings']
      .map((id) => document.getElementById(id).innerText).join('\n'));
    check('wednesday: Thursday receipt not known anywhere yet', !/Thu 19 Nov/.test(known) && !/140,000\.00 settled/.test(known));
    await shot(page, 'paid-outstanding-wednesday');

    // ---------- Thursday ----------
    for (let guard = 0; guard < 3 && !/^Thu/.test(v.clock.sgt); guard++) v = await act(page, /^Advance to /);
    await stateChecks(page, 'thursday');
    check('thursday: clock Thu 19 Nov 10:00', /^Thu 19 Nov 2026, 10:00/.test(v.clock.sgt), v.clock.sgt);
    await exposureFigures('thursday', 'SGD 135,532.50', 'SGD 135,382.50', 'SGD 150.00');
    v = await act(page, "Record customer receipt (importer's account)");
    await stateChecks(page, 'receipt');
    await exposureFigures('receipt', 'SGD 135,532.50', 'SGD 135,382.50', 'SGD 150.00');
    const rec = await text(page, '.lc-receipts');
    check('receipt: SGD 140,000.00 listed as customer receipt, not repayment', rec.includes('SGD 140,000.00') && /not repayment|not a repayment/.test(rec), rec);
    check('receipt: nothing matched', (await page.locator('#lc-fact-repayment .lc-ilist:not(.lc-receipts)').count()) === 0);
    const receiptState = (await position(page)).stateId;

    v = await act(page, 'Importer pays provider SGD 100,000.00');
    await stateChecks(page, 'paid 100k');
    await exposureFigures('paid 100k (unmatched)', 'SGD 135,532.50', 'SGD 135,382.50', 'SGD 150.00');
    const un = await text(page, '.lc-unallocated');
    check('paid 100k: shown as "Received — not yet matched" SGD 100,000.00', un.startsWith('Received — not yet matched') && un.includes('SGD 100,000.00'), un);
    v = await act(page, 'Match repayment', { keyboard: true });
    await stateChecks(page, 'matched 100k');
    await exposureFigures('matched 100k', 'SGD 35,532.50', 'SGD 35,532.50', 'SGD 0.00');
    check('matched 100k: unallocated list gone; matched shows fees then principal', (await page.locator('.lc-unallocated').count()) === 0 &&
      /SGD 150\.00/.test(await text(page, '#lc-fact-repayment')) && /SGD 99,850\.00/.test(await text(page, '#lc-fact-repayment')));
    check('matched 100k: facility principal outstanding SGD 35,532.50', (await text(page, '#lc-fac-principal')) === 'SGD 35,532.50');
    v = await act(page, 'Importer pays provider SGD 35,532.50 (balance)');
    await stateChecks(page, 'paid balance');
    await exposureFigures('paid balance (unmatched)', 'SGD 35,532.50', 'SGD 35,532.50', 'SGD 0.00');
    v = await act(page, 'Match repayment');
    await stateChecks(page, 'matched balance');
    check('matched balance: exposure "Ended", not amber', (await text(page, '#lc-exposure-status')) === 'Ended' &&
      (await page.getAttribute('#lc-exposure', 'data-open')) === 'false' && !(await page.getAttribute('.half-provider', 'class')).includes('half-exposure'));
    check('matched balance: principal and fees SGD 0.00', (await text(page, '#lc-rep-principal')) === 'SGD 0.00' && (await text(page, '#lc-rep-fees')) === 'SGD 0.00');
    v = await act(page, 'Close case');
    await stateChecks(page, 'closed');
    check('closed: decision tone closed, "Closed" shown', v.decision.tone === 'closed' && (await page.textContent('#lc-tone')) === 'Closed');
    check('closed: exposure Ended', (await text(page, '#lc-exposure-status')) === 'Ended');
    check('closed: reconciled', /^Reconciled: (\d+)\/\1 identities hold$/.test(await text(page, '#lc-inv-summary')), await text(page, '#lc-inv-summary'));
    check('closed: no enabled actions remain except simulated events', !(v.actions || []).some((a) => a.enabled && a.role !== 'Simulated event'));
    await shot(page, 'reconciled-closed');

    // ---------- Reset ----------
    await page.click('#lc-reset');
    await settled(page);
    pos = await position(page);
    check('reset: back to the Friday start state', pos.stateId === fridayId && (await text(page, '#lc-headline')) === startHeadline);
    check('reset: no future information left on screen', !/Thu 19 Nov/.test((await domDump(page)).html) && (await text(page, '#lc-exposure-status')) === 'No advance drawn');

    // ---------- decline ----------
    v = await act(page, 'Request advance');
    v = await act(page, 'Decline');
    await stateChecks(page, 'declined');
    check('declined: "Declined" visible, own tone', v.decision.tone === 'declined' && (await page.textContent('#lc-tone')) === 'Declined' &&
      (await page.getAttribute('#lc-decision', 'class')).includes('tone-declined'));
    check('declined: not green and not red', await page.evaluate(() => {
      const cs = getComputedStyle(document.getElementById('lc-decision'));
      const c = cs.borderLeftColor.match(/\d+/g).map(Number);
      return !(c[1] > c[0] + 40) && !(c[0] > c[1] + 40);
    }));
    check('declined: no reservation, nothing drawn', (await page.getAttribute('#lc-fact-authorization', 'data-status')) === 'declined' &&
      (await text(page, '#lc-fac-reserved')) === 'SGD 0.00' && (await text(page, '#lc-fac-principal')) === 'SGD 0.00' && (await page.getAttribute('#lc-fact-cash', 'data-status')) === 'none');
    check('declined: exposure "No advance drawn"', (await text(page, '#lc-exposure-status')) === 'No advance drawn');
    await shot(page, 'declined');

    // ---------- wrong currency blocks close ----------
    await page.goto(INDEX + '#reference/' + receiptState);
    await settled(page);
    v = await act(page, 'Importer pays provider USD 100.00');
    v = await act(page, 'Match repayment');
    await stateChecks(page, 'usd');
    const unm = await text(page, '.lc-unmatched');
    check('usd: USD 100.00 held as unmatched', unm.includes('USD 100.00'), unm);
    const close = (v.actions || []).find((a) => a.id === 'close');
    check('usd: Close case disabled with reason on screen', !!close && !close.enabled && (await text(page, '#lc-actions li[data-action="close"]')).includes(close.disabled_reason));
    check('usd: case in review, debt unchanged', v.decision.tone === 'review');
    await exposureFigures('usd', 'SGD 135,532.50', 'SGD 135,382.50', 'SGD 150.00');

    // ---------- other cases ----------
    const caseIds = M.cases.map((c) => c.id);
    v = await openCase(page, 'stale_balance');
    await stateChecks(page, 'stale_balance');
    check('stale_balance: asks for newer evidence (unknown, amber)', v.decision.tone === 'unknown' && /newer|stale|old/i.test(v.decision.headline + v.decision.binding_constraint));
    v = await act(page, 'Request advance');
    const ap = (v.actions || []).find((a) => a.id === 'approve_reserve');
    check('stale_balance: Reserve capacity disabled with reason', !!ap && !ap.enabled && (await text(page, '#lc-actions li[data-action="approve_reserve"]')).includes(ap.disabled_reason));
    v = await act(page, 'Request evidence');
    await stateChecks(page, 'stale_balance requested');
    const fresh = pick(v, /balance/i);
    v = await act(page, fresh.label);
    await stateChecks(page, 'stale_balance fresh');
    check('stale_balance: after the fresh balance, Reserve capacity is available', !!pick(v, /^Reserve capacity$/));

    v = await openCase(page, 'fixed_terms');
    await stateChecks(page, 'fixed_terms');
    check('fixed_terms: "Later funding unavailable"', (await domDump(page)).text.includes('Later funding unavailable'));

    v = await openCase(page, 'no_cash');
    await stateChecks(page, 'no_cash');
    check('no_cash: blocked: credit headroom but provider cash insufficient', v.decision.tone === 'blocked' &&
      (await page.locator('#lc-facility .check-fail').count()) > 0);
    v = await act(page, 'Request advance');
    const nr = (v.actions || []).find((a) => a.id === 'approve_reserve');
    check('no_cash: Reserve capacity disabled with reason', !!nr && !nr.enabled && (await text(page, '#lc-actions')).includes(nr.disabled_reason));

    if (caseIds.includes('competing')) {
      v = await openCase(page, 'competing');
      await stateChecks(page, 'competing');
      check('competing: blocked by another payout’s reservation', v.decision.tone === 'blocked' && (await text(page, '#lc-facility')).includes(v.facility.funding_reserved_other_payouts));
      v = await act(page, 'Request advance');
      const cr = (v.actions || []).find((a) => a.id === 'approve_reserve');
      check('competing: Reserve capacity disabled with reason', !!cr && !cr.enabled && (await text(page, '#lc-actions')).includes(cr.disabled_reason));
    }

    v = await openCase(page, 'all_infeasible');
    await stateChecks(page, 'all_infeasible');
    check('all_infeasible: no option feasible on screen', !(v.options || []).some((o) => o.status === 'feasible') && (await page.locator('#lc-options .lc-chip-feasible').count()) === 0);

    v = await openCase(page, 'failed_payout');
    for (const l of ['Request advance', 'Reserve capacity', 'Record simulated draw', 'Instruct payout', 'Provider accepts payout']) v = await act(page, l);
    v = await act(page, /^Beneficiary bank returns|return/i);
    await stateChecks(page, 'failed_payout');
    check('failed_payout: tone failed, delivery returned (red)', v.decision.tone === 'failed' && (await page.getAttribute('#lc-fact-delivery', 'data-status')) === 'returned' &&
      (await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-fail'));
    check('failed_payout: money location shown (last evidenced)', !!v.facts.delivery.last_evidenced && (await text(page, '#lc-fact-delivery')).includes(v.facts.delivery.last_evidenced));
    check('failed_payout: owner and next action shown', (await text(page, '#lc-owner')) === v.decision.owner && (await text(page, '#lc-next')) === v.decision.next_action);
    check('failed_payout: no automatic second payment (Instruct payout not available)', !(v.actions || []).some((a) => a.id === 'instruct' && a.enabled));
    check('failed_payout: exposure still Outstanding, case open', (await text(page, '#lc-exposure-status')) === 'Outstanding' && !(v.actions || []).some((a) => a.id === 'close' && a.enabled));

    // ---------- keyboard ----------
    await page.goto(INDEX);
    await settled(page);
    const before = await position(page);
    let reached = null;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || !a.classList.contains('lc-abtn')) return null;
        const cs = getComputedStyle(a);
        return { label: a.textContent, outline: cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px' };
      });
      if (reached) break;
    }
    check('keyboard: Tab reaches an action button', !!reached);
    check('keyboard: focused action has a visible focus ring', !!(reached && reached.outline));
    if (reached) {
      await page.keyboard.press('Enter');
      await settled(page);
      const after = await position(page);
      check('keyboard: Enter on an action moves to its next state', after.stateId !== before.stateId);
      check('keyboard: focus lands on the decision after the action', await page.evaluate(() => document.activeElement && document.activeElement.id === 'lc-decision-heading'));
    }
    check('keyboard: case selector and Reset are focusable', await page.evaluate(() => {
      return ['lc-case', 'lc-reset'].every((id) => { const n = document.getElementById(id); n.focus(); return document.activeElement === n; });
    }));

    await page.setViewportSize({ width: 390, height: 844 });
    check('390 px: no horizontal scroll (current state)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  } catch (e) {
    check('journey completed without exceptions', false, e.stack || e.message);
  } finally {
    check('no page errors or console errors', errors.length === 0, errors.join(' | '));
    check('no remote requests (file:// only)', remote.length === 0, remote.join(' '));
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log('lifecycle desk: ' + (results.length - failed) + '/' + results.length + ' checks passed' + (failed ? ', ' + failed + ' FAILED' : '') + ' (' + SITE + ')');
  process.exitCode = failed ? 1 : 0;
})();
