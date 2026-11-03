"""Regression tests for the decision-changing differences found when the rebuilt engine was compared with the
supplied original (docs/PARITY_REVIEW.md). Each test names the parity item it protects."""
import json
import os
import sys
import unittest
from decimal import Decimal

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engine import replay  # noqa: E402

SC = replay.SCENARIOS


def load(text):
    events, errors = replay.load_events(text)
    assert errors == [], errors
    return events


def ev(events, time, rate="8"):
    return replay.evaluate(events, time, Decimal(rate))


def opt(r, slot):
    return next(o for o in r["options"] if o["slot"] == slot)


def check(o, prefix):
    return next(c for c in o["checks"] if c["name"].startswith(prefix))


def sub(text, old, new):
    assert text.count(old) == 1, old
    return text.replace(old, new)


def drop(text, record_id):
    lines = [l for l in text.splitlines() if not l.startswith(record_id + ",")]
    assert len(lines) == len(text.splitlines()) - 1, record_id
    return "\n".join(lines) + "\n"


REF = SC["reference"]["csv"]
STALE = SC["stale_balance"]["csv"]
PRE = SC["preagreed"]["csv"]
FRI_BAL = ("CASH-FRI,cash_snapshot,,2026-11-13T14:00:00+08:00,2026-11-13T14:05:00+08:00,"
           "2026-11-16T16:00:00+08:00,200000.00")


def stale_with_balance_at(effective, known=None, expires="2026-11-16T16:00:00+08:00"):
    """stale_balance fixture with its only balance moved; every other Monday input stays fresh."""
    known = known or effective
    return sub(STALE, FRI_BAL, "CASH-FRI,cash_snapshot,,%s,%s,%s,200000.00" % (effective, known, expires))


class P1BalanceAge24h(unittest.TestCase):
    """P1: a settled balance more than 24 h older than the slot being judged is stale (demo policy)."""

    def test_stale_monday_balance_screen(self):
        r = replay.evaluate(SC["stale_balance"]["events"], "monday", Decimal(8), SC["stale_balance"])
        d = r["decision"]
        self.assertEqual(d["state"], "NEED_NEWER_BALANCE")
        self.assertEqual(d["headline"], "We need a newer bank balance to assess Monday’s funding.")
        b = d["balance_check"]
        self.assertEqual(b["balance_sgt"], "Fri 13 Nov 2026, 14:00 SGT")
        self.assertEqual(b["age_at_slot"], "73 h 00 min")
        self.assertEqual(b["slot_sgt"], "Mon 16 Nov 2026, 15:00 SGT")
        self.assertEqual(b["limit"], "24 h before the funding slot (demo policy)")
        self.assertIn("Ask your bank for a settled balance dated within 24 hours", " ".join(d["next_actions"]))
        self.assertIn("does not show the account is short", d["reason"])
        self.assertNotEqual(opt(r, "monday")["status"], "feasible")
        self.assertIsNone(r["comparison"])
        self.assertIsNone(opt(r, "monday")["cash_headroom_sgd"])
        # Everything else for Monday is fresh and sufficient: only cash is unknown.
        bad = [c for c in opt(r, "monday")["checks"] if c["state"] != "ok"]
        self.assertEqual([c["name"] for c in bad], ["Cash after floor and commitments"])

    def test_exactly_24h_is_accepted(self):
        r = ev(load(stale_with_balance_at("2026-11-15T15:00:00+08:00")), "monday")
        self.assertEqual(r["decision"]["state"], "MONDAY_FEASIBLE")

    def test_just_over_24h_is_stale(self):
        r = ev(load(stale_with_balance_at("2026-11-15T14:59:00+08:00")), "monday")
        self.assertEqual(r["decision"]["state"], "NEED_NEWER_BALANCE")
        self.assertEqual(r["decision"]["balance_check"]["age_at_slot"], "24 h 01 min")

    def test_missing_snapshot(self):
        r = ev(load(drop(STALE, "CASH-FRI")), "monday")
        self.assertEqual(r["decision"]["state"], "NEED_NEWER_BALANCE")
        self.assertEqual(r["decision"]["headline"], "We need a bank balance to assess Monday’s funding.")
        self.assertIsNone(r["decision"]["balance_check"]["balance_id"])

    def test_fresh_monday_snapshot(self):
        text = STALE + ("CASH-MON,cash_snapshot,,2026-11-16T09:00:00+08:00,2026-11-16T09:00:00+08:00,,200000.00,"
                        "SGD,,,settled,synthetic: test,Fresh Monday balance\n")
        r = ev(load(text), "monday")
        self.assertEqual(r["decision"]["state"], "MONDAY_FEASIBLE")
        self.assertEqual(opt(r, "monday")["cash_headroom_sgd"], "SGD 14,617.50")

    def test_backdated_monday_balance_first_received_tuesday(self):
        text = STALE + ("CASH-LATE,cash_snapshot,,2026-11-16T09:00:00+08:00,2026-11-17T10:00:00+08:00,,200000.00,"
                        "SGD,,,settled,synthetic: test,Monday-dated balance first received Tuesday\n")
        events = load(text)
        self.assertEqual(ev(events, "monday")["decision"]["state"], "NEED_NEWER_BALANCE")
        retro = ev(events, "retro")
        self.assertFalse(retro["comparison"]["available"])
        self.assertNotEqual(opt(retro, "monday")["status"], "feasible")
        self.assertIn("CASH-FRI", json.dumps(opt(retro, "monday")["checks"]))

    def test_freshness_is_judged_at_the_slot_not_when_retro_opens(self):
        r = replay.evaluate(SC["stale_balance"]["events"], "retro", Decimal(8), SC["stale_balance"])
        self.assertFalse(r["comparison"]["available"])
        self.assertIn("73 h 00 min old at the Monday slot", r["comparison"]["withheld_reason"])
        self.assertEqual(opt(r, "friday")["status"], "feasible")  # 1 h old at the Friday slot

    def test_earlier_expiry_still_applies(self):
        text = stale_with_balance_at("2026-11-16T09:00:00+08:00", expires="2026-11-16T12:00:00+08:00")
        r = ev(load(text), "monday")
        self.assertEqual(r["decision"]["state"], "NEED_NEWER_BALANCE")
        self.assertIn("expired", r["decision"]["reason"])

    def test_rate_never_changes_the_balance_answer(self):
        for rate in ("0", "8", "100"):
            r = replay.evaluate(SC["stale_balance"]["events"], "monday", Decimal(rate), SC["stale_balance"])
            self.assertEqual(r["decision"]["state"], "NEED_NEWER_BALANCE")


