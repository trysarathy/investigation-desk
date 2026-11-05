"""Sandbox single-presentation credit. Exact-document/full-drawing profile, no payment or title transfer.

The structural check list is deliberately small and explicit: no ICC conformity opinion, banking
calendar inference, documentary authenticity, or advice/confirmation of a real undertaking.
"""
import hashlib
import json
import re
import sqlite3
import uuid

from . import db, money
from .commands import CommandError

PROFILE = "sandbox-single-full-drawing-v1"
# No tolerance, partial drawings, amendments, or automatic bank undertakings in this contracted profile.
OPS = {
    "issue": ("reviewer", ("draft",), "issued"),
    "present": ("operator", ("issued",), "presented"),
    "examine": ("reviewer", ("presented",), None),
    "accept": ("reviewer", ("examined",), "accepted"),
    "request_waiver": ("reviewer", ("discrepant",), "waiver_requested"),
    "record_waiver": ("operator", ("waiver_requested",), "waiver_recorded"),
    "accept_waiver": ("reviewer", ("waiver_recorded",), "accepted"),
    "refuse": ("reviewer", ("discrepant", "waiver_requested", "waiver_recorded"), "refused"),
    "request_financing_review": ("operator", ("accepted",), "financing_review_requested"),
}
CREATE_KEYS = set("reference applicant beneficiary issuing_bank advising_bank currency amount expires_at presentation_deadline_at required_documents".split())


def err(status, code, message):
    raise CommandError(status, code, message)


def _text(p, key, limit=240):
    v = p.get(key)
    if not isinstance(v, str) or not v.strip() or len(v.strip()) > limit or any(ord(c) < 32 for c in v):
        err(422, "invalid_field", "Supply valid " + key + ".")
    return v.strip()


def _fields(p, keys):
    if not isinstance(p, dict) or set(p) - set(keys):
        err(422, "invalid_fields", "Invalid or unsupported trade fields.")


def _instant(p, k):
    try:
        return db.iso(_text(p, k, 64))
    except (ValueError, OverflowError):
        err(422, "invalid_time", "Supply a timezone-aware " + k + ".")


def _amount(p):
    try:
        return money.parse(_text(p, "amount", 35), _text(p, "currency", 3), allow_zero=False).minor
    except ValueError as exc:
        err(422, "invalid_money", str(exc))


