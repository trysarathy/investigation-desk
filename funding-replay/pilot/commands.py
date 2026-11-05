"""Command handlers and read models: permissions, idempotency, expected_version, one BEGIN IMMEDIATE tx each."""

import base64
import binascii
import datetime as _dt
import hashlib
import json
import logging
import os
import re
import sqlite3

from . import db, domain
from . import money as M
from .domain import DomainError

log = logging.getLogger("pilot.commands")

MAX_EVIDENCE = 5 * 1024 * 1024
EVIDENCE_TYPES = {"application/pdf": b"%PDF", "image/png": b"\x89PNG\r\n\x1a\n", "image/jpeg": b"\xff\xd8\xff",
                  "text/csv": None, "text/plain": None}
FUTURE_SLACK = _dt.timedelta(minutes=5)
DEV_SECRET = "pilot-dev-sandbox-secret"


class CommandError(Exception):
    def __init__(self, status, code, message, field=None, fields=None, extra=None):
        Exception.__init__(self, message)
        self.status, self.code, self.message, self.field, self.fields = status, code, message, field, fields
        self.extra = extra or {}

    def body(self):
        e = {"code": self.code, "message": self.message}
        if self.field:
            e["field"] = self.field
        if self.fields:
            e["fields"] = self.fields
        b = {"error": e}
        b.update(self.extra)
        return b


def _from_domain(e):
    return CommandError(e.status, e.code, e.message, e.field)


# ---------------------------------------------------------------- config / connector
def env():
    return os.environ.get("PILOT_ENV", "dev")


def sandbox_secret():
    s = os.environ.get("PILOT_SECRET")
    if s:
        return s
    return None if env() == "pilot" else DEV_SECRET


def connector_module():
    try:
        from . import connector  # noqa: WPS433 (lazy: DATA-owned, optional)
        return connector
    except ImportError:
        return None


def connector_status():
    mod = connector_module()
    if mod is None:
        return False, "Sandbox route disabled: the sandbox connector module is not installed."
    if not sandbox_secret():
        return False, "Sandbox route disabled: PILOT_SECRET is not configured."
    return True, None


def make_connector(conn, org_id, scenario="normal"):
    mod = connector_module()
    return mod.SandboxConnector(conn, sandbox_secret(), db.now, org_id=org_id, scenario=scenario)


# ---------------------------------------------------------------- loading
def load_case(conn, org_id, case_id):
    if not isinstance(case_id, str):
        return None
    return db.one(conn, "SELECT * FROM cases WHERE id=? AND org_id=?", (case_id, org_id))


def load_facility(conn, facility_id):
    return db.one(conn, "SELECT * FROM facilities WHERE id=?", (facility_id,)) if facility_id else None


def load_events(conn, case_id):
    out = []
    for r in db.all_rows(conn, "SELECT e.*, u.name AS actor_name FROM events e LEFT JOIN users u "
                               "ON u.id = e.actor_user_id WHERE e.case_id=? ORDER BY e.seq", (case_id,)):
        r["payload"] = json.loads(r["payload"] or "{}")
        out.append(r)
    return out


def build_state(conn, case):
    fac = load_facility(conn, case["facility_id"])
    return domain.fold(case, load_events(conn, case["id"]), fac)


def table_totals(conn, facility_id, exclude_case=None):
    args = [facility_id]
    ex = ""
    if exclude_case:
        ex = " AND case_id<>?"
        args.append(exclude_case)
    res = conn.execute("SELECT IFNULL(SUM(amount_minor),0) FROM reservations WHERE facility_id=? AND status='active'"
                       + ex, args).fetchone()[0]
    out = conn.execute("SELECT IFNULL(SUM(principal_minor - principal_repaid_minor),0) FROM draws WHERE facility_id=?"
                       + ex, args).fetchone()[0]
    return {"reserved": res, "principal_outstanding": out}


def event_totals(conn, fac):
    res = out = 0
    for c in db.all_rows(conn, "SELECT * FROM cases WHERE facility_id=?", (fac["id"],)):
        s = domain.fold(c, load_events(conn, c["id"]), fac)
        res += s.reserved_minor
        out += s.principal_outstanding
    return {"reserved": res, "principal_outstanding": out}


def routes_for(conn, state, now):
    fac = state.facility
    cap = None
    if fac:
        t = table_totals(conn, fac["id"], exclude_case=state.id)
        cap = domain.capacity(fac, t["reserved"], t["principal_outstanding"])
    return domain.mark_selected(state, domain.assess(state, fac, cap, now))


def users_map(conn, org_id):
    return {u["id"]: u for u in db.all_rows(conn, "SELECT id, name, email, role, disabled FROM users WHERE org_id=?",
                                            (org_id,))}


# ---------------------------------------------------------------- writes
def append_event(conn, case, etype, payload, actor, provenance, effective_at=None, reason=None, corrects=None,
                 idem=None):
    now = db.now_iso()
    seq = conn.execute("SELECT IFNULL(MAX(seq),0)+1 FROM events WHERE case_id=?", (case["id"],)).fetchone()[0]
    cur = conn.execute(
        "INSERT INTO events(org_id, case_id, seq, type, payload, effective_at, known_at, actor_user_id, actor_role, "
        "provenance, reason, corrects_event_id, idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (case["org_id"], case["id"], seq, etype, json.dumps(payload, sort_keys=True), effective_at or now, now,
         actor["id"] if actor else None, actor["role"] if actor else "system", provenance, reason, corrects, idem))
    log.info("event case=%s seq=%d type=%s", case["id"], seq, etype)
    return cur.lastrowid, seq


def next_seq(conn, case_id):
    return conn.execute("SELECT IFNULL(MAX(seq),0)+1 FROM events WHERE case_id=?", (case_id,)).fetchone()[0]


def _finish_case(conn, case, now):
    """Bump version, refresh status/owner, sync payout statuses, check identities (rollback on failure)."""
    case = db.one(conn, "SELECT * FROM cases WHERE id=?", (case["id"],))
    st = build_state(conn, case)
    for po in st.payouts:
        conn.execute("UPDATE payouts SET status=?, provider_ref=COALESCE(?, provider_ref) WHERE case_id=? AND attempt=?",
                     (po["status"], po.get("provider_ref"), case["id"], po["attempt"]))
    conn.execute("UPDATE cases SET version=version+1, status=?, owner_user_id=? WHERE id=?",
                 (domain.status_key(st, now), st.owner_user_id, case["id"]))
    check_identities(conn, st)
    return db.one(conn, "SELECT * FROM cases WHERE id=?", (case["id"],)), st


def check_identities(conn, st):
    draw_row = db.one(conn, "SELECT * FROM draws WHERE case_id=?", (st.id,))
    bad = [i for i in domain.case_identities(st, draw_row) if not i["ok"]]
    if st.facility:
        fi = domain.facility_identity(st.facility, table_totals(conn, st.facility["id"]), event_totals(conn, st.facility))
        if not fi["ok"]:
            bad.append(fi)
    if bad:
        log.error("identity violation case=%s identities=%s", st.id, [b["name"] for b in bad])
        raise CommandError(500, "identity_violation", "An accounting identity would break; nothing was saved.")


def sweep_case(conn, case, now):
    """Expire this case's active reservation if past expiry (lazy). Caller holds the tx."""
    rows = db.all_rows(conn, "SELECT * FROM reservations WHERE case_id=? AND status='active' AND expires_at<=?",
                       (case["id"], db.iso(now)))
    for r in rows:
        conn.execute("UPDATE reservations SET status='expired' WHERE id=?", (r["id"],))
        append_event(conn, case, "reservation_expired", {"reservation_id": r["id"], "expires_at": r["expires_at"]},
                     None, "system", effective_at=r["expires_at"])
        _finish_case(conn, case, now)
    return bool(rows)


def sweep_facility(conn, facility_id, now):
    ids = [r[0] for r in conn.execute("SELECT DISTINCT case_id FROM reservations WHERE facility_id=? AND "
                                      "status='active' AND expires_at<=?", (facility_id, db.iso(now)))]
    for cid in ids:
        sweep_case(conn, db.one(conn, "SELECT * FROM cases WHERE id=?", (cid,)), now)


def _needs_sweep(conn, case_id, now):
    return conn.execute("SELECT 1 FROM reservations WHERE case_id=? AND status='active' AND expires_at<=?",
                        (case_id, db.iso(now))).fetchone() is not None


# ---------------------------------------------------------------- parameter helpers
def _text(params, field, errors, required=True, maxlen=500):
    v = params.get(field)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            errors.append({"field": field, "message": "Required."})
        return None
    if not isinstance(v, str):
        errors.append({"field": field, "message": "Must be text."})
        return None
    if len(v) > maxlen:
        errors.append({"field": field, "message": "At most %d characters." % maxlen})
        return None
    return v.strip()


def _money(params, errors, amount_field="amount", ccy_field="currency", allow_zero=False):
    ccy = params.get(ccy_field)
    try:
        M.check_currency(ccy)
    except M.MoneyError as e:
        errors.append({"field": ccy_field, "message": str(e)})
        return None
    try:
        return M.parse(params.get(amount_field), ccy, allow_zero=allow_zero)
    except M.MoneyError as e:
        errors.append({"field": amount_field, "message": str(e)})
        return None


def _time(params, field, errors, required=True, now=None, not_future=False):
    v = params.get(field)
    if v is None or v == "":
        if required:
            errors.append({"field": field, "message": "Required (UTC ISO-8601, e.g. 2026-11-18T15:00:00Z)."})
        return None
    try:
        t = db.parse_iso(v)
        if not (2000 <= t.year <= 2100):
            raise ValueError("Time must be between the years 2000 and 2100.")
    except (ValueError, TypeError, OverflowError) as e:
        errors.append({"field": field, "message": str(e) or "Not a valid ISO-8601 time."})
        return None
    if not_future and now is not None and t > now + FUTURE_SLACK:
        errors.append({"field": field, "message": "Cannot be in the future; record it once it has happened."})
        return None
    return t


def _raise_fields(errors):
    if errors:
        if len(errors) == 1:
            raise CommandError(422, "validation_failed", "%s: %s" % (errors[0]["field"], errors[0]["message"]),
                               errors[0]["field"], errors)
        raise CommandError(422, "validation_failed", "%d fields need attention: %s." % (
            len(errors), ", ".join(e["field"] for e in errors)), errors[0]["field"], errors)


