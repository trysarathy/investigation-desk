"""Adversarial challenger tests for the provider funding lifecycle engine (synthetic fixtures; no funds move).

Two kinds of test live here:
  * ``Defect*`` classes: regression tests for real defects found by the challenger. They are written to FAIL
    against the engine as found, and to pass once the defect is fixed.
  * ``Resisted*`` classes: attacks that the engine correctly resisted. They pass now and guard the behaviour.

The independent invariants below are written from LIFECYCLE_CONTRACT.md / docs/MONEY_AND_STATE_MODEL.md and read
only the view JSON (display strings), never engine internals or check_invariants().

Variant fixtures are built in memory from copies of fixtures/lifecycle/*.json and registered under unique ids
(``chl_*``) via L.register_case; they are removed again after each test. The original fixtures are never touched.

Run from funding-replay/:  python3 -m unittest discover -s tests
"""

import copy
import json
import os
import random
import re
import sys
import unittest
from datetime import datetime
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from engine import lifecycle as L  # noqa: E402

MINUS = "−"
COST = Decimal("135382.50")
FEE = Decimal("150.00")
ALL_ACTION_IDS = ("request_advance", "approve_reserve", "request_evidence", "sim_fresh_balance", "decline", "release",
                  "select_a", "draw", "instruct", "sim_accept", "sim_credit", "sim_return", "sim_conflict",
                  "resolve_conflict", "sim_receipt", "sim_pay_partial", "sim_pay_balance", "sim_pay_usd",
                  "match_repayment", "return_unmatched", "close", "advance_clock", "no_such_action", "")
ONCE_EVENTS = ("request", "reserve", "draw", "instruct", "accept", "credit", "return", "close", "receipt",
               "decline", "release", "expire", "select_a")
C_PATH = ["request_advance", "approve_reserve", "draw", "instruct", "sim_accept", "sim_credit"]
THU = C_PATH + ["advance_clock", "advance_clock", "sim_receipt"]
PAY_ALL = ["sim_pay_partial", "match_repayment", "sim_pay_balance", "match_repayment"]

_REACH = {}


def reach(case):
    if case not in _REACH:
        _REACH[case] = L.reachable(case)
    return _REACH[case]


# ---------------------------------------------------------------------------------------------- helpers
def money(text):
    cur, rest = text.split(" ", 1)
    neg = rest.startswith(MINUS) or rest.startswith("-")
    val = Decimal(rest.lstrip(MINUS + "-").replace(",", ""))
    return cur, (-val if neg else val)


def sgd(text):
    cur, val = money(text)
    if cur != "SGD":
        raise AssertionError("expected SGD, got %r" % text)
    return val


def when(text):
    return datetime.strptime(text.replace(" SGT", ""), "%a %d %b %Y, %H:%M")


def run(case, actions):
    st = L.initial_state(case)
    for a in actions:
        nxt = L.apply(st, a)
        if L.state_id(nxt) == L.state_id(st):
            raise AssertionError("action %s was a no-op: %s" % (
                a, [(x["id"], x["enabled"], x["disabled_reason"]) for x in L.available_actions(st)]))
        st = nxt
    return st


def action(v, aid):
    for a in v["actions"]:
        if a["id"] == aid:
            return a
    return None


def raw_fixture(case):
    with open(os.path.join(L.FIXTURES_DIR, case + ".json"), encoding="utf8") as fh:
        return json.load(fh)


class Variant:
    """Register an in-memory copy of a fixture under a unique id; always unregister."""

    def __init__(self, base, new_id, mutate):
        self.raw = raw_fixture(base)
        self.raw["id"] = new_id
        mutate(self.raw)
        self.id = new_id

    def __enter__(self):
        L.register_case(self.raw)
        return self.id

    def __exit__(self, *exc):
        L.CASES.pop(self.id, None)
        return False


def evidence_by_id(raw, eid):
    for e in raw["evidence"]:
        if e["id"] == eid:
            return e
    raise KeyError(eid)


def make_stale(raw):
    """Newest importer balance 30 h old at the Friday 15:00 start (and no Monday statement)."""
    b = evidence_by_id(raw, "BAL-NW-01")
    b["effective_at"], b["known_at"] = "2026-11-12T09:00:00+08:00", "2026-11-12T09:10:00+08:00"
    raw["evidence"] = [e for e in raw["evidence"] if e["id"] != "BAL-NW-03"]


def cash_support(amount, currency="SGD", effective="2026-11-16T12:00:00+08:00", known="2026-11-12T12:00:00+08:00"):
    return {"id": "SUP-CS-01", "kind": "cash_support",
            "fact": "Bank letter: overdraft of %s %s available to Northwind (fictional)." % (currency, amount),
            "effective_at": effective, "known_at": known, "status": "documented",
            "source": "synthetic: bank letter (fictional)", "amount": {"amount": amount, "currency": currency}}


