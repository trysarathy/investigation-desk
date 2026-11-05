"""API guarantees: tenancy, auth, CSRF, throttle, idempotency, versions, four-eyes, limits, headers, imports."""

import base64
import os
import uuid

import backend_support  # noqa: F401  (puts the repo root on sys.path)
from backend_support import ServerCase, kestrel_body
from pilot import db

SAMPLE_CSV = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                          "docs", "pilot", "sample_cases.csv")


class TenancyTest(ServerCase):
    def test_cross_org_ids_are_404_everywhere(self):
        hl = self.client()
        cid = self.new_case(hl)["id"]
        ev = hl.evidence(cid, "note.txt", "text/plain", b"synthetic")
        evid = ev.json["evidence_added"]["id"]
        mr = self.client("operator", org="meridian")
        mrv = self.client("reviewer", org="meridian")
        self.assertEqual(mr.case(cid).status, 404)
        self.assertEqual(mr.get("/api/cases/%s/export?format=json" % cid).status, 404)
        self.assertEqual(mr.get("/api/cases/%s/export?format=html" % cid).status, 404)
        self.assertEqual(mr.get("/api/cases/%s/evidence/%s" % (cid, evid)).status, 404)
        self.assertEqual(hl.get("/api/cases/%s/evidence/%s" % (cid, evid)).status, 200)
        for c, t in ((mr, "add_note"), (mrv, "approve_and_reserve"), (mr, "record_draw")):
            r = c.req("POST", "/api/cases/%s/commands" % cid, {"type": t, "idempotency_key": str(uuid.uuid4()),
                                                              "expected_version": 1, "text": "x", "reason": "x"})
            self.assertEqual(r.status, 404, r)
        r = mr.evidence(cid, "x.txt", "text/plain", b"x")
        self.assertEqual(r.status, 404)
        for q in (cid, "Kestrel", "Lindqvist", "PO-KES"):
            self.assertEqual(mr.get("/api/cases?q=" + q).json["results"], [])
            self.assertEqual(len(hl.get("/api/cases?q=" + q).json["results"]), 1)
        self.assertEqual(sum(len(s["rows"]) for s in mr.get("/api/queue").json["sections"]), 0)
        self.assertEqual([f["id"] for f in mr.get("/api/facilities").json["facilities"]], ["FAC-MR-01"])
        # Another org's facility id cannot be used at creation.
        r = mr.req("POST", "/api/cases", kestrel_body(facility_id="FAC-HL-01"))
        self.assertEqual((r.status, r.json["error"]["field"]), (422, "facility_id"))
        # Idempotency keys are per org: the same key in another org is a fresh request.
        key = str(uuid.uuid4())
        self.assertEqual(hl.req("POST", "/api/cases", kestrel_body(idempotency_key=key)).status, 201)
        self.assertEqual(mr.req("POST", "/api/cases", kestrel_body(idempotency_key=key)).status, 201)


