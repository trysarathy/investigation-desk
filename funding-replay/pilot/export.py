"""Case history export (DATA module; standard library only; pure).

``render_case_history(case_view, events, fmt)`` -> ``(bytes, content_type, filename)``
for ``fmt`` in ``json`` | ``csv`` | ``html``.

* ``case_view`` is the §9 read model (``GET /api/cases/{id}``).
* ``events`` are event-log rows (``id, seq, type, payload, effective_at, known_at,
  actor_user_id, actor_name | actor{name, role}, actor_role, provenance, reason,
  corrects_event_id``); unknown keys are tolerated.

Secrets never leave through an export: password hashes, session tokens, CSRF tokens,
cookies and evidence bytes are stripped at any depth; evidence is listed by
filename, type, size and sha256 only.  The HTML page is self-contained and
printable, has no scripts, and escapes every value.
"""

import csv
import html
import io
import json
import re

__all__ = ["render_case_history", "sanitize", "FORBIDDEN_KEYS"]

FORBIDDEN_KEYS = frozenset({
    "password", "password_hash", "token", "token_hash", "session", "session_token", "sessions",
    "csrf", "csrf_token", "cookie", "cookies", "secret", "data", "bytes", "blob", "content",
})
SANDBOX_LABEL = "Sandbox — not a live payment"

CSV_COLUMNS = (
    "case_id", "event_id", "seq", "type", "effective_at", "known_at", "actor_name", "actor_role",
    "provenance", "reason", "corrects_event_id", "corrects_seq", "corrected_by_seq", "payload",
)

_CONTENT_TYPES = {
    "json": "application/json; charset=utf-8",
    "csv": "text/csv; charset=utf-8",
    "html": "text/html; charset=utf-8",
}