def contract_problems(st):
    """Independent contract checks on one state's view. Returns a list of problem strings (empty = ok)."""
    p = []
    v = L.view(st)
    sid = v["state_id"]
    clock = when(v["clock"]["sgt"])
    vis_ids = {e["id"] for e in v["evidence"]}
    for e in v["evidence"]:
        if when(e["known_sgt"]) > clock:
            p.append("evidence %s known after clock" % e["id"])
    for t in v["timeline"]:
        if when(t["known_sgt"]) > clock:
            p.append("timeline entry known after clock")
    for o in v["options"]:
        for eid in o["evidence"]:
            if eid not in vis_ids:
                p.append("option %s cites %s which is not visible" % (o["key"], eid))
    f, facts = v["facility"], v["facts"]
    rp, auth, dl = facts["repayment"], facts["authorization"]["status"], facts["delivery"]["status"]
    drawn = facts["cash"]["status"] == "drawn"
    if f:
        lim, av, res, po = (sgd(f[k]) for k in ("company_limit", "company_available", "reserved", "principal_outstanding"))
        if lim != av + res + po or av < 0:
            p.append("company_limit identity broken")
        if sgd(f["funding_start"]) != sgd(f["funding_available_cash"]) + sgd(f["funding_reserved"]) + po:
            p.append("funding identity broken")
        if sgd(f["funding_reserved"]) != sgd(f["funding_reserved_this_payout"]) + sgd(f["funding_reserved_other_payouts"]):
            p.append("funding reserved split broken")
        if res != sgd(f["funding_reserved_this_payout"]) or res != sgd(f["committed_capacity"]):
            p.append("limit reserved != cash reserved")
        if (res > 0) != (auth == "reserved"):
            p.append("reserved amount vs authorisation status %s" % auth)
        if po != sgd(rp["principal_outstanding"]) or sgd(f["fees_outstanding"]) != sgd(rp["fees_outstanding"]):
            p.append("facility and repayment fact disagree")
    if drawn != (v["exposure"] is not None):
        p.append("exposure present iff drawn")
    if drawn:
        if auth != "consumed":
            p.append("drawn but reservation not consumed")
        mf = sum((sgd(m["fees"]) for m in rp["matched"]), Decimal(0))
        mp = sum((sgd(m["principal"]) for m in rp["matched"]), Decimal(0))
        if mp + sgd(rp["principal_outstanding"]) != COST:
            p.append("principal not conserved")
        if mf + sgd(rp["fees_outstanding"]) != FEE:
            p.append("fees not conserved")
        for m in rp["matched"]:
            cur, amt = money(m["amount"])
            _, unm = money(m["unmatched"])
            if cur != "SGD" or sgd(m["fees"]) + sgd(m["principal"]) + unm != amt:
                p.append("matched repayment does not add up (netting?)")
        ex = v["exposure"]
        if sgd(ex["amount"]) != sgd(ex["principal"]) + sgd(ex["fees"]):
            p.append("exposure amount != principal + fees")
        if (ex["status"] == "ended") != (sgd(ex["amount"]) == 0):
            p.append("exposure status inconsistent")
    if rp["status"] == "repaid" and (sgd(rp["principal_outstanding"]) or sgd(rp["fees_outstanding"])):
        p.append("repaid while owed")
    credit_recs = [e for e in v["evidence"] if e["kind"] == "beneficiary_credit"]
    if (dl == "credited") != bool(credit_recs):
        p.append("credited status without a delivery record, or record without status")
    if dl in ("accepted", "instructed", "returned", "none") and re.search(r"(?<!not )(?<!not yet )\bcredited\b",
                                                                        v["decision"]["headline"]):
        p.append("headline claims credit while delivery is %s" % dl)
    close = action(v, "close")
    for tag, flag in (("closed", v["decision"]["tone"] == "closed"), ("closable", bool(close and close["enabled"]))):
        if not flag:
            continue
        if dl != "credited":
            p.append("%s without credit" % tag)
        if drawn and (sgd(rp["principal_outstanding"]) or sgd(rp["fees_outstanding"])):
            p.append("%s while owed" % tag)
        if rp["unallocated"]:
            p.append("%s with unallocated payment" % tag)
        if any(u["status"] == "open" for u in rp["unmatched"]):
            p.append("%s with open unmatched item" % tag)
        if any(e["kind"] == "supplier_message" for e in v["evidence"]) and \
                not any(e["kind"] == "trace" for e in v["evidence"]):
            p.append("%s with unresolved conflict" % tag)
    counts = {}
    for e in st["events"]:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    for k in ONCE_EVENTS:
        if counts.get(k, 0) > 1:
            p.append("event %s recorded %d times" % (k, counts[k]))
    if counts.get("draw") and not counts.get("reserve"):
        p.append("draw without reservation")
    if counts.get("instruct") and not (counts.get("draw") or counts.get("select_a")):
        p.append("unfunded instruction")
    if counts.get("draw") and counts.get("select_a"):
        p.append("both Option A and an advance fund the payout")
    ids = [a["id"] for a in v["actions"]]
    if len(ids) != len(set(ids)):
        p.append("duplicate action ids")
    for a in v["actions"]:
        if not a["enabled"] and a["next"] != sid:
            p.append("disabled action %s has next != this state" % a["id"])
    if v["options"][1]["status"] == "feasible":
        p.append("Option B feasible in a shipped case (no fixture documents cash support)")
    return p


