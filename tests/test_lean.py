import unittest
from datetime import date, datetime, timezone

from gtm import guard, lean
from gtm.model import Settings, domain_of

START = date(2026, 10, 29)  # Thursday: first lean sending day


def lean_settings(**kw):
    base = dict(lean_start=START.isoformat(), current_send_cap=20, first_email_cap=10)
    base.update(kw)
    return Settings(**base)


def lead(i, email, country="Singapore", **kw):
    b = {"id": i, "tier": "1", "email": email, "domain": domain_of(email), "email_label": "VERIFIED-PUBLIC",
         "channel": "email", "country": country, "first_line_source": "https://x.io/a", "company": i}
    b.update(kw)
    return b


def queued(i, day=START, created=date(2026, 10, 28), **kw):
    c = {"lead_id": i, "step": "D0", "queue_date": day.isoformat(), "queued_at": created.isoformat(), "status": "queued"}
    c.update(kw)
    return c


def sent(email, d, step="D0", status="sent", approved="auto-nohold"):
    return {"email": email, "domain": domain_of(email), "date": d.isoformat(), "step": step, "status": status,
            "thread_id": "t-" + email, "approved": approved, "channel": "email"}


class LeanTests(unittest.TestCase):
    def test_week1_needs_evening_queue_and_respects_hold(self):
        l = [lead("A", "a@a.io")]
        ok = guard.check([queued("A")], l, [], [], lean_settings(), START)[0]
        self.assertTrue(ok.allow, ok.reasons)
        self.assertFalse(ok.needs_approval)
        not_queued = guard.check([{"lead_id": "A", "step": "D0"}], l, [], [], lean_settings(), START)[0]
        self.assertFalse(not_queued.allow)
        same_day = guard.check([queued("A", created=START)], l, [], [], lean_settings(), START)[0]
        self.assertFalse(same_day.allow)
        held = guard.check([queued("A")], l, [], [], lean_settings(hold_dates=(START.isoformat(),)), START)[0]
        self.assertFalse(held.allow)
        self.assertIn("HOLD", held.reasons[0])

    def test_week2_direct_only_after_spot_check(self):
        day = date(2026, 11, 5)
        l = [lead("A", "a@a.io")]
        direct = {"lead_id": "A", "step": "D0"}
        self.assertFalse(guard.check([direct], l, [], [], lean_settings(), day)[0].allow)
        self.assertTrue(guard.check([direct], l, [], [], lean_settings(week1_spotcheck_passed=True), day)[0].allow)

    def test_first_email_cap_10_inside_total_20(self):
        leads = [lead(f"N{i}", f"n{i}@n{i}.io") for i in range(15)]
        leads += [lead(f"F{i}", f"f{i}@f{i}.io") for i in range(12)]
        touches = [sent(f"f{i}@f{i}.io", date(2026, 10, 25)) for i in range(12)]
        cands = [queued(f"N{i}") for i in range(15)] + [{"lead_id": f"F{i}", "step": "D4"} for i in range(12)]
        vs = guard.check(cands, leads, touches, [], lean_settings(), START)
        fu = sum(v.allow for v in vs if v.step == "D4")
        d0 = sum(v.allow for v in vs if v.step == "D0")
        self.assertEqual(fu, 12)
        self.assertEqual(d0, 8)  # 20 total - 12 follow-ups
        self.assertEqual(fu + d0, 20)

    def test_replies_go_first_and_count(self):
        leads = [lead(f"N{i}", f"n{i}@n{i}.io") for i in range(10)] + [lead("R", "r@r.io")]
        cands = [{"lead_id": "R", "step": "REPLY", "thread_id": "t1"}] + [queued(f"N{i}") for i in range(10)]
        vs = guard.check(cands, leads, [], [], lean_settings(current_send_cap=5), START)
        self.assertTrue(vs[0].allow)
        self.assertEqual(sum(v.allow for v in vs[1:]), 4)

    def test_send_window_by_recipient_time_zone(self):
        l = [lead("A", "a@a.io", country="United Kingdom"), lead("B", "b@b.io", country="Singapore")]
        now = datetime(2026, 10, 29, 3, 0, tzinfo=timezone.utc)  # 11:00 in Singapore, 03:00 in London
        vs = guard.check([queued("A"), queued("B")], l, [], [], lean_settings(), START, now)
        self.assertFalse(vs[0].allow)
        self.assertTrue(vs[1].allow, vs[1].reasons)
        self.assertTrue(lean.in_send_window("United Kingdom", datetime(2026, 10, 29, 10, 0, tzinfo=timezone.utc)))
        self.assertFalse(lean.in_send_window("Singapore", datetime(2026, 10, 31, 3, 0, tzinfo=timezone.utc)))  # Saturday

    def test_domain_live_stops_gmail_cold_but_not_replies(self):
        s = lean_settings(send_mode="domain", domain_ready=True)
        l = [lead("A", "a@a.io"), lead("R", "r@r.io")]
        vs = guard.check([{"lead_id": "A", "step": "D0", "via": "gmail"},
                          {"lead_id": "R", "step": "REPLY", "thread_id": "t", "via": "gmail"}], l, [], [], s, START)
        self.assertFalse(vs[0].allow)
        self.assertIn("personal Gmail", " ".join(vs[0].reasons))
        self.assertTrue(vs[1].allow, vs[1].reasons)

    def test_template_has_only_linkedin_link_and_opt_out(self):
        body = lean.first_email("Hi team,", "I read X.", "How do you match payments?", "Thanks.",
                                "https://www.linkedin.com/in/aashmiin-kaur-479665391")
        self.assertEqual(body.count("http"), 1)
        self.assertIn("linkedin.com", body)
        self.assertIn("reply \"no\"", body)


if __name__ == "__main__":
    unittest.main()
