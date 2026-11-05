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
async function act(page, label) {
  const v = await currentView(page);
  const m = (x) => (label instanceof RegExp ? label.test(x.label) : x.label === label);
  const a = (v.actions || []).find((x) => m(x) && x.enabled) || (v.actions || []).find(m);
  if (!a) throw new Error('No action matching ' + label + ' in ' + v.state_id + '; have: ' + (v.actions || []).map((x) => x.label + (x.enabled ? '' : ' (disabled)')).join(' | '));
  const btn = page.locator('#lc-actions').getByRole('button', { name: a.label, exact: true });
  if (!a.enabled) throw new Error('Action "' + a.label + '" is disabled: ' + a.disabled_reason);
  await btn.click();
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
    check(tag + ': no exposure block when the view has none', (await page.locator('#lc-exposure').count()) === 0);
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

    // ---------- Reserve capacity ----------
    v = await reserve(page, v);
    v = await act(page, RESERVE);
    await stateChecks(page, 'reserved');
    check('reserved: capacity reserved', /reserv/i.test(v.facts.authorization.status));
    check('reserved: delivery not paid', v.facts.delivery.status !== 'credited' && !(await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-ok'));
    check('reserved: cash not drawn', v.facts.cash.status !== 'drawn' && (await page.getAttribute('#lc-fact-cash', 'data-status')) !== 'drawn');
    if (v.facility) {
      check('reserved: reserved and principal outstanding shown separately', (await text(page, '#lc-fac-reserved')) === v.facility.reserved &&
        (await text(page, '#lc-fac-principal')) === v.facility.principal_outstanding);
    }
    await shot(page, 'approval-reserved');

    // ---------- draw -> instruct -> accept -> credit ----------
    v = await act(page, /^(Record simulated draw|Draw)/i);
    await stateChecks(page, 'drawn');
    check('drawn: cash drawn; exposure outstanding', v.facts.cash.status === 'drawn' && !!v.exposure);
    v = await act(page, /^Instruct/i);
    await stateChecks(page, 'instructed');
    check('instructed: delivery instructed, not credited', v.facts.delivery.status !== 'credited');
    v = await act(page, /accepts?\b/i);
    await stateChecks(page, 'accepted');
    check('accepted: accepted by provider is not credited (no green)', v.facts.delivery.status !== 'credited' &&
      !(await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-ok'));
    v = await act(page, (pick(v, /^Beneficiary credit/i, /credit/i) || {}).label || /^Beneficiary credit/i);
    await stateChecks(page, 'credited');
    check('credited: delivery credited is green', v.facts.delivery.status === 'credited' &&
      (await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-ok'));

    // ---------- advance to Wednesday ----------
    for (let guard = 0; guard < 4; guard++) {
      const adv = (v.actions || []).find((x) => x.enabled && x.next !== v.state_id && /Wed|Wednesday/.test(x.label)) ||
        (!/Wed/.test(v.clock.sgt) ? (v.actions || []).find((x) => x.enabled && /advance/i.test(x.label)) : null);
      if (!adv) break;
      v = await act(page, adv.label);
    }
    await stateChecks(page, 'wednesday');
    check('wednesday: clock on Wednesday', /Wed/.test(v.clock.sgt), v.clock.sgt);
    check('wednesday: "Supplier credited; importer repayment outstanding"', (await text(page, '#lc-headline')) === 'Supplier credited; importer repayment outstanding', await text(page, '#lc-headline'));
    check('wednesday: amount, owner and next action shown', !!v.exposure && (await text(page, '#lc-exposure')).includes(v.exposure.amount) &&
      (await text(page, '#lc-owner')) === v.decision.owner && (await text(page, '#lc-next')) === v.decision.next_action && !!v.decision.next_action);
    check('wednesday: split shows Supplier delivery vs Provider exposure', (await text(page, '#lc-facts')).includes('Supplier delivery') && (await text(page, '#lc-facts')).includes('Provider exposure'));
    const known = await page.evaluate(() => ['lc-decision', 'lc-facts', 'lc-options', 'lc-evidence', 'lc-timeline', 'lc-facility', 'lc-warnings']
      .map((id) => document.getElementById(id).innerText).join('\n'));
    check('wednesday: Thursday receipt not yet known anywhere (only the clock-advance button names Thu)', !/Thu 19 Nov/.test(known) &&
      !(v.facts.repayment.customer_receipts || []).length);
    await shot(page, 'paid-outstanding-wednesday');

    // ---------- Thursday receipt ----------
    for (let guard = 0; guard < 3 && !(v.facts.repayment.customer_receipts || []).length; guard++) {
      const nxt = pick(v, /receipt settles|customer receipt/i, /^Advance to Thu/i);
      if (!nxt) break;
      v = await act(page, nxt.label);
    }
    await stateChecks(page, 'thursday');
    check('thursday: debt still outstanding after the importer’s own receipt', !!v.exposure && v.facts.repayment.principal_outstanding === (await text(page, '#lc-rep-principal')) &&
      !/SGD 0\.00$/.test(v.facts.repayment.principal_outstanding));
    check('thursday: receipt listed as customer receipt, not repayment', (v.facts.repayment.customer_receipts || []).length > 0 && (await page.locator('.lc-receipts li').count()) === v.facts.repayment.customer_receipts.length);
    const principalBefore = v.facts.repayment.principal_outstanding;

    // ---------- partial repayment ----------
    const partial = pick(v, /partial/i, /^Importer repays SGD/i, /^Match repayment/i);
    v = await act(page, partial.label);
    const matchP = pick(v, /^Match repayment/i);
    if (matchP) v = await act(page, matchP.label);
    await stateChecks(page, 'partial');
    check('partial: remaining principal shown as the engine states', (await text(page, '#lc-rep-principal')) === v.facts.repayment.principal_outstanding &&
      v.facts.repayment.principal_outstanding !== principalBefore, v.facts.repayment.principal_outstanding);
    check('partial: remaining fees shown as the engine states', (await text(page, '#lc-rep-fees')) === v.facts.repayment.fees_outstanding);
    check('partial: exposure still outstanding', !!v.exposure);

    // ---------- final repayment + close ----------
    for (let guard = 0; guard < 4 && !pick(v, /^close/i); guard++) {
      const nxt = pick(v, /final|remaining/i, /^Match/i);
      if (!nxt) break;
      v = await act(page, nxt.label);
      await stateChecks(page, 'repaying');
    }
    check('final: principal and fees fully repaid', /SGD 0\.00/.test(v.facts.repayment.principal_outstanding) && /SGD 0\.00/.test(v.facts.repayment.fees_outstanding),
      v.facts.repayment.principal_outstanding + ' / ' + v.facts.repayment.fees_outstanding);
    v = await act(page, /^close/i);
    await stateChecks(page, 'closed');
    check('closed: decision tone closed', v.decision.tone === 'closed' && (await page.getAttribute('#lc-decision', 'class')).includes('tone-closed'));
    check('closed: no exposure outstanding (block absent or marked ended, not amber)', !v.exposure ||
      ((await page.getAttribute('#lc-exposure', 'data-open')) === 'false' && (await text(page, '#lc-exposure')).includes('ended')));
    check('closed: provider half not amber', !(await page.getAttribute('.half-provider', 'class')).includes('half-exposure'));
    check('closed: reconciled', /^Reconciled: (\d+)\/\1 identities hold$/.test(await text(page, '#lc-inv-summary')), await text(page, '#lc-inv-summary'));
    check('closed: timeline lists what changed', (await page.locator('#lc-timeline li').count()) === (v.timeline || []).length && (v.timeline || []).length > 0);
    await page.click('#lc-inv summary');
    await shot(page, 'reconciled-closed');

    // ---------- Reset ----------
    await page.click('#lc-reset');
    await settled(page);
    pos = await position(page);
    check('reset: back to the reference start', pos.stateId === M.cases.find((c) => c.id === 'reference').start && (await text(page, '#lc-headline')) === startHeadline);
    dump = await domDump(page);
    check('reset: no future information left on screen', !/Thu 19 Nov/.test(dump.html));

    // ---------- decline path ----------
    v = await reserve(page, await currentView(page));
    const dec = findAction(v, /^decline/i);
    check('decline: offered at the Friday decision', !!dec && dec.enabled);
    if (dec) {
      v = await act(page, dec.label);
      await stateChecks(page, 'declined');
      check('declined: authorisation declined; nothing drawn or paid', /declin/i.test(v.facts.authorization.status) && v.facts.cash.status !== 'drawn' && v.facts.delivery.status !== 'credited');
      check('declined: tone', v.decision.tone === 'declined' || v.decision.tone === 'closed' || v.decision.tone === 'review', v.decision.tone);
    }

    // ---------- other cases ----------
    const caseIds = M.cases.map((c) => c.id);
    if (caseIds.includes('stale_balance')) {
      v = await openCase(page, 'stale_balance');
      await stateChecks(page, 'stale_balance');
      check('stale_balance: asks for newer evidence', /newer|stale|older/i.test(v.decision.headline + ' ' + v.decision.binding_constraint), v.decision.headline);
      v = await reserve(page, v);
      check('stale_balance: reviewer cannot reserve on a stale balance', !(findAction(v, RESERVE) || {}).enabled);
      const req = pick(v, /^Request (evidence|newer)/i);
      check('stale_balance: Request evidence offered', !!req);
      v = await act(page, req.label);
      await stateChecks(page, 'stale_balance requested');
      for (let guard = 0; guard < 3 && !(findAction(v, RESERVE) || {}).enabled; guard++) {
        const ev = (v.actions || []).find((a) => a.enabled && a.role === 'Simulated event');
        if (!ev) break;
        v = await act(page, ev.label);
        await stateChecks(page, 'stale_balance evidence');
      }
      check('stale_balance: after fresh evidence, the reviewer can reserve', !!(findAction(v, RESERVE) || {}).enabled);
    }
    if (caseIds.includes('no_cash')) {
      v = await openCase(page, 'no_cash');
      await stateChecks(page, 'no_cash');
      check('no_cash: blocked at the start', v.decision.tone === 'blocked', v.decision.tone);
      v = await reserve(page, v);
      await stateChecks(page, 'no_cash requested');
      const r = findAction(v, RESERVE);
      check('no_cash: blocked and reservation not available', v.decision.tone === 'blocked' && (!r || !r.enabled), v.decision.tone);
      if (r && !r.enabled) check('no_cash: disabled reason shown', (await text(page, '#lc-actions')).includes(r.disabled_reason));
    }
    if (caseIds.includes('fixed_terms')) {
      v = await openCase(page, 'fixed_terms');
      await stateChecks(page, 'fixed_terms');
      check('fixed_terms: "Later funding unavailable"', (await domDump(page)).text.includes('Later funding unavailable'));
    }
    if (caseIds.includes('all_infeasible')) {
      v = await openCase(page, 'all_infeasible');
      await stateChecks(page, 'all_infeasible');
      check('all_infeasible: no option shown as feasible', !(v.options || []).some((o) => o.status === 'feasible') &&
        (await page.locator('#lc-options .lc-chip-feasible').count()) === 0);
    }
    if (caseIds.includes('failed_payout')) {
      v = await openCase(page, 'failed_payout');
      for (let guard = 0; guard < 12 && v.decision.tone !== 'failed'; guard++) {
        const nxt = pick(v, /^Request advance/i, RESERVE, /^(Record simulated draw|Draw)/i, /^Instruct/i, /accepts?\b/i, /returns?\b|fail/i, /^Advance to/i);
        if (!nxt) break;
        v = await act(page, nxt.label);
      }
      await stateChecks(page, 'failed_payout');
      check('failed_payout: tone failed, delivery not credited', v.decision.tone === 'failed' && v.facts.delivery.status !== 'credited' &&
        (await page.getAttribute('#lc-fact-delivery', 'class')).includes('fact-fail'), v.decision.tone + ' ' + v.facts.delivery.status);
      check('failed_payout: case stays open (no enabled close)', !(v.actions || []).some((a) => /^close/i.test(a.label) && a.enabled) && v.decision.tone !== 'closed');
      check('failed_payout: money last evidenced shown', !v.facts.delivery.last_evidenced || (await text(page, '#lc-fact-delivery')).includes(v.facts.delivery.last_evidenced));
    }

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
