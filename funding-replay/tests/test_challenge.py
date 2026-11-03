"""Regression tests for the challenger's findings (B1-B6, M1-M4, minor). Synthetic data only."""

import json
import os
import re
import sys
import unittest
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from engine import replay  # noqa: E402

SC = replay.SCENARIOS
TIMES = ("friday", "monday", "retro")
FRIDAY_AS_OF = replay.FRIDAY_AS_OF


def load(text):
    events, errors = replay.load_events(text)
    if errors:
        raise AssertionError(errors[:3])
    return events


def ev(events, time, rate="8", scenario=None):
    return replay.evaluate(events, time, Decimal(rate), scenario)


def sub(text, old, new):
    assert old in text, old
    return text.replace(old, new)


def opt(result, slot):
    return next(o for o in result["options"] if o["slot"] == slot)


def check(option, prefix):
    return next(c for c in option["checks"] if c["name"].startswith(prefix))


REF = SC["reference"]["csv"]
PRE = SC["preagreed"]["csv"]
DLY = SC["delayed_receivable"]["csv"]


class B1RetroUsesEachSlotsOwnEvidence(unittest.TestCase):
    def test_capacity_known_after_monday_instruction_withholds_retro(self):
        text = sub(REF, "CAP-MON,capacity,monday,2026-11-16T09:00:00+08:00,2026-11-16T09:00:00+08:00",
                   "CAP-MON,capacity,monday,2026-11-16T09:00:00+08:00,2026-11-17T12:00:00+08:00")
        r = ev(load(text), "retro")
        self.assertFalse(r["comparison"]["available"])
        self.assertNotIn("first known Mon 16 Nov 2026, 09:00 SGT", json.dumps(r, ensure_ascii=False))

    def test_quote_known_wednesday_withholds_retro(self):
        text = sub(REF, "Q-MON,quote,monday,2026-11-16T09:00:00+08:00,2026-11-16T09:00:00+08:00",
                   "Q-MON,quote,monday,2026-11-16T09:00:00+08:00,2026-11-18T09:00:00+08:00")
        self.assertFalse(ev(load(text), "retro")["comparison"]["available"])

    def test_late_known_commitment_does_not_make_friday_infeasible_in_retro(self):
        text = REF + ("COMMIT-X,commitment,,2026-11-16T10:00:00+08:00,2026-11-17T10:00:00+08:00,,140000.00,SGD,,,,"
                      "synthetic: test,A payout first known Tuesday\n")
        r = ev(load(text), "retro")
        self.assertEqual(opt(r, "friday")["status"], "feasible")
        self.assertEqual(opt(r, "monday")["status"], "feasible")
        self.assertTrue(r["comparison"]["available"])

    def test_framing_states_each_kinds_first_known_time(self):
        text = sub(REF, "CAP-MON,capacity,monday,2026-11-16T09:00:00+08:00,2026-11-16T09:00:00+08:00",
                   "CAP-MON,capacity,monday,2026-11-16T09:00:00+08:00,2026-11-16T11:30:00+08:00")
        framing = ev(load(text), "retro")["comparison"]["framing"]
        self.assertIn("quote was first known Mon 16 Nov 2026, 09:00 SGT", framing)
        self.assertIn("capacity was first known Mon 16 Nov 2026, 11:30 SGT", framing)

    def test_reference_framing_unchanged(self):
        c = ev(SC["reference"]["events"], "retro")["comparison"]
        self.assertIn("first known Mon 16 Nov 2026, 09:00 SGT", c["framing"])
        self.assertEqual(c["net_benefit_before_subscription"], "SGD 78.77")


class B2MondayIsCounterfactual(unittest.TestCase):
    def test_note_on_monday(self):
        for sid, s in SC.items():
            r = ev(s["events"], "monday", scenario=s)
            fri = ev(s["events"], "friday", scenario=s)
            note = r["decision_time"]["note"]
            self.assertTrue(note.startswith("Counterfactual: assumes the SGD had been held after Friday."), sid)
            self.assertIn("On Friday’s evidence the decision was: %s." % fri["decision"]["headline"], note)
        self.assertIn("note", ev(SC["reference"]["events"], "friday")["decision_time"])

    def test_monday_language_is_conditional(self):
        for sid, s in SC.items():
            d = ev(s["events"], "monday")["decision"]
            self.assertIn("would have been", d["headline"], sid)
            fri_state = ev(s["events"], "friday")["decision"]["state"]
            text = " ".join(d["next_actions"])
            if fri_state == "MANUAL_REVIEW":
                self.assertTrue(any(a.startswith("If you held the funds after review: confirm") for a in
                                    d["next_actions"]), sid)
            else:
                self.assertNotRegex(text, r"(?i)\bconfirm the monday (quote|terms)")
            self.assertIn("do not instruct the same payment again", text.lower(), sid)


