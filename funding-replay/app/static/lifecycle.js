/*
 * Provider funding lifecycle desk — interface.
 *
 * Binding rules (see LIFECYCLE_CONTRACT.md):
 *  - This script renders only the engine's view JSON. It never computes money, dates, eligibility or
 *    status: every amount, time and sentence is the engine's string, shown verbatim.
 *  - Moving on means following actions[].next: the next state is a pre-exported file
 *    states/lc-<case>-<state>.js that calls document.currentScript.deliver(<view>).
 *  - Before every load the whole view is emptied, and each view is rendered from scratch, so nothing
 *    from an earlier (or later) state can survive on screen.
 *  - Only relative files are loaded. Works from file:// and any static host.
 */
(function () {
  'use strict';

  var DASH = '—';
  var ID_RE = /^[A-Za-z0-9_-]+$/;

  var st = { caseId: null, stateId: null, view: null, seq: 0, focusAfter: null };

  // ---------- DOM helpers (escape by construction: text only, never innerHTML) ----------
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    appendAll(node, children);
    return node;
  }
  function appendAll(node, children) {
    if (children === null || children === undefined) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  function fill(id, children) {
    var n = $(id);
    n.replaceChildren();
    appendAll(n, children);
  }
  function isBlank(v) { return v === null || v === undefined || v === ''; }
  function show(v) { return isBlank(v) ? DASH : String(v); }
  function num(v, cls) { return el('span', { class: 'num' + (cls ? ' ' + cls : ''), text: show(v) }); }
  function list(arr) { return Array.isArray(arr) ? arr : []; }

  // A list entry may be a string or a small object from the engine; show its strings as given.
  var ITEM_LEAD = ['id', 'amount', 'at_sgt'];
  var ITEM_SKIP = { text: 1, label: 1, note: 1 };
  function itemText(x) {
    if (x === null || x === undefined) return DASH;
    if (typeof x !== 'object') return String(x);
    if (!isBlank(x.text)) return String(x.text);
    if (!isBlank(x.label)) return String(x.label);
    var parts = [];
    ITEM_LEAD.forEach(function (k) { if (!isBlank(x[k]) && typeof x[k] !== 'object') parts.push(String(x[k])); });
    Object.keys(x).forEach(function (k) {
      if (ITEM_LEAD.indexOf(k) >= 0 || ITEM_SKIP[k]) return;
      var v = x[k];
      if (isBlank(v) || typeof v === 'object') return;
      parts.push(k.replace(/_sgt$/, '').replace(/_/g, ' ') + ' ' + v);
    });
    var out = parts.join(' · ');
    if (!isBlank(x.note)) out += (out ? ' — ' : '') + x.note;
    return out;
  }

  // Provider exposure is outstanding unless the engine says it ended. exposure.status is used when the
  // engine sends it; otherwise the repayment status names it (never inferred from amounts).
  var REPAY_ENDED = { repaid: 1, closed: 1, settled: 1, not_started: 1, not_applicable: 1 };
  function exposureOpen(v) {
    var x = v.exposure;
    if (!x) return false;
    if (!isBlank(x.status)) return x.status === 'outstanding' || x.status === 'open';
    var r = (v.facts && v.facts.repayment) || {};
    return !REPAY_ENDED[r.status];
  }

  // ---------- status line ----------
  function setStatus(text, tone) {
    var s = $('lc-status');
    s.className = 'status-line' + (tone ? ' status-' + tone : '');
    s.textContent = text || '';
  }

  // ---------- clearing ----------
  var REGIONS = ['lc-pay', 'lc-decision-body', 'lc-options', 'lc-options-note', 'lc-facts', 'lc-actions',
                 'lc-facility', 'lc-warnings', 'lc-evidence', 'lc-timeline', 'lc-invariants'];
  function clearAll() {
    REGIONS.forEach(function (id) { $(id).replaceChildren(); });
    $('lc-decision').className = 'lc-decision';
    document.title = 'Clearline | Provider funding desk';
  }

  // ---------- loading a state file ----------
  function cases() { return (window.lcMeta && Array.isArray(window.lcMeta.cases)) ? window.lcMeta.cases : []; }
  function findCase(id) {
    var c = cases();
    for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i];
    return null;
  }

  function loadState(caseId, stateId, focusAfter) {
    if (!ID_RE.test(String(caseId)) || !ID_RE.test(String(stateId))) {
      clearAll();
      setStatus('That state reference is not valid. Use Reset to return to the start of the case.', 'error');
      return;
    }
    var my = ++st.seq;
    st.focusAfter = focusAfter || null;
    clearAll();
    st.view = null;
    document.body.setAttribute('aria-busy', 'true');
    setStatus('Loading…', 'busy');
    var script = document.createElement('script');
    var done = false;
    script.deliver = function (view) {
      done = true;
      if (my !== st.seq) return;          // a newer load superseded this one
      document.body.removeAttribute('aria-busy');
      clearAll();
      setStatus('', '');
      st.caseId = caseId;
      st.stateId = stateId;
      st.view = view;
      rememberPosition();
      syncCaseSelect();
      render(view);
      afterRenderFocus();
    };
    script.onload = function () {
      script.remove();
      if (!done && my === st.seq) fail();
    };
    script.onerror = function () { script.remove(); if (my === st.seq) fail(); };
    function fail() {
      document.body.removeAttribute('aria-busy');
      clearAll();
      setStatus('This state could not be loaded. Extract the whole folder (including states/), then open index.html again, or use Reset.', 'error');
    }
    script.src = 'states/lc-' + caseId + '-' + stateId + '.js';
    document.head.appendChild(script);
  }

  function afterRenderFocus() {
    var f = st.focusAfter;
    st.focusAfter = null;
    if (!f) return;
    var n = $(f);
    if (n) n.focus({ preventScroll: false });
  }

  function rememberPosition() {
    try { history.replaceState(null, '', '#' + st.caseId + '/' + st.stateId); } catch (e) { /* file:// edge cases */ }
  }

  function startOf(caseId) {
    var c = findCase(caseId);
    return c ? c.start : null;
  }

  // ---------- controls ----------
  function renderCaseSelect() {
    var sel = $('lc-case');
    sel.replaceChildren();
    cases().forEach(function (c) { sel.appendChild(el('option', { value: c.id, text: c.name || c.id })); });
  }
  function syncCaseSelect() { if (st.caseId) $('lc-case').value = st.caseId; }

  // ---------- render ----------
  function render(v) {
    var evidenceIds = {};
    list(v.evidence).forEach(function (r) { evidenceIds[r.id] = r; });
    var ctx = { v: v, ev: evidenceIds };
    if (v.label) { $('lc-label').textContent = v.label; $('lc-footer-label').textContent = v.label; }
    if (v.case && v.case.name) document.title = 'Clearline | ' + v.case.name + ' | Provider funding desk';
    renderPayment(ctx);
    renderDecision(ctx);
    renderOptions(ctx);
    renderFacts(ctx);
    renderActions(ctx);
    renderFacility(ctx);
    renderWarnings(ctx);
    renderEvidence(ctx);
    renderTimeline(ctx);
    renderInvariants(ctx);
  }

  function payItem(label, main, sub, id, cls) {
    return el('div', { class: 'lc-pay-item' + (cls ? ' ' + cls : ''), id: id || null }, [
      el('span', { class: 'lc-pay-label', text: label }),
      el('span', { class: 'lc-pay-main num', text: show(main) }),
      isBlank(sub) ? null : el('span', { class: 'lc-pay-sub num', text: sub })
    ]);
  }

  function renderPayment(ctx) {
    var h = ctx.v.header || {}, c = ctx.v.clock || {};
    fill('lc-pay', el('div', { class: 'lc-pay-inner' }, [
      el('div', { class: 'lc-pay-item lc-pay-parties', id: 'lc-parties' }, [
        el('span', { class: 'lc-pay-label', text: 'Pay' }),
        el('span', { class: 'lc-pay-main' }, [show(h.importer), el('span', { class: 'lc-arrow', 'aria-label': 'pays', text: ' → ' }), show(h.supplier)])
      ]),
      payItem('Amount', h.amount, null, 'lc-amount', 'lc-pay-amount'),
      payItem('Supplier deadline', h.deadline_sgt, isBlank(h.deadline_ny) ? null : 'New York: ' + h.deadline_ny, 'lc-deadline'),
      payItem(isBlank(c.label) ? 'Clock' : 'Clock · ' + c.label, c.sgt, isBlank(c.ny) ? null : 'New York: ' + c.ny, 'lc-clock', 'lc-pay-clock')
    ]));
  }

  function decisionRow(label, value, id) {
    return el('div', { class: 'lc-drow' }, [el('dt', { text: label }), el('dd', { id: id || null, text: show(value) })]);
  }

  function renderDecision(ctx) {
    var d = ctx.v.decision || {}, x = ctx.v.exposure;
    var tone = isBlank(d.tone) ? 'unknown' : String(d.tone).replace(/[^a-z_]/g, '');
    $('lc-decision').className = 'lc-decision tone-' + tone;
    var exposure = null;
    if (x) {
      var open = exposureOpen(ctx.v);
      exposure = el('div', { class: 'lc-exposure ' + (open ? 'exp-open' : 'exp-ended'), id: 'lc-exposure', 'data-open': open ? 'true' : 'false' }, [
        el('span', { class: 'lc-exposure-label', text: open ? 'Provider exposure outstanding' : 'Provider exposure ended' }),
        el('span', { class: 'lc-exposure-amount num', text: show(x.amount) }),
        el('span', { class: 'lc-exposure-sub num' }, [
          'principal ', show(x.principal), ' · fees ', show(x.fees)
        ]),
        el('span', { class: 'lc-exposure-sub' }, ['Owner: ', show(x.owner)]),
        isBlank(x.ends_when) ? null : el('span', { class: 'lc-exposure-sub lc-exposure-ends' }, [open ? 'Ends: ' : '', x.ends_when])
      ]);
    }
    fill('lc-decision-body', [
      el('p', { class: 'lc-headline', id: 'lc-headline', text: show(d.headline) }),
      el('dl', { class: 'lc-drows' }, [
        decisionRow('Binding constraint', d.binding_constraint, 'lc-binding'),
        decisionRow('Next action', d.next_action, 'lc-next'),
        decisionRow('Owner', d.owner, 'lc-owner')
      ]),
      exposure,
      invMini(ctx)
    ]);
  }

  function invMini(ctx) {
    var inv = list(ctx.v.invariants);
    if (!inv.length) return null;
    var sum = invSummary(inv);
    var a = el('a', { href: '#lc-inv', class: 'lc-inv-mini ' + sum.cls, id: 'lc-inv-mini', text: sum.text });
    a.addEventListener('click', function () { var d = $('lc-inv'); if (d) d.open = true; });
    return el('p', { class: 'lc-inv-line' }, a);
  }

  var OPT_STATUS = { feasible: 'Feasible', infeasible: 'Infeasible', unknown: 'Unknown', unavailable: 'Unavailable',
                     selected: 'Selected', not_selected: 'Not selected' };

  function evidenceChips(ctx, ids) {
    ids = list(ids);
    if (!ids.length) return null;
    return el('span', { class: 'record-ids' }, ids.map(function (id) {
      var rec = ctx.ev[id];
      return el('a', { class: 'record-id', href: '#ev-' + id, title: rec ? (show(rec.kind) + ': ' + show(rec.fact)) : null, text: id });
    }));
  }

  function optRow(label, value) {
    return el('div', { class: 'lc-orow' }, [el('dt', { text: label }), el('dd', { class: 'num', text: show(value) })]);
  }

  function renderOptions(ctx) {
    var opts = list(ctx.v.options);
    fill('lc-options', opts.map(function (o) {
      var status = isBlank(o.status) ? 'unknown' : String(o.status).replace(/[^a-z_]/g, '');
      var key = String(o.key || '');
      var dq = list(o.disqualifiers);
      return el('article', { class: 'lc-option opt-' + status, id: 'lc-option-' + key, 'aria-labelledby': 'lc-option-title-' + key }, [
        el('header', { class: 'lc-ohead' }, [
          el('span', { class: 'lc-okey', 'aria-hidden': 'true', text: key }),
          el('h3', { id: 'lc-option-title-' + key }, [el('span', { class: 'visually-hidden', text: 'Option ' + key + ': ' }), show(o.title)]),
          el('span', { class: 'status-chip lc-chip-' + status, text: OPT_STATUS[status] || status })
        ]),
        // Both slots are always present so rows line up across A/B/C.
        dq.length ? el('ul', { class: 'lc-dq', 'aria-label': 'Disqualifiers' }, dq.map(function (t) { return el('li', { text: itemText(t) }); }))
                  : el('p', { class: 'lc-dq lc-dq-none', text: 'No disqualifiers' }),
        el('dl', { class: 'lc-orows' }, [
          optRow('Whose money', o.whose_money),
          optRow('Committed', o.committed_at),
          optRow('Amount', o.amount),
          optRow('Duration', o.duration),
          optRow('Modeled cost', o.modeled_cost),
          optRow('Risk bearer', o.risk_bearer)
        ]),
        el('p', { class: 'lc-oev' }, list(o.evidence).length ? [el('span', { class: 'lc-mini', text: 'Evidence ' }), evidenceChips(ctx, o.evidence)] : [el('span', { class: 'lc-mini', text: 'No evidence cited' })])
      ]);
    }));
    $('lc-options-note').textContent = ctx.v.options_note || '';
  }

  // Tone per fact comes from the engine's status value only (no inference from amounts).
  var DELIVERY_TONE = { credited: 'ok', returned: 'fail', failed: 'fail', rejected: 'fail' };
  var AUTH_TONE = { requested: 'unknown', evidence_requested: 'unknown', reserved: 'held', consumed: 'held',
                    declined: 'closed', released: 'closed', expired: 'closed' };
  var CASH_TONE = { drawn: 'exposure', repaid: 'closed' };   // 'drawn' turns neutral once exposure has ended
  var REPAY_TONE = { outstanding: 'exposure', partial: 'exposure', partially_repaid: 'exposure', due: 'exposure',
                     overdue: 'fail', repaid: 'closed', closed: 'closed', settled: 'closed', unmatched: 'fail', review: 'unknown' };

  function factRow(name, f, tone, extra, id) {
    f = f || {};
    return el('div', { class: 'lc-fact fact-' + tone, id: id, 'data-status': isBlank(f.status) ? null : f.status }, [
      el('div', { class: 'lc-fact-name', text: name }),
      el('div', { class: 'lc-fact-body' }, [
        el('div', { class: 'lc-fact-label', text: show(f.label) }),
        isBlank(f.detail) ? null : el('div', { class: 'lc-fact-detail', text: f.detail }),
        extra
      ])
    ]);
  }

  function itemList(title, arr, cls) {
    arr = list(arr);
    if (!arr.length) return null;
    return el('div', { class: 'lc-ilist ' + (cls || '') }, [
      el('span', { class: 'lc-mini', text: title }),
      el('ul', { class: 'plain-list' }, arr.map(function (x) { return el('li', { class: 'num', text: itemText(x) }); }))
    ]);
  }

  function inlineRow(label, value, id) {
    return el('div', null, [el('dt', { text: label }), el('dd', { class: 'num', id: id || null, text: show(value) })]);
  }

  function renderFacts(ctx) {
    var f = ctx.v.facts || {}, x = ctx.v.exposure;
    var a = f.authorization || {}, c = f.cash || {}, d = f.delivery || {}, r = f.repayment || {};
    var dTone = DELIVERY_TONE[d.status] || 'pending';
    var deliveryExtra = isBlank(d.last_evidenced) ? null : el('div', { class: 'lc-fact-detail num' }, ['Last evidenced: ', d.last_evidenced]);
    var repayExtra = el('div', null, [
      el('dl', { class: 'lc-inline' }, [
        inlineRow('Principal outstanding', r.principal_outstanding, 'lc-rep-principal'),
        inlineRow('Fees outstanding', r.fees_outstanding, 'lc-rep-fees'),
        inlineRow('Due', r.due_sgt, 'lc-rep-due'),
        inlineRow('Owner', r.owner, 'lc-rep-owner')
      ]),
      itemList('Matched repayments', r.matched),
      itemList('Customer receipts (importer’s own account, not repayment)', r.customer_receipts, 'lc-receipts'),
      itemList('Unmatched, held for review', r.unmatched, 'lc-unmatched'),
      isBlank(r.allocation_rule) ? null : el('p', { class: 'lc-fact-detail lc-alloc' }, [el('span', { class: 'lc-mini', text: 'Allocation rule: ' }), r.allocation_rule])
    ]);
    var open = exposureOpen(ctx.v);
    var provTone = open ? 'exposure' : 'closed';
    var cTone = CASH_TONE[c.status] || 'pending';
    if (cTone === 'exposure' && !open) cTone = 'closed';
    var rTone = REPAY_TONE[r.status] || (open ? 'exposure' : 'pending');
    // Layout only: options lead until the engine reports a payout or provider exposure.
    var started = !!x || (!isBlank(d.status) && d.status !== 'none');
    $('lc-col-main').className = 'lc-col lc-col-main' + (started ? '' : ' phase-pre');
    fill('lc-facts', [
      el('section', { class: 'lc-half half-delivery half-' + dTone, 'aria-labelledby': 'lc-h-delivery' }, [
        el('h3', { id: 'lc-h-delivery', text: 'Supplier delivery' }),
        factRow('Delivery', d, dTone, deliveryExtra, 'lc-fact-delivery')
      ]),
      el('section', { class: 'lc-half half-provider half-' + provTone, 'aria-labelledby': 'lc-h-provider' }, [
        el('h3', { id: 'lc-h-provider' }, ['Provider exposure', el('span', { class: 'lc-half-state', text: open ? ' · outstanding ' + show(x.amount) : (x ? ' · ended' : ' · none outstanding') })]),
        el('div', { class: 'lc-prov-facts' }, [
          factRow('Authorisation', a, AUTH_TONE[a.status] || 'pending', null, 'lc-fact-authorization'),
          factRow('Cash', c, cTone, null, 'lc-fact-cash'),
          factRow('Repayment', r, rTone, repayExtra, 'lc-fact-repayment')
        ])
      ])
    ]);
  }

  function roleTag(role) {
    var r = isBlank(role) ? 'Operator' : String(role);
    var simEvent = r === 'Simulated event';
    return el('span', { class: 'lc-role ' + (simEvent ? 'role-event' : 'role-' + r.toLowerCase().replace(/[^a-z]/g, '')),
                        text: simEvent ? 'Simulated event' : 'Simulated role: ' + r });
  }

  function actionItem(ctx, a, i) {
    var cid = 'lc-act-c-' + i, rid = 'lc-act-r-' + i;
    var enabled = !!a.enabled && !isBlank(a.next);
    var dup = enabled && a.next === ctx.v.state_id;
    var isEvent = a.role === 'Simulated event';
    var described = [isBlank(a.consequence) ? null : cid, enabled ? null : rid].filter(Boolean).join(' ');
    var btn = el('button', {
      type: 'button',
      class: 'btn lc-abtn' + (isEvent ? ' lc-abtn-event' : ''),
      'data-action': a.id,
      disabled: !enabled,
      'aria-describedby': described || null
    }, show(a.label));
    if (enabled) btn.addEventListener('click', function () { loadState(st.caseId, a.next, 'lc-decision-heading'); });
    return el('li', { class: 'lc-action' + (enabled ? '' : ' is-disabled') + (isEvent ? ' is-event' : ''), 'data-action': a.id }, [
      el('div', { class: 'lc-action-top' }, [btn, roleTag(a.role)]),
      isBlank(a.consequence) ? null : el('p', { class: 'lc-consequence', id: cid }, [el('span', { class: 'lc-mini', text: enabled ? 'If clicked: ' : 'Would: ' }), a.consequence]),
      enabled ? null : el('p', { class: 'lc-disabled-reason', id: rid }, [el('span', { class: 'lc-mini', text: 'Not available: ' }), show(a.disabled_reason)]),
      dup ? el('p', { class: 'lc-dup', text: 'Repeat of an earlier action: the engine records no change.' }) : null
    ]);
  }

  // Disabled actions stay listed with the engine's reason; the operator may fold the list (remembered per browser).
  function offList(items) {
    var det = el('details', { class: 'lc-off', id: 'lc-off' }, [
      el('summary', { class: 'lc-off-title', id: 'lc-off-title', text: 'Not available now (' + items.length + ')' }),
      el('ul', { class: 'lc-alist lc-alist-off', 'aria-labelledby': 'lc-off-title' }, items)
    ]);
    var pref = null;
    try { pref = window.localStorage.getItem('lc-off-folded'); } catch (e) { pref = null; }
    det.open = pref !== '1';
    det.addEventListener('toggle', function () {
      try { window.localStorage.setItem('lc-off-folded', det.open ? '0' : '1'); } catch (e) { /* storage unavailable */ }
    });
    return det;
  }

  // Enabled actions first (engine order), then disabled ones with the engine's reason. Nothing is hidden.
  function renderActions(ctx) {
    var acts = list(ctx.v.actions);
    if (!acts.length) {
      fill('lc-actions', el('p', { class: 'lc-note', id: 'lc-no-actions', text: 'No further actions in this simulation.' }));
      return;
    }
    var on = [], off = [];
    acts.forEach(function (a, i) { (a.enabled && !isBlank(a.next) ? on : off).push(actionItem(ctx, a, i)); });
    fill('lc-actions', [
      on.length ? el('ul', { class: 'lc-alist', 'aria-label': 'Available now' }, on)
                : el('p', { class: 'lc-note', id: 'lc-no-actions', text: 'No action is available at this point.' }),
      off.length ? offList(off) : null
    ]);
  }

  function ruleIcon(ok) {
    if (ok === true) return { cls: 'ok', icon: '✓', word: 'OK' };
    if (ok === false) return { cls: 'fail', icon: '✕', word: 'Fails' };
    return { cls: 'unknown', icon: '?', word: 'Unknown' };
  }

  function ruleList(rules, id) {
    if (!rules.length) return null;
    return el('ul', { class: 'checks lc-rules', id: id || null }, rules.map(function (r) {
      var s = ruleIcon(r.ok);
      return el('li', { class: 'check check-' + s.cls }, [
        el('span', { class: 'check-icon', 'aria-hidden': 'true', text: s.icon }),
        el('span', { class: 'check-body' }, [
          el('span', { class: 'check-name' }, [el('span', { class: 'visually-hidden', text: s.word + ': ' }), show(r.rule)]),
          isBlank(r.detail) ? null : el('span', { class: 'check-detail', text: r.detail })
        ])
      ]);
    }));
  }

  function facRow(label, value, id, cls) {
    if (value === undefined) return null;             // field not sent by the engine
    return el('div', { class: 'lc-orow' + (cls ? ' ' + cls : '') }, [el('dt', { text: label }), el('dd', { class: 'num', id: id || null, text: show(value) })]);
  }

  var GROUP_CREDIT = 'Authorised to lend', GROUP_CASH = 'Cash available to pay';

  function renderFacility(ctx) {
    var f = ctx.v.facility;
    if (!f) {
      fill('lc-facility', el('p', { class: 'lc-note', id: 'lc-no-facility', text: 'No provider facility applies to this case.' }));
      return;
    }
    var cur = isBlank(f.denomination) ? '' : ' (' + f.denomination + ')';
    var rules = list(f.rules);
    var open = exposureOpen(ctx.v);
    var creditRules = rules.filter(function (r) { return r.group === GROUP_CREDIT; });
    var cashRules = rules.filter(function (r) { return r.group === GROUP_CASH; });
    var otherRules = rules.filter(function (r) { return r.group !== GROUP_CREDIT && r.group !== GROUP_CASH; });
    fill('lc-facility', [
      el('p', { class: 'lc-fac-id' }, [el('strong', { text: show(f.name) }), ' ', el('span', { class: 'mono', text: show(f.id) }),
        el('span', { class: 'muted', text: ' · policy ' + show(f.policy_version) + ' · denominated in ' + show(f.denomination) +
          (isBlank(f.status) ? '' : ' · ' + f.status) })]),
      isBlank(f.label) ? null : el('p', { class: 'lc-fac-label', text: f.label }),
      ruleList(otherRules, 'lc-rules'),
      el('div', { class: 'lc-fac-groups' }, [
        el('section', { class: 'lc-fac-group', 'aria-labelledby': 'lc-fac-credit' }, [
          el('h3', { id: 'lc-fac-credit', text: 'Authorised to lend (credit limit)' }),
          ruleList(creditRules, 'lc-rules-credit'),
          el('dl', { class: 'lc-mrows' }, [
            facRow('Company limit' + cur, f.company_limit),
            facRow('Available' + cur, f.company_available),
            facRow('Reserved, not drawn' + cur, f.reserved, 'lc-fac-reserved', 'row-reserved'),
            facRow('Principal outstanding' + cur, f.principal_outstanding, 'lc-fac-principal', 'row-outstanding' + (open ? ' is-exposed' : '')),
            facRow('Fees outstanding' + cur, f.fees_outstanding, 'lc-fac-fees', open ? 'is-exposed row-outstanding' : null),
            facRow('Fees collected' + cur, f.fees_collected),
            facRow('Committed capacity' + cur, f.committed_capacity)
          ])
        ]),
        el('section', { class: 'lc-fac-group', 'aria-labelledby': 'lc-fac-cash' }, [
          el('h3', { id: 'lc-fac-cash', text: 'Cash available to pay (' + (isBlank(f.funding_account) ? 'provider funding account' : f.funding_account) + ')' }),
          ruleList(cashRules, 'lc-rules-cash'),
          el('dl', { class: 'lc-mrows' }, [
            facRow('Funding at start' + cur, f.funding_start),
            facRow('Available cash' + cur, f.funding_available_cash),
            facRow('Reserved cash' + cur, f.funding_reserved),
            facRow('… for this payout' + cur, f.funding_reserved_this_payout),
            facRow('… for other payouts' + cur, f.funding_reserved_other_payouts)
          ])
        ]),
        el('section', { class: 'lc-fac-group', 'aria-labelledby': 'lc-fac-terms' }, [
          el('h3', { id: 'lc-fac-terms', text: 'Terms' }),
          el('dl', { class: 'lc-mrows' }, [
            facRow('Fee per advance' + cur, f.fee),
            facRow('Repayment due', f.repayment_due_sgt),
            facRow('Reservation expires', f.reservation_expiry_sgt),
            facRow('Route deadline', f.route_deadline_sgt)
          ])
        ])
      ])
    ]);
  }

  function renderWarnings(ctx) {
    var w = list(ctx.v.warnings);
    if (!w.length) return;
    fill('lc-warnings', el('div', { class: 'warnings lc-warn', role: 'note' }, [
      el('strong', { text: 'Warnings' }),
      el('ul', { class: 'plain-list' }, w.map(function (t) { return el('li', { text: itemText(t) }); }))
    ]));
  }

  function renderEvidence(ctx) {
    var rows = list(ctx.v.evidence);
    if (!rows.length) { fill('lc-evidence', el('p', { class: 'muted', text: 'No evidence records are known at this time.' })); return; }
    var head = el('thead', null, el('tr', null, ['ID', 'Kind', 'What it establishes', 'Source', 'Effective', 'First known', 'Status']
      .map(function (h) { return el('th', { scope: 'col', text: h }); })));
    var body = el('tbody', null, rows.map(function (r) {
      return el('tr', { id: 'ev-' + r.id }, [
        el('th', { scope: 'row', class: 'mono', text: show(r.id) }),
        el('td', { text: show(r.kind) }),
        el('td', { text: show(r.fact) }),
        el('td', { text: show(r.source) }),
        el('td', { class: 'num', text: show(r.effective_sgt) }),
        el('td', { class: 'num', text: show(r.known_sgt) }),
        el('td', { text: show(r.status) })
      ]);
    }));
    fill('lc-evidence', el('table', { class: 'evidence lc-evtable' }, [el('caption', { class: 'visually-hidden', text: 'Evidence known at the simulation clock' }), head, body]));
  }

  function renderTimeline(ctx) {
    var t = list(ctx.v.timeline);
    var c = ctx.v.case || {};
    var desc = isBlank(c.description) ? null : el('p', { class: 'lc-case-desc', id: 'lc-case-desc' }, [el('strong', { text: show(c.name) }), ' ', c.description]);
    if (!t.length) { fill('lc-timeline', [desc, el('p', { class: 'muted', text: 'Nothing has happened yet in this simulation.' })]); return; }
    fill('lc-timeline', [desc, el('ol', { class: 'lc-tl' }, t.map(function (e) {
      var sim = /simulated/i.test(String(e.actor || ''));
      return el('li', { class: 'lc-tl-item' + (sim ? ' is-sim' : '') }, [
        el('div', { class: 'lc-tl-when num' }, [
          show(e.at_sgt),
          (!isBlank(e.known_sgt) && e.known_sgt !== e.at_sgt) ? el('span', { class: 'lc-tl-known', text: 'known ' + e.known_sgt }) : null
        ]),
        el('div', { class: 'lc-tl-what' }, [
          el('span', { class: 'lc-tl-actor' + (sim ? ' lc-role role-event' : ''), text: show(e.actor) }),
          ' ', el('span', { text: show(e.text) })
        ])
      ]);
    }))]);
  }

  // Counts the engine's own ok flags for a one-line summary; the identities themselves are the engine's.
  function invSummary(inv) {
    var held = inv.filter(function (i) { return i.ok === true; }).length;
    var failing = inv.filter(function (i) { return i.ok === false; }).length;
    if (held === inv.length) return { cls: 'inv-ok', text: 'Reconciled: ' + held + '/' + inv.length + ' identities hold' };
    if (failing) return { cls: 'inv-fail', text: 'Reconciliation breach: ' + failing + ' of ' + inv.length + ' identities fail' };
    return { cls: 'inv-unknown', text: 'Reconciliation incomplete: ' + held + '/' + inv.length + ' identities confirmed' };
  }

  function renderInvariants(ctx) {
    var inv = list(ctx.v.invariants);
    if (!inv.length) { fill('lc-invariants', el('p', { class: 'muted', text: 'No reconciliation checks returned.' })); return; }
    var sum = invSummary(inv), allOk = sum.cls === 'inv-ok', failing = sum.cls === 'inv-fail', summaryText = sum.text;
    var det = el('details', { class: 'lc-inv ' + sum.cls, id: 'lc-inv' }, [
      el('summary', { id: 'lc-inv-summary', text: summaryText }),
      el('ul', { class: 'checks' }, inv.map(function (i) {
        var s = ruleIcon(i.ok);
        return el('li', { class: 'check check-' + s.cls }, [
          el('span', { class: 'check-icon', 'aria-hidden': 'true', text: s.icon }),
          el('span', { class: 'check-body' }, [
            el('span', { class: 'check-name' }, [el('span', { class: 'visually-hidden', text: s.word + ': ' }), show(i.name)]),
            isBlank(i.detail) ? null : el('span', { class: 'check-detail num', text: i.detail })
          ])
        ]);
      }))
    ]);
    if (!allOk) det.open = true;
    fill('lc-invariants', det);
  }

  // ---------- boot ----------
  function boot() {
    if (!cases().length) {
      setStatus('The case list (lc-meta.js) is missing. Extract the whole folder, then open index.html again.', 'error');
      return;
    }
    if (window.lcMeta.label) { $('lc-label').textContent = window.lcMeta.label; $('lc-footer-label').textContent = window.lcMeta.label; }
    renderCaseSelect();
    $('lc-case').addEventListener('change', function (ev) {
      var id = ev.target.value;
      var s = startOf(id);
      if (s) loadState(id, s);
    });
    $('lc-reset').addEventListener('click', function () {
      var id = st.caseId || $('lc-case').value;
      var s = startOf(id);
      if (s) loadState(id, s, 'lc-decision-heading');
    });
    var caseId = null, stateId = null;
    var m = /^#([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(location.hash || '');
    if (m && findCase(m[1])) { caseId = m[1]; stateId = m[2]; }
    if (!caseId) {
      caseId = findCase('reference') ? 'reference' : cases()[0].id;
      stateId = startOf(caseId);
    }
    $('lc-case').value = caseId;
    loadState(caseId, stateId);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
