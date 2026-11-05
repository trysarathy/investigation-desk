"""Shared helpers for BACKEND tests: temp DB, seeded orgs, in-thread server, small HTTP client."""

import base64
import sys
import http.client
import json
import os
import shutil
import tempfile
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pilot import cli, commands, db, server  # noqa: E402

T0 = "2026-12-01T01:00:00Z"  # Tue 1 Dec 2026, 09:00 SGT


def kestrel_body(**over):
    """A new fictional invoice (not the demo's Northwind case)."""
    b = {"importer": "Kestrel Instruments Pte Ltd", "supplier": "Lindqvist Optics AB",
         "payout_amount": "61,400.00", "payout_currency": "EUR",
         "funding_amount": "89,450.25", "funding_currency": "SGD", "quote_ref": "QT-KES-2026-118",
         "deadline_at": "2026-12-04T10:00:00Z", "deadline_tz": "Asia/Singapore",
         "window_a_at": "2026-12-02T07:00:00Z", "window_a_cutoff_at": "2026-12-02T08:00:00Z",
         "later_permitted": False, "contract_ref": "CT-KES-07", "reference": "PO-KES-5521",
         "idempotency_key": str(uuid.uuid4())}
    b.update(over)
    return b


class Env(object):
    """Temp DB, migrated and seeded."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="pilot-test-")
        self.path = os.path.join(self.dir, "pilot.db")
        self._old_env = os.environ.get("PILOT_ENV")
        os.environ["PILOT_ENV"] = "test"
        db.set_clock(T0)
        conn = db.connect(self.path)
        cli.seed(conn)
        conn.close()

    def conn(self):
        return db.connect(self.path)

    def user(self, email):
        c = self.conn()
        try:
            u = db.one(c, "SELECT id, name, email, role, org_id FROM users WHERE email=?", (email,))
        finally:
            c.close()
        return u

    def close(self):
        db.set_clock(None)
        if self._old_env is None:
            os.environ.pop("PILOT_ENV", None)
        else:
            os.environ["PILOT_ENV"] = self._old_env
        shutil.rmtree(self.dir, ignore_errors=True)


class Resp(object):
    def __init__(self, status, headers, raw):
        self.status, self.headers, self.raw = status, headers, raw
        try:
            self.json = json.loads(raw.decode("utf-8")) if raw else None
        except (ValueError, UnicodeDecodeError):
            self.json = None

    @property
    def code(self):
        return ((self.json or {}).get("error") or {}).get("code")

    def __repr__(self):
        return "Resp(%d, %s)" % (self.status, (self.raw[:300] if self.raw else b""))


class Client(object):
    def __init__(self, port):
        self.port = port
        self.cookie = None
        self.csrf = None

    def req(self, method, path, body=None, headers=None, raw=None, csrf=True, ctype="application/json"):
        h = dict(headers or {})
        data = raw
        if body is not None:
            data = json.dumps(body).encode("utf-8")
        if data is not None and ctype:
            h.setdefault("Content-Type", ctype)
        if self.cookie:
            h["Cookie"] = "cl_session=" + self.cookie
        if csrf and self.csrf and method != "GET":
            h["X-CSRF-Token"] = self.csrf
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=30)
        try:
            c.request(method, path, body=data, headers=h)
            r = c.getresponse()
            out = Resp(r.status, {k.lower(): v for k, v in r.getheaders()}, r.read())
        finally:
            c.close()
        sc = out.headers.get("set-cookie")
        if sc and sc.startswith("cl_session="):
            val = sc.split(";")[0].split("=", 1)[1]
            self.cookie = val or None
        return out

    def relogin(self):
        return self.login(*self.creds)

    def login(self, email, password):
        self.creds = (email, password)
        r = self.req("POST", "/api/login", {"email": email, "password": password})
        if r.status == 200:
            self.csrf = r.json["csrf"]
        return r

    def get(self, path):
        return self.req("GET", path)

    def case(self, cid):
        return self.get("/api/cases/" + cid)

    def cmd(self, cid, ctype, version=None, key=None, **params):
        if version is None:
            version = self.case(cid).json["version"]
        body = dict(params, type=ctype, idempotency_key=key or str(uuid.uuid4()), expected_version=version)
        return self.req("POST", "/api/cases/%s/commands" % cid, body)

    def evidence(self, cid, filename, content_type, data, **extra):
        body = dict(extra, filename=filename, content_type=content_type,
                    data_base64=base64.b64encode(data).decode("ascii"))
        return self.req("POST", "/api/cases/%s/evidence" % cid, body)


class ServerCase(unittest.TestCase):
    """Fresh DB + server per test."""

    def setUp(self):
        self.env = Env()
        self.start()

    def start(self):
        self.srv, self.thread = server.serve_in_thread(self.env.path)
        self.port = self.srv.server_address[1]

    def stop(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.thread.join(5)

    def tearDown(self):
        self.stop()
        self.env.close()

    def client(self, role="operator", org="harbourline"):
        c = Client(self.port)
        email = {"operator": "operator@%s.test", "reviewer": "reviewer@%s.test", "reviewer2": "reviewer2@%s.test",
                 "viewer": "viewer@%s.test"}[role] % org
        pw = "pilot-dev-" + ("reviewer" if role == "reviewer2" else role)
        r = c.login(email, pw)
        assert r.status == 200, r
        return c

    def assertOk(self, r, status=200):
        self.assertEqual(r.status, status, r)
        return r.json

    def assertIdentities(self, view):
        bad = [i for i in view["identities"] if not i["ok"]]
        self.assertEqual(bad, [], "identities broken: %r" % bad)

    def new_case(self, c, **over):
        r = c.req("POST", "/api/cases", kestrel_body(**over))
        self.assertEqual(r.status, 201, r)
        return r.json

    def add_balance(self, c, cid, amount="20,000.00", as_of="2026-12-01T00:30:00Z", currency="SGD", evidence=True):
        params = {"kind": "balance", "amount": amount, "currency": currency, "as_of": as_of,
                  "source": "Bank portal export (synthetic)"}
        if evidence:
            ev = c.evidence(cid, "balance.csv", "text/csv", b"date,balance\n2026-12-01,20000.00\n")
            self.assertEqual(ev.status, 201, ev)
            params["evidence_id"] = ev.json["evidence_added"]["id"]
        r = c.cmd(cid, "add_observation", **params)
        self.assertEqual(r.status, 200, r)
        return r.json

    def route(self, view, key):
        return next(r for r in view["routes"] if r["key"] == key)

    def action(self, view, ctype, preset=None):
        for a in view["actions"]:
            if a["type"] == ctype and (preset is None or a.get("preset") == preset):
                return a
        return None

    def to_reserved(self, op, rv, **over):
        v = self.new_case(op, **over)
        cid = v["id"]
        self.add_balance(op, cid)
        r = op.cmd(cid, "request_advance", reason="Importer wants to keep cash until its receivable settles")
        self.assertEqual(r.status, 200, r)
        r = rv.cmd(cid, "approve_and_reserve", reason="Within limit; balance fresh")
        self.assertEqual(r.status, 200, r)
        return cid, r.json
