"""Provider funding lifecycle engine tests (simulated fixtures; no funds move).

Run from funding-replay/:  python3 -m unittest discover -s tests -v
"""

import copy
import json
import os
import sys
import unittest
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from engine import lifecycle as L  # noqa: E402

REF_PATH = ["request_advance", "approve_reserve", "draw", "instruct", "sim_accept", "sim_credit"]
_REACH = {}


def reach(case):
    if case not in _REACH:
        _REACH[case] = L.reachable(case)
    return _REACH[case]


def run(case, actions):
    st = L.initial_state(case)
    for a in actions:
        nxt = L.apply(st, a)
        if L.state_id(nxt) == L.state_id(st):
            raise AssertionError("Action %s was a no-op at %s: %s" % (
                a, L.view(st)["clock"]["sgt"], [(x["id"], x["enabled"], x["disabled_reason"]) for x in L.available_actions(st)]))
        st = nxt
    return st


def action(view, aid):
    for a in view["actions"]:
        if a["id"] == aid:
            return a
    return None


def dump(v):
    return json.dumps(v, ensure_ascii=False)


def comparable(v):
    """A view without identifiers that depend on the case id."""
    v = copy.deepcopy(v)
    v.pop("state_id"), v.pop("case")
    for a in v["actions"]:
        a.pop("next")
    return v


WED = REF_PATH + ["advance_clock"]           # credit (Wed 16:20) -> Wed 23:00
THU = WED + ["advance_clock"]                # -> Thu 19 Nov 10:00


class FutureEvidence(unittest.TestCase):
    def test_01_friday_view_cannot_see_thursday_receipt(self):
        v = L.view(L.initial_state("reference"))
        text = dump(v)
        self.assertEqual(v["clock"]["sgt"], "Fri 13 Nov 2026, 15:00 SGT")
        self.assertNotIn("RCV-NW-01", text)
        self.assertNotIn("Thu 19 Nov", text)
        self.assertEqual(v["facts"]["repayment"]["customer_receipts"], [])
        b = v["options"][1]
        self.assertEqual(b["key"], "B")
        self.assertEqual(b["status"], "infeasible")
        self.assertTrue(any("forecast" in x and "does not count" in x for x in b["disqualifiers"]))
        # Nothing reachable before Thursday 10:00 ever mentions the receipt.
        for st in reach("reference").values():
            d = L._derive(st)
            if d.clock < L._t("2026-11-19T10:00:00+08:00"):
                vt = dump(L.view(st))
                self.assertNotIn("RCV-NW-01", vt)
                self.assertNotIn("settled into Northwind", vt)

    def test_10_thursday_arrival_does_not_change_friday_or_wednesday(self):
        with open(os.path.join(L.FIXTURES_DIR, "reference.json"), encoding="utf8") as fh:
            raw = json.load(fh)
        raw["id"] = "reference_no_receipt"
        raw["evidence"] = [e for e in raw["evidence"] if e["id"] != "RCV-NW-01"]
        L.register_case(raw)
        try:
            for path in ([], ["request_advance"], WED):
                a = L.view(run("reference", path))
                b = L.view(run("reference_no_receipt", path))
                self.assertEqual(comparable(a), comparable(b), path)
            # ...and it does change Thursday.
            self.assertNotEqual(comparable(L.view(run("reference", THU))), comparable(L.view(run("reference_no_receipt", THU))))
        finally:
            L.CASES.pop("reference_no_receipt", None)


