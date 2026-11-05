"""Independent adversarial challenge of the pilot desk.

Every test drives a *running* server in a separate OS process (``python3 -m pilot.cli serve``) over HTTP and checks
the database through separate sqlite connections. Concurrency attacks use separate worker processes.

Tests named in the challenger report as defects are expected to FAIL against commit 3a70135; every other test
documents an attack that is resisted.
"""

import base64
import hashlib
import http.client
import json
import multiprocessing
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)

from backend_support import Client, kestrel_body  # noqa: E402
from pilot import connector  # noqa: E402

T0 = "2026-12-01T01:00:00Z"  # Tue 1 Dec 2026 09:00 SGT
SECRET = "challenger-secret"
OWED_TOTAL = "89,600.25"  # principal 89,450.25 + flat fee 150.00 (Harbourline facility)

REVIEWER_ONLY = ["approve_and_reserve", "decline", "request_evidence", "release_reservation", "authorize_draw",
                 "return_unmatched", "reverse_match", "close_with_exception", "authorize_reinstruction"]
OPERATOR_ONLY = ["select_route", "request_advance", "record_prefunding", "record_draw", "instruct_payout",
                 "record_delivery", "query_payout_status", "record_customer_receipt", "record_repayment",
                 "match_repayment", "resolve_duplicate", "close_case"]
SHARED = ["add_observation", "supersede_observation", "add_note", "assign_owner"]
ALL_COMMANDS = REVIEWER_ONLY + OPERATOR_ONLY + SHARED


# ---------------------------------------------------------------- process / server helpers
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class Srv(object):
    """A pilot server in its own OS process on its own DB file."""

    def __init__(self, db_path=None, clock=T0, seed=True):
        self.dir = tempfile.mkdtemp(prefix="pilot-chal-")
        self.db = db_path or os.path.join(self.dir, "x.db")
        self.clock = clock
        self.proc = None
        if seed:
            self.cli("migrate")
            self.cli("seed")

    def envd(self, clock=None, db=None):
        e = dict(os.environ, PILOT_ENV="test", PILOT_DB=db or self.db, PILOT_SECRET=SECRET,
                 PILOT_CLOCK=clock or self.clock, PILOT_LOG_LEVEL="WARNING")
        return e

    def cli(self, *args, db=None, check=True):
        r = subprocess.run([sys.executable, "-m", "pilot.cli"] + list(args), cwd=ROOT, env=self.envd(db=db),
                           capture_output=True, text=True, timeout=120)
        if check and r.returncode != 0:
            raise AssertionError("cli %s failed: %s %s" % (args, r.stdout, r.stderr))
        return r

    def start(self, clock=None):
        if clock:
            self.clock = clock
        self.port = free_port()
        self.proc = subprocess.Popen([sys.executable, "-m", "pilot.cli", "serve", "--port", str(self.port)],
                                     cwd=ROOT, env=self.envd(), stdout=subprocess.DEVNULL,
                                     stderr=subprocess.DEVNULL)
        for _ in range(200):
            try:
                c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
                c.request("GET", "/api/health")
                if c.getresponse().status == 200:
                    c.close()
                    return self
            except OSError:
                time.sleep(0.05)
        raise AssertionError("server did not start")

    def stop(self):
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            self.proc = None

    def restart(self, clock):
        self.stop()
        return self.start(clock)

    def sql(self, q, args=()):
        c = sqlite3.connect(self.db, timeout=15)
        try:
            c.row_factory = sqlite3.Row
            rows = [dict(r) for r in c.execute(q, args).fetchall()]
            c.commit()
            return rows
        finally:
            c.close()

    def scalar(self, q, args=()):
        r = self.sql(q, args)
        return list(r[0].values())[0] if r else None

    def close(self):
        self.stop()
        shutil.rmtree(self.dir, ignore_errors=True)


def _req(port, method, path, body=None, cookie=None, csrf=None, headers=None, raw=None):
    h = dict(headers or {})
    data = raw
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h.setdefault("Content-Type", "application/json")
    if cookie:
        h["Cookie"] = "cl_session=" + cookie
    if csrf:
        h["X-CSRF-Token"] = csrf
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
    try:
        c.request(method, path, body=data, headers=h)
        r = c.getresponse()
        raw_out = r.read()
        try:
            j = json.loads(raw_out.decode("utf-8"))
        except ValueError:
            j = None
        return r.status, j
    finally:
        c.close()


def _wait(start_at):
    d = start_at - time.time()
    if d > 0:
        time.sleep(d)


def w_command(args):
    """Worker (separate process): one command with a fresh idempotency key and a given expected_version."""
    port, cookie, csrf, cid, ctype, params, version, start_at = args
    _wait(start_at)
    body = dict(params, type=ctype, idempotency_key=str(uuid.uuid4()), expected_version=version)
    st, j = _req(port, "POST", "/api/cases/%s/commands" % cid, body, cookie, csrf)
    return st, ((j or {}).get("error") or {}).get("code")


def w_command_retry(args):
    """Worker: keep retrying on stale_version (fresh version + fresh key each time) — defeats optimistic locking
    so only domain preconditions and DB constraints can stop a duplicate."""
    port, cookie, csrf, cid, ctype, params, start_at = args
    _wait(start_at)
    last = None
    for _ in range(40):
        st, v = _req(port, "GET", "/api/cases/" + cid, None, cookie)
        body = dict(params, type=ctype, idempotency_key=str(uuid.uuid4()), expected_version=v["version"])
        st, j = _req(port, "POST", "/api/cases/%s/commands" % cid, body, cookie, csrf)
        code = ((j or {}).get("error") or {}).get("code")
        last = (st, code)
        if code != "stale_version":
            return last
    return last


def pool_map(fn, jobs):
    ctx = multiprocessing.get_context("fork")
    with ctx.Pool(len(jobs)) as p:
        return p.map(fn, jobs)


# ---------------------------------------------------------------- base test case
class Base(unittest.TestCase):
    clock = T0

    def setUp(self):
        self.s = Srv(clock=self.clock)
        self.s.start()

    def tearDown(self):
        self.s.close()

    def client(self, role="operator", org="harbourline"):
        c = Client(self.s.port)
        email = {"operator": "operator@%s.test", "reviewer": "reviewer@%s.test",
                 "reviewer2": "reviewer2@%s.test", "viewer": "viewer@%s.test"}[role] % org
        pw = "pilot-dev-" + ("reviewer" if role == "reviewer2" else role)
        r = c.login(email, pw)
        self.assertEqual(r.status, 200, r)
        return c

    def restart(self, clock, *clients):
        """Restart the server process with a new PILOT_CLOCK and sign the given clients in again."""
        self.s.restart(clock)
        for c in clients:
            c.port = self.s.port
            self.assertEqual(c.relogin().status, 200)

    def ok(self, r, status=200):
        self.assertEqual(r.status, status, r)
        return r.json

    def new_case(self, c, **over):
        return self.ok(c.req("POST", "/api/cases", kestrel_body(**over)), 201)

    def add_balance(self, c, cid, amount="20,000.00", as_of="2026-12-01T00:30:00Z", currency="SGD"):
        ev = self.ok(c.evidence(cid, "balance.csv", "text/csv", b"date,balance\n2026-12-01,20000.00\n"), 201)
        return self.ok(c.cmd(cid, "add_observation", kind="balance", amount=amount, currency=currency, as_of=as_of,
                             source="Bank portal export (synthetic)", evidence_id=ev["evidence_added"]["id"]))

    def requested(self, op, **over):
        cid = self.new_case(op, **over)["id"]
        self.add_balance(op, cid)
        self.ok(op.cmd(cid, "request_advance", reason="Keep cash until receivable settles"))
        return cid

    def reserved(self, op, rv, **over):
        cid = self.requested(op, **over)
        self.ok(rv.cmd(cid, "approve_and_reserve", reason="Within limit"))
        return cid

    def drawn(self, op, rv, **over):
        cid = self.reserved(op, rv, **over)
        self.ok(op.cmd(cid, "record_draw", reference="DRAW-1"))
        return cid

    def credited(self, op, rv, ext="EXT-1", **over):
        cid = self.drawn(op, rv, **over)
        self.ok(op.cmd(cid, "instruct_payout", route="manual", external_ref=ext))
        self.ok(op.cmd(cid, "record_delivery", status="credited", reference="MT103-CONF"))
        return cid

    def event_count(self, cid):
        return self.s.scalar("SELECT COUNT(*) FROM events WHERE case_id=?", (cid,))

    def version(self, cid):
        return self.s.scalar("SELECT version FROM cases WHERE id=?", (cid,))

    def facility_ok(self, fid="FAC-HL-01"):
        f = self.s.sql("SELECT * FROM facilities WHERE id=?", (fid,))[0]
        res = self.s.scalar("SELECT IFNULL(SUM(amount_minor),0) FROM reservations WHERE facility_id=? AND "
                            "status='active'", (fid,))
        out = self.s.scalar("SELECT IFNULL(SUM(principal_minor-principal_repaid_minor),0) FROM draws WHERE "
                            "facility_id=?", (fid,))
        available = f["limit_minor"] - res - out
        self.assertEqual(f["limit_minor"], available + res + out)
        self.assertGreaterEqual(available, 0, "limit overcommitted")
        self.assertGreaterEqual(f["funding_account_start_minor"] - res - out, 0, "funding cash overcommitted")
        return res, out

    def signed_event(self, c, ev, secret=SECRET, sig=None):
        body = connector.event_body(ev)
        return c.req("POST", "/api/connector/sandbox/events", raw=body, csrf=False,
                     headers={connector.SIGNATURE_HEADER: sig if sig is not None else connector.sign(secret, body)})


