"""Tenant-local candidate review. No global registry or automatic financing decision."""
import hashlib
import json
import unicodedata
from . import db, money
from .commands import CommandError

_FIELDS = "id,reference,importer,supplier,payout_currency,payout_minor,deadline_at"
_SCOPE = ("Only this provider's recorded cases were checked. A match is a prompt for review, "
          "not proof of double financing. No external lender or registry was searched.")


def _org(user):
    if not user or user.get("role") not in ("viewer","reviewer","operator","admin") or not user.get("org_id"):
        raise CommandError(403, "forbidden", "An authorized organization session is required.")
    return user["org_id"]


def _case(conn, org, cid):
    row = db.one(conn, "SELECT " + _FIELDS + " FROM cases WHERE org_id=? AND id=?", (org,cid))
    if not row:
        raise CommandError(404, "not_found", "Case not found.")
    return row


def _norm(value):
    return " ".join(unicodedata.normalize("NFKC", value or "").casefold().split())


def _signals(a, b):
    ref = _norm(a["reference"])
    same_ref = bool(ref and ref == _norm(b["reference"]))
    same_parties = all(_norm(a[k]) and _norm(a[k]) == _norm(b[k]) for k in ("supplier","importer"))
    same_amount = (a["payout_minor"],a["payout_currency"]) == (b["payout_minor"],b["payout_currency"])
    same_deadline = a["deadline_at"] == b["deadline_at"]
    if not same_ref and not (same_parties and same_amount and same_deadline):
        return []
    return [label for value,label in ((same_ref,"Same normalized case reference"),
            (same_parties,"Same importer and supplier"),(same_amount,"Same payout amount and currency"),
            (same_deadline,"Same deadline")) if value]


def _history(conn, org, a, b):
    rows = db.all_rows(conn, """SELECT version,disposition,reason,actor_id,actor_role,known_at,signal_snapshot
       FROM duplicate_decisions WHERE org_id=? AND case_a=? AND case_b=? ORDER BY version""",(org,a,b))
    for r in rows:
        r["signals_at_decision"] = json.loads(r.pop("signal_snapshot"))
    return rows


def read(conn,user,cid):
    org = _org(user)
    origin = _case(conn,org,cid)
    pairs = []
    for row in db.all_rows(conn,"SELECT "+_FIELDS+" FROM cases WHERE org_id=? AND id<>? ORDER BY id",(org,cid)):
        signals = _signals(origin,row)
        if not signals:
            continue
        hist = _history(conn,org,*sorted((cid,row["id"])))
        row["payout"] = money.format_money(money.Money(row.pop("payout_minor"),row.pop("payout_currency")))
        pairs.append(dict(candidate=row,signals=signals,version=len(hist),
                          disposition=hist[-1]["disposition"] if hist else "unreviewed",history=hist))
    return {"case_id":cid,"scope":_SCOPE,"candidates":pairs,"message":
            "Potential same-provider matches." if pairs else "No matching record in this provider's book."}


def record(conn,user,cid,body):
    org = _org(user)
    if user["role"] not in ("operator","reviewer"):
        raise CommandError(403,"forbidden","Only operators and reviewers can record a disposition.")
    if not isinstance(body,dict) or set(body) != {"idempotency_key","candidate_id","reason","version","disposition"}:
        raise CommandError(422,"invalid_request","Supply candidate, disposition, reason, version and request key.")
    disp,key,reason,other,version=(body[k] for k in ("disposition","idempotency_key","reason","candidate_id","version"))
    if not isinstance(disp,str) or disp not in ("distinct","confirmed_duplicate","possible_duplicate","reopen"):
        raise CommandError(422,"invalid_disposition","Unknown disposition.")
    if disp != "possible_duplicate" and user["role"] != "reviewer":
        raise CommandError(403,"forbidden","A separate reviewer must resolve or reopen a candidate.")
    for value,limit in ((key,128),(reason,1000),(other,80)):
        if not isinstance(value,str) or not value.strip() or len(value)>limit or any(ord(c)<32 or 0xD800<=ord(c)<=0xDFFF for c in value):
            raise CommandError(422,"invalid_field","Provide valid candidate, request key and reason.")
    if type(version) is not int or version<0 or other==cid:
        raise CommandError(422,"invalid_request","Select another candidate and its nonnegative version.")
    a,b=sorted((cid,other))
    req=hashlib.sha256(json.dumps([cid,body],sort_keys=True).encode()).hexdigest()
    with db.tx(conn):
        origin=_case(conn,org,cid)
        target=_case(conn,org,other)
        hit=db.one(conn,"SELECT request_hash FROM duplicate_decisions WHERE org_id=? AND actor_id=? AND request_key=?",(org,user["id"],key))
        if hit:
            if hit["request_hash"]!=req:
                raise CommandError(409,"idempotency_conflict","Request key already used for a different disposition.")
            return read(conn,user,cid)
        signals=_signals(origin,target)
        if not signals:
            raise CommandError(422,"not_candidate","These records do not match this provider's review criteria.")
        hist=_history(conn,org,a,b)
        if len(hist)!=version:
            raise CommandError(409,"version_conflict","Another review was recorded; refresh the case.")
        terminal=bool(hist and hist[-1]["disposition"] in ("distinct","confirmed_duplicate"))
        if (disp=="reopen") != terminal:
            raise CommandError(409,"invalid_transition","Reopen a resolved pair before recording a different decision.")
        conn.execute("INSERT INTO duplicate_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                     (org,a,b,version+1,disp,reason.strip(),user["id"],user["role"],db.now_iso(),key,req,json.dumps(signals)))
        return read(conn,user,cid)