def _kind(v):
    if not isinstance(v, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", v):
        err(422, "invalid_document_kind", "Use lower-case document types such as invoice.")
    return v


def _roles(user, allowed):
    if user["role"] not in allowed:
        err(403, "forbidden", "This trade action is unavailable to your role.")


def _credit(conn, user, cid):
    r = db.one(conn, "SELECT * FROM trade_credits WHERE org_id=? AND id=?", (user["org_id"], cid))
    if not r:
        err(404, "not_found", "Trade credit not found.")
    r["required_documents"] = json.loads(r["required_documents"])
    r["simulated"] = True
    r["amount"] = money.Money(r["amount_minor"], r["currency"]).to_json()
    return r


def list_instruments(conn, user):
    rows = db.all_rows(conn, """SELECT id, reference, applicant, beneficiary, currency, amount_minor,
                                 status, version, expires_at FROM trade_credits
                                 WHERE org_id=? ORDER BY created_at DESC, id""", (user["org_id"],))
    for r in rows:
        r["amount"] = money.Money(r["amount_minor"], r["currency"]).to_json()
    return rows


def detail(conn, user, cid):
    # A reader sees either side of a committed transition, never new events with an old status.
    if not conn.in_transaction:
        conn.execute("BEGIN")
        try:
            view = detail(conn, user, cid)
            conn.execute("COMMIT")
            return view
        except BaseException:
            conn.execute("ROLLBACK")
            raise
    r = _credit(conn, user, cid)
    args = (user["org_id"], cid)
    pres = db.one(conn, "SELECT presented_at,recorded_at,currency,amount_minor FROM trade_presentations WHERE org_id=? AND credit_id=?", args)
    if pres:
        pres["amount"] = money.Money(pres["amount_minor"], pres["currency"]).to_json()
        pres["documents"] = db.all_rows(conn, "SELECT kind,reference,issuer,sha256 FROM trade_documents WHERE org_id=? AND credit_id=? ORDER BY ordinal", args)
    r["presentation"] = pres
    r["financing_review"] = db.one(conn, """SELECT trigger_seq,created_at,status,handed_off_at,handed_off_by
                                     FROM trade_financing_tasks WHERE org_id=? AND credit_id=?""", args)
    if r["financing_review"]:
        r["financing_review"]["funds_moved"] = False
    r["events"] = db.all_rows(conn, "SELECT seq,action,actor_id,role,effective_at,known_at,status,payload_json FROM trade_events WHERE org_id=? AND credit_id=? ORDER BY seq", args)
    r["findings"] = []
    for e in r["events"]:
        e["payload"] = json.loads(e.pop("payload_json"))
        if e["action"] == "examine":
            r["findings"] = e["payload"]["findings"]
    r["actions"] = [a for a, (role, states, _) in OPS.items() if role == user["role"] and r["status"] in states
                    and not (a == "issue" and r["created_by"] == user["id"])]
    return r


def _json(x):
    return json.dumps(x, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _mutate(conn, user, key, data, perform):
    if not isinstance(key, str) or not key.strip() or len(key) > 160:
        err(422, "missing_idempotency_key", "Supply an idempotency key of 1-160 characters.")
    try:
        digest = hashlib.sha256(_json(data).encode()).hexdigest()
    except (TypeError, ValueError):
        err(422, "invalid_json", "Expected valid JSON values.")
    scope = (user["org_id"], user["id"], key)
    with db.tx(conn):
        seen = db.one(conn, "SELECT digest,response_json FROM trade_requests WHERE org_id=? AND actor_id=? AND request_key=?", scope)
        if seen:
            if digest != seen["digest"]:
                err(409, "idempotency_conflict", "Key already used for a different request.")
            return json.loads(seen["response_json"])
        result = perform()
        conn.execute("INSERT INTO trade_requests VALUES(?,?,?,?,?)", scope + (digest, _json(result)))
        return result


def _event(conn, user, cid, seq, action, status, payload, effective=None):
    at = db.now_iso()
    conn.execute("INSERT INTO trade_events VALUES(?,?,?,?,?,?,?,?,?,?)",
                 (user["org_id"], cid, seq, action, user["id"], user["role"], effective or at, at, status, _json(payload)))


def create(conn, user, payload, key):
    _roles(user, ("operator",))
    _fields(payload, CREATE_KEYS)
    def perform():
        args = {k: _text(payload, k) for k in ("reference","applicant","beneficiary","issuing_bank","advising_bank","currency")}
        amount = _amount(payload)
        expires = _instant(payload, "expires_at")
        deadline = _instant(payload, "presentation_deadline_at") if "presentation_deadline_at" in payload else expires
        if not db.now_iso() < deadline <= expires:
            err(422, "invalid_terms", "Presentation deadline must be in the future and cannot exceed expiry.")
        docs = payload.get("required_documents")
        if not isinstance(docs, list) or not 1 <= len(docs) <= 25:
            err(422, "invalid_documents", "Specify 1-25 required document types.")
        docs = [_kind(k) for k in docs]
        if len(set(docs)) != len(docs):
            err(422, "invalid_documents", "Do not repeat required document types.")
        cid = "LC-" + uuid.uuid4().hex
        now = db.now_iso()
        try:
            conn.execute("""INSERT INTO trade_credits(id,org_id,reference,applicant,beneficiary,issuing_bank,advising_bank,
            currency,amount_minor,required_documents,expires_at,presentation_deadline_at,profile,created_by,created_at,status,version)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',1)""",
                         (cid,user["org_id"],args["reference"],args["applicant"],args["beneficiary"],args["issuing_bank"],
                          args["advising_bank"],args["currency"],amount,_json(docs),expires,deadline,PROFILE,user["id"],now))
        except sqlite3.IntegrityError:
            err(409, "duplicate_reference", "That trade reference is already in use.")
        _event(conn, user, cid, 1, "create", "draft", dict(args, amount_minor=amount, required_documents=docs,
               expires_at=expires,presentation_deadline_at=deadline,profile=PROFILE))
        return detail(conn,user,cid)
    return _mutate(conn,user,key,["create",payload],perform)


def _present(conn, user, r, p):
    _fields(p, ("amount","currency","presented_at","documents"))
    amt = _amount(p)
    at = _instant(p, "presented_at")
    if not r["issued_at"] <= at <= db.now_iso():
        err(422, "presentation_time", "Presentation must be on or after issue and no later than the server clock.")
    docs = p.get("documents")
    if not isinstance(docs,list) or len(docs)>50:
        err(422, "invalid_documents", "Supply a document metadata list (up to 50 entries).")
    conn.execute("INSERT INTO trade_presentations VALUES(?,?,?,?,?,?)",
                 (r["id"],user["org_id"],at,db.now_iso(),_text(p,"currency",3),amt))
    for i,d in enumerate(docs):
        _fields(d, ("kind","reference","issuer","sha256"))
        k, ref = _kind(d.get("kind")), _text(d,"reference")
        sha = d.get("sha256")
        if sha is not None and (not isinstance(sha,str) or not re.fullmatch(r"[0-9a-fA-F]{64}",sha)):
            err(422, "invalid_hash", "A supplied digest must be 64 hex characters; it does not establish title.")
        issuer = _text(d,"issuer") if "issuer" in d and d["issuer"] is not None else None
        conn.execute("INSERT INTO trade_documents VALUES(?,?,?,?,?,?,?)",
                     (user["org_id"],r["id"],i,k,ref,issuer,sha.lower() if sha else None))
    return at


def _findings(r,p):
    checks = []
    def add(code,field,expected,observed):
        checks.append(dict(code=code,field=field,expected=expected,observed=observed))
    # In this manual sandbox the server's receipt is the only independently timed event.
    # An operator-supplied historical timestamp must never clear a late-receipt finding.
    received_at = p["recorded_at"]
    if received_at > r["expires_at"]:
        add("expired_credit","recorded_at",r["expires_at"],received_at)
    if received_at > r["presentation_deadline_at"]:
        add("late_presentation","recorded_at",r["presentation_deadline_at"],received_at)
    if p["currency"] != r["currency"]:
        add("currency_mismatch","currency",r["currency"],p["currency"])
    elif p["amount_minor"] != r["amount_minor"]:
        add("amount_mismatch","amount_minor",r["amount_minor"],p["amount_minor"])
    have={d["kind"] for d in p["documents"]}
    for name in r["required_documents"]:
        if name not in have:
            add("missing_document","documents",name,None)
    return checks


def command(conn, user, cid, action, payload, key, version):
    if action not in OPS:
        err(422,"unknown_action","Unknown trade command.")
    role, states, target = OPS[action]
    _roles(user,(role,))
    if isinstance(version,bool) or not isinstance(version,int) or version<1:
        err(422,"version_required","Supply an integer expected version.")
    def perform():
        nonlocal target
        r = _credit(conn,user,cid)
        if version!=r["version"]:
            err(409,"version_conflict","Trade record changed; reload it.")
        if r["status"] not in states:
            err(409,"invalid_transition","Trade action is unavailable in the current state.")
        now=db.now_iso()
        event={}
        effective=None
        if action=="issue":
            _fields(payload,())
            if r["created_by"]==user["id"]:
                err(403,"self_issue","Another user must issue this sandbox credit.")
            if now>=r["presentation_deadline_at"]:
                err(409,"elapsed_deadline","Do not issue after the available presentation window has closed.")
            conn.execute("UPDATE trade_credits SET issued_at=? WHERE id=? AND org_id=?",(now,cid,user["org_id"]))
        elif action=="present":
            effective=_present(conn,user,r,payload)
            event={"presentation":detail(conn,user,cid)["presentation"]}
        elif action=="examine":
            _fields(payload,("manual_findings",))
            findings=_findings(r,detail(conn,user,cid)["presentation"])
            manual=payload.get("manual_findings",[])
            if not isinstance(manual,list) or len(manual)>25:
                err(422,"invalid_findings","Supply no more than 25 examiner observations.")
            for item in manual:
                _fields(item,("field","expected","observed","evidence_ref"))
                findings.append({"code":"examiner_observation","field":_text(item,"field",80),
                                 "expected":_text(item,"expected",500),"observed":_text(item,"observed",500),
                                 "evidence_ref":_text(item,"evidence_ref")})
            target="discrepant" if findings else "examined"
            event={"findings":findings,"profile":PROFILE,"scope":"Structural term checks only; independent human documentary examination required."}
        elif action=="record_waiver":
            _fields(payload,("evidence_ref",))
            event={"evidence_ref":_text(payload,"evidence_ref"),"source":"operator_recorded_applicant_response"}
        elif action=="request_financing_review":
            _fields(payload,())
            event={"outcome":"existing_review_task_handed_off","funds_moved":False}
            changed=conn.execute("""UPDATE trade_financing_tasks SET status='handed_off',handed_off_at=?,handed_off_by=?
                            WHERE org_id=? AND credit_id=? AND status='awaiting_handoff'""",(now,user["id"],user["org_id"],cid))
            if changed.rowcount!=1:
                err(409,"review_task_unavailable","Review task is missing or already handed off.")
        else:
            _fields(payload,("reason",))
            event={"reason":_text(payload,"reason",1500)}
        if action=="refuse":
            event["outcome"]="simulated_internal_refusal_only; not a formal notice to the presenter"
        if target=="accepted":
            event["automatic_task"]="financing_review_only"
            event["funds_moved"]=False
        seq=version+1
        conn.execute("UPDATE trade_credits SET status=?,version=? WHERE id=? AND org_id=?",(target,seq,cid,user["org_id"]))
        _event(conn,user,cid,seq,action,target,event,effective)
        if target=="accepted":
            conn.execute("""INSERT INTO trade_financing_tasks(org_id,credit_id,trigger_seq,created_at,status)
                         VALUES(?,?,?,?,'awaiting_handoff')""",(user["org_id"],cid,seq,now))
        return detail(conn,user,cid)
    return _mutate(conn,user,key,[cid,action,version,payload],perform)