class Eligibility(unittest.TestCase):
    def test_02_stale_balance_needs_newer_evidence_not_insufficient(self):
        v = L.view(L.initial_state("stale_balance"))
        self.assertEqual(v["decision"]["tone"], "unknown")
        self.assertEqual(v["decision"]["headline"], "We need a newer bank balance before reviewing this advance")
        self.assertNotIn("insufficient", v["decision"]["headline"].lower())
        c = v["options"][2]
        self.assertEqual(c["status"], "unknown")
        bal = [r for r in v["facility"]["rules"] if "bank balance" in r["rule"]][0]
        self.assertIsNone(bal["ok"])
        self.assertIn("unknown, not insufficient", bal["detail"])
        # request-evidence path
        st = run("stale_balance", ["request_advance"])
        self.assertFalse(action(L.view(st), "approve_reserve")["enabled"])
        st = run("stale_balance", ["request_advance", "request_evidence"])
        self.assertEqual(L.view(st)["facts"]["authorization"]["status"], "evidence_requested")
        st = run("stale_balance", ["request_advance", "request_evidence", "sim_fresh_balance"])
        v = L.view(st)
        self.assertEqual(v["clock"]["sgt"], "Fri 13 Nov 2026, 15:20 SGT")
        self.assertTrue(all(r["ok"] is True for r in v["facility"]["rules"]))
        self.assertTrue(action(v, "approve_reserve")["enabled"])
        self.assertIn("BAL-NW-02", [e["id"] for e in v["evidence"]])

    def test_03_fixed_contract_date_rules_out_b(self):
        v = L.view(L.initial_state("fixed_terms"))
        self.assertEqual(v["decision"]["headline"], "Later funding unavailable")
        opts = {o["key"]: o for o in v["options"]}
        self.assertEqual(opts["B"]["status"], "infeasible")
        self.assertIn("fixes prefunding", opts["B"]["disqualifiers"][0])
        self.assertEqual(opts["C"]["status"], "unavailable")
        self.assertEqual(opts["A"]["status"], "feasible")
        self.assertIsNone(v["facility"])
        self.assertTrue(action(v, "select_a")["enabled"])
        st = run("fixed_terms", ["select_a", "instruct", "sim_accept", "sim_credit", "close"])
        self.assertEqual(L.view(st)["decision"]["tone"], "closed")

    def test_04_credit_headroom_but_no_cash_blocks_approval(self):
        st = run("no_cash", ["request_advance"])
        v = L.view(st)
        rules = {r["group"] + ":" + r["rule"]: r["ok"] for r in v["facility"]["rules"]}
        self.assertTrue(rules["Authorised to lend:Company limit headroom covers the advance"])
        self.assertFalse(rules["Cash available to pay:Provider funding account has deployable cash for the advance"])
        self.assertEqual(v["decision"]["tone"], "blocked")
        self.assertEqual(v["decision"]["headline"], "Credit headroom available, but no deployable cash to pay")
        self.assertIn("treasury", v["decision"]["next_action"])
        ap = action(v, "approve_reserve")
        self.assertFalse(ap["enabled"])
        self.assertIn("cannot pay", ap["disabled_reason"])
        self.assertEqual(L.state_id(L.apply(st, "approve_reserve")), L.state_id(st))

    def test_05_competing_payouts_cannot_share_capacity(self):
        st = run("competing", ["request_advance"])
        v = L.view(st)
        self.assertFalse(action(v, "approve_reserve")["enabled"])
        self.assertEqual(L.apply(st, "approve_reserve"), st)
        self.assertEqual(v["facility"]["funding_reserved"], "SGD 150,000.00")
        self.assertEqual(v["facility"]["funding_available_cash"], "SGD 100,000.00")
        self.assertIn("another payout", v["decision"]["headline"])
        for s in reach("competing").values():
            d = L._derive(s)
            self.assertEqual(d.res_cash, Decimal("0"))
            self.assertEqual(d.drawn, Decimal("0"))
        # In the reference case the reservation takes the money once; nothing else can take it again.
        r = L.view(run("reference", ["request_advance", "approve_reserve"]))
        self.assertEqual(r["facility"]["funding_available_cash"], "SGD 364,617.50")
        self.assertEqual(r["facility"]["company_available"], "SGD 164,617.50")


class Idempotency(unittest.TestCase):
    def test_06_duplicates_do_not_double_count(self):
        steps = REF_PATH + ["advance_clock", "advance_clock", "repay_partial"]
        st = L.initial_state("reference")
        dup_ids = {"approve_reserve", "draw", "instruct", "sim_accept", "sim_credit", "repay_partial"}
        for a in steps:
            st = L.apply(st, a)
            if a in dup_ids:
                v = L.view(st)
                act = action(v, a)
                self.assertIsNotNone(act, a)
                self.assertFalse(act["enabled"], a)
                self.assertTrue(act["disabled_reason"], a)
                self.assertEqual(act["next"], v["state_id"])
                again = L.apply(st, a)
                self.assertIs(again, st, a)
        d = L._derive(st)
        self.assertEqual(d.counts["reserve"], 1)
        self.assertEqual(d.counts["draw"], 1)
        self.assertEqual(d.counts["instruct"], 1)
        self.assertEqual(d.counts["credit"], 1)
        self.assertEqual(d.counts["repayment"], 1)
        self.assertEqual(d.drawn, Decimal("135382.50"))
        self.assertEqual(d.principal_out, Decimal("35532.50"))
        self.assertEqual(L.apply(st, "no_such_action"), st)

    def test_07_expiry_releases_unused_reservation_never_drawn_principal(self):
        st = run("reference", ["request_advance", "approve_reserve", "advance_clock"])
        self.assertEqual(L.view(st)["facts"]["authorization"]["status"], "reserved")  # Mon 15:00, still before 16:00
        st = L.apply(st, "advance_clock")  # Wed 23:00
        v = L.view(st)
        self.assertEqual(v["facts"]["authorization"]["status"], "released")
        self.assertEqual(v["facility"]["reserved"], "SGD 0.00")
        self.assertEqual(v["facility"]["company_available"], "SGD 300,000.00")
        self.assertEqual(v["facility"]["funding_available_cash"], "SGD 500,000.00")
        self.assertIn("expired unused", v["facts"]["authorization"]["detail"])
        # drawn, never instructed, cutoff passes: principal stays
        st = run("reference", ["request_advance", "approve_reserve", "draw", "advance_clock", "advance_clock"])
        v = L.view(st)
        self.assertEqual(v["facts"]["authorization"]["status"], "consumed")
        self.assertEqual(v["facility"]["principal_outstanding"], "SGD 135,382.50")
        self.assertEqual(v["exposure"]["amount"], "SGD 135,532.50")
        rel = action(v, "release")
        self.assertFalse(rel["enabled"])
        self.assertIn("cannot erase", rel["disabled_reason"])
        self.assertEqual(v["decision"]["tone"], "review")
        self.assertFalse(action(v, "instruct")["enabled"])