def sanitize(value):
    """Deep copy without secret-bearing keys or raw bytes."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if str(k).lower() in FORBIDDEN_KEYS:
                continue
            if isinstance(v, (bytes, bytearray, memoryview)):
                continue
            out[k] = sanitize(v)
        return out
    if isinstance(value, (list, tuple)):
        return [sanitize(v) for v in value if not isinstance(v, (bytes, bytearray, memoryview))]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return None
    return value


def _payload(ev):
    p = ev.get("payload")
    if isinstance(p, (str, bytes)):
        try:
            p = json.loads(p)
        except ValueError:
            return {"text": p if isinstance(p, str) else ""}
    return sanitize(p) if p is not None else {}


def _actor(ev):
    a = ev.get("actor")
    name = ev.get("actor_name")
    role = ev.get("actor_role")
    if isinstance(a, dict):
        name = name or a.get("name")
        role = role or a.get("role")
    elif isinstance(a, str) and not name:
        name = a
    if not name:
        name = "System" if (ev.get("provenance") == "system" or not ev.get("actor_user_id")) else \
            "User %s" % ev.get("actor_user_id")
    return str(name), str(role or "")


def _fmt(v):
    """Display a money-ish or plain value as text."""
    if v is None:
        return ""
    if isinstance(v, dict):
        if "display" in v:
            return str(v["display"])
        if "amount_minor" in v and "currency" in v:
            return "%s %s minor units" % (v["currency"], v["amount_minor"])
        if "amount" in v and "currency" in v:
            return "%s %s" % (v["currency"], v["amount"])
        if "label" in v:
            return str(v["label"])
        return ", ".join("%s: %s" % (k, _fmt(x)) for k, x in v.items())
    if isinstance(v, (list, tuple)):
        return ", ".join(_fmt(x) for x in v)
    if isinstance(v, bool):
        return "yes" if v else "no"
    return str(v)


def _norm_events(events):
    evs = [dict(e) for e in (events or [])]
    evs.sort(key=lambda e: (e.get("seq") is None, e.get("seq") or 0))
    by_id = {e.get("id"): e for e in evs if e.get("id") is not None}
    corrected_by = {}
    for e in evs:
        c = e.get("corrects_event_id")
        if c is not None:
            corrected_by.setdefault(c, []).append(e)
    out = []
    for e in evs:
        name, role = _actor(e)
        target = by_id.get(e.get("corrects_event_id"))
        out.append({
            "id": e.get("id"),
            "seq": e.get("seq"),
            "type": e.get("type"),
            "effective_at": e.get("effective_at"),
            "known_at": e.get("known_at"),
            "actor_name": name,
            "actor_role": role,
            "provenance": e.get("provenance"),
            "reason": e.get("reason"),
            "corrects_event_id": e.get("corrects_event_id"),
            "corrects_seq": target.get("seq") if target else None,
            "corrected_by_seq": [x.get("seq") for x in corrected_by.get(e.get("id"), [])],
            "payload": _payload(e),
        })
    return out


def _case_id(case_view):
    return str((case_view or {}).get("id") or "case")


def _filename(case_id, ext):
    safe = re.sub(r"[^A-Za-z0-9-]", "_", case_id)[:64] or "case"
    return "%s-history.%s" % (safe, ext)


def _evidence_list(case_view):
    out = []
    for ev in (case_view or {}).get("evidence") or []:
        if not isinstance(ev, dict):
            continue
        out.append({k: ev.get(k) for k in ("id", "filename", "content_type", "size", "sha256", "provenance",
                                           "known_at", "event_id") if k in ev})
    return out


def _json(case_view, events):
    cv = sanitize(case_view or {})
    if "evidence" in cv:
        cv["evidence"] = _evidence_list(case_view)
    doc = {
        "case_id": _case_id(case_view),
        "note": "Synthetic pilot record. Items with provenance sandbox_simulation are '%s'." % SANDBOX_LABEL,
        "case": cv,
        "totals": cv.get("exposure_panel"),
        "identities": cv.get("identities"),
        "evidence": _evidence_list(case_view),
        "events": _norm_events(events),
    }
    return json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False).encode("utf-8")


def _cell(v):
    s = v if isinstance(v, str) else ("" if v is None else (json.dumps(v, sort_keys=True, ensure_ascii=False)
                                                            if isinstance(v, (dict, list)) else str(v)))
    # Spreadsheet formula injection guard.
    if s and (s[0] in "=+@\t\r" or (s[0] == "-" and not re.match(r"^-?\d+(\.\d+)?$", s))):
        s = "'" + s
    return s


def _csv(case_view, events):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(CSV_COLUMNS)
    cid = _case_id(case_view)
    for e in _norm_events(events):
        w.writerow([_cell(x) for x in (
            cid, e["id"], e["seq"], e["type"], e["effective_at"], e["known_at"], e["actor_name"], e["actor_role"],
            e["provenance"], e["reason"], e["corrects_event_id"], e["corrects_seq"],
            " ".join(str(s) for s in e["corrected_by_seq"]), e["payload"],
        )])
    return buf.getvalue().encode("utf-8")


_CSS = """
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24;background:#fff;margin:24px;max-width:1100px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #ccd;padding-bottom:4px}
.note{color:#555;font-size:12px}.sandbox{display:inline-block;border:1px solid #b26b00;color:#7a4a00;padding:0 6px;border-radius:3px;font-size:11px}
table{border-collapse:collapse;width:100%;margin:4px 0}th,td{border:1px solid #d5d8de;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f2f4f7;font-weight:600}td.k{width:220px;color:#444}.struck{text-decoration:line-through;color:#777}
.panels{display:flex;gap:16px;flex-wrap:wrap}.panels>section{flex:1 1 320px}.ok{color:#176b2c}.bad{color:#a11}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;word-break:break-word;margin:0}
@media print{body{margin:0}a{color:inherit;text-decoration:none}tr{break-inside:avoid}}
"""


def _e(v):
    return html.escape(_fmt(v), quote=True)


def _kv_table(pairs):
    rows = "".join("<tr><td class=\"k\">%s</td><td>%s</td></tr>" % (html.escape(k), _e(v)) for k, v in pairs)
    return "<table>%s</table>" % rows


def _dict_pairs(d, keys=None):
    d = d or {}
    keys = keys or list(d.keys())
    return [(k.replace("_", " ").capitalize(), d.get(k)) for k in keys if k in d]


def _html(case_view, events):
    cv = sanitize(case_view or {})
    cid = _case_id(case_view)
    header = cv.get("header") or {}
    evs = _norm_events(events)
    corrected = {e["corrects_event_id"] for e in evs if e["corrects_event_id"] is not None}
    parts = []
    parts.append("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">")
    parts.append("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">")
    parts.append("<title>%s — case history</title><style>%s</style></head><body>" % (html.escape(cid), _CSS))
    parts.append("<h1>%s — case history</h1>" % html.escape(cid))
    parts.append("<p class=\"note\">Synthetic pilot record. Status: %s. Version %s. Events marked "
                 "<span class=\"sandbox\">%s</span> are simulations; no money moved.</p>"
                 % (_e(cv.get("status")), _e(cv.get("version")), html.escape(SANDBOX_LABEL)))

    parts.append("<h2>Parties and amounts</h2>")
    parts.append(_kv_table([
        ("Importer", header.get("importer")), ("Supplier", header.get("supplier")),
        ("Payout amount (supplier receives)", header.get("payout")),
        ("Funding amount (to be funded)", header.get("funding")),
        ("Quote reference", header.get("quote_ref")),
        ("Deadline", "%s (%s) — UTC %s" % (_fmt(header.get("deadline_local")), _fmt(header.get("deadline_tz")),
                                                _fmt(header.get("deadline_utc")))),
        ("Owner", header.get("owner")), ("Reference", header.get("reference")),
    ]))

    decision = cv.get("decision") or {}
    if decision:
        parts.append("<h2>Decision</h2>")
        parts.append(_kv_table(_dict_pairs(decision, ["headline", "binding_constraint", "next_action", "owner_role"])))

    parts.append("<div class=\"panels\"><section><h2>Supplier status</h2>")
    parts.append(_kv_table(_dict_pairs(cv.get("supplier_panel"))))
    parts.append("</section><section><h2>Provider exposure</h2>")
    parts.append(_kv_table(_dict_pairs(cv.get("exposure_panel"))))
    parts.append("</section></div>")

    idents = cv.get("identities") or []
    parts.append("<h2>Identities</h2><table><tr><th>Check</th><th>Result</th><th>Detail</th></tr>")
    for i in idents:
        if not isinstance(i, dict):
            continue
        ok = bool(i.get("ok"))
        parts.append("<tr><td>%s</td><td class=\"%s\">%s</td><td>%s</td></tr>"
                     % (_e(i.get("name")), "ok" if ok else "bad", "holds" if ok else "DOES NOT HOLD", _e(i.get("detail"))))
    if not idents:
        parts.append("<tr><td colspan=\"3\">No identities supplied.</td></tr>")
    parts.append("</table>")

    evidence = _evidence_list(case_view)
    parts.append("<h2>Evidence (listed by name and SHA-256; contents not included)</h2>")
    parts.append("<table><tr><th>File</th><th>Type</th><th>Size</th><th>SHA-256</th><th>Provenance</th><th>Known at</th></tr>")
    for ev in evidence:
        parts.append("<tr><td>%s</td><td>%s</td><td>%s</td><td><code>%s</code></td><td>%s</td><td>%s</td></tr>" % (
            _e(ev.get("filename")), _e(ev.get("content_type")), _e(ev.get("size")), _e(ev.get("sha256")),
            _e(ev.get("provenance")), _e(ev.get("known_at"))))
    if not evidence:
        parts.append("<tr><td colspan=\"6\">No evidence files.</td></tr>")
    parts.append("</table>")

    parts.append("<h2>Event history (%d events)</h2>" % len(evs))
    parts.append("<table><tr><th>Seq</th><th>Type</th><th>Effective at</th><th>Known at</th><th>Actor</th>"
                 "<th>Provenance</th><th>Reason</th><th>Corrections</th><th>Details</th></tr>")
    for e in evs:
        anchor = "ev-%s" % re.sub(r"[^A-Za-z0-9_-]", "_", str(e["id"] if e["id"] is not None else e["seq"]))
        struck = " class=\"struck\"" if e["id"] is not None and e["id"] in corrected else ""
        corr = []
        if e["corrects_event_id"] is not None:
            corr.append("Corrects <a href=\"#ev-%s\">#%s</a>" % (
                html.escape(re.sub(r"[^A-Za-z0-9_-]", "_", str(e["corrects_event_id"]))),
                _e(e["corrects_seq"] if e["corrects_seq"] is not None else e["corrects_event_id"])))
        for s in e["corrected_by_seq"]:
            target = next((x for x in evs if x["seq"] == s), None)
            tid = re.sub(r"[^A-Za-z0-9_-]", "_", str(target["id"] if target and target["id"] is not None else s))
            corr.append("Corrected by <a href=\"#ev-%s\">#%s</a>" % (html.escape(tid), _e(s)))
        prov = _e(e["provenance"])
        if e["provenance"] == "sandbox_simulation":
            prov += " <span class=\"sandbox\">%s</span>" % html.escape(SANDBOX_LABEL)
        parts.append("<tr id=\"%s\"%s><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s<br><span class=\"note\">%s</span></td>"
                     "<td>%s</td><td>%s</td><td>%s</td><td><pre>%s</pre></td></tr>" % (
                         html.escape(anchor), struck, _e(e["seq"]), _e(e["type"]), _e(e["effective_at"]),
                         _e(e["known_at"]), _e(e["actor_name"]), _e(e["actor_role"]), prov, _e(e["reason"]),
                         "<br>".join(corr),
                         html.escape(json.dumps(e["payload"], indent=1, sort_keys=True, ensure_ascii=False))))
    if not evs:
        parts.append("<tr><td colspan=\"9\">No events.</td></tr>")
    parts.append("</table>")
    parts.append("<p class=\"note\">Times are UTC ISO-8601. effective_at = when it happened; known_at = when "
                 "Clearline recorded it. Corrected records are struck through, never deleted.</p>")
    parts.append("</body></html>")
    return "".join(parts).encode("utf-8")


def render_case_history(case_view, events, fmt):
    """Render a full case history. Returns ``(bytes, content_type, filename)``."""
    fmt = (fmt or "").lower()
    if fmt not in _CONTENT_TYPES:
        raise ValueError("format must be json, csv or html")
    cid = _case_id(case_view)
    body = {"json": _json, "csv": _csv, "html": _html}[fmt](case_view, events)
    return body, _CONTENT_TYPES[fmt], _filename(cid, fmt)