# ================================================================ 1. tenant isolation, sessions, CSRF, viewer
class TenantIsolationTest(Base):
    def setUp(self):
        Base.setUp(self)
        self.a_op, self.a_rv = self.client(), self.client("reviewer")
        self.b_op, self.b_rv = self.client("operator", "meridian"), self.client("reviewer", "meridian")
        self.b_view = self.b_op  # B has no viewer account
        # Org A: a credited case with evidence, repayments (one wrong currency), match, and a sandbox case.
        self.cid = self.credited(self.a_op, self.a_rv, importer="Aardvark Secret Importer",
                                 supplier="Zebra Hidden Supplier", reference="PO-SECRET-777",
                                 quote_ref="QT-SECRET-1")
        self.ok(self.a_op.cmd(self.cid, "record_repayment", amount="1,000.00", currency="USD",
                              bank_ref="BR-SECRET-1"))
        self.ok(self.a_op.cmd(self.cid, "record_repayment", amount="500.00", currency="SGD",
                              bank_ref="BR-SECRET-2"))
        v = self.ok(self.a_op.case(self.cid))
        self.rp_ids = [r["id"] for r in v["collections"]["repayments"]]
        v = self.ok(self.a_op.cmd(self.cid, "match_repayment", repayment_id=self.rp_ids[0]))
        self.match_id = v["collections"]["matches"][0]["id"]
        self.um_id = v["collections"]["unmatched"][0]["id"]
        self.ev_id = v["evidence"][0]["id"]
        self.obs_event = v["observations"][0]["event_id"]
        self.sbx = self.drawn(self.a_op, self.a_rv, importer="Aardvark Secret Importer")
        sv = self.ok(self.a_op.cmd(self.sbx, "instruct_payout", route="sandbox"))
        self.pref = sv["supplier_panel"]["provider_ref"]
        self.a_versions = {c: self.version(c) for c in (self.cid, self.sbx)}
        self.a_events = {c: self.event_count(c) for c in (self.cid, self.sbx)}

    def assertAUnchanged(self):
        for c in (self.cid, self.sbx):
            self.assertEqual(self.version(c), self.a_versions[c], "org A case %s changed" % c)
            self.assertEqual(self.event_count(c), self.a_events[c], "org A case %s gained events" % c)

    def assertNoLeak(self, r):
        raw = r.raw or b""
        if r.json and isinstance(r.json, dict) and "q" in r.json:  # search echoes the caller's own query
            raw = json.dumps(r.json.get("results")).encode()
        for secret in (b"Aardvark", b"Zebra Hidden", b"PO-SECRET", b"QT-SECRET", b"BR-SECRET", b"FAC-HL-01",
                       b"harbourline", b"Olivia", b"Ravi", self.cid.encode(), self.sbx.encode(), self.pref.encode()):
            self.assertNotIn(secret, raw, "leak of %r in %r" % (secret, raw[:300]))

    def test_cross_org_reads_search_export_evidence_are_404_and_leak_nothing(self):
        for c in (self.b_op, self.b_rv):
            for cid in (self.cid, self.sbx, self.cid.lower(), self.cid + "%", " " + self.cid):
                r = c.get("/api/cases/" + cid.replace(" ", "%20").replace("%", "%25") if "%" in cid else
                          "/api/cases/" + cid.replace(" ", "%20"))
                self.assertIn(r.status, (404,), r)
                self.assertNoLeak(r)
            for fmt in ("json", "csv", "html", "xml", ""):
                r = c.get("/api/cases/%s/export?format=%s" % (self.cid, fmt))
                self.assertEqual(r.status, 404, r)
                self.assertNoLeak(r)
            r = c.get("/api/cases/%s/evidence/%s" % (self.cid, self.ev_id))
            self.assertEqual(r.status, 404, r)
            self.assertNoLeak(r)
            own = self.new_case(c)["id"]
            r = c.get("/api/cases/%s/evidence/%s" % (own, self.ev_id))  # B's case id + A's evidence id
            self.assertEqual(r.status, 404, r)
            self.assertNoLeak(r)
            for q in (self.cid, self.cid[:9], self.cid[-3:], "Aardvark", "aardvark", "ardv", "Zebra", "Hidden",
                      "PO-SECRET-777", "SECRET", "QT-SECRET", "%", "_", "%%", "' OR '1'='1", "\") OR 1=1 --",
                      "CL-", "", "*"):
                r = c.get("/api/cases?q=" + __import__("urllib.parse").parse.quote(q))
                self.assertEqual(r.status, 200, r)
                ids = [x["case_id"] for x in r.json["results"]]
                self.assertNotIn(self.cid, ids)
                self.assertNotIn(self.sbx, ids)
                self.assertNoLeak(r)
            for path in ("/api/queue", "/api/facilities", "/api/users", "/api/me", "/api/health"):
                r = c.get(path)
                self.assertEqual(r.status, 200, r)
                self.assertNoLeak(r)
        self.assertAUnchanged()

    def test_cross_org_every_command_evidence_and_sandbox_advance_is_404(self):
        params = {"reason": "x", "what": "x", "route": "manual", "external_ref": "EXT-B", "status": "credited",
                  "amount": "1.00", "currency": "SGD", "bank_ref": "B", "repayment_id": self.rp_ids[1],
                  "item_id": self.um_id, "match_id": self.match_id, "disposition": "write_off_referred",
                  "event_id": self.obs_event, "kind": "note", "text": "x", "reference": "x", "user_id": 1,
                  "resolution": "duplicate"}
        for c in (self.b_op, self.b_rv):
            for ctype in ALL_COMMANDS:
                for ver in (self.a_versions[self.cid], 0, 1):
                    body = dict(params, type=ctype, idempotency_key=str(uuid.uuid4()), expected_version=ver)
                    r = c.req("POST", "/api/cases/%s/commands" % self.cid, body)
                    self.assertEqual(r.status, 404, (ctype, r))
                    self.assertNoLeak(r)
            r = c.evidence(self.cid, "x.txt", "text/plain", b"hello")
            self.assertEqual(r.status, 404, r)
            for to_kind in (None, "credited", "returned", "failed"):
                r = c.req("POST", "/api/cases/%s/sandbox/advance" % self.sbx, {"to_kind": to_kind})
                self.assertEqual(r.status, 404, r)
                self.assertNoLeak(r)
        self.assertAUnchanged()
        st = self.s.sql("SELECT status FROM sandbox_payouts WHERE provider_ref=?", (self.pref,))
        self.assertEqual(st, [{"status": "accepted"}])

    def test_cross_org_ids_inside_own_case_are_rejected(self):
        own = self.new_case(self.b_op)["id"]
        r = self.b_op.cmd(own, "add_observation", kind="balance", amount="1.00", currency="SGD",
                          as_of="2026-12-01T00:30:00Z", source="x", evidence_id=self.ev_id)
        self.assertEqual(r.status, 422, r)
        r = self.b_op.cmd(own, "supersede_observation", event_id=self.obs_event, reason="x", amount="1.00",
                          currency="SGD", as_of="2026-12-01T00:30:00Z", source="x")
        self.assertIn(r.status, (404, 409), r)
        a_user = self.s.scalar("SELECT id FROM users WHERE email='operator@harbourline.test'")
        r = self.b_op.cmd(own, "assign_owner", user_id=a_user)
        self.assertEqual(r.status, 422, r)
        r = self.b_op.cmd(own, "instruct_payout", route="manual", external_ref="EXT-1", evidence_id=self.ev_id)
        self.assertEqual(r.status, 409, r)  # not funded; never touches A
        self.assertAUnchanged()

    def test_cross_org_idempotency_key_is_not_replayed(self):
        key = self.s.scalar("SELECT key FROM idempotency WHERE org_id='ORG-HL' AND command='create_case' LIMIT 1")
        body = kestrel_body(idempotency_key=key)
        r = self.b_op.req("POST", "/api/cases", body)
        self.assertEqual(r.status, 201, r)
        self.assertFalse(r.json.get("idempotent_replay"))
        self.assertNoLeak(r)
        akey = self.s.scalar("SELECT key FROM idempotency WHERE org_id='ORG-HL' AND command='record_repayment' "
                             "LIMIT 1")
        r = self.b_op.cmd(r.json["id"], "add_note", key=akey, text="hi")
        self.assertEqual(r.status, 200, r)
        self.assertNoLeak(r)
        self.assertAUnchanged()

    def test_sandbox_ingestion_naming_other_orgs_provider_ref_needs_the_server_signature(self):
        ev = {"provider_event_id": self.pref + "-E99", "provider_ref": self.pref, "payout_ref": self.sbx + "-P1",
              "kind": "credited", "occurred_at": T0}
        body = connector.event_body(ev)
        for c in (self.b_op, self.b_rv):
            for sig in (None, "", "00" * 32, connector.sign("pilot-dev-sandbox-secret", body),
                        connector.sign("", body) if False else "zz", c.csrf):
                hdr = {} if sig is None else {connector.SIGNATURE_HEADER: sig}
                r = c.req("POST", "/api/connector/sandbox/events", raw=body, headers=hdr)
                self.assertEqual(r.status, 401, r)
            r = c.req("POST", "/api/connector/sandbox/events", raw=body,
                      headers={"X-Sandbox-Signature": connector.sign("pilot-dev-sandbox-secret", body)})
            self.assertEqual(r.status, 401, r)
        self.assertAUnchanged()

    def test_case_ids_do_not_reveal_other_orgs_case_volume(self):
        """DEFECT (minor): case ids come from one global counter, so org B's next id tells it how many cases every
        other org has created (contract §5 says ids are per org)."""
        n_a = self.s.scalar("SELECT COUNT(*) FROM cases WHERE org_id='ORG-HL'")
        b1 = self.new_case(self.b_op)["id"]
        b2 = self.new_case(self.b_op)["id"]
        nb1, nb2 = int(b1.rsplit("-", 1)[1]), int(b2.rsplit("-", 1)[1])
        self.assertEqual(nb2 - nb1, 1)
        self.assertLessEqual(nb1, 1, "org B's first case is %s after org A created %d cases: the id sequence "
                                     "discloses another customer's volume" % (b1, n_a))