class Delivery(unittest.TestCase):
    def test_08_provider_acceptance_is_not_beneficiary_credit(self):
        v = L.view(run("reference", REF_PATH[:5]))
        self.assertEqual(v["facts"]["delivery"]["status"], "accepted")
        self.assertIn("not credit", v["facts"]["delivery"]["label"])
        self.assertEqual(v["decision"]["tone"], "unknown")
        self.assertFalse(action(v, "close")["enabled"])
        self.assertTrue(any("not beneficiary credit" in w for w in v["warnings"]))
        self.assertNotIn("CRD-HP-01", [e["id"] for e in v["evidence"]])

    def test_09_supplier_credited_importer_unpaid_is_visible(self):
        v = L.view(run("reference", WED))
        self.assertEqual(v["clock"]["sgt"], "Wed 18 Nov 2026, 23:00 SGT")
        dec = v["decision"]
        self.assertEqual(dec["tone"], "delivered_exposure")
        self.assertEqual(dec["headline"], "Supplier credited; importer repayment outstanding")
        self.assertIn("SGD 135,532.50", dec["binding_constraint"])
        self.assertIn("Northwind", dec["owner"])
        self.assertIn("Collect and match", dec["next_action"])
        self.assertEqual(v["facts"]["delivery"]["status"], "credited")
        self.assertEqual(v["facts"]["repayment"]["status"], "outstanding")
        self.assertEqual(v["exposure"]["amount"], "SGD 135,532.50")
        self.assertTrue(any("not been evidenced as settled" in w for w in v["warnings"]))

    def test_13_returned_payout_no_duplicate_no_auto_close(self):
        st = run("failed_payout", REF_PATH[:5] + ["sim_return"])
        v = L.view(st)
        self.assertEqual(v["decision"]["tone"], "failed")
        self.assertEqual(v["facts"]["delivery"]["status"], "returned")
        self.assertIn("RET-HP-01", v["facts"]["delivery"]["last_evidenced"])
        self.assertIn("Provider payments operations", v["decision"]["owner"])
        self.assertIn("nothing is resent automatically", v["decision"]["next_action"])
        ins = action(v, "instruct")
        self.assertFalse(ins["enabled"])
        self.assertIn("No second payment", ins["disabled_reason"])
        self.assertIs(L.apply(st, "instruct"), st)
        self.assertFalse(action(v, "close")["enabled"])
        self.assertEqual(v["exposure"]["principal"], "SGD 135,382.50")
        for s in reach("failed_payout").values():
            d = L._derive(s)
            self.assertLessEqual(d.counts.get("instruct", 0), 1)
            self.assertIsNone(d.closed)