class P2ForwardCashSupport(unittest.TestCase):
    """P2: on Friday, Friday's balance is not Monday's cash; waiting needs documented cash support (original
    own_cash_floor_sgd)."""

    def test_reference_friday_lists_cash_support_as_missing(self):
        r = ev(SC["reference"]["events"], "friday")
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")
        self.assertTrue(any("Documented cash support" in m for m in r["decision"]["missing_evidence"]))

    def test_preagreed_without_cash_support_keeps_friday(self):
        r = ev(load(drop(PRE, "SUP-MON")), "friday")
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")

    def test_cash_support_must_cover_required_plus_reservation(self):
        text = sub(PRE, "2026-11-16T16:00:00+08:00,150000.00,SGD", "2026-11-16T16:00:00+08:00,135400.00,SGD")
        r = ev(load(text), "friday")  # 135,400 < 135,382.50 + 25.00
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")

    def test_preagreed_is_manual_review_only(self):
        r = ev(SC["preagreed"]["events"], "friday")
        self.assertEqual(r["decision"]["state"], "MANUAL_REVIEW")
        self.assertIsNone(r["comparison"])


class P3RouteChecks(unittest.TestCase):
    """P3: exclusive cutoff, lead business days with closures, capacity through release, fallback cover,
    complete fee schedule (all present in the original)."""

    def test_instruction_at_cutoff_is_infeasible_even_in_retro(self):
        text = sub(REF, "2026-11-16T15:00:00+08:00,2026-11-12T09:00:00+08:00,2026-11-16T16:00:00+08:00",
                   "2026-11-16T15:00:00+08:00,2026-11-12T09:00:00+08:00,2026-11-16T15:00:00+08:00")
        r = ev(load(text), "retro")
        self.assertEqual(opt(r, "monday")["status"], "infeasible")
        self.assertFalse(r["comparison"]["available"])

    def test_tuesday_closure_loses_monday_lead(self):  # original "holiday" case
        text = REF + ("HOL-TUE,calendar,monday,2026-11-17T00:00:00+08:00,2026-11-12T09:00:00+08:00,,,,,,closed,"
                      "synthetic: test,Tue 17 Nov closed for the Monday route\n")
        r = ev(load(text), "retro")
        self.assertEqual(opt(r, "monday")["status"], "infeasible")
        self.assertIn("1 open business date", check(opt(r, "monday"), "Business day")["detail"])
        self.assertEqual(opt(r, "friday")["status"], "feasible")  # Friday has 3 open dates without Tuesday

    def test_capacity_ending_before_release_is_not_evidence(self):
        text = sub(REF, "2026-11-16T09:00:00+08:00,2026-11-16T09:00:00+08:00,2026-11-19T09:00:00+08:00,100000.00",
                   "2026-11-16T09:00:00+08:00,2026-11-16T09:00:00+08:00,2026-11-16T16:00:00+08:00,100000.00")
        r = ev(load(text), "monday")
        self.assertNotEqual(opt(r, "monday")["status"], "feasible")
        self.assertIn("before the release checkpoint", check(opt(r, "monday"), "Payout capacity")["detail"])

    def test_fallback_must_cover_net_amount(self):
        text = PRE.replace(
            "FB-001,fallback,,2026-11-13T11:30:00+08:00,2026-11-13T11:30:00+08:00,2026-11-19T09:00:00+08:00,"
            "100000.00", "FB-001,fallback,,2026-11-13T11:30:00+08:00,2026-11-13T11:30:00+08:00,"
            "2026-11-19T09:00:00+08:00,90000.00")
        self.assertIn("90000.00", text)
        self.assertEqual(ev(load(text), "friday")["decision"]["state"], "KEEP_FRIDAY")

    def test_missing_processing_fee_is_unknown_not_cheaper(self):
        r = ev(load(drop(REF, "FEE-PROC-MON")), "retro")
        self.assertNotEqual(opt(r, "monday")["status"], "feasible")
        self.assertFalse(r["comparison"]["available"])

    def test_spread_difference_withholds_comparison(self):
        text = REF.replace("1.35,25,,synthetic: Northwind Foods SG fixture,\"Executable Monday",
                           "1.35,10,,synthetic: Northwind Foods SG fixture,\"Executable Monday")
        self.assertNotEqual(text, REF)
        r = ev(load(text), "retro")
        self.assertFalse(r["comparison"]["available"])
        self.assertIn("spreads differ", r["comparison"]["withheld_reason"])