def validate_observation(params, now, state=None, allow_evidence=True, prefix=""):
    """Return (payload, effective_at, provenance, errors)."""
    errors = []
    kind = params.get("kind")
    if kind not in domain.OBS_KINDS:
        errors.append({"field": prefix + "kind", "message": "Kind must be one of %s." % ", ".join(domain.OBS_KINDS)})
        return None, None, None, errors
    p = {"kind": kind}
    eff = None
    if kind != "terms":
        m = _money(params, errors)
        if m:
            p["amount_minor"], p["currency"] = m.minor, m.currency
    if kind == "balance":
        eff = _time(params, "as_of", errors, now=now, not_future=True)
        p["source"] = _text(params, "source", errors, maxlen=200)
    elif kind == "commitment":
        eff = _time(params, "due_at", errors)
        p["description"] = _text(params, "description", errors, required=False, maxlen=200) or ""
    elif kind == "cash_support":
        eff = _time(params, "effective_at", errors)
        p["document_ref"] = _text(params, "document_ref", errors, maxlen=200)
    elif kind == "expected_receipt":
        eff = _time(params, "expected_at", errors)
        p["payer"] = _text(params, "payer", errors, required=False, maxlen=200) or "Payer not stated"
    elif kind == "terms":
        lp = params.get("later_permitted")
        if not isinstance(lp, bool):
            errors.append({"field": "later_permitted", "message": "Must be true or false."})
        p["later_permitted"] = bool(lp)
        p["contract_ref"] = _text(params, "contract_ref", errors, maxlen=200)
    elif kind == "invoice":
        eff = _time(params, "issued_at", errors, now=now, not_future=True)
        p["invoice_ref"] = _text(params, "invoice_ref", errors, maxlen=200)
        p["issuer"] = _text(params, "issuer", errors, maxlen=200)
    # §13.3 evidence fields, on every kind: who produced the record, their reference, and its scope.
    if kind != "invoice":
        iss = _text(params, "issuer", errors, required=False, maxlen=200)
        if iss:
            p["issuer"] = iss
    rref = _text(params, "record_ref", errors, required=False, maxlen=200)
    if rref:
        p["record_ref"] = rref
    scope = params.get("scope")
    if scope not in (None, ""):
        if scope not in domain.OBS_SCOPES:
            errors.append({"field": prefix + "scope", "message": "Scope is case (default) or importer."})
        else:
            p["scope"] = scope
    if eff is not None:
        key = domain.KIND_TIME_KEY.get(kind)
        if key:
            p[key] = db.iso(eff)
    if params.get("source") and kind != "balance":
        p["source"] = str(params.get("source"))[:200]
    ev_id = params.get("evidence_id")
    if ev_id:
        if not allow_evidence or state is None or ev_id not in state.evidence:
            errors.append({"field": prefix + "evidence_id", "message": "Evidence %s is not on this case; upload it first." % ev_id})
        else:
            p["evidence_id"] = ev_id
    want = params.get("provenance")
    prov = "external_record" if p.get("evidence_id") else "operator_entered"
    if want not in (None, "", prov):
        if want == "external_record":
            errors.append({"field": prefix + "provenance",
                           "message": "An external record needs a linked evidence file; upload it and pass evidence_id."})
        elif want != "operator_entered":
            errors.append({"field": prefix + "provenance", "message": "Provenance is operator_entered or external_record."})
    if prefix:
        for e in errors:
            if not e["field"].startswith(prefix):
                e["field"] = prefix + e["field"]
    return p, eff, prov, errors