class Repayment(unittest.TestCase):
    def test_11_customer_receipt_alone_does_not_settle(self):
        v = L.view(run("reference", THU))
        self.assertEqual([r["id"] for r in v["facts"]["repayment"]["customer_receipts"]], ["RCV-NW-01"])
        self.assertEqual(v["facts"]["repayment"]["principal_outstanding"], "SGD 135,382.50")
        self.assertEqual(v["facts"]["repayment"]["fees_outstanding"], "SGD 150.00")
        self.assertEqual(v["facts"]["repayment"]["matched"], [])
        self.assertFalse(action(v, "close")["enabled"])
        self.assertTrue(any("not a repayment" in w for w in v["warnings"]))

    def test_12_partial_then_final_and_unmatched_blocks_close(self):
        v = L.view(run("reference", THU + ["repay_partial"]))
        rp = v["facts"]["repayment"]
        self.assertEqual(rp["fees_outstanding"], "SGD 0.00")
        self.assertEqual(rp["principal_outstanding"], "SGD 35,532.50")
        self.assertEqual(rp["matched"][0]["fees"], "SGD 150.00")
        self.assertEqual(rp["matched"][0]["principal"], "SGD 99,850.00")
        self.assertEqual(rp["status"], "partially_repaid")
        self.assertIn("fees first", rp["allocation_rule"])
        v = L.view(run("reference", THU + ["repay_partial", "repay_remaining"]))
        self.assertEqual(v["facts"]["repayment"]["status"], "repaid")
        self.assertTrue(action(v, "close")["enabled"])
        # wrong currency
        st = run("reference", THU + ["sim_wrong_currency", "repay_remaining"])
        v = L.view(st)
        self.assertEqual(v["facts"]["repayment"]["principal_outstanding"], "SGD 0.00")
        un = v["facts"]["repayment"]["unmatched"]
        self.assertEqual(un[0]["amount"], "USD 1,000.00")
        self.assertIn("Wrong currency", un[0]["reason"])
        self.assertFalse(action(v, "close")["enabled"])
        self.assertIs(L.apply(st, "close"), st)
        self.assertEqual(v["decision"]["tone"], "review")
        st = L.apply(st, "return_unmatched")
        self.assertTrue(action(L.view(st), "close")["enabled"])
        # excess
        v = L.view(run("reference", THU + ["repay_full_receipt"]))
        self.assertEqual(v["facts"]["repayment"]["unmatched"][0]["amount"], "SGD 4,467.50")
        self.assertEqual(v["facts"]["repayment"]["principal_outstanding"], "SGD 0.00")
        self.assertFalse(action(v, "close")["enabled"])

    def test_conflicting_evidence_goes_to_review(self):
        st = run("reference", THU + ["repay_remaining", "sim_conflict"])
        v = L.view(st)
        self.assertEqual(v["decision"]["tone"], "review")
        self.assertFalse(action(v, "close")["enabled"])
        st = run("reference", THU + ["repay_remaining", "sim_conflict", "resolve_conflict", "close"])
        self.assertEqual(L.view(st)["decision"]["tone"], "closed")


class Paths(unittest.TestCase):
    def test_14_every_route_infeasible(self):
        v = L.view(L.initial_state("all_infeasible"))
        self.assertTrue(all(o["status"] in ("infeasible", "unavailable") for o in v["options"]))
        self.assertEqual(v["decision"]["tone"], "blocked")
        self.assertIn("No feasible option", v["decision"]["headline"])
        self.assertIn("no costs are compared", v["options_note"])
        self.assertEqual([a["id"] for a in v["actions"] if a["enabled"]], ["advance_clock"])

    def test_15_reset_and_replay_are_reproducible(self):
        path = THU + ["repay_partial", "repay_remaining", "close"]
        a, b = run("reference", path), run("reference", path)
        self.assertEqual(L.state_id(a), L.state_id(b))
        self.assertEqual(L.view(a), L.view(b))
        self.assertEqual(L.state_id(L.initial_state("reference")), L.state_id(L.initial_state("reference")))
        self.assertEqual(set(L.reachable("reference")), set(reach("reference")))

    def test_decline_path(self):
        st = run("reference", ["request_advance", "decline"])
        v = L.view(st)
        self.assertEqual(v["decision"]["tone"], "declined")
        self.assertEqual(v["facility"]["reserved"], "SGD 0.00")
        self.assertTrue(action(v, "select_a")["enabled"])
        self.assertIsNone(action(v, "approve_reserve"))
        st = run("reference", ["request_advance", "approve_reserve", "release"])
        v = L.view(st)
        self.assertEqual(v["facts"]["authorization"]["status"], "released")
        self.assertEqual(v["facility"]["funding_available_cash"], "SGD 500,000.00")

    def test_invariants_hold_on_every_reachable_state(self):
        for cid in L.CASE_ORDER:
            states = reach(cid)
            self.assertLessEqual(len(states), 400)
            for sid, st in states.items():
                v = L.view(st)
                bad = [i for i in v["invariants"] if not i["ok"]]
                self.assertEqual(bad, [], (cid, sid))
                text = dump(v)
                self.assertNotIn("saving", text.lower())
                self.assertIn("Simulated", text)
                self.assertNotIn("+08:00", text)
                for a in v["actions"]:
                    if a["enabled"]:
                        self.assertIn(a["next"], states)
                    else:
                        self.assertTrue(a["disabled_reason"])

    def test_no_float_and_currency_separation(self):
        with self.assertRaises(ValueError):
            L.Money("SGD", Decimal("1")) + L.Money("USD", Decimal("1"))
        with self.assertRaises(TypeError):
            L.Money("SGD", 1.5)
        with open(L.__file__, encoding="utf8") as fh:
            src = fh.read()
        self.assertNotIn("float(", src)

        def walk(x):
            if isinstance(x, float):
                raise AssertionError("float in view")
            if isinstance(x, dict):
                for y in x.values():
                    walk(y)
            if isinstance(x, list):
                for y in x:
                    walk(y)
        walk(L.view(run("reference", THU)))


if __name__ == "__main__":
    unittest.main()