class B3MissingSpreadIsUnknown(unittest.TestCase):
    def test_forward_terms_without_bp(self):
        text = sub(PRE, "2026-11-16T16:00:00+08:00,,,1.35,25,agreed", "2026-11-16T16:00:00+08:00,,,1.35,,agreed")
        r = ev(load(text), "friday")
        m = opt(r, "monday")
        self.assertEqual(check(m, "F")["state"] if False else
                         next(c for c in m["checks"] if c["name"] in ("FX quote", "Forward terms"))["state"],
                         "unknown")
        self.assertIsNone(m["required_sgd"])
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")
        self.assertIsNone(r["comparison"])


class B4DifferentRatesWithheld(unittest.TestCase):
    def test_monday_rate_differs(self):
        text = sub(REF, "2026-11-16T16:00:00+08:00,,,1.35,25,", "2026-11-16T16:00:00+08:00,,,1.30,25,")
        for rate in ("0", "8"):
            c = ev(load(text), "retro", rate)["comparison"]
            self.assertFalse(c["available"])
            self.assertIn("Rates differ between slots; the difference would mix a market move with timing",
                          c["withheld_reason"])

    def test_no_saves_wording_anywhere(self):
        with open(replay.__file__, encoding="utf-8") as handle:
            self.assertNotIn("saves", handle.read())

    def test_extra_cost_is_fees_only(self):
        c = ev(SC["reference"]["events"], "retro")["comparison"]
        self.assertEqual(c["extra_processing"], "SGD 10.00")


class B5FridaySafeDescriptions(unittest.TestCase):
    def test_names_and_descriptions_leak_nothing_known_after_friday(self):
        for sid, s in SC.items():
            text = s["name"] + " " + s["description"]
            early = [e for e in s["events"] if e.known_at <= FRIDAY_AS_OF]
            late = [e for e in s["events"] if e.known_at > FRIDAY_AS_OF]
            early_amounts = {e.amount for e in early if e.amount is not None}
            early_days = {replay._weekday_long(e.effective_at) for e in early if e.effective_at}
            for e in late:
                with self.subTest(scenario=sid, record=e.record_id):
                    self.assertNotIn(e.record_id, text)
                    if e.amount is not None and e.amount not in early_amounts:
                        whole = e.amount.to_integral_value()
                        for form in ("{:,}".format(int(whole)), str(int(whole))):
                            self.assertNotIn(form, text)
                    if e.effective_at:
                        day = replay._weekday_long(e.effective_at)
                        if day not in early_days:
                            self.assertNotIn(day, text)
                            self.assertNotIn(day[:3] + " ", text)
            self.assertNotRegex(text.lower(), r"\b(actually|turns out|only settles|later)\b", sid)


class B6FutureDatedSettledIsForecast(unittest.TestCase):
    def test_future_dated_snapshot_not_usable(self):
        text = REF + ("CASH-FUT,cash_snapshot,,2026-11-16T09:00:00+08:00,2026-11-13T09:05:00+08:00,,900000.00,SGD,"
                      ",,settled,synthetic: test,A balance dated in the future\n")
        r = ev(load(text), "friday")
        cash = check(opt(r, "monday"), "Cash")
        self.assertNotIn("CASH-FUT", cash["record_ids"])
        self.assertNotIn("1,050,000", cash["detail"])
        self.assertTrue(any("CASH-FUT" in w and "forecast" in w for w in r["warnings"]))

    def test_future_dated_settled_receivable_not_usable(self):
        text = sub(DLY, "RCV-FC,receivable,,2026-11-16T09:00:00+08:00,2026-11-13T09:00:00+08:00,,25000.00,SGD,,,"
                        "forecast", "RCV-FC,receivable,,2026-11-16T09:00:00+08:00,2026-11-13T09:00:00+08:00,,"
                                    "25000.00,SGD,,,settled")
        r = ev(load(text), "monday")
        self.assertEqual(r["decision"]["state"], "INSUFFICIENT_CASH")
        self.assertEqual(r["decision"]["cash_after_commitments"]["amount"], "SGD 130,000.00")
        self.assertTrue(any("RCV-FC" in w and "forecast" in w for w in r["warnings"]))