# ---------------------------------------------------------------- idempotency
def _request_hash(scope, body):
    return hashlib.sha256(json.dumps({"scope": scope, "body": body}, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def _idem_lookup(conn, org_id, key, command, rhash):
    row = db.one(conn, "SELECT * FROM idempotency WHERE org_id=? AND key=?", (org_id, key))
    if not row:
        return None
    if row["command"] != command or row["request_hash"] != rhash:
        raise CommandError(409, "idempotency_conflict",
                           "This idempotency key was already used for a different request. Reload and retry with a new key.")
    return row["status_code"], json.loads(row["response"])


def _idem_store(conn, org_id, key, command, rhash, status, response):
    conn.execute("INSERT INTO idempotency(org_id, key, command, request_hash, status_code, response, created_at) "
                 "VALUES (?,?,?,?,?,?,?)", (org_id, key, command, rhash, status, json.dumps(response), db.now_iso()))


def _require_key(body):
    k = body.get("idempotency_key")
    if not isinstance(k, str) or not (8 <= len(k) <= 200):
        raise CommandError(400, "idempotency_key_required",
                           "Every change needs an idempotency_key (a client-generated UUID).", "idempotency_key")
    return k


# ---------------------------------------------------------------- eligibility checkpoints (§13.5)
def trigger_for(cmd):
    if cmd in ("add_observation", "supersede_observation"):
        return "observation"
    if cmd == "add_evidence":
        return "evidence"
    if cmd in domain.REVIEW_COMMANDS:
        return "review"
    return "command"


def clock_checkpoint(conn, case, st, routes, now):
    """If time alone moved a route since the last checkpoint, record that first (trigger 'clock'). Returns before."""
    before = domain.route_snapshot(routes)
    if st.closed or not st.checkpoints:
        return before
    last = st.checkpoints[-1].get("routes_after")
    if last is not None and domain.snapshot_changed(last, before):
        payload = domain.eligibility_payload(st, st.facility, last, routes, "clock", None, now)
        if payload:
            append_event(conn, case, "eligibility_evaluated", payload, None, "system")
    return before


def record_checkpoint(conn, case, before, trigger, now, force=False):
    """Append `eligibility_evaluated` (provenance system) in the caller's tx when any route's status or blockers
    changed (or on intake, force=True). Returns the new state."""
    case = db.one(conn, "SELECT * FROM cases WHERE id=?", (case["id"],))
    st = build_state(conn, case)
    if st.closed:
        return st
    routes = routes_for(conn, st, now)
    payload = domain.eligibility_payload(st, st.facility, None if force else before, routes, trigger,
                                         next_seq(conn, case["id"]) - 1, now)
    if payload:
        append_event(conn, case, "eligibility_evaluated", payload, None, "system")
    return st


# ---------------------------------------------------------------- same-provider duplicate check (§13.7)
def duplicate_matches(conn, case, extra_refs=()):
    """Other cases IN THE SAME ORG with the same normalised invoice_ref + supplier, or same supplier + payout
    amount/currency with deadlines within 30 days. Never searches other orgs."""
    org = case["org_id"]
    sup = domain.norm_ref(case["supplier"])
    refs = {domain.norm_ref(case.get("invoice_ref"))} | {domain.norm_ref(r) for r in extra_refs}
    refs.discard("")
    dl = db.parse_iso(case["deadline_at"])
    other_refs = {}
    for r in db.all_rows(conn, "SELECT case_id, payload FROM events WHERE org_id=? AND case_id<>? AND type IN "
                               "('observation_added','observation_superseded')", (org, case["id"])):
        pl = json.loads(r["payload"] or "{}")
        if pl.get("kind") == "invoice" and pl.get("invoice_ref"):
            other_refs.setdefault(r["case_id"], set()).add(domain.norm_ref(pl["invoice_ref"]))
    out = []
    for o in db.all_rows(conn, "SELECT id, supplier, invoice_ref, payout_minor, payout_currency, deadline_at FROM cases "
                               "WHERE org_id=? AND id<>? ORDER BY id", (org, case["id"])):
        if domain.norm_ref(o["supplier"]) != sup:
            continue
        theirs = {domain.norm_ref(o["invoice_ref"])} | other_refs.get(o["id"], set())
        theirs.discard("")
        why = None
        if refs & theirs:
            why = "same invoice reference and supplier"
        elif (o["payout_minor"] == case["payout_minor"] and o["payout_currency"] == case["payout_currency"]
              and abs(db.parse_iso(o["deadline_at"]) - dl) <= _dt.timedelta(days=30)):
            why = "same supplier and payout amount within 30 days of the deadline"
        if why:
            out.append((o["id"], why))
    return out


def run_duplicate_check(conn, case, user, trigger, extra_refs=()):
    st = build_state(conn, case)
    prev = st.dup_check
    found = duplicate_matches(conn, case, extra_refs)
    ids = [m[0] for m in found]
    if prev and prev["status"] == "duplicate":
        return
    if prev and prev["status"] == "overridden" and set(ids) <= set(prev["matches"]):
        return
    if prev and prev["status"] == trigger_status(ids) and prev["matches"] == ids and trigger != "intake":
        return
    if ids:
        text = "Potential match in this provider's book: %s. A reviewer must resolve the duplicate check." % "; ".join(
            "%s (%s)" % m for m in found)
        status = "potential_match"
    else:
        text, status = domain.NO_MATCH_TEXT, "no_match"
    append_event(conn, case, "duplicate_check_run", {"status": status, "matches": ids, "text": text,
                                                     "reasons": {m[0]: m[1] for m in found}, "trigger": trigger,
                                                     "scope": "this provider's book (same organisation only)"},
                 None, "system")


def trigger_status(ids):
    return "potential_match" if ids else "no_match"


# ---------------------------------------------------------------- command execution
class Ctx(object):
    pass


def execute(conn, user, case_id, body):
    """Run one case command. Returns (status, response_dict). Raises CommandError."""
    if not isinstance(body, dict):
        raise CommandError(400, "bad_request", "Send a JSON object.")
    cmd = body.get("type")
    if not isinstance(cmd, str) or cmd not in HANDLERS:
        raise CommandError(400, "unknown_command", "Unknown command type %r." % (cmd,), "type")
    key = _require_key(body)
    org = user["org_id"]
    if not load_case(conn, org, case_id):
        raise CommandError(404, "not_found", "No such case in your organisation.")
    if not domain.allowed(user["role"], cmd):
        raise CommandError(403, "forbidden", "Your role (%s) cannot %s." % (user["role"], cmd.replace("_", " ")))
    rhash = _request_hash("case:%s" % case_id, body)
    now = db.now()
    with db.tx(conn):
        hit = _idem_lookup(conn, org, key, cmd, rhash)
        if hit:
            return hit[0], dict(hit[1], idempotent_replay=True)
        case = load_case(conn, org, case_id)
        if case is None:
            raise CommandError(404, "not_found", "No such case in your organisation.")
        if sweep_case(conn, case, now):
            case = load_case(conn, org, case_id)
        ev = body.get("expected_version")
        if isinstance(ev, bool) or not isinstance(ev, int):
            raise CommandError(400, "expected_version_required",
                               "Send expected_version (the case version you loaded).", "expected_version")
        if ev != case["version"]:
            raise CommandError(409, "stale_version", "Case changed since you loaded it (now version %d). Reload and "
                               "check before retrying." % case["version"], extra={"current_version": case["version"]})
        c = Ctx()
        c.conn, c.user, c.case, c.now, c.params, c.key = conn, user, case, now, body, key
        c.state = build_state(conn, case)
        c.fac = c.state.facility
        c.routes = routes_for(conn, c.state, now)
        c.connector_ok = connector_status()[0]
        try:
            outcome = domain.precheck(c.state, cmd, body, now, actor=user["id"], routes=c.routes,
                                      connector_ok=c.connector_ok)
            c.outcome = outcome
            before = clock_checkpoint(conn, case, c.state, c.routes, now)
            special = HANDLERS[cmd](c)
        except DomainError as e:
            raise _from_domain(e)
        record_checkpoint(conn, case, before, trigger_for(cmd), now)
        case, st = _finish_case(conn, case, now)
        view = case_view(conn, user, case, st, now)
        status, resp = 200, view
        if special:
            status, resp = special["status"], dict(special["error"], case=view)
        _idem_store(conn, org, key, cmd, rhash, status, resp)
    return status, resp


def _ev(c, etype, payload, provenance="operator_entered", effective_at=None, reason=None, corrects=None):
    return append_event(c.conn, c.case, etype, payload, c.user, provenance, effective_at=effective_at,
                        reason=reason, corrects=corrects, idem=c.key)


def _reason(c, required=True, field="reason"):
    errors = []
    v = _text(c.params, field, errors, required=required, maxlen=1000)
    _raise_fields(errors)
    return v


def h_add_observation(c):
    p, eff, prov, errors = validate_observation(c.params, c.now, c.state)
    _raise_fields(errors)
    _ev(c, "observation_added", p, prov, effective_at=db.iso(eff) if eff else None, reason=c.params.get("reason"))
    if p["kind"] == "invoice":
        run_duplicate_check(c.conn, c.case, c.user, "invoice", [p.get("invoice_ref")])


def h_supersede(c):
    errors = []
    eid = c.params.get("event_id")
    if isinstance(eid, bool) or not isinstance(eid, int):
        errors.append({"field": "event_id", "message": "Give the event id of the observation to correct."})
    reason = _text(c.params, "reason", errors, maxlen=1000)
    _raise_fields(errors)
    old = c.state.observations[eid]
    params = dict(c.params)
    params.setdefault("kind", old["kind"])
    if params["kind"] != old["kind"]:
        raise CommandError(422, "validation_failed", "A correction keeps the same kind (%s)." % old["kind"], "kind")
    p, eff, prov, errors = validate_observation(params, c.now, c.state)
    _raise_fields(errors)
    p["replaces"] = eid
    _ev(c, "observation_superseded", p, prov, effective_at=db.iso(eff) if eff else None, reason=reason, corrects=eid)
    if p["kind"] == "invoice":
        run_duplicate_check(c.conn, c.case, c.user, "invoice", [p.get("invoice_ref")])


def h_select_route(c):
    _ev(c, "route_selected", {"route": c.params["route"]}, reason=c.params.get("reason"))


def h_request_advance(c):
    reason = _reason(c)
    rc = next(r for r in c.routes if r["key"] == "C")
    # Every evidence file and observation on record when the request is made (the reviewer sees the same set).
    ev_ids = sorted(set(sum((r["evidence_ids"] for r in c.routes), [])) | set(c.state.evidence.keys()))
    _ev(c, "advance_requested", {"snapshot": rc, "routes": [{"key": r["key"], "status": r["status"]} for r in c.routes],
                                 "evidence_ids": ev_ids}, reason=reason)


def h_approve(c):
    reason = _reason(c)
    fac = c.fac
    sweep_facility(c.conn, fac["id"], c.now)
    t = table_totals(c.conn, fac["id"])
    cap = domain.capacity(fac, t["reserved"], t["principal_outstanding"])
    need = c.state.funding.minor
    short = []
    if cap["headroom"] < need:
        short.append("facility headroom %s" % domain.mtext(cap["headroom"], fac["currency"]))
    if cap["funding_cash"] < need:
        short.append("provider funding cash %s" % domain.mtext(cap["funding_cash"], fac["currency"]))
    if short:
        raise CommandError(409, "insufficient_capacity", "Insufficient capacity: %s is below the %s needed. Nothing "
                           "was reserved." % (" and ".join(short), c.state.funding), extra={"short": short})
    fv = db.one(c.conn, "SELECT id FROM facility_versions WHERE facility_id=? AND policy_version=?",
                (fac["id"], fac["policy_version"]))
    expires = domain.reservation_expiry(fac, c.case, c.now)
    due = domain.repayment_due(fac, c.case)
    fee = domain.fee_minor(fac, need)
    try:
        cur = c.conn.execute("INSERT INTO reservations(org_id, facility_id, case_id, amount_minor, status, expires_at, "
                             "created_at) VALUES (?,?,?,?, 'active', ?, ?)",
                             (c.case["org_id"], fac["id"], c.case["id"], need, db.iso(expires), db.iso(c.now)))
    except sqlite3.IntegrityError as e:
        if "insufficient_capacity" in str(e):
            raise CommandError(409, "insufficient_capacity", "Insufficient capacity at the database check; nothing was reserved.")
        raise CommandError(409, "already_reserved", "This case already has a reservation.")
    _ev(c, "advance_approved", {"facility_id": fac["id"], "amount_minor": need, "fee_minor": fee, "due_at": db.iso(due),
                                "expires_at": db.iso(expires), "policy_version": fac["policy_version"],
                                "facility_version_id": fv["id"] if fv else None,
                                "required_evidence": domain.required_kinds(fac),
                                "reservation_id": cur.lastrowid, "requested_by": c.state.request["by"],
                                "evidence_ids": sorted(c.state.evidence.keys()),
                                "capacity_before": {"headroom_minor": cap["headroom"],
                                                    "funding_cash_minor": cap["funding_cash"]}}, reason=reason)


def h_decline(c):
    _ev(c, "advance_declined", {}, reason=_reason(c))


def h_request_evidence(c):
    what = _reason(c, field="what")
    _ev(c, "evidence_requested", {"what": what}, reason=what)


def h_release(c):
    reason = _reason(c)
    c.conn.execute("UPDATE reservations SET status='released' WHERE case_id=? AND status='active'", (c.case["id"],))
    _ev(c, "reservation_released", {}, reason=reason)


def h_authorize_draw(c):
    _ev(c, "draw_authorized", {"suspension_policy": c.fac["suspension_policy"]}, reason=_reason(c, required=False))


def h_record_draw(c):
    errors = []
    eff = _time(c.params, "effective_at", errors, required=False, now=c.now, not_future=True) or c.now
    ref = _text(c.params, "reference", errors, maxlen=200)
    _raise_fields(errors)
    if c.outcome == "refer":
        _ev(c, "draw_referred", {"facility_id": c.fac["id"], "suspension_policy": "unset"}, provenance="system",
            reason="Facility suspended; suspension policy unset")
        return {"status": 409, "error": {"error": {"code": "referred", "message":
                "Draw referred to a reviewer: facility %s is suspended and has no suspension policy. A reviewer must "
                "Authorize draw before it can be recorded." % c.fac["id"]}}}
    appr = c.state.approval
    cur = c.conn.execute("UPDATE reservations SET status='consumed' WHERE case_id=? AND status='active'", (c.case["id"],))
    if cur.rowcount != 1:
        raise CommandError(409, "no_reservation", "No active reservation to draw against.")
    try:
        c.conn.execute("INSERT INTO draws(org_id, case_id, facility_id, principal_minor, fee_minor, effective_at) "
                       "VALUES (?,?,?,?,?,?)", (c.case["org_id"], c.case["id"], c.fac["id"], appr["amount_minor"],
                                                appr["fee_minor"], db.iso(eff)))
    except sqlite3.IntegrityError:
        raise CommandError(409, "already_drawn", "Already drawn; a case has at most one draw.")
    _ev(c, "draw_recorded", {"principal_minor": appr["amount_minor"], "fee_minor": appr["fee_minor"],
                             "reference": ref, "currency": c.fac["currency"]}, effective_at=db.iso(eff))


def h_prefunding(c):
    errors = []
    m = _money(c.params, errors)
    eff = _time(c.params, "effective_at", errors, required=False, now=c.now, not_future=True) or c.now
    ref = _text(c.params, "reference", errors, maxlen=200)
    if m is not None and m != c.state.funding:
        errors.append({"field": "amount", "message": "Prefunding must equal the funding amount %s (same currency)." % c.state.funding})
    _raise_fields(errors)
    _ev(c, "prefunding_recorded", {"amount_minor": m.minor, "currency": m.currency, "reference": ref},
        effective_at=db.iso(eff))


def _insert_payout(c, attempt, route, external_ref, provider_ref=None):
    try:
        c.conn.execute("INSERT INTO payouts(org_id, case_id, attempt, route, external_ref, provider_ref, amount_minor, "
                       "currency, status, created_at) VALUES (?,?,?,?,?,?,?,?, 'instructed', ?)",
                       (c.case["org_id"], c.case["id"], attempt, route, external_ref, provider_ref,
                        c.state.payout.minor, c.state.payout.currency, db.iso(c.now)))
    except sqlite3.IntegrityError as e:
        if "external_ref" in str(e):
            raise CommandError(409, "duplicate_external_ref", "That external reference is already used by another payout.", "external_ref")
        raise CommandError(409, "payout_live", "A live payout attempt already exists for this case; never re-submit.")


def h_instruct(c):
    errors = []
    route = c.params.get("route")
    if route not in ("manual", "sandbox"):
        errors.append({"field": "route", "message": "Route is manual or sandbox."})
    _raise_fields(errors)
    attempt = len(c.state.payouts) + 1
    payload = {"attempt": attempt, "route": route, "amount_minor": c.state.payout.minor,
               "currency": c.state.payout.currency}
    if route == "manual":
        ext = _text(c.params, "external_ref", errors, maxlen=200)
        evid = c.params.get("evidence_id")
        if evid and evid not in c.state.evidence:
            errors.append({"field": "evidence_id", "message": "Evidence %s is not on this case." % evid})
        _raise_fields(errors)
        _insert_payout(c, attempt, "manual", ext)
        payload.update(external_ref=ext, evidence_id=evid)
        _ev(c, "payout_instructed", payload, provenance="external_record" if evid else "operator_entered")
        return
    ok, why = connector_status()
    if not ok:
        raise CommandError(409, "sandbox_unavailable", why)
    scenario = c.params.get("scenario") or "normal"
    mod = connector_module()
    if scenario not in mod.SCENARIOS:
        raise CommandError(422, "validation_failed", "Scenario must be one of %s." % ", ".join(mod.SCENARIOS), "scenario")
    ext = "%s-P%d" % (c.case["id"], attempt)
    _insert_payout(c, attempt, "sandbox", ext)
    payload.update(external_ref=ext, scenario=scenario, label=domain.SANDBOX_LABEL)
    _ev(c, "payout_instructed", payload, provenance="sandbox_simulation")
    conn_ = make_connector(c.conn, c.case["org_id"], scenario)
    try:
        res = conn_.submit(ext, c.state.payout.minor, c.state.payout.currency, c.case["supplier"], scenario=scenario)
    except mod.ConnectorError as e:
        raise CommandError(502, "connector_error", "Sandbox connector refused the instruction: %s" % e)
    c.conn.execute("UPDATE payouts SET provider_ref=? WHERE case_id=? AND attempt=?",
                   (res.get("provider_ref"), c.case["id"], attempt))
    append_event(c.conn, c.case, "payout_submitted",
                 {"attempt": attempt, "result": res.get("status"), "provider_ref": res.get("provider_ref"),
                  "detail": res.get("detail"), "label": domain.SANDBOX_LABEL}, None, "sandbox_simulation")


def h_delivery(c):
    errors = []
    st = c.params.get("status")
    if st not in domain.DELIVERY_STATUSES:
        errors.append({"field": "status", "message": "Status must be one of %s." % ", ".join(domain.DELIVERY_STATUSES)})
    eff = _time(c.params, "effective_at", errors, required=False, now=c.now, not_future=True) or c.now
    ref = _text(c.params, "reference", errors, required=False, maxlen=200)
    loc = _text(c.params, "location", errors, required=False, maxlen=200)
    evid = c.params.get("evidence_id")
    if evid and evid not in c.state.evidence:
        errors.append({"field": "evidence_id", "message": "Evidence %s is not on this case." % evid})
    lp = c.state.latest_payout()
    if eff < db.parse_iso(lp["instructed_at"]):
        errors.append({"field": "effective_at", "message": "A delivery record cannot be dated before the payout instruction."})
    _raise_fields(errors)
    _ev(c, "delivery_recorded", {"attempt": lp["attempt"], "status": st, "reference": ref, "location": loc,
                                 "evidence_id": evid}, provenance="external_record" if evid else "operator_entered",
        effective_at=db.iso(eff))


def ingest_provider_event(conn, case, payout_row, ev, now):
    """Record one sandbox provider event (deduped by provider_event_id). Caller holds the tx. Returns dict."""
    org = case["org_id"]
    try:
        conn.execute("INSERT INTO connector_events(org_id, provider_event_id, payout_id, kind, occurred_at, received_at, "
                     "applied) VALUES (?,?,?,?,?,?,0)", (org, ev["provider_event_id"], payout_row["id"], ev["kind"],
                                                         db.iso(ev["occurred_at"]), db.iso(now)))
    except sqlite3.IntegrityError:
        return {"duplicate": True, "applied": False}
    st = build_state(conn, case)
    po = next((p for p in st.payouts if p["attempt"] == payout_row["attempt"]), None)
    applied = bool(po) and domain.delivery_applies(po["status"], ev["kind"])
    append_event(conn, case, "delivery_recorded",
                 {"attempt": payout_row["attempt"], "status": ev["kind"], "provider_event_id": ev["provider_event_id"],
                  "reference": ev.get("provider_ref"), "label": domain.SANDBOX_LABEL}, None, "sandbox_simulation",
                 effective_at=db.iso(ev["occurred_at"]))
    conn.execute("UPDATE connector_events SET applied=? WHERE org_id=? AND provider_event_id=?",
                 (1 if applied else 0, org, ev["provider_event_id"]))
    return {"duplicate": False, "applied": applied}


def h_query(c):
    lp = c.state.latest_payout()
    ref = lp.get("provider_ref") or lp["external_ref"]
    row = db.one(c.conn, "SELECT * FROM payouts WHERE case_id=? AND attempt=?", (c.case["id"], lp["attempt"]))
    events = make_connector(c.conn, c.case["org_id"]).get_status(ref)
    new = 0
    for ev in events:
        if not ev.get("provider_event_id") or ev.get("kind") not in ("accepted", "credited", "failed", "returned"):
            continue
        r = ingest_provider_event(c.conn, c.case, row, ev, c.now)
        new += 0 if r["duplicate"] else 1
    append_event(c.conn, c.case, "payout_status_queried", {"attempt": lp["attempt"], "provider_ref": ref,
                                                           "new_events": new}, c.user, "sandbox_simulation")


def h_reinstruct(c):
    _ev(c, "reinstruction_authorized", {"after_status": c.state.latest_payout()["status"],
                                        "attempt": c.state.latest_payout()["attempt"]}, reason=_reason(c, required=False))


def h_receipt(c):
    errors = []
    m = _money(c.params, errors)
    eff = _time(c.params, "effective_at", errors, required=False, now=c.now, not_future=True) or c.now
    ref = _text(c.params, "reference", errors, required=False, maxlen=200)
    _raise_fields(errors)
    rid = "CR-%d" % next_seq(c.conn, c.case["id"])
    _ev(c, "customer_receipt_recorded", {"receipt_id": rid, "amount_minor": m.minor, "currency": m.currency,
                                         "reference": ref}, effective_at=db.iso(eff))


def h_repayment(c):
    errors = []
    m = _money(c.params, errors)
    eff = _time(c.params, "effective_at", errors, required=False, now=c.now, not_future=True) or c.now
    bref = _text(c.params, "bank_ref", errors, maxlen=200)
    _raise_fields(errors)
    rid = "RP-%d" % next_seq(c.conn, c.case["id"])
    dup = None
    day = eff.astimezone(domain.zone(c.state.tz)).date()
    for r in c.state.repayments.values():
        if r["status"] == "void_duplicate":
            continue
        rday = db.parse_iso(r["effective_at"]).astimezone(domain.zone(c.state.tz)).date()
        if r["bank_ref"] == bref and r["money"] == m and rday == day:
            dup = r["id"]
            break
    _ev(c, "repayment_recorded", {"repayment_id": rid, "amount_minor": m.minor, "currency": m.currency,
                                  "bank_ref": bref, "initial_status": "possible_duplicate" if dup else "unallocated",
                                  "duplicate_of": dup}, effective_at=db.iso(eff))


def h_match(c):
    errors = []
    rid = _text(c.params, "repayment_id", errors)
    _raise_fields(errors)
    item = c.state.repayments[rid]
    a = domain.allocate(c.state, item)
    seq = next_seq(c.conn, c.case["id"])
    mid, uid = "MT-%d" % seq, ("UM-%d" % seq if a["unmatched"] else None)
    if a["principal"]:
        cur = c.conn.execute("UPDATE draws SET principal_repaid_minor = principal_repaid_minor + ? WHERE case_id=?",
                             (a["principal"], c.case["id"]))
        if cur.rowcount != 1:
            raise CommandError(500, "identity_violation", "No draw row to apply principal to.")
    _ev(c, "repayment_matched", {"match_id": mid, "repayment_id": rid, "fees_minor": a["fees"],
                                 "principal_minor": a["principal"], "unmatched_minor": a["unmatched"],
                                 "unmatched_id": uid, "unmatched_reason": a["reason"], "unmatched_text": a["text"],
                                 "allocation_rule": (c.fac or {}).get("allocation", "fees_first")})


def h_dup(c):
    errors = []
    rid = _text(c.params, "repayment_id", errors)
    res = c.params.get("resolution")
    if res not in ("duplicate", "distinct"):
        errors.append({"field": "resolution", "message": "Resolution is duplicate (same payment recorded twice) or distinct."})
    _raise_fields(errors)
    _ev(c, "duplicate_resolved", {"repayment_id": rid, "resolution": res}, reason=c.params.get("reason"))


def h_return(c):
    errors = []
    iid = _text(c.params, "item_id", errors)
    reason = _text(c.params, "reason", errors, maxlen=1000)
    ref = _text(c.params, "reference", errors, maxlen=200)
    _raise_fields(errors)
    _ev(c, "unmatched_returned", {"item_id": iid, "reference": ref}, reason=reason)


def h_reverse(c):
    errors = []
    mid = _text(c.params, "match_id", errors)
    reason = _text(c.params, "reason", errors, maxlen=1000)
    _raise_fields(errors)
    mt = c.state.matches[mid]
    if mt["principal"]:
        c.conn.execute("UPDATE draws SET principal_repaid_minor = principal_repaid_minor - ? WHERE case_id=?",
                       (mt["principal"], c.case["id"]))
    _ev(c, "match_reversed", {"match_id": mid}, reason=reason)


def h_note(c):
    errors = []
    text = _text(c.params, "text", errors, maxlen=2000)
    _raise_fields(errors)
    _ev(c, "note_added", {"text": text})


def h_assign(c):
    uid = c.params.get("user_id")
    target = db.one(c.conn, "SELECT id, name, role, disabled FROM users WHERE id=? AND org_id=?",
                    (uid, c.case["org_id"])) if isinstance(uid, int) and not isinstance(uid, bool) else None
    if not target or target["disabled"]:
        raise CommandError(422, "validation_failed", "Choose an active user in your organisation.", "user_id")
    errors = []
    note = _text(c.params, "note", errors, required=False, maxlen=1000)
    _raise_fields(errors)
    _ev(c, "owner_assigned", {"user_id": target["id"], "user_name": target["name"], "note": note}, reason=note)


def h_close(c):
    _ev(c, "case_closed", {})


def h_reopen(c):
    _ev(c, "case_reopened", {"post_close_events": len(c.state.post_close)}, reason=_reason(c))


def h_resolve_dup_check(c):
    errors = []
    d = c.params.get("decision")
    if d not in ("not_duplicate", "duplicate"):
        errors.append({"field": "decision", "message": "Decision is not_duplicate or duplicate."})
    reason = _text(c.params, "reason", errors, maxlen=1000)
    _raise_fields(errors)
    _ev(c, "duplicate_check_resolved", {"decision": d, "matches": list(c.state.dup_check["matches"])}, reason=reason)


def h_declare_default(c):
    reason = _reason(c)
    _ev(c, "default_declared", {"owed_minor": c.state.owed, "currency": c.state.fac_ccy,
                                "due_at": db.iso(c.state.due_at())}, reason=reason)


def _int(params, field, errors, lo=0, hi=10 ** 6, required=False):
    v = params.get(field)
    if v is None or v == "":
        if required:
            errors.append({"field": field, "message": "Required."})
        return None
    if isinstance(v, bool) or not isinstance(v, int) or not (lo <= v <= hi):
        errors.append({"field": field, "message": "Give a whole number from %d to %d." % (lo, hi)})
        return None
    return v


def h_log_work(c):
    errors = []
    minutes = _int(c.params, "minutes", errors, 1, 24 * 60, required=True)
    activity = _text(c.params, "activity", errors, maxlen=500)
    prov = c.params.get("provenance") or "operator_reported"
    if prov != "operator_reported":
        errors.append({"field": "provenance", "message": "Work time is operator_reported."})
    _raise_fields(errors)
    _ev(c, "work_logged", {"minutes": minutes, "activity": activity, "provenance": prov})


BASELINE_PROVENANCE = ("recorded", "estimated", "synthetic")


def h_record_baseline(c):
    errors = []
    prov = c.params.get("provenance")
    if prov not in BASELINE_PROVENANCE:
        errors.append({"field": "provenance", "message": "Provenance is recorded, estimated or synthetic."})
    p = {"provenance": prov}
    for f, hi in (("operator_minutes", 100000), ("touchpoints", 10000), ("evidence_requests", 1000),
                  ("decision_hours", 100000)):
        v = _int(c.params, f, errors, 0, hi)
        if v is not None:
            p[f] = v
    dm = c.params.get("deadline_met")
    if dm is not None:
        if not isinstance(dm, bool):
            errors.append({"field": "deadline_met", "message": "Must be true or false."})
        else:
            p["deadline_met"] = dm
    out = _text(c.params, "outcome", errors, required=False, maxlen=500)
    if out:
        p["outcome"] = out
    p["source_note"] = _text(c.params, "source_note", errors, maxlen=1000)
    _raise_fields(errors)
    _ev(c, "baseline_recorded", p, reason=p["source_note"])


def h_close_exc(c):
    errors = []
    d = c.params.get("disposition")
    if d not in domain.DISPOSITIONS:
        errors.append({"field": "disposition", "message": "Disposition must be one of %s." % ", ".join(domain.DISPOSITIONS)})
    reason = _text(c.params, "reason", errors, maxlen=1000)
    _raise_fields(errors)
    if c.state.auth == "reserved":
        c.conn.execute("UPDATE reservations SET status='released' WHERE case_id=? AND status='active'", (c.case["id"],))
        _ev(c, "reservation_released", {"by_exception": True}, reason="Released on close with exception")
    _ev(c, "case_closed_with_exception", {"disposition": d, "owed_minor": c.state.owed}, reason=reason)


HANDLERS = {
    "add_observation": h_add_observation, "supersede_observation": h_supersede, "select_route": h_select_route,
    "request_advance": h_request_advance, "approve_and_reserve": h_approve, "decline": h_decline,
    "request_evidence": h_request_evidence, "release_reservation": h_release, "authorize_draw": h_authorize_draw,
    "record_draw": h_record_draw, "record_prefunding": h_prefunding, "instruct_payout": h_instruct,
    "record_delivery": h_delivery, "query_payout_status": h_query, "authorize_reinstruction": h_reinstruct,
    "record_customer_receipt": h_receipt, "record_repayment": h_repayment, "match_repayment": h_match,
    "resolve_duplicate": h_dup, "return_unmatched": h_return, "reverse_match": h_reverse, "add_note": h_note,
    "assign_owner": h_assign, "close_case": h_close, "close_with_exception": h_close_exc,
    "reopen_case": h_reopen, "resolve_duplicate_check": h_resolve_dup_check, "declare_default": h_declare_default,
    "log_work": h_log_work, "record_baseline": h_record_baseline,
}


# ---------------------------------------------------------------- case creation and import
def validate_case_body(conn, user, body, now):
    """Return (row_dict, observations[(payload, eff, prov)], errors)."""
    errors = []
    b = body if isinstance(body, dict) else {}
    row = {}
    for f in ("importer", "supplier"):
        row[f] = _text(b, f, errors, maxlen=200)
    pay = _money(b, errors, "payout_amount", "payout_currency")
    fund = _money(b, errors, "funding_amount", "funding_currency")
    row["quote_ref"] = _text(b, "quote_ref", errors, maxlen=200)
    tz = b.get("deadline_tz")
    if not isinstance(tz, str) or domain.zone(tz) is domain.UTC and tz not in ("UTC", "Etc/UTC"):
        errors.append({"field": "deadline_tz", "message": "Give an IANA time zone such as Asia/Singapore."})
    times = {}
    for f in ("deadline_at", "window_a_at", "window_a_cutoff_at"):
        times[f] = _time(b, f, errors)
    lp = b.get("later_permitted", False)
    if not isinstance(lp, bool):
        errors.append({"field": "later_permitted", "message": "Must be true or false."})
        lp = False
    for f in ("window_b_at", "window_b_cutoff_at"):
        times[f] = _time(b, f, errors, required=bool(lp))
    if times["window_a_at"] and times["window_a_cutoff_at"] and times["window_a_cutoff_at"] <= times["window_a_at"]:
        errors.append({"field": "window_a_cutoff_at", "message": "Must be after window_a_at."})
    if times["window_b_at"] and times["window_b_cutoff_at"] and times["window_b_cutoff_at"] <= times["window_b_at"]:
        errors.append({"field": "window_b_cutoff_at", "message": "Must be after window_b_at."})
    if times["deadline_at"] and times["window_a_at"] and times["deadline_at"] <= times["window_a_at"]:
        errors.append({"field": "deadline_at", "message": "Must be after window_a_at."})
    if bool(times["window_b_at"]) != bool(times["window_b_cutoff_at"]):
        errors.append({"field": "window_b_cutoff_at", "message": "Give both window_b_at and window_b_cutoff_at, or neither."})
    row["contract_ref"] = _text(b, "contract_ref", errors, required=False, maxlen=200)
    row["reference"] = _text(b, "reference", errors, required=False, maxlen=200)
    # §13.2 intake fields: invoice_ref required for every new case; quote provenance; owner at intake.
    row["invoice_ref"] = _text(b, "invoice_ref", errors, maxlen=200)
    row["customer_ref"] = _text(b, "customer_ref", errors, required=False, maxlen=200)
    row["quote_source"] = _text(b, "quote_source", errors, required=False, maxlen=200)
    qa = _time(b, "quote_at", errors, required=False, now=now, not_future=True)
    row["quote_at"] = db.iso(qa) if qa else None
    owner = None
    if b.get("owner_user_id") not in (None, ""):
        uid = b.get("owner_user_id")
        if isinstance(uid, int) and not isinstance(uid, bool):
            owner = db.one(conn, "SELECT id, role, disabled FROM users WHERE id=? AND org_id=?", (uid, user["org_id"]))
        if not owner or owner["disabled"] or owner["role"] not in ("operator", "reviewer"):
            errors.append({"field": "owner_user_id", "message": "Owner must be an active operator or reviewer in your "
                                                                 "organisation."})
            owner = None
    elif b.get("owner_email") not in (None, ""):
        em = b.get("owner_email")
        owner = db.one(conn, "SELECT id, role, disabled FROM users WHERE email=? AND org_id=?",
                       (str(em).strip().lower(), user["org_id"])) if isinstance(em, str) else None
        if not owner or owner["disabled"] or owner["role"] not in ("operator", "reviewer"):
            errors.append({"field": "owner_email", "message": "Owner must be an active operator or reviewer in your "
                                                              "organisation."})
            owner = None
    row["owner_user_id"] = owner["id"] if owner else user["id"]
    fid = b.get("facility_id")
    fac = None
    if fid:
        fac = db.one(conn, "SELECT * FROM facilities WHERE id=? AND org_id=?", (fid, user["org_id"]))
        if not fac:
            errors.append({"field": "facility_id", "message": "No such facility in your organisation."})
    else:
        fac = db.one(conn, "SELECT * FROM facilities WHERE org_id=? ORDER BY id LIMIT 1", (user["org_id"],))
    obs = []
    raw_obs = b.get("observations") or []
    if not isinstance(raw_obs, list):
        errors.append({"field": "observations", "message": "Must be a list."})
        raw_obs = []
    for i, o in enumerate(raw_obs):
        if not isinstance(o, dict):
            errors.append({"field": "observations[%d]" % i, "message": "Must be an object."})
            continue
        p, eff, prov, errs = validate_observation(o, now, None, allow_evidence=False, prefix="observations[%d]." % i)
        errors.extend(errs)
        if not errs:
            obs.append((p, eff, prov))
    if errors:
        return None, None, errors
    row.update(payout_minor=pay.minor, payout_currency=pay.currency, funding_minor=fund.minor,
               funding_currency=fund.currency, deadline_tz=tz, later_permitted=1 if lp else 0,
               facility_id=fac["id"] if fac else None)
    for f, v in times.items():
        row[f] = db.iso(v) if v else None
    return row, obs, []


def _org_code(org_id):
    code = re.sub(r"[^A-Z0-9]", "", str(org_id).upper().replace("ORG-", "", 1))
    return (code or "X")[:8]


def _new_case_id(conn, now, org_id):
    """Per-organisation sequence (no cross-customer volume leak); globally unique via the org code."""
    year = now.year
    conn.execute("INSERT INTO case_counters_org(org_id, year, last) VALUES (?, ?, 1) "
                 "ON CONFLICT(org_id, year) DO UPDATE SET last = last + 1", (org_id, year))
    n = conn.execute("SELECT last FROM case_counters_org WHERE org_id=? AND year=?", (org_id, year)).fetchone()[0]
    return "CL-%d-%s-%05d" % (year, _org_code(org_id), n)


def _insert_case(conn, user, row, obs, now, key):
    cid = _new_case_id(conn, now, user["org_id"])
    cols = dict(row, id=cid, org_id=user["org_id"], created_by=user["id"],
                status="assessing", version=0, created_at=db.iso(now))
    cols.setdefault("owner_user_id", user["id"])
    names = sorted(cols)
    conn.execute("INSERT INTO cases(%s) VALUES (%s)" % (",".join(names), ",".join("?" * len(names))),
                 [cols[n] for n in names])
    case = db.one(conn, "SELECT * FROM cases WHERE id=?", (cid,))
    created = {"facility_id": row.get("facility_id"), "owner_user_id": cols["owner_user_id"]}
    for f in ("invoice_ref", "customer_ref", "quote_source", "quote_at"):
        if row.get(f):
            created[f] = row[f]
    append_event(conn, case, "case_created", created, user, "operator_entered", idem=key)
    refs = []
    for p, eff, prov in obs:
        append_event(conn, case, "observation_added", p, user, prov, effective_at=db.iso(eff) if eff else None, idem=key)
        if p.get("kind") == "invoice":
            refs.append(p.get("invoice_ref"))
    run_duplicate_check(conn, case, user, "intake", refs)
    record_checkpoint(conn, case, None, "observation" if obs else "command", now, force=True)
    case, st = _finish_case(conn, case, now)
    return case, st


def create_case(conn, user, body):
    if not domain.allowed(user["role"], "create_case"):
        raise CommandError(403, "forbidden", "Your role (%s) cannot create cases." % user["role"])
    if not isinstance(body, dict):
        raise CommandError(400, "bad_request", "Send a JSON object.")
    key = _require_key(body)
    now = db.now()
    rhash = _request_hash("create_case", body)
    with db.tx(conn):
        hit = _idem_lookup(conn, user["org_id"], key, "create_case", rhash)
        if hit:
            return hit[0], dict(hit[1], idempotent_replay=True)
        row, obs, errors = validate_case_body(conn, user, body, now)
        _raise_fields(errors)
        case, st = _insert_case(conn, user, row, obs, now, key)
        view = case_view(conn, user, case, st, now)
        _idem_store(conn, user["org_id"], key, "create_case", rhash, 201, view)
    return 201, view


def import_cases(conn, user, body):
    if not domain.allowed(user["role"], "import_cases"):
        raise CommandError(403, "forbidden", "Your role (%s) cannot import cases." % user["role"])
    if not isinstance(body, dict) or not isinstance(body.get("csv"), str):
        raise CommandError(400, "bad_request", "Send {csv: \"...\", dry_run: true|false}.", "csv")
    try:
        from . import imports
    except ImportError:
        raise CommandError(503, "import_unavailable", "CSV import module is not installed on this server.")
    fac = db.one(conn, "SELECT * FROM facilities WHERE org_id=? ORDER BY id LIMIT 1", (user["org_id"],))
    try:
        rows, errors = imports.parse_cases_csv(body["csv"], funding_currency_default=fac["currency"] if fac else None)
    except TypeError:
        rows, errors = imports.parse_cases_csv(body["csv"])
    if errors:
        return 422, {"errors": errors, "created": [],
                     "error": {"code": "import_invalid", "message": "Nothing was imported: %d problem(s) found." % len(errors)}}
    v1 = getattr(imports, "csv_version", lambda t: "v1")(body["csv"]) == "v1"
    now = db.now()
    dry = bool(body.get("dry_run"))
    created, existing, all_errors = [], [], []
    with db.tx(conn):
        prepared = []
        for i, r in enumerate(rows, 1):
            key = "import:" + str(r.get("idempotency_key") or _request_hash("row", r))[:120]
            rb = {k: v for k, v in r.items() if k != "idempotency_key"}
            rhash = _request_hash("create_case", rb)
            try:
                hit = _idem_lookup(conn, user["org_id"], key, "create_case", rhash)
            except CommandError:
                all_errors.append("Row %d, column *: already imported with different details" % i)
                continue
            if hit:
                existing.append(hit[1].get("id"))
                continue
            row, obs, errs = validate_case_body(conn, user, rb, now)
            for e in errs:
                msg = e["message"]
                if e["field"] == "invoice_ref" and v1 and not rb.get("invoice_ref"):
                    msg = "v1 file: invoice_ref is required for import; add it or use v2"
                all_errors.append("Row %d, column %s: %s" % (i, e["field"], msg))
            if not errs:
                prepared.append((key, rhash, row, obs))
        if all_errors:
            return 422, {"errors": all_errors, "created": [],
                         "error": {"code": "import_invalid", "message": "Nothing was imported: %d problem(s) found." % len(all_errors)}}
        if dry:
            return 200, {"dry_run": True, "would_create": len(prepared), "already_imported": existing, "created": []}
        for key, rhash, row, obs in prepared:
            case, st = _insert_case(conn, user, row, obs, now, key)
            _idem_store(conn, user["org_id"], key, "create_case", rhash, 201, {"id": case["id"]})
            created.append(case["id"])
    return 200, {"created": created, "already_imported": existing}


# ---------------------------------------------------------------- evidence
def _sniff_ok(ctype, data):
    magic = EVIDENCE_TYPES[ctype]
    if magic is not None:
        return data.startswith(magic)
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return b"\x00" not in data


def add_evidence(conn, user, case_id, body):
    if not isinstance(body, dict):
        raise CommandError(400, "bad_request", "Send {filename, content_type, data_base64}.")
    org = user["org_id"]
    if not load_case(conn, org, case_id):
        raise CommandError(404, "not_found", "No such case in your organisation.")
    if not domain.allowed(user["role"], "add_evidence"):
        raise CommandError(403, "forbidden", "Your role (%s) cannot add evidence." % user["role"])
    errors = []
    fname = _text(body, "filename", errors, maxlen=200)
    if fname:
        fname = os.path.basename(fname.replace("\\", "/")).replace("\x00", "") or None
        if not fname:
            errors.append({"field": "filename", "message": "Give a file name."})
    ctype = body.get("content_type")
    if ctype not in EVIDENCE_TYPES:
        errors.append({"field": "content_type", "message": "Allowed types: PDF, PNG, JPEG, CSV, plain text."})
    raw = body.get("data_base64")
    data = None
    if not isinstance(raw, str) or not raw:
        errors.append({"field": "data_base64", "message": "Required: the file content, base64-encoded."})
    else:
        try:
            data = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            errors.append({"field": "data_base64", "message": "Not valid base64."})
    if data is not None and len(data) > MAX_EVIDENCE:
        raise CommandError(413, "evidence_too_large", "Evidence files are limited to 5 MB; this one is %.1f MB. "
                           "Split or compress it." % (len(data) / 1048576.0), "data_base64")
    if data is not None and not data:
        errors.append({"field": "data_base64", "message": "The file is empty."})
    if data and ctype in EVIDENCE_TYPES and not _sniff_ok(ctype, data):
        errors.append({"field": "content_type", "message": "The file content does not match %s." % ctype})
    _raise_fields(errors)
    key = body.get("idempotency_key")
    now = db.now()
    digest = hashlib.sha256(data).hexdigest()
    rhash = _request_hash("evidence:%s" % case_id, {"f": fname, "t": ctype, "h": digest})
    with db.tx(conn):
        if key:
            hit = _idem_lookup(conn, org, key, "add_evidence", rhash)
            if hit:
                return hit[0], dict(hit[1], idempotent_replay=True)
        case = load_case(conn, org, case_id)
        sweep_case(conn, case, now)
        case = load_case(conn, org, case_id)
        ev = body.get("expected_version")
        if ev is not None and ev != case["version"]:
            raise CommandError(409, "stale_version", "Case changed since you loaded it. Reload and retry.",
                               extra={"current_version": case["version"]})
        st = build_state(conn, case)
        if st.closed:
            raise CommandError(409, "case_closed", "The case is closed; evidence cannot be added.")
        before = clock_checkpoint(conn, case, st, routes_for(conn, st, now), now)
        cur = conn.execute("INSERT INTO evidence(org_id, case_id, filename, content_type, size, sha256, data, provenance, "
                           "known_at) VALUES (?,?,?,?,?,?,?, 'external_record', ?)",
                           (org, case_id, fname, ctype, len(data), digest, sqlite3.Binary(data), db.iso(now)))
        eid = "EV-%d" % cur.lastrowid
        event_id, _ = append_event(conn, case, "evidence_added", {"evidence_id": eid, "filename": fname,
                                                                  "content_type": ctype, "size": len(data),
                                                                  "sha256": digest}, user, "external_record",
                                   idem=key)
        conn.execute("UPDATE evidence SET event_id=? WHERE id=?", (event_id, cur.lastrowid))
        record_checkpoint(conn, case, before, "evidence", now)
        case, st = _finish_case(conn, case, now)
        view = case_view(conn, user, case, st, now)
        resp = dict(view, evidence_added={"id": eid, "sha256": digest, "size": len(data)})
        if key:
            _idem_store(conn, org, key, "add_evidence", rhash, 201, resp)
    return 201, resp


def get_evidence(conn, user, case_id, evidence_id):
    if not isinstance(evidence_id, str) or not evidence_id.startswith("EV-") or not evidence_id[3:].isdigit():
        return None
    return db.one(conn, "SELECT * FROM evidence WHERE id=? AND case_id=? AND org_id=?",
                  (int(evidence_id[3:]), case_id, user["org_id"]))


# ---------------------------------------------------------------- connector ingestion
def ingest_sandbox_body(conn, body_bytes, signature):
    mod = connector_module()
    if mod is None:
        raise CommandError(503, "sandbox_unavailable", "The sandbox connector is not installed on this server.")
    secret = sandbox_secret()
    if not secret:
        raise CommandError(503, "sandbox_unavailable", "PILOT_SECRET is not configured.")
    if not mod.verify(secret, body_bytes, signature or ""):
        raise CommandError(401, "bad_signature", "Signature check failed; the event was not recorded.")
    try:
        ev = mod.parse_event_body(body_bytes)
        db.parse_iso(ev["occurred_at"])
    except (ValueError, OverflowError) as e:
        raise CommandError(400, "bad_event", str(e))
    now = db.now()
    with db.tx(conn):
        ref = ev["provider_ref"]
        rows = db.all_rows(conn, "SELECT * FROM payouts WHERE route='sandbox' AND (provider_ref=? OR external_ref=?)",
                           (ref, ev.get("payout_ref") or ref))
        if len(rows) != 1:
            raise CommandError(404, "unknown_payout", "No sandbox payout matches this provider reference.")
        po = rows[0]
        case = db.one(conn, "SELECT * FROM cases WHERE id=?", (po["case_id"],))
        # A closed case still records provider events: a return or failure after closing must reach a reviewer.
        res = ingest_provider_event(conn, case, po, ev, now)
        if not res["duplicate"]:
            _finish_case(conn, case, now)
    log.info("sandbox event case=%s kind=%s duplicate=%s applied=%s", po["case_id"], ev["kind"], res["duplicate"],
             res["applied"])
    return 200, dict(res, received=True, provenance="sandbox_simulation", label=domain.SANDBOX_LABEL)


def sandbox_advance(conn, db_path, user, case_id, body):
    """Sandbox simulation control: move the simulated provider one step, then deliver its pending events through
    the real signed ingestion path (sign -> verify -> dedupe). Never instructs or re-submits a payout."""
    org = user["org_id"]
    case = load_case(conn, org, case_id)
    if not case:
        raise CommandError(404, "not_found", "No such case in your organisation.")
    if user["role"] not in ("operator", "reviewer"):
        raise CommandError(403, "forbidden", "Your role (%s) cannot drive the sandbox." % user["role"])
    ok, why = connector_status()
    if not ok:
        raise CommandError(409, "sandbox_unavailable", why)
    st = build_state(conn, case)
    lp = st.latest_payout()
    if not lp or lp["route"] != "sandbox" or not lp.get("provider_ref"):
        raise CommandError(409, "no_sandbox_payout", "This case has no sandbox payout to simulate.")
    to_kind = (body or {}).get("to_kind")
    if to_kind not in (None, "accepted", "credited", "failed", "returned"):
        raise CommandError(422, "validation_failed", "to_kind is accepted, credited, failed or returned.", "to_kind")
    mod = connector_module()
    sim = mod.SandboxConnector(lambda: db.connect(db_path), sandbox_secret(), db.now, org_id=org)
    advanced = []
    if not (body or {}).get("deliver_only"):
        try:
            advanced = sim.advance(lp["provider_ref"], to_kind)
        except mod.ConnectorError as e:
            raise CommandError(409, "sandbox_no_step", "Sandbox simulation: %s." % e)

    def post(path, raw, headers):
        c2 = db.connect(db_path)
        try:
            return ingest_sandbox_body(c2, raw, headers.get(mod.SIGNATURE_HEADER))[0]
        except CommandError as e:
            return e.status
        finally:
            c2.close()

    results = sim.deliver_pending(post, lp["provider_ref"])
    case = load_case(conn, org, case_id)
    view = case_view(conn, user, case)
    return 200, dict(view, sandbox_delivery={"advanced": [e["kind"] for e in advanced],
                                             "delivered": results, "label": domain.SANDBOX_LABEL})


# ---------------------------------------------------------------- read models
def _user_name(users, uid):
    u = users.get(uid)
    return u["name"] if u else None


def case_view(conn, user, case, st=None, now=None, replay=None):
    """The case read model. `replay` = {'as_of': datetime, 'cap': capacity or None} renders an as-of view with no
    actions (§13.6)."""
    now = now or db.now()
    st = st or build_state(conn, case)
    users = users_map(conn, case["org_id"])
    fac = st.facility
    if replay is None:
        routes = routes_for(conn, st, now)
    else:
        routes = domain.mark_selected(st, domain.assess(st, fac, replay.get("cap"), now))
    ok, why = connector_status()
    tz = st.tz
    if replay is None:
        draw_row = db.one(conn, "SELECT * FROM draws WHERE case_id=?", (st.id,))
    else:
        draw_row = ({"principal_minor": st.draw["principal"], "principal_repaid_minor": st.principal_repaid}
                    if st.draw else None)
    idents = domain.case_identities(st, draw_row)
    if fac and replay is None:
        idents.append(domain.facility_identity(fac, table_totals(conn, fac["id"]), event_totals(conn, fac)))
    fstatus, _conf = domain.fact_statuses(st, fac, now)
    obs = []
    for oid in st.obs_order:
        o = st.observations[oid]
        obs.append({"event_id": oid, "kind": o["kind"], "text": domain._obs_text(o["kind"], o["data"]),
                    "provenance": o["provenance"], "evidence_id": o["evidence_id"],
                    "known_at": time_json(o["known_at"], tz), "effective_at": time_json(o["effective_at"], tz),
                    "superseded_by": o["superseded_by"], "corrects": o["corrects"], "struck": o["superseded_by"] is not None,
                    "reason": o["reason"], "issuer": o.get("issuer"), "record_ref": o.get("record_ref"),
                    "scope": o.get("scope") or "case", "fact_status": fstatus.get(oid, "fresh"),
                    "conflicts_with": list(_conf.get(oid, []))})
    corrected_by = {}
    for t in st.timeline:
        if t["corrects_event_id"]:
            corrected_by[t["corrects_event_id"]] = t["event_id"]
    timeline = []
    for t in st.timeline:
        timeline.append(dict(t, actor=_user_name(users, t["actor_user_id"]) or ("Sandbox provider" if t["provenance"] == "sandbox_simulation" else "System"),
                             at_local=domain.local_text(t["effective_at"], tz),
                             known_local=domain.local_text(t["known_at"], tz),
                             corrected_by=corrected_by.get(t["event_id"]),
                             sandbox_label=domain.SANDBOX_LABEL if t["provenance"] == "sandbox_simulation" else None))
    evidence = [dict(e, download_url="/api/cases/%s/evidence/%s" % (st.id, e["id"]),
                     known_local=domain.local_text(e["known_at"], tz)) for e in st.evidence.values()]
    owner = st.owner_user_id
    dl = st.deadline
    dc = st.dup_check
    if dc:
        dup = {"status": dc["status"], "matches": list(dc["matches"]), "text": dc["text"],
               "checked_at": time_json(dc["at"], tz), "reason": dc.get("reason"),
               "scope": "This provider's book only (your organisation); other providers are never searched."}
    else:
        dup = {"status": "not_checked", "matches": [], "text": "Not checked: the case was created before the "
               "same-provider duplicate check existed.", "checked_at": None, "reason": None,
               "scope": "This provider's book only (your organisation); other providers are never searched."}
    status = case["status"] if replay is None else domain.status_key(st, now)
    view = {
        "id": st.id, "version": case["version"] if replay is None else None, "status": status,
        "generated_at": db.iso(now),
        "header": {"importer": case["importer"], "supplier": case["supplier"], "payout": str(st.payout),
                   "funding": str(st.funding), "quote_ref": case["quote_ref"],
                   "quote_source": case.get("quote_source"), "quote_at": time_json(case.get("quote_at"), tz),
                   "invoice_ref": case.get("invoice_ref"), "customer_ref": case.get("customer_ref"),
                   "deadline_local": domain.local_text(dl, tz), "deadline_tz": tz, "deadline_utc": db.iso(dl),
                   "owner": {"id": owner, "name": _user_name(users, owner)} if owner else None,
                   "reference": case["reference"], "facility_id": case["facility_id"],
                   "policy_version": fac["policy_version"] if fac else None,
                   "window_a": {"at": time_json(case["window_a_at"], tz), "cutoff": time_json(case["window_a_cutoff_at"], tz)},
                   "window_b": ({"at": time_json(case["window_b_at"], tz), "cutoff": time_json(case["window_b_cutoff_at"], tz)}
                                if case["window_b_at"] else None),
                   "later_permitted": bool(case["later_permitted"]), "contract_ref": case["contract_ref"],
                   "created_at": time_json(case["created_at"], tz), "created_by": _user_name(users, case["created_by"])},
        "decision": domain.decision(st, routes, now),
        "decision_record": domain.decision_record(st, routes, now),
        "duplicate_check": dup,
        "supplier_panel": domain.supplier_panel(st),
        "exposure_panel": domain.exposure_panel(st, now),
        "routes": routes,
        "observations": obs,
        "evidence": evidence,
        "timeline": timeline,
        "notes": [dict(n, by_name=_user_name(users, n["by"])) for n in st.notes],
        "collections": domain.collections(st, now),
        "identities": idents,
        "actions": [] if replay is not None else
        domain.actions(st, routes, now, user, connector_ok=ok) + _sandbox_actions(st, user, ok),
        "sandbox": {"available": ok, "reason": why, "label": domain.SANDBOX_LABEL},
        "facility": (facility_summary(conn, fac) if replay is None else replay_facility(fac, replay.get("cap")))
        if fac else None,
        "replay": None,
    }
    if replay is not None:
        view["replay"] = {"as_of": db.iso(now), "as_of_local": domain.local_text(now, tz),
                          "note": "Replay: shows only what was known at %s (%s). Read-only; no actions." % (
                              db.iso(now), domain.local_text(now, tz)),
                          "events_included": len(st.events)}
    return view


def replay_facility(fac, cap):
    c = fac["currency"]
    out = {"id": fac["id"], "name": fac["name"], "currency": c, "status": fac["status"],
           "suspension_policy": fac["suspension_policy"], "policy_version": fac["policy_version"],
           "required_evidence": domain.required_kinds(fac), "limit": domain.mtext(fac["limit_minor"], c),
           "note": "Facility terms in force at the replay time; capacity from records known then."}
    if cap:
        out.update(available=domain.mtext(cap["headroom"], c), funding_cash=domain.mtext(cap["funding_cash"], c),
                   reserved_other_cases=domain.mtext(cap["reserved"], c),
                   principal_outstanding_other_cases=domain.mtext(cap["principal_outstanding"], c))
    return out


def facility_as_of(conn, facility_id, at):
    """The facility terms in force at `at` (from facility_versions); the current row when no history applies."""
    fac = load_facility(conn, facility_id)
    if not fac:
        return None
    rows = db.all_rows(conn, "SELECT * FROM facility_versions WHERE facility_id=? ORDER BY changed_at, id",
                       (facility_id,))
    pick = None
    for r in rows:
        if db.parse_iso(r["changed_at"]) <= at:
            pick = r
    if pick is None and rows:
        pick = rows[0]
    if pick is None:
        return fac
    out = dict(fac)
    out.update(json.loads(pick["terms"]))
    out["facility_version_id"] = pick["id"]
    return out


def replay_capacity(conn, fac, at, exclude_case):
    """Capacity at `at` from the event log of every other case on the facility (records known at `at` only)."""
    res = out = 0
    for c in db.all_rows(conn, "SELECT * FROM cases WHERE facility_id=? AND id<>?", (fac["id"], exclude_case)):
        evs = [e for e in load_events(conn, c["id"]) if db.parse_iso(e["known_at"]) <= at]
        if not evs:
            continue
        s = domain.fold(c, evs, fac)
        res += s.reserved_minor
        out += s.principal_outstanding
    return domain.capacity(fac, res, out)


def read_case_as_of(conn, user, case_id, as_of):
    """§13.6: the view computed only from events with known_at <= as_of and the clock at as_of; read-only."""
    try:
        at = db.parse_iso(as_of)
    except (ValueError, TypeError, OverflowError):
        raise CommandError(422, "validation_failed", "as_of must be a UTC ISO-8601 time, e.g. 2026-12-01T09:00:00Z.",
                           "as_of")
    case = load_case(conn, user["org_id"], case_id)
    if not case:
        return None
    if db.parse_iso(case["created_at"]) > at:
        raise CommandError(404, "not_found", "This case was not yet on record at %s." % db.iso(at))
    events = [e for e in load_events(conn, case_id) if db.parse_iso(e["known_at"]) <= at]
    fac = facility_as_of(conn, case["facility_id"], at) if case["facility_id"] else None
    c2 = dict(case, owner_user_id=None)
    st = domain.fold(c2, events, fac)
    cap = replay_capacity(conn, fac, at, case_id) if fac else None
    return case_view(conn, user, c2, st, at, replay={"as_of": at, "cap": cap})


def _sandbox_actions(st, user, ok):
    lp = st.latest_payout()
    if not lp or lp["route"] != "sandbox" or st.closed:
        return []
    allowed = user is not None and user["role"] in ("operator", "reviewer")
    reason = None if allowed else "Operator or reviewer only."
    if allowed and not ok:
        reason = "Sandbox connector unavailable."
    return [{"type": "sandbox_advance", "label": "Sandbox simulation: deliver next provider event",
             "enabled": reason is None, "disabled_reason": reason, "role": "operator", "roles": ["operator", "reviewer"],
             "params": ["to_kind"], "endpoint": "/api/cases/%s/sandbox/advance" % st.id, "sandbox": True,
             "sandbox_label": domain.SANDBOX_LABEL}]


def read_case(conn, user, case_id):
    now = db.now()
    case = load_case(conn, user["org_id"], case_id)
    if not case:
        return None
    if _needs_sweep(conn, case_id, now):
        with db.tx(conn):
            sweep_case(conn, load_case(conn, user["org_id"], case_id), now)
        case = load_case(conn, user["org_id"], case_id)
    return case_view(conn, user, case, None, now)


def facility_summary(conn, fac):
    t = table_totals(conn, fac["id"])
    cap = domain.capacity(fac, t["reserved"], t["principal_outstanding"])
    c = fac["currency"]
    return {"id": fac["id"], "name": fac["name"], "currency": c, "status": fac["status"],
            "suspension_policy": fac["suspension_policy"], "policy_version": fac["policy_version"],
            "limit": domain.mtext(fac["limit_minor"], c), "reserved": domain.mtext(t["reserved"], c),
            "principal_outstanding": domain.mtext(t["principal_outstanding"], c),
            "available": domain.mtext(cap["headroom"], c), "funding_account_start": domain.mtext(fac["funding_account_start_minor"], c),
            "funding_cash": domain.mtext(cap["funding_cash"], c),
            "fee": domain.mtext(fac["fee_flat_minor"], c) + (" + %d bp" % fac["fee_bps"] if fac["fee_bps"] else ""),
            "allocation": fac["allocation"], "balance_max_age_hours": fac["balance_max_age_hours"],
            "repayment_days": fac["repayment_days"], "reservation_hours": fac["reservation_hours"],
            "payout_lead_hours": fac["payout_lead_hours"], "required_evidence": domain.required_kinds(fac)}


def facilities(conn, user):
    out = []
    for fac in db.all_rows(conn, "SELECT * FROM facilities WHERE org_id=? ORDER BY id", (user["org_id"],)):
        now = db.now()
        if conn.execute("SELECT 1 FROM reservations WHERE facility_id=? AND status='active' AND expires_at<=?",
                        (fac["id"], db.iso(now))).fetchone():
            with db.tx(conn):
                sweep_facility(conn, fac["id"], now)
        s = facility_summary(conn, fac)
        s["identity"] = domain.facility_identity(fac, table_totals(conn, fac["id"]), event_totals(conn, fac))
        out.append(s)
    return {"facilities": out}


def _row(st, case, users, now, reason, nxt, due=None, severity="normal"):
    return {"case_id": st.id, "importer": case["importer"], "supplier": case["supplier"], "payout": str(st.payout),
            "funding": str(st.funding), "deadline_local": domain.local_text(st.deadline, st.tz),
            "owner": _user_name(users, st.owner_user_id), "owner_user_id": st.owner_user_id, "status": case["status"],
            "version": case["version"], "reason": reason, "next_action": nxt, "due_at": due, "severity": severity}


SECTIONS = [("awaiting_review", "Awaiting review"), ("evidence_requested", "Evidence requested"),
            ("approaching_cutoff", "Approaching cutoff (24 h)"), ("uncertain_delivery", "Uncertain delivery"),
            ("overdue_repayment", "Overdue repayment"), ("unmatched_cash", "Unmatched cash"),
            ("my_open", "My open cases"), ("all_open", "All open cases")]


def queue(conn, user):
    now = db.now()
    org = user["org_id"]
    expired = conn.execute("SELECT DISTINCT r.case_id FROM reservations r JOIN cases c ON c.id=r.case_id WHERE "
                           "c.org_id=? AND r.status='active' AND r.expires_at<=?", (org, db.iso(now))).fetchall()
    if expired:
        with db.tx(conn):
            for (cid,) in expired:
                sweep_case(conn, load_case(conn, org, cid), now)
    users = users_map(conn, org)
    sec = {k: [] for k, _ in SECTIONS}
    for case in db.all_rows(conn, "SELECT * FROM cases WHERE org_id=? AND status NOT IN ('closed','closed_exception') "
                                  "ORDER BY deadline_at", (org,)):
        st = build_state(conn, case)
        routes = routes_for(conn, st, now)
        d = domain.decision(st, routes, now)
        nxt = d["next_action"]
        dl = db.iso(st.deadline)
        if d["owner_role"] == "reviewer":
            sec["awaiting_review"].append(_row(st, case, users, now, d["headline"], nxt, dl, "high"))
        if st.auth == "evidence_requested":
            sec["evidence_requested"].append(_row(st, case, users, now, d["headline"], nxt, dl))
        if not st.funded():
            soon = []
            for f, label in (("window_a_cutoff_at", "Window A cutoff"), ("window_b_cutoff_at", "Window B cutoff"),
                             ("deadline_at", "Supplier deadline")):
                if case.get(f):
                    t = db.parse_iso(case[f])
                    if now <= t <= now + _dt.timedelta(hours=24):
                        soon.append((t, label))
            if st.auth == "reserved" and st.approval:
                t = db.parse_iso(st.approval["expires_at"])
                if now <= t <= now + _dt.timedelta(hours=24):
                    soon.append((t, "Reservation expiry"))
            if soon:
                t, label = min(soon)
                sec["approaching_cutoff"].append(_row(st, case, users, now, "%s %s" % (label, domain.local_text(t, st.tz)),
                                                      nxt, db.iso(t), "high"))
        lp = st.latest_payout()
        if (lp and lp["status"] in ("instructed", "unknown", "accepted")) or st.post_close:
            sec["uncertain_delivery"].append(_row(st, case, users, now, d["headline"], nxt, dl,
                                                  "high" if lp["status"] == "unknown" else "normal"))
        if st.overdue(now):
            sec["overdue_repayment"].append(_row(st, case, users, now, "%s owed since %s" % (
                domain.mtext(st.owed, st.fac_ccy), domain.local_text(st.due_at(), st.tz)), nxt, db.iso(st.due_at()), "high"))
        if st.open_items():
            sec["unmatched_cash"].append(_row(st, case, users, now, "%d open cash item(s)" % st.open_items(), nxt, dl))
        if st.owner_user_id == user["id"]:
            sec["my_open"].append(_row(st, case, users, now, d["headline"], nxt, dl))
        sec["all_open"].append(_row(st, case, users, now, d["headline"], nxt, dl))
    return {"generated_at": db.iso(now), "sections": [{"key": k, "title": t, "rows": sec[k]} for k, t in SECTIONS]}


def search(conn, user, q):
    q = (q or "").strip()
    users = users_map(conn, user["org_id"])
    if q:
        like = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        rows = db.all_rows(conn, "SELECT * FROM cases WHERE org_id=? AND (id LIKE ? ESCAPE '\\' OR importer LIKE ? "
                                 "ESCAPE '\\' OR supplier LIKE ? ESCAPE '\\' OR IFNULL(reference,'') LIKE ? ESCAPE '\\' "
                                 "OR quote_ref LIKE ? ESCAPE '\\') ORDER BY created_at DESC LIMIT 200",
                           (user["org_id"], like, like, like, like, like))
    else:
        rows = db.all_rows(conn, "SELECT * FROM cases WHERE org_id=? ORDER BY created_at DESC LIMIT 200",
                           (user["org_id"],))
    out = []
    now = db.now()
    for c in rows:
        st = build_state(conn, c)
        out.append(_row(st, c, users, now, domain.status_key(st, now).replace("_", " "), None,
                        db.iso(st.deadline)))
    return {"q": q, "results": out}


def export_case(conn, user, case_id, fmt):
    view = read_case(conn, user, case_id)
    if view is None:
        return None
    events = load_events(conn, case_id)
    for e in events:
        e["actor"] = {"name": e.get("actor_name") or ("Sandbox provider" if e["provenance"] == "sandbox_simulation"
                                                      else "System"), "role": e.get("actor_role")}
    try:
        from . import export
    except ImportError:
        export = None
    if export is not None:
        try:
            return export.render_case_history(view, events, fmt)
        except ValueError as e:
            raise CommandError(400, "bad_format", str(e), "format")
    if fmt != "json":
        raise CommandError(400, "bad_format", "Only json export is available on this server.", "format")
    body = json.dumps({"case": view, "events": events}, indent=2, sort_keys=True, default=str).encode("utf-8")
    return body, "application/json", "%s-history.json" % case_id


def time_json(v, tz):
    return domain.time_json(v, tz)


# ---------------------------------------------------------------- pilot measurement report (§13.9)
NOT_MEASURED = "not measured"
NO_SAVINGS_STATEMENT = ("This report does not count capital released, advance principal or transferred credit risk as "
                        "savings: those are financing outcomes, not software savings. Only time, touchpoints, "
                        "evidence requests and decision elapsed time are compared.")
REPORT_LABELS = ("recorded", "estimated", "synthetic", "computed", "not measured")
MEASUREMENT_EVENTS = ("work_logged", "baseline_recorded")
JUDGMENT_EVENTS = ("advance_approved", "advance_declined")


def _cell(value, label, detail=None, unit=None):
    c = {"value": value, "label": label}
    if unit:
        c["unit"] = unit
    if detail:
        c["detail"] = detail
    return c


def _nm(detail=None, unit=None):
    return _cell(None, NOT_MEASURED, detail, unit)


def case_report(conn, user, case_id):
    """One-page comparison: Clearline side computed from the event log, baseline side as recorded."""
    case = load_case(conn, user["org_id"], case_id)
    if not case:
        return None
    st = build_state(conn, case)
    events = st.events
    human = [e for e in events if e.get("actor_user_id") and e["type"] not in MEASUREMENT_EVENTS]
    ev_req = [e for e in events if e["type"] == "evidence_requested"]
    req = next((e for e in events if e["type"] == "advance_requested"), None)
    judg = next((e for e in events if e["type"] in JUDGMENT_EVENTS and req and e["seq"] > req["seq"]), None)
    side = {}
    side["touchpoints"] = _cell(len(human), "computed", "Human events in the case log (excludes system, provider "
                                "and measurement entries)", "events")
    side["evidence_requests"] = _cell(len(ev_req), "computed", "Reviewer evidence requests in the case log",
                                      "requests")
    elapsed_min = None
    if req and judg:
        elapsed_min = int((db.parse_iso(judg["known_at"]) - db.parse_iso(req["known_at"])).total_seconds() // 60)
        side["decision_hours"] = _cell(round(elapsed_min / 60.0, 2), "computed",
                                       "Advance request (seq %d) to reviewer judgment (seq %d, %s)" % (
                                           req["seq"], judg["seq"], judg["type"].replace("_", " ")), "hours")
    else:
        side["decision_hours"] = _nm("No advance request followed by a reviewer judgment on record", "hours")
    active = sum(w["minutes"] for w in st.work_logs)
    if st.work_logs:
        side["active_minutes"] = _cell(active, "recorded", "Σ log_work (operator-reported), %d entr%s" % (
            len(st.work_logs), "y" if len(st.work_logs) == 1 else "ies"), "minutes")
    else:
        side["active_minutes"] = _nm("No work time logged (log_work)", "minutes")
    if elapsed_min is not None and st.work_logs:
        side["elapsed_wait_minutes"] = _cell(max(elapsed_min - active, 0), "computed",
                                             "Decision elapsed minus active minutes (waiting, not working)", "minutes")
    else:
        side["elapsed_wait_minutes"] = _nm("Needs both a decision elapsed time and logged active minutes", "minutes")
    lp = st.latest_payout()
    credit = None
    if lp and lp["status"] == "credited":
        credit = next((h for h in lp["history"] if h["status"] == "credited" and h["applied"]), None)
    if credit:
        met = db.parse_iso(credit["effective_at"]) <= st.deadline
        side["deadline_met"] = _cell(met, "computed", "Beneficiary credit evidenced %s; supplier deadline %s" % (
            credit["effective_at"], db.iso(st.deadline)))
    else:
        side["deadline_met"] = _nm("No beneficiary credit on record")
    outcome = domain.status_key(st, db.now()).replace("_", " ")
    side["outcome"] = _cell(outcome, "computed", "Case status from the event log")

    bl = st.baselines[-1] if st.baselines else None
    base = {}
    for f, unit in (("operator_minutes", "minutes"), ("touchpoints", "events"), ("evidence_requests", "requests"),
                    ("decision_hours", "hours"), ("deadline_met", None), ("outcome", None)):
        if bl and bl.get(f) is not None:
            base[f] = _cell(bl[f], bl["provenance"], None, unit)
        else:
            base[f] = _nm(None, unit)
    baseline = {"cells": base,
                "provenance": bl["provenance"] if bl else NOT_MEASURED,
                "source_note": bl.get("source_note") if bl else None,
                "recorded_at": bl["at"] if bl else None,
                "entries": len(st.baselines)}
    rows = []
    pairs = (("Active operator time", "active_minutes", "operator_minutes"),
             ("Touchpoints", "touchpoints", "touchpoints"),
             ("Evidence requests", "evidence_requests", "evidence_requests"),
             ("Decision elapsed time", "decision_hours", "decision_hours"),
             ("Elapsed waiting time (not working)", "elapsed_wait_minutes", None),
             ("Supplier deadline met", "deadline_met", "deadline_met"),
             ("Outcome", "outcome", "outcome"))
    for label, ck, bk in pairs:
        rows.append({"measure": label, "clearline": side[ck], "baseline": base[bk] if bk else _nm()})
    return {"case_id": case_id, "generated_at": db.now_iso(), "title": "Pilot measurement: %s" % case_id,
            "clearline": side, "baseline": baseline, "rows": rows,
            "labels": {"allowed": list(REPORT_LABELS),
                       "note": "Every number carries one label: recorded, estimated, synthetic (baseline provenance "
                               "as entered), computed (from the event log) or not measured."},
            "active_vs_elapsed": "Active minutes are time people spent working (log_work); elapsed waiting is the "
                                 "decision elapsed time minus active minutes. They are reported separately.",
            "not_savings": NO_SAVINGS_STATEMENT,
            "sandbox_note": "Synthetic / sandbox pilot: no real money moved."}


def _h(x):
    import html as _html
    return _html.escape("" if x is None else str(x), quote=True)


def render_report_html(rep):
    def cell(c):
        v = c.get("value")
        if v is None:
            return "<td>not measured</td>"
        if isinstance(v, bool):
            v = "yes" if v else "no"
        return "<td>%s%s <span class=\"lbl\">[%s]</span></td>" % (_h(v), (" " + _h(c["unit"])) if c.get("unit") else "",
                                                                   _h(c["label"]))
    trs = "".join("<tr><th scope=\"row\">%s</th>%s%s</tr>" % (_h(r["measure"]), cell(r["clearline"]), cell(r["baseline"]))
                  for r in rep["rows"])
    b = rep["baseline"]
    return ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>%s</title>"
            "</head><body><h1>%s</h1><p>%s</p>"
            "<table border=\"1\" cellpadding=\"6\" cellspacing=\"0\"><thead><tr><th>Measure</th><th>Clearline (this case)</th><th>Baseline (%s)</th></tr></thead>"
            "<tbody>%s</tbody></table><p>Baseline source: %s</p><p>%s</p><p><strong>%s</strong></p><p>%s</p>"
            "</body></html>") % (_h(rep["title"]), _h(rep["title"]), _h(rep["sandbox_note"]), _h(b["provenance"]),
                                 trs, _h(b["source_note"] or "not measured"), _h(rep["active_vs_elapsed"]),
                                 _h(rep["not_savings"]), _h(rep["labels"]["note"]))