# =============================================================================================== DEFECTS
class DefectFalseSafeToWait(unittest.TestCase):
    """Option B ('importer funds Monday, no advance') is feasible on ANY documented cash_support record."""

    def _option_b(self, mutate, vid):
        with Variant("reference", vid, mutate) as cid:
            return L.view(L.initial_state(cid))

    def test_D1a_option_b_not_feasible_on_cash_support_far_below_need(self):
        # reference + one documented cash_support of SGD 1,000.00 (need SGD 135,382.50), Friday 15:00 start view.
        v = self._option_b(lambda r: r["evidence"].append(cash_support("1000.00")), "chl_b_small")
        b = v["options"][1]
        self.assertNotEqual(b["status"], "feasible",
                            "SGD 1,000.00 of cash support cannot fund SGD 135,382.50 on Monday: %s" % v["decision"]["binding_constraint"])

    def test_D1b_option_b_not_feasible_on_cash_support_effective_after_monday_window(self):
        # Support only effective Tue 17 Nov 12:00, after the Mon 16 Nov 16:00 cutoff.
        v = self._option_b(lambda r: r["evidence"].append(cash_support("200000.00", effective="2026-11-17T12:00:00+08:00")),
                           "chl_b_late")
        self.assertNotEqual(v["options"][1]["status"], "feasible")

    def test_D1c_option_b_not_feasible_on_usd_cash_support(self):
        # USD 100,000.00 support against an SGD need: never compare/add currencies.
        v = self._option_b(lambda r: r["evidence"].append(cash_support("100000.00", currency="USD")), "chl_b_usd")
        self.assertNotEqual(v["options"][1]["status"], "feasible")


class DefectImpossibleAdvanceAdvice(unittest.TestCase):
    """With a stale balance the decision says 'Request the advance; the reviewer will ask the importer for a newer
    bank balance' even when no advance can be requested, or when requesting it leads to no evidence request."""

    def _assert_advice_is_actionable(self, cid):
        v = L.view(L.initial_state(cid))
        nxt = v["decision"]["next_action"]
        if "Request the advance" in nxt:
            ra = action(v, "request_advance")
            self.assertTrue(ra and ra["enabled"], "decision says %r but request_advance is not available (%s)" % (
                nxt, [a["id"] for a in v["actions"]]))
            v2 = L.view(L.apply(L.initial_state(cid), "request_advance"))
            re_ = action(v2, "request_evidence")
            self.assertTrue(re_ and re_["enabled"], "after requesting, the reviewer cannot ask for a newer balance: %s"
                            % v2["decision"]["headline"])
        return v

    def test_D2a_fixed_terms_no_facility_stale_balance_reads_later_funding_unavailable(self):
        with Variant("fixed_terms", "chl_ft_stale", make_stale) as cid:
            v = L.view(L.initial_state(cid))
            self.assertIsNone(v["facility"])
            # Contract: fixed terms with no credit -> "Later funding unavailable"; never advice about an advance.
            self.assertNotIn("advance", v["decision"]["headline"].lower(), v["decision"])
            self.assertNotIn("Request the advance", v["decision"]["next_action"])

    def test_D2b_suspended_facility_stale_balance_does_not_advise_requesting_an_advance(self):
        def m(r):
            make_stale(r)
            r["facility"]["status"] = "suspended"
        with Variant("reference", "chl_susp_stale", m) as cid:
            self._assert_advice_is_actionable(cid)

    def test_D2c_no_cash_stale_balance_advice_leads_to_an_evidence_request(self):
        with Variant("no_cash", "chl_nc_stale", make_stale) as cid:
            self._assert_advice_is_actionable(cid)


class DefectFutureKnowledgeLeak(unittest.TestCase):
    """Facility/funding facts are read from the fixture regardless of the evidence record's known_at."""

    def test_D3a_other_payout_reservation_not_used_before_it_is_known(self):
        def m(r):
            e = evidence_by_id(r, "RES-OTH-77")
            e["effective_at"] = e["known_at"] = "2026-11-16T09:00:00+08:00"   # first known Monday
        with Variant("competing", "chl_comp_future", m) as cid:
            v = L.view(L.initial_state(cid))                                   # Friday 15:00
            self.assertNotIn("RES-OTH-77", {e["id"] for e in v["evidence"]})
            text = json.dumps({k: v[k] for k in ("decision", "options", "facility")}, ensure_ascii=False)
            self.assertNotIn("RES-OTH-77", text, "Friday view relies on a reservation first known Monday")

    def test_D3b_facility_suspension_not_applied_before_it_is_known(self):
        def m(r):
            r["start_clock"] = "2026-11-13T15:00:00+08:00"
            b = [e for e in r["evidence"] if e["kind"] == "importer_balance"][0]
            b["effective_at"], b["known_at"] = "2026-11-13T09:00:00+08:00", "2026-11-13T09:10:00+08:00"
        with Variant("all_infeasible", "chl_susp_future", m) as cid:
            v = L.view(L.initial_state(cid))
            # the suspension record (FAC-NW-01, status suspended) is first known Mon 16 Nov 09:00
            self.assertNotIn("FAC-NW-01", {e["id"] for e in v["evidence"]})
            self.assertNotIn("suspended", json.dumps(v["options"][2]).lower(),
                             "Friday view already shows a suspension first known Monday")


class DefectCreditEvidence(unittest.TestCase):
    def test_D4_credit_dated_before_the_instruction_is_not_accepted_as_credit(self):
        def m(r):
            r["simulated_events"]["credit"]["effective_at"] = "2026-11-13T14:00:00+08:00"
            r["simulated_events"]["credit"]["known_at"] = "2026-11-13T14:00:00+08:00"
        with Variant("reference", "chl_credit_early", m) as cid:
            st = run(cid, ["select_a", "instruct", "sim_accept"])
            st = L.apply(st, "sim_credit")
            v = L.view(st)
            # A delivery record effective 14:00 cannot evidence an instruction sent at 15:00.
            self.assertNotEqual(v["facts"]["delivery"]["status"], "credited", v["facts"]["delivery"]["last_evidenced"])