class M1LimitsAndServerErrors(unittest.TestCase):
    def test_decimal_caps(self):
        header = REF.split("\n", 1)[0]
        for bad in ("1234567890123456789.00", "1.1234567", "１００"):
            row = ("X-1,cash_floor,,,2026-11-12T09:00:00+08:00,,%s,SGD,,,,synthetic: test,floor" % bad)
            events, errors = replay.load_events(header + "\n" + row + "\n")
            self.assertEqual(events, [])
            self.assertEqual((errors[0]["row"], errors[0]["column"]), (2, "amount"), bad)
        ok = header + "\nX-1,cash_floor,,,2026-11-12T09:00:00+08:00,,123456789012345678.123456,SGD,,,,s,floor\n"
        self.assertEqual(replay.load_events(ok)[1], [])

    def test_max_size_values_evaluate(self):
        text = sub(REF, ",,200000.00,SGD,,,settled", ",,999999999999999999.999999,SGD,,,settled")
        r = ev(load(text), "friday")
        self.assertEqual(r["decision"]["state"], "KEEP_FRIDAY")

    def test_non_ascii_digits_in_timestamp_rejected(self):
        text = sub(REF, "Q-FRI,quote,friday,2026-11-13T14:30:00+08:00",
                   "Q-FRI,quote,friday,２026-11-13T14:30:00+08:00")
        events, errors = replay.load_events(text)
        self.assertTrue(errors)

    def test_server_returns_json_500_on_engine_exception(self):
        import http.client
        import threading
        sys.path.insert(0, os.path.join(os.path.dirname(HERE), "app"))
        import server as app_server
        httpd = app_server.make_server(0)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        saved = app_server.replay.evaluate

        def boom(*a, **k):
            raise RuntimeError("synthetic failure")
        try:
            app_server.replay.evaluate = boom
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            conn.request("POST", "/api/evaluate", body=b'{"scenario":"reference","decision_time":"friday",'
                                                        b'"funding_rate_pct":"8"}',
                         headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            body = json.loads(res.read().decode("utf-8"))
            conn.close()
            self.assertEqual(res.status, 500)
            self.assertFalse(body["ok"])
            self.assertEqual(body["label"], replay.LABEL)
            self.assertNotIn("synthetic failure", body["error"])
        finally:
            app_server.replay.evaluate = saved
            httpd.shutdown()
            httpd.server_close()

    def test_server_rejects_unicode_digit_rate(self):
        import http.client
        import threading
        sys.path.insert(0, os.path.join(os.path.dirname(HERE), "app"))
        import server as app_server
        httpd = app_server.make_server(0)
        port = httpd.server_address[1]
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            body = json.dumps({"scenario": "reference", "decision_time": "friday",
                               "funding_rate_pct": "８"}).encode()
            conn.request("POST", "/api/evaluate", body=body, headers={"Content-Type": "application/json"})
            res = conn.getresponse()
            res.read()
            conn.close()
            self.assertEqual(res.status, 400)
        finally:
            httpd.shutdown()
            httpd.server_close()


class M2FeeTypes(unittest.TestCase):
    def test_fixture_fees_carry_type(self):
        for sid, s in SC.items():
            for e in s["events"]:
                if e.kind == "fee":
                    self.assertIn(e.status, ("rail", "processing", "other"), (sid, e.record_id))

    def test_fee_without_type_rejected(self):
        text = sub(REF, ",,20.00,SGD,,,rail,", ",,20.00,SGD,,,,")
        events, errors = replay.load_events(text)
        self.assertTrue(any(e["column"] == "status" for e in errors))

    def test_duplicate_fee_under_new_id_is_contradictory(self):
        text = REF + ("FEE-PROC-MON2,fee,monday,,2026-11-12T09:00:00+08:00,,25.00,SGD,,,processing,"
                      "synthetic: test,Processing charge again\n")
        r = ev(load(text), "retro")
        self.assertEqual(check(opt(r, "monday"), "Fees")["state"], "unknown")
        self.assertFalse(r["comparison"]["available"])

    def test_conflicting_fee_is_contradictory(self):
        text = REF + ("FEE-PROC-MON-v2,fee,monday,,2026-11-14T09:00:00+08:00,,30.00,SGD,,,processing,"
                      "synthetic: test,Corrected processing charge\n")
        r = ev(load(text), "retro")
        self.assertEqual(check(opt(r, "monday"), "Fees")["state"], "unknown")
        self.assertFalse(r["comparison"]["available"])


class M3ObservedCreditOverridesBound(unittest.TestCase):
    def test_late_observed_credit_fails_delivery(self):
        text = REF + ("BC-1,beneficiary_credit,,2026-11-19T08:00:00+08:00,2026-11-19T08:30:00+08:00,,,,,,,"
                      "synthetic: test,Supplier bank shows usable credit\n")
        r = ev(load(text), "retro")
        for slot in ("friday", "monday"):
            c = next(x for x in opt(r, slot)["checks"] if x["name"].startswith(("Observed", "Simulated")))
            self.assertEqual(c["state"], "fail")
            self.assertIn("observed late", c["detail"])
        self.assertFalse(r["comparison"]["available"])

    def test_on_time_observed_credit_ok(self):
        text = REF + ("BC-1,beneficiary_credit,,2026-11-18T22:10:00+08:00,2026-11-18T22:30:00+08:00,,,,,,,"
                      "synthetic: test,Supplier bank shows usable credit\n")
        r = ev(load(text), "retro")
        c = next(x for x in opt(r, "friday")["checks"] if x["name"].startswith("Observed"))
        self.assertEqual(c["state"], "ok")
        self.assertIn("BC-1", c["record_ids"])


class M4OldSnapshotIsStale(unittest.TestCase):
    def test_old_snapshot_unknown(self):
        text = sub(REF, "CASH-FRI,cash_snapshot,,2026-11-13T09:00:00+08:00",
                   "CASH-FRI,cash_snapshot,,2026-10-01T09:00:00+08:00")
        r = ev(load(text), "friday")
        c = check(opt(r, "friday"), "Cash")
        self.assertEqual(c["state"], "unknown")
        self.assertIn("stale", c["detail"])
        self.assertEqual(r["decision"]["state"], "NO_DECISION")

    def test_monday_snapshots_in_fixtures(self):
        ids = {e.record_id: e for e in SC["reference"]["events"]}
        self.assertEqual(ids["CASH-MON"].amount, Decimal("200000.00"))
        self.assertEqual(ids["CASH-MON"].known_at.isoformat(), "2026-11-16T09:00:00+08:00")
        d = {e.record_id: e for e in SC["delayed_receivable"]["events"]}
        self.assertEqual(d["CASH-MON"].amount, Decimal("180000.00"))
        m = check(opt(ev(SC["reference"]["events"], "monday"), "monday"), "Cash")
        self.assertIn("CASH-MON", m["record_ids"])


class MinorFixes(unittest.TestCase):
    def test_obligation_must_be_positive(self):
        text = sub(REF, ",,100000.00,USD,,,,synthetic", ",,0,USD,,,,synthetic")
        events, errors = replay.load_events(text)
        self.assertEqual((errors[0]["row"], errors[0]["column"]), (2, "amount"))

    def test_delivery_check_renamed(self):
        f = opt(ev(SC["reference"]["events"], "friday"), "friday")
        self.assertTrue(any(c["name"] == "Simulated delivery bound (not observed)" for c in f["checks"]))

    def test_retro_headlines(self):
        self.assertEqual(ev(SC["reference"]["events"], "retro")["decision"]["headline"],
                         "In hindsight, Monday tied up cash for fewer days — waiting was not supported on "
                         "Friday")
        self.assertEqual(ev(SC["closed_day"]["events"], "retro")["decision"]["headline"],
                         "Hindsight comparison withheld")

    def test_risk_note(self):
        for sid in ("reference", "preagreed"):
            self.assertEqual(ev(SC[sid]["events"], "retro")["comparison"]["risk_note"],
                             "A missed deadline can swamp either figure.")
        self.assertEqual(ev(SC["preagreed"]["events"], "friday")["comparison"]["risk_note"],
                         "A missed deadline can swamp either figure.")


if __name__ == "__main__":
    unittest.main()
