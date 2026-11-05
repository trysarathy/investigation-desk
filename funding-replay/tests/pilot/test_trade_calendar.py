import unittest

from pilot.trade_calendar import preview_calendar

def request():
    return {"bank_place": "Example SG branch", "timezone": "Asia/Singapore",
            "presented_at": "2026-11-05T20:30:00Z", # Singapore Friday Nov 6
            "calendar": {"2026-11-%02d" % d: d not in {7, 8, 10} for d in range(6, 15)},
            "close_times": {"2026-11-14": "13:15"}} # specially open Saturday


class Calendar(unittest.TestCase):
    def test_bank_local_day_real_holiday_and_open_saturday(self):
        plan = preview_calendar(request())
        self.assertEqual(plan["status"], "planned")
        self.assertTrue(plan["presentation_local"].startswith("2026-11-06"))
        self.assertEqual(plan["banking_days"], ["2026-11-09","2026-11-11","2026-11-12","2026-11-13","2026-11-14"])
        self.assertEqual(plan["deadline_utc"], "2026-11-14T05:15:00Z")
        self.assertTrue(plan["simulation"])

    def test_waiver_not_more_time(self):
        a=preview_calendar(request()); b=preview_calendar(dict(request(), waiver_requested=True))
        self.assertEqual(a["deadline_utc"], b["deadline_utc"])
        self.assertFalse(b["waiver_extends_window"])

    def test_gap_or_unknown_close_never_guessed(self):
        q=request(); del q["calendar"]["2026-11-08"]
        result=preview_calendar(q)
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["missing_date"], "2026-11-08")
        self.assertIsNone(result["fifth_banking_date"])
        assert result["deadline_utc"] is None
        q=request(); q["close_times"]={}
        result=preview_calendar(q)
        self.assertEqual(result["fifth_banking_date"], "2026-11-14")
        self.assertEqual(result["status"],"needs_review")
        self.assertIsNone(result["deadline_local"])

    def test_uncommitted_presentation_after_close_or_on_closed_day(self):
        q=request(); q["calendar"]["2026-11-06"]=False
        self.assertIsNone(preview_calendar(q)["deadline_utc"])
        q=request(); q["close_times"]["2026-11-06"]="04:30"
        self.assertIsNone(preview_calendar(q)["deadline_utc"])

    def test_dst_fold_does_not_choose(self):
        q={"bank_place":"Example New York branch","timezone":"America/New_York","presented_at":"2026-10-27T10:00:00-04:00",
           "calendar":{**{"2026-10-%d"%d:True for d in range(27,32)},"2026-11-01":True},"close_times":{"2026-11-01":"01:30"}}
        r=preview_calendar(q)
        self.assertEqual(r["fifth_banking_date"],"2026-11-01")
        self.assertIsNone(r["deadline_utc"])

    def test_invalid_inputs(self):
        for change in ({"timezone":"../../UTC"},{"presented_at":"2026-11-06T16:00"},
                       {"calendar":{"2026-11-06":"yes"}},{"calendar":{"2026-02-30":True}},
                       {"close_times":{"2026-11-07":"17:00"}},{"close_times":{"2026-11-14":"24:00"}},
                       {"waiver_requested":1},{"extra":"ignored?"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                preview_calendar(dict(request(), **change))