class DefectFixtureMoneyValidation(unittest.TestCase):
    def test_D5_float_amounts_in_a_fixture_are_rejected(self):
        raw = raw_fixture("reference")
        raw["id"] = "chl_float"
        raw["facility"]["fee"] = {"amount": 150.1, "currency": "SGD"}   # JSON number, i.e. float
        try:
            with self.assertRaises((TypeError, ValueError), msg="docs: 'Floats are rejected'"):
                L.register_case(raw)
        finally:
            L.CASES.pop("chl_float", None)

    def test_D5b_float_fee_does_not_leave_phantom_zero_balances(self):
        raw = raw_fixture("reference")
        raw["id"] = "chl_float2"
        raw["facility"]["fee"] = {"amount": 150.1, "currency": "SGD"}
        raw["importer_repayments"]["balance"] = {"amount": "35532.60", "currency": "SGD"}
        try:
            try:
                L.register_case(raw)
            except (TypeError, ValueError):
                return  # rejected: fine
            v = L.view(run("chl_float2", THU + PAY_ALL))
            shown = [u for u in v["facts"]["repayment"]["unmatched"] if sgd(u["amount"]) == 0]
            self.assertEqual(shown, [], "phantom SGD 0.00 excess held for review")
            self.assertNotEqual(v["exposure"]["status"], "outstanding", "exposure outstanding with SGD 0.00 owed")
        finally:
            L.CASES.pop("chl_float2", None)


class DefectWording(unittest.TestCase):
    """Minor: text that contradicts the structured facts."""

    def test_M1_returned_payout_after_full_repayment_does_not_say_advance_outstanding(self):
        st = run("failed_payout", ["request_advance", "approve_reserve", "draw", "instruct", "sim_accept", "sim_return",
                                   "advance_clock", "advance_clock", "sim_receipt"] + PAY_ALL)
        v = L.view(st)
        self.assertEqual(v["exposure"]["status"], "ended")
        self.assertNotIn("stays outstanding", v["decision"]["binding_constraint"])

    def test_M2_release_reason_after_full_repayment_does_not_say_principal_outstanding(self):
        v = L.view(run("reference", THU + PAY_ALL))
        self.assertNotIn("SGD 0.00 stays outstanding", action(v, "release")["disabled_reason"])

    def test_M3_option_a_return_does_not_mention_an_advance(self):
        v = L.view(run("failed_payout", ["select_a", "instruct", "sim_accept", "sim_return"]))
        self.assertIsNone(v["exposure"])
        self.assertNotIn("advance", v["decision"]["next_action"])

    def test_M4_usd_balance_not_compared_numerically_with_sgd_need(self):
        def m(r):
            evidence_by_id(r, "BAL-NW-01")["amount"] = {"amount": "136000.00", "currency": "USD"}
        with Variant("reference", "chl_bal_usd", m) as cid:
            a = L.view(L.initial_state(cid))["options"][0]
            self.assertNotEqual(a["status"], "feasible", "USD 136,000.00 compared with SGD 135,382.50 as numbers")

    def test_M5_stale_age_display_does_not_round_to_the_limit(self):
        def m(r):
            b = evidence_by_id(r, "BAL-NW-01")
            b["effective_at"], b["known_at"] = "2026-11-12T14:59:00+08:00", "2026-11-12T15:10:00+08:00"
        with Variant("reference", "chl_24h1", m) as cid:
            v = L.view(L.initial_state(cid))
            self.assertEqual(v["options"][0]["status"], "unknown")
            self.assertNotIn("24 h old (limit 24 h)", v["decision"]["binding_constraint"],
                             "stale but displayed as exactly at the limit")


