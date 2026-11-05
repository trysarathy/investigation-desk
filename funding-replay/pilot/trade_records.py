"""Record-only trade artifacts. No messages sent, funds moved, document control or title transferred."""
import hashlib
import json
import uuid
from . import db, money
from .commands import CommandError

SCOPES = {
    "collection": "Sandbox evidence of a collection instruction referring to URC 522 + eURC 1.1; not an LC, bank undertaking or actual release.",
    "ebl": "External platform observation only. This entry does not establish exclusive control, title, delivery or transfer.",
}


def _fail(status, code, msg):
    raise CommandError(status, code, msg)


def _text(value, field):
    if not isinstance(value, str) or not value.strip() or len(value) > 256 or any(ord(c) < 32 or 0xd800 <= ord(c) <= 0xdfff for c in value):
        _fail(422, "invalid_field", "Provide a plain-text %s (maximum 256 characters)." % field)
    return value.strip()


def _object(p):
    if not isinstance(p, dict):
        _fail(422, "invalid_payload", "Provide an object.")


def _role(user, role):
    if user["role"] != role:
        _fail(403, "forbidden", "Requires the %s role." % role)


def _dump(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _amount(payload):
    if not isinstance(payload.get("amount"), str):
        _fail(422, "invalid_amount", "Amount must be a decimal string.")
    try:
        return money.parse(payload["amount"], payload.get("currency"), allow_zero=False)
    except money.MoneyError as exc:
        _fail(422, "invalid_amount", str(exc))


def _row(conn, user, rid):
    row = db.one(conn, "SELECT * FROM trade_external_records WHERE org_id=? AND id=?", (user["org_id"], rid))
    if row is None:
        _fail(404, "not_found", "Record not found.")
    row["details"] = json.loads(row["details"])
    row["scope"] = SCOPES[row["kind"]]
    return row


def _view(conn, user, rid, cap=None):
    row = _row(conn, user, rid)
    events = db.all_rows(conn, "SELECT seq,action,actor_id,known_at,payload,resulting_status FROM trade_record_events WHERE org_id=? AND record_id=? AND seq<=? ORDER BY seq", (user["org_id"], rid, cap or row["version"]))
    for ev in events:
        ev["payload"] = json.loads(ev["payload"])
    row["events"] = events
    if events:
        row["status"] = events[-1]["resulting_status"]
        row["version"] = events[-1]["seq"]
    if row["kind"] == "ebl":
        for ev in events:
            if ev["action"] == "record_control_change":
                row["details"]["controller"] = ev["payload"]["controller"]
            elif ev["action"] == "surrender":
                row["details"]["controller"] = None
    return row


def list_records(conn, user):
    return db.all_rows(conn, "SELECT id,kind,reference,status,version,created_at FROM trade_external_records WHERE org_id=? ORDER BY created_at DESC,id", (user["org_id"],))


def detail(conn, user, rid):
    return _view(conn, user, rid)


def _retry(conn, user, key, fingerprint):
    ev = db.one(conn, "SELECT record_id,seq,fingerprint FROM trade_record_events WHERE org_id=? AND actor_id=? AND key=?", (user["org_id"], user["id"], key))
    if ev:
        if fingerprint != ev["fingerprint"]:
            _fail(409, "key_reuse", "Key was used for a different request.")
        return _view(conn, user, ev["record_id"], ev["seq"])


def _effective(payload):
    """Evidence may be registered later; knowledge time remains the server clock."""
    raw = payload.get("effective_at",db.now_iso())
    try:
        when = db.parse_iso(raw)
    except (ValueError,TypeError,OverflowError):
        _fail(422,"invalid_time","Provide a zoned effective_at instant.")
    if when > db.now():
        _fail(422,"future_evidence","A future observation cannot be recorded.")
    return db.iso(when)


def _event(conn, user, rid, seq, action, payload, status, key, fp):
    conn.execute("INSERT INTO trade_record_events VALUES (?,?,?,?,?,?,?,?,?,?)",
                 (user["org_id"], rid, seq, action, user["id"], db.now_iso(), _dump(payload), status, key, fp))


def _fingerprint(v):
    return hashlib.sha256(_dump(v).encode()).hexdigest()


def create(conn, user, payload, key):
    _role(user, "operator")
    _object(payload)
    kind = _text(payload.get("kind"), "kind")
    if kind not in SCOPES:
        _fail(422, "invalid_kind", "Use collection or ebl.")
    key = _text(key, "idempotency key")
    ref = _text(payload.get("reference"), "reference")
    evidence = _text(payload.get("evidence_ref"), "evidence_ref")
    common = {"kind","reference","evidence_ref","effective_at"}
    extra = ({"principal","drawee","remitting_bank","collecting_bank","arrangement_ref","record_format","presentation_place","collection_mode","currency","amount"} if kind=="collection" else {"issuer","platform","controller"})
    if set(payload) - common - extra:
        _fail(422, "unsupported_terms", "Remove unsupported fields; this sandbox does not implement those terms.")
    fp = _fingerprint(["create", payload])
    if kind == "collection":
        fields = ("principal", "drawee", "remitting_bank", "collecting_bank", "arrangement_ref", "record_format", "presentation_place", "collection_mode")
        terms = {f: _text(payload.get(f), f) for f in fields}
        if terms["collection_mode"] not in ("DP","DA"):
            _fail(422, "invalid_mode", "Use DP or DA.")
        m = _amount(payload)
        terms.update(currency=m.currency, amount_minor=m.minor, rules="URC 522 + eURC 1.1 (instruction and prior arrangement recorded)")
        status = "instruction_recorded"
    else:
        terms = {f: _text(payload.get(f), f) for f in ("issuer", "controller", "platform")}
        status = "observed"
    with db.tx(conn):
        old = _retry(conn, user, key, fp)
        if old:
            return old
        if db.one(conn, "SELECT 1 FROM trade_external_records WHERE org_id=? AND kind=? AND reference=?", (user["org_id"], kind, ref)):
            _fail(409, "duplicate_reference", "This reference already exists in this organisation.")
        rid = "TR-" + uuid.uuid4().hex
        conn.execute("INSERT INTO trade_external_records VALUES(?,?,?,?,?,?,?,?,?)", (rid, user["org_id"], kind, ref, user["id"], status, 1, _dump(terms), db.now_iso()))
        _event(conn, user, rid, 1, "create", dict(terms, evidence_ref=evidence, reference=ref, effective_at=_effective(payload)), status, key, fp)
        return _view(conn, user, rid)


def command(conn, user, rid, action, payload, key, version):
    _object(payload)
    key = _text(key, "idempotency key")
    action = _text(action, "action")
    if type(version) is not int or version < 1:
        _fail(422, "invalid_version", "Send the record version.")
    allowed = {"evidence_ref","effective_at"}
    if action == "record_payment": allowed |= {"amount","currency"}
    if action == "record_control_change": allowed |= {"controller"}
    if set(payload) - allowed:
        _fail(422, "unsupported_terms", "Unsupported fields for this record action.")
    evidence = _text(payload.get("evidence_ref"), "evidence_ref")
    _role(user, "operator" if action == "present" else "reviewer")
    fp = _fingerprint([rid,action,payload,version])
    with db.tx(conn):
        row = _row(conn,user,rid)
        old = _retry(conn,user,key,fp)
        if old:
            return old
        if row["version"] != version:
            _fail(409,"stale_version","Reload the record.")
        s = row["status"]
        event = {"evidence_ref":evidence,"effective_at":_effective(payload)}
        new = None
        if row["kind"] == "collection":
            mode = row["details"]["collection_mode"]
            if s == "instruction_recorded" and action == "present":
                new = "presented"
            if s == "presented" and action == "refuse":
                new = "refused"
            if s == "presented" and mode == "DA" and action == "record_acceptance":
                new = "accepted_unpaid"
            if ((s == "presented" and mode == "DP") or s == "released_against_acceptance") and action == "record_payment":
                m = _amount(payload)
                if (m.minor,m.currency)!=(row["details"]["amount_minor"],row["details"]["currency"]):
                    _fail(422,"mismatched_payment","This full-payment profile needs the instructed currency and amount.")
                event.update(amount_minor=m.minor,currency=m.currency)
                new = "paid" if mode == "DP" else "released_and_paid"
            if action == "record_release" and ((s=="accepted_unpaid" and mode=="DA") or (s=="paid" and mode=="DP")):
                new = "released_against_acceptance" if mode=="DA" else "released_and_paid"
        elif s == "observed" and action == "record_control_change":
            event["controller"] = _text(payload.get("controller"), "controller")
            if event["controller"] == _view(conn,user,rid)["details"]["controller"]:
                _fail(422, "unchanged_controller", "New observed controller must differ.")
            new = "observed"
        elif s == "observed" and action == "surrender":
            new = "surrendered"
        if not new:
            _fail(409,"invalid_transition","Action unavailable in this record state.")
        _event(conn,user,rid,version+1,action,event,new,key,fp)
        conn.execute("UPDATE trade_external_records SET status=?,version=? WHERE org_id=? AND id=?", (new,version+1,user["org_id"],rid))
        return _view(conn,user,rid)
