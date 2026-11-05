/*
 * Clearline pilot operating desk — single-page interface.
 *
 * Rules (PILOT_CONTRACT.md):
 *  - Renders only the server's read models. It never adds, subtracts or compares amounts: every figure is a
 *    server string shown verbatim. Amounts the operator types are sent as typed; the server parses them.
 *  - Same origin only. No inline scripts or style attributes (CSP: script-src 'self'; style-src 'self').
 *  - Every mutating request carries X-CSRF-Token; every command carries idempotency_key + expected_version.
 *  - Text only (textContent), never innerHTML.
 */
(function () {
  'use strict';

  var DASH = '—';
  var CURRENCIES = ['SGD', 'USD', 'EUR', 'GBP', 'HKD', 'JPY'];
  var PROVENANCE = {
    operator_entered: { label: 'Operator-entered', cls: 'prov-operator', title: 'Typed in by an operator. Not confirmed by a bank or provider.' },
    external_record: { label: 'External record', cls: 'prov-external', title: 'Backed by an attached external document.' },
    provider_event: { label: 'Provider event', cls: 'prov-provider', title: 'Reported by the payout provider.' },
    sandbox_simulation: { label: 'Sandbox simulation', cls: 'prov-sandbox', title: 'Sandbox — not a live payment.' },
    system: { label: 'System', cls: 'prov-system', title: 'Recorded by the desk itself.' }
  };

  var S = {
    me: null, csrf: null, view: null, caseId: null, focus: null, users: null, facilities: null,
    dialog: null, busy: false, routeSeq: 0
  };

  // ---------------------------------------------------------------- DOM helpers
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = String(v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : String(v));
      });
    }
    add(n, children);
    return n;
  }
  function add(n, children) {
    if (children === null || children === undefined || children === false) return n;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) { add(n, c); return; }
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  function blank(v) { return v === null || v === undefined || v === ''; }
  function show(v) { return blank(v) ? DASH : String(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function pick(o) {
    if (!o || typeof o !== 'object') return undefined;
    for (var i = 1; i < arguments.length; i++) { var v = o[arguments[i]]; if (!blank(v)) return v; }
    return undefined;
  }
  function humanize(s) { return show(s).replace(/_/g, ' '); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16); crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // A money value from the server: a display string, or an object carrying one. Never computed here.
  function moneyText(v) {
    if (blank(v)) return DASH;
    if (typeof v !== 'object') return String(v);
    var d = pick(v, 'display', 'text', 'formatted', 'label');
    if (!blank(d)) return String(d);
    if (!blank(v.amount) && !blank(v.currency)) return v.currency + ' ' + v.amount;
    return DASH;
  }
  function money(v, cls) { return el('span', { class: 'num money' + (cls ? ' ' + cls : ''), text: moneyText(v) }); }
  // A time value: local string plus zone, UTC on hover. Accepts a string or {local, tz, utc}.
  function timeText(v) {
    if (blank(v)) return DASH;
    if (typeof v !== 'object') return String(v);
    return show(pick(v, 'local', 'display', 'text', 'utc'));
  }
  function time(v, utc) {
    var t = el('span', { class: 'num time', text: timeText(v) });
    var u = utc || (v && typeof v === 'object' ? v.utc : null);
    if (!blank(u)) t.setAttribute('title', 'UTC ' + u);
    return t;
  }
  function text(v) {
    if (blank(v)) return DASH;
    if (typeof v !== 'object') return String(v);
    var d = pick(v, 'text', 'label', 'display', 'summary', 'name', 'message');
    if (!blank(d)) return String(d);
    return Object.keys(v).filter(function (k) { return !blank(v[k]) && typeof v[k] !== 'object'; })
      .map(function (k) { return humanize(k) + ' ' + v[k]; }).join(' · ') || DASH;
  }
  function utcShort(v) {
    var m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(timeText(v));
    return m ? m[1] + ' ' + m[2] + ' UTC' : timeText(v);
  }
  function provBadge(p) {
    if (blank(p)) return null;
    var m = PROVENANCE[p] || { label: humanize(p), cls: 'prov-system', title: '' };
    return el('span', { class: 'prov ' + m.cls, title: m.title, text: m.label });
  }
  function roleTag(r) { return blank(r) ? null : el('span', { class: 'pd-role role-' + r, text: r }); }
  function chip(label, cls) { return el('span', { class: 'chip ' + (cls || ''), text: label }); }
  function kv(rows, cls) {
    return el('dl', { class: 'kv ' + (cls || '') }, rows.filter(Boolean).map(function (r) {
      return el('div', { class: 'kv-row' + (r[2] ? ' ' + r[2] : '') }, [el('dt', { text: r[0] }), el('dd', null, r[1])]);
    }));
  }
  function section(title, id, children, cls) {
    return el('section', { class: 'panel ' + (cls || ''), 'aria-labelledby': id + '-h', id: id }, [
      el('h2', { class: 'kicker', id: id + '-h', tabindex: '-1', text: title })
    ].concat(children || []));
  }
  function tableWrap(label, head, rows, cls) {
    var t = el('table', { class: 'grid ' + (cls || '') }, [
      el('thead', null, el('tr', null, head.map(function (h) {
        return el('th', { scope: 'col', class: h.cls || null, text: h.label || h });
      }))),
      el('tbody', null, rows)
    ]);
    return el('div', { class: 'table-wrap', role: 'region', 'aria-label': label, tabindex: '0' }, t);
  }
  function td(content, cls) { return el('td', { class: cls || null }, content); }

  // ---------------------------------------------------------------- status / alerts
  function status(msg) { $('pd-status').textContent = msg || ''; }
  function alertMsg(msg, tone) {
    var a = $('pd-alert');
    if (!msg) { a.hidden = true; a.textContent = ''; return; }
    a.className = 'pd-alert ' + (tone ? 'alert-' + tone : 'alert-error');
    a.textContent = msg; a.hidden = false;
  }

  // ---------------------------------------------------------------- API
  function ApiError(status, body) {
    var e = (body && body.error) || {};
    this.status = status; this.code = e.code || ('http_' + status);
    this.message = e.message || (status === 404 ? 'Not found.' : 'Request failed (' + status + ').');
    this.field = e.field; this.fields = e.fields || e.errors || (body && body.errors) || null; this.body = body;
  }
  function api(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    var opts = { method: method, credentials: 'same-origin', headers: headers, cache: 'no-store' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (method !== 'GET' && S.csrf) headers['X-CSRF-Token'] = S.csrf;
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (t) {
        var data = null;
        try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
        if (!r.ok) {
          var err = new ApiError(r.status, data);
          if (r.status === 401 && path !== '/api/login') { S.me = null; S.csrf = null; renderChrome(); goLogin(); }
          throw err;
        }
        return data;
      });
    });
  }

  // ---------------------------------------------------------------- time zones (time only — never money)
  var ZONES = (function () { try { return Intl.supportedValuesOf('timeZone'); } catch (e) { return ['UTC', 'Asia/Singapore', 'Europe/London', 'Europe/Stockholm', 'Europe/Berlin', 'America/New_York', 'Asia/Hong_Kong', 'Asia/Tokyo']; } })();
  function validZone(tz) { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; } }
  function zoneOffsetMs(ms, tz) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).forEach(function (p) { parts[p.type] = p.value; });
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second) - ms;
  }
  // "2026-11-18T23:00" wall time in tz -> "2026-11-18T15:00:00Z"
  function zonedToUtc(local, tz) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
    if (!m || !validZone(tz)) return null;
    var wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var off = zoneOffsetMs(wall, tz);
    var ts = wall - off;
    var off2 = zoneOffsetMs(ts, tz);
    if (off2 !== off) ts = wall - off2;
    return new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  function zoneAbbr(tz, utcIso) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(utcIso));
      var z = p.filter(function (x) { return x.type === 'timeZoneName'; })[0];
      return z ? z.value : tz;
    } catch (e) { return tz; }
  }
  var zoneList = null;
  function zoneDatalist() {
    if (zoneList) return zoneList;
    zoneList = el('datalist', { id: 'pd-zones' }, ZONES.map(function (z) { return el('option', { value: z }); }));
    document.body.appendChild(zoneList);
    return zoneList;
  }

  // ---------------------------------------------------------------- routing
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var q = {}; var qi = h.indexOf('?');
    if (qi >= 0) { h.slice(qi + 1).split('&').forEach(function (kv1) { var p = kv1.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }); h = h.slice(0, qi); }
    var parts = h.split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || 'queue', arg: parts[1] || null, q: q };
  }
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function goLogin() { renderLogin(); }
  function setNav(name) {
    document.querySelectorAll('#pd-nav a').forEach(function (a) {
      if (a.getAttribute('data-nav') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function viewRoot(title, headingId) {
    var v = $('pd-view'); v.replaceChildren();
    alertMsg(null);
    var h = el('h1', { class: 'pd-h1', id: headingId || 'pd-h1', tabindex: '-1', text: title });
    v.appendChild(h);
    return { root: v, heading: h };
  }
  function focusHeading(h) { if (h) { try { h.focus({ preventScroll: false }); } catch (e) { h.focus(); } } }

  function route() {
    var r = parseHash();
    var seq = ++S.routeSeq;
    if (!S.me) { renderLogin(); return; }
    setNav(r.name);
    if (r.name === 'case' && r.arg) return renderCase(r.arg, r.q.focus, seq, r.q.as_of || null);
    if (r.name === 'report' && r.arg) return renderReport(r.arg, seq);
    if (r.name === 'new') return renderNewCase();
    if (r.name === 'import') return renderImport();
    if (r.name === 'facilities') return renderFacilities(seq);
    if (r.name === 'search') return renderSearch(r.q.q || '', seq);
    return renderQueue(seq);
  }

  // ---------------------------------------------------------------- chrome / session
  function renderChrome() {
    var signed = !!S.me;
    $('pd-nav').hidden = !signed;
    $('pd-user').hidden = !signed;
    if (signed) {
      $('pd-user-name').textContent = S.me.user.name || S.me.user.email;
      $('pd-user-name').setAttribute('title', S.me.user.email || '');
      $('pd-user-role').textContent = S.me.user.role;
      $('pd-user-role').className = 'pd-role role-' + S.me.user.role;
      $('pd-user-org').textContent = (S.me.org && S.me.org.name) || '';
      $('pd-env').textContent = S.me.env ? 'Environment: ' + S.me.env : '';
      document.body.setAttribute('data-role', S.me.user.role);
    } else {
      $('pd-env').textContent = '';
      document.body.removeAttribute('data-role');
    }
  }
  function loadMe() {
    return api('GET', '/api/me').then(function (me) {
      S.me = me; S.csrf = me.csrf; renderChrome(); return me;
    }, function () { S.me = null; S.csrf = null; renderChrome(); return null; });
  }
  function signOut() {
    var done = function () { S.me = null; S.csrf = null; S.view = null; S.users = null; S.facilities = null; renderChrome(); location.hash = '#/queue'; renderLogin(); status('Signed out.'); };
    api('POST', '/api/logout', {}).then(done, done);
  }

  function renderLogin() {
    var v = viewRoot('Sign in to the operating desk');
    setNav(null);
    var err = el('div', { class: 'pd-form-error', role: 'alert', id: 'login-error', hidden: true });
    var email = el('input', { type: 'email', id: 'login-email', name: 'email', autocomplete: 'username', required: true });
    var pw = el('input', { type: 'password', id: 'login-password', name: 'password', autocomplete: 'current-password', required: true });
    var btn = el('button', { type: 'submit', class: 'btn', id: 'login-submit', text: 'Sign in' });
    var form = el('form', { class: 'pd-login', id: 'login-form', novalidate: true }, [
      el('p', { class: 'muted', text: 'Accounts are created by your administrator. This workspace is separate from the public demo.' }),
      field('Email', email), field('Password', pw), err, el('div', { class: 'btn-row' }, btn)
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      api('POST', '/api/login', { email: email.value.trim(), password: pw.value }).then(function (res) {
        S.csrf = res && res.csrf;
        return loadMe();
      }).then(function (me) {
        btn.disabled = false;
        if (!me) throw new ApiError(401, { error: { message: 'Signed in, but the session could not be read. Try again.' } });
        status('Signed in as ' + (me.user.name || me.user.email) + ' (' + me.user.role + ').');
        route();
      }).catch(function (e2) {
        btn.disabled = false;
        err.textContent = e2.status === 429 ? e2.message : (e2.message || 'Sign-in failed.');
        err.hidden = false; pw.value = ''; pw.focus();
      });
    });
    v.root.appendChild(el('div', { class: 'panel pd-login-panel' }, form));
    email.focus();
  }

  var fieldSeq = 0;
  function field(label, input, hint, opts) {
    var id = input.id || ('f' + (++fieldSeq));
    input.id = id;
    var errId = id + '-err';
    var hintNode = hint ? el('span', { class: 'hint', id: id + '-hint', text: hint }) : null;
    var desc = [hintNode ? id + '-hint' : null, errId].filter(Boolean).join(' ');
    input.setAttribute('aria-describedby', desc);
    return el('div', { class: 'field' + (opts && opts.wide ? ' field-wide' : '') + (opts && opts.cls ? ' ' + opts.cls : '') }, [
      el('label', { for: id, text: label + (input.required ? '' : (opts && opts.optional ? ' (optional)' : '')) }),
      input, hintNode, el('span', { class: 'field-err', id: errId, role: 'alert' })
    ]);
  }
  function setFieldError(form, name, msg) {
    var inp = form.querySelector('[name="' + name + '"]');
    if (!inp) return false;
    inp.setAttribute('aria-invalid', 'true');
    var e = document.getElementById(inp.id + '-err');
    if (e) e.textContent = msg;
    return true;
  }
  function clearFieldErrors(form) {
    form.querySelectorAll('[aria-invalid]').forEach(function (n) { n.removeAttribute('aria-invalid'); });
    form.querySelectorAll('.field-err').forEach(function (n) { n.textContent = ''; });
  }
  // Server validation errors -> inline field errors. Returns the messages that matched no field.
  function applyFieldErrors(form, e, alias) {
    var rest = [];
    var list = [];
    var f = e.fields;
    if (Array.isArray(f)) f.forEach(function (x) { if (typeof x === 'string') list.push({ field: null, message: x }); else list.push({ field: x.field || x.name, message: x.message || x.error }); });
    else if (f && typeof f === 'object') Object.keys(f).forEach(function (k) { list.push({ field: k, message: typeof f[k] === 'string' ? f[k] : text(f[k]) }); });
    if (e.field && !list.length) list.push({ field: e.field, message: e.message });
    list.forEach(function (x) {
      var name = x.field && alias && alias[x.field] ? alias[x.field] : x.field;
      if (!(name && setFieldError(form, name, x.message))) rest.push((x.field ? x.field + ': ' : '') + x.message);
    });
    var first = form.querySelector('[aria-invalid="true"]');
    if (first) first.focus();
    return rest;
  }

  // ---------------------------------------------------------------- queue
  function searchBox(initial) {
    var q = el('input', { type: 'search', name: 'q', id: 'pd-search', value: initial || '', placeholder: 'Case id, importer, supplier or reference', autocomplete: 'off' });
    var f = el('form', { class: 'pd-search', role: 'search' }, [
      el('label', { for: 'pd-search', class: 'visually-hidden', text: 'Search cases' }), q,
      el('button', { type: 'submit', class: 'btn btn-quiet', text: 'Search' })
    ]);
    f.addEventListener('submit', function (e) { e.preventDefault(); go('#/search?q=' + encodeURIComponent(q.value.trim())); });
    return f;
  }
  function canWrite() { return S.me && S.me.user.role !== 'viewer'; }
  function toolbar(initial) {
    return el('div', { class: 'pd-toolbar' }, [
      searchBox(initial),
      canWrite() ? el('div', { class: 'btn-row' }, [
        el('a', { class: 'btn', href: '#/new', id: 'pd-new-case', text: 'New case' }),
        el('a', { class: 'btn btn-quiet', href: '#/import', id: 'pd-import', text: 'Import CSV' })
      ]) : el('span', { class: 'muted small', text: 'Viewer — read only.' })
    ]);
  }
  function caseLink(id, focus) { return '#/case/' + encodeURIComponent(id) + (focus ? '?focus=' + encodeURIComponent(focus) : ''); }
  function replayLink(id, asOf) { return '#/case/' + encodeURIComponent(id) + '?as_of=' + encodeURIComponent(asOf); }
  function reportLink(id) { return '#/report/' + encodeURIComponent(id); }
  function caseRows(rows, withAction) {
    return rows.map(function (r) {
      var na = r.next_action || {};
      var actCell = withAction ? td(na.label ? el('a', {
        class: 'btn btn-small row-action' + (na.role && S.me && na.role !== S.me.user.role ? ' other-role' : ''),
        href: caseLink(r.case_id, na.command || 'next'), 'data-case': r.case_id, 'data-command': na.command || '',
        text: na.label
      }) : DASH, 'cell-action') : null;
      var cells = [
        td(el('a', { href: caseLink(r.case_id), class: 'mono case-id', text: r.case_id })),
        td([el('span', { class: 'party', text: show(r.importer) }), el('span', { class: 'sub', text: '→ ' + show(r.supplier) })]),
        td(money(r.payout), 'num-cell'), td(money(r.funding), 'num-cell'),
        td(time(r.deadline_local, r.deadline_utc), 'nowrap'),
        td(show(r.owner && typeof r.owner === 'object' ? r.owner.name : r.owner)),
        td([el('span', { text: show(r.reason) }), r.due_at ? el('span', { class: 'sub num', text: 'Due ' + utcShort(r.due_at) }) : null]),
        actCell,
        withAction ? td(roleTag(na.role)) : td(chip(humanize(r.status), 'chip-status'))
      ].filter(Boolean);
      var labels = withAction ? CASE_HEAD : CASE_HEAD.slice(0, 7).concat(['Status']);
      cells.forEach(function (c, i) { var l = labels[i]; c.setAttribute('data-label', typeof l === 'object' ? l.label : l); });
      return el('tr', { class: 'sev-' + (r.severity || 'normal'), 'data-case': r.case_id }, cells);
    });
  }
  var CASE_HEAD = ['Case', 'Importer → supplier', { label: 'Payout', cls: 'num-cell' }, { label: 'Funding', cls: 'num-cell' }, 'Deadline', 'Owner', 'Why it is here', 'Next action', 'Who acts'];
  function renderQueue(seq) {
    var v = viewRoot('Work queue');
    v.root.appendChild(el('p', { class: 'lede', text: 'What needs your attention, what is at risk, and what you can do next.' }));
    v.root.appendChild(toolbar(''));
    var holder = el('div', { id: 'pd-queue', 'aria-busy': 'true' }, el('p', { class: 'muted', text: 'Loading queue…' }));
    v.root.appendChild(holder);
    api('GET', '/api/queue').then(function (q) {
      if (seq !== S.routeSeq) return;
      holder.replaceChildren(); holder.removeAttribute('aria-busy');
      if (q.generated_at) holder.appendChild(el('p', { class: 'muted small num', text: 'As of ' + utcShort(q.generated_at) }));
      var nav = el('ul', { class: 'pd-qnav', 'aria-label': 'Queue sections' });
      holder.appendChild(nav);
      arr(q.sections).forEach(function (s) {
        var rows = arr(s.rows);
        nav.appendChild(el('li', null, el('a', { href: '#q-' + s.key, class: rows.length ? 'has-rows' : '', 'data-jump': 'q-' + s.key, onclick: jumpTo }, [s.title + ' ', el('span', { class: 'count num', text: String(rows.length) })])));
        var sec = el('section', { class: 'panel q-section q-' + s.key + (rows.length ? '' : ' is-empty'), id: 'q-' + s.key, 'aria-labelledby': 'q-' + s.key + '-h' }, [
          el('h2', { class: 'kicker', id: 'q-' + s.key + '-h', tabindex: '-1' }, [s.title + ' ', el('span', { class: 'count num', text: String(rows.length) })])
        ]);
        if (!rows.length) sec.appendChild(el('p', { class: 'muted small', text: 'Nothing here.' }));
        else sec.appendChild(tableWrap(s.title, CASE_HEAD, caseRows(rows, true), 'cases'));
        holder.appendChild(sec);
      });
      focusHeading(v.heading);
    }).catch(function (e) { if (seq === S.routeSeq) { holder.removeAttribute('aria-busy'); holder.replaceChildren(el('p', { class: 'pd-form-error', text: e.message })); } });
    focusHeading(v.heading);
  }
  function jumpTo(e) {
    var id = e.currentTarget.getAttribute('data-jump');
    var t = document.getElementById(id + '-h');
    if (t) { e.preventDefault(); t.scrollIntoView({ block: 'start' }); t.focus(); }
  }

  function renderSearch(q, seq) {
    var v = viewRoot('Search: ' + (q || 'all cases'));
    v.root.appendChild(toolbar(q));
    var holder = el('div', { id: 'pd-search-results', 'aria-busy': 'true' }, el('p', { class: 'muted', text: 'Searching…' }));
    v.root.appendChild(holder);
    api('GET', '/api/cases?q=' + encodeURIComponent(q)).then(function (res) {
      if (seq !== S.routeSeq) return;
      var rows = Array.isArray(res) ? res : arr(res && (res.cases || res.rows || res.results));
      holder.removeAttribute('aria-busy');
      holder.replaceChildren(el('p', { class: 'muted small', role: 'status', text: rows.length + (rows.length === 1 ? ' case' : ' cases') + ' found.' }));
      if (rows.length) holder.appendChild(tableWrap('Search results', CASE_HEAD.slice(0, 7).concat(['Status']), caseRows(rows.map(function (r) { return Object.assign({ case_id: r.case_id || r.id }, r); }), false), 'cases'));
      focusHeading(v.heading);
    }).catch(function (e) { holder.removeAttribute('aria-busy'); holder.replaceChildren(el('p', { class: 'pd-form-error', text: e.message })); });
    focusHeading(v.heading);
  }

  // ---------------------------------------------------------------- facilities
  function loadFacilities() {
    if (S.facilities) return Promise.resolve(S.facilities);
    return api('GET', '/api/facilities').then(function (r) {
      S.facilities = Array.isArray(r) ? r : arr(r && (r.facilities || r.rows));
      return S.facilities;
    });
  }
  function renderFacilities(seq) {
    var v = viewRoot('Facilities');
    v.root.appendChild(el('p', { class: 'lede', text: 'Capacity on each provider facility. Reserved capacity is held, not drawn.' }));
    var holder = el('div', { id: 'pd-facilities', 'aria-busy': 'true' }, el('p', { class: 'muted', text: 'Loading…' }));
    v.root.appendChild(holder);
    S.facilities = null;
    loadFacilities().then(function (list) {
      if (seq !== S.routeSeq) return;
      holder.removeAttribute('aria-busy'); holder.replaceChildren();
      if (!list.length) { holder.appendChild(el('p', { class: 'muted', text: 'No facilities in this workspace.' })); return; }
      list.forEach(function (f) {
        var idn = f.identity || f.identity_check || (arr(f.identities)[0]);
        var ok = idn && typeof idn === 'object' ? idn.ok : null;
        holder.appendChild(el('section', { class: 'panel fac', 'aria-label': 'Facility ' + show(f.name) }, [
          el('div', { class: 'fac-head' }, [
            el('h2', { class: 'fac-name', text: show(f.name) }),
            chip(humanize(f.status), 'chip-fac-' + (f.status || 'unknown')),
            el('span', { class: 'muted small', text: 'Suspension policy: ' + humanize(f.suspension_policy) })
          ]),
          kv([
            ['Limit', money(f.limit)],
            ['Reserved (held, not drawn)', money(f.reserved), 'row-reserved'],
            ['Principal outstanding (drawn)', money(f.principal_outstanding), 'row-outstanding'],
            ['Available', money(f.available)],
            ['Funding cash', money(f.funding_cash)],
            f.currency ? ['Currency', f.currency] : null,
            f.policy_version ? ['Policy version', show(f.policy_version)] : null
          ], 'kv-cols'),
          idn ? el('p', { class: 'identity ' + (ok === false ? 'id-fail' : ok ? 'id-ok' : ''), text: (ok === false ? 'Identity broken: ' : ok ? 'Identity holds: ' : 'Identity: ') + text(idn.detail || idn.name || idn) }) : null
        ]));
      });
    }).catch(function (e) { holder.removeAttribute('aria-busy'); holder.replaceChildren(el('p', { class: 'pd-form-error', text: e.message })); });
    focusHeading(v.heading);
  }

  // ---------------------------------------------------------------- new case (§11)
  function inp(name, attrs) { return el('input', Object.assign({ type: 'text', name: name, id: 'nc-' + name }, attrs || {})); }
  function currencySelect(name, def, id) {
    return el('select', { name: name, id: id || ('nc-' + name) }, CURRENCIES.map(function (c) { return el('option', { value: c, selected: c === def ? true : null, text: c }); }));
  }
  function zoneInput(name, def, id) {
    zoneDatalist();
    return el('input', { type: 'text', name: name, id: id || ('nc-' + name), list: 'pd-zones', value: def || '', autocomplete: 'off', spellcheck: 'false', required: true });
  }
  function moneyGroup(prefix, label, defCur, required) {
    var a = inp(prefix + '_amount', { inputmode: 'decimal', autocomplete: 'off', required: required ? true : null, placeholder: '0.00' });
    return el('div', { class: 'field-pair' }, [
      field(label + ' amount', a, 'As written, e.g. 61,400.00', { optional: !required }),
      field(label + ' currency', currencySelect(prefix + '_currency', defCur))
    ]);
  }
  function fieldset(legend, children, cls) { return el('fieldset', { class: 'fs ' + (cls || '') }, [el('legend', { text: legend })].concat(children)); }

  function renderNewCase() {
    var v = viewRoot('New case');
    if (!canWrite()) { v.root.appendChild(el('p', { class: 'muted', text: 'Viewers cannot create cases.' })); focusHeading(v.heading); return; }
    var defTz = 'Asia/Singapore';
    var dt = function (name, req) { return inp(name, { type: 'datetime-local', required: req ? true : null }); };
    var tzIn = zoneInput('deadline_tz', defTz);
    var later = el('input', { type: 'checkbox', name: 'later_permitted', id: 'nc-later_permitted' });
    var facSel = el('select', { name: 'facility_id', id: 'nc-facility_id' }, el('option', { value: '', text: 'No facility' }));
    var ownerSel = el('select', { name: 'owner_user_id', id: 'nc-owner_user_id' }, el('option', { value: '', text: 'Me (' + show(S.me.user.name) + ')' }));
    var balFresh = el('input', { type: 'checkbox', name: 'obs_balance', id: 'nc-obs_balance', checked: true });
    var formErr = el('div', { class: 'pd-form-error', role: 'alert', hidden: true, id: 'nc-error' });
    var utcPreview = el('p', { class: 'hint num', id: 'nc-utc-preview', 'aria-live': 'polite' });
    var submit = el('button', { type: 'submit', class: 'btn', id: 'nc-submit', text: 'Create case' });
    var form = el('form', { class: 'pd-form', id: 'new-case-form', novalidate: true }, [
      fieldset('Parties', [field('Importer', inp('importer', { required: true, autocomplete: 'organization' })), field('Supplier', inp('supplier', { required: true }))], 'fs-2'),
      fieldset('Invoice, quote and owner', [
        field('Supplier invoice number', inp('invoice_ref', { required: true, autocomplete: 'off' }), 'As printed on the supplier\u2019s invoice. Used for the duplicate check in this provider\u2019s book.'),
        field('Importer\u2019s own reference', inp('customer_ref', { autocomplete: 'off' }), 'e.g. the importer\u2019s PO number', { optional: true }),
        field('Quote issued by', inp('quote_source', { placeholder: 'e.g. Provider FX desk' }), null, { optional: true }),
        field('Quoted at (local, deadline time zone)', dt('quote_at_local'), null, { optional: true }),
        field('Owner', ownerSel, 'Operator or reviewer who works this case')
      ], 'fs-2'),
      fieldset('Amounts — FX is not converted by Clearline', [
        moneyGroup('payout', 'Payout (supplier receives)', 'EUR', true),
        moneyGroup('funding', 'Funding (to be funded)', 'SGD', true),
        field('Quote reference', inp('quote_ref', { required: true }), 'The FX quote behind the funding amount')
      ], 'fs-2'),
      fieldset('Times — entered in the deadline time zone', [
        field('Time zone (IANA)', tzIn, 'e.g. Asia/Singapore'),
        field('Payout deadline (local)', dt('deadline_local', true)),
        field('Original funding window opens (local)', dt('window_a_local', true)),
        field('Original window cutoff (local)', dt('window_a_cutoff_local', true)),
        utcPreview
      ], 'fs-2'),
      fieldset('Later funding', [
        el('div', { class: 'field field-check' }, [later, el('label', { for: 'nc-later_permitted', text: 'Contract permits later funding' })]),
        field('Contract reference', inp('contract_ref'), null, { optional: true }),
        field('Later window (local)', dt('window_b_local')), field('Later window cutoff (local)', dt('window_b_cutoff_local'))
      ], 'fs-2'),
      fieldset('Observations — operator-entered unless evidence is attached later', [
        moneyGroup('invoice', 'Supplier invoice', 'EUR', false),
        field('Invoice issued (local)', dt('invoice_issued_local')),
        field('Invoice issued by', inp('invoice_issuer', { placeholder: 'Defaults to the supplier' }), null, { optional: true }),
        el('div', { class: 'field field-check field-wide' }, [balFresh, el('label', { for: 'nc-obs_balance', text: 'Record importer balance' })]),
        moneyGroup('balance', 'Balance', 'SGD', false),
        field('Balance as of (local)', dt('balance_as_of_local')),
        field('Balance source', inp('balance_source', { placeholder: 'e.g. Bank portal screenshot' }), null, { optional: true }),
        field('Balance issued by (bank)', inp('balance_issuer'), null, { optional: true }),
        field('Bank\u2019s record reference', inp('balance_record_ref'), null, { optional: true }),
        moneyGroup('commitment', 'Competing commitment', 'SGD', false),
        field('Commitment due (local)', dt('commitment_due_local')),
        field('Commitment description', inp('commitment_description'), null, { optional: true }),
        moneyGroup('cash_support', 'Cash support', 'SGD', false),
        field('Cash support effective (local)', dt('cash_support_local')),
        field('Cash support document ref', inp('cash_support_ref'), null, { optional: true }),
        moneyGroup('expected', 'Expected customer receipt', 'SGD', false),
        field('Expected at (local)', dt('expected_local')),
        field('Payer', inp('expected_payer'), null, { optional: true })
      ], 'fs-2'),
      fieldset('Facility and reference', [field('Facility', facSel), field('Reference', inp('reference'), null, { optional: true })], 'fs-2'),
      formErr,
      el('div', { class: 'btn-row' }, [submit, el('a', { class: 'btn btn-quiet', href: '#/queue', text: 'Cancel' })])
    ]);
    v.root.appendChild(el('p', { class: 'lede', text: 'Record a new invoice. The server validates every field; amounts are sent exactly as typed.' }));
    v.root.appendChild(form);
    loadFacilities().then(function (list) {
      list.forEach(function (f, i) { facSel.appendChild(el('option', { value: f.id, selected: i === 0 ? true : null, text: show(f.name) + (f.currency ? ' (' + f.currency + ')' : '') })); });
    }).catch(function () { /* facility list optional */ });
    loadUsers().then(function (us) {
      us.filter(function (u) { return (u.role === 'operator' || u.role === 'reviewer') && String(u.id) !== String(S.me.user.id); }).forEach(function (u) {
        ownerSel.appendChild(el('option', { value: u.id, text: show(u.name) + ' (' + u.role + ')' }));
      });
    });

    function preview() {
      var tz = tzIn.value.trim();
      var d = form.elements.deadline_local.value;
      if (!validZone(tz)) { utcPreview.textContent = tz ? 'Unknown time zone.' : ''; return; }
      if (!d) { utcPreview.textContent = ''; return; }
      var u = zonedToUtc(d, tz);
      utcPreview.textContent = 'Deadline ' + d.replace('T', ' ') + ' ' + zoneAbbr(tz, u) + ' = ' + u + ' (UTC)';
    }
    form.addEventListener('input', preview);
    var key = null; var lastBody = null;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submit.disabled) return;
      clearFieldErrors(form); formErr.hidden = true;
      var F = form.elements; var tz = tzIn.value.trim();
      var local = {};
      var bad = false;
      if (!validZone(tz)) { setFieldError(form, 'deadline_tz', 'Enter an IANA time zone such as Asia/Singapore.'); bad = true; }
      var utc = function (name) { var val = F[name].value; if (!val) return null; local[name] = val; return validZone(tz) ? zonedToUtc(val, tz) : null; };
      var body = {
        importer: F.importer.value.trim(), supplier: F.supplier.value.trim(),
        payout_amount: F.payout_amount.value.trim(), payout_currency: F.payout_currency.value,
        funding_amount: F.funding_amount.value.trim(), funding_currency: F.funding_currency.value,
        quote_ref: F.quote_ref.value.trim(), deadline_at: utc('deadline_local'), deadline_tz: tz,
        invoice_ref: F.invoice_ref.value.trim(), customer_ref: F.customer_ref.value.trim() || null,
        quote_source: F.quote_source.value.trim() || null, quote_at: utc('quote_at_local'),
        window_a_at: utc('window_a_local'), window_a_cutoff_at: utc('window_a_cutoff_local'),
        later_permitted: !!F.later_permitted.checked, contract_ref: F.contract_ref.value.trim() || null,
        window_b_at: utc('window_b_local'), window_b_cutoff_at: utc('window_b_cutoff_local'),
        facility_id: F.facility_id.value || null, reference: F.reference.value.trim() || null, observations: []
      };
      if (F.owner_user_id.value) body.owner_user_id = /^\d+$/.test(F.owner_user_id.value) ? Number(F.owner_user_id.value) : F.owner_user_id.value;
      var obsAlias = [];
      var OBS_INPUTS = {
        invoice: { amount: 'invoice_amount', currency: 'invoice_currency', issued_at: 'invoice_issued_local', issuer: 'invoice_issuer', invoice_ref: 'invoice_ref' },
        balance: { amount: 'balance_amount', currency: 'balance_currency', as_of: 'balance_as_of_local', source: 'balance_source', issuer: 'balance_issuer', record_ref: 'balance_record_ref' },
        commitment: { amount: 'commitment_amount', currency: 'commitment_currency', due_at: 'commitment_due_local', description: 'commitment_description' },
        cash_support: { amount: 'cash_support_amount', currency: 'cash_support_currency', effective_at: 'cash_support_local', document_ref: 'cash_support_ref' },
        expected_receipt: { amount: 'expected_amount', currency: 'expected_currency', expected_at: 'expected_local', payer: 'expected_payer' }
      };
      if (F.invoice_amount.value.trim()) body.observations.push({ kind: 'invoice', amount: F.invoice_amount.value.trim(), currency: F.invoice_currency.value, invoice_ref: body.invoice_ref, issuer: F.invoice_issuer.value.trim() || body.supplier, issued_at: utc('invoice_issued_local') });
      if (F.obs_balance.checked && F.balance_amount.value.trim()) body.observations.push({ kind: 'balance', amount: F.balance_amount.value.trim(), currency: F.balance_currency.value, as_of: utc('balance_as_of_local'), source: F.balance_source.value.trim() || null, issuer: F.balance_issuer.value.trim() || null, record_ref: F.balance_record_ref.value.trim() || null });
      if (F.commitment_amount.value.trim()) body.observations.push({ kind: 'commitment', amount: F.commitment_amount.value.trim(), currency: F.commitment_currency.value, due_at: utc('commitment_due_local'), description: F.commitment_description.value.trim() || null });
      if (F.cash_support_amount.value.trim()) body.observations.push({ kind: 'cash_support', amount: F.cash_support_amount.value.trim(), currency: F.cash_support_currency.value, effective_at: utc('cash_support_local'), document_ref: F.cash_support_ref.value.trim() || null });
      if (F.expected_amount.value.trim()) body.observations.push({ kind: 'expected_receipt', amount: F.expected_amount.value.trim(), currency: F.expected_currency.value, expected_at: utc('expected_local'), payer: F.expected_payer.value.trim() || null });
      body.observations.forEach(function (o) { obsAlias.push(OBS_INPUTS[o.kind]); });
      if (bad) { form.querySelector('[aria-invalid="true"]').focus(); return; }
      var sig = JSON.stringify(body);
      if (!key || sig !== lastBody) key = uuid();   // same body on retry reuses the key
      lastBody = sig;
      body.idempotency_key = key;
      submit.disabled = true; status('Creating case…');
      api('POST', '/api/cases', body).then(function (cv) {
        submit.disabled = false; key = null;
        var id = cv && (cv.id || (cv.case_view && cv.case_view.id) || cv.case_id);
        status('Case ' + id + ' created.');
        go(caseLink(id));
      }).catch(function (err) {
        submit.disabled = false; status('');
        var alias = { quote_at: 'quote_at_local', deadline_at: 'deadline_local', window_a_at: 'window_a_local', window_a_cutoff_at: 'window_a_cutoff_local', window_b_at: 'window_b_local', window_b_cutoff_at: 'window_b_cutoff_local' };
        obsAlias.forEach(function (m, i) {
          Object.keys(m).forEach(function (k) { alias['observations[' + i + '].' + k] = m[k]; alias['observations[' + i + ']' + k] = m[k]; alias['observations.' + i + '.' + k] = m[k]; });
          alias['observations[' + i + ']'] = m.amount;
        });
        var rest = applyFieldErrors(form, err, alias);
        if (rest.length || !form.querySelector('[aria-invalid="true"]')) {
          formErr.replaceChildren(el('p', { text: err.message }), rest.length ? el('ul', null, rest.map(function (m) { return el('li', { text: m }); })) : null);
          formErr.hidden = false;
          if (!form.querySelector('[aria-invalid="true"]')) formErr.focus();
        }
      });
    });
    focusHeading(v.heading);
  }

  // ---------------------------------------------------------------- import CSV
  function renderImport() {
    var v = viewRoot('Import cases from CSV');
    if (!canWrite()) { v.root.appendChild(el('p', { class: 'muted', text: 'Viewers cannot import cases.' })); focusHeading(v.heading); return; }
    var file = el('input', { type: 'file', id: 'imp-file', name: 'file', accept: '.csv,text/csv' });
    var area = el('textarea', { id: 'imp-csv', name: 'csv', rows: '8', spellcheck: 'false', class: 'mono' });
    var out = el('div', { id: 'imp-result', 'aria-live': 'polite' });
    var dry = el('button', { type: 'button', class: 'btn', id: 'imp-dry', text: 'Check (dry run)' });
    var go2 = el('button', { type: 'button', class: 'btn', id: 'imp-go', disabled: true, text: 'Import all rows' });
    var checked = null;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return;
      f.text().then(function (t) { area.value = t; checked = null; go2.disabled = true; out.replaceChildren(); });
    });
    area.addEventListener('input', function () { checked = null; go2.disabled = true; });
    function send(dryRun) {
      var csv = area.value;
      if (!csv.trim()) { out.replaceChildren(el('p', { class: 'pd-form-error', text: 'Choose a CSV file or paste its contents.' })); return; }
      dry.disabled = true; go2.disabled = true;
      api('POST', '/api/cases/import', { csv: csv, dry_run: dryRun, idempotency_key: uuid() }).then(function (res) {
        dry.disabled = false;
        var errs = arr(res && res.errors);
        if (errs.length) { showErrors(errs); return; }
        if (dryRun) {
          checked = csv;
          var n = typeof (res && res.would_create) === 'number' ? res.would_create : (pick(res, 'count', 'row_count') || arr(res && (res.rows || res.would_create)).length);
          out.replaceChildren(el('div', { class: 'ok-box', id: 'imp-ok' }, [
            el('p', { text: 'Dry run passed: ' + n + (n === 1 ? ' row' : ' rows') + ' ready to import. Nothing has been created yet.' })
          ]));
          go2.disabled = false; go2.textContent = 'Import ' + n + (n === 1 ? ' case' : ' cases'); go2.focus();
        } else {
          var ids = arr(res && res.created);
          out.replaceChildren(el('div', { class: 'ok-box', id: 'imp-done' }, [
            el('p', { text: 'Imported ' + ids.length + (ids.length === 1 ? ' case.' : ' cases.') }),
            el('ul', { class: 'inline-list' }, ids.map(function (id) { return el('li', null, el('a', { class: 'mono', href: caseLink(typeof id === 'object' ? id.id : id), text: typeof id === 'object' ? id.id : id })); }))
          ]));
          checked = null;
        }
      }).catch(function (e) {
        dry.disabled = false;
        var errs = arr(e.body && (e.body.errors || (e.body.error && e.body.error.errors)));
        if (errs.length) showErrors(errs); else out.replaceChildren(el('p', { class: 'pd-form-error', role: 'alert', text: e.message }));
      });
    }
    function showErrors(errs) {
      checked = null; go2.disabled = true;
      out.replaceChildren(el('div', { class: 'pd-form-error', id: 'imp-errors', role: 'alert', tabindex: '-1' }, [
        el('p', { text: errs.length + (errs.length === 1 ? ' problem' : ' problems') + ' found. Nothing was imported — fix every row and check again.' }),
        el('ul', null, errs.map(function (m) { return el('li', { text: text(m) }); }))
      ]));
      out.firstChild.focus();
    }
    dry.addEventListener('click', function () { send(true); });
    go2.addEventListener('click', function () { if (checked !== null && checked === area.value) send(false); });
    v.root.appendChild(el('p', { class: 'lede', text: 'All or nothing: a dry run checks every row first; if any row fails, nothing is created.' }));
    v.root.appendChild(el('div', { class: 'panel pd-form' }, [
      field('CSV file', file, 'Columns as in the pilot contract (§10); local times are in the row time zone.'),
      field('CSV contents', area, null, { wide: true }),
      el('div', { class: 'btn-row' }, [dry, go2]), out
    ]));
    focusHeading(v.heading);
  }

  // ---------------------------------------------------------------- case workspace
  function loadCase(id, asOf) {
    var q = asOf ? '?as_of=' + encodeURIComponent(asOf) : '';
    return api('GET', '/api/cases/' + encodeURIComponent(id) + q).then(function (cv) { S.view = cv; S.caseId = id; S.asOf = asOf || null; return cv; });
  }
  function renderCase(id, focus, seq, asOf) {
    var v = viewRoot('Case ' + id, 'case-h1');
    v.root.appendChild(el('p', { class: 'muted', text: asOf ? 'Loading replay…' : 'Loading case…' }));
    if (asOf && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/.test(asOf)) {
      var bad = viewRoot('Replay time not understood', 'case-h1');
      bad.root.appendChild(el('div', { class: 'panel', id: 'case-error' }, [el('p', { text: 'The replay time must be a UTC instant such as 2026-11-16T01:00:00Z.' }), el('p', null, el('a', { href: caseLink(id), text: 'Open the current case' }))]));
      focusHeading(bad.heading); return;
    }
    loadCase(id, asOf).then(function (cv) {
      if (seq !== undefined && seq !== S.routeSeq) return;
      paintCase(cv, focus);
    }).catch(function (e) {
      if (seq !== undefined && seq !== S.routeSeq) return;
      var vv = viewRoot(e.status === 404 ? 'Case not found' : 'Case could not be loaded', 'case-h1');
      vv.root.appendChild(el('div', { class: 'panel', id: 'case-error' }, [
        el('p', { text: e.status === 404 ? 'Not found. There is no case ' + id + ' in your workspace.' : e.message }),
        el('p', null, el('a', { href: '#/queue', text: 'Back to the queue' }))
      ]));
      focusHeading(vv.heading);
    });
  }
  function reloadCase(msg, focus) {
    return loadCase(S.caseId, S.asOf).then(function (cv) { paintCase(cv, focus || null, true); if (msg) status(msg); });
  }

  function paintCase(cv, focus, keepScroll) {
    var y = window.scrollY;
    var h = cv.header || {};
    var v = viewRoot(show(h.importer) + ' → ' + show(h.supplier), 'case-h1');
    v.heading.classList.add('case-title');
    v.root.setAttribute('data-version', String(cv.version));
    v.root.prepend(el('p', { class: 'crumbs' }, [el('a', { href: '#/queue', text: 'Queue' }), ' / ', el('span', { class: 'mono', id: 'case-id', text: cv.id }), ' ', chip(humanize(cv.status), 'chip-status chip-st-' + cv.status), el('span', { class: 'muted small num', id: 'case-version', text: ' v' + cv.version })]));
    var replay = isReplay(cv);
    v.root.setAttribute('data-replay', replay ? 'true' : 'false');
    if (replay) v.root.insertBefore(replayBanner(cv), v.heading);
    v.root.appendChild(caseHeader(cv));
    var dup = duplicateBanner(cv);
    if (dup) v.root.appendChild(dup);
    var grid = el('div', { class: 'case-grid' }, [
      el('div', { class: 'col-main' }, [decisionBox(cv), splitPanels(cv), routesPanel(cv), decisionRecordPanel(cv), collectionsPanel(cv)]),
      el('div', { class: 'col-side' }, [actionsPanel(cv), replayControl(cv), handoffPanel(cv), identitiesPanel(cv), reportPanel(cv), exportPanel(cv)])
    ]);
    v.root.appendChild(grid);
    v.root.appendChild(evidencePanel(cv));
    v.root.appendChild(timelinePanel(cv));
    if (keepScroll) window.scrollTo(0, y);
    if (focus) focusAction(focus); else if (!keepScroll) focusHeading(v.heading);
  }

  function caseHeader(cv) {
    var h = cv.header || {};
    var owner = h.owner && typeof h.owner === 'object' ? h.owner.name : h.owner;
    return el('section', { class: 'case-strip', 'aria-label': 'Payment' }, [
      el('div', { class: 'strip-item strip-parties' }, [el('span', { class: 'strip-label', text: 'Importer → supplier' }), el('span', { class: 'strip-main', text: show(h.importer) }), el('span', { class: 'strip-sub', text: '→ ' + show(h.supplier) })]),
      el('div', { class: 'strip-item' }, [el('span', { class: 'strip-label', text: 'Payout (supplier receives)' }), money(h.payout, 'strip-main strip-amount'),
        el('span', { class: 'strip-sub', id: 'case-invoice', text: 'Invoice ' + show(h.invoice_ref) }),
        el('span', { class: 'strip-sub', id: 'case-customer-ref', text: (!blank(h.customer_ref) ? 'Importer ref ' + h.customer_ref + ' · ' : '') + 'Reference ' + show(h.reference) })]),
      el('div', { class: 'strip-item' }, [el('span', { class: 'strip-label', text: 'Funding (to be funded)' }), money(h.funding, 'strip-main strip-amount'),
        el('span', { class: 'strip-sub', id: 'case-quote', text: 'Quote ' + show(h.quote_ref) + (blank(h.quote_source) ? '' : ' · ' + h.quote_source) }),
        blank(h.quote_at) ? null : el('span', { class: 'strip-sub' }, ['Quoted ', time(h.quote_at_local || h.quote_at, h.quote_at && h.quote_at.utc)])]),
      el('div', { class: 'strip-item strip-clock' }, [el('span', { class: 'strip-label', text: 'Payout deadline' }), time(h.deadline_local, h.deadline_utc), el('span', { class: 'strip-sub', text: show(h.deadline_tz) + (h.deadline_utc ? ' · UTC ' + h.deadline_utc : '') })]),
      el('div', { class: 'strip-item' }, [el('span', { class: 'strip-label', text: 'Owner' }), el('span', { class: 'strip-main strip-owner', id: 'case-owner', text: show(owner) })])
    ]);
  }

  function decisionBox(cv) {
    var d = cv.decision || {};
    var na = d.next_action;
    return el('section', { class: 'decision tone-' + (d.tone || 'neutral'), id: 'decision', 'aria-labelledby': 'decision-h' }, [
      el('h2', { class: 'kicker', id: 'decision-h', tabindex: '-1' }, ['Decision now ', d.tone ? el('span', { class: 'tone-chip tonechip-' + d.tone, text: humanize(d.tone) }) : null]),
      el('p', { class: 'headline', id: 'decision-headline', text: show(d.headline) }),
      kv([
        ['Binding constraint', el('span', { id: 'decision-constraint', text: text(d.binding_constraint) })],
        ['Next action', el('span', { id: 'decision-next', text: na && typeof na === 'object' ? text(na.label || na) : show(na) })],
        ['Who acts', roleTag(d.owner_role || (na && na.role)) || DASH]
      ], 'kv-decision'),
      blocksNow(cv)
    ]);
  }
  // What blocks the next action: the server's current blockers (decision record "waiting for"), else the
  // blockers of the routes that are not feasible. Grouped by kind so missing evidence never looks like no money.
  function currentBlockers(cv) {
    var dr = cv.decision_record;
    if (dr && Array.isArray(dr.waiting_for)) return dr.waiting_for;
    var out = [];
    arr(cv.routes).forEach(function (r) { if (r.status !== 'feasible') arr(r.blockers).forEach(function (b) { out.push(Object.assign({ route: pick(r, 'key', 'route', 'id') }, typeof b === 'object' ? b : { text: b })); }); });
    return out;
  }
  function blocksNow(cv) {
    var bl = currentBlockers(cv);
    var body = bl.length ? blockerGroups(bl, 'now') : el('p', { class: 'small muted', text: 'Nothing recorded as blocking.' });
    return el('div', { class: 'blocks-now', id: 'blocks-now' }, [el('p', { class: 'mini-h', text: 'What blocks the next action' }), body]);
  }

  var SUPPLIER_TONE = { credited: 'ok', accepted: 'held', instructed: 'held', unknown: 'unknown', failed: 'fail', returned: 'fail', none: 'idle', not_instructed: 'idle' };
  var SUPPLIER_NOTE = {
    instructed: 'Instruction sent. Not accepted and not credited yet.',
    accepted: 'Accepted by the payout provider. Not credited to the supplier yet.',
    credited: 'Credited to the supplier\u2019s account.',
    unknown: 'Delivery status is unknown. Do not re-instruct; query or record the status.',
    failed: 'Payout failed. The supplier has not been paid.',
    returned: 'Payout returned. The supplier has not been paid.'
  };
  function splitPanels(cv) {
    var sp = cv.supplier_panel || {};
    var ex = cv.exposure_panel || {};
    var sst = sp.status || 'none';
    var est = ex.status || 'none';
    var sandbox = sp.sandbox || sp.provenance === 'sandbox_simulation';
    var supplier = el('section', { class: 'half half-supplier sup-' + (SUPPLIER_TONE[sst] || 'idle'), id: 'supplier-panel', 'data-status': sst, 'aria-labelledby': 'supplier-h' }, [
      el('h2', { class: 'half-h', id: 'supplier-h' }, ['Supplier delivery']),
      el('p', { class: 'half-state' }, [el('span', { class: 'state-word', id: 'supplier-status', text: humanize(sst) }), ' ', provBadge(sp.provenance)]),
      el('p', { class: 'half-label', id: 'supplier-label', text: show(sp.label || SUPPLIER_NOTE[sst]) }),
      sandbox ? el('p', { class: 'sandbox-note', text: sp.sandbox_label || 'Sandbox — not a live payment' }) : null,
      kv([
        ['Last evidenced', time(sp.last_evidenced)],
        ['Last evidenced location', el('span', { id: 'supplier-location', text: show(sp.location) })],
        ['Attempt', el('span', { class: 'num', text: show(sp.attempt) })],
        sp.route ? ['Route', el('span', { text: sp.route === 'sandbox' ? 'Sandbox connector' : 'Manual (external bank)' })] : null,
        sp.external_ref ? ['External ref', el('span', { class: 'mono', text: sp.external_ref })] : null,
        sp.provider_ref ? ['Provider ref', el('span', { class: 'mono', text: sp.provider_ref })] : null
      ])
    ]);
    var EXP_NOTE = { none: 'No provider money committed.', reserved: 'Capacity reserved — held, not drawn. Nothing is owed yet.', outstanding: 'Drawn. Owed to the provider until repaid.', ended: 'Exposure ended — nothing owed.' };
    var exposure = el('section', { class: 'half half-exposure exp-' + est, id: 'exposure-panel', 'data-status': est, 'aria-labelledby': 'exposure-h' }, [
      el('h2', { class: 'half-h', id: 'exposure-h' }, ['Provider exposure']),
      el('p', { class: 'half-state' }, [el('span', { class: 'state-word', id: 'exposure-status', text: humanize(est) })]),
      el('p', { class: 'half-label', text: EXP_NOTE[est] || '' }),
      kv([
        ['Reserved (held, not drawn)', money(ex.reserved, 'm-reserved'), 'row-reserved'],
        ['Drawn principal outstanding', money(ex.principal_outstanding, 'm-principal'), 'row-principal'],
        ['Fees outstanding', money(ex.fees_outstanding, 'm-fees'), 'row-fees'],
        ['Total outstanding', money(ex.total_outstanding, 'm-total'), 'row-total'],
        ex.drawn !== undefined ? ['Drawn (principal at draw)', money(ex.drawn, 'm-drawn'), 'row-drawn'] : null,
        ex.principal_repaid !== undefined ? ['Principal repaid', money(ex.principal_repaid, 'm-prepaid')] : null,
        ex.fees_repaid !== undefined ? ['Fees repaid', money(ex.fees_repaid, 'm-frepaid')] : null,
        ['Due', time(ex.due_at_local)],
        ['Owed by → owed to', el('span', { id: 'exposure-parties', text: (blank(ex.owed_by) && blank(ex.owed_to)) ? DASH : show(ex.owed_by) + ' → ' + show(ex.owed_to) })]
      ], 'kv-money'),
      ex.allocation_rule ? el('p', { class: 'hint', text: 'Allocation: ' + ex.allocation_rule }) : null,
      (ex.status_label || ex.overdue) ? el('p', { class: (ex.overdue || /overdue/i.test(ex.status_label || '')) ? 'overdue' : 'exp-label', id: 'exposure-label', text: ex.status_label || 'Overdue \u2014 not a default determination' }) : null,
      ex.default_judgment ? el('p', { class: 'small', id: 'exposure-default', text: text(ex.default_judgment) }) : null
    ]);
    return el('section', { class: 'panel', 'aria-label': 'Delivery and exposure — two separate facts' }, [
      el('h2', { class: 'kicker', text: 'Two separate facts — supplier delivery and provider exposure' }),
      el('div', { class: 'split' }, [supplier, exposure])
    ]);
  }

  function routesPanel(cv) {
    var routes = arr(cv.routes);
    return section('Routes — who puts up the money', 'routes', [
      el('div', { class: 'routes' }, routes.map(function (r) {
        var key = pick(r, 'key', 'route', 'id') || '';
        var st = r.status || 'unknown';
        var yesno = function (b) { return b === true ? el('span', { class: 'yes', text: 'Yes' }) : b === false ? el('span', { class: 'no', text: 'No' }) : el('span', { class: 'muted', text: DASH }); };
        var missing = arr(r.missing); var dq = arr(r.disqualifiers);
        return el('article', { class: 'route route-' + st + (r.selected ? ' route-selected' : ''), id: 'route-' + key, 'aria-labelledby': 'route-' + key + '-h' }, [
          el('div', { class: 'route-head' }, [
            el('span', { class: 'route-key', text: key }),
            el('h3', { id: 'route-' + key + '-h', text: show(pick(r, 'title', 'name', 'label')) }),
            chip(humanize(st), 'chip-route chip-' + st)
          ]),
          kv([
            ['Whose money', el('span', { text: text(r.whose_money) })],
            ['Needed by', time(r.needed_at)],
            ['Amount', money(r.amount)],
            ['Cost', el('span', { text: text(r.cost) })],
            ['Risk bearer', el('span', { text: text(r.risk_bearer) })],
            key === 'C' || r.capacity_ok !== undefined ? ['Capacity ok', yesno(r.capacity_ok)] : null,
            key === 'C' || r.cash_ok !== undefined ? ['Funding cash ok', yesno(r.cash_ok)] : null
          ], 'kv-route'),
          Array.isArray(r.blockers) ? (r.blockers.length ? blockerGroups(r.blockers, 'route-' + key) : el('p', { class: 'muted small', text: 'No blockers.' })) : null,
          !Array.isArray(r.blockers) && missing.length ? el('div', { class: 'route-list' }, [el('p', { class: 'mini-h', text: 'Missing evidence' }), el('ul', { class: 'q-list missing' }, missing.map(function (m) { return el('li', { text: text(m) }); }))]) : null,
          !Array.isArray(r.blockers) && dq.length ? el('div', { class: 'route-list' }, [el('p', { class: 'mini-h', text: 'Disqualifiers' }), el('ul', { class: 'x-list' }, dq.map(function (m) { return el('li', { text: text(m) }); }))]) : null,
          !Array.isArray(r.blockers) && !missing.length && !dq.length ? el('p', { class: 'muted small', text: 'No missing evidence or disqualifiers.' }) : null,
          arr(r.evidence_ids).length ? el('p', { class: 'small' }, ['Evidence ', arr(r.evidence_ids).map(function (eid) { return el('a', { class: 'record-id', href: '#ev-' + eid, onclick: jumpEvidence, 'data-ev': eid, text: String(eid) }); })]) : null
        ]);
      }))
    ]);
  }
  // Blocker groups (§13.4). Evidence can be added; cash/credit is a hard constraint; time/contract/facility is a rule.
  var BLOCKER_GROUPS = [
    { key: 'evidence', kinds: ['evidence'], title: 'Missing evidence — can be added', icon: '?', cls: 'blk-evidence' },
    { key: 'money', kinds: ['cash', 'credit'], title: 'No money — hard constraint', icon: '\u2715', cls: 'blk-money' },
    { key: 'rule', kinds: ['time', 'contract', 'facility'], title: 'Time, contract or facility rule', icon: '!', cls: 'blk-rule' }
  ];
  var BLOCKER_KIND = { evidence: 'Evidence', cash: 'Cash', credit: 'Credit', time: 'Time', contract: 'Contract', facility: 'Facility' };
  function blockerGroups(list, idp) {
    var norm = list.map(function (b) { return typeof b === 'object' && b ? b : { text: b, kind: 'evidence' }; });
    var known = {}; BLOCKER_GROUPS.forEach(function (g) { g.kinds.forEach(function (k) { known[k] = 1; }); });
    var groups = BLOCKER_GROUPS.concat([{ key: 'other', kinds: null, title: 'Other blockers', icon: '!', cls: 'blk-rule' }]);
    return el('div', { class: 'blk-groups' }, groups.map(function (g) {
      var items = norm.filter(function (b) { return g.kinds ? g.kinds.indexOf(b.kind) >= 0 : !known[b.kind]; });
      if (!items.length) return null;
      var hid = idp + '-blk-' + g.key;
      return el('div', { class: 'blk ' + g.cls, 'data-group': g.key, role: 'group', 'aria-labelledby': hid }, [
        el('p', { class: 'blk-h', id: hid }, [el('span', { class: 'blk-icon', 'aria-hidden': 'true', text: g.icon }), g.title + ' (' + items.length + ')']),
        el('ul', { class: 'blk-list' }, items.map(function (b) {
          return el('li', { 'data-kind': b.kind || '', 'data-code': b.code || '' }, [
            el('span', { class: 'blk-kind', text: BLOCKER_KIND[b.kind] || humanize(b.kind || 'blocker') }), ' ',
            b.route ? el('span', { class: 'route-key small', text: b.route }) : null, b.route ? ' ' : null,
            el('span', { class: 'blk-text', text: text(b.text || b.message || b) }),
            arr(b.evidence_ids).length ? el('span', { class: 'small' }, [' ', arr(b.evidence_ids).map(function (eid) { return el('a', { class: 'record-id', href: '#ev-' + eid, onclick: jumpEvidence, 'data-ev': eid, text: String(eid) }); })]) : null
          ]);
        }))
      ]);
    }));
  }

  // ---------------------------------------------------------------- replay (§13.6) — time only, never money
  function isReplay(cv) { return !!(S.asOf || (cv && cv.replay)); }
  function replayAt(cv) { return (cv && cv.replay && (cv.replay.as_of && cv.replay.as_of.utc ? cv.replay.as_of.utc : cv.replay.as_of)) || S.asOf; }
  function formatLocal(utcIso, tz) {
    if (blank(utcIso)) return DASH;
    try {
      var d = new Date(utcIso);
      var p = {};
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
      return p.weekday + ' ' + p.day + ' ' + p.month + ' ' + p.year + ', ' + p.hour + ':' + p.minute + ' ' + zoneAbbr(tz, utcIso);
    } catch (e) { return String(utcIso); }
  }
  function caseTz(cv) { return (cv && cv.header && cv.header.deadline_tz) || 'UTC'; }
  function replayBanner(cv) {
    var at = replayAt(cv);
    var note = cv.replay && cv.replay.note;
    return el('section', { class: 'replay-banner', id: 'replay-banner', role: 'note', 'aria-labelledby': 'replay-h' }, [
      el('h2', { class: 'replay-h', id: 'replay-h' }, [el('span', { class: 'replay-tag', text: 'Replay' }), ' Replay — what was known at ', el('span', { class: 'num', title: 'UTC ' + at, text: formatLocal(at, caseTz(cv)) })]),
      el('p', { class: 'small', text: (note ? note + ' ' : '') + 'Read only: no actions can be taken from a replay. Times in ' + caseTz(cv) + '; UTC ' + at + '.' }),
      el('p', null, el('a', { class: 'btn btn-small', id: 'replay-exit', href: caseLink(cv.id), text: 'Back to the current view' }))
    ]);
  }
  function replayControl(cv) {
    var tz = caseTz(cv);
    var at = el('input', { type: 'datetime-local', id: 'replay-at', name: 'replay_at', required: true });
    var tzIn = zoneInput('replay_tz', tz, 'replay-tz');
    var err = el('p', { class: 'field-err', id: 'replay-err', role: 'alert' });
    var form = el('form', { class: 'replay-form', id: 'replay-form', novalidate: true }, [
      el('p', { class: 'small muted', text: 'Rebuild this case from only what had been recorded by a past moment. Read only.' }),
      el('div', { class: 'field-pair' }, [field('View as known at (local)', at), field('Time zone', tzIn)]),
      err,
      el('div', { class: 'btn-row' }, el('button', { type: 'submit', class: 'btn btn-quiet btn-small', id: 'replay-go', text: 'View as known at this time' }))
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = '';
      var z = tzIn.value.trim();
      if (!at.value) { err.textContent = 'Enter a date and time.'; at.focus(); return; }
      if (!validZone(z)) { err.textContent = 'Enter an IANA time zone such as Asia/Singapore.'; tzIn.focus(); return; }
      go(replayLink(cv.id, zonedToUtc(at.value, z)));
    });
    return section('Replay — as known at', 'replay', [form]);
  }

  // ---------------------------------------------------------------- duplicate check (§13.7)
  var NO_MATCH_TEXT = 'No matching record in this provider\u2019s book.';
  function duplicateBanner(cv) {
    var d = cv.duplicate_check;
    if (!d) return null;
    var st = d.status || 'no_match';
    var res = !isReplay(cv) && (findAction(cv, 'resolve_duplicate_check'));
    var title = st === 'potential_match' ? 'Potential duplicate — advance blocked until a reviewer resolves it' : st === 'overridden' ? 'Duplicate check resolved by a reviewer' : 'Duplicate check';
    return el('section', { class: 'dup dup-' + st, id: 'duplicate-check', 'data-status': st, 'aria-labelledby': 'dup-h' }, [
      el('h2', { class: 'dup-h', id: 'dup-h' }, [el('span', { class: 'dup-tag', text: st === 'potential_match' ? 'Potential match' : st === 'overridden' ? 'Resolved' : 'No match' }), ' ', title]),
      el('p', { class: 'dup-text', id: 'dup-text', text: show(d.text || (st === 'no_match' ? NO_MATCH_TEXT : '')) }),
      arr(d.matches).length ? el('p', { class: 'small', id: 'dup-matches' }, ['Possible matches in this organisation: ',
        arr(d.matches).map(function (m, i) { var mid = typeof m === 'object' ? (m.case_id || m.id) : m; return [i ? ', ' : '', el('a', { class: 'mono', href: caseLink(mid), text: mid })]; })]) : null,
      st === 'potential_match' ? el('p', { class: 'small muted', text: 'Only this provider\u2019s own cases are searched. A match is not proof of double financing; a reviewer decides.' }) : null,
      res ? el('div', { class: 'btn-row' }, [
        el('button', { type: 'button', class: 'btn btn-small', id: 'dup-resolve', 'data-action': 'resolve_duplicate_check', disabled: res.enabled ? null : true, text: res.label || 'Resolve duplicate check', onclick: function (e) { openCommand(res, e.currentTarget); } }),
        roleTag(roleText(res)), !res.enabled && res.disabled_reason ? el('span', { class: 'small disabled-reason', text: res.disabled_reason }) : null
      ]) : (st === 'potential_match' ? el('p', { class: 'small', text: 'A reviewer resolves this with "Resolve duplicate check".' }) : null)
    ]);
  }

  // ---------------------------------------------------------------- decision record (§13.5)
  var TRIGGER = { observation: 'Observation recorded', evidence: 'Evidence attached', review: 'Review decision', clock: 'Time passed', command: 'Command' };
  function atUtc(v) { return v && typeof v === 'object' ? (v.utc || v.at) : v; }
  function factLine(f, kind, cv) {
    if (typeof f !== 'object' || !f) return el('li', { class: 'fact fact-' + kind, text: String(f) });
    var who = pick(f, 'actor_name', 'actor', 'by', 'reviewer', 'user');
    if (who && typeof who === 'object') who = who.name;
    var role = pick(f, 'actor_role', 'role');
    var pol = pick(f, 'policy_version', 'policy');
    var when = pick(f, 'at', 'known_at', 'effective_at', 'decided_at');
    var meta = [];
    if (!blank(when)) meta.push(el('span', { class: 'num' }, time(typeof when === 'object' ? when : formatLocal(when, caseTz(cv)), atUtc(when))));
    if (!blank(who)) meta.push(el('span', { text: String(who) }));
    if (!blank(role)) meta.push(roleTag(role));
    if (!blank(pol)) meta.push(el('span', { class: 'mono', text: 'Policy ' + pol }));
    var id = pick(f, 'event_id', 'id', 'observation_id');
    if (!blank(id)) meta.push(el('span', { class: 'mono', text: '#' + id }));
    if (!blank(f.provenance)) meta.push(provBadge(f.provenance));
    return el('li', { class: 'fact fact-' + kind }, [
      el('span', { class: 'fact-text', text: text(pick(f, 'text', 'summary', 'rule', 'decision', 'label') || f) }),
      f.result !== undefined && !blank(f.result) ? el('span', { class: 'chip', text: humanize(f.result) }) : null,
      f.reason ? el('span', { class: 'sub', text: 'Reason: ' + f.reason }) : null,
      meta.length ? el('span', { class: 'fact-meta' }, meta.reduce(function (acc, m, i) { if (i) acc.push(' · '); acc.push(m); return acc; }, [])) : null
    ]);
  }
  function drList(items, cls, empty) {
    items = arr(items);
    if (!items.length) return el('p', { class: 'small muted', text: empty });
    return el('ul', { class: 'dr-list ' + cls }, items.map(function (x) {
      if (typeof x !== 'object' || !x) return el('li', { text: String(x) });
      return el('li', { 'data-kind': x.kind || '' }, [x.kind ? el('span', { class: 'blk-kind', text: BLOCKER_KIND[x.kind] || humanize(x.kind) }) : null, x.kind ? ' ' : null,
        x.change ? el('span', { class: 'chip', text: humanize(x.change) }) : null, x.change ? ' ' : null,
        el('span', { text: text(pick(x, 'text', 'message', 'summary', 'label') || x) })]);
    }));
  }
  function changedItems(ch) {
    if (Array.isArray(ch)) return ch;
    if (ch && typeof ch === 'object') {
      return arr(ch.cleared || ch.blockers_cleared).map(function (b) { return Object.assign({ change: 'cleared' }, typeof b === 'object' ? b : { text: b }); })
        .concat(arr(ch.added || ch.blockers_added).map(function (b) { return Object.assign({ change: 'added' }, typeof b === 'object' ? b : { text: b }); }))
        .concat(ch.text ? [{ text: ch.text }] : []);
    }
    return [];
  }
  function statusChip(st) { return st ? chip(humanize(st), 'chip-route chip-' + st) : el('span', { class: 'muted', text: DASH }); }
  function decisionRecordPanel(cv) {
    var dr = cv.decision_record;
    if (!dr) return section('Decision record', 'decision-record', [el('p', { class: 'muted small', text: 'No decision record in this view.' })]);
    var cps = arr(dr.checkpoints);
    var tz = caseTz(cv);
    return section('Decision record', 'decision-record', [
      el('div', { class: 'dr-cols' }, [
        el('div', { class: 'dr-col dr-waiting', id: 'dr-waiting' }, [el('h3', { text: 'What we were waiting for' }), drList(dr.waiting_for, 'dr-waiting-list', 'Nothing outstanding.')]),
        el('div', { class: 'dr-col dr-changed', id: 'dr-changed' }, [el('h3', { text: 'What changed' }), drList(changedItems(dr.changed), 'dr-changed-list', 'No change recorded yet.')]),
        el('div', { class: 'dr-col dr-uncertain', id: 'dr-uncertain' }, [el('h3', { text: 'What remains uncertain' }), drList(dr.uncertain, 'dr-uncertain-list', 'Nothing flagged as uncertain.')])
      ]),
      el('h3', { class: 'mini-h', text: 'Checkpoints — each time eligibility was re-evaluated (' + cps.length + ')' }),
      cps.length ? el('ol', { class: 'cp-list', id: 'checkpoints' }, cps.map(function (c, i) {
        var at = atUtc(c.at);
        var facts = c.facts || {};
        return el('li', { class: 'cp', 'data-seq': c.trigger_event_seq || '', 'data-at': at || '' }, [
          el('div', { class: 'cp-head' }, [
            el('span', { class: 'cp-n mono', text: String(i + 1) }),
            el('span', { class: 'cp-when num', title: 'UTC ' + at, text: c.at && c.at.local ? c.at.local : formatLocal(at, tz) }),
            el('span', { class: 'cp-trigger', text: (TRIGGER[c.trigger] || humanize(c.trigger)) + (c.trigger_event_seq ? ' (event #' + c.trigger_event_seq + ')' : '') }),
            el('span', { class: 'cp-move' }, ['Route C ', statusChip(c.route_c_before), el('span', { 'aria-hidden': 'true', text: ' \u2192 ' }), el('span', { class: 'visually-hidden', text: ' became ' }), statusChip(c.route_c_after)]),
            at ? el('button', { type: 'button', class: 'btn btn-quiet btn-small cp-replay', 'data-at': at, text: 'Replay as known at this checkpoint', onclick: function () { go(replayLink(cv.id, at)); } }) : null
          ]),
          (arr(c.blockers_cleared).length || arr(c.blockers_added).length) ? el('div', { class: 'cp-blk' }, [
            arr(c.blockers_cleared).length ? el('div', null, [el('p', { class: 'mini-h', text: 'Blockers cleared' }), drList(c.blockers_cleared, 'cp-cleared', '')]) : null,
            arr(c.blockers_added).length ? el('div', null, [el('p', { class: 'mini-h', text: 'Blockers added' }), drList(c.blockers_added, 'cp-added', '')]) : null
          ]) : null,
          el('div', { class: 'cp-facts' }, [['observed', 'Observed — recorded facts'], ['policy', 'Policy — rule evaluations'], ['judgment', 'Judgment — reviewer decisions']].map(function (k) {
            var list = arr(facts[k[0]]);
            return el('div', { class: 'cp-fact-col fc-' + k[0] }, [el('p', { class: 'mini-h', text: k[1] }),
              list.length ? el('ul', { class: 'facts' }, list.map(function (f) { return factLine(f, k[0], cv); })) : el('p', { class: 'small muted', text: 'None.' })]);
          }))
        ]);
      })) : el('p', { class: 'muted small', text: 'No checkpoints yet. One is added whenever evidence or a review changes a route.' })
    ], 'panel-dr');
  }

  // ---------------------------------------------------------------- report link panel
  function reportPanel(cv) {
    return section('Pilot report', 'report-link', [
      el('p', { class: 'small muted', text: 'Clearline vs the provider\u2019s usual process for this case, with the source of every number.' }),
      el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-quiet btn-small', id: 'open-report', href: reportLink(cv.id), text: 'Open pilot report' })])
    ]);
  }

  function jumpEvidence(e) {
    var row = document.getElementById('ev-' + e.currentTarget.getAttribute('data-ev'));
    if (row) { e.preventDefault(); row.scrollIntoView({ block: 'center' }); row.classList.add('is-target'); row.focus(); }
  }

  function collectionsPanel(cv) {
    var c = cv.collections || {};
    var er = c.expected_receipt;
    var receipts = arr(c.customer_receipts); var reps = arr(c.repayments); var un = arr(c.unmatched);
    var erNode = blank(er) ? el('p', { class: 'muted small', text: 'No expected receipt on record.' })
      : typeof er === 'object' ? el('p', { class: 'small' }, [money(er.amount), ' expected ', time(er.expected_at_local || er.expected_at), er.payer ? ' from ' + er.payer : '', ' ', provBadge(er.provenance), el('span', { class: 'sub', text: 'A forecast. It never counts as cash and never reduces what is owed.' })])
        : el('p', { class: 'small', text: String(er) });
    return section('Collections', 'collections', [
      el('div', { class: 'coll-grid' }, [
        el('div', { class: 'coll coll-customer', id: 'customer-receipts' }, [
          el('h3', { text: 'Importer\u2019s customer receipts — not repayment' }),
          el('p', { class: 'mini-h', text: 'Expected receipt' }), erNode,
          receipts.length ? el('ul', { class: 'rec-list' }, receipts.map(function (r) {
            return el('li', null, [money(r.amount), ' ', time(r.effective_at_local || r.effective_at), ' ', el('span', { class: 'mono small', text: show(r.reference) }), ' ', provBadge(r.provenance)]);
          })) : el('p', { class: 'muted small', text: 'No customer receipts recorded.' }),
          el('p', { class: 'hint', text: 'The importer\u2019s own incoming money. It never reduces what is owed to the provider.' })
        ]),
        el('div', { class: 'coll coll-repay', id: 'repayments' }, [
          el('h3', { text: 'Repayments to provider' }),
          reps.length ? tableWrap('Repayments to provider', ['Bank ref', { label: 'Amount', cls: 'num-cell' }, 'Status', { label: 'Fees', cls: 'num-cell' }, { label: 'Principal', cls: 'num-cell' }, { label: 'Unmatched', cls: 'num-cell' }], reps.map(function (r) {
            var al = r.allocation || {};
            return el('tr', { 'data-repayment': r.id, class: 'rep-' + (r.status || '') }, [
              td(el('span', { class: 'mono', text: show(r.bank_ref) })), td(money(r.amount), 'num-cell'), td(chip(humanize(r.status), 'chip-rep chip-rep-' + r.status)),
              td(money(al.fees), 'num-cell'), td(money(al.principal), 'num-cell'), td(money(al.unmatched), 'num-cell')
            ]);
          }), 'repay') : el('p', { class: 'muted small', text: 'No repayments recorded.' })
        ]),
        el('div', { class: 'coll coll-unmatched', id: 'unmatched' }, [
          el('h3', { text: 'Unmatched items' }),
          un.length ? el('ul', { class: 'rec-list' }, un.map(function (u) {
            var ret = findAction(cv, 'return_unmatched', 'item_id', u.id) || findAction(cv, 'return_unmatched');
            return el('li', null, [money(u.amount), ' ', el('span', { class: 'small', text: text(u.reason || u.kind || u.status) }), ' ', el('span', { class: 'mono small', text: show(u.bank_ref || u.reference) }), ' ',
              ret && ret.enabled && !isReplay(cv) ? el('button', { type: 'button', class: 'btn btn-small', 'data-item': u.id, text: 'Return', onclick: function (e) { openCommand(ret, e.currentTarget, { item_id: u.id }); } }) : null]);
          })) : el('p', { class: 'muted small', text: 'Nothing unmatched.' }),
          el('p', { class: 'hint', text: 'Returning an unmatched amount never reduces what is owed.' })
        ])
      ])
    ]);
  }

  function identitiesPanel(cv) {
    var ids = arr(cv.identities);
    var ok = ids.filter(function (i) { return i.ok === true; }).length;
    var allOk = ids.length && ok === ids.length;
    return section('Reconciliation', 'identities', [
      el('p', { class: 'recon ' + (allOk ? 'id-ok' : 'id-fail'), id: 'recon-count', text: 'Reconciled: ' + ok + '/' + ids.length }),
      el('ul', { class: 'checks' }, ids.map(function (i) {
        return el('li', { class: 'check ' + (i.ok ? 'check-ok' : 'check-fail') }, [el('span', { class: 'check-icon', 'aria-hidden': 'true', text: i.ok ? '✓' : '✕' }), el('span', null, [el('span', { class: 'check-name', text: show(i.name) }), el('span', { class: 'visually-hidden', text: i.ok ? ' holds. ' : ' broken. ' }), el('span', { class: 'check-detail num', text: text(i.detail) })])]);
      }))
    ]);
  }

  function exportPanel(cv) {
    var base = '/api/cases/' + encodeURIComponent(cv.id) + '/export?format=';
    return section('Export history', 'exports', [
      el('p', { class: 'small muted', text: 'Every event with actor, role, effective and known times, provenance, reason and corrections.' }),
      el('div', { class: 'btn-row' }, ['json', 'csv', 'html'].map(function (f) {
        return el('a', { class: 'btn btn-quiet btn-small', href: base + f, download: '', 'data-export': f, text: f.toUpperCase() });
      }))
    ]);
  }

  // ---------------------------------------------------------------- evidence
  function evidencePanel(cv) {
    var rows = [];
    // Observations (records typed in or backed by a file); superseded ones stay, struck through.
    arr(cv.observations).forEach(function (o) {
      var sup = !!(o.struck || o.superseded_by);
      var fst = factStatus(o);
      var src = [o.issuer ? 'Issued by ' + o.issuer : null, o.record_ref ? 'their ref ' + o.record_ref : null, o.scope ? 'scope: ' + humanize(o.scope) : null].filter(Boolean).join(' · ');
      rows.push(el('tr', { id: 'ev-' + o.event_id, tabindex: '-1', class: 'ev-obs' + (sup ? ' superseded' : '') + (fst ? ' fact-' + fst : ''), 'data-kind': o.kind, 'data-fact': fst || '' }, [
        td(el('span', { class: 'mono', text: '#' + show(o.event_id) })),
        td([el('span', { class: 'ev-what' + (sup ? ' struck' : ''), text: text(o.text) }),
          src ? el('span', { class: 'sub', text: src }) : null,
          o.corrects ? el('span', { class: 'sub', text: 'Correction of #' + o.corrects + (o.reason ? ' — ' + o.reason : '') }) : null,
          sup ? el('span', { class: 'sub', text: 'Superseded by #' + o.superseded_by }) : null,
          o.fact_detail || o.status_detail ? el('span', { class: 'sub', text: o.fact_detail || o.status_detail }) : null]),
        td(humanize(o.kind)),
        td(factBadge(fst)),
        td(provBadge(o.provenance)),
        td(time(o.effective_at)),
        td(time(o.known_at)),
        td(o.evidence_id ? el('a', { class: 'record-id', href: '#ev-' + o.evidence_id, 'data-ev': o.evidence_id, onclick: jumpEvidence, text: String(o.evidence_id) }) : el('span', { class: 'muted small', text: 'No file' })),
        td(DASH)
      ]));
    });
    arr(cv.evidence).forEach(function (x) {
      var sup = x.superseded || x.superseded_by || x.status === 'superseded';
      var dl = x.download_url || null;
      rows.push(el('tr', { id: 'ev-' + x.id, tabindex: '-1', class: 'ev-file' + (sup ? ' superseded' : '') }, [
        td(el('span', { class: 'mono', text: show(x.id) })),
        td([el('span', { class: 'ev-what' + (sup ? ' struck' : ''), text: 'File: ' + show(x.filename) }), el('span', { class: 'sub', text: show(x.content_type) + (x.size !== undefined ? ' · ' + x.size + ' bytes' : '') })]),
        td('File'),
        td(DASH),
        td(provBadge(x.provenance)),
        td(DASH),
        td(time(x.known_local || x.known_at, x.known_at)),
        td(x.filename ? (dl ? el('a', { href: dl, class: 'mono small', download: x.filename, text: x.filename }) : el('span', { class: 'mono small', text: x.filename })) : DASH),
        td(x.sha256 ? el('span', { class: 'mono small hash', title: x.sha256, text: String(x.sha256).slice(0, 12) + '…' }) : DASH)
      ]));
    });
    var children = [
      el('p', { class: 'hint' }, ['Badges: ', provBadge('operator_entered'), ' typed in, not bank-confirmed · ', provBadge('external_record'), ' document attached · ', provBadge('provider_event'), ' · ', provBadge('sandbox_simulation'), ' not a live payment.']),
      el('p', { class: 'hint' }, ['Fact status: ', factBadge('fresh'), ' current and within policy age · ', factBadge('stale'), ' too old for the policy · ', factBadge('superseded'), ' replaced by a correction · ', factBadge('conflicting'), ' two records disagree — the route is unknown.']),
      rows.length ? tableWrap('Evidence', ['Id', 'Record', 'Kind', 'Status', 'Provenance', 'Effective', 'Known', 'File', 'SHA-256'], rows, 'evidence') : el('p', { class: 'muted small', text: 'No evidence yet.' })
    ];
    if (canWrite() && !isReplay(cv)) children.push(uploadForm(cv));
    return section('Evidence', 'evidence', children, 'panel-wide');
  }
  var FACT = {
    fresh: { label: 'Fresh', icon: '\u2713', title: 'Active, known now and within the policy\u2019s maximum age.' },
    stale: { label: 'Stale', icon: '\u231b', title: 'Older than the policy allows. Add a newer record.' },
    superseded: { label: 'Superseded', icon: '\u2192', title: 'Replaced by a correction. Kept, struck through.' },
    conflicting: { label: 'Conflicting', icon: '\u2260', title: 'Another active record of the same kind disagrees. Dependent routes are unknown.' }
  };
  function factStatus(o) {
    var v = pick(o, 'fact_status', 'freshness', 'status');
    if (v && typeof v === 'object') v = v.status || v.key;
    if (FACT[v]) return v;
    return (o.superseded_by || o.struck) ? 'superseded' : null;
  }
  function factBadge(st) {
    if (!st || !FACT[st]) return el('span', { class: 'muted small', text: DASH });
    return el('span', { class: 'fact-badge fb-' + st, title: FACT[st].title }, [el('span', { 'aria-hidden': 'true', text: FACT[st].icon + ' ' }), FACT[st].label]);
  }
  var EV_TYPES = { 'application/pdf': 1, 'image/png': 1, 'image/jpeg': 1, 'text/csv': 1, 'text/plain': 1 };
  function guessType(f) {
    if (f.type && EV_TYPES[f.type]) return f.type;
    var n = (f.name || '').toLowerCase();
    if (/\.pdf$/.test(n)) return 'application/pdf';
    if (/\.png$/.test(n)) return 'image/png';
    if (/\.jpe?g$/.test(n)) return 'image/jpeg';
    if (/\.csv$/.test(n)) return 'text/csv';
    if (/\.txt$/.test(n)) return 'text/plain';
    return f.type || 'application/octet-stream';
  }
  function b64(buf) {
    var bytes = new Uint8Array(buf); var s = ''; var CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function uploadForm(cv) {
    var file = el('input', { type: 'file', id: 'ev-file', name: 'file', accept: '.pdf,.png,.jpg,.jpeg,.csv,.txt,application/pdf,image/png,image/jpeg,text/csv,text/plain' });
    var desc = el('input', { type: 'text', id: 'ev-desc', name: 'description', placeholder: 'What this document shows' });
    var err = el('div', { class: 'pd-form-error', role: 'alert', hidden: true, id: 'ev-error' });
    var btn = el('button', { type: 'submit', class: 'btn', id: 'ev-upload', text: 'Upload evidence' });
    var key = null; var keyFor = null;
    var form = el('form', { class: 'upload', id: 'ev-form', novalidate: true }, [
      el('h3', { class: 'mini-h', text: 'Attach a file (PDF, PNG, JPEG, CSV or text; up to 5 MB)' }),
      el('div', { class: 'field-pair' }, [field('File', file), field('Description', desc, null, { optional: true })]),
      err, el('div', { class: 'btn-row' }, btn)
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.hidden = true;
      var f = file.files && file.files[0];
      if (!f) { err.textContent = 'Choose a file first.'; err.hidden = false; file.focus(); return; }
      if (f.size > 5 * 1024 * 1024) { err.textContent = 'That file is larger than 5 MB. Attach a smaller file.'; err.hidden = false; return; }
      var ct = guessType(f);
      if (!EV_TYPES[ct]) { err.textContent = 'Only PDF, PNG, JPEG, CSV or text files can be attached.'; err.hidden = false; return; }
      var sig = f.name + '|' + f.size + '|' + f.lastModified + '|' + desc.value;
      if (keyFor !== sig) { key = uuid(); keyFor = sig; }
      btn.disabled = true; status('Uploading ' + f.name + '…');
      f.arrayBuffer().then(function (buf) {
        return api('POST', '/api/cases/' + encodeURIComponent(cv.id) + '/evidence', {
          filename: f.name, content_type: ct, data_base64: b64(buf), description: desc.value.trim() || null,
          idempotency_key: key, expected_version: S.view.version
        });
      }).then(function () {
        btn.disabled = false; key = null; keyFor = null;
        return reloadCase('Evidence ' + f.name + ' attached.');
      }).catch(function (e2) {
        btn.disabled = false;
        if (e2.code === 'stale_version') { key = null; keyFor = null; reloadCase('Case changed since you loaded it — reloaded'); return; }
        err.textContent = e2.message; err.hidden = false; status('');
      });
    });
    return form;
  }

  // ---------------------------------------------------------------- pilot report (§13.9)
  var REPORT_PROV = {
    recorded: { label: 'recorded', title: 'From the provider\u2019s own records.' },
    estimated: { label: 'estimated', title: 'Someone\u2019s estimate, not a record.' },
    synthetic: { label: 'synthetic', title: 'Made up for the pilot. Not evidence of anything.' },
    computed: { label: 'computed', title: 'Computed by the server from this case\u2019s event log.' },
    operator_reported: { label: 'operator reported', title: 'Minutes reported by the person who did the work.' },
    not_measured: { label: 'not measured', title: 'No number was recorded for this.' }
  };
  function provKey(v) { return blank(v) ? null : String(v).toLowerCase().replace(/[\s-]+/g, '_'); }
  function reportCell(c) {
    var val; var prov; var note;
    if (c && typeof c === 'object') {
      val = pick(c, 'display', 'text', 'formatted', 'value');
      prov = provKey(pick(c, 'label', 'provenance', 'basis', 'source_label', 'kind'));
      note = pick(c, 'note', 'detail', 'how');
      if (!blank(val) && typeof val !== 'boolean' && !blank(c.unit) && blank(pick(c, 'display', 'text', 'formatted'))) val = val + ' ' + c.unit;
    } else { val = c; }
    if (prov === 'not_measured' || blank(val) && !prov) { prov = 'not_measured'; }
    if (typeof val === 'boolean') val = val ? 'Yes' : 'No';
    var m = REPORT_PROV[prov] || { label: prov ? humanize(prov) : 'unlabelled', title: '' };
    return el('td', { class: 'rp-cell rp-' + (prov || 'none') }, [
      prov === 'not_measured' && blank(val) ? el('span', { class: 'rp-val muted', text: 'not measured' }) : el('span', { class: 'rp-val num', text: show(val) }),
      ' ', el('span', { class: 'rp-prov rpp-' + (prov || 'none'), title: m.title, text: m.label }),
      note ? el('span', { class: 'sub', text: String(note) }) : null
    ]);
  }
  var REPORT_ROW_LABEL = {
    touchpoints: 'Touchpoints (human events)', evidence_requests: 'Repeated evidence requests', repeated_evidence_requests: 'Repeated evidence requests',
    decision_hours: 'Decision elapsed hours (request \u2192 judgment)', decision_elapsed_hours: 'Decision elapsed hours (request \u2192 judgment)',
    active_minutes: 'Active human minutes', operator_minutes: 'Active human minutes', elapsed_wait_hours: 'Elapsed wait (decision time minus active work)',
    elapsed_wait: 'Elapsed wait (decision time minus active work)', deadline_met: 'Deadline met', outcome: 'Outcome'
  };
  function reportRows(r) {
    var rows = arr(r.rows || r.metrics || r.comparison);
    if (rows.length) return rows.map(function (x) {
      return { key: pick(x, 'key', 'metric', 'id', 'measure') || '', label: pick(x, 'measure', 'label', 'name', 'title', 'metric') || '', clearline: x.clearline, baseline: x.baseline };
    });
    var cl = r.clearline || {}; var bl = r.baseline || {};
    var keys = [];
    [cl, bl].forEach(function (o) { if (o && typeof o === 'object' && !Array.isArray(o)) Object.keys(o).forEach(function (k) { if (keys.indexOf(k) < 0 && ['provenance', 'source_note', 'label', 'recorded_at', 'recorded_by'].indexOf(k) < 0) keys.push(k); }); });
    return keys.map(function (k) { return { key: k, label: REPORT_ROW_LABEL[k] || humanize(k), clearline: cl[k], baseline: bl[k] }; });
  }
  var NOT_SAVINGS_FALLBACK = 'Capital released, advance principal and transferred credit risk are not savings and are not reported as savings.';
  function renderReport(id, seq) {
    var v = viewRoot('Pilot report', 'report-h1');
    var holder = el('div', { id: 'pd-report', 'aria-busy': 'true' }, el('p', { class: 'muted', text: 'Loading report…' }));
    v.root.appendChild(holder);
    focusHeading(v.heading);
    Promise.all([loadCase(id, null), api('GET', '/api/cases/' + encodeURIComponent(id) + '/report?format=json')]).then(function (res) {
      if (seq !== undefined && seq !== S.routeSeq) return;
      paintReport(res[0], res[1]);
    }).catch(function (e) {
      if (seq !== undefined && seq !== S.routeSeq) return;
      holder.removeAttribute('aria-busy');
      holder.replaceChildren(el('div', { class: 'panel', id: 'report-error' }, [el('p', { text: e.status === 404 ? 'Not found. There is no report for ' + id + ' in your workspace.' : e.message }), el('p', null, el('a', { href: caseLink(id), text: 'Back to the case' }))]));
    });
  }
  function paintReport(cv, r) {
    var h = cv.header || {};
    var v = viewRoot('Pilot report — ' + show(h.importer) + ' \u2192 ' + show(h.supplier), 'report-h1');
    v.root.setAttribute('data-version', String(cv.version));
    v.root.prepend(el('p', { class: 'crumbs' }, [el('a', { href: '#/queue', text: 'Queue' }), ' / ', el('a', { class: 'mono', id: 'report-case', href: caseLink(cv.id), text: cv.id }), ' / Pilot report']));
    r = r || {};
    var rows = reportRows(r);
    var statement = pick(r, 'not_savings_statement', 'not_savings', 'statement', 'disclaimer');
    if (statement && typeof statement === 'object') statement = text(statement);
    var bl = r.baseline && typeof r.baseline === 'object' && !Array.isArray(r.baseline) ? r.baseline : null;
    var blProv = pick(r, 'baseline_provenance') || (bl && bl.provenance && typeof bl.provenance !== 'object' ? bl.provenance : null);
    var blNote = pick(r, 'baseline_source_note') || (bl && bl.source_note);
    var htmlHref = '/api/cases/' + encodeURIComponent(cv.id) + '/report?format=html';
    var acts = arr(cv.actions);
    var logA = acts.filter(function (a) { return a.type === 'log_work'; })[0] || (canWrite() ? { type: 'log_work', label: 'Log work', enabled: true, role: S.me.user.role, params: ['minutes', 'activity'] } : null);
    var baseA = acts.filter(function (a) { return a.type === 'record_baseline'; })[0] || (canWrite() ? { type: 'record_baseline', label: 'Record baseline', enabled: true, role: S.me.user.role, params: ['provenance', 'operator_minutes', 'touchpoints', 'evidence_requests', 'decision_hours', 'deadline_met', 'outcome', 'source_note'] } : null);
    var reload = function (msg) {
      return Promise.all([loadCase(cv.id, null), api('GET', '/api/cases/' + encodeURIComponent(cv.id) + '/report?format=json')]).then(function (res) { paintReport(res[0], res[1]); status(msg); var hh = $('report-h1'); if (hh) hh.focus(); });
    };
    var actBtn = function (a, bid) {
      if (!a) return null;
      return el('li', { class: 'action' + (a.enabled ? '' : ' is-disabled') }, [
        el('button', { type: 'button', class: 'btn abtn', id: bid, 'data-action': a.type, disabled: a.enabled ? null : true, text: a.label || humanize(a.type),
          onclick: function (e) { openCommand(a, e.currentTarget, null, reload); } }),
        roleTag(roleText(a)), !a.enabled && a.disabled_reason ? el('p', { class: 'disabled-reason', text: a.disabled_reason }) : null
      ]);
    };
    v.root.appendChild(el('section', { class: 'rp-statement', id: 'report-statement', role: 'note' }, [
      el('p', { class: 'rp-statement-h', text: 'What this report is not' }),
      el('p', { id: 'report-not-savings', class: statement ? '' : 'rp-fallback', text: statement || NOT_SAVINGS_FALLBACK })
    ]));
    v.root.appendChild(el('div', { class: 'case-grid' }, [
      el('div', { class: 'col-main' }, [
        section('Clearline vs baseline', 'report-table', [
          el('p', { class: 'small muted', text: 'Clearline figures are computed from this case\u2019s event log. The baseline is what the provider\u2019s usual process took, as recorded below. Every number carries its source.' }),
          rows.length ? tableWrap('Clearline vs baseline', ['Measure', 'Clearline', 'Baseline'], rows.map(function (x) {
            return el('tr', { 'data-metric': x.key }, [el('th', { scope: 'row', text: show(x.label || REPORT_ROW_LABEL[x.key] || humanize(x.key)) }), reportCell(x.clearline), reportCell(x.baseline)]);
          }), 'report') : el('p', { class: 'muted small', text: 'The server returned no measures.' }),
          el('p', { class: 'hint', id: 'report-baseline-source' }, ['Baseline: ', blProv ? el('span', { class: 'rp-prov rpp-' + provKey(blProv), text: (REPORT_PROV[provKey(blProv)] || { label: blProv }).label }) : el('span', { class: 'rp-prov rpp-not_measured', text: 'not measured' }), blNote ? ' — ' + blNote : (blProv ? '' : ' — no baseline recorded for this case.')]),
          r.active_vs_elapsed ? el('p', { class: 'hint', text: text(r.active_vs_elapsed) }) : null,
          r.sandbox_note ? el('p', { class: 'sandbox-note', text: text(r.sandbox_note) }) : null,
          el('p', { class: 'hint' }, ['Labels: ', ['recorded', 'estimated', 'synthetic', 'computed', 'not_measured'].map(function (k) { return [el('span', { class: 'rp-prov rpp-' + k, title: REPORT_PROV[k].title, text: REPORT_PROV[k].label }), ' ']; })])
        ])
      ]),
      el('div', { class: 'col-side' }, [
        section('Record measurements', 'report-actions', [
          el('p', { class: 'small muted', text: 'Ordinary case actions, recorded in the case history.' }),
          canWrite() ? el('ul', { class: 'alist', id: 'report-actions-list' }, [actBtn(logA, 'btn-log-work'), actBtn(baseA, 'btn-record-baseline')]) : el('p', { class: 'muted small', text: 'Viewers can read the report only.' })
        ], 'panel-actions'),
        section('Report formats', 'report-formats', [
          el('div', { class: 'btn-row' }, [el('a', { class: 'btn btn-quiet btn-small', id: 'report-html', href: htmlHref, text: 'One-page HTML report' }), el('a', { class: 'btn btn-quiet btn-small', href: caseLink(cv.id), text: 'Back to the case' })]),
          r.generated_at ? el('p', { class: 'small muted num', text: 'Generated ' + utcShort(r.generated_at) }) : null
        ])
      ])
    ]));
    focusHeading(v.heading);
  }

  // ---------------------------------------------------------------- timeline
  function timelinePanel(cv) {
    var tl = arr(cv.timeline);
    return section('Timeline', 'timeline', [
      tl.length ? el('ol', { class: 'tl' }, tl.map(function (t) {
        var actor = t.actor && typeof t.actor === 'object' ? t.actor : { name: pick(t, 'actor_name', 'actor'), role: pick(t, 'actor_role', 'role') };
        if (blank(actor.role)) actor.role = t.actor_role;
        var corr = pick(t, 'corrects_event_id', 'corrects');
        var sup = t.superseded || t.corrected_by;
        return el('li', { class: 'tl-item' + (sup ? ' superseded' : '') + (corr ? ' is-correction' : ''), 'data-type': t.type || '' }, [
          el('div', { class: 'tl-when' }, [
            el('span', { class: 'tl-eff' }, ['Effective ', time(pick(t, 'at_local', 'effective_at_local', 'effective_local', 'effective_at'), t.effective_at_utc || t.effective_at)]),
            el('span', { class: 'tl-known' }, ['Known ', time(pick(t, 'known_local', 'known_at_local', 'known_at'), t.known_at_utc || t.known_at)])
          ]),
          el('div', { class: 'tl-body' }, [
            el('p', { class: 'tl-what' }, [el('span', { class: 'mono tl-seq', text: '#' + show(t.event_id || t.seq) + ' ' }), el('span', { class: sup ? 'struck' : '', text: text(pick(t, 'text', 'summary', 'label', 'title') || humanize(t.type)) }), ' ', provBadge(t.provenance)]),
            el('p', { class: 'tl-actor' }, [el('span', { class: 'tl-actor-name', text: show(actor.name) }), ' ', roleTag(actor.role)]),
            t.reason ? el('p', { class: 'tl-reason', text: 'Reason: ' + t.reason }) : null,
            t.sandbox_label ? el('p', { class: 'sandbox-note', text: t.sandbox_label }) : null,
            corr ? el('p', { class: 'tl-corr', text: 'Corrects event #' + corr }) : null,
            sup ? el('p', { class: 'tl-corr', text: 'Corrected by event #' + t.corrected_by }) : null
          ])
        ]);
      })) : el('p', { class: 'muted small', text: 'No events yet.' })
    ], 'panel-wide');
  }

  // ---------------------------------------------------------------- actions
  function roleText(a) { return arr(a.roles).length ? a.roles.join(' or ') : (a.role || ''); }
  function findAction(cv, type, presetKey, presetVal) {
    if (presetKey) return arr(cv.actions).filter(function (a) { return a.type === type && a.preset && String(a.preset[presetKey]) === String(presetVal); })[0] || null; return arr(cv.actions).filter(function (a) { return a.type === type; })[0] || null; }
  var NOTE_TYPES = { add_note: 1, assign_owner: 1 };
  function actionsPanel(cv) {
    if (isReplay(cv)) {
      return section('Actions', 'actions', [
        el('p', { class: 'replay-noact', id: 'actions-replay', text: 'Replay — no actions. This is what was known at ' + formatLocal(replayAt(cv), caseTz(cv)) + '.' }),
        el('p', null, el('a', { class: 'btn btn-small', href: caseLink(cv.id), text: 'Back to the current view to act' }))
      ], 'panel-actions');
    }
    var acts = arr(cv.actions).filter(function (a) { return !NOTE_TYPES[a.type] && !MEASURE_TYPES[a.type] && a.type !== 'resolve_duplicate_check'; });
    var meas = arr(cv.actions).filter(function (a) { return MEASURE_TYPES[a.type] && a.enabled; });
    var on = acts.filter(function (a) { return a.enabled; });
    var off = acts.filter(function (a) { return !a.enabled; });
    var role = S.me ? S.me.user.role : '';
    return section('Actions', 'actions', [
      el('p', { class: 'small' }, ['You are signed in as ', roleTag(role), '.', role === 'viewer' ? ' Viewers can read and export only.' : '']),
      on.length ? el('ul', { class: 'alist', id: 'actions-enabled' }, on.map(function (a) {
        return el('li', { class: 'action' }, [
          el('button', { type: 'button', class: 'btn abtn', 'data-action': a.type, 'data-label': a.label, text: a.label, onclick: function (e) { openCommand(a, e.currentTarget); } }),
          roleTag(roleText(a))
        ]);
      })) : el('p', { class: 'muted small', id: 'actions-none', text: 'No actions available to you on this case right now.' }),
      off.length ? el('details', { class: 'actions-off', open: on.length ? null : true }, [
        el('summary', { text: 'Not available now (' + off.length + ')' }),
        el('ul', { class: 'alist alist-off', id: 'actions-disabled' }, off.map(function (a) {
          return el('li', { class: 'action is-disabled', 'data-action': a.type }, [
            el('div', { class: 'action-top' }, [el('button', { type: 'button', class: 'btn btn-small abtn', disabled: true, 'data-action': a.type, text: a.label }), roleTag(roleText(a))]),
            el('p', { class: 'disabled-reason', text: show(a.disabled_reason) })
          ]);
        }))
      ]) : null,
      meas.length ? el('div', { class: 'actions-measure' }, [
        el('p', { class: 'mini-h', text: 'Pilot measurement — not part of the payment' }),
        el('ul', { class: 'alist', id: 'actions-measure' }, meas.map(function (a) {
          return el('li', { class: 'action' }, [el('button', { type: 'button', class: 'btn btn-quiet btn-small abtn', 'data-action': a.type, text: a.label, onclick: function (e) { openCommand(a, e.currentTarget); } }), roleTag(roleText(a))]);
        }))
      ]) : null
    ], 'panel-actions');
  }
  var MEASURE_TYPES = { log_work: 1, record_baseline: 1 };
  function focusAction(type) {
    var btn = document.querySelector('#actions-enabled button[data-action="' + cssEsc(type) + '"]');
    var panelH = $('actions-h');
    if (!btn && type === 'next') btn = document.querySelector('#actions-enabled button');
    if (btn) { btn.classList.add('is-focus'); btn.scrollIntoView({ block: 'center' }); btn.focus(); status('Focused on ' + btn.textContent + '.'); }
    else {
      var dis = document.querySelector('#actions-disabled [data-action="' + cssEsc(type) + '"]');
      if (dis) { var det = dis.closest('details'); if (det) det.open = true; dis.classList.add('is-focus'); }
      if (panelH) { panelH.scrollIntoView({ block: 'start' }); panelH.focus(); }
    }
  }
  function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

  function notesList(cv) {
    var ns = arr(cv.notes).slice(-5).reverse();
    if (!ns.length) return null;
    return el('ul', { class: 'notes', id: 'notes' }, ns.map(function (n) {
      return el('li', null, [el('p', { class: 'note-text', text: show(n.text) }), el('p', { class: 'sub num', text: show(n.by_name) + ' · ' + utcShort(n.at) })]);
    }));
  }
  function handoffPanel(cv) {
    var noteA = findAction(cv, 'add_note');
    var asgA = findAction(cv, 'assign_owner');
    var canNote = !isReplay(cv) && (noteA ? noteA.enabled : canWrite());
    var canAsg = !isReplay(cv) && (asgA ? asgA.enabled : canWrite());
    if (!canNote && !canAsg) return section('Notes and hand-off', 'handoff', [notesList(cv), el('p', { class: 'muted small', text: isReplay(cv) ? 'Replay — read only.' : ((noteA && noteA.disabled_reason) || 'Viewers cannot add notes or hand off cases.') })]);
    var btns = [];
    if (canNote) btns.push(el('button', { type: 'button', class: 'btn btn-quiet btn-small', id: 'btn-add-note', text: 'Add note', onclick: function (e) { openCommand(noteA || { type: 'add_note', label: 'Add note', role: S.me.user.role, params: ['text'] }, e.currentTarget); } }));
    if (canAsg) btns.push(el('button', { type: 'button', class: 'btn btn-quiet btn-small', id: 'btn-assign', text: 'Assign owner / hand off', onclick: function (e) { openCommand(asgA || { type: 'assign_owner', label: 'Assign owner / hand off', role: S.me.user.role, params: ['user_id', 'note'] }, e.currentTarget); } }));
    return section('Notes and hand-off', 'handoff', [notesList(cv), el('p', { class: 'small muted', text: 'Notes and hand-offs are recorded in the timeline.' }), el('div', { class: 'btn-row' }, btns)]);
  }

  // Param descriptors: strings or {name, label, type, required, options, value, fixed}
  var PARAM_KIND = {
    amount: 'amount', currency: 'currency', effective_at: 'time', as_of: 'time', due_at: 'time', expected_at: 'time',
    reason: 'textarea', note: 'textarea', text: 'textarea', what: 'textarea',
    evidence_id: 'evidence', repayment_id: 'repayment', item_id: 'unmatched', match_id: 'match', user_id: 'user',
    route: 'route', status: 'delivery_status', disposition: 'disposition', kind: 'obs_kind', later_permitted: 'bool', event_id: 'event',
    issued_at: 'time', scope: 'scope', decision: 'dup_decision', minutes: 'number', operator_minutes: 'number', touchpoints: 'number',
    evidence_requests: 'number', decision_hours: 'number', deadline_met: 'tristate', provenance: 'provenance', source_note: 'textarea', outcome: 'text'
  };
  var PARAM_LABEL = {
    amount: 'Amount', currency: 'Currency', effective_at: 'Effective time', as_of: 'As of', due_at: 'Due', expected_at: 'Expected at',
    reason: 'Reason', note: 'Hand-off note', text: 'Note', what: 'What evidence is needed', reference: 'Reference', bank_ref: 'Bank reference',
    external_ref: 'External payout reference', location: 'Last evidenced location', evidence_id: 'Supporting evidence', repayment_id: 'Repayment',
    item_id: 'Unmatched item', match_id: 'Match', user_id: 'New owner', route: 'Route', status: 'Delivery status', disposition: 'Disposition',
    source: 'Source', payer: 'Payer', description: 'Description', document_ref: 'Document reference', contract_ref: 'Contract reference', event_id: 'Record to supersede',
    issuer: 'Issued by (who produced it)', record_ref: 'Their record reference', scope: 'Applies to', invoice_ref: 'Supplier invoice number', issued_at: 'Invoice issued',
    decision: 'Decision', minutes: 'Minutes worked', activity: 'Activity', operator_minutes: 'Operator minutes', touchpoints: 'Touchpoints (human steps)',
    evidence_requests: 'Evidence requests', decision_hours: 'Hours from request to decision', deadline_met: 'Deadline met', outcome: 'Outcome', source_note: 'Where these numbers come from',
    provenance: 'Provenance of these numbers'
  };
  // Required unless the server's param descriptor says otherwise; everything else is optional and the server
  // reports any field it needs.
  var REQUIRED = { amount: 1, currency: 1, reason: 1, text: 1, what: 1, external_ref: 1, bank_ref: 1, user_id: 1, repayment_id: 1,
    item_id: 1, match_id: 1, event_id: 1, disposition: 1, route: 1, status: 1, kind: 1, resolution: 1, decision: 1, minutes: 1, activity: 1, source_note: 1 };
  // Which params matter for the current choice (others are hidden and not sent).
  var OBS_SOURCE = ['issuer', 'record_ref', 'scope'];
  var OBS_FIELDS = {
    invoice: ['amount', 'currency', 'invoice_ref', 'issued_at', 'issuer', 'record_ref', 'scope', 'evidence_id'],
    balance: ['amount', 'currency', 'as_of', 'source', 'evidence_id'].concat(OBS_SOURCE),
    commitment: ['amount', 'currency', 'due_at', 'description', 'evidence_id'].concat(OBS_SOURCE),
    cash_support: ['amount', 'currency', 'effective_at', 'document_ref', 'evidence_id'].concat(OBS_SOURCE),
    expected_receipt: ['amount', 'currency', 'expected_at', 'payer', 'evidence_id'].concat(OBS_SOURCE),
    terms: ['later_permitted', 'contract_ref', 'evidence_id'].concat(OBS_SOURCE)
  };
  var OBS_KINDS = ['invoice', 'balance', 'commitment', 'cash_support', 'expected_receipt', 'terms'];
  var OBS_ALL = ['kind', 'amount', 'currency', 'invoice_ref', 'issued_at', 'as_of', 'source', 'due_at', 'description', 'effective_at', 'document_ref', 'expected_at', 'payer', 'issuer', 'record_ref', 'scope'];
  var RELEVANT = {
    add_observation: function (name, vals) { return name === 'kind' || (OBS_FIELDS[vals.kind] || []).indexOf(name) >= 0; },
    supersede_observation: function (name, vals) {
      if (name === 'event_id' || name === 'reason') return true;
      if (name === 'kind') return false;      // a correction keeps the kind of the record it corrects
      var o = arr(S.view && S.view.observations).filter(function (x) { return String(x.event_id) === String(vals.event_id); })[0];
      return (OBS_FIELDS[o ? o.kind : 'balance'] || []).indexOf(name) >= 0;
    },
    instruct_payout: function (name, vals) {
      if (name === 'external_ref' || name === 'evidence_id') return vals.route !== 'sandbox';
      if (name === 'scenario') return vals.route === 'sandbox';
      return true;
    }
  };
  var SCENARIOS = ['normal', 'timeout_then_accept', 'fail', 'return', 'duplicate_events', 'out_of_order'];
  var CONSEQUENCE = {
    request_advance: 'Asks a reviewer to approve route C (provider advance). A snapshot of the route assessment and evidence is stored. Nothing is reserved yet.',
    approve_and_reserve: 'Reserves facility capacity for the funding amount. Capacity is held, not drawn: nothing is owed until a draw is recorded. The reservation expires if not drawn.',
    decline: 'Declines the advance. Nothing is reserved; the case returns to the operator.',
    request_evidence: 'Returns the case to the operator to add the evidence named. Nothing is reserved.',
    release_reservation: 'Releases the reserved capacity back to the facility. Nothing was drawn.',
    authorize_draw: 'Authorises a draw on a suspended facility under its referral policy.',
    record_draw: 'Records the draw on the facility. From now on principal and fees are owed to the provider.',
    record_prefunding: 'Records the importer\u2019s own funds received by the provider. Must equal the funding amount.',
    instruct_payout: 'Records one payout attempt with this reference. This does not mean the supplier is paid: delivery stays "instructed" until acceptance or credit is evidenced.',
    record_delivery: 'Records delivery evidence. Accepted is not credited; credited is final.',
    query_payout_status: 'Asks the sandbox connector for the status of the existing payout. Never re-submits.',
    record_customer_receipt: 'Records money the importer received from its own customer. This never reduces what is owed to the provider.',
    record_repayment: 'Records money received by the provider as an unallocated item. It reduces nothing until matched.',
    match_repayment: 'Allocates the repayment under the facility rule (fees first by default). Other currency or excess stays unmatched.',
    return_unmatched: 'Returns the unmatched amount to the payer. This never reduces what is owed.',
    reverse_match: 'Reverses the match; amounts owed are restored.',
    close_case: 'Closes the case. Only allowed when the supplier is credited and nothing is owed or unmatched.',
    close_with_exception: 'Closes with an exception. Amounts still owed stay on record and are shown.',
    authorize_reinstruction: 'Allows one new payout attempt after a failed or returned payout.',
    select_route: 'Selects route A or B — the importer\u2019s own money. No provider capacity is used.',
    add_note: 'Adds a note to the case history.',
    assign_owner: 'Hands the case to another user. The hand-off and note are recorded in the history.',
    add_observation: 'Records an observation. Operator-entered unless an evidence file is linked.',
    supersede_observation: 'Records a correction. The old record stays, struck through.',
    resolve_duplicate: 'Resolves a possible duplicate repayment.',
    resolve_duplicate_check: 'Records your judgment on the potential duplicate case. "Not a duplicate" lets the operator request an advance; "Duplicate" means this case can only be closed with exception duplicate_case. Your reason is kept in the decision record.',
    declare_default: 'Records a reviewer\u2019s default determination with your reason. Overdue alone is never a default. Amounts owed stay on record.',
    log_work: 'Records minutes of human work on this case, as reported by you. Used only in the pilot report.',
    record_baseline: 'Records how this case would have gone in the provider\u2019s usual process, with where the numbers come from. Used only in the pilot report; it is not a saving.'
  };
  function consequenceFor(a, cv) {
    var base = a.consequence || CONSEQUENCE[a.type] || '';
    var h = cv.header || {};
    if (a.type === 'approve_and_reserve' || a.type === 'record_draw') base += ' Funding amount: ' + moneyText(h.funding) + '.';
    if (a.type === 'instruct_payout') base += ' Payout amount: ' + moneyText(h.payout) + '.';
    return base;
  }
  function normParam(p) {
    if (typeof p === 'string') return { name: p };
    return Object.assign({}, p, { name: p.name || p.key || p.field });
  }
  function deliveryPreset(a) {
    var l = (a.label || '').toLowerCase();
    if (/acceptance|accepted/.test(l)) return 'accepted';
    if (/credit/.test(l)) return 'credited';
    if (/failure|failed/.test(l)) return 'failed';
    if (/return/.test(l)) return 'returned';
    if (/unknown/.test(l)) return 'unknown';
    return null;
  }
  function defaultCurrency(a, cv) {
    var h = cv.header || {};
    var src = a.type === 'instruct_payout' ? h.payout : h.funding;
    var m = /([A-Z]{3})/.exec(moneyText(src));
    return m ? m[1] : 'SGD';
  }
  function selectOf(name, id, options, def, allowNone) {
    var s = el('select', { name: name, id: id });
    if (options.length && options.every(function (o) { return typeof o.value === 'number'; })) s.setAttribute('data-num', '1');
    if (allowNone) s.appendChild(el('option', { value: '', text: allowNone }));
    options.forEach(function (o) { s.appendChild(el('option', { value: o.value, selected: String(o.value) === String(def) ? true : null, text: o.label })); });
    return s;
  }
  function loadUsers() {
    if (S.users) return Promise.resolve(S.users);
    return api('GET', '/api/users').then(function (r) { S.users = Array.isArray(r) ? r : arr(r && r.users); return S.users; }, function () { S.users = []; return S.users; });
  }

  function paramControl(p, a, cv, preset) {
    var name = p.name;
    var kind = p.kind || p.type || PARAM_KIND[name] || 'text';
    var id = 'cmd-' + name;
    var label = p.label || PARAM_LABEL[name] || humanize(name);
    var required = p.required !== undefined ? !!p.required : !!REQUIRED[name];
    if (a.type === 'instruct_payout' && name === 'external_ref') required = true;
    var def = preset && preset[name] !== undefined ? preset[name] : (p.value !== undefined ? p.value : p.default);
    if (def === undefined && name === 'invoice_ref' && cv.header) def = cv.header.invoice_ref || undefined;
    var opts = arr(p.options).map(function (o) { return typeof o === 'object' ? { value: o.value !== undefined ? o.value : o.id, label: o.label || o.name || String(o.value || o.id) } : { value: o, label: humanize(o) }; });
    var c;
    if (p.fixed || (preset && preset[name] !== undefined)) {
      return { node: el('p', { class: 'preset small', 'data-param': name }, [el('span', { class: 'muted', text: label + ': ' }), el('strong', { text: humanize(def) }),
        el('input', { type: 'hidden', name: name, id: id, value: def })]), kind: 'hidden' };
    }
    if (name === 'scenario') {
      c = selectOf(name, id, SCENARIOS.map(function (x) { return { value: x, label: humanize(x) }; }), def || 'normal');
      return { node: field('Sandbox scenario (simulation only)', c), kind: 'select' };
    }
    if (name === 'resolution') {
      c = selectOf(name, id, [{ value: 'not_duplicate', label: 'Not a duplicate — count it' }, { value: 'duplicate', label: 'Duplicate — hold as unmatched' }], def);
      return { node: field(label, c), kind: 'select' };
    }
    if (opts.length) { c = selectOf(name, id, opts, def, required ? null : 'None'); return { node: field(label, c, p.hint), kind: 'select' }; }
    switch (kind) {
      case 'amount':
        c = el('input', { type: 'text', name: name, id: id, inputmode: 'decimal', autocomplete: 'off', required: required ? true : null, placeholder: '0.00', value: def || null });
        return { node: field(label, c, 'As written, e.g. 30,000.00 — the server parses it', { optional: !required }), kind: kind };
      case 'currency':
        c = selectOf(name, id, CURRENCIES.map(function (x) { return { value: x, label: x }; }), def || defaultCurrency(a, cv));
        return { node: field(label, c), kind: kind };
      case 'time': case 'datetime': {
        var tz = el('input', { type: 'text', name: name + '__tz', id: id + '-tz', list: 'pd-zones', value: (cv.header && cv.header.deadline_tz) || 'UTC', autocomplete: 'off', spellcheck: 'false' });
        zoneDatalist();
        c = el('input', { type: 'datetime-local', name: name, id: id, required: required ? true : null });
        return { node: el('div', { class: 'field-pair' }, [field(label + ' (local)', c, required ? null : 'Leave blank for now (server time)', { optional: !required }), field('Time zone', tz)]), kind: 'time' };
      }
      case 'textarea':
        c = el('textarea', { name: name, id: id, rows: '2', required: required ? true : null });
        if (def) c.value = def;
        return { node: field(label, c, null, { optional: !required, wide: true }), kind: kind };
      case 'bool':
        c = el('input', { type: 'checkbox', name: name, id: id, checked: def ? true : null });
        return { node: el('div', { class: 'field field-check' }, [c, el('label', { for: id, text: label })]), kind: 'bool' };
      case 'evidence':
        c = selectOf(name, id, arr(cv.evidence).filter(function (e) { return !e.superseded; }).map(function (e) { return { value: e.id, label: e.id + ' — ' + text(pick(e, 'filename', 'summary', 'label', 'kind')) }; }), def, required ? null : 'No evidence file');
        return { node: field(label, c, 'Linking a file makes the record an external record', { optional: !required }), kind: kind };
      case 'repayment':
        c = selectOf(name, id, arr(cv.collections && cv.collections.repayments).map(function (r) { return { value: r.id, label: show(r.bank_ref) + ' — ' + moneyText(r.amount) + ' (' + humanize(r.status) + ')' }; }), def || firstUnallocated(cv));
        return { node: field(label, c), kind: kind };
      case 'unmatched':
        c = selectOf(name, id, arr(cv.collections && cv.collections.unmatched).map(function (u) { return { value: u.id, label: moneyText(u.amount) + ' — ' + text(u.reason || u.kind || u.status) }; }), def);
        return { node: field(label, c), kind: kind };
      case 'route': {
        var ro = a.type === 'instruct_payout' ? [{ value: 'manual', label: 'Manual (external bank)' }, { value: 'sandbox', label: 'Sandbox connector — not a live payment' }] : [{ value: 'A', label: 'A — original window' }, { value: 'B', label: 'B — later window' }];
        c = selectOf(name, id, ro, def);
        return { node: field(label, c), kind: 'select' };
      }
      case 'delivery_status':
        c = selectOf(name, id, ['accepted', 'credited', 'failed', 'returned', 'unknown'].map(function (x) { return { value: x, label: humanize(x) }; }), def || deliveryPreset(a));
        return { node: field(label, c), kind: 'select' };
      case 'disposition':
        c = selectOf(name, id, ['write_off_referred', 'supplier_paid_outside', 'cancelled_before_payout', 'duplicate_case'].map(function (x) { return { value: x, label: humanize(x) }; }), def);
        return { node: field(label, c), kind: 'select' };
      case 'obs_kind':
        c = selectOf(name, id, OBS_KINDS.map(function (x) { return { value: x, label: x === 'invoice' ? 'Invoice (supplier invoice)' : humanize(x) }; }), def || 'balance');
        return { node: field(label, c), kind: 'select' };
      case 'scope':
        c = selectOf(name, id, [{ value: 'case', label: 'This case' }, { value: 'importer', label: 'The importer (all its cases)' }], def || 'case');
        return { node: field(label, c), kind: 'select' };
      case 'dup_decision':
        c = selectOf(name, id, [{ value: 'not_duplicate', label: 'Not a duplicate — the advance may be requested' }, { value: 'duplicate', label: 'Duplicate — close only with exception' }], def);
        return { node: field(label, c), kind: 'select' };
      case 'provenance':
        if (a.type === 'record_baseline') {
          c = selectOf(name, id, [{ value: 'recorded', label: 'Recorded — from the provider\u2019s own records' }, { value: 'estimated', label: 'Estimated — someone\u2019s estimate' }, { value: 'synthetic', label: 'Synthetic — made up for the pilot' }], def);
          return { node: field(label, c, 'Shown next to every baseline number in the report'), kind: 'select' };
        }
        c = el('input', { type: 'text', name: name, id: id, value: def || null });
        return { node: field(label, c, null, { optional: true }), kind: 'text' };
      case 'number':
        c = el('input', { type: 'text', name: name, id: id, inputmode: 'decimal', autocomplete: 'off', required: required ? true : null, value: def || null, 'data-number': '1' });
        return { node: field(label, c, null, { optional: !required }), kind: 'number' };
      case 'tristate':
        c = selectOf(name, id, [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], def === undefined ? '' : String(def), 'Not known');
        return { node: field(label, c, null, { optional: true }), kind: 'tristate' };
      case 'user': {
        c = el('select', { name: name, id: id, required: true }, el('option', { value: '', text: 'Loading users…' }));
        loadUsers().then(function (us) {
          if (!us.length) {
            var t = el('input', { type: 'text', name: name, id: id, required: true, placeholder: 'User id' });
            c.replaceWith(t); return;
          }
          c.replaceChildren(el('option', { value: '', text: 'Choose a user' }));
          if (us.every(function (u) { return typeof u.id === 'number'; })) c.setAttribute('data-num', '1');
          us.forEach(function (u) { c.appendChild(el('option', { value: u.id, text: show(u.name) + ' (' + show(u.role) + ')' })); });
        });
        return { node: field(label, c), kind: 'select' };
      }
      case 'event':
        c = selectOf(name, id, observationChoices(cv), def);
        return { node: field(label, c), kind: 'select' };
      default:
        c = el('input', { type: 'text', name: name, id: id, required: required ? true : null, autocomplete: 'off', value: def || null });
        return { node: field(label, c, null, { optional: !required }), kind: 'text' };
    }
  }
  function observationChoices(cv) {
    var out = [];
    arr(cv.observations).forEach(function (o) { if (!o.superseded_by) out.push({ value: o.event_id || o.id, label: text(pick(o, 'text', 'summary', 'label', 'kind')) }); });
    if (!out.length) arr(cv.timeline).forEach(function (t) {
      if (/observation/.test(t.type || '') && !t.superseded && !t.superseded_by) out.push({ value: t.event_id || t.id, label: '#' + show(t.seq) + ' ' + text(pick(t, 'text', 'summary', 'label')) });
    });
    return out;
  }
  function firstUnallocated(cv) {
    var r = arr(cv.collections && cv.collections.repayments).filter(function (x) { return /unallocated|received|pending/.test(x.status || ''); })[0];
    return r ? r.id : undefined;
  }

  // Opens the command dialog. The idempotency key is made once per opening and reused on retry.
  function openCommand(a, opener, preset, onDone) {
    var cv = S.view;
    var dlg = $('pd-dialog');
    var form = $('pd-dialog-form');
    var fieldsBox = $('pd-dialog-fields');
    var errBox = $('pd-dialog-error');
    var confirm = $('pd-dialog-confirm');
    $('pd-dialog-title').textContent = a.label;
    var rt = $('pd-dialog-role'); rt.textContent = roleText(a); rt.className = 'pd-role role-' + (a.role || '');
    $('pd-dialog-consequence').textContent = consequenceFor(a, cv);
    fieldsBox.replaceChildren(); errBox.hidden = true; errBox.textContent = '';
    preset = Object.assign({}, a.preset || {}, preset || {});
    var params = [];
    arr(a.params).map(normParam).forEach(function (p) {
      if (!p.name) return;
      if (/^\.\.\./.test(p.name)) {   // "...replacement fields": the observation fields
        OBS_ALL.forEach(function (n) {
          if (!params.some(function (q) { return q.name === n; })) params.push({ name: n, required: n === 'kind' });
        });
        return;
      }
      params.push(p);
    });
    if (a.type === 'add_observation' || a.type === 'supersede_observation') {
      // §13.3 source fields and the invoice kind, even if the server's descriptor predates them
      OBS_ALL.forEach(function (n) {
        if (n === 'kind' && a.type === 'supersede_observation') return;
        if (params.some(function (q) { return q.name === n; })) return;
        var ei = -1; params.forEach(function (q, i) { if (q.name === 'evidence_id') ei = i; });
        if (ei >= 0) params.splice(ei, 0, { name: n }); else params.push({ name: n });
      });
    }
    if (a.type === 'log_work' && preset.provenance === undefined && !params.some(function (q) { return q.name === 'provenance'; })) preset.provenance = 'operator_reported';
    Object.keys(preset).forEach(function (k) { if (!params.some(function (q) { return q.name === k; })) params.push({ name: k, fixed: true }); });
    var controls = params.map(function (p) {
      var c = paramControl(p, a, cv, preset);
      c.node.setAttribute('data-param-wrap', p.name);
      fieldsBox.appendChild(c.node);
      return { p: p, kind: c.kind, node: c.node };
    });
    var rel = RELEVANT[a.type];
    var applyRel = function () {
      if (!rel) return;
      var vals = {};
      controls.forEach(function (c) { var n = form.elements[c.p.name]; if (n && n.value !== undefined) vals[c.p.name] = n.value; });
      controls.forEach(function (c) { c.off = !rel(c.p.name, vals); c.node.hidden = c.off; });
    };
    applyRel();
    fieldsBox.onchange = applyRel;
    if (!params.length) fieldsBox.appendChild(el('p', { class: 'muted small', text: 'No details needed.' }));
    confirm.textContent = 'Confirm: ' + a.label;
    confirm.disabled = false;
    confirm.setAttribute('data-action', a.type);
    S.dialog = { action: a, opener: opener, key: uuid(), keyBody: null, controls: controls, version: cv.version, preset: preset, onDone: onDone || null };
    dlg.showModal();
    var first = fieldsBox.querySelector('input:not([type=hidden]), select, textarea');
    (first || confirm).focus();
  }
  function closeDialog() {
    var dlg = $('pd-dialog');
    if (dlg.open) dlg.close();
  }
  function collectParams(form, controls, errBox) {
    var body = {}; var bad = false;
    clearFieldErrors(form);
    controls.forEach(function (c) {
      var name = c.p.name;
      if (c.off) return;
      if (c.kind === 'hidden' && S.dialog && S.dialog.preset[name] !== undefined) { body[name] = S.dialog.preset[name]; return; }
      var n = form.elements[name];
      if (!n) return;
      if (c.kind === 'bool') { body[name] = !!n.checked; return; }
      if (c.kind === 'tristate') { if (n.value === 'true') body[name] = true; else if (n.value === 'false') body[name] = false; return; }
      if (c.kind === 'number') {
        var nv = (n.value || '').trim();
        if (!nv) { if (n.required) { setFieldError(form, name, 'Required.'); bad = true; } return; }
        body[name] = /^\d+(\.\d+)?$/.test(nv) ? Number(nv) : nv;   // a count or duration, never money
        return;
      }
      var val = (n.value || '').trim();
      if (c.kind === 'time') {
        if (!val) { if (n.required) { setFieldError(form, name, 'Enter a time.'); bad = true; } return; }
        var tz = (form.elements[name + '__tz'].value || '').trim();
        if (!validZone(tz)) { setFieldError(form, name + '__tz', 'Enter an IANA time zone such as Asia/Singapore.'); bad = true; return; }
        body[name] = zonedToUtc(val, tz);
        return;
      }
      if (!val) { if (n.required) { setFieldError(form, name, 'Required.'); bad = true; } return; }
      body[name] = n.getAttribute && n.getAttribute('data-num') && /^-?\d+$/.test(val) ? Number(val) : val;
    });
    if (bad) { errBox.textContent = 'Fix the highlighted fields.'; errBox.hidden = false; var f = form.querySelector('[aria-invalid="true"]'); if (f) f.focus(); }
    return bad ? null : body;
  }
  function submitCommand(e) {
    e.preventDefault();
    var d = S.dialog; if (!d) return;
    var form = $('pd-dialog-form'); var errBox = $('pd-dialog-error'); var confirm = $('pd-dialog-confirm');
    if (confirm.disabled) return;          // double-click guard: one request in flight
    errBox.hidden = true;
    var params = collectParams(form, d.controls, errBox);
    if (!params) return;
    Object.keys(d.preset).forEach(function (k) { if (params[k] === undefined) params[k] = d.preset[k]; });
    var sig = JSON.stringify(params);
    if (d.keyBody !== null && d.keyBody !== sig) d.key = uuid();   // changed body = a different command
    d.keyBody = sig;
    var body = Object.assign({ type: d.action.type }, params, { idempotency_key: d.key, expected_version: d.version });
    confirm.disabled = true; confirm.setAttribute('aria-busy', 'true');
    status('Sending ' + d.action.label + '…');
    // Actions that name their own endpoint (the sandbox driver) are posted there; everything else is a command.
    var url = (d.action.endpoint && /^\/api\/cases\/[^/]+\/sandbox\/advance$/.test(d.action.endpoint)) ? d.action.endpoint
      : '/api/cases/' + encodeURIComponent(S.view.id) + '/commands';
    api('POST', url, body).then(function (res) {
      confirm.removeAttribute('aria-busy');
      S.dialog = null; closeDialog();
      var cv = res && (res.case_view || (res.id && res.version !== undefined ? res : null));
      var msg = d.action.label + ' recorded.';
      if (d.onDone) { if (cv) S.view = cv; d.onDone(msg); return; }
      if (cv) { S.view = cv; paintCase(cv, null, true); status(msg); focusAfterCommand(); }
      else reloadCase(msg).then(focusAfterCommand);
    }).catch(function (err) {
      confirm.removeAttribute('aria-busy');
      if (err.code === 'stale_version' && d.onDone) {
        S.dialog = null; closeDialog(); d.onDone('Case changed since you loaded it — reloaded'); alertMsg('Case changed since you loaded it — reloaded. Check and try again.', 'warn'); return;
      }
      if (err.code === 'stale_version') {
        S.dialog = null; closeDialog();
        reloadCase(null).then(function () { alertMsg('Case changed since you loaded it — reloaded. Check the case and try again.', 'warn'); status('Case changed since you loaded it — reloaded'); focusAfterCommand(); });
        return;
      }
      confirm.disabled = false;
      var rest = applyFieldErrors(form, err, null);
      errBox.replaceChildren(el('p', { class: 'err-code', text: err.code === 'insufficient_capacity' ? 'Insufficient capacity' : (err.code === 'forbidden' ? 'Not permitted' : '') }), el('p', { text: err.message }), rest.length > 1 ? el('ul', null, rest.map(function (m) { return el('li', { text: m }); })) : null);
      errBox.hidden = false;
      status('');
      if (!form.querySelector('[aria-invalid="true"]')) confirm.focus();
    });
  }
  function focusAfterCommand() {
    var h = $('decision-h');
    if (h) h.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    $('pd-signout').addEventListener('click', signOut);
    $('pd-dialog-form').addEventListener('submit', submitCommand);
    $('pd-dialog-cancel').addEventListener('click', function () { S.dialog = null; closeDialog(); });
    $('pd-dialog').addEventListener('close', function () {
      var opener = S.dialog ? S.dialog.opener : (lastOpener || null);
      S.dialog = null;
      if (opener && document.body.contains(opener)) opener.focus();
    });
    $('pd-dialog').addEventListener('cancel', function () { status('Cancelled.'); });
    window.addEventListener('hashchange', route);
    loadMe().then(route);
  }
  var lastOpener = null;
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('button'); if (b && b.closest('#main')) lastOpener = b; }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
