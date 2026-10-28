import unittest
from datetime import date, timedelta

from gtm import guard, volume
from gtm.model import Settings, domain_of

START = date(2026, 11, 2)  # a Monday


def dom_settings(**kw):
    base = dict(send_mode="domain", inboxes=("a@getclearline.com", "b@getclearline.com", "c@getclearline.com"),
                per_inbox_cap=20, ramp_start=START.isoformat(), domain_ready=True, unsubscribe_ready=True,
                placement_ok=True, daily_cap=50)
    base.update(kw)
    return Settings(**base)


def sent(email, d, step="D0", status="sent", inbox="a@getclearline.com", thread="t"):
    return {"email": email, "domain": domain_of(email), "date": d.isoformat(), "step": step, "status": status,
            "inbox": inbox, "thread_id": thread, "approved": "yes", "channel": "email"}


def lead(i, email, **kw):
    b = {"id": i, "tier": "2", "email": email, "domain": domain_of(email), "email_label": "VERIFIED-PUBLIC",
         "channel": "email", "country": "Singapore", "first_line_source": "https://x.io/a", "company": i}
    b.update(kw)
    return b


class RampTests(unittest.TestCase):
    def test_personal_mode_is_simple_cap(self):
        v = volume.daily_cap(Settings(current_send_cap=5), [], START)
        self.assertEqual(v.cap, 5)

    def test_domain_not_ready_sends_nothing(self):
        for kw in ({"domain_ready": False}, {"unsubscribe_ready": False}, {"inboxes": ()}, {"ramp_start": ""}):
            self.assertEqual(volume.daily_cap(dom_settings(**kw), [], START).cap, 0, kw)

    def test_ramp_weeks(self):
        s = dom_settings()
        caps = [volume.daily_cap(s, [], START + timedelta(days=7 * w)).cap for w in range(5)]
        self.assertEqual(caps, [0, 20, 35, 50, 50])

    def test_step_held_without_placement_or_with_bounces(self):
        s = dom_settings(placement_ok=False)
        self.assertEqual(volume.daily_cap(s, [], START + timedelta(days=14)).cap, 20)
        touches = [sent(f"p{i}@c{i}.io", START + timedelta(days=8)) for i in range(40)]
        touches += [sent("p0@c0.io", START + timedelta(days=9), step="X", status="bounced")]
        self.assertEqual(volume.daily_cap(dom_settings(), touches, START + timedelta(days=14)).cap, 20)

    def test_inbox_limit(self):
        s = dom_settings(inboxes=("a@getclearline.com", "b@getclearline.com"))
        self.assertEqual(volume.daily_cap(s, [], START + timedelta(days=21)).cap, 40)

    def test_auto_throttle_on_low_reply_rate(self):
        day = START + timedelta(days=30)
        touches = [sent(f"p{i}@c{i}.io", START + timedelta(days=8 + i % 20)) for i in range(100)]
        v = volume.daily_cap(dom_settings(), touches, day)
        self.assertEqual(v.cap, 20)
        self.assertTrue(v.throttled)
        self.assertTrue(any("AUTO-THROTTLE" in a for a in v.alerts))

    def test_bulk_line_warns_and_blocks(self):
        day = START + timedelta(days=40)
        touches = [sent(f"p{i}@c{i}.io", day - timedelta(days=1 + i % 25), step="D4") for i in range(995)]
        v = volume.daily_cap(dom_settings(), touches, day)
        self.assertTrue(any("30-day" in a for a in v.alerts))
        leads = [lead(f"L{i}", f"x@n{i}.io") for i in range(10)]
        vs = guard.check([{"lead_id": f"L{i}"} for i in range(10)], leads, touches, [], dom_settings(), day)
        self.assertEqual(sum(x.allow for x in vs), 5)
        self.assertIn("30-day line", vs[-1].reasons[-1])
        ok = guard.check([{"lead_id": "L0"}], leads, touches, [], dom_settings(bulk_confirmed=True), day)[0]
        self.assertTrue(ok.allow, ok.reasons)


class GuardVolumeTests(unittest.TestCase):
    def test_followups_first_then_firsts_and_rotation(self):
        day = START + timedelta(days=7)  # week 2 -> 20/day
        old = START + timedelta(days=1)
        touches = [sent(f"f{i}@old{i}.io", old, inbox="b@getclearline.com", thread=f"t{i}") for i in range(5)]
        leads = [lead(f"F{i}", f"f{i}@old{i}.io") for i in range(5)] + [lead(f"N{i}", f"n{i}@new{i}.io") for i in range(30)]
        cands = [{"lead_id": f"N{i}", "step": "D0"} for i in range(30)] + [{"lead_id": f"F{i}", "step": "D4"} for i in range(5)]
        vs = guard.check(cands, leads, touches, [], dom_settings(), day)
        fu = [v for v in vs if v.step == "D4"]
        self.assertTrue(all(v.allow for v in fu), [v.reasons for v in fu])
        self.assertTrue(all(v.inbox == "b@getclearline.com" for v in fu))
        firsts = [v for v in vs if v.step == "D0" and v.allow]
        self.assertEqual(len(firsts), 15)  # 20 cap - 5 follow-ups
        counts = {}
        for v in firsts:
            counts[v.inbox] = counts.get(v.inbox, 0) + 1
        self.assertEqual(sorted(counts.values()), [2, 6, 7])  # b already carries 5 follow-ups: total load per inbox 6-7

    def test_week1_warmup_sends_nothing(self):
        vs = guard.check([{"lead_id": "A"}], [lead("A", "a@b.io")], [], [], dom_settings(), START)
        self.assertFalse(vs[0].allow)


if __name__ == "__main__":
    unittest.main()