# =============================================================================================== RESISTED
class ResistedBruteForce(unittest.TestCase):
    def test_R1_independent_contract_invariants_on_every_reachable_state(self):
        bad = {}
        for case in L.CASE_ORDER:
            for sid, st in reach(case).items():
                for prob in contract_problems(st):
                    bad.setdefault(prob, []).append((case, sid))
        self.assertEqual({k: v[:3] for k, v in bad.items()}, {})

    def test_R2_disabled_unlisted_and_unknown_actions_are_no_ops(self):
        for case in L.CASE_ORDER:
            for sid, st in reach(case).items():
                listed = {a["id"]: a for a in L.available_actions(st)}
                for aid in ALL_ACTION_IDS:
                    a = listed.get(aid)
                    if a is None or not a["enabled"]:
                        self.assertEqual(L.state_id(L.apply(st, aid)), sid, (case, sid, aid))

    def test_R3_duplicate_clicks_are_harmless(self):
        for case in L.CASE_ORDER:
            for sid, st in reach(case).items():
                for a in L.available_actions(st):
                    if not a["enabled"] or a["id"] == "advance_clock":
                        continue
                    once = L.apply(st, a["id"])
                    self.assertEqual(L.state_id(L.apply(once, a["id"])), L.state_id(once), (case, a["id"]))

    def test_R4_clock_advance_never_changes_money(self):
        for case in L.CASE_ORDER:
            for sid, st in reach(case).items():
                if not (action(L.view(st), "advance_clock") or {}).get("enabled"):
                    continue
                a, b = L.view(st), L.view(L.apply(st, "advance_clock"))
                ra, rb = a["facts"]["repayment"], b["facts"]["repayment"]
                for k in ("principal_outstanding", "fees_outstanding", "unallocated", "matched", "unmatched",
                          "customer_receipts"):
                    self.assertEqual(ra[k], rb[k], (case, k))
                if a["facility"]:
                    self.assertEqual(a["facility"]["fees_collected"], b["facility"]["fees_collected"])
                    # only an expiry may release reserved capacity; it never touches principal
                    if a["facility"]["reserved"] != b["facility"]["reserved"]:
                        self.assertEqual(b["facts"]["authorization"]["status"], "released")
                        self.assertEqual(b["facility"]["reserved"], "SGD 0.00")

    def test_R5_random_fuzz_including_disabled_actions_stays_in_reachable_set(self):
        rng = random.Random(20261105)
        for case in L.CASE_ORDER:
            states = reach(case)
            for _ in range(150):
                st = L.initial_state(case)
                for _ in range(40):
                    st = L.apply(st, rng.choice(ALL_ACTION_IDS))
                    self.assertIn(L.state_id(st), states, case)
                self.assertTrue(all(i["ok"] for i in L.check_invariants(st)))

    def test_R6_apply_is_pure_and_view_is_deterministic(self):
        for case in L.CASE_ORDER:
            for sid, st in list(reach(case).items())[:60]:
                before = copy.deepcopy(st)
                v1 = json.dumps(L.view(st), sort_keys=True)
                for a in L.available_actions(st):
                    L.apply(st, a["id"])
                self.assertEqual(st, before)
                self.assertEqual(json.dumps(L.view(st), sort_keys=True), v1)

    def test_R7_replayed_duplicate_events_are_flagged_or_change_nothing(self):
        st = run("reference", THU + ["sim_pay_usd", "match_repayment"] + PAY_ALL + ["return_unmatched", "close"])
        base = L.view(st)
        for i, ev in enumerate(st["events"]):
            forged = {"case": st["case"], "events": st["events"][:i + 1] + [copy.deepcopy(ev)] + st["events"][i + 1:]}
            inv_ok = all(x["ok"] for x in L.check_invariants(forged))
            fv = L.view(forged)
            same_money = fv["facts"]["repayment"] == base["facts"]["repayment"] and fv["facility"] == base["facility"]
            self.assertTrue((not inv_ok) or same_money, "duplicate %s silently changed money" % ev["type"])


class ResistedSafeToWait(unittest.TestCase):
    def test_R8_friday_views_never_count_forecast_or_future_receipt(self):
        thu = datetime(2026, 11, 19, 10, 0)
        for case in L.CASE_ORDER:
            for st in reach(case).values():
                v = L.view(st)
                if when(v["clock"]["sgt"]) < thu:
                    t = json.dumps(v, ensure_ascii=False)
                    self.assertNotIn("RCV-NW-01", t)
                    self.assertEqual(v["facts"]["repayment"]["customer_receipts"], [])
                    self.assertIsNone(action(v, "sim_receipt"))
                    self.assertNotEqual(v["options"][1]["status"], "feasible")

    def test_R9_cash_support_known_only_on_monday_does_not_make_friday_b_feasible(self):
        def m(r):
            r["evidence"].append(cash_support("200000.00", known="2026-11-16T09:00:00+08:00"))
        with Variant("reference", "chl_b_future", m) as cid:
            v = L.view(L.initial_state(cid))
            self.assertEqual(v["options"][1]["status"], "infeasible")
            self.assertNotIn("SUP-CS-01", json.dumps(v))

    def test_R10_stale_balance_is_unknown_and_exact_24h_is_fresh(self):
        v = L.view(L.initial_state("stale_balance"))
        self.assertEqual([o["status"] for o in v["options"]], ["unknown", "infeasible", "unknown"])
        self.assertFalse(action(v, "select_a")["enabled"])

        def m(r):
            b = evidence_by_id(r, "BAL-NW-01")
            b["effective_at"], b["known_at"] = "2026-11-12T15:00:00+08:00", "2026-11-12T15:10:00+08:00"
        with Variant("reference", "chl_24h", m) as cid:
            self.assertEqual(L.view(L.initial_state(cid))["options"][0]["status"], "feasible")

    def test_R11_fixed_terms_reads_later_funding_unavailable(self):
        v = L.view(L.initial_state("fixed_terms"))
        self.assertEqual(v["decision"]["headline"], "Later funding unavailable")
        self.assertEqual([o["status"] for o in v["options"]], ["feasible", "infeasible", "unavailable"])
        for st in reach("fixed_terms").values():
            self.assertIsNone(action(L.view(st), "request_advance"))