class SessionCsrfRoleTest(Base):
    def test_csrf_required_on_every_mutating_endpoint(self):
        op = self.client()
        other = self.client("operator", "meridian")
        rv = self.client("reviewer")
        cid = self.drawn(op, rv)
        self.ok(op.cmd(cid, "instruct_payout", route="sandbox"))
        v0, e0 = self.version(cid), self.event_count(cid)
        n_cases = self.s.scalar("SELECT COUNT(*) FROM cases")
        endpoints = [
            ("/api/cases", kestrel_body()),
            ("/api/cases/import", {"csv": "importer\nx\n", "dry_run": False}),
            ("/api/cases/%s/commands" % cid, {"type": "add_note", "text": "x", "idempotency_key": str(uuid.uuid4()),
                                              "expected_version": v0}),
            ("/api/cases/%s/evidence" % cid, {"filename": "a.txt", "content_type": "text/plain",
                                              "data_base64": base64.b64encode(b"x").decode()}),
            ("/api/cases/%s/sandbox/advance" % cid, {"to_kind": "credited"}),
            ("/api/logout", {}),
        ]
        for path, body in endpoints:
            for hdr in ({}, {"X-CSRF-Token": ""}, {"X-CSRF-Token": "wrong"}, {"X-CSRF-Token": other.csrf},
                        {"X-CSRF-Token": op.csrf + " "}, {"x-csrf-token": op.csrf.upper()}):
                r = op.req("POST", path, body, headers=hdr, csrf=False)
                self.assertEqual(r.status, 403, (path, hdr, r))
            # Form-encoded cross-site POST (no custom header possible) is refused too.
            r = op.req("POST", path, raw=b"a=b", ctype="application/x-www-form-urlencoded", csrf=False)
            self.assertIn(r.status, (403, 415), (path, r))
        self.assertEqual((self.version(cid), self.event_count(cid)), (v0, e0))
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM cases"), n_cases)
        self.assertEqual(op.get("/api/me").status, 200)  # logout without CSRF did not log out

    def test_session_fixation_logout_and_disabled_user(self):
        fixed = "attacker-chosen-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        c = Client(self.s.port)
        c.cookie = fixed
        self.assertEqual(c.login("operator@harbourline.test", "pilot-dev-operator").status, 200)
        self.assertNotEqual(c.cookie, fixed)
        att = Client(self.s.port)
        att.cookie = fixed
        self.assertEqual(att.get("/api/me").status, 401)
        th = hashlib.sha256(c.cookie.encode()).hexdigest()
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM sessions WHERE token_hash=?", (th,)), 1)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM sessions WHERE token_hash=?", (c.cookie,)), 0)
        stolen = c.cookie
        self.assertEqual(c.req("POST", "/api/logout", {}).status, 200)
        att.cookie = stolen
        self.assertEqual(att.get("/api/me").status, 401)
        d = self.client("viewer")
        self.s.sql("UPDATE users SET disabled=1 WHERE email='viewer@harbourline.test'")
        self.assertEqual(d.get("/api/queue").status, 401)

    def test_viewer_cannot_mutate_anything(self):
        op, rv, vw = self.client(), self.client("reviewer"), self.client("viewer")
        cid = self.drawn(op, rv)
        self.ok(op.cmd(cid, "instruct_payout", route="sandbox"))
        v0, e0 = self.version(cid), self.event_count(cid)
        for ctype in ALL_COMMANDS:
            r = vw.cmd(cid, ctype, reason="x", text="x", route="manual", external_ref="E", status="credited")
            self.assertEqual(r.status, 403, (ctype, r))
        self.assertEqual(vw.req("POST", "/api/cases", kestrel_body()).status, 403)
        self.assertEqual(vw.req("POST", "/api/cases/import", {"csv": "a\n", "dry_run": True}).status, 403)
        self.assertEqual(vw.evidence(cid, "a.txt", "text/plain", b"x").status, 403)
        self.assertEqual(vw.req("POST", "/api/cases/%s/sandbox/advance" % cid, {}).status, 403)
        for m in ("PUT", "DELETE", "PATCH"):
            self.assertIn(vw.req(m, "/api/cases/" + cid, {}).status, (403, 404, 405))
        self.assertEqual((self.version(cid), self.event_count(cid)), (v0, e0))
        self.assertEqual(self.s.scalar("SELECT status FROM sandbox_payouts"), "accepted")

    def test_operator_cannot_run_reviewer_commands_and_vice_versa(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.requested(op)
        for ctype in REVIEWER_ONLY:
            r = op.cmd(cid, ctype, reason="x", what="x", disposition="write_off_referred", item_id="UM-1",
                       match_id="MT-1", reference="x")
            self.assertEqual((r.status, r.code), (403, "forbidden"), ctype)
        for ctype in OPERATOR_ONLY:
            r = rv.cmd(cid, ctype, reason="x", route="A", amount="1.00", currency="SGD", bank_ref="b",
                       external_ref="E", status="credited", reference="r")
            self.assertEqual((r.status, r.code), (403, "forbidden"), ctype)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM reservations"), 0)

    def test_four_eyes_survives_role_change_mid_session(self):
        op, rv2 = self.client(), self.client("reviewer2")
        cid = self.requested(op)
        # The requester is promoted to reviewer while still signed in: they still cannot approve their own request.
        self.s.sql("UPDATE users SET role='reviewer' WHERE email='operator@harbourline.test'")
        r = op.cmd(cid, "approve_and_reserve", reason="self approve")
        self.assertEqual((r.status, r.code), (403, "four_eyes"), r)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM reservations"), 0)
        # A reviewer demoted to viewer mid-session loses the right immediately.
        self.s.sql("UPDATE users SET role='viewer' WHERE email='reviewer2@harbourline.test'")
        self.assertEqual(rv2.cmd(cid, "approve_and_reserve", reason="x").status, 403)
        self.s.sql("UPDATE users SET role='reviewer' WHERE email='reviewer2@harbourline.test'")
        self.ok(rv2.cmd(cid, "approve_and_reserve", reason="second reviewer"))
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM reservations WHERE status='active'"), 1)


# ================================================================ 3. capacity under concurrent processes
class CapacityTest(Base):
    def _approve_all(self, cids, reviewers):
        start = time.time() + 1.0
        jobs = []
        for i, cid in enumerate(cids):
            rv = reviewers[i % len(reviewers)]
            jobs.append((self.s.port, rv.cookie, rv.csrf, cid, "approve_and_reserve", {"reason": "race"},
                         self.version(cid), start))
        return pool_map(w_command, jobs)

    def test_concurrent_approvals_cannot_exceed_headroom(self):
        op = self.client()
        cids = [self.requested(op) for _ in range(8)]  # 8 x 89,450.25 = 715,602.00 > limit 500,000.00
        res = self._approve_all(cids, [self.client("reviewer"), self.client("reviewer2")])
        ok = [r for r in res if r[0] == 200]
        self.assertEqual(len(ok), 5, res)  # floor(500,000.00 / 89,450.25)
        self.assertTrue(all(r == (409, "insufficient_capacity") for r in res if r[0] != 200), res)
        res_sum, out = self.facility_ok()
        self.assertEqual(res_sum, 5 * 8945025)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM events WHERE type='advance_approved'"), 5)
        f = self.ok(op.get("/api/facilities"))["facilities"][0]
        self.assertTrue(f["identity"]["ok"], f)

    def test_concurrent_approvals_cannot_exceed_funding_cash(self):
        self.s.sql("UPDATE facilities SET funding_account_start_minor=20000000 WHERE id='FAC-HL-01'")  # 200,000.00
        op = self.client()
        cids = [self.requested(op) for _ in range(5)]
        res = self._approve_all(cids, [self.client("reviewer"), self.client("reviewer2")])
        self.assertEqual(len([r for r in res if r[0] == 200]), 2, res)
        self.facility_ok()

    def test_concurrent_draw_instruct_match_on_one_case_with_retries(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.reserved(op, rv)
        start = time.time() + 1.0
        jobs = [(self.s.port, op.cookie, op.csrf, cid, "record_draw", {"reference": "D-%d" % i}, start)
                for i in range(6)]
        res = pool_map(w_command_retry, jobs)
        self.assertEqual(len([r for r in res if r[0] == 200]), 1, res)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM draws WHERE case_id=?", (cid,)), 1)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM events WHERE case_id=? AND type='draw_recorded'",
                                       (cid,)), 1)
        start = time.time() + 1.0
        jobs = [(self.s.port, op.cookie, op.csrf, cid, "instruct_payout",
                 ({"route": "manual", "external_ref": "EXT-%d" % i} if i % 2 else {"route": "sandbox"}), start)
                for i in range(6)]
        res = pool_map(w_command_retry, jobs)
        self.assertEqual(len([r for r in res if r[0] == 200]), 1, res)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM payouts WHERE case_id=?", (cid,)), 1)
        self.assertLessEqual(self.s.scalar("SELECT COUNT(*) FROM sandbox_payouts"), 1)
        route = self.s.scalar("SELECT route FROM payouts WHERE case_id=?", (cid,))
        if route == "manual":
            self.ok(op.cmd(cid, "record_delivery", status="credited"))
        self.ok(op.cmd(cid, "record_repayment", amount="50,000.00", currency="SGD", bank_ref="BR-RACE"))
        rid = self.ok(op.case(cid))["collections"]["repayments"][0]["id"]
        start = time.time() + 1.0
        jobs = [(self.s.port, op.cookie, op.csrf, cid, "match_repayment", {"repayment_id": rid}, start)
                for _ in range(6)]
        res = pool_map(w_command_retry, jobs)
        self.assertEqual(len([r for r in res if r[0] == 200]), 1, res)
        d = self.s.sql("SELECT principal_minor, principal_repaid_minor FROM draws WHERE case_id=?", (cid,))[0]
        self.assertEqual(d["principal_repaid_minor"], 5000000 - 15000)  # fees first
        v = self.ok(op.case(cid))
        self.assertTrue(all(i["ok"] for i in v["identities"]), v["identities"])
        self.facility_ok()


    def test_reservation_expiry_edge_blocks_draw_and_frees_capacity(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.reserved(op, rv)
        exp = self.s.scalar("SELECT expires_at FROM reservations WHERE case_id=?", (cid,))
        self.assertEqual(exp, "2026-12-04T01:00:00Z")  # min(T0 + 72 h, deadline - 8 h lead)
        self.restart("2026-12-04T01:00:00Z", op, rv)  # exactly at expiry
        r = op.cmd(cid, "record_draw", reference="late")
        self.assertEqual(r.status, 409, r)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM draws"), 0)
        self.assertEqual(self.s.scalar("SELECT status FROM reservations WHERE case_id=?", (cid,)), "expired")
        self.assertEqual(self.facility_ok(), (0, 0))


# ================================================================ 4. duplicates and ordering
class DuplicatesTest(Base):
    def test_same_command_with_new_keys_is_refused(self):
        op, rv, rv2 = self.client(), self.client("reviewer"), self.client("reviewer2")
        cid = self.reserved(op, rv)
        self.assertEqual(rv2.cmd(cid, "approve_and_reserve", reason="again").code, "not_requested")
        self.ok(op.cmd(cid, "record_draw", reference="D1"))
        self.assertEqual(op.cmd(cid, "record_draw", reference="D2").code, "already_drawn")
        self.ok(op.cmd(cid, "instruct_payout", route="manual", external_ref="E1"))
        for p in ({"route": "manual", "external_ref": "E2"}, {"route": "sandbox"}):
            self.assertEqual(op.cmd(cid, "instruct_payout", **p).code, "payout_live")
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM reservations WHERE case_id=?", (cid,)), 1)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM draws"), 1)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM payouts"), 1)

    def test_idempotent_replay_and_conflict(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        v = op.case(cid).json["version"]
        key = str(uuid.uuid4())
        r1 = op.cmd(cid, "add_note", version=v, key=key, text="hello")
        r2 = op.cmd(cid, "add_note", version=v, key=key, text="hello")
        self.assertTrue(r2.json.get("idempotent_replay"))
        # §13: system events (duplicate check, eligibility checkpoints) are excluded; one case_created + one note.
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM events WHERE case_id=? AND provenance<>'system'", (cid,)), 2)
        r3 = op.cmd(cid, "add_note", version=v, key=key, text="changed")
        self.assertEqual((r3.status, r3.code), (409, "idempotency_conflict"))
        other = self.new_case(op)["id"]
        r4 = op.cmd(other, "add_note", version=1, key=key, text="hello")
        self.assertEqual(r4.status, 409, r4)
        self.assertEqual(r1.status, 200)

    def test_forged_replayed_out_of_order_and_unknown_sandbox_events(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.drawn(op, rv)
        v = self.ok(op.cmd(cid, "instruct_payout", route="sandbox", scenario="out_of_order"))
        pref = v["supplier_panel"]["provider_ref"]
        base = {"provider_ref": pref, "payout_ref": cid + "-P1", "occurred_at": T0}
        cred = dict(base, provider_event_id=pref + "-X1", kind="credited")
        # bad signature, wrong secret, signature over a different body
        self.assertEqual(self.signed_event(op, cred, sig="ab" * 32).status, 401)
        self.assertEqual(self.signed_event(op, cred, secret="nope").status, 401)
        other = connector.sign(SECRET, connector.event_body(dict(cred, kind="accepted")))
        self.assertEqual(self.signed_event(op, cred, sig=other).status, 401)
        self.assertEqual(self.ok(op.case(cid))["supplier_panel"]["status"], "accepted")
        # credited (before any separate acceptance event)
        r = self.signed_event(op, cred)
        self.assertEqual(r.status, 200, r)
        self.assertTrue(r.json["applied"])
        n = self.event_count(cid)
        # replay of the same provider_event_id (even with a different kind) is a no-op
        for k in ("credited", "failed", "returned"):
            r = self.signed_event(op, dict(cred, kind=k))
            self.assertTrue(r.json["duplicate"], r)
        self.assertEqual(self.event_count(cid), n)
        # late acceptance and failure-after-credit are stored, not applied
        for i, k in enumerate(("accepted", "failed")):
            r = self.signed_event(op, dict(base, provider_event_id=pref + "-L%d" % i, kind=k))
            self.assertEqual((r.status, r.json["applied"]), (200, False), r)
        v = self.ok(op.case(cid))
        self.assertEqual(v["supplier_panel"]["status"], "credited")
        # unknown refs, malformed bodies, oversized
        r = self.signed_event(op, dict(cred, provider_ref="SBX-UNKNOWN", payout_ref="CL-1999-00001-P1",
                                       provider_event_id="u1"))
        self.assertEqual(r.status, 404)
        for bad in ({"provider_event_id": "z", "provider_ref": pref, "kind": "paid", "occurred_at": T0},
                    {"provider_event_id": "z", "provider_ref": pref, "kind": "credited", "occurred_at": "never"},
                    {"provider_event_id": "", "provider_ref": pref, "kind": "credited", "occurred_at": T0}):
            self.assertEqual(self.signed_event(op, bad).status, 400, bad)
        self.assertEqual(self.ok(op.case(cid))["supplier_panel"]["status"], "credited")
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM payouts"), 1)
        # authorize_reinstruction is impossible after credit; no second payout possible
        self.assertEqual(rv.cmd(cid, "authorize_reinstruction", reason="x").code, "not_failed")
        self.assertEqual(op.cmd(cid, "instruct_payout", route="sandbox").code, "payout_live")

    def test_timeout_never_creates_a_second_payout_or_draw(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.drawn(op, rv)
        v = self.ok(op.cmd(cid, "instruct_payout", route="sandbox", scenario="timeout_then_accept"))
        self.assertEqual(v["supplier_panel"]["status"], "unknown")
        for p in ({"route": "sandbox"}, {"route": "manual", "external_ref": "M1"}):
            self.assertEqual(op.cmd(cid, "instruct_payout", **p).code, "delivery_unknown")
        self.assertEqual(rv.cmd(cid, "authorize_reinstruction", reason="x").code, "not_failed")
        self.assertEqual(op.cmd(cid, "record_delivery", status="failed").code, "sandbox_route")
        self.assertEqual(op.cmd(cid, "record_draw", reference="D2").code, "already_drawn")
        for _ in range(3):
            self.ok(op.cmd(cid, "query_payout_status"))
        r = op.req("POST", "/api/cases/%s/sandbox/advance" % cid, {"deliver_only": True})
        self.assertEqual(r.status, 200, r)
        sp = self.s.sql("SELECT submit_count FROM sandbox_payouts")
        self.assertEqual(sp, [{"submit_count": 1}])
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM payouts"), 1)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM draws"), 1)

    def test_manual_unknown_blocks_reinstruction(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.drawn(op, rv)
        self.ok(op.cmd(cid, "instruct_payout", route="manual", external_ref="M1"))
        self.ok(op.cmd(cid, "record_delivery", status="unknown"))
        self.assertEqual(op.cmd(cid, "instruct_payout", route="manual", external_ref="M2").code, "delivery_unknown")
        self.assertEqual(rv.cmd(cid, "authorize_reinstruction", reason="x").code, "not_failed")
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM payouts"), 1)

    def test_repayment_duplicate_by_bank_ref(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.credited(op, rv)
        self.ok(op.cmd(cid, "record_repayment", amount=OWED_TOTAL, currency="SGD", bank_ref="BR-1"))
        v = self.ok(op.cmd(cid, "record_repayment", amount=OWED_TOTAL, currency="SGD", bank_ref="BR-1"))
        reps = v["collections"]["repayments"]
        self.assertEqual([r["status"] for r in reps], ["unallocated", "possible_duplicate"])
        self.ok(op.cmd(cid, "match_repayment", repayment_id=reps[0]["id"]))
        r = op.cmd(cid, "close_case")
        self.assertEqual(r.code, "cannot_close")
        v = self.ok(op.cmd(cid, "resolve_duplicate", repayment_id=reps[1]["id"], resolution="duplicate"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 0.00")
        self.assertTrue(all(i["ok"] for i in v["identities"]))
        self.ok(op.cmd(cid, "close_case"))


# ================================================================ 5. time and evidence
class TimeTest(Base):
    def test_later_known_observation_does_not_change_earlier_view_or_snapshot(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        t1 = "2026-12-01T08:00:00Z"
        self.restart(t1, op)
        self.add_balance(op, cid, amount="100,000.00", as_of="2026-12-01T07:30:00Z")
        # client tries to backdate known_at / effective
        self.ok(op.cmd(cid, "add_note", text="x", known_at="2020-01-01T00:00:00Z"))
        self.ok(op.cmd(cid, "add_observation", kind="commitment", amount="50,000.00", currency="SGD",
                       due_at="2026-12-02T07:30:00Z", description="payroll", known_at="2026-11-01T00:00:00Z"))
        # §13: intake also writes system events (duplicate check, first eligibility checkpoint) at creation time.
        rows = self.s.sql("SELECT known_at FROM events WHERE case_id=? AND seq>1 AND provenance<>'system'", (cid,))
        self.assertTrue(all(r["known_at"] == t1 for r in rows), rows)
        # (The commitment makes A short now.)
        v = self.ok(op.case(cid))
        self.assertEqual([r["status"] for r in v["routes"]][0], "infeasible")
        # Supersede the commitment at a LATER time (t1+3h).
        self.restart("2026-12-01T11:00:00Z", op)
        eid = [o for o in v["observations"] if o["kind"] == "commitment"][0]["event_id"]
        self.ok(op.cmd(cid, "supersede_observation", event_id=eid, reason="cancelled", amount="1.00",
                       currency="SGD", due_at="2026-12-02T07:30:00Z"))
        self.assertEqual(self.ok(op.case(cid))["routes"][0]["status"], "feasible")
        # Looking at t1+1h (before the correction was known), the view must still say infeasible.
        self.restart("2026-12-01T09:00:00Z", op)
        v = self.ok(op.case(cid))
        self.assertEqual(v["routes"][0]["status"], "infeasible", v["routes"][0])

    def test_request_snapshot_is_immutable_after_later_evidence(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.requested(op)
        snap = json.loads(self.s.scalar("SELECT payload FROM events WHERE case_id=? AND type='advance_requested'",
                                        (cid,)))
        self.restart("2026-12-01T05:00:00Z", op, rv)
        self.add_balance(op, cid, amount="1.00", as_of="2026-12-01T04:30:00Z")
        snap2 = json.loads(self.s.scalar("SELECT payload FROM events WHERE case_id=? AND type='advance_requested'",
                                         (cid,)))
        self.assertEqual(snap, snap2)

    def test_stale_absent_and_future_balances(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        v = self.ok(op.case(cid))
        self.assertEqual(v["routes"][0]["status"], "unknown")
        self.assertNotIn("usable_balance", v["routes"][0])
        self.assertEqual(v["routes"][2]["status"], "unknown")
        self.assertEqual(op.cmd(cid, "request_advance", reason="x").code, "route_not_feasible")
        # 30 hours old at window A (limit 24): unknown, never "short"
        self.add_balance(op, cid, amount="1.00", as_of="2026-12-01T01:00:00Z")
        v = self.ok(op.case(cid))
        a = v["routes"][0]
        self.assertEqual(a["status"], "unknown", a)
        self.assertFalse(a["disqualifiers"], a)
        # Future-dated as_of (beyond the 5-minute slack) is refused
        r = op.cmd(cid, "add_observation", kind="balance", amount="1.00", currency="SGD",
                   as_of="2026-12-01T02:00:00Z", source="x")
        self.assertEqual(r.status, 422, r)
        # Other-currency balance never counts
        cid2 = self.new_case(op)["id"]
        self.add_balance(op, cid2, amount="999,999.00", currency="USD", as_of="2026-12-01T00:30:00Z")
        self.assertEqual(self.ok(op.case(cid2))["routes"][0]["status"], "unknown")

    def test_cutoff_and_freshness_edges(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        # a balance 24h + 1s before window A (07:00Z) is stale -> unknown
        self.restart("2026-12-02T07:59:59Z", op)
        self.add_balance(op, cid, amount="100,000.00", as_of="2026-12-01T06:59:59Z")
        r = self.ok(op.case(cid))["routes"][0]
        self.assertEqual(r["status"], "unknown", r)
        # exactly 24h before window A -> exactly the limit -> fresh; one second before cutoff -> feasible
        self.add_balance(op, cid, amount="100,000.00", as_of="2026-12-01T07:00:00Z")
        r = self.ok(op.case(cid))["routes"][0]
        self.assertEqual(r["status"], "feasible", r)
        self.restart("2026-12-02T08:00:00Z", op)  # exactly at cutoff
        r = self.ok(op.case(cid))["routes"][0]
        self.assertEqual(r["status"], "infeasible", r)
        self.assertEqual(op.cmd(cid, "select_route", route="A", reason="x").code, "route_not_feasible")


# ================================================================ 6. money
class MoneyTest(Base):
    def test_amount_parsing_attacks_on_case_creation(self):
        op = self.client()
        n = self.s.scalar("SELECT COUNT(*) FROM cases")
        for bad in ("1e5", "1E5", "1.0e2", "-5.00", "0", "0.00", "100.123", "NaN", "Infinity", "1,00.00",
                    "0x10", "1_000.00", "+5.00", "5.", ".5", "--5", "5,000,00", 100.5, True, None, [], {}):
            r = op.req("POST", "/api/cases", kestrel_body(payout_amount=bad))
            self.assertEqual(r.status, 422, (bad, r))
        for ccy in ("sgd", "XXX", "SGD ", "", None, 1, "BTC"):
            r = op.req("POST", "/api/cases", kestrel_body(funding_currency=ccy))
            self.assertEqual(r.status, 422, (ccy, r))
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM cases"), n)

    def test_overflowing_amount_is_a_validation_error_not_a_server_error(self):
        """DEFECT (minor): an amount above SQLite's 64-bit INTEGER range passes money.parse and crashes the INSERT
        (HTTP 500 'internal') instead of a 422 naming the field."""
        op = self.client()
        r = op.req("POST", "/api/cases", kestrel_body(payout_amount="92,233,720,368,547,758.08"))
        self.assertEqual(r.status, 422, r)

    def test_out_of_range_timestamps_are_validation_errors_not_server_errors(self):
        """DEFECT (minor): ISO times whose UTC conversion leaves datetime's range raise OverflowError, which
        _time() does not catch (it catches ValueError/TypeError): HTTP 500 instead of a 422 naming the field."""
        op = self.client()
        r = op.req("POST", "/api/cases", kestrel_body(deadline_at="9999-12-31T23:59:59-14:00"))
        self.assertEqual(r.status, 422, r)
        cid = self.new_case(op)["id"]
        r = op.cmd(cid, "add_observation", kind="commitment", amount="1.00", currency="SGD",
                   due_at="9999-12-31T23:59:59Z")
        self.assertEqual(r.status, 422, r)

    def test_huge_repayment_amounts_do_not_break_identities(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.credited(op, rv)
        r = op.cmd(cid, "record_repayment", amount="9" * 30 + ".99", currency="SGD", bank_ref="BIG")
        self.assertIn(r.status, (200, 422), r)
        if r.status == 200:
            rid = r.json["collections"]["repayments"][0]["id"]
            v = self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
            self.assertTrue(all(i["ok"] for i in v["identities"]), v["identities"])
            self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 0.00")
            self.assertEqual(v["collections"]["unmatched"][0]["reason_code"], "excess")
        self.facility_ok()

    def test_wrong_currency_excess_receipt_reverse_and_close_rules(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.credited(op, rv)
        v = self.ok(op.cmd(cid, "record_customer_receipt", amount="500,000.00", currency="SGD", reference="AR-9"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD " + OWED_TOTAL)
        # wrong currency, even the exact numeric amount
        self.ok(op.cmd(cid, "record_repayment", amount=OWED_TOTAL, currency="USD", bank_ref="USD-1"))
        rid = self.ok(op.case(cid))["collections"]["repayments"][0]["id"]
        v = self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD " + OWED_TOTAL)
        self.assertEqual(self.s.scalar("SELECT principal_repaid_minor FROM draws"), 0)
        um = v["collections"]["unmatched"][0]
        self.assertEqual((um["reason_code"], um["amount"]), ("wrong_currency", "USD " + OWED_TOTAL))
        self.assertEqual(op.cmd(cid, "close_case").code, "cannot_close")
        # excess
        self.ok(op.cmd(cid, "record_repayment", amount="100,000.00", currency="SGD", bank_ref="SGD-1"))
        rid2 = [r for r in self.ok(op.case(cid))["collections"]["repayments"] if r["bank_ref"] == "SGD-1"][0]["id"]
        v = self.ok(op.cmd(cid, "match_repayment", repayment_id=rid2))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 0.00")
        ex = [u for u in v["collections"]["unmatched"] if u["reason_code"] == "excess"][0]
        self.assertEqual(ex["amount"], "SGD 10,399.75")
        self.assertEqual(op.cmd(cid, "close_case").code, "cannot_close")
        # reverse match restores amounts in the view and in the draws row
        mid = [m for m in v["collections"]["matches"] if m["repayment_id"] == rid2][0]["id"]
        v = self.ok(rv.cmd(cid, "reverse_match", match_id=mid, reason="wrong case"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD " + OWED_TOTAL)
        self.assertEqual(self.s.scalar("SELECT principal_repaid_minor FROM draws"), 0)
        self.assertTrue(all(i["ok"] for i in v["identities"]))
        v = self.ok(op.cmd(cid, "match_repayment", repayment_id=rid2))
        # return both unmatched items, then close
        for u in [u for u in v["collections"]["unmatched"] if u["status"] == "open"]:
            v = self.ok(rv.cmd(cid, "return_unmatched", item_id=u["id"], reason="refund", reference="RET-" + u["id"]))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 0.00")
        # a returned excess cannot be "reversed" back into a second refund
        mid2 = [m for m in v["collections"]["matches"] if m["repayment_id"] == rid2 and not m["reversed"]][0]["id"]
        self.assertEqual(rv.cmd(cid, "reverse_match", match_id=mid2, reason="x").code, "not_reversible")
        self.ok(op.cmd(cid, "close_case"))
        self.facility_ok()

    def test_close_with_exception_keeps_owed_on_record(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.credited(op, rv)
        self.ok(op.cmd(cid, "record_repayment", amount="10,000.00", currency="SGD", bank_ref="P1"))
        rid = self.ok(op.case(cid))["collections"]["repayments"][0]["id"]
        self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
        v = self.ok(rv.cmd(cid, "close_with_exception", disposition="write_off_referred", reason="importer insolvent"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 79,600.25")
        self.assertIn("79,600.25", v["decision"]["headline"])
        self.assertEqual(self.s.scalar("SELECT principal_minor-principal_repaid_minor FROM draws"), 7960025)
        self.facility_ok()

    def test_close_with_exception_must_not_strand_unreturned_customer_cash(self):
        """DEFECT (material): a reviewer can close_with_exception while a wrong-currency (or excess / unallocated)
        repayment is still held. After the close every command except add_note is refused, so the payer's money can
        never be returned: it stays 'open' on a closed case with no path out."""
        op, rv = self.client(), self.client("reviewer")
        cid = self.credited(op, rv)
        self.ok(op.cmd(cid, "record_repayment", amount="5,000.00", currency="USD", bank_ref="USD-WRONG"))
        rid = self.ok(op.case(cid))["collections"]["repayments"][0]["id"]
        v = self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
        um = v["collections"]["unmatched"][0]["id"]
        r = rv.cmd(cid, "close_with_exception", disposition="write_off_referred", reason="write off")
        if r.status == 200:
            r2 = rv.cmd(cid, "return_unmatched", item_id=um, reason="refund the payer", reference="RET-1")
            self.assertEqual(r2.status, 200, "case closed with USD 5,000.00 of the payer's money open and "
                                             "unreturnable: %r" % (r2,))
        else:
            self.assertEqual(r.status, 409, r)


# ================================================================ delivery after exception close
class DeliveryAfterCloseTest(Base):
    def test_provider_events_after_exception_close_are_not_silently_dropped(self):
        """DEFECT (material): close_with_exception is accepted while a sandbox payout is live (accepted, not yet
        credited). Afterwards the provider's 'credited' / 'returned' webhooks are answered 200 {received: true}
        but recorded nowhere (no events row, no connector_events row), so the case keeps saying the payout was
        only 'accepted' and a later return of the funds leaves no trace."""
        op, rv = self.client(), self.client("reviewer")
        cid = self.drawn(op, rv)
        v = self.ok(op.cmd(cid, "instruct_payout", route="sandbox"))
        pref = v["supplier_panel"]["provider_ref"]
        r = rv.cmd(cid, "close_with_exception", disposition="supplier_paid_outside", reason="paid by other bank")
        if r.status != 200:
            return  # refusing the close while a payout is live would also resolve the defect
        n_ev = self.event_count(cid)
        for i, kind in enumerate(("credited", "returned")):
            r = self.signed_event(op, {"provider_event_id": pref + "-LATE%d" % i, "provider_ref": pref,
                                       "payout_ref": cid + "-P1", "kind": kind, "occurred_at": T0})
            self.assertEqual(r.status, 200, r)
        recorded = self.s.scalar("SELECT COUNT(*) FROM connector_events WHERE provider_event_id LIKE ?",
                                 (pref + "-LATE%",))
        self.assertGreater(self.event_count(cid) - n_ev + recorded, 0,
                           "provider credited+returned the payout after the exception close; nothing was recorded")

    def test_provider_return_after_normal_close_is_not_silently_dropped(self):
        """DEFECT (material), same root cause: after a normal close (sandbox payout credited, everything repaid) a
        signed 'returned' event from the provider is answered 200 but stored nowhere; the case keeps saying
        'Closed: supplier credited' although the beneficiary bank sent the money back."""
        op, rv = self.client(), self.client("reviewer")
        cid = self.drawn(op, rv)
        v = self.ok(op.cmd(cid, "instruct_payout", route="sandbox"))
        pref = v["supplier_panel"]["provider_ref"]
        self.ok(op.req("POST", "/api/cases/%s/sandbox/advance" % cid, {}))
        self.ok(op.cmd(cid, "record_repayment", amount=OWED_TOTAL, currency="SGD", bank_ref="R1"))
        rid = self.ok(op.case(cid))["collections"]["repayments"][0]["id"]
        self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
        self.ok(op.cmd(cid, "close_case"))
        n_ev = self.event_count(cid)
        r = self.signed_event(op, {"provider_event_id": pref + "-RET", "provider_ref": pref,
                                   "payout_ref": cid + "-P1", "kind": "returned", "occurred_at": T0})
        self.assertEqual(r.status, 200, r)
        recorded = self.s.scalar("SELECT COUNT(*) FROM connector_events WHERE provider_event_id=?", (pref + "-RET",))
        self.assertGreater(self.event_count(cid) - n_ev + recorded, 0,
                           "beneficiary-bank return after close acknowledged with 200 and discarded")

    def test_cancelled_before_payout_disposition_refused_once_paid_out(self):
        """DEFECT (minor): close_with_exception accepts disposition 'cancelled_before_payout' on a case whose
        payout is already credited to the beneficiary, so the closing record misstates delivery."""
        op, rv = self.client(), self.client("reviewer")
        cid = self.credited(op, rv)
        r = rv.cmd(cid, "close_with_exception", disposition="cancelled_before_payout", reason="x")
        self.assertNotEqual(r.status, 200, "credited case closed as 'cancelled_before_payout'")


# ================================================================ 7. backup / restore
def _event_digest(db_path):
    c = sqlite3.connect(db_path)
    try:
        rows = c.execute("SELECT id, org_id, case_id, seq, type, payload, effective_at, known_at, actor_user_id, "
                         "actor_role, provenance, reason, corrects_event_id, idempotency_key FROM events "
                         "ORDER BY case_id, seq").fetchall()
        tables = {}
        for t in ("cases", "reservations", "draws", "payouts", "connector_events", "evidence", "idempotency",
                  "sandbox_payouts", "sandbox_events", "facilities"):
            data = c.execute("SELECT * FROM %s ORDER BY rowid" % t).fetchall()
            tables[t] = hashlib.sha256(repr(data).encode()).hexdigest()
    finally:
        c.close()
    per_case = {}
    for r in rows:
        per_case.setdefault(r[2], []).append((r[3], hashlib.sha256(repr(r).encode()).hexdigest()))
    return per_case, tables


class BackupRestoreTest(Base):
    def test_live_backup_restore_into_separate_db_reconciles(self):
        op, rv = self.client(), self.client("reviewer")
        b_op = self.client("operator", "meridian")
        cases = [self.new_case(op)["id"], self.requested(op), self.reserved(op, rv), self.drawn(op, rv),
                 self.new_case(b_op)["id"]]
        c5 = self.credited(op, rv)
        self.ok(op.cmd(c5, "record_repayment", amount="40,000.00", currency="SGD", bank_ref="R1"))
        self.ok(op.cmd(c5, "record_repayment", amount="10.00", currency="USD", bank_ref="R2"))
        rid = self.ok(op.case(c5))["collections"]["repayments"][0]["id"]
        self.ok(op.cmd(c5, "match_repayment", repayment_id=rid))
        c6 = self.drawn(op, rv)
        self.ok(op.cmd(c6, "instruct_payout", route="sandbox", scenario="return"))
        self.ok(op.req("POST", "/api/cases/%s/sandbox/advance" % c6, {}))
        c7 = self.credited(op, rv, ext="EXT-7")
        self.ok(rv.cmd(c7, "close_with_exception", disposition="write_off_referred", reason="x"))
        cases += [c5, c6, c7]
        dest = os.path.join(self.s.dir, "bk", "backup.db")
        # backup taken while the server is running and holding WAL
        r = self.s.cli("backup", dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        orig_events, orig_tables = _event_digest(self.s.db)
        views = {c: self._snapshot(op if c != cases[4] else b_op, c) for c in cases}
        lists = {p: op.get(p).raw for p in ("/api/queue", "/api/facilities", "/api/cases?q=")}
        # restore into a separate, empty location
        newdb = os.path.join(self.s.dir, "restored", "pilot.db")
        r = self.s.cli("restore", dest, db=newdb)
        self.assertEqual(r.returncode, 0, r.stderr)
        rest_events, rest_tables = _event_digest(newdb)
        self.assertEqual(orig_events, rest_events)
        self.assertEqual(orig_tables, rest_tables)
        s2 = Srv(db_path=newdb, clock=self.s.clock, seed=False)
        s2.start()
        try:
            op2, b2 = Client(s2.port), Client(s2.port)
            self.assertEqual(op2.login("operator@harbourline.test", "pilot-dev-operator").status, 200)
            self.assertEqual(b2.login("operator@meridian.test", "pilot-dev-operator").status, 200)
            for c in cases:
                cl = op2 if c != cases[4] else b2
                self.assertEqual(self._snapshot(cl, c), views[c], c)
            for p, raw in lists.items():
                self.assertEqual(op2.get(p).raw, raw, p)
            self.assertEqual(op2.get("/api/cases/" + cases[4]).status, 404)
        finally:
            s2.close()
        self.assertEqual(self.s.cli("check", db=newdb, check=False).returncode, 0)

    def _snapshot(self, c, cid):
        out = {"view": c.case(cid).raw}
        for fmt in ("json", "csv", "html"):
            r = c.get("/api/cases/%s/export?format=%s" % (cid, fmt))
            self.assertEqual(r.status, 200, r)
            out[fmt] = hashlib.sha256(r.raw).hexdigest()
        return out

    def test_corrupt_or_unverified_backup_is_refused(self):
        dest = os.path.join(self.s.dir, "b.db")
        self.assertEqual(self.s.cli("backup", dest).returncode, 0)
        newdb = os.path.join(self.s.dir, "n", "p.db")
        with open(dest, "rb") as fh:
            good = fh.read()
        variants = {
            "flipped": good[:5000] + bytes([good[5000] ^ 0xFF]) + good[5001:],
            "truncated": good[: len(good) // 2],
            "garbage": os.urandom(len(good)),
        }
        for name, data in variants.items():
            p = os.path.join(self.s.dir, name + ".db")
            with open(p, "wb") as fh:
                fh.write(data)
            shutil.copy(dest + ".sha256", p + ".sha256")
            r = self.s.cli("restore", p, db=newdb, check=False)
            self.assertNotEqual(r.returncode, 0, name)
            self.assertFalse(os.path.exists(newdb), name)
        # truncated file with a *matching* manifest still fails integrity_check
        p = os.path.join(self.s.dir, "trunc2.db")
        with open(p, "wb") as fh:
            fh.write(good[: len(good) // 2])
        with open(p + ".sha256", "w") as fh:
            fh.write(hashlib.sha256(good[: len(good) // 2]).hexdigest() + "  trunc2.db\n")
        r = self.s.cli("restore", p, db=newdb, check=False)
        self.assertNotEqual(r.returncode, 0)
        # no manifest
        p = os.path.join(self.s.dir, "nomani.db")
        shutil.copy(dest, p)
        self.assertNotEqual(self.s.cli("restore", p, db=newdb, check=False).returncode, 0)
        self.assertFalse(os.path.exists(newdb))


# ================================================================ 8. other exposure / injection
class MiscTest(Base):
    def test_xss_in_party_names_is_escaped_in_export_and_never_executable(self):
        op = self.client()
        xss = "<script>alert(1)</script><img src=x onerror=alert(2)>"
        cid = self.new_case(op, importer=xss, supplier="=HYPERLINK(\"http://x\")",
                            reference="+cmd|' /C calc'!A0")["id"]
        self.ok(op.cmd(cid, "add_note", text="=1+1"))
        r = op.get("/api/cases/%s/export?format=html" % cid)
        self.assertEqual(r.status, 200)
        self.assertNotIn(b"<script>alert", r.raw)
        self.assertNotIn(b"<img src=x", r.raw)
        self.assertIn("text/html", r.headers["content-type"])
        self.assertIn("attachment", r.headers.get("content-disposition", ""))
        self.assertIn("default-src", r.headers.get("content-security-policy", ""))
        r = op.get("/api/cases/%s/export?format=csv" % cid)
        import csv as _csv
        import io as _io
        for row in _csv.reader(_io.StringIO(r.raw.decode("utf-8"))):
            for cell in row:
                self.assertFalse(cell[:1] in ("=", "+", "@"), cell)
        r = op.get("/")
        self.assertIn("script-src 'self'", r.headers.get("content-security-policy", ""))

    def test_evidence_spoofing_and_traversal(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        for ctype, data in (("text/html", b"<b>x</b>"), ("application/pdf", b"<html>"), ("image/png", b"GIF89a"),
                            ("text/plain", b"\x00\x01"), ("image/svg+xml", b"<svg/>")):
            self.assertEqual(op.evidence(cid, "x", ctype, data).status, 422, ctype)
        r = self.ok(op.evidence(cid, "../../../etc/passwd<script>.txt", "text/plain",
                                b"<script>alert(1)</script>"), 201)
        eid = r["evidence_added"]["id"]
        d = op.get("/api/cases/%s/evidence/%s" % (cid, eid))
        self.assertEqual(d.status, 200)
        self.assertEqual(d.headers["x-content-type-options"], "nosniff")
        self.assertTrue(d.headers["content-disposition"].startswith("attachment"))
        self.assertNotIn("/", d.headers["content-disposition"].split("filename=")[1])
        self.assertNotIn("<", d.headers["content-disposition"])
        for path in ("/../pilot/db.py", "/%2e%2e/pilot/db.py", "/..%2f..%2fpilot%2fdb.py", "/static/../../x.db",
                     "/%2e%2e%2f%2e%2e%2fPILOT_CONTRACT.md", "//etc/passwd", "/app.js/../../db.py"):
            r = op.get(path)
            self.assertNotIn(b"sqlite3", r.raw or b"", path)
            self.assertNotIn(b"BEGIN IMMEDIATE", r.raw or b"", path)
            self.assertNotIn(b"shared contract", r.raw or b"", path)
            self.assertNotIn(b"root:", r.raw or b"", path)

    def test_oversized_and_malformed_bodies(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        v0 = self.version(cid)
        big = b'{"a":"' + b"x" * (2 * 1024 * 1024) + b'"}'
        r = op.req("POST", "/api/cases/%s/commands" % cid, raw=big)
        self.assertEqual(r.status, 413, r)
        r = op.evidence(cid, "big.txt", "text/plain", b"a" * (5 * 1024 * 1024 + 1))
        self.assertEqual(r.status, 413, r)
        for raw, ctype in ((b"{not json", "application/json"), (b"[]", "application/json"),
                           (b'"str"', "application/json"), (b"\xff\xfe", "application/json"),
                           (b'{"type":"add_note"}', "text/plain")):
            r = op.req("POST", "/api/cases/%s/commands" % cid, raw=raw, ctype=ctype)
            self.assertIn(r.status, (400, 415), (raw, r))
        r = op.req("POST", "/api/cases/%s/commands" % cid, raw=b"{}", headers={"Content-Length": "-1"})
        self.assertIn(r.status, (400,), r)
        # wrong types for ids never 500
        for p in ({"repayment_id": ["x"]}, {"match_id": {"a": 1}}, {"event_id": "1"}, {"item_id": 5},
                  {"user_id": True}):
            for ctype in ("match_repayment", "reverse_match", "supersede_observation", "assign_owner"):
                body = dict(p, type=ctype, idempotency_key=str(uuid.uuid4()), expected_version=self.version(cid),
                            reason="x")
                r = op.req("POST", "/api/cases/%s/commands" % cid, body)
                self.assertNotEqual(r.status, 500, (ctype, p, r))
        self.assertEqual(self.version(cid), v0)


if __name__ == "__main__":
    unittest.main()