class P4Commitments(unittest.TestCase):
    """P4: commitments need a completeness attestation; none is omitted or deducted twice."""

    def test_missing_commitment_list_makes_cash_unknown(self):
        r = ev(load(drop(drop(REF, "CLIST-MON"), "CLIST-FRI")), "retro")
        self.assertFalse(r["comparison"]["available"])
        self.assertIn("commitment", check(opt(r, "monday"), "Cash")["detail"])

    def test_commitment_already_paid_before_balance_is_not_deducted_again(self):
        text = REF + ("PAID-1,commitment,,2026-11-16T08:00:00+08:00,2026-11-13T10:00:00+08:00,,20000.00,SGD,,,,"
                      "synthetic: test,Payout due Mon 08:00 before the Monday balance\n")
        r = ev(load(text), "monday")
        self.assertEqual(opt(r, "monday")["cash_headroom_sgd"], "SGD 14,617.50")
        self.assertIn("already reflected in the balance", r["decision"]["cash_after_commitments"]["explain"])

    def test_commitment_after_balance_is_deducted_once(self):
        text = REF + ("DUE-1,commitment,,2026-11-17T08:00:00+08:00,2026-11-13T10:00:00+08:00,,10000.00,SGD,,,,"
                      "synthetic: test,Payout due Tue 08:00\n")
        r = ev(load(text), "monday")
        self.assertEqual(opt(r, "monday")["cash_headroom_sgd"], "SGD 4,617.50")


if __name__ == "__main__":
    unittest.main()