class ResistedDeliveryAndRepayment(unittest.TestCase):
    def test_R12_acceptance_is_never_credit_and_returned_never_closes_or_resends(self):
        for case in L.CASE_ORDER:
            for st in reach(case).values():
                v = L.view(st)
                dl = v["facts"]["delivery"]["status"]
                if dl == "accepted":
                    self.assertNotIn("beneficiary_credit", {e["kind"] for e in v["evidence"]})
                if dl == "returned":
                    self.assertFalse(action(v, "instruct")["enabled"])
                    self.assertFalse(action(v, "close")["enabled"])
                    self.assertEqual(v["decision"]["tone"], "failed")
                self.assertLessEqual(sum(1 for e in st["events"] if e["type"] == "instruct"), 1)

    def test_R13_customer_receipt_and_unmatched_payment_do_not_reduce_owed(self):
        before = L.view(run("reference", THU[:-1]))
        after_receipt = L.view(run("reference", THU))
        after_incoming = L.view(run("reference", THU + ["sim_pay_partial"]))
        for v in (after_receipt, after_incoming):
            self.assertEqual(v["facts"]["repayment"]["principal_outstanding"],
                             before["facts"]["repayment"]["principal_outstanding"])
            self.assertEqual(v["facility"]["company_available"], before["facility"]["company_available"])
            self.assertEqual(v["exposure"]["status"], "outstanding")
            self.assertFalse(action(v, "close")["enabled"])

    def test_R14_usd_and_overpayment_are_held_not_netted(self):
        v = L.view(run("reference", THU + ["sim_pay_usd", "match_repayment"]))
        self.assertEqual(v["facts"]["repayment"]["principal_outstanding"], "SGD 135,382.50")
        self.assertEqual(v["facts"]["repayment"]["fees_outstanding"], "SGD 150.00")

        def m(r):
            r["importer_repayments"]["partial"] = {"amount": "200000.00", "currency": "SGD"}
        with Variant("reference", "chl_over", m) as cid:
            v = L.view(run(cid, THU + ["sim_pay_partial", "match_repayment"]))
            rp = v["facts"]["repayment"]
            self.assertEqual((rp["matched"][0]["fees"], rp["matched"][0]["principal"], rp["matched"][0]["unmatched"]),
                             ("SGD 150.00", "SGD 135,382.50", "SGD 64,467.50"))
            self.assertFalse(action(v, "close")["enabled"])
            self.assertEqual(v["decision"]["tone"], "review")

    def test_R15_contention_cannot_reserve_and_currency_mixing_is_refused(self):
        for case in ("competing", "no_cash"):
            for st in reach(case).values():
                self.assertNotIn("reserve", [e["type"] for e in st["events"]])
        raw = raw_fixture("competing")
        raw["id"] = "chl_usd_res"
        raw["funding_account"]["other_reservations"][0]["amount"]["currency"] = "USD"
        try:
            with self.assertRaises(ValueError):
                L.register_case(raw)
        finally:
            L.CASES.pop("chl_usd_res", None)
        with self.assertRaises(ValueError):
            L.Money("SGD", Decimal("1")) + L.Money("USD", Decimal("1"))

    def test_R16_expiry_and_release_never_touch_drawn_principal(self):
        exp = L.view(run("reference", ["request_advance", "approve_reserve", "advance_clock", "advance_clock"]))
        self.assertEqual(exp["facts"]["authorization"]["status"], "released")
        self.assertEqual(exp["facility"]["company_available"], "SGD 300,000.00")
        drawn = run("reference", ["request_advance", "approve_reserve", "draw", "advance_clock", "advance_clock"])
        v = L.view(drawn)
        self.assertEqual(v["facts"]["authorization"]["status"], "consumed")
        self.assertEqual(v["facility"]["principal_outstanding"], "SGD 135,382.50")
        self.assertFalse(action(v, "release")["enabled"])


# =============================================================================================== ROUND 2 (integrated 001e29b)
def _fund_known_monday(r):
    e = evidence_by_id(r, "FUND-SG-01")
    e["effective_at"] = e["known_at"] = "2026-11-16T09:00:00+08:00"


def _fac_terms_known_monday(r):
    e = evidence_by_id(r, "FAC-NW-01")
    e["effective_at"] = e["known_at"] = "2026-11-16T09:00:00+08:00"


def _b_only(r):
    """No facility; valid SGD 200,000 cash support for the Monday window, known Thu 12 Nov."""
    r["evidence"].append(cash_support("200000.00"))
    r["facility"] = None
    r["funding_account"] = None
    r["evidence"] = [e for e in r["evidence"] if e["id"] not in ("FAC-NW-01", "POL-ADV-01", "FUND-SG-01")]


def _suspension_record_monday(r):
    """Facility terms known since 2 Nov; a separate suspension record first known Mon 16 Nov 09:00."""
    r["facility"]["status"] = "suspended"
    r["evidence"].append({"id": "FAC-NW-01-S", "kind": "facility", "status": "suspended",
                          "fact": "FAC-NW-01 suspended for new advances from Mon 16 Nov 09:00 SGT (Simulated).",
                          "effective_at": "2026-11-16T09:00:00+08:00", "known_at": "2026-11-16T09:00:00+08:00",
                          "source": "synthetic: facility notice (Simulated)"})


class Defect2FalseWait(unittest.TestCase):
    """NEW in 001e29b: when Option C is 'unknown' for a reason other than a stale balance (facility terms or
    funding balance not yet on record), the decision says 'Wait for the missing records; nothing can be relied on
    yet' even though Option A is feasible and its Friday 16:00 cutoff is one hour away."""

    def _check(self, mutate, vid):
        with Variant("reference", vid, mutate) as cid:
            v = L.view(L.initial_state(cid))
            self.assertEqual(v["options"][0]["status"], "feasible")
            self.assertTrue(action(v, "select_a")["enabled"])
            self.assertNotIn("nothing can be relied on", (v["decision"]["headline"] + v["decision"]["next_action"]).lower(),
                             v["decision"])
            self.assertNotIn("Wait", v["decision"]["next_action"], v["decision"])

    def test_N1a_funding_balance_not_yet_known_does_not_hide_feasible_option_a(self):
        self._check(_fund_known_monday, "chl2_fund_mon")

    def test_N1b_facility_terms_not_yet_known_do_not_hide_feasible_option_a(self):
        self._check(_fac_terms_known_monday, "chl2_fac_mon")


