/*
 * Funding decision replay — interface.
 *
 * Rendering rules (binding, see CONTRACT.md):
 *  - This script never computes money, dates, decisions or comparisons. Every number and sentence
 *    about the payment comes verbatim from the engine JSON. No arithmetic on amounts, no parsing of
 *    money strings.
 *  - Every control change calls POST /api/evaluate again.
 *  - Nothing from a previous response is reused: before each request every data region is emptied,
 *    and each response re-renders every region from scratch.
 *  - Only the local API is contacted (relative URLs).
 */
(function () {
  'use strict';

  var state = {
    meta: null,
    scenario: null,
    decisionTime: 'friday',
    rate: null,      // string, sent as-is
    seq: 0           // guards against out-of-order responses
  };

  var DECISION_TONE = {
    KEEP_FRIDAY: 'neutral',
    MONDAY_FEASIBLE: 'neutral',
    MONDAY_UNAVAILABLE: 'neutral',
    HINDSIGHT: 'hindsight',
    MANUAL_REVIEW: 'amber',
    NO_DECISION: 'amber',
    NEED_NEWER_BALANCE: 'amber',   // unknown, never green: cash is not established either way
    INSUFFICIENT_CASH: 'red',
    DEADLINE_AT_RISK: 'red'
  };

  var STATUS_LABEL = {
    feasible: 'Feasible',
    infeasible: 'Infeasible',
    unknown: 'Unknown',
    not_evidenced: 'Not evidenced',
    passed: 'Passed'
  };

  var CHECK_LABEL = { ok: 'OK', fail: 'Fail', unknown: 'Unknown' };
  var CHECK_ICON = { ok: '✓', fail: '✕', unknown: '?' };

  var DASH = '—';

  // ---------- small DOM helpers ----------
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

  function isBlank(v) { return v === null || v === undefined || v === ''; }
  function show(v) { return isBlank(v) ? DASH : String(v); }
  function num(text, extraClass) {
    return el('span', { class: 'num' + (extraClass ? ' ' + extraClass : ''), text: show(text) });
  }

  // ---------- networking (local API only) ----------
  function api(method, path, body, contentType) {
    if (window.clearlineDemoAPI) return window.clearlineDemoAPI(path, body);
    var opts = { method: method, headers: {} , cache: 'no-store' };
    if (body !== undefined) {
      opts.body = body;
      opts.headers['Content-Type'] = contentType || 'application/json';
    }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        return { ok: res.ok, status: res.status, data: data, raw: txt };
      });
    });
  }

  // ---------- status line ----------
  function setStatus(text, tone) {
    var s = $('status-line');
    s.replaceChildren();
    s.className = 'status-line' + (tone ? ' status-' + tone : '');
    if (text) s.textContent = text;
  }

  // ---------- controls ----------
  function decisionTimeList(meta) {
    var list = (meta && meta.decision_times) || [];
    return list.map(function (d) {
      if (typeof d === 'string') return { id: d, label: d };
      return { id: d.id, label: d.label || d.id, as_of: d.as_of_sgt || d.as_of || '' };
    });
  }

  function renderDecisionTimes() {
    var wrap = $('decision-times');
    wrap.replaceChildren();
    var items = decisionTimeList(state.meta);
    items.forEach(function (d, i) {
      var selected = d.id === state.decisionTime;
      var b = el('button', {
        type: 'button',
        class: 'seg' + (selected ? ' is-selected' : ''),
        role: 'radio',
        'aria-checked': selected ? 'true' : 'false',
        tabindex: selected ? '0' : '-1',
        'data-id': d.id,
        id: 'dt-' + d.id
      }, d.label);
      b.addEventListener('click', function () { selectDecisionTime(d.id, true); });
      b.addEventListener('keydown', function (ev) {
        var dir = 0;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') dir = 1;
        else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') dir = -1;
        else if (ev.key === 'Home') { ev.preventDefault(); selectDecisionTime(items[0].id, true); return; }
        else if (ev.key === 'End') { ev.preventDefault(); selectDecisionTime(items[items.length - 1].id, true); return; }
        if (!dir) return;
        ev.preventDefault();
        var next = items[(i + dir + items.length) % items.length];
        selectDecisionTime(next.id, true);
      });
      wrap.appendChild(b);
    });
  }

  function selectDecisionTime(id, focus) {
    state.decisionTime = id;
    renderDecisionTimes();
    if (focus) {
      var b = $('dt-' + id);
      if (b) b.focus();
    }
    evaluate();
  }

  function renderScenarioSelect() {
    var sel = $('scenario');
    sel.replaceChildren();
    var scenarios = (state.meta && state.meta.scenarios) || [];
    scenarios.forEach(function (s) {
      var o = el('option', { value: s.id }, s.name || s.id);
      if (s.id === state.scenario) o.selected = true;
      sel.appendChild(o);
    });
    sel.value = state.scenario || '';
    // Scenario descriptions are narrative written with hindsight; they are deliberately not shown,
    // so no future information can leak into an earlier decision-time view.
  }

  function hasScenario(id) {
    var scenarios = (state.meta && state.meta.scenarios) || [];
    return scenarios.some(function (s) { return s.id === id; });
  }

  function defaultScenario() {
    var scenarios = (state.meta && state.meta.scenarios) || [];
    if (hasScenario('reference')) return 'reference';
    return scenarios.length ? scenarios[0].id : null;
  }

  function syncRateControls() {
    $('rate').value = state.rate === null ? '' : state.rate;
    Array.prototype.forEach.call(document.querySelectorAll('.rate-quick'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-rate') === state.rate ? 'true' : 'false');
    });
  }

  function setRate(value) {
    var v = String(value).trim();
    if (v === state.rate) { syncRateControls(); return; }
    state.rate = v;
    syncRateControls();
    evaluate();
  }

  function renderDatasetLabel() {
    var cur = state.meta && state.meta.current_dataset;
    $('dataset-label').textContent = cur ? ('Current dataset: ' + cur) : '';
  }

  // ---------- clearing (no stale data, ever) ----------
  var DATA_REGIONS = ['decision-body', 'payment-body', 'qa', 'warnings', 'options', 'comparison',
                      'evidence-intro', 'evidence-table', 'assumption-text', 'assumption-formula'];

  function clearAll() {
    DATA_REGIONS.forEach(function (id) {
      var n = $(id);
      n.replaceChildren();
      n.removeAttribute('title');
    });
    $('decision').className = 'decision-card';
  }

  // ---------- evaluate ----------
  var rateTimer = null;

  function evaluate() {
    if (!state.scenario) return;
    var my = ++state.seq;
    clearAll();
    document.body.setAttribute('aria-busy', 'true');
    setStatus('Evaluating…', 'busy');
    var body = JSON.stringify({
      scenario: state.scenario,
      decision_time: state.decisionTime,
      funding_rate_pct: state.rate === null ? '' : state.rate
    });
    return api('POST', '/api/evaluate', body).then(function (r) {
      if (my !== state.seq) return;          // a newer request superseded this one
      document.body.removeAttribute('aria-busy');
      clearAll();
      if (!r.ok || !r.data || r.data.ok === false) {
        setStatus(errorText(r), 'error');
        return;
      }
      setStatus('', '');
      render(r.data);
    }).catch(function () {
      if (my !== state.seq) return;
      document.body.removeAttribute('aria-busy');
      clearAll();
      setStatus(window.clearlineDemoAPI ? 'The sample results could not be loaded. Extract the whole folder, then open index.html again.' : 'The local replay server did not respond. Start it with python3 app/server.py.', 'error');
    });
  }

  function errorText(r) {
    var d = r.data || {};
    if (Array.isArray(d.errors) && d.errors.length) {
      return 'The engine rejected the request: ' + d.errors.map(formatError).join('; ');
    }
    if (d.error) return 'The engine rejected the request: ' + d.error;
    if (d.message) return 'The engine rejected the request: ' + d.message;
    return 'The engine returned an error (HTTP ' + r.status + ').';
  }

  function formatError(e) {
    if (typeof e === 'string') return e;
    var parts = [];
    if (!isBlank(e.row)) parts.push('Row ' + e.row);
    if (!isBlank(e.column)) parts.push('column ' + e.column);
    var prefix = parts.join(', ');
    return (prefix ? prefix + ': ' : '') + (e.message || '');
  }

  // ---------- render ----------
  function render(data) {
    var evidenceById = {};
    (data.evidence || []).forEach(function (r) { evidenceById[r.record_id] = r; });
    var ctx = { data: data, evidenceById: evidenceById };

    if (data.label) {
      $('banner').textContent = data.label;
      $('footer-label').textContent = data.label;
    }
    renderDecision(ctx);
    renderPayment(ctx);
    renderQA(ctx);
    renderWarnings(ctx);
    renderOptions(ctx);
    renderComparison(ctx);
    renderEvidence(ctx);
    renderAssumption(ctx);
  }

  function renderDecision(ctx) {
    var d = ctx.data.decision || {};
    var dt = ctx.data.decision_time || {};
    var tone = DECISION_TONE[d.state] || 'neutral';
    $('decision').className = 'decision-card tone-' + tone;
    var asOf = el('p', { class: 'as-of' }, [
      'Evidence as of ',
      el('strong', { class: 'num', text: show(dt.as_of_sgt) }),
      dt.as_of_ny ? el('span', { class: 'muted', text: ' · ' + dt.as_of_ny }) : null
    ]);
    var chips = el('div', { class: 'chip-row' }, [
      dt.label ? el('span', { class: 'chip chip-time', text: dt.label }) : null,
      ctx.data.scenario && ctx.data.scenario.name ? el('span', { class: 'chip', text: ctx.data.scenario.name }) : null,
      ctx.data.scenario && ctx.data.scenario.synthetic ? el('span', { class: 'chip chip-synth', text: 'Synthetic' }) : null
    ]);
    var noteNode = null;
    if (!isBlank(dt.note)) {
      // The tag only names the kind of view (from the selected decision-time id); the sentence is the engine's.
      var tagText = dt.id === 'monday' ? 'Counterfactual' : (dt.id === 'retro' ? 'Hindsight' : 'Note');
      noteNode = el('p', { class: 'dt-note dt-note-' + (dt.id || 'other'), id: 'dt-note' }, [
        el('span', { class: 'tag tag-view', text: tagText }), ' ', el('span', { text: dt.note })
      ]);
    }
    // replaceChildren() would print a literal "null" for a missing node, so filter first.
    $('decision-body').replaceChildren.apply($('decision-body'), [
      asOf,
      noteNode,
      el('p', { class: 'headline', id: 'headline', text: show(d.headline) }),
      el('p', { class: 'reason', id: 'reason', text: show(d.reason) }),
      renderBalanceCheck(d),
      chips
    ].filter(Boolean));
  }

  // decision.balance_check: every value is the engine's string; nothing is derived here
  // (the age is the engine's age_at_slot, never computed from the timestamps).
  function renderBalanceCheck(d) {
    var b = d.balance_check;
    if (!b) return null;
    var hasBalance = !isBlank(b.balance_sgt) || !isBlank(b.balance_id);
    var balanceNode = hasBalance
      ? el('span', null, [
          el('span', { class: 'num bc-main', text: show(b.balance_sgt) }),
          isBlank(b.balance_id) ? null : el('span', { class: 'bc-sub num', text: b.balance_id +
            (isBlank(b.balance_known_sgt) ? '' : ' · known ' + b.balance_known_sgt) }),
          isBlank(b.expired_sgt) ? null : el('span', { class: 'bc-sub num', text: 'expired ' + b.expired_sgt })
        ])
      : el('span', { class: 'bc-main', text: 'None on file' });
    var slotName = isBlank(b.slot) ? 'funding' : b.slot;
    var ageNode = el('span', null, [
      el('span', { class: 'num bc-main', id: 'bc-age', text: isBlank(b.age_at_slot) ? DASH : b.age_at_slot }),
      isBlank(b.slot_sgt) ? null : el('span', { class: 'bc-sub num', text: 'at ' + b.slot_sgt })
    ]);
    var actions = Array.isArray(d.next_actions) ? d.next_actions : [];
    function row(label, node, cls) {
      return el('div', { class: 'bc-row' + (cls ? ' ' + cls : '') }, [el('dt', { text: label }), el('dd', null, node)]);
    }
    return el('section', { class: 'balance-check bc-' + (b.problem || 'unknown'), id: 'balance-check', 'aria-label': 'Bank balance check' }, [
      el('h3', { class: 'bc-title', text: b.problem === 'missing' ? 'Bank balance check: no balance on file' : 'Bank balance check: balance too old' }),
      el('dl', { class: 'bc-rows' }, [
        row('Newest bank balance', balanceNode),
        row('Age at the ' + slotName + ' slot', ageNode),
        row('Limit', el('span', { class: 'bc-main', text: show(b.limit) })),
        actions.length ? row('Next action', el('span', { class: 'bc-main', id: 'bc-next', text: actions[0] }), 'bc-row-wide') : null
      ])
    ]);
  }

  function renderPayment(ctx) {
    var p = ctx.data.payment || {};
    function fact(label, main, sub, note, id) {
      return el('div', { class: 'fact', id: id || null }, [
        el('div', { class: 'fact-label', text: label }),
        el('div', { class: 'fact-main num', text: main }),
        sub ? el('div', { class: 'fact-sub num', text: sub }) : null,
        note ? el('div', { class: 'fact-note', text: note }) : null
      ]);
    }
    $('payment-body').replaceChildren(
      fact('Route', 'Singapore \u2192 United States', 'SGD funding \u00b7 USD to the supplier\u2019s US bank', null, 'fact-route'),
      fact('Net amount the supplier must receive', isBlank(p.net_usd) ? DASH : 'USD ' + p.net_usd + ' net', null, null, 'fact-net'),
      fact('Spendable-funds deadline', show(p.deadline_sgt), isBlank(p.deadline_ny) ? null : 'New York: ' + p.deadline_ny, null, 'fact-deadline'),
      fact('Provider release checkpoint', show(p.release_sgt), isBlank(p.release_ny) ? null : 'New York: ' + p.release_ny,
           'Provider release is not supplier credit.', 'fact-release'),
      fact('Beneficiary credit', show(p.beneficiary_credit), null, null, 'fact-credit')
    );
  }

  function qaRow(q, answer) {
    return [el('dt', { text: q }), el('dd', null, answer)];
  }

  function listOrNone(items, emptyText) {
    if (!Array.isArray(items) || !items.length) return el('span', { class: 'muted', text: emptyText });
    return el('ul', { class: 'plain-list' }, items.map(function (t) { return el('li', { text: t }); }));
  }

  function renderQA(ctx) {
    var d = ctx.data.decision || {};
    var cash = d.cash_after_commitments;
    var cashNode = cash
      ? el('div', null, [
          el('span', { class: 'num amount', text: show(cash.amount) }),
          cash.explain ? el('div', { class: 'explain num', text: cash.explain }) : null
        ])
      : el('span', { class: 'muted', text: DASH + ' Not established from the evidence visible at this time.' });
    var rows = [].concat(
      qaRow('What is the binding constraint?', el('span', { text: show(d.binding_constraint) })),
      qaRow('How much cash is available after other commitments?', cashNode),
      qaRow('What evidence is missing?', listOrNone(d.missing_evidence, 'None')),
      qaRow('What could you do next with your existing bank or provider?', listOrNone(d.next_actions, 'None listed'))
    );
    $('qa').replaceChildren.apply($('qa'), rows);
  }

  function renderWarnings(ctx) {
    var w = ctx.data.warnings;
    if (!Array.isArray(w) || !w.length) { $('warnings').replaceChildren(); return; }
    $('warnings').replaceChildren(el('div', { class: 'warnings', role: 'note' }, [
      el('strong', { text: 'Warnings' }),
      el('ul', { class: 'plain-list' }, w.map(function (t) { return el('li', { text: t }); }))
    ]));
  }

  function recordChips(ctx, ids) {
    if (!Array.isArray(ids) || !ids.length) return null;
    return el('span', { class: 'record-ids' }, ids.map(function (id) {
      var rec = ctx.evidenceById[id];
      return el('a', {
        class: 'record-id',
        href: '#ev-' + id,
        title: rec ? (rec.kind + ': ' + (rec.fact || '')) : null,
        text: id
      });
    }));
  }

  function firstIssue(opt) {
    var checks = opt.checks || [];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].state !== 'ok' && checks[i].detail) return checks[i].detail;
    }
    if (opt.status === 'not_evidenced') return 'Not evidenced at this decision time.';
    if (opt.status === 'passed') return 'This slot has already passed.';
    return null;
  }

  function valueOrReason(text, reason, unit) {
    if (!isBlank(text)) {
      return el('span', { class: 'num value' }, unit ? [String(text), el('span', { class: 'unit', text: ' ' + unit })] : String(text));
    }
    return el('span', { class: 'null-value' }, [
      el('span', { class: 'num', text: DASH }),
      reason ? el('span', { class: 'null-reason', text: reason }) : null
    ]);
  }

  function optionRow(label, valueNode, opts) {
    opts = opts || {};
    return el('div', { class: 'opt-row' + (opts.assumption ? ' is-assumption' : '') }, [
      el('dt', null, [label, opts.assumption ? el('span', { class: 'tag tag-assumption tag-inline', text: 'Assumption' }) : null]),
      el('dd', null, valueNode)
    ]);
  }

  function renderOptions(ctx) {
    var options = ctx.data.options || [];
    var rate = ctx.data.assumption && ctx.data.assumption.funding_rate_pct;
    var cards = options.map(function (opt) {
      var reason = firstIssue(opt);
      var status = opt.status || 'unknown';
      var checks = (opt.checks || []).map(function (c) {
        var st = c.state || 'unknown';
        // A simulated delivery bound is not observed supplier credit: never show it as a green tick.
        var simulated = st === 'ok' && /^Simulated /.test(c.name || '');
        return el('li', { class: 'check check-' + st + (simulated ? ' check-simulated' : '') }, [
          el('span', { class: 'check-icon', 'aria-hidden': 'true', text: simulated ? '~' : (CHECK_ICON[st] || '?') }),
          el('span', { class: 'check-body' }, [
            el('span', { class: 'check-name' }, [
              el('span', { class: 'visually-hidden', text: (CHECK_LABEL[st] || st) + ': ' }),
              c.name || ''
            ]),
            c.detail ? el('span', { class: 'check-detail', text: c.detail }) : null,
            recordChips(ctx, c.record_ids)
          ])
        ]);
      });

      var reqNode = valueOrReason(opt.required_sgd, reason);
      if (!isBlank(opt.required_sgd) && !isBlank(opt.fees_sgd)) {
        reqNode = el('span', null, [reqNode, el('span', { class: 'sub num', text: 'of which fees ' + opt.fees_sgd })]);
      }
      var daysNode;
      if (isBlank(opt.restricted_days) && isBlank(opt.sgd_days)) {
        daysNode = valueOrReason(null, reason);
      } else {
        daysNode = el('span', null, [
          valueOrReason(opt.restricted_days, reason, 'days'),
          el('span', { class: 'sub num', text: isBlank(opt.sgd_days) ? DASH + ' SGD\u2011days' : opt.sgd_days + ' SGD\u2011days' })
        ]);
      }
      var costLabel = 'Funding cost at assumed rate' + (isBlank(rate) ? '' : ' (' + rate + '% p.a.)');

      return el('article', { class: 'option-card status-' + status, id: 'option-' + opt.slot, 'aria-labelledby': 'option-title-' + opt.slot }, [
        el('header', { class: 'option-head' }, [
          el('h3', { id: 'option-title-' + opt.slot, text: opt.label || opt.slot }),
          el('span', { class: 'status-chip status-chip-' + status, text: STATUS_LABEL[status] || status })
        ]),
        el('dl', { class: 'opt-rows' }, [
          optionRow('Principal', valueOrReason(opt.principal_sgd, reason)),
          optionRow('Required SGD (incl. fees)', reqNode),
          optionRow('Cash headroom', valueOrReason(opt.cash_headroom_sgd, reason)),
          optionRow('Restricted days & SGD-days', daysNode),
          optionRow('Average restricted balance (30 d)', valueOrReason(opt.avg_restricted_30d, reason)),
          optionRow(costLabel, isBlank(opt.funding_cost_sgd) ? valueOrReason(null, reason) : el('span', null, [
            valueOrReason(opt.funding_cost_sgd, reason),
            isBlank(opt.funding_cost_formula) ? null : el('code', { class: 'sub num formula-inline', text: opt.funding_cost_formula })
          ]), { assumption: true })
        ]),
        el('h4', { class: 'checks-title', text: 'Checks' }),
        checks.length ? el('ul', { class: 'checks' }, checks) : el('p', { class: 'muted small', text: 'No checks returned.' })
      ]);
    });
    $('options').replaceChildren.apply($('options'), cards);
  }

  function compRow(label, value, opts) {
    opts = opts || {};
    return el('div', { class: 'comp-row' + (opts.assumption ? ' is-assumption' : '') }, [
      el('dt', null, [label, opts.assumption ? el('span', { class: 'tag tag-assumption tag-inline', text: 'Assumption' }) : null]),
      el('dd', { class: 'num', text: show(value) })
    ]);
  }

  function renderComparison(ctx) {
    var c = ctx.data.comparison;
    var d = ctx.data.decision || {};
    var box = $('comparison');
    if (!c) { box.replaceChildren(); return; }

    if (c.available === false) {
      box.replaceChildren(el('div', { class: 'comparison comp-withheld', id: 'comparison-block' }, [
        el('h3', { text: 'Comparison withheld' }),
        el('p', { text: show(c.withheld_reason) })
      ]));
      return;
    }

    var mode, heading;
    if (d.actionable_on_friday === false) {
      mode = 'hindsight'; heading = 'Hindsight only — not available to the operator on Friday';
    } else if (d.state === 'HINDSIGHT') {
      mode = 'hindsight'; heading = 'Hindsight view';
    } else {
      mode = 'plain'; heading = 'Comparison under evidence visible at this time';
    }

    var days = c.days || {};
    var daysText = (isBlank(days.friday) && isBlank(days.monday)) ? DASH
      : 'Friday ' + show(days.friday) + ' days vs Monday ' + show(days.monday) + ' days';

    var rows = [
      compRow('Days the principal is restricted', daysText),
      compRow('Restricted SGD-days avoided', isBlank(c.sgd_days_less) ? null : c.sgd_days_less + ' SGD\u2011days'),
      compRow('Average restricted balance lower by (30 d)', c.avg_restricted_less_30d),
      compRow('Carry reduction at assumed rate', c.carry_reduction, { assumption: true }),
      compRow('Extra processing for waiting', c.extra_processing)
    ];
    if (!isBlank(c.reservation_cost)) rows.push(compRow('Reservation cost of the later slot', c.reservation_cost));
    rows.push(compRow('Net before subscription', c.net_benefit_before_subscription, { assumption: true }));

    box.replaceChildren(el('div', { class: 'comparison comp-' + mode, id: 'comparison-block' }, [
      el('h3', { text: heading }),
      c.framing ? el('p', { class: 'framing', text: c.framing }) : null,
      el('dl', { class: 'comp-rows' }, rows),
      c.formula ? el('p', { class: 'formula' }, [el('span', { class: 'formula-label', text: 'Formula ' }), el('code', { class: 'num', text: c.formula })]) : null,
      c.zero_rate_note ? el('p', { class: 'zero-note', text: c.zero_rate_note }) : null,
      c.risk_note ? el('p', { class: 'risk-note', id: 'risk-note', text: c.risk_note }) : null
    ]));
  }

  function renderEvidence(ctx) {
    var rows = ctx.data.evidence || [];
    var dt = ctx.data.decision_time || {};
    $('evidence-intro').textContent = 'Records first known at or before ' + show(dt.as_of_sgt) +
      '. Records first known later are excluded from this view.';
    if (!rows.length) {
      $('evidence-table').replaceChildren(el('p', { class: 'muted', text: 'No evidence records are visible at this time.' }));
      return;
    }
    var head = el('thead', null, el('tr', null, ['Record ID', 'Kind', 'What it establishes', 'Effective', 'First known', 'Expires', 'Status', 'Used by']
      .map(function (h) { return el('th', { scope: 'col', text: h }); })));
    var body = el('tbody', null, rows.map(function (r) {
      var used = Array.isArray(r.used_by) && r.used_by.length
        ? el('ul', { class: 'plain-list tight' }, r.used_by.map(function (u) { return el('li', { text: u }); }))
        : el('span', { class: 'muted', text: DASH });
      return el('tr', { id: 'ev-' + r.record_id }, [
        el('th', { scope: 'row', class: 'mono', text: show(r.record_id) }),
        el('td', null, [show(r.kind), isBlank(r.slot) ? null : el('span', { class: 'sub', text: r.slot })]),
        el('td', { text: show(r.fact) }),
        el('td', { class: 'num nowrap-ish', text: show(r.effective_sgt) }),
        el('td', { class: 'num nowrap-ish', text: show(r.known_sgt) }),
        el('td', { class: 'num nowrap-ish', text: show(r.expires_sgt) }),
        el('td', { text: show(r.status) }),
        el('td', null, used)
      ]);
    }));
    $('evidence-table').replaceChildren(el('table', { class: 'evidence' }, [
      el('caption', { class: 'visually-hidden', text: 'Evidence records visible at the selected decision time' }), head, body
    ]));
  }

  function renderAssumption(ctx) {
    var a = ctx.data.assumption || {};
    var c = ctx.data.comparison;
    $('assumption-text').textContent = a.text || '';
    var f = $('assumption-formula');
    if (c && c.available !== false && c.formula) {
      f.replaceChildren(el('span', { class: 'formula-label', text: 'Engine formula: ' }), el('code', { class: 'num', text: c.formula }));
    } else {
      var lines = (ctx.data.options || []).filter(function (o) { return !isBlank(o.funding_cost_formula); })
        .map(function (o) { return el('span', { class: 'formula-line' }, [el('span', { class: 'formula-label', text: (o.label || o.slot) + ': ' }), el('code', { class: 'num', text: o.funding_cost_formula })]); });
      if (lines.length) f.replaceChildren.apply(f, [el('span', { class: 'formula-label', text: 'Engine formula (funding cost)' })].concat(lines));
      else f.replaceChildren(el('span', { class: 'muted', text: 'No funding-cost formula at this decision time.' }));
    }
  }

  // ---------- data panel ----------
  function refreshMeta() {
    return api('GET', '/api/meta').then(function (r) {
      if (!r.ok || !r.data) throw new Error('meta');
      state.meta = r.data;
      renderScenarioSelect();
      renderDatasetLabel();
    });
  }

  function renderImportErrors(errors, status) {
    var box = $('import-result');
    var list = Array.isArray(errors) ? errors : [];
    box.replaceChildren(el('div', { class: 'import-errors', role: 'alert' }, [
      el('strong', { text: 'Import rejected' + (status ? ' (HTTP ' + status + ')' : '') + '. The current scenario is unchanged.' }),
      list.length
        ? el('ul', { class: 'plain-list' }, list.map(function (e) { return el('li', { class: 'mono-ish', text: formatError(e) }); }))
        : null
    ]));
  }

  function onImport(ev) {
    var input = ev.target;
    var file = input.files && input.files[0];
    if (!file) return;
    $('import-result').replaceChildren(el('p', { class: 'muted', text: 'Importing ' + file.name + '…' }));
    file.text().then(function (text) {
      return api('POST', '/api/import', text, 'text/csv; charset=utf-8');
    }).then(function (r) {
      input.value = '';
      if (r.ok && r.data && r.data.ok) {
        var target = r.data.scenario || 'imported';
        return refreshMeta().then(function () {
          if (hasScenario(target)) state.scenario = target;
          renderScenarioSelect();
          $('import-result').replaceChildren(el('p', { class: 'ok-note', text: 'Imported ' + file.name + '. Showing the imported scenario.' }));
          return evaluate();
        });
      }
      renderImportErrors(r.data && r.data.errors, r.status);
    }).catch(function () {
      input.value = '';
      renderImportErrors([{ message: 'The file could not be read or sent to the local server.' }]);
    });
  }

  function onReset() {
    api('POST', '/api/reset', '{}').then(function (r) {
      if (!r.ok) { renderImportErrors(r.data && r.data.errors, r.status); return; }
      return refreshMeta().then(function () {
        if (!hasScenario(state.scenario)) state.scenario = defaultScenario();
        renderScenarioSelect();
        $('import-result').replaceChildren(el('p', { class: 'ok-note', text: 'Sample dataset restored.' }));
        return evaluate();
      });
    });
  }

  function jumpTo(sectionId, headingId) {
    var s = $(sectionId);
    s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var h = $(headingId);
    if (h) h.focus({ preventScroll: true });
  }

  // ---------- boot ----------
  function boot() {
    $('scenario').addEventListener('change', function (ev) {
      state.scenario = ev.target.value;   // decision time is kept as-is
      renderScenarioSelect();
      evaluate();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.rate-quick'), function (b) {
      b.addEventListener('click', function () { setRate(b.getAttribute('data-rate')); });
    });
    var rateInput = $('rate');
    rateInput.addEventListener('change', function () { clearTimeout(rateTimer); setRate(rateInput.value); });
    rateInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); clearTimeout(rateTimer); setRate(rateInput.value); }
    });
    rateInput.addEventListener('input', function () {
      clearTimeout(rateTimer);
      rateTimer = setTimeout(function () { setRate(rateInput.value); }, 500);
    });
    $('open-evidence').addEventListener('click', function () { jumpTo('evidence', 'evidence-heading'); });
    // The tester edition ships without the Data panel (no CSV upload), so these controls may be absent.
    if ($('open-data')) $('open-data').addEventListener('click', function () { jumpTo('data', 'data-heading'); });
    if ($('csv-file')) $('csv-file').addEventListener('change', onImport);
    if ($('reset')) $('reset').addEventListener('click', onReset);

    setStatus('Loading…', 'busy');
    refreshMeta().then(function () {
      if (state.meta.label) $('banner').textContent = state.meta.label;
      var dts = decisionTimeList(state.meta);
      if (dts.length && !dts.some(function (d) { return d.id === state.decisionTime; })) state.decisionTime = dts[0].id;
      state.scenario = defaultScenario();
      state.rate = isBlank(state.meta.default_rate_pct) ? '' : String(state.meta.default_rate_pct);
      renderDecisionTimes();
      renderScenarioSelect();
      syncRateControls();
      evaluate();
    }).catch(function () {
      setStatus(window.clearlineDemoAPI ? 'The sample results could not be loaded. Extract the whole folder, then open index.html again.' : 'The local replay server did not respond. Start it with python3 app/server.py.', 'error');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
