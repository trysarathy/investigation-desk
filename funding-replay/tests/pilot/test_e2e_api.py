"""Acceptance §12 steps 1-8 through HTTP with a new fictional invoice, two users and a server restart."""

import json
import uuid


import backend_support  # noqa: F401,E402  (puts the repo root on sys.path)
from pilot import db
from backend_support import ServerCase


class EndToEndTest(ServerCase):
    def checked(self, r, status=200):
        v = self.assertOk(r, status)
        self.assertIdentities(v)
        return v

    def test_acceptance_walk(self):
        op = self.client("operator")
        rv = self.client("reviewer")

        # Blank workspace: no cases.
        q = self.assertOk(op.get("/api/queue"))
        self.assertEqual(sum(len(s["rows"]) for s in q["sections"]), 0)
        self.assertEqual([s["key"] for s in q["sections"]],
                         ["awaiting_review", "evidence_requested", "approaching_cutoff", "uncertain_delivery",
                          "overdue_repayment", "unmatched_cash", "my_open", "all_open"])

        # 1. Operator creates, evidences and submits.
        v = self.checked(op.req("POST", "/api/cases", {
            "importer": "Kestrel Instruments Pte Ltd", "supplier": "Lindqvist Optics AB",
            "payout_amount": "61,400.00", "payout_currency": "EUR", "funding_amount": "89,450.25",
            "funding_currency": "SGD", "quote_ref": "QT-KES-2026-118", "deadline_at": "2026-12-04T10:00:00Z",
            "deadline_tz": "Asia/Singapore", "window_a_at": "2026-12-02T07:00:00Z",
            "window_a_cutoff_at": "2026-12-02T08:00:00Z", "later_permitted": False, "contract_ref": "CT-KES-07",
            "reference": "PO-KES-5521", "invoice_ref": "INV-LO-2026-0042", "idempotency_key": str(uuid.uuid4()),
            "observations": [{"kind": "expected_receipt", "amount": "120,000.00", "currency": "SGD",
                              "expected_at": "2026-12-05T02:00:00Z", "payer": "Kestrel's customer"}]}), 201)
        cid = v["id"]
        self.assertRegex(cid, r"^CL-2026-[A-Z0-9]+-\d{5}$")
        self.assertEqual(v["header"]["payout"], "EUR 61,400.00")
        self.assertEqual(v["header"]["funding"], "SGD 89,450.25")
        self.assertEqual(v["header"]["deadline_local"], "Fri 4 Dec 2026, 18:00 SGT")
        self.assertEqual(v["exposure_panel"]["status"], "none")
        self.assertEqual(v["collections"]["expected_receipt"]["label"], "Forecast — not cash, never counted")
        # No balance yet: A and C unknown, B infeasible (contract fixes the date).
        self.assertEqual(self.route(v, "A")["status"], "unknown")
        self.assertEqual(self.route(v, "B")["status"], "infeasible")
        self.assertIn("Contract fixes the funding date", self.route(v, "B")["disqualifiers"][0])
        self.assertEqual(self.route(v, "C")["status"], "unknown")
        self.assertEqual(v["decision"]["tone"], "unknown")

        ev = op.evidence(cid, "kestrel-balance.pdf", "application/pdf", b"%PDF-1.4 synthetic statement")
        self.assertEqual(ev.status, 201, ev)
        self.assertIdentities(ev.json)
        evid = ev.json["evidence_added"]["id"]
        v = self.checked(op.cmd(cid, "add_observation", kind="balance", amount="20,000.00", currency="SGD",
                                as_of="2026-12-01T00:30:00Z", source="Bank statement (synthetic)", evidence_id=evid,
                                provenance="external_record"))
        self.assertEqual(v["observations"][-1]["provenance"], "external_record")
        a = self.route(v, "A")  # 30.5 h old at window A: unknown (stale), never "short"
        self.assertEqual(a["status"], "unknown")
        self.assertIn("old at the window", a["missing"][0])
        c = self.route(v, "C")
        self.assertEqual(c["status"], "feasible")
        self.assertTrue(c["capacity_ok"] and c["cash_ok"])
        self.assertIn(evid, c["evidence_ids"])
        self.assertEqual(self.action(v, "request_advance")["enabled"], True)
        self.assertEqual(self.action(v, "request_advance")["label"], "Request advance")
        v = self.checked(op.cmd(cid, "request_advance", reason="Importer keeps cash until its receivable settles"))
        self.assertEqual(v["status"], "awaiting_review")
        self.assertEqual(v["decision"]["owner_role"], "reviewer")
        a = self.action(v, "approve_and_reserve")
        self.assertFalse(a["enabled"])  # operator cannot approve
        q = self.assertOk(rv.get("/api/queue"))
        self.assertIn(cid, [r["case_id"] for r in q["sections"][0]["rows"]])

        # 2. A different user (reviewer) approves and reserves.
        v = self.checked(rv.cmd(cid, "approve_and_reserve", reason="Within limit; balance evidenced and fresh"))
        self.assertEqual(v["exposure_panel"]["status"], "reserved")
        self.assertEqual(v["exposure_panel"]["reserved"], "SGD 89,450.25")
        self.assertEqual(v["exposure_panel"]["principal_outstanding"], "SGD 0.00")
        self.assertEqual(v["exposure_panel"]["due_at_local"], "Mon 7 Dec 2026, 17:00 SGT")
        self.assertIn("Capacity reserved (not a draw)", v["decision"]["headline"])
        fac = self.assertOk(op.get("/api/facilities"))["facilities"][0]
        self.assertEqual((fac["limit"], fac["reserved"], fac["available"]),
                         ("SGD 500,000.00", "SGD 89,450.25", "SGD 410,549.75"))
        self.assertTrue(fac["identity"]["ok"])
        version_before_restart = v["version"]

        # 3. Restart keeps everything (new server, same DB file; sessions persist too).
        self.stop()
        self.start()
        op.port = rv.port = self.port
        v = self.assertOk(op.case(cid))
        self.assertEqual(v["version"], version_before_restart)
        self.assertEqual(v["exposure_panel"]["status"], "reserved")
        self.assertEqual(len(v["evidence"]), 1)

        # 4. Draw once.
        db.set_clock("2026-12-01T03:00:00Z")
        v = self.checked(op.cmd(cid, "record_draw", reference="DRW-KES-1"))
        self.assertEqual(v["exposure_panel"]["status"], "outstanding")
        self.assertEqual(v["exposure_panel"]["principal_outstanding"], "SGD 89,450.25")
        self.assertEqual(v["exposure_panel"]["fees_outstanding"], "SGD 150.00")
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 89,600.25")
        self.assertEqual(v["supplier_panel"]["status"], "none")
        r = op.cmd(cid, "record_draw", reference="DRW-KES-2")
        self.assertEqual(r.status, 409)
        self.assertEqual(r.code, "already_drawn")

        # 5. External (manual) payout: acceptance is never credit.
        v = self.checked(op.cmd(cid, "instruct_payout", route="manual", external_ref="BANK-REF-KES-01"))
        self.assertEqual(v["supplier_panel"]["status"], "instructed")
        r = op.cmd(cid, "instruct_payout", route="manual", external_ref="BANK-REF-KES-02")
        self.assertEqual((r.status, r.code), (409, "payout_live"))
        db.set_clock("2026-12-01T05:00:00Z")
        v = self.checked(op.cmd(cid, "record_delivery", status="accepted", reference="ACK-778"))
        sp = v["supplier_panel"]
        self.assertEqual(sp["status"], "accepted")
        self.assertIn("not yet credited", sp["label"])
        self.assertNotIn("paid", sp["label"].lower())
        self.assertFalse(self.action(v, "close_case") and self.action(v, "close_case")["enabled"])

        # 6. Delivery recorded while the provider's balance is outstanding.
        db.set_clock("2026-12-01T14:00:00Z")
        v = self.checked(op.cmd(cid, "record_delivery", status="credited", reference="MT103-KES",
                                location="Lindqvist account at beneficiary bank"))
        self.assertEqual(v["supplier_panel"]["status"], "credited")
        self.assertEqual(v["exposure_panel"]["status"], "outstanding")
        self.assertEqual(v["decision"]["tone"], "delivered_exposure")
        self.assertIn("SGD 89,600.25", v["decision"]["headline"])
        # A late, out-of-order acceptance is stored but not applied.
        v = self.checked(op.cmd(cid, "record_delivery", status="accepted", reference="ACK-late"))
        self.assertEqual(v["supplier_panel"]["status"], "credited")
        self.assertFalse(v["supplier_panel"]["history"][-1]["applied"])

        # 7. Customer receipt doesn't reduce debt; partial match shows the remainder; balance settles.
        db.set_clock("2026-12-05T03:00:00Z")
        self.assertEqual(op.get("/api/me").status, 401)  # 12 h idle expiry
        op.relogin()
        v = self.checked(op.cmd(cid, "record_customer_receipt", amount="120,000.00", currency="SGD",
                                reference="Kestrel customer remittance"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 89,600.25")
        self.assertEqual(v["collections"]["customer_receipts"][0]["label"], "Importer's own account — not a repayment")
        v = self.checked(op.cmd(cid, "record_repayment", amount="60,000.00", currency="SGD", bank_ref="KES-RPY-1"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 89,600.25")  # unallocated until matched
        rp1 = v["collections"]["repayments"][0]["id"]
        v = self.checked(op.cmd(cid, "match_repayment", repayment_id=rp1))
        alloc = v["collections"]["repayments"][0]["allocation"]
        self.assertEqual((alloc["fees"], alloc["principal"], alloc["unmatched"]),
                         ("SGD 150.00", "SGD 59,850.00", "SGD 0.00"))
        self.assertEqual(v["exposure_panel"]["principal_outstanding"], "SGD 29,600.25")
        self.assertEqual(v["exposure_panel"]["fees_outstanding"], "SGD 0.00")
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 29,600.25")
        r = op.cmd(cid, "close_case")
        self.assertEqual((r.status, r.code), (409, "cannot_close"))
        v = self.checked(op.cmd(cid, "record_repayment", amount="29,600.25", currency="SGD", bank_ref="KES-RPY-2"))
        rp2 = v["collections"]["repayments"][1]["id"]
        v = self.checked(op.cmd(cid, "match_repayment", repayment_id=rp2))
        self.assertEqual(v["exposure_panel"]["status"], "ended")
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 0.00")
        fac = self.assertOk(op.get("/api/facilities"))["facilities"][0]
        self.assertEqual((fac["reserved"], fac["principal_outstanding"], fac["available"]),
                         ("SGD 0.00", "SGD 0.00", "SGD 500,000.00"))

        # 8. Close; export explains who did what and why.
        v = self.checked(op.cmd(cid, "close_case"))
        self.assertEqual(v["status"], "closed")
        self.assertEqual(v["decision"]["tone"], "closed")
        r = op.get("/api/cases/%s/export?format=json" % cid)
        self.assertEqual(r.status, 200, r)
        self.assertIn("attachment", r.headers["content-disposition"])
        doc = json.loads(r.raw.decode("utf-8"))
        text = json.dumps(doc)
        for needle in ("Olivia Tan", "Ravi Menon", "Within limit; balance evidenced and fresh",
                       "Importer keeps cash until its receivable settles", "advance_approved", "draw_recorded",
                       "repayment_matched", "case_closed", "external_record"):
            self.assertIn(needle, text)
        self.assertNotIn("password_hash", text)
        self.assertNotIn("csrf", text.lower().replace("csrf_required", ""))
        for fmt, ctype in (("csv", "text/csv"), ("html", "text/html")):
            r = op.get("/api/cases/%s/export?format=%s" % (cid, fmt))
            self.assertEqual(r.status, 200, r)
            self.assertTrue(r.headers["content-type"].startswith(ctype))
            self.assertIn(b"Ravi Menon", r.raw)

        # Every event is in the history with actor role and both times.
        v = self.assertOk(op.case(cid))
        for t in v["timeline"]:
            self.assertTrue(t["known_at"] and t["effective_at"] and t["provenance"])
        roles = {t["actor"]: t["actor_role"] for t in v["timeline"] if t["actor_role"] in ("operator", "reviewer")}
        self.assertEqual(roles, {"Olivia Tan": "operator", "Ravi Menon": "reviewer"})
        # Closed: nothing but notes.
        r = op.cmd(cid, "record_repayment", amount="1.00", currency="SGD", bank_ref="X")
        self.assertEqual((r.status, r.code), (409, "case_closed"))