class Defect2OptionB(unittest.TestCase):
    def test_N2_record_option_b_advice_has_an_action(self):
        # No facility, valid SGD cash support; Monday 15:00 the only feasible route is B. The decision says
        # "Record Option B." but no action records or instructs Option B, so the supplier is never paid.
        with Variant("reference", "chl2_b_only", _b_only) as cid:
            v = L.view(run(cid, ["advance_clock"]))
            self.assertEqual(v["options"][1]["status"], "feasible")
            if "Option B" in v["decision"]["next_action"]:
                enabled = [a["id"] for a in v["actions"] if a["enabled"] and a["id"] != "advance_clock"]
                self.assertTrue(enabled, "decision %r but the only enabled action is the clock" % v["decision"]["next_action"])

    def test_N3_only_feasible_route_headline_not_used_when_two_routes_are_feasible(self):
        # Minor wording: Friday, A and B both feasible, headline says "Option A is the only feasible route".
        with Variant("reference", "chl2_b_only_fri", _b_only) as cid:
            v = L.view(L.initial_state(cid))
            feasible = [o["key"] for o in v["options"] if o["status"] == "feasible"]
            self.assertEqual(feasible, ["A", "B"])
            self.assertNotIn("only feasible route", v["decision"]["headline"])


class Defect2KnownAt(unittest.TestCase):
    def test_N4_suspension_record_known_monday_is_not_applied_on_friday(self):
        with Variant("reference", "chl2_susp_rec", _suspension_record_monday) as cid:
            v = L.view(L.initial_state(cid))
            self.assertNotIn("FAC-NW-01-S", {e["id"] for e in v["evidence"]})
            self.assertNotEqual(v["facility"]["status"], "suspended", "Friday shows a suspension first known Monday")
            self.assertNotEqual(v["options"][2]["status"], "unavailable")
            # ...and it does apply once known (Monday)
            v2 = L.view(run(cid, ["advance_clock"]))
            self.assertEqual(v2["facility"]["status"], "suspended")

    def test_N5_facility_panel_does_not_show_funding_figures_not_on_record(self):
        # Minor: rule says 'No provider funding account balance on record', panel shows SGD 500,000.00.
        with Variant("reference", "chl2_fund_panel", _fund_known_monday) as cid:
            f = L.view(L.initial_state(cid))["facility"]
            self.assertNotIn("FUND-SG-01", [r.get("id") for r in f["rules"]])
            self.assertNotEqual(f["funding_available_cash"], "SGD 500,000.00",
                                "funding figures shown although the funding record is not yet known")


class Defect2Wording(unittest.TestCase):
    def test_N6_missed_cutoff_after_full_repayment_does_not_say_principal_stays_outstanding(self):
        v = L.view(run("reference", C_PATH[:3] + ["advance_clock"] * 3 + ["sim_receipt"] + PAY_ALL))
        self.assertEqual(v["exposure"]["status"], "ended")
        self.assertNotIn("stays outstanding", v["decision"]["next_action"])


