"""Read-only simulated bank-to-corporate inbox. No instruction dispatch or ledger mutation.
The sender signs the exact body: HEX(HMAC-SHA256(key, ASCII("Clearline.bank.v1\\n" + org
+ "\\n" + unix_timestamp + "\\n") + raw_utf8_json)). See signing_bytes. The recipient requires
times within ±300 s, matches the instrument to the signing organisation and deduplicates
by (org,event_id). Retries within the window or re-signed later do not create new entries.
PILOT_TRADE_BANK_KEYS_JSON is an org→secret map; disabled unless set. Never reuse user
session keys or real bank keys. This profile is neither a SWIFT interface nor bank attestation.
"""
import hashlib
import hmac
import json
import os
import re
from . import db
from .commands import CommandError

IDENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}\Z", re.ASCII)
SIGNATURE = re.compile(r"[a-fA-F0-9]{64}\Z", re.ASCII)
LIMIT = 32768
FIELDS = {"event_id","instrument_id","bank_reference","status","observed_at"}


def _error(n, code, message):
    raise CommandError(n,code,message)


def _reject():
    _error(401,"invalid_bank_signature","Sandbox bank authentication failed.")


def _no_duplicates(pairs):
    obj={}
    for key,value in pairs:
        if key in obj:
            raise ValueError("Duplicate key")
        obj[key]=value
    return obj


def signing_bytes(org, timestamp, raw):
    return ("Clearline.bank.v1\n%s\n%s\n" % (org,timestamp)).encode("ascii") + raw


def _auth(raw,headers):
    try:
        keys=json.loads(os.environ.get("PILOT_TRADE_BANK_KEYS_JSON","{}"),object_pairs_hook=_no_duplicates)
        if (not isinstance(keys,dict) or not keys
                or any(not IDENT.fullmatch(k) or not isinstance(v,str) or len(v.encode())<32 for k,v in keys.items())
                or len(set(keys.values()))!=len(keys)):
            raise ValueError()
    except (TypeError,ValueError,RecursionError):
        _error(503,"bank_sandbox_disabled","Sandbox bank inbox is not configured.")
    org=headers.get("X-Trade-Org","")
    stamp=headers.get("X-Trade-Timestamp","")
    mac=headers.get("X-Trade-Signature","")
    if not isinstance(org,str) or not IDENT.fullmatch(org) or not isinstance(stamp,str) or not re.fullmatch(r"[0-9]{1,12}",stamp) or not isinstance(mac,str) or not SIGNATURE.fullmatch(mac):
        _reject()
    if abs(int(db.now().timestamp())-int(stamp))>300:
        _reject()
    # Same external failure whether tenant is unknown or signature is wrong.
    key=keys.get(org)
    actual=hmac.new((key or "unconfigured sandbox placeholder").encode(),signing_bytes(org,stamp,raw),hashlib.sha256).hexdigest()
    if not hmac.compare_digest(actual,mac.lower()) or not key:
        _reject()
    return org


def _known(conn,org,rid):
    exists=conn.execute("SELECT 1 FROM trade_credits WHERE org_id=? AND id=?", (org,rid)).fetchone()
    if not exists:
        _error(404,"not_found","Instrument not found.")


def observations(conn,user,rid):
    _known(conn,user["org_id"],rid)
    return db.all_rows(conn,"SELECT event_id,instrument_id,bank_reference,status,observed_at,known_at,payload_sha256 FROM trade_bank_observations WHERE org_id=? AND instrument_id=? ORDER BY known_at,event_id", (user["org_id"],rid))


def ingest(conn,raw,headers):
    if not isinstance(raw,bytes) or len(raw)>LIMIT:
        _error(413,"bank_payload_limit","Sandbox bank body is limited to 32 KiB.")
    org=_auth(raw,headers)
    try:
        data=json.loads(raw.decode("utf-8"),object_pairs_hook=_no_duplicates)
    except (ValueError,UnicodeError,RecursionError):
        _error(400,"invalid_bank_json","Provide a UTF-8 JSON object without duplicate keys.")
    if not isinstance(data,dict) or set(data)!=FIELDS or any(not isinstance(v,str) for v in data.values()):
        _error(422,"invalid_bank_fields","Send exactly the five sandbox observation fields as strings.")
    for k in ("instrument_id","event_id"):
        if not IDENT.fullmatch(data[k]):
            _error(422,"invalid_bank_id","Invalid sandbox event or instrument identifier.")
    if not data["bank_reference"].strip() or len(data["bank_reference"])>128 or any(ord(c)<32 or 0xd800<=ord(c)<=0xdfff for c in data["bank_reference"]):
        _error(422,"invalid_bank_ref","Invalid bank reference.")
    if data["status"] not in ("received","processing","rejected"):
        _error(422,"invalid_bank_status","Only received, processing or rejected observations are supported.")
    try:
        dt=db.parse_iso(data["observed_at"])
        if dt>db.now(): raise ValueError()
    except (ValueError,TypeError,OverflowError):
        _error(422,"invalid_bank_time","observed_at must be a past or current zoned instant.")
    digest=hashlib.sha256(raw).hexdigest()
    rid,eid=data["instrument_id"],data["event_id"]
    with db.tx(conn):
        _known(conn,org,rid)
        prior=db.one(conn,"SELECT payload_sha256 FROM trade_bank_observations WHERE org_id=? AND event_id=?", (org,eid))
        if prior:
            if not hmac.compare_digest(digest,prior["payload_sha256"]):
                _error(409,"conflicting_event","Event identifier already used for different bytes.")
            return 200,{"event_id":eid,"effect":"observation_only","duplicate":True}
        conn.execute("INSERT INTO trade_bank_observations VALUES(?,?,?,?,?,?,?,?)",
                     (org,eid,rid,data["bank_reference"],data["status"],db.iso(dt),db.now_iso(),digest))
        return 201,{"event_id":eid,"effect":"observation_only","duplicate":False}
