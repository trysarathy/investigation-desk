"""Route feasibility (stale balance, missed cutoff, suspended facility, fixed contract), draws under suspension."""


import backend_support  # noqa: F401,E402  (puts the repo root on sys.path)
from pilot import db
from backend_support import ServerCase


def set_facility(env, **cols):
    conn = env.conn()
    try:
        with db.tx(conn):
            for k, v in cols.items():
                conn.execute("UPDATE facilities SET %s=? WHERE id='FAC-HL-01'" % k, (v,))
    finally:
        conn.close()


class RouteAssessmentTest(ServerCase):
    def test_stale_balance_is_unknown_not_short(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        v = self.add_balance(op, cid, amount="500,000.00", as_of="2026-11-29T00:00:00Z")  # 49 h old
        a, c = self.route(v, "A"), self.route(v, "C")
        self.assertEqual(a["status"], "unknown")
        self.assertEqual(c["status"], "unknown")
        self.assertIn("unknown, not insufficient", c["missing"][0])
        self.assertEqual(v["decision"]["tone"], "unknown")
        r = op.cmd(cid, "request_advance", reason="try")
        self.assertEqual((r.status, r.code), (409, "route_not_feasible"))
        # Exactly the limit is fresh: 24 h before window A for A, 24 h before now for C.
        v = self.add_balance(op, cid, amount="500,000.00", as_of="2026-12-01T01:00:00Z")
        self.assertEqual(self.route(v, "C")["status"], "feasible")
        self.assertEqual(self.route(v, "A")["status"], "unknown")  # 30 h old at window A
        db.set_clock("2026-12-02T06:30:00Z")
        op.relogin()
        v = self.add_balance(op, cid, amount="500,000.00", as_of="2026-12-01T07:00:00Z")  # exactly 24 h at window
        self.assertEqual(self.route(v, "A")["status"], "feasible")

    def test_other_currency_balance_is_unknown_and_commitments_net(self):
        op = self.client()
        db.set_clock("2026-12-02T06:00:00Z")
        op.relogin()
        cid = self.new_case(op)["id"]
        v = self.add_balance(op, cid, amount="200,000.00", currency="USD", as_of="2026-12-02T05:00:00Z")
        self.assertEqual(self.route(v, "A")["status"], "unknown")
        self.assertIn("in USD", self.route(v, "A")["missing"][0])
        v = self.add_balance(op, cid, amount="100,000.00", as_of="2026-12-02T05:00:00Z")
        self.assertEqual(self.route(v, "A")["status"], "feasible")
        v = self.assertOk(op.cmd(cid, "add_observation", kind="commitment", amount="20,000.00", currency="SGD",
                                 due_at="2026-12-02T07:30:00Z", description="Payroll"))
        a = self.route(v, "A")
        self.assertEqual(a["status"], "infeasible")
        self.assertEqual(a["usable_balance"], "SGD 80,000.00")

    def test_missed_cutoff_makes_a_infeasible(self):
        op = self.client()
        db.set_clock("2026-12-02T08:00:00Z")  # exactly the cutoff (exclusive)
        op.relogin()
        cid = self.new_case(op)["id"]
        v = self.add_balance(op, cid, amount="500,000.00", as_of="2026-12-02T06:00:00Z")
        a = self.route(v, "A")
        self.assertEqual(a["status"], "infeasible")
        self.assertIn("cutoff", a["disqualifiers"][0])
        r = op.cmd(cid, "select_route", route="A")
        self.assertEqual((r.status, r.code), (409, "route_not_feasible"))

    def test_too_late_for_payout_lead_time(self):
        op = self.client()
        db.set_clock("2026-12-04T03:00:00Z")  # 7 h before the deadline; lead time is 8 h
        op.relogin()
        cid = self.new_case(op)["id"]
        v = self.add_balance(op, cid)
        c = self.route(v, "C")
        self.assertEqual(c["status"], "infeasible")
        self.assertTrue(any("lead time" in d for d in c["disqualifiers"]))
        self.assertEqual(v["decision"]["tone"], "blocked")

    def test_suspended_facility_makes_c_infeasible(self):
        set_facility(self.env, status="suspended")
        op = self.client()
        cid = self.new_case(op)["id"]
        v = self.add_balance(op, cid)
        c = self.route(v, "C")
        self.assertEqual(c["status"], "infeasible")
        self.assertIn("suspended", c["disqualifiers"][0])
        fac = self.assertOk(op.get("/api/facilities"))["facilities"][0]
        self.assertEqual(fac["status"], "suspended")

    def test_fixed_contract_date_and_route_b(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        v = self.add_balance(op, cid)
        b = self.route(v, "B")
        self.assertEqual(b["status"], "infeasible")
        self.assertIn("Contract fixes the funding date", b["disqualifiers"][0])
        # A case that permits later funding: forecasts never count, documented support does.
        cid = self.new_case(op, later_permitted=True, window_b_at="2026-12-03T07:00:00Z",
                            window_b_cutoff_at="2026-12-03T08:00:00Z")["id"]
        v = self.assertOk(op.cmd(cid, "add_observation", kind="expected_receipt", amount="150,000.00", currency="SGD",
                                 expected_at="2026-12-03T01:00:00Z", payer="Customer"))
        b = self.route(v, "B")
        self.assertEqual(b["status"], "infeasible")
        self.assertIn("forecast and never counts", b["disqualifiers"][0])
        v = self.assertOk(op.cmd(cid, "add_observation", kind="cash_support", amount="89,450.25", currency="SGD",
                                 effective_at="2026-12-03T06:00:00Z", document_ref="Facility letter KES-9"))
        self.assertEqual(self.route(v, "B")["status"], "feasible")
        # A terms observation that fixes the date overrides the case flag.
        v = self.assertOk(op.cmd(cid, "add_observation", kind="terms", later_permitted=False, contract_ref="CT-KES-07a"))
        self.assertEqual(self.route(v, "B")["status"], "infeasible")
        # Correcting it (supersede) restores B; the old record is struck, not deleted.
        terms = [o for o in v["observations"] if o["kind"] == "terms"][0]
        v = self.assertOk(op.cmd(cid, "supersede_observation", event_id=terms["event_id"], later_permitted=True,
                                 contract_ref="CT-KES-07a", reason="Misread clause 4.2"))
        self.assertEqual(self.route(v, "B")["status"], "feasible")
        old = [o for o in v["observations"] if o["event_id"] == terms["event_id"]][0]
        self.assertTrue(old["struck"])
        v = self.assertOk(op.cmd(cid, "select_route", route="B", reason="Importer funds later"))
        self.assertEqual(v["status"], "route_selected")
        r = op.cmd(cid, "record_prefunding", amount="89,450.00", currency="SGD", reference="PF-1")
        self.assertEqual((r.status, r.code), (422, "validation_failed"))
        v = self.assertOk(op.cmd(cid, "record_prefunding", amount="89,450.25", currency="SGD", reference="PF-1"))
        self.assertEqual(v["exposure_panel"]["status"], "none")
        self.assertEqual(self.action(v, "instruct_payout")["enabled"], True)

    def test_no_feasible_route_is_valid(self):
        set_facility(self.env, status="suspended")
        op = self.client()
        db.set_clock("2026-12-02T09:00:00Z")
        op.relogin()
        cid = self.new_case(op)["id"]
        v = self.add_balance(op, cid, as_of="2026-12-02T08:30:00Z")
        self.assertEqual([r["status"] for r in v["routes"]], ["infeasible", "infeasible", "infeasible"])
        self.assertEqual(v["decision"]["tone"], "blocked")
        self.assertIn("No feasible route", v["decision"]["headline"])


class SuspensionDrawTest(ServerCase):
    def test_unset_policy_refers_then_reviewer_authorizes(self):
        op, rv = self.client(), self.client("reviewer")
        cid, v = self.to_reserved(op, rv)
        set_facility(self.env, status="suspended", suspension_policy="unset")
        r = op.cmd(cid, "record_draw", reference="D1")
        self.assertEqual((r.status, r.code), (409, "referred"))
        v = self.assertOk(op.case(cid))
        self.assertEqual(v["status"], "draw_referred")
        self.assertEqual(v["decision"]["next_action"]["command"], "authorize_draw")
        q = self.assertOk(rv.get("/api/queue"))
        self.assertIn(cid, [x["case_id"] for x in q["sections"][0]["rows"]])
        r = op.cmd(cid, "record_draw", reference="D1")
        self.assertEqual((r.status, r.code), (409, "referred"))
        self.assertEqual(op.cmd(cid, "authorize_draw", reason="x").status, 403)
        self.assertOk(rv.cmd(cid, "authorize_draw", reason="Existing reservation honoured per credit memo"))
        v = self.assertOk(op.cmd(cid, "record_draw", reference="D1"))
        self.assertEqual(v["exposure_panel"]["status"], "outstanding")
        self.assertIdentities(v)

    def test_block_draws_refuses_and_honour_existing_allows(self):
        op, rv = self.client(), self.client("reviewer")
        cid, v = self.to_reserved(op, rv)
        set_facility(self.env, status="suspended", suspension_policy="block_draws")
        r = op.cmd(cid, "record_draw", reference="D1")
        self.assertEqual((r.status, r.code), (409, "facility_suspended"))
        set_facility(self.env, suspension_policy="honour_existing")
        v = self.assertOk(op.cmd(cid, "record_draw", reference="D1"))
        self.assertEqual(v["exposure_panel"]["status"], "outstanding")

    def test_release_and_lazy_expiry(self):
        op, rv = self.client(), self.client("reviewer")
        cid, v = self.to_reserved(op, rv)
        self.assertEqual(op.cmd(cid, "release_reservation", reason="x").status, 403)
        v = self.assertOk(rv.cmd(cid, "release_reservation", reason="Importer found its own cash"))
        self.assertEqual(v["exposure_panel"]["status"], "none")
        self.assertEqual(v["decision"]["tone"], "declined")
        cid2, v = self.to_reserved(op, rv)
        exp = db.parse_iso([t for t in v["timeline"] if t["type"] == "advance_approved"][0]["known_at"])
        self.assertEqual(v["exposure_panel"]["reserved"], "SGD 89,450.25")
        db.set_clock("2026-12-04T02:00:00Z")  # deadline 10:00Z minus 8 h lead = reservation expiry
        op.relogin()
        v = self.assertOk(op.case(cid2))
        self.assertEqual(v["status"], "expired")
        self.assertEqual([t for t in v["timeline"] if t["type"] == "reservation_expired"][0]["provenance"], "system")
        fac = self.assertOk(op.get("/api/facilities"))["facilities"][0]
        self.assertEqual(fac["reserved"], "SGD 0.00")
        self.assertTrue(exp)

    def test_decline_and_request_evidence(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.new_case(op)["id"]
        self.add_balance(op, cid)
        self.assertOk(op.cmd(cid, "request_advance", reason="r"))
        v = self.assertOk(rv.cmd(cid, "request_evidence", what="Signed balance confirmation"))
        self.assertEqual(v["status"], "evidence_requested")
        q = self.assertOk(op.get("/api/queue"))
        self.assertIn(cid, [x["case_id"] for x in q["sections"][1]["rows"]])
        self.add_balance(op, cid)
        self.assertOk(op.cmd(cid, "request_advance", reason="Evidence added"))
        v = self.assertOk(rv.cmd(cid, "decline", reason="Concentration limit for this importer"))
        self.assertEqual(v["decision"]["tone"], "declined")
        self.assertEqual(v["exposure_panel"]["status"], "none")
        r = op.cmd(cid, "request_advance", reason="again")
        self.assertEqual((r.status, r.code), (409, "declined"))