class AuthTest(ServerCase):
    def test_login_me_logout_and_cookie_flags(self):
        c = backend_support.Client(self.port)
        self.assertEqual(c.get("/api/me").status, 401)
        r = c.login("operator@harbourline.test", "pilot-dev-operator")
        self.assertEqual(r.status, 200)
        sc = r.headers["set-cookie"]
        self.assertIn("HttpOnly", sc)
        self.assertIn("SameSite=Strict", sc)
        self.assertNotIn("Secure", sc)  # test env
        me = c.get("/api/me").json
        self.assertEqual((me["user"]["name"], me["user"]["role"], me["org"]["name"]),
                         ("Olivia Tan", "operator", "Harbourline Payments (Synthetic)"))
        self.assertEqual(me["csrf"], c.csrf)
        self.assertEqual(c.req("POST", "/api/logout", {}).status, 200)
        self.assertEqual(c.get("/api/me").status, 401)

    def test_csrf_required_for_mutations(self):
        op = self.client()
        r = op.req("POST", "/api/cases", kestrel_body(), csrf=False)
        self.assertEqual((r.status, r.code), (403, "csrf_required"))
        r = op.req("POST", "/api/cases", kestrel_body(), headers={"X-CSRF-Token": "wrong"}, csrf=False)
        self.assertEqual((r.status, r.code), (403, "csrf_required"))
        anon = backend_support.Client(self.port)
        self.assertEqual(anon.req("POST", "/api/cases", kestrel_body()).status, 401)

    def test_login_throttle(self):
        c = backend_support.Client(self.port)
        for _ in range(5):
            self.assertEqual(c.login("reviewer@harbourline.test", "wrong-password").status, 401)
        r = c.login("reviewer@harbourline.test", "pilot-dev-reviewer")
        self.assertEqual((r.status, r.code), (429, "login_throttled"))
        self.assertEqual(c.login("operator@harbourline.test", "pilot-dev-operator").status, 200)  # per email
        db.set_clock("2026-12-01T01:15:01Z")
        self.assertEqual(c.login("reviewer@harbourline.test", "pilot-dev-reviewer").status, 200)

    def test_viewer_reads_but_cannot_mutate(self):
        op, viewer = self.client(), self.client("viewer")
        cid = self.new_case(op)["id"]
        v = self.assertOk(viewer.case(cid))
        self.assertTrue(all(not a["enabled"] for a in v["actions"]))
        for t in ("add_note", "request_advance", "approve_and_reserve"):
            r = viewer.cmd(cid, t, text="x", reason="x")
            self.assertEqual((r.status, r.code), (403, "forbidden"), t)
        self.assertEqual(viewer.req("POST", "/api/cases", kestrel_body()).status, 403)
        self.assertEqual(viewer.evidence(cid, "a.txt", "text/plain", b"a").status, 403)
        self.assertEqual(viewer.req("POST", "/api/cases/import", {"csv": "x"}).status, 403)
        self.assertEqual(viewer.get("/api/cases/%s/export?format=csv" % cid).status, 200)
        self.assertEqual(viewer.get("/api/queue").status, 200)

    def test_role_matrix_operator_vs_reviewer(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.new_case(op)["id"]
        self.add_balance(op, cid)
        self.assertEqual(rv.cmd(cid, "request_advance", reason="x").status, 403)
        self.assertOk(op.cmd(cid, "request_advance", reason="x"))
        self.assertEqual(op.cmd(cid, "approve_and_reserve", reason="x").status, 403)
        self.assertOk(rv.cmd(cid, "add_note", text="Reviewer note"))

    def test_four_eyes(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.new_case(op)["id"]
        self.add_balance(op, cid)
        self.assertOk(op.cmd(cid, "request_advance", reason="x"))
        conn = self.env.conn()
        with db.tx(conn):  # the requester later becomes a reviewer
            conn.execute("UPDATE users SET role='reviewer' WHERE email='operator@harbourline.test'")
        conn.close()
        r = op.cmd(cid, "approve_and_reserve", reason="self-approval")
        self.assertEqual((r.status, r.code), (403, "four_eyes"))
        self.assertOk(rv.cmd(cid, "approve_and_reserve", reason="independent"))


class CommandSemanticsTest(ServerCase):
    def test_idempotency_replay_conflict_and_stale_version(self):
        op = self.client()
        body = kestrel_body()
        r1 = op.req("POST", "/api/cases", body)
        r2 = op.req("POST", "/api/cases", body)
        self.assertEqual((r1.status, r2.status), (201, 201))
        self.assertEqual(r1.json["id"], r2.json["id"])
        self.assertTrue(r2.json["idempotent_replay"])
        self.assertEqual(len(op.get("/api/cases").json["results"]), 1)
        r = op.req("POST", "/api/cases", dict(body, supplier="Other"))
        self.assertEqual((r.status, r.code), (409, "idempotency_conflict"))
        cid, ver = r1.json["id"], r1.json["version"]
        key = str(uuid.uuid4())
        a = op.cmd(cid, "add_note", version=ver, key=key, text="first")
        b = op.cmd(cid, "add_note", version=ver, key=key, text="first")
        self.assertEqual((a.status, b.status), (200, 200))
        self.assertEqual(a.json["version"], b.json["version"])
        notes = op.case(cid).json["notes"]
        self.assertEqual(len(notes), 1)
        c = op.cmd(cid, "add_note", version=ver, key=key, text="different")
        self.assertEqual((c.status, c.code), (409, "idempotency_conflict"))
        d = op.cmd(cid, "add_note", version=ver, text="stale")
        self.assertEqual((d.status, d.code), (409, "stale_version"))
        self.assertIn("Case changed since you loaded it", d.json["error"]["message"])
        e = op.req("POST", "/api/cases/%s/commands" % cid, {"type": "add_note", "text": "no key", "expected_version": 1})
        self.assertEqual((e.status, e.code), (400, "idempotency_key_required"))
        f = op.cmd(cid, "launch_rockets")
        self.assertEqual((f.status, f.code), (400, "unknown_command"))

    def test_validation_lists_every_bad_field(self):
        op = self.client()
        r = op.req("POST", "/api/cases", kestrel_body(payout_amount=61400.0, funding_currency="XYZ",
                                                       deadline_tz="Mars/Base", window_a_cutoff_at="2026-12-02T06:00:00Z",
                                                       importer=""))
        self.assertEqual(r.status, 422)
        fields = {f["field"] for f in r.json["error"]["fields"]}
        self.assertTrue({"payout_amount", "funding_currency", "deadline_tz", "window_a_cutoff_at", "importer"} <= fields,
                        fields)
        cid = self.new_case(op)["id"]
        r = op.cmd(cid, "add_observation", kind="balance", amount="1,000.001", currency="SGD", as_of="2026-12-01T00:00:00Z",
                   source="x", provenance="external_record")
        self.assertEqual({f["field"] for f in r.json["error"]["fields"]}, {"amount", "provenance"})
        r = op.cmd(cid, "add_observation", kind="balance", amount="1,000.00", currency="SGD",
                   as_of="2026-12-09T00:00:00Z", source="x")
        self.assertEqual(r.json["error"]["field"], "as_of")  # future balance

    def test_limits_headers_static_and_health(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        big = b"x" * (1024 * 1024 + 10)
        r = op.req("POST", "/api/cases/%s/commands" % cid, raw=big)
        self.assertEqual((r.status, r.code), (413, "payload_too_large"))
        self.assertIn("1 MB", r.json["error"]["message"])
        data = b"%PDF" + b"0" * (5 * 1024 * 1024)
        r = op.evidence(cid, "big.pdf", "application/pdf", data)
        self.assertEqual((r.status, r.code), (413, "evidence_too_large"))
        self.assertIn("5 MB", r.json["error"]["message"])
        r = op.evidence(cid, "fake.png", "image/png", b"not a png")
        self.assertEqual(r.status, 422)
        r = op.evidence(cid, "../../etc/ok.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"1" * 20)
        self.assertEqual(r.status, 201)
        v = op.case(cid).json
        self.assertEqual(v["evidence"][0]["filename"], "ok.png")
        d = op.get(v["evidence"][0]["download_url"])
        self.assertEqual(d.status, 200)
        self.assertIn("attachment", d.headers["content-disposition"])
        self.assertEqual(d.raw[:4], b"\x89PNG")
        r = op.req("POST", "/api/cases", raw=b"{", ctype="application/json")
        self.assertEqual((r.status, r.code), (400, "bad_json"))
        r = op.req("POST", "/api/cases", raw=b"{}", ctype="text/plain")
        self.assertEqual(r.status, 415)
        h = op.get("/api/health")
        self.assertEqual(h.status, 200)
        self.assertEqual(set(h.json), {"ok", "db", "migrations", "env"})
        self.assertTrue(h.json["ok"])
        for path in ("/api/queue", "/", "/cases/" + cid):
            r = op.get(path)
            self.assertEqual(r.status, 200, path)
            self.assertIn("default-src 'self'", r.headers["content-security-policy"])
            self.assertEqual(r.headers["x-content-type-options"], "nosniff")
            self.assertEqual(r.headers["x-frame-options"], "DENY")
        self.assertIn("text/html", op.get("/cases/" + cid).headers["content-type"])
        self.assertEqual(op.get("/missing.js").status, 404)
        self.assertEqual(op.get("/../pilot/db.py").status, 404)
        self.assertEqual(op.get("/api/nope").status, 404)
        self.assertEqual(op.get("/api/nope").headers["content-type"], "application/json; charset=utf-8")


class CollectionsTest(ServerCase):
    def credited(self):
        op, rv = self.client(), self.client("reviewer")
        cid, v = self.to_reserved(op, rv)
        self.assertOk(op.cmd(cid, "record_draw", reference="D1"))
        self.assertOk(op.cmd(cid, "instruct_payout", route="manual", external_ref="B-%s" % cid))
        self.assertOk(op.cmd(cid, "record_delivery", status="credited", reference="C1"))
        return op, rv, cid

    def test_wrong_currency_returnable_and_principal_unchanged(self):
        op, rv, cid = self.credited()
        v = self.assertOk(op.cmd(cid, "record_repayment", amount="65,000.00", currency="EUR", bank_ref="EUR-1"))
        rid = v["collections"]["repayments"][0]["id"]
        v = self.assertOk(op.cmd(cid, "match_repayment", repayment_id=rid))
        self.assertIdentities(v)
        self.assertEqual(v["exposure_panel"]["principal_outstanding"], "SGD 89,450.25")
        self.assertEqual(v["exposure_panel"]["fees_outstanding"], "SGD 150.00")
        um = v["collections"]["unmatched"][0]
        self.assertEqual((um["amount"], um["reason_code"], um["status"]), ("EUR 65,000.00", "wrong_currency", "open"))
        q = self.assertOk(op.get("/api/queue"))
        self.assertIn(cid, [x["case_id"] for x in q["sections"][5]["rows"]])
        self.assertEqual(op.cmd(cid, "return_unmatched", item_id=um["id"], reason="x", reference="r").status, 403)
        v = self.assertOk(rv.cmd(cid, "return_unmatched", item_id=um["id"], reason="Wrong currency; sent back",
                                 reference="RET-EUR-1"))
        self.assertIdentities(v)
        self.assertEqual(v["collections"]["unmatched"][0]["status"], "returned")
        self.assertEqual(v["exposure_panel"]["principal_outstanding"], "SGD 89,450.25")
        self.assertEqual(op.cmd(cid, "close_case").status, 409)

    def test_excess_duplicates_reversal_overdue_and_exception(self):
        op, rv, cid = self.credited()
        v = self.assertOk(op.cmd(cid, "record_repayment", amount="90,000.00", currency="SGD", bank_ref="R1"))
        v = self.assertOk(op.cmd(cid, "record_repayment", amount="90,000.00", currency="SGD", bank_ref="R1"))
        r1, r2 = [x["id"] for x in v["collections"]["repayments"]]
        self.assertEqual(v["collections"]["repayments"][1]["status"], "possible_duplicate")
        self.assertIdentities(v)
        r = op.cmd(cid, "match_repayment", repayment_id=r2)
        self.assertEqual(r.status, 409)
        v = self.assertOk(op.cmd(cid, "resolve_duplicate", repayment_id=r2, resolution="duplicate"))
        self.assertIdentities(v)
        v = self.assertOk(op.cmd(cid, "match_repayment", repayment_id=r1))
        self.assertIdentities(v)
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 0.00")
        um = v["collections"]["unmatched"][0]
        self.assertEqual((um["amount"], um["reason_code"]), ("SGD 399.75", "excess"))
        mid = v["collections"]["matches"][0]["id"]
        v = self.assertOk(rv.cmd(cid, "reverse_match", match_id=mid, reason="Payer says it was for another invoice"))
        self.assertIdentities(v)
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 89,600.25")
        self.assertEqual(v["collections"]["repayments"][0]["status"], "unallocated")
        self.assertEqual(v["collections"]["unmatched"], [])
        # Overdue: due Mon 7 Dec 17:00 SGT passed with money owed.
        db.set_clock("2026-12-07T09:00:01Z")
        op.relogin()
        rv.relogin()
        v = self.assertOk(op.case(cid))
        self.assertTrue(v["exposure_panel"]["overdue"])
        q = self.assertOk(op.get("/api/queue"))
        self.assertIn(cid, [x["case_id"] for x in q["sections"][4]["rows"]])
        v = self.assertOk(rv.cmd(cid, "close_with_exception", disposition="write_off_referred",
                                 reason="Importer insolvent; referred to recoveries"))
        self.assertEqual(v["status"], "closed_exception")
        self.assertIn("SGD 89,600.25 remains owed", v["decision"]["headline"])
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 89,600.25")
        self.assertIdentities(v)

    def test_notes_handoff_owner_and_search(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.new_case(op)["id"]
        users = op.get("/api/users").json["users"]
        ravi = [u for u in users if u["name"] == "Ravi Menon"][0]
        v = self.assertOk(op.cmd(cid, "assign_owner", user_id=ravi["id"], note="Please review the balance evidence"))
        self.assertEqual(v["header"]["owner"]["name"], "Ravi Menon")
        q = self.assertOk(rv.get("/api/queue"))
        self.assertEqual([x["case_id"] for x in q["sections"][6]["rows"]], [cid])
        r = op.cmd(cid, "assign_owner", user_id=999)
        self.assertEqual(r.status, 422)
        self.assertEqual(len(op.get("/api/cases?q=%25").json["results"]), 0)  # LIKE wildcards are literal
        self.assertEqual(len(op.get("/api/cases?q=lindqvist").json["results"]), 1)


class ImportTest(ServerCase):
    def test_csv_import_all_or_nothing(self):
        db.set_clock("2026-12-03T12:00:00Z")  # after every balance date in the sample file
        op = self.client()
        with open(SAMPLE_CSV, encoding="utf-8") as fh:
            text = fh.read()
        r = op.req("POST", "/api/cases/import", {"csv": text, "dry_run": True})
        self.assertEqual(r.status, 200, r)
        n = r.json["would_create"]
        self.assertGreater(n, 0)
        self.assertEqual(op.get("/api/cases").json["results"], [])
        bad = text.rstrip("\n") + "\n" + text.splitlines()[1].replace("SGD", "XXX", 1) + "\n"
        r = op.req("POST", "/api/cases/import", {"csv": bad})
        self.assertEqual(r.status, 422, r)
        self.assertTrue(r.json["errors"][0].startswith("Row "))
        self.assertEqual(op.get("/api/cases").json["results"], [])
        r = op.req("POST", "/api/cases/import", {"csv": text})
        self.assertEqual(r.status, 200, r)
        self.assertEqual(len(r.json["created"]), n)
        r2 = op.req("POST", "/api/cases/import", {"csv": text})  # re-import: nothing duplicated
        self.assertEqual((r2.json["created"], len(r2.json["already_imported"])), ([], n))
        self.assertEqual(len(op.get("/api/cases").json["results"]), n)
        v = self.assertOk(op.case(r.json["created"][0]))
        self.assertIdentities(v)
        self.assertTrue(any(o["kind"] == "balance" for o in v["observations"]))


if __name__ == "__main__":
    import unittest
    unittest.main()
