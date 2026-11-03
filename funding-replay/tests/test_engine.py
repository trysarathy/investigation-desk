"""Engine tests for the reconstructed funding decision replay (synthetic fixtures).

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

from engine import replay  # noqa: E402

TIMES = ("friday", "monday", "retro")
RATES = ("0", "2", "8", "20")
SC = replay.SCENARIOS


def run(scenario, time, rate="8", events=None):
    s = SC[scenario]
    return replay.evaluate(s["events"] if events is None else events, time, Decimal(rate), s)


def dump(result):
    return json.dumps(result, ensure_ascii=False, sort_keys=True)


def opt(result, slot):
    return next(o for o in result["options"] if o["slot"] == slot)


def check(option, name_prefix):
    return next(c for c in option["checks"] if c["name"].startswith(name_prefix))


def csv_text(scenario):
    return SC[scenario]["csv"]


def as_of(time):
    return next(d["as_of"] for d in replay.DECISION_TIMES if d["id"] == time)


# Contract "Expected outcomes" table: decision states per scenario x time.
EXPECTED = {
    "reference": ("KEEP_FRIDAY", "MONDAY_FEASIBLE", "HINDSIGHT"),
    "preagreed": ("MANUAL_REVIEW", "MONDAY_FEASIBLE", "HINDSIGHT"),
    "delayed_receivable": ("INSUFFICIENT_CASH", "INSUFFICIENT_CASH", "HINDSIGHT"),
    "concurrent_payout": ("INSUFFICIENT_CASH", "INSUFFICIENT_CASH", "HINDSIGHT"),
    "stale_quote": ("KEEP_FRIDAY", "NO_DECISION", "HINDSIGHT"),
    "closed_day": ("KEEP_FRIDAY", "MONDAY_UNAVAILABLE", "HINDSIGHT"),
    "low_capacity": ("KEEP_FRIDAY", "MONDAY_UNAVAILABLE", "HINDSIGHT"),
    "slow_credit": ("DEADLINE_AT_RISK", "DEADLINE_AT_RISK", "HINDSIGHT"),
}
# Retro comparison available (True) or withheld (False).
RETRO_AVAILABLE = {"reference": True, "preagreed": True}


class ExpectedOutcomesTable(unittest.TestCase):
    def test_all_eight_scenarios_present(self):
        self.assertEqual(set(SC), set(EXPECTED))

    def test_states_match_contract_table(self):
        for sid, states in EXPECTED.items():
            for time, state in zip(TIMES, states):
                with self.subTest(scenario=sid, time=time):
                    self.assertEqual(run(sid, time)["decision"]["state"], state)

    def test_retro_comparison_available_or_withheld(self):
        for sid in SC:
            with self.subTest(scenario=sid):
                c = run(sid, "retro")["comparison"]
                self.assertIsNotNone(c)
                self.assertEqual(c["available"], RETRO_AVAILABLE.get(sid, False))
                if not c["available"]:
                    self.assertTrue(c["withheld_reason"])
                    self.assertIsNone(c["net_benefit_before_subscription"])

    def test_friday_comparison_only_for_manual_review(self):
        for sid in SC:
            with self.subTest(scenario=sid):
                r = run(sid, "friday")
                if r["decision"]["state"] == "MANUAL_REVIEW":
                    self.assertTrue(r["comparison"]["available"])
                else:
                    self.assertIsNone(r["comparison"])

    def test_monday_view_has_no_comparison(self):
        for sid in SC:
            with self.subTest(scenario=sid):
                self.assertIsNone(run(sid, "monday")["comparison"])

    def test_labels_on_every_response(self):
        for sid in SC:
            for time in TIMES:
                r = run(sid, time)
                self.assertEqual(r["label"], "Synthetic replay — no funds move.")
                self.assertEqual(r["engine"], "reconstructed")
                self.assertTrue(r["scenario"]["synthetic"])
                self.assertEqual(r["assumption"]["kind"], "assumption")

    def test_contract_top_level_shape(self):
        keys = {"label", "engine", "scenario", "decision_time", "payment", "decision", "options", "comparison",
                "assumption", "evidence", "warnings"}
        decision_keys = {"state", "headline", "reason", "binding_constraint", "cash_after_commitments",
                         "missing_evidence", "next_actions", "actionable_on_friday"}
        option_keys = {"slot", "label", "status", "checks", "required_sgd", "principal_sgd", "restricted_days",
                       "sgd_days", "avg_restricted_30d", "funding_cost_sgd", "funding_cost_formula", "fees_sgd",
                       "cash_headroom_sgd"}
        evidence_keys = {"record_id", "kind", "slot", "fact", "effective_sgt", "known_sgt", "expires_sgt", "status",
                         "used_by"}
        statuses = {"feasible", "infeasible", "unknown", "passed", "not_evidenced"}
        for sid in SC:
            for time in TIMES:
                r = run(sid, time)
                self.assertEqual(set(r), keys)
                self.assertEqual(set(r["decision"]), decision_keys)
                self.assertEqual([o["slot"] for o in r["options"]], ["friday", "monday"])
                for o in r["options"]:
                    self.assertEqual(set(o), option_keys)
                    self.assertIn(o["status"], statuses)
                    for c in o["checks"]:
                        self.assertEqual(set(c), {"name", "state", "detail", "record_ids"})
                        self.assertIn(c["state"], {"ok", "fail", "unknown"})
                for e in r["evidence"]:
                    self.assertEqual(set(e), evidence_keys)


class ReferenceWalkthrough(unittest.TestCase):
    def test_friday_keep_friday(self):
        r = run("reference", "friday")
        d = r["decision"]
        self.assertEqual(d["state"], "KEEP_FRIDAY")
        self.assertEqual(d["headline"], "Keep Friday’s funding window")
        self.assertFalse(d["actionable_on_friday"])
        self.assertIsNone(r["comparison"])
        self.assertEqual(d["cash_after_commitments"],
                         {"amount": "SGD 150,000.00",
                          "explain": "settled 200,000.00 − floor 50,000.00 − commitments 0.00"})
        self.assertEqual(opt(r, "monday")["status"], "not_evidenced")
        self.assertTrue(d["missing_evidence"])

    def test_friday_option_numbers(self):
        f = opt(run("reference", "friday"), "friday")
        self.assertEqual(f["status"], "feasible")
        self.assertEqual(f["label"], "Fund Fri 13 Nov 15:00 SGT")
        self.assertEqual(f["required_sgd"], "SGD 135,372.50")
        self.assertEqual(f["principal_sgd"], "SGD 135,000.00")
        self.assertEqual(f["restricted_days"], 5)
        self.assertEqual(f["sgd_days"], "675,000")
        self.assertEqual(f["avg_restricted_30d"], "SGD 22,500.00")
        self.assertEqual(f["funding_cost_sgd"], "SGD 147.95")
        self.assertEqual(f["fees_sgd"], "SGD 372.50")
        self.assertEqual(f["cash_headroom_sgd"], "SGD 14,627.50")
        self.assertEqual(f["funding_cost_formula"], "135,000.00 \u00d7 8% \u00d7 5 / 365 = 147.95")

    def test_funding_cost_formula_follows_rate(self):
        f = opt(run("reference", "friday", "0"), "friday")
        self.assertEqual(f["funding_cost_formula"], "135,000.00 \u00d7 0% \u00d7 5 / 365 = 0.00")
        m = opt(run("reference", "retro", "2"), "monday")
        self.assertEqual(m["funding_cost_formula"], "135,000.00 \u00d7 2% \u00d7 2 / 365 = 14.79")

    def test_not_evidenced_option_has_no_numbers(self):
        numeric = ("required_sgd", "principal_sgd", "restricted_days", "sgd_days", "avg_restricted_30d",
                   "funding_cost_sgd", "funding_cost_formula", "fees_sgd", "cash_headroom_sgd")
        seen = 0
        for sid in SC:
            for time in TIMES:
                for o in run(sid, time)["options"]:
                    if o["status"] == "not_evidenced":
                        seen += 1
                        for k in numeric:
                            self.assertIsNone(o[k], (sid, time, k))
        self.assertGreaterEqual(seen, 4)
        m = opt(run("reference", "friday"), "monday")
        self.assertIsNone(m["restricted_days"])
        self.assertIsNone(m["funding_cost_formula"])

    def test_times_and_payment(self):
        r = run("reference", "friday")
        self.assertEqual(r["decision_time"], {"id": "friday", "label": "Friday funding decision",
                                              "as_of_sgt": "Fri 13 Nov 2026, 15:00 SGT",
                                              "as_of_ny": "Fri 13 Nov 2026, 02:00 EST"})
        p = r["payment"]
        self.assertEqual(p["net_usd"], "100,000.00")
        self.assertEqual(p["deadline_sgt"], "Wed 18 Nov 2026, 23:00 SGT")
        self.assertEqual(p["deadline_ny"], "Wed 18 Nov 2026, 10:00 EST")
        self.assertEqual(p["release_sgt"], "Wed 18 Nov 2026, 15:00 SGT")
        self.assertEqual(p["release_ny"], "Wed 18 Nov 2026, 02:00 EST")
        self.assertEqual(p["beneficiary_credit"], "not observed")

    def test_friday_contains_nothing_known_later(self):
        text = dump(run("reference", "friday"))
        for forbidden in ("78.77", "88.77", "135,382.50", "405,000", "59.18", '"Q-MON"', '"CAP-MON"',
                          "Mon 16 Nov 2026, 09:00", "Executable Monday quote"):
            self.assertNotIn(forbidden, text)

    def test_monday_feasible(self):
        r = run("reference", "monday")
        self.assertEqual(r["decision"]["state"], "MONDAY_FEASIBLE")
        self.assertEqual(opt(r, "friday")["status"], "passed")
        m = opt(r, "monday")
        self.assertEqual(m["status"], "feasible")
        self.assertEqual(m["required_sgd"], "SGD 135,382.50")
        self.assertEqual(m["restricted_days"], 2)
        self.assertFalse(r["decision"]["actionable_on_friday"])

    def test_retro_hindsight_numbers_at_8pct(self):
        r = run("reference", "retro")
        self.assertEqual(r["decision"]["state"], "HINDSIGHT")
        self.assertFalse(r["decision"]["actionable_on_friday"])
        c = r["comparison"]
        self.assertTrue(c["available"])
        self.assertEqual(c["days"], {"friday": 5, "monday": 2})
        self.assertEqual(c["sgd_days_less"], "405,000")
        self.assertEqual(c["avg_restricted_less_30d"], "SGD 13,500.00")
        self.assertEqual(c["carry_reduction"], "SGD 88.77")
        self.assertEqual(c["extra_processing"], "SGD 10.00")
        self.assertEqual(c["net_benefit_before_subscription"], "SGD 78.77")
        self.assertEqual(c["formula"], "135,000.00 × 8% × (5 − 2) / 365 = 88.77; "
                                       "88.77 − 10.00 = 78.77")
        self.assertTrue(c["framing"].startswith("Hindsight only. Not available to the operator on Friday"))
        self.assertIn("Friday decision stands", c["framing"])
        self.assertIn("not actionable on Friday", c["framing"])
        self.assertEqual(c["zero_rate_note"],
                         "If retained cash earns nothing and avoids no borrowing, waiting costs SGD 10.00 more.")
        self.assertEqual(r["payment"]["beneficiary_credit"], "not observed")

    def test_retro_at_zero_rate(self):
        c = run("reference", "retro", "0")["comparison"]
        self.assertEqual(c["carry_reduction"], "SGD 0.00")
        self.assertEqual(c["net_benefit_before_subscription"], "SGD −10.00")
        self.assertTrue(c["formula"].endswith("= −10.00"))

    def test_retro_monday_feasible_friday_feasible(self):
        r = run("reference", "retro")
        self.assertEqual([o["status"] for o in r["options"]], ["feasible", "feasible"])
        self.assertEqual(opt(r, "monday")["funding_cost_sgd"], "SGD 59.18")


class PreagreedWalkthrough(unittest.TestCase):
    def test_friday_manual_review(self):
        r = run("preagreed", "friday")
        d = r["decision"]
        self.assertEqual(d["state"], "MANUAL_REVIEW")
        self.assertEqual(d["headline"], "Manual review before waiting")
        self.assertTrue(d["actionable_on_friday"])
        actions = " ".join(d["next_actions"])
        self.assertIn("forward terms", actions)
        self.assertIn("FWD-MON", actions)
        self.assertIn("capacity", actions)
        self.assertIn("fallback", actions)
        self.assertIn("reservation cost SGD 25.00", actions)
        self.assertEqual(opt(r, "monday")["status"], "feasible")

    def test_friday_comparison_conditional_with_reservation_cost(self):
        c = run("preagreed", "friday")["comparison"]
        self.assertTrue(c["available"])
        self.assertIn("Conditional on verifying the forward terms; not a recommendation", c["framing"])
        self.assertEqual(c["reservation_cost"], "SGD 25.00")
        self.assertEqual(c["carry_reduction"], "SGD 88.77")
        self.assertEqual(c["net_benefit_before_subscription"], "SGD 53.77")
        self.assertIn("− 25.00", c["formula"])

    def test_monday_and_retro(self):
        self.assertEqual(run("preagreed", "monday")["decision"]["state"], "MONDAY_FEASIBLE")
        r = run("preagreed", "retro")
        self.assertEqual(r["decision"]["state"], "HINDSIGHT")
        self.assertTrue(r["decision"]["actionable_on_friday"])
        self.assertIn("reviewed option existed", r["comparison"]["framing"])
        self.assertIn("not a recommendation", r["comparison"]["framing"])


class DelayedReceivable(unittest.TestCase):
    def test_friday_insufficient_forecast_not_counted(self):
        r = run("delayed_receivable", "friday")
        d = r["decision"]
        self.assertEqual(d["state"], "INSUFFICIENT_CASH")
        self.assertEqual(d["cash_after_commitments"]["amount"], "SGD 130,000.00")
        self.assertIn("forecast 25,000.00 not counted", d["cash_after_commitments"]["explain"])
        self.assertEqual(opt(r, "friday")["required_sgd"], "SGD 135,372.50")
        self.assertIn("not counted", d["reason"])

    def test_monday_short_5382_50(self):
        r = run("delayed_receivable", "monday")
        d = r["decision"]
        self.assertEqual(d["state"], "INSUFFICIENT_CASH")
        self.assertEqual(d["cash_after_commitments"]["amount"], "SGD 130,000.00")
        m = opt(r, "monday")
        self.assertEqual(m["required_sgd"], "SGD 135,382.50")
        self.assertEqual(m["cash_headroom_sgd"], "SGD −5,382.50")
        self.assertIn("Usable SGD 130,000.00 vs required SGD 135,382.50: short SGD 5,382.50", d["reason"])
        self.assertIsNone(r["comparison"])

    def test_monday_view_excludes_tuesday_receipt(self):
        text = dump(run("delayed_receivable", "monday"))
        self.assertNotIn('"RCV-ST"', text)
        self.assertNotIn("Tue 17 Nov 2026, 11:00", text)

    def test_retro_withheld_tuesday_cannot_finance_monday(self):
        c = run("delayed_receivable", "retro")["comparison"]
        self.assertFalse(c["available"])
        self.assertIn("Tuesday receipt cannot finance Monday’s instruction", c["withheld_reason"])


class OtherIncidents(unittest.TestCase):
    def test_concurrent_payout(self):
        r = run("concurrent_payout", "friday")
        self.assertEqual(r["decision"]["state"], "INSUFFICIENT_CASH")
        self.assertEqual(r["decision"]["cash_after_commitments"]["amount"], "SGD 120,000.00")
        self.assertIn("commitments 30,000.00", r["decision"]["cash_after_commitments"]["explain"])
        self.assertEqual(run("concurrent_payout", "monday")["decision"]["state"], "INSUFFICIENT_CASH")
        self.assertFalse(run("concurrent_payout", "retro")["comparison"]["available"])

    def test_stale_quote(self):
        r = run("stale_quote", "friday")
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")
        m = opt(r, "monday")
        self.assertEqual(m["status"], "unknown")
        q = check(m, "FX")
        self.assertEqual(q["state"], "unknown")
        self.assertIn("stale", q["detail"])
        self.assertIn("Fri 13 Nov 2026, 18:00 SGT", q["detail"])
        mon = run("stale_quote", "monday")
        self.assertEqual(mon["decision"]["state"], "NO_DECISION")
        self.assertEqual(opt(mon, "monday")["status"], "unknown")
        c = run("stale_quote", "retro")["comparison"]
        self.assertFalse(c["available"])
        self.assertIn("quote", c["withheld_reason"])

    def test_closed_day(self):
        r = run("closed_day", "friday")
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")
        self.assertEqual(opt(r, "monday")["status"], "infeasible")
        self.assertEqual(check(opt(r, "monday"), "Business day")["state"], "fail")
        self.assertEqual(run("closed_day", "monday")["decision"]["state"], "MONDAY_UNAVAILABLE")
        self.assertFalse(run("closed_day", "retro")["comparison"]["available"])

    def test_low_capacity(self):
        self.assertEqual(run("low_capacity", "friday")["decision"]["state"], "KEEP_FRIDAY")
        r = run("low_capacity", "monday")
        self.assertEqual(r["decision"]["state"], "MONDAY_UNAVAILABLE")
        self.assertEqual(opt(r, "monday")["status"], "infeasible")
        self.assertIn("USD 60,000.00", r["decision"]["reason"])
        self.assertIn("USD 100,000.00", r["decision"]["reason"])
        self.assertFalse(run("low_capacity", "retro")["comparison"]["available"])

    def test_slow_credit(self):
        r = run("slow_credit", "friday")
        self.assertEqual(r["decision"]["state"], "DEADLINE_AT_RISK")
        for slot in ("friday", "monday"):
            o = opt(r, slot)
            self.assertEqual(o["status"], "infeasible")
            c = check(o, "Delivery")
            self.assertEqual(c["state"], "fail")
            self.assertIn("Thu 19 Nov 2026, 00:00 SGT", c["detail"])
            self.assertIn("not observed delivery", c["detail"])
        self.assertEqual(run("slow_credit", "monday")["decision"]["state"], "DEADLINE_AT_RISK")
        self.assertFalse(run("slow_credit", "retro")["comparison"]["available"])

    def test_simulated_bound_is_not_delivery(self):
        r = run("reference", "friday")
        self.assertIn("not observed delivery", check(opt(r, "friday"), "Delivery")["detail"])
        self.assertTrue(any("simulated" in w for w in r["warnings"]))


class EvidenceCutoff(unittest.TestCase):
    def test_no_later_record_anywhere(self):
        """Serialise the whole response: no record known after as_of may appear."""
        for sid, s in SC.items():
            for time in TIMES:
                cutoff = as_of(time)
                text = dump(run(sid, time))
                for e in s["events"]:
                    if e.known_at > cutoff:
                        with self.subTest(scenario=sid, time=time, record=e.record_id):
                            self.assertNotIn('"%s"' % e.record_id, text)
                            self.assertNotIn("(%s)" % e.record_id, text)
                            self.assertNotIn(e.record_id + ",", text)
                            self.assertNotIn(e.establishes, text)

    def test_evidence_lists_only_visible_records(self):
        for sid, s in SC.items():
            for time in TIMES:
                cutoff = as_of(time)
                ids = {e["record_id"] for e in run(sid, time)["evidence"]}
                expected = {e.record_id for e in s["events"] if e.known_at <= cutoff}
                self.assertEqual(ids, expected)

    def test_adding_later_records_cannot_change_friday(self):
        base = run("reference", "friday")
        extra_csv = csv_text("reference") + (
            "LATE-1,quote,monday,2026-11-13T15:30:00+08:00,2026-11-13T15:00:01+08:00,2026-11-16T16:00:00+08:00,"
            ",,1.30,5,,synthetic: test,A later Monday quote\n"
            "LATE-2,capacity,monday,2026-11-16T09:00:00+08:00,2026-11-13T16:00:00+08:00,,100000.00,USD,,,"
            "reserved,synthetic: test,Later capacity\n")
        events, errors = replay.load_events(extra_csv)
        self.assertEqual(errors, [])
        self.assertEqual(dump(run("reference", "friday", events=events)), dump(base))


RATE_FIELDS_OPTION = ("funding_cost_sgd", "funding_cost_formula")
RATE_FIELDS_COMPARISON = ("carry_reduction", "net_benefit_before_subscription", "formula")


def strip_rate(result):
    r = copy.deepcopy(result)
    del r["assumption"]["funding_rate_pct"]
    for o in r["options"]:
        for k in RATE_FIELDS_OPTION:
            o.pop(k)
    if r["comparison"]:
        for k in RATE_FIELDS_COMPARISON:
            r["comparison"].pop(k)
    return r


class RateIsOnlyAnAssumption(unittest.TestCase):
    def test_rate_never_changes_anything_else(self):
        for sid in SC:
            for time in TIMES:
                base = dump(strip_rate(run(sid, time, "8")))
                for rate in RATES:
                    with self.subTest(scenario=sid, time=time, rate=rate):
                        self.assertEqual(dump(strip_rate(run(sid, time, rate))), base)

    def test_rate_changes_the_carry(self):
        a = run("reference", "retro", "2")["comparison"]
        b = run("reference", "retro", "20")["comparison"]
        self.assertEqual(a["carry_reduction"], "SGD 22.19")
        self.assertEqual(b["carry_reduction"], "SGD 221.92")
        self.assertEqual(run("reference", "retro", "2")["assumption"]["funding_rate_pct"], "2")

    def test_float_rate_rejected(self):
        with self.assertRaises(TypeError):
            replay.evaluate(SC["reference"]["events"], "friday", 8.0)

    def test_bad_rate_and_time_rejected(self):
        with self.assertRaises(ValueError):
            replay.evaluate(SC["reference"]["events"], "friday", Decimal("-1"))
        with self.assertRaises(ValueError):
            replay.evaluate(SC["reference"]["events"], "tuesday", Decimal("8"))

    def test_no_float_in_engine_source(self):
        with open(replay.__file__, encoding="utf-8") as handle:
            source = handle.read()
        code = [line for line in source.splitlines() if "float" in line]
        # The only mentions are the guard that rejects floats.
        for line in code:
            self.assertTrue("isinstance(value, float)" in line or "never a float" in line, line)


class LoaderBehaviour(unittest.TestCase):
    def test_fixtures_load_and_are_labelled_synthetic(self):
        for sid, s in SC.items():
            events, errors = replay.load_events(s["csv"])
            self.assertEqual(errors, [], sid)
            for e in events:
                self.assertTrue(e.source.startswith("synthetic:"), (sid, e.record_id))
                self.assertTrue(e.establishes, (sid, e.record_id))

    def test_scenarios_json(self):
        with open(os.path.join(replay.FIXTURES_DIR, "scenarios.json"), encoding="utf-8") as handle:
            listing = json.load(handle)
        self.assertEqual([x["id"] for x in listing], list(SC))
        for x in listing:
            self.assertTrue(x["name"] and x["description"])

    def test_duplicate_rows_are_dropped_and_output_unchanged(self):
        text = csv_text("reference")
        lines = text.strip("\n").split("\n")
        duplicated = "\n".join(lines + lines[1:] + lines[3:6]) + "\n"
        events, errors = replay.load_events(duplicated)
        self.assertEqual(errors, [])
        self.assertEqual(len(events), len(SC["reference"]["events"]))
        for time in TIMES:
            for rate in ("0", "8"):
                self.assertEqual(dump(run("reference", time, rate, events=events)),
                                 dump(run("reference", time, rate)))

    def test_conflicting_record_id_rejected(self):
        text = csv_text("reference")
        lines = text.strip("\n").split("\n")
        changed = lines[1].replace("100000.00", "99000.00")
        self.assertNotEqual(changed, lines[1])
        events, errors = replay.load_events("\n".join(lines + [changed]) + "\n")
        self.assertEqual(events, [])
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0]["row"], len(lines) + 1)
        self.assertEqual(errors[0]["column"], "amount")
        self.assertIn("conflicts with row 2", errors[0]["message"])

    def _row(self, **overrides):
        base = {"record_id": "X-1", "kind": "fee", "slot": "", "effective_at": "",
                "known_at": "2026-11-12T09:00:00+08:00", "expires_at": "", "amount": "10.00", "currency": "SGD",
                "rate": "", "bp": "", "status": "", "source": "synthetic: test", "establishes": "test"}
        base.update(overrides)
        return ",".join(base[c] for c in replay.COLUMNS)

    def _load_with(self, **overrides):
        header = ",".join(replay.COLUMNS)
        return replay.load_events(header + "\n" + self._row(record_id="OK-1") + "\n" + self._row(**overrides) + "\n")

    def assertError(self, result, row, column, fragment=None):
        events, errors = result
        self.assertEqual(events, [])
        self.assertTrue(any(e["row"] == row and e["column"] == column for e in errors), errors)
        if fragment:
            self.assertTrue(any(fragment in e["message"] for e in errors), errors)

    def test_timestamp_without_offset(self):
        self.assertError(self._load_with(known_at="2026-11-12T09:00:00"), 3, "known_at", "offset")

    def test_bad_timestamp(self):
        self.assertError(self._load_with(known_at="13/11/2026"), 3, "known_at")

    def test_bad_decimal(self):
        self.assertError(self._load_with(amount="1e3"), 3, "amount")
        self.assertError(self._load_with(amount='"1,000"'), 3, "amount")
        self.assertError(self._load_with(amount="-5"), 3, "amount")

    def test_unknown_kind_slot_status(self):
        self.assertError(self._load_with(kind="loan"), 3, "kind")
        self.assertError(self._load_with(slot="tuesday"), 3, "slot")
        self.assertError(self._load_with(kind="calendar", slot="monday", status="maybe", amount="", currency=""),
                         3, "status")

    def test_missing_required_field(self):
        self.assertError(self._load_with(amount=""), 3, "amount", "required")

    def test_wrong_currency(self):
        self.assertError(self._load_with(currency="USD"), 3, "currency")

    def test_missing_columns(self):
        header = ",".join(c for c in replay.COLUMNS if c not in ("bp", "known_at"))
        events, errors = replay.load_events(header + "\nX\n")
        self.assertEqual(events, [])
        self.assertEqual({(e["row"], e["column"]) for e in errors}, {(1, "bp"), (1, "known_at")})

    def test_empty_and_header_only(self):
        self.assertEqual(replay.load_events("")[1][0]["row"], 1)
        self.assertTrue(replay.load_events(",".join(replay.COLUMNS) + "\n")[1])

    def test_wrong_field_count(self):
        header = ",".join(replay.COLUMNS)
        events, errors = replay.load_events(header + "\n" + self._row() + "\na,b,c\n")
        self.assertEqual(errors[0]["row"], 3)

    def test_column_order_free(self):
        cols = list(reversed(replay.COLUMNS))
        import csv
        import io
        events = SC["reference"]["csv"]
        reader = csv.DictReader(io.StringIO(events))
        out = io.StringIO()
        w = csv.DictWriter(out, fieldnames=cols, lineterminator="\n")
        w.writeheader()
        for row in reader:
            w.writerow(row)
        loaded, errors = replay.load_events(out.getvalue())
        self.assertEqual(errors, [])
        self.assertEqual(dump(run("reference", "retro", events=loaded)), dump(run("reference", "retro")))


class UnknownNeverAssumed(unittest.TestCase):
    def _with_extra(self, scenario, extra_rows):
        text = csv_text(scenario) + "".join(r + "\n" for r in extra_rows)
        events, errors = replay.load_events(text)
        self.assertEqual(errors, [])
        return events

    def test_contradictory_calendar_is_unknown(self):
        events = self._with_extra("reference", [
            "CAL-FRI-2,calendar,friday,2026-11-13T00:00:00+08:00,2026-11-12T10:00:00+08:00,,,,,,closed,"
            "synthetic: test,Contradicting calendar"])
        r = run("reference", "friday", events=events)
        f = opt(r, "friday")
        self.assertEqual(check(f, "Business day")["state"], "unknown")
        self.assertEqual(f["status"], "unknown")
        self.assertEqual(r["decision"]["state"], "NO_DECISION")

    def test_contradictory_friday_quotes_are_unknown(self):
        events = self._with_extra("reference", [
            "Q-FRI-2,quote,friday,2026-11-13T14:40:00+08:00,2026-11-13T14:40:00+08:00,2026-11-13T16:00:00+08:00,"
            ",,1.36,25,,synthetic: test,A different Friday quote"])
        r = run("reference", "friday", events=events)
        self.assertEqual(check(opt(r, "friday"), "FX")["state"], "unknown")
        self.assertEqual(r["decision"]["state"], "NO_DECISION")
        self.assertIsNone(opt(r, "friday")["required_sgd"])

    def test_contradictory_monday_quotes_withhold_retro(self):
        events = self._with_extra("reference", [
            "Q-MON-2,quote,monday,2026-11-16T09:10:00+08:00,2026-11-16T09:10:00+08:00,2026-11-16T16:00:00+08:00,"
            ",,1.34,25,,synthetic: test,A different Monday quote"])
        self.assertEqual(run("reference", "monday", events=events)["decision"]["state"], "NO_DECISION")
        self.assertFalse(run("reference", "retro", events=events)["comparison"]["available"])

    def test_missing_cash_floor_is_unknown(self):
        events = [e for e in SC["reference"]["events"] if e.kind != "cash_floor"]
        r = run("reference", "friday", events=events)
        self.assertEqual(check(opt(r, "friday"), "Cash")["state"], "unknown")
        self.assertEqual(r["decision"]["state"], "NO_DECISION")

    def test_missing_obligation(self):
        events = [e for e in SC["reference"]["events"] if e.kind != "obligation"]
        r = run("reference", "friday", events=events)
        self.assertEqual(r["decision"]["state"], "NO_DECISION")
        self.assertIsNone(r["payment"]["net_usd"])

    def test_indicative_capacity_is_not_feasible(self):
        text = csv_text("preagreed").replace(",reserved,", ",indicative,")
        events, errors = replay.load_events(text)
        self.assertEqual(errors, [])
        r = run("preagreed", "friday", events=events)
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")
        self.assertIsNone(r["comparison"])

    def test_beneficiary_credit_observed_only_with_record(self):
        events = self._with_extra("reference", [
            "BC-1,beneficiary_credit,,2026-11-18T22:10:00+08:00,2026-11-18T22:30:00+08:00,,,,,,,"
            "synthetic: test,Supplier bank shows usable credit"])
        self.assertEqual(run("reference", "monday", events=events)["payment"]["beneficiary_credit"], "not observed")
        self.assertIn("observed Wed 18 Nov 2026, 22:10 SGT",
                      run("reference", "retro", events=events)["payment"]["beneficiary_credit"])


class PlainEnglish(unittest.TestCase):
    BANNED = ("clearline will", "we will", "pay now", "transfer now", "loan", "lend", "credit offer",
              "borrow from us", "guarantee")

    def test_no_banned_phrases_in_actions_and_reasons(self):
        for sid in SC:
            for time in TIMES:
                d = run(sid, time)["decision"]
                text = " ".join([d["headline"], d["reason"], d["binding_constraint"]] + d["next_actions"]).lower()
                for phrase in self.BANNED:
                    self.assertNotIn(phrase, text, (sid, time))
                self.assertTrue(d["next_actions"])

    def test_deterministic_and_pure(self):
        events = SC["reference"]["events"]
        before = list(events)
        a = dump(run("reference", "retro"))
        b = dump(run("reference", "retro"))
        self.assertEqual(a, b)
        self.assertEqual(events, before)


class TimeFormatting(unittest.TestCase):
    def test_ny_dst_and_fallback(self):
        from datetime import datetime
        summer = datetime.fromisoformat("2026-07-01T15:00:00+08:00")
        winter = datetime.fromisoformat("2026-11-13T15:00:00+08:00")
        self.assertTrue(replay.fmt_ny(summer).endswith("03:00 EDT"))
        self.assertTrue(replay.fmt_ny(winter).endswith("02:00 EST"))
        saved = replay._NY_ZONE
        try:
            replay._NY_ZONE = None
            self.assertTrue(replay.fmt_ny(summer).endswith("03:00 EDT"))
            self.assertEqual(replay.fmt_ny(winter), "Fri 13 Nov 2026, 02:00 EST")
            # 2026 DST ends Sun 1 Nov 02:00 EDT (06:00 UTC).
            self.assertTrue(replay.fmt_ny(datetime.fromisoformat("2026-11-01T05:59:00+00:00")).endswith("EDT"))
            self.assertTrue(replay.fmt_ny(datetime.fromisoformat("2026-11-01T06:00:00+00:00")).endswith("EST"))
        finally:
            replay._NY_ZONE = saved

    def test_money_rounding_half_up(self):
        self.assertEqual(replay.fmt_money("SGD", Decimal("0.005")), "SGD 0.01")
        self.assertEqual(replay.fmt_money("SGD", Decimal("2.345")), "SGD 2.35")
        self.assertEqual(replay.fmt_money("SGD", Decimal("-10")), "SGD −10.00")


if __name__ == "__main__":
    unittest.main()