class Resisted2(unittest.TestCase):
    def test_R17_wrong_currency_return_neither_repays_nor_closes_nor_is_blocked(self):
        base = THU + ["sim_pay_usd", "match_repayment"]
        v = L.view(run("reference", base))
        self.assertTrue(action(v, "return_unmatched")["enabled"])
        self.assertFalse(action(v, "close")["enabled"])
        st = run("reference", base + ["return_unmatched"])
        v2 = L.view(st)
        rp = v2["facts"]["repayment"]
        self.assertEqual((rp["principal_outstanding"], rp["fees_outstanding"]), ("SGD 135,382.50", "SGD 150.00"))
        self.assertEqual(v2["exposure"]["status"], "outstanding")
        self.assertEqual(v2["facility"]["company_available"], v["facility"]["company_available"])
        self.assertFalse(action(v2, "close")["enabled"])
        self.assertEqual(L.state_id(L.apply(st, "return_unmatched")), L.state_id(st))
        self.assertNotIn("close", [e["type"] for e in st["events"]])
        # while a payment awaits matching, return waits; it never nets
        v3 = L.view(run("reference", base + ["sim_pay_partial"]))
        self.assertFalse(action(v3, "return_unmatched")["enabled"])
        v4 = L.view(run("reference", base + ["return_unmatched"] + PAY_ALL))
        self.assertTrue(action(v4, "close")["enabled"])
        # over every reachable state: a return event never lowers what is owed
        for case in L.CASE_ORDER:
            for st in reach(case).values():
                if (action(L.view(st), "return_unmatched") or {}).get("enabled"):
                    a, b = L.view(st), L.view(L.apply(st, "return_unmatched"))
                    for k in ("principal_outstanding", "fees_outstanding", "matched"):
                        self.assertEqual(a["facts"]["repayment"][k], b["facts"]["repayment"][k], case)
                    self.assertNotEqual(b["decision"]["tone"], "closed")

    def test_R18_repeated_reserve_draw_instruct_match_happen_once(self):
        st = L.initial_state("reference")
        for aid in C_PATH + ["advance_clock", "advance_clock", "sim_receipt", "sim_pay_partial", "match_repayment"]:
            for _ in range(5):
                st = L.apply(st, aid)   # five clicks each; the clock has only three steps
        counts = {}
        for e in st["events"]:
            counts[e["type"]] = counts.get(e["type"], 0) + 1
        for k in ("request", "reserve", "draw", "instruct", "accept", "credit", "receipt", "incoming", "match"):
            self.assertEqual(counts.get(k), 1, (k, counts))
        rp = L.view(st)["facts"]["repayment"]
        self.assertEqual(rp["principal_outstanding"], "SGD 35,532.50")

    def test_R19_settled_or_undrawn_case_never_says_someone_is_owed(self):
        bad = re.compile(r"is owed by|still owes|Outstanding —|owed\)|owes the provider", re.I)
        for case in L.CASE_ORDER:
            for st in reach(case).values():
                v = L.view(st)
                ex = v["exposure"]
                if ex is None or ex["status"] == "ended":
                    txt = json.dumps([v["decision"], ex, v["facts"]["repayment"]["label"], v["facts"]["cash"]],
                                     ensure_ascii=False)
                    self.assertIsNone(bad.search(txt), (case, txt[:300]))

    def test_R20_fixes_hold_valid_b_known_at_and_early_record_review(self):
        with Variant("reference", "chl2_b_ok", lambda r: r["evidence"].append(cash_support("200000.00"))) as cid:
            self.assertEqual(L.view(L.initial_state(cid))["options"][1]["status"], "feasible")

        def early(r):
            r["simulated_events"]["credit"]["effective_at"] = "2026-11-13T14:00:00+08:00"
            r["simulated_events"]["credit"]["known_at"] = "2026-11-13T14:00:00+08:00"
        with Variant("reference", "chl2_early", early) as cid:
            for path in (["select_a", "instruct", "advance_clock"],
                         ["request_advance", "approve_reserve", "draw", "instruct", "sim_accept", "sim_credit"]):
                st = run(cid, path)
                v = L.view(st)
                self.assertEqual(v["decision"]["tone"], "review")
                self.assertNotEqual(v["facts"]["delivery"]["status"], "credited")
                self.assertFalse(action(v, "close")["enabled"])
                self.assertFalse(action(v, "instruct")["enabled"])
                st2 = L.apply(st, "advance_clock")
                self.assertEqual(sum(1 for e in st2["events"] if e["type"] in ("credit", "return")), 1)

        def res_monday(r):
            e = evidence_by_id(r, "RES-OTH-77")
            e["effective_at"] = e["known_at"] = "2026-11-16T09:00:00+08:00"
        with Variant("competing", "chl2_res_mon", res_monday) as cid:
            self.assertEqual(L.view(L.initial_state(cid))["facility"]["funding_reserved_other_payouts"], "SGD 0.00")
            v = L.view(run(cid, ["advance_clock"]))
            self.assertEqual(v["facility"]["funding_reserved_other_payouts"], "SGD 150,000.00")
            self.assertEqual(v["options"][2]["status"], "infeasible")


class Resisted3OptionB(unittest.TestCase):
    """Round 3 (5e2df82): the new Record Option B path."""

    def test_R21_option_b_path_never_double_funds_double_instructs_or_closes_uncredited(self):
        def b_ok(r):
            r["evidence"].append(cash_support("200000.00"))
        for base, mutate in (("reference", b_ok), ("reference", _b_only), ("failed_payout", b_ok), ("competing", b_ok)):
            with Variant(base, "chl3_b_" + base + mutate.__name__, mutate) as cid:
                for st in L.reachable(cid, cap=3000).values():
                    types = [e["type"] for e in st["events"]]
                    v = L.view(st)
                    if v["options"][1]["status"] != "feasible" and v["options"][1]["status"] != "selected":
                        self.assertIsNone(action(v, "select_b"))
                    self.assertLessEqual(types.count("instruct"), 1)
                    if "select_b" in types:
                        self.assertNotIn("draw", types)
                        self.assertNotIn("select_a", types)
                        self.assertIsNone(v["exposure"])
                        self.assertEqual(v["facility"]["reserved"] if v["facility"] else "SGD 0.00", "SGD 0.00")
                        for e in st["events"]:
                            if e["type"] == "instruct":
                                self.assertTrue("2026-11-16T15:00" <= e["effective_at"][:16] < "2026-11-16T16:00", e)
                    if v["decision"]["tone"] == "closed" or (action(v, "close") or {}).get("enabled"):
                        self.assertEqual(v["facts"]["delivery"]["status"], "credited")

    def test_R22_select_b_never_offered_on_late_small_usd_or_not_yet_known_support(self):
        cases = {"small": cash_support("1000.00"), "late": cash_support("200000.00", effective="2026-11-17T12:00:00+08:00"),
                 "usd": cash_support("200000.00", currency="USD"),
                 "known_mon": cash_support("200000.00", known="2026-11-16T15:30:00+08:00")}
        for name, rec in cases.items():
            with Variant("reference", "chl3_bad_" + name, lambda r, rec=rec: r["evidence"].append(rec)) as cid:
                for st in L.reachable(cid, cap=3000).values():
                    sel = [e for e in st["events"] if e["type"] == "select_b"]
                    if name == "known_mon":
                        self.assertTrue(all(e["known_at"] >= "2026-11-16T15:30" for e in sel), name)
                    else:
                        self.assertEqual(sel, [], name)


if __name__ == "__main__":
    unittest.main()
