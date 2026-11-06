"""§13.3–13.9 against the real HTTP server: evidence fields and fact status, policy-required facts (scenario B), cash /
credit blockers (scenario C), decision record, as-of replay, same-provider duplicate check, overdue vs default,
pilot measurement report."""

import contextlib
import io
import json
import unittest

from backend_support import ServerCase, kestrel_body  # noqa: F401
from pilot import cli, db

POL = "POL-HL v2026.12-1"
NO_MATCH = "No matching record in this provider's book."


def update_facility(env, *args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(["--db", env.path, "update-facility", "--id", "FAC-HL-01"] + list(args))
    assert code == 0, err.getvalue()


def blocker_codes(route):
    return [b["code"] for b in route["blockers"]]


class EvidenceFieldsTest(ServerCase):
    def test_issuer_record_ref_scope_invoice_and_fact_status(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        v = self.assertOk(op.cmd(cid, "add_observation", kind="balance", amount="20,000.00", currency="SGD",
                                 as_of="2026-12-01T00:30:00Z", source="Bank portal", issuer="DBS (synthetic)",
                                 record_ref="STMT-991", scope="importer"))
        o = v["observations"][0]
        self.assertEqual((o["issuer"], o["record_ref"], o["scope"], o["fact_status"]),
                         ("DBS (synthetic)", "STMT-991", "importer", "fresh"))
        r = op.cmd(cid, "add_observation", kind="balance", amount="1.00", currency="SGD", as_of="2026-12-01T00:30:00Z",
                   source="x", scope="planet")
        self.assertEqual((r.status, r.json["error"]["field"]), (422, "scope"))
        r = op.cmd(cid, "add_observation", kind="invoice", amount="61,400.00", currency="EUR", invoice_ref="INV-1")
        self.assertEqual(r.status, 422)
        self.assertEqual({f["field"] for f in r.json["error"]["fields"]}, {"issuer", "issued_at"})
        v = self.assertOk(op.cmd(cid, "add_observation", kind="invoice", amount="61,400.00", currency="EUR",
                                 invoice_ref="INV-1", issuer="Lindqvist Optics AB", issued_at="2026-11-28T02:00:00Z"))
        inv = [x for x in v["observations"] if x["kind"] == "invoice"][0]
        self.assertIn("Supplier invoice INV-1", inv["text"])
        # a second balance with the same as-of and a different amount: both conflicting, C and A unknown
        v = self.assertOk(op.cmd(cid, "add_observation", kind="balance", amount="5,000.00", currency="SGD",
                                 as_of="2026-12-01T00:30:00Z", source="Operator note"))
        self.assertEqual([x["fact_status"] for x in v["observations"] if x["kind"] == "balance"],
                         ["conflicting", "conflicting"])
        for key in ("A", "C"):
            rt = self.route(v, key)
            self.assertEqual(rt["status"], "unknown", rt)
            self.assertTrue(any(m.startswith("Conflicting records: balance SGD 20,000.00 vs SGD 5,000.00")
                                for m in rt["missing"]), rt["missing"])
        self.assertTrue(any(u["kind"] == "conflicting" for u in v["decision_record"]["uncertain"]))
        # superseding one resolves the conflict; the old record shows superseded
        bad = [x for x in v["observations"] if x["kind"] == "balance"][1]["event_id"]
        v = self.assertOk(op.cmd(cid, "supersede_observation", event_id=bad, amount="20,000.00", currency="SGD",
                                 as_of="2026-12-01T00:30:00Z", source="Corrected", reason="Typo"))
        st = {x["event_id"]: x["fact_status"] for x in v["observations"]}
        self.assertEqual(st[bad], "superseded")
        self.assertEqual(self.route(v, "C")["status"], "feasible")
        # time makes the balance stale (24 h policy)
        db.set_clock("2026-12-02T02:00:00Z")
        op.relogin()
        v = self.assertOk(op.case(cid))
        self.assertIn("stale", [x["fact_status"] for x in v["observations"] if x["kind"] == "balance"])
        self.assertIn("policy_stale_balance", blocker_codes(self.route(v, "C")))


class ScenarioBTest(ServerCase):
    """Missing required fact blocks; dated evidence clears only that blocker; reviewer may still decline;
    decline -> new evidence -> new request -> approval; replay at the earlier checkpoint knows nothing later."""

    def test_policy_fact_blocks_then_clears_then_decline_and_rerequest(self):
        update_facility(self.env, "--policy-version", "POL-HL v3", "--required-evidence", "invoice,balance")
        op, rv, rv2 = self.client(), self.client("reviewer"), self.client("reviewer2")
        v = self.new_case(op, invoice_ref="INV-LO-2026-7781")
        cid = v["id"]
        v = self.add_balance(op, cid)
        rc = self.route(v, "C")
        self.assertEqual(rc["status"], "unknown")
        blk = [b for b in rc["blockers"] if b["code"] == "policy_requires_invoice"][0]
        self.assertEqual((blk["kind"], blk["text"]), ("evidence", "Policy POL-HL v3 requires invoice: not on record"))
        r = op.cmd(cid, "request_advance", reason="r")
        self.assertEqual((r.status, r.code), (409, "route_not_feasible"))
        self.assertEqual(v["decision_record"]["waiting_for"][-1]["code"], "policy_requires_invoice")
        t_before = v["generated_at"]
        before_c = blocker_codes(rc)
        # later that morning the supplier's invoice (dated before the cutoff) is recorded
        db.set_clock("2026-12-01T03:00:00Z")
        op.relogin(); rv.relogin(); rv2.relogin()
        ev = self.assertOk(op.evidence(cid, "invoice.pdf", "application/pdf", b"%PDF-1.4 synthetic invoice"), 201)
        # §13.4 / challenger v2: the invoice must carry the case payout currency and amount to satisfy the policy.
        payout = v["header"]["payout"].split(" ", 1)[1]
        v = self.assertOk(op.cmd(cid, "add_observation", kind="invoice", amount=payout, currency="EUR",
                                 invoice_ref="inv lo 2026 7781", issuer="Lindqvist Optics AB",
                                 issued_at="2026-11-30T02:00:00Z", record_ref="LO-7781",
                                 evidence_id=ev["evidence_added"]["id"]))
        rc = self.route(v, "C")
        self.assertEqual(rc["status"], "feasible", rc)
        cp = v["decision_record"]["checkpoints"][-1]
        self.assertEqual((cp["trigger"], cp["route_c_before"], cp["route_c_after"]), ("observation", "unknown", "feasible"))
        self.assertEqual([b["code"] for b in cp["blockers_cleared"]], ["policy_requires_invoice"])
        self.assertEqual(cp["blockers_added"], [])
        self.assertEqual(set(before_c) - {"policy_requires_invoice"}, set(blocker_codes(rc)))
        self.assertTrue(any(f["kind"] == "invoice" and f["evidence_id"] for f in cp["facts"]["observed"]))
        self.assertTrue(any(p["rule"] == "required_evidence:invoice" and p["result"] == "met"
                            and p["policy_version"] == "POL-HL v3" for p in cp["facts"]["policy"]))
        self.assertEqual([c["code"] for c in v["decision_record"]["changed"]], ["policy_requires_invoice"])
        ex = self.assertOk(op.get("/api/cases/%s/export?format=json" % cid))
        elig = [e for e in ex["events"] if e["type"] == "eligibility_evaluated"]
        self.assertTrue(elig and all(e["provenance"] == "system" for e in elig))
        # the reviewer may still decline: judgment, with reason
        self.assertOk(op.cmd(cid, "request_advance", reason="Invoice now on record"))
        v = self.assertOk(rv.cmd(cid, "decline", reason="Importer concentration above appetite this week"))
        self.assertEqual(v["decision"]["tone"], "declined")
        j = v["decision_record"]["judgments"]
        self.assertEqual((j[-1]["decision"], j[-1]["reason"]), ("declined", "Importer concentration above appetite this week"))
        self.assertEqual(self.route(v, "C")["status"], "infeasible")
        self.assertEqual(op.cmd(cid, "request_advance", reason="again").code, "declined")
        # new evidence -> a fresh request is possible; the earlier decline is never rewritten
        self.add_balance(op, cid, amount="35,000.00", as_of="2026-12-01T02:45:00Z")
        v = self.assertOk(op.case(cid))
        self.assertEqual(self.route(v, "C")["status"], "feasible")
        self.assertIn("new evidence", v["decision"]["headline"])
        self.assertOk(op.cmd(cid, "request_advance", reason="Updated balance; concentration eased"))
        v = self.assertOk(rv2.cmd(cid, "approve_and_reserve", reason="Within appetite after the update"))
        self.assertEqual(v["exposure_panel"]["status"], "reserved")
        decisions = [x["decision"] for x in v["decision_record"]["judgments"]]
        self.assertEqual(decisions, ["declined", "approved"])
        self.assertEqual([t["type"] for t in v["timeline"]].count("advance_declined"), 1)
        self.assertEqual([t["type"] for t in v["timeline"]].count("advance_requested"), 2)
        self.assertIdentities(v)
        # ---- as-of replay at the earlier checkpoint: no knowledge of the invoice, the decline or the approval
        rp = self.assertOk(op.get("/api/cases/%s?as_of=%s" % (cid, t_before)))
        self.assertEqual(rp["replay"]["as_of"], t_before)
        self.assertTrue(rp["replay"]["note"].startswith("Replay: shows only what was known at"))
        self.assertEqual(rp["actions"], [])
        self.assertEqual(self.route(rp, "C")["status"], "unknown")
        self.assertFalse(any(o["kind"] == "invoice" for o in rp["observations"]))
        self.assertFalse(any(t["type"] in ("advance_declined", "advance_approved", "advance_requested")
                             for t in rp["timeline"]))
        self.assertNotIn("invoice.pdf", [e["filename"] for e in rp["evidence"]])
        self.assertEqual(rp["exposure_panel"]["status"], "none")
        self.assertEqual(rp["decision_record"]["judgments"], [])
        self.assertTrue(all(c["at"] <= t_before for c in rp["decision_record"]["checkpoints"]))
        self.assertEqual(rp["header"]["policy_version"], "POL-HL v3")
        self.assertTrue(all(i["ok"] for i in rp["identities"]))
        # replay is org-scoped, validated, and read-only
        mr = self.client(org="meridian")
        self.assertEqual(mr.get("/api/cases/%s?as_of=%s" % (cid, t_before)).status, 404)
        self.assertEqual(op.get("/api/cases/%s?as_of=yesterday" % cid).status, 422)
        self.assertEqual(op.get("/api/cases/%s?as_of=2020-01-01T00:00:00Z" % cid).status, 404)
        self.assertEqual(self.route(op.case(cid).json, "C")["selected"], True)

    def test_replay_uses_facility_terms_in_force_then(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        self.add_balance(op, cid)
        t1 = op.case(cid).json["generated_at"]
        db.set_clock("2026-12-01T02:00:00Z")
        update_facility(self.env, "--policy-version", "POL-HL v4", "--required-evidence", "invoice,balance")
        op.relogin()
        now = op.case(cid).json
        self.assertEqual(self.route(now, "C")["status"], "unknown")
        rp = self.assertOk(op.get("/api/cases/%s?as_of=%s" % (cid, t1)))
        self.assertEqual(self.route(rp, "C")["status"], "feasible")
        self.assertEqual(rp["header"]["policy_version"], POL)


class ScenarioCTest(ServerCase):
    """Complete evidence, but insufficient funding cash or a competing reservation: still blocked, constraint named."""

    def test_funding_cash_short_with_complete_evidence(self):
        update_facility(self.env, "--policy-version", "POL-HL v5", "--funding-cash", "25,000.00")
        op = self.client()
        cid = self.new_case(op, funding_amount="30,000.00")["id"]
        v = self.add_balance(op, cid)
        rc = self.route(v, "C")
        self.assertEqual(rc["status"], "infeasible")
        self.assertEqual(rc["missing"], [])
        cash = [b for b in rc["blockers"] if b["code"] == "funding_cash_short"][0]
        self.assertEqual(cash["kind"], "cash")
        txt = "Provider funding cash SGD 25,000.00 is below the SGD 30,000.00 needed."
        self.assertEqual(cash["text"], txt)
        self.assertIn(txt, v["decision"]["headline"])
        self.assertEqual(v["decision"]["binding_constraint"], txt)
        self.assertTrue(v["decision"]["next_action"]["label"].startswith(
            "Refer to provider treasury: funding cash SGD 25,000.00 is below SGD 30,000.00"))
        self.assertEqual(v["decision"]["owner_role"], "reviewer")
        self.assertNotEqual(v["decision"]["next_action"].get("command"), "add_observation")
        self.assertEqual(op.cmd(cid, "request_advance", reason="r").code, "route_not_feasible")

    def test_competing_reservation_blocks_and_is_named(self):
        update_facility(self.env, "--policy-version", "POL-HL v6", "--limit", "150,000.00")
        op, rv = self.client(), self.client("reviewer")
        cid1, _ = self.to_reserved(op, rv)
        cid2 = self.new_case(op)["id"]
        v = self.add_balance(op, cid2)
        rc = self.route(v, "C")
        self.assertEqual(rc["status"], "infeasible")
        credit = [b for b in rc["blockers"] if b["kind"] == "credit"][0]
        self.assertEqual(credit["text"], "Facility headroom SGD 60,549.75 is below the SGD 89,450.25 needed.")
        self.assertIn(credit["text"], v["decision"]["headline"])
        # releasing the competing reservation clears it (a checkpoint on the next command records the clock change)
        self.assertOk(rv.cmd(cid1, "release_reservation", reason="Importer self-funded"))
        v = self.assertOk(op.cmd(cid2, "add_note", text="Re-checking capacity"))
        self.assertEqual(self.route(v, "C")["status"], "feasible")
        cp = v["decision_record"]["checkpoints"][-1]
        self.assertEqual(cp["trigger"], "clock")
        self.assertIn("headroom_short", [b["code"] for b in cp["blockers_cleared"]])


class DuplicateCheckTest(ServerCase):
    def test_same_org_potential_match_blocks_until_reviewer_resolves(self):
        op, rv = self.client(), self.client("reviewer")
        a = self.new_case(op, invoice_ref="INV-77/A")
        self.assertEqual(a["duplicate_check"], dict(a["duplicate_check"], status="no_match", matches=[], text=NO_MATCH))
        b = self.new_case(op, invoice_ref="inv 77 a", payout_amount="1,000.00")
        dc = b["duplicate_check"]
        self.assertEqual((dc["status"], dc["matches"]), ("potential_match", [a["id"]]))
        self.assertNotIn("financed elsewhere", json.dumps(b).lower())
        self.add_balance(op, b["id"])
        r = op.cmd(b["id"], "request_advance", reason="r")
        self.assertEqual((r.status, r.code), (409, "potential_duplicate"))
        v = op.case(b["id"]).json
        self.assertEqual(v["decision"]["next_action"]["command"], "resolve_duplicate_check")
        self.assertEqual(op.cmd(b["id"], "resolve_duplicate_check", decision="not_duplicate", reason="x").status, 403)
        r = rv.cmd(b["id"], "resolve_duplicate_check", decision="maybe", reason="x")
        self.assertEqual(r.status, 422)
        v = self.assertOk(rv.cmd(b["id"], "resolve_duplicate_check", decision="not_duplicate",
                                 reason="Separate shipment; supplier confirmed two invoices with similar numbers"))
        self.assertEqual(v["duplicate_check"]["status"], "overridden")
        self.assertOk(op.cmd(b["id"], "request_advance", reason="r"))
        # confirmed duplicate: only close with exception duplicate_case
        c = self.new_case(op, invoice_ref="INV-77-A")
        self.assertEqual(c["duplicate_check"]["status"], "potential_match")
        self.assertEqual(set(c["duplicate_check"]["matches"]), {a["id"], b["id"]})
        self.assertOk(rv.cmd(c["id"], "resolve_duplicate_check", decision="duplicate", reason="Same invoice re-entered"))
        self.assertEqual(op.cmd(c["id"], "request_advance", reason="r").code, "duplicate_case")
        self.assertEqual(rv.cmd(c["id"], "close_with_exception", disposition="other_documented", reason="x").code,
                         "duplicate_case")
        v = self.assertOk(rv.cmd(c["id"], "close_with_exception", disposition="duplicate_case", reason="Duplicate"))
        self.assertEqual(v["status"], "closed_exception")

    def test_amount_window_and_invoice_observation_triggers(self):
        op = self.client()
        a = self.new_case(op, invoice_ref="INV-A", payout_amount="5,000.00")
        near = self.new_case(op, invoice_ref="INV-B", payout_amount="5,000.00", deadline_at="2026-12-20T10:00:00Z")
        self.assertEqual(near["duplicate_check"]["matches"], [a["id"]])
        far = self.new_case(op, invoice_ref="INV-C", payout_amount="5,000.00", deadline_at="2027-02-20T10:00:00Z",
                            window_a_at="2027-02-18T07:00:00Z", window_a_cutoff_at="2027-02-18T08:00:00Z")
        self.assertEqual(far["duplicate_check"]["status"], "no_match")
        other_sup = self.new_case(op, invoice_ref="INV-A", payout_amount="5,000.00", supplier="Another Supplier GmbH")
        self.assertEqual(other_sup["duplicate_check"]["text"], NO_MATCH)
        # an invoice observation naming another case's invoice ref re-runs the check
        v = self.assertOk(op.cmd(far["id"], "add_observation", kind="invoice", amount="5,000.00", currency="EUR",
                                 invoice_ref="INV-A", issuer="Lindqvist Optics AB", issued_at="2026-11-30T00:00:00Z"))
        self.assertEqual((v["duplicate_check"]["status"], v["duplicate_check"]["matches"]), ("potential_match", [a["id"]]))
        self.assertEqual([t["provenance"] for t in v["timeline"] if t["type"] == "duplicate_check_run"],
                         ["system", "system"])

    def test_overlapping_invoice_refs_across_orgs_never_leak(self):
        hl, mr = self.client(), self.client(org="meridian")
        a = self.new_case(hl, invoice_ref="INV-SHARED-1", payout_amount="7,777.00", facility_id="FAC-HL-01")
        b = self.new_case(mr, invoice_ref="INV-SHARED-1", payout_amount="7,777.00", facility_id="FAC-MR-01")
        self.assertEqual((b["duplicate_check"]["status"], b["duplicate_check"]["matches"]), ("no_match", []))
        self.assertEqual(b["duplicate_check"]["text"], NO_MATCH)
        self.assertNotIn(a["id"], json.dumps(b))
        v = self.assertOk(mr.cmd(b["id"], "add_observation", kind="invoice", amount="7,777.00", currency="EUR",
                                 invoice_ref="INV-SHARED-1", issuer="Lindqvist Optics AB",
                                 issued_at="2026-11-30T00:00:00Z"))
        self.assertNotIn(a["id"], json.dumps(v))
        self.assertEqual(v["duplicate_check"]["status"], "no_match")
        # and a second HL case does match the first HL case only
        c = self.new_case(hl, invoice_ref="inv-shared-1")
        self.assertEqual(c["duplicate_check"]["matches"], [a["id"]])
        self.assertNotIn(b["id"], json.dumps(c))


class OverdueDefaultTest(ServerCase):
    def test_overdue_is_not_default_and_default_is_a_reviewer_judgment(self):
        op, rv = self.client(), self.client("reviewer")
        cid, _ = self.to_reserved(op, rv)
        self.assertOk(op.cmd(cid, "record_draw", reference="D1"))
        self.assertOk(op.cmd(cid, "instruct_payout", route="manual", external_ref="E1"))
        v = self.assertOk(op.cmd(cid, "record_delivery", status="credited", reference="C1"))
        self.assertEqual(v["exposure_panel"]["status_label"], "Outstanding — owed to the provider")
        self.assertEqual(rv.cmd(cid, "declare_default", reason="early").code, "not_overdue")
        db.set_clock("2026-12-08T01:00:00Z")  # after the 7 Dec 17:00 SGT due date
        op.relogin(); rv.relogin()
        v = self.assertOk(op.case(cid))
        self.assertEqual(v["exposure_panel"]["status_label"], "Overdue — not a default determination")
        self.assertIn("not a default determination", v["decision"]["headline"])
        self.assertNotIn("default declared", json.dumps(v).lower())
        self.assertEqual(op.cmd(cid, "declare_default", reason="x").status, 403)
        self.assertEqual(rv.cmd(cid, "declare_default").status, 422)
        v = self.assertOk(rv.cmd(cid, "declare_default", reason="No contact for 5 days; referred to recoveries"))
        self.assertTrue(v["exposure_panel"]["status_label"].startswith("Default declared by a reviewer (judgment"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 89,600.25")
        self.assertEqual(v["decision_record"]["judgments"][-1]["decision"], "default_declared")
        self.assertEqual(rv.cmd(cid, "declare_default", reason="again").code, "already_declared")
        self.assertIdentities(v)


class MeasurementTest(ServerCase):
    def test_log_work_baseline_and_report(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.new_case(op)["id"]
        self.add_balance(op, cid)
        rep = self.assertOk(op.get("/api/cases/%s/report?format=json" % cid))
        self.assertTrue(all(c["label"] == "not measured" for c in rep["baseline"]["cells"].values()))
        self.assertNotIn("synthetic", json.dumps(rep["baseline"]).lower())
        self.assertEqual(rep["clearline"]["active_minutes"]["label"], "not measured")
        self.assertEqual(rep["clearline"]["decision_hours"]["label"], "not measured")
        self.assertIn("does not count capital released, advance principal or transferred credit risk as savings",
                      rep["not_savings"])
        self.assertOk(op.cmd(cid, "request_advance", reason="r"))
        db.set_clock("2026-12-01T04:00:00Z")
        op.relogin(); rv.relogin()
        self.assertOk(rv.cmd(cid, "request_evidence", what="Signed statement"))
        self.add_balance(op, cid, as_of="2026-12-01T03:30:00Z")
        self.assertOk(op.cmd(cid, "request_advance", reason="again"))
        self.assertOk(rv.cmd(cid, "decline", reason="Out of appetite"))
        self.assertOk(op.cmd(cid, "log_work", minutes=25, activity="Collected balance evidence"))
        self.assertOk(rv.cmd(cid, "log_work", minutes=10, activity="Review", provenance="operator_reported"))
        self.assertEqual(op.cmd(cid, "log_work", minutes=0, activity="x").status, 422)
        self.assertEqual(op.cmd(cid, "log_work", minutes=5, activity="x", provenance="computed").status, 422)
        self.assertEqual(op.cmd(cid, "record_baseline", provenance="guessed", source_note="x").status, 422)
        self.assertOk(rv.cmd(cid, "close_with_exception", disposition="cancelled_before_payout", reason="Declined"))
        # measurement is allowed after close; money commands are not
        self.assertOk(op.cmd(cid, "log_work", minutes=5, activity="Filed the case"))
        self.assertOk(op.cmd(cid, "record_baseline", provenance="estimated", operator_minutes=120, touchpoints=11,
                             evidence_requests=2, decision_hours=26, deadline_met=False, outcome="missed cutoff",
                             source_note="Ops lead's estimate of the previous email/spreadsheet process"))
        self.assertEqual(op.cmd(cid, "add_observation", kind="balance", amount="1.00", currency="SGD",
                                as_of="2026-12-01T03:00:00Z", source="x").code, "case_closed")
        viewer = self.client("viewer")
        self.assertEqual(viewer.cmd(cid, "log_work", minutes=5, activity="x").status, 403)
        rep = self.assertOk(viewer.get("/api/cases/%s/report?format=json" % cid))
        cl = rep["clearline"]
        self.assertEqual((cl["active_minutes"]["value"], cl["active_minutes"]["label"]), (40, "recorded"))
        self.assertEqual((cl["decision_hours"]["value"], cl["decision_hours"]["label"]), (3.0, "computed"))
        self.assertEqual((cl["elapsed_wait_minutes"]["value"], cl["elapsed_wait_minutes"]["label"]), (140, "computed"))
        self.assertEqual(cl["evidence_requests"]["value"], 1)
        self.assertEqual(cl["deadline_met"]["label"], "not measured")
        self.assertEqual(cl["touchpoints"]["label"], "computed")
        b = rep["baseline"]["cells"]
        self.assertEqual((b["operator_minutes"]["value"], b["operator_minutes"]["label"]), (120, "estimated"))
        self.assertEqual(b["deadline_met"]["value"], False)
        for row in rep["rows"]:
            for side in ("clearline", "baseline"):
                self.assertIn(row[side]["label"], rep["labels"]["allowed"])
        low = json.dumps(rep).lower()
        self.assertNotIn("saved principal", low)
        self.assertEqual(low.replace("not count capital released", "").count("capital released"), 0)
        html = viewer.get("/api/cases/%s/report?format=html" % cid)
        self.assertEqual(html.status, 200)
        self.assertIn(b"not count capital released", html.raw)
        self.assertEqual(viewer.get("/api/cases/%s/report?format=xml" % cid).status, 400)
        mr = self.client(org="meridian")
        self.assertEqual(mr.get("/api/cases/%s/report?format=json" % cid).status, 404)
        self.assertEqual(mr.cmd(cid, "log_work", version=1, minutes=5, activity="x").status, 404)


if __name__ == "__main__":
    unittest.main()
