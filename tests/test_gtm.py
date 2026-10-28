import unittest
from datetime import date

from gtm import autonomy, guard, merge, score
from gtm.model import Settings, domain_of

TODAY = date(2026, 11, 2)


def lead(i, email, **kw):
    base = {"id": i, "tier": "2", "email": email, "domain": domain_of(email), "email_label": "VERIFIED-PUBLIC",
            "channel": "email", "country": "Singapore", "first_line_source": "https://example.com/news",
            "company": f"Co {i}", "stage": "Approved"}
    base.update(kw)
    return base


def sent(email, step="D0", d="2026-10-28", status="sent", thread="t1", approved="yes"):
    return {"email": email, "domain": domain_of(email), "step": step, "date": d, "status": status,
            "thread_id": thread, "approved": approved}


class GuardTests(unittest.TestCase):
    def run_guard(self, cands, leads, touches=(), dnc=(), **s):
        return guard.check(cands, list(leads), list(touches), list(dnc), Settings(**s), TODAY)

    def test_clean_first_email_allowed_but_needs_approval_at_level1(self):
        v = self.run_guard([{"lead_id": "A", "step": "D0"}], [lead("A", "jo@acme.io")])[0]
        self.assertTrue(v.allow, v.reasons)
        self.assertTrue(v.needs_approval)

    def test_pause_blocks_everything(self):
        v = self.run_guard([{"lead_id": "A", "step": "D0"}], [lead("A", "jo@acme.io")], pause=True)[0]
        self.assertFalse(v.allow)
        self.assertIn("PAUSE is on", v.reasons)

    def test_no_source_no_send(self):
        v = self.run_guard([{"lead_id": "A", "step": "D0"}], [lead("A", "jo@acme.io", first_line_source="")])[0]
        self.assertFalse(v.allow)

    def test_dnc_email_and_domain(self):
        l = [lead("A", "jo@acme.io"), lead("B", "al@beta.io")]
        vs = self.run_guard([{"lead_id": "A"}, {"lead_id": "B"}], l, dnc=[{"value": "jo@acme.io"}, {"value": "beta.io"}])
        self.assertFalse(vs[0].allow)
        self.assertFalse(vs[1].allow)

    def test_daily_cap(self):
        leads = [lead(str(i), f"p@c{i}.io") for i in range(8)]
        vs = self.run_guard([{"lead_id": str(i)} for i in range(8)], leads, current_send_cap=5)
        self.assertEqual(sum(v.allow for v in vs), 5)
        self.assertIn("daily cap", vs[-1].reasons[0])

    def test_cap_counts_todays_sends(self):
        touches = [sent(f"x@d{i}.io", d="2026-11-02") for i in range(5)]
        v = self.run_guard([{"lead_id": "A"}], [lead("A", "jo@acme.io")], touches, current_send_cap=5)[0]
        self.assertFalse(v.allow)

    def test_same_company_same_week(self):
        touches = [sent("boss@acme.io", d="2026-10-30")]
        v = self.run_guard([{"lead_id": "A"}], [lead("A", "jo@acme.io")], touches)[0]
        self.assertFalse(v.allow)
        two = self.run_guard([{"lead_id": "A"}, {"lead_id": "B"}], [lead("A", "jo@acme.io"), lead("B", "al@acme.io")])
        self.assertTrue(two[0].allow)
        self.assertFalse(two[1].allow)

    def test_strict_country_support_inbox_pattern_and_us_address(self):
        cases = [lead("A", "jo@acme.de", country="Germany"), lead("B", "support@b.io"),
                 lead("C", "jo@c.io", email_label="PATTERN-UNVERIFIED"), lead("D", "jo@d.com", country="United States")]
        vs = self.run_guard([{"lead_id": x} for x in "ABCD"], cases)
        self.assertTrue(all(not v.allow for v in vs), [v.reasons for v in vs])
        ok = self.run_guard([{"lead_id": "D"}], [cases[3]], postal_address="10 Example St")[0]
        self.assertTrue(ok.allow, ok.reasons)

    def test_followup_rules(self):
        l = [lead("A", "jo@acme.io")]
        early = self.run_guard([{"lead_id": "A", "step": "D4"}], l, [sent("jo@acme.io", d="2026-10-31")])[0]
        self.assertFalse(early.allow)
        due = self.run_guard([{"lead_id": "A", "step": "D4"}], l, [sent("jo@acme.io", d="2026-10-29")])[0]
        self.assertTrue(due.allow, due.reasons)
        self.assertFalse(due.needs_approval)
        replied = self.run_guard([{"lead_id": "A", "step": "D4"}], l,
                                 [sent("jo@acme.io", d="2026-10-29"), sent("jo@acme.io", step="REPLY", status="replied")])[0]
        self.assertFalse(replied.allow)
        unapproved = self.run_guard([{"lead_id": "A", "step": "D4"}], l, [sent("jo@acme.io", d="2026-10-29", approved="")])[0]
        self.assertFalse(unapproved.allow)
        no_thread = self.run_guard([{"lead_id": "A", "step": "D4"}], l, [sent("jo@acme.io", d="2026-10-29", thread="")])[0]
        self.assertFalse(no_thread.allow)

    def test_level2_tier1_still_needs_approval(self):
        l = [lead("A", "jo@acme.io", tier="1"), lead("B", "al@beta.io", tier="2")]
        vs = self.run_guard([{"lead_id": "A"}, {"lead_id": "B"}], l, autonomy_level=2)
        self.assertTrue(vs[0].needs_approval)
        self.assertFalse(vs[1].needs_approval)


class AutonomyTests(unittest.TestCase):
    def touches(self, n, bounced=0, replied=0):
        # dates increase with i, so replies placed on the last indices fall inside "the last 50 sends"
        t = [sent(f"p{i}@c{i}.io", d=f"2026-{9 + i // 28:02d}-{1 + i % 28:02d}") for i in range(n)]
        t += [sent(f"p{i}@c{i}.io", step="X", status="bounced") for i in range(bounced)]
        t += [sent(f"p{i}@c{i}.io", step="X", status="replied") for i in range(n - replied, n)]
        return t

    def spot(self, n, errors=0):
        return [{"factual_error": "yes" if i < errors else "no"} for i in range(n)]

    def test_level1_until_50(self):
        s = autonomy.stats_from(self.touches(49), self.spot(10))
        self.assertEqual(autonomy.earned_level(s), 1)

    def test_level2_after_50_clean(self):
        s = autonomy.stats_from(self.touches(50, replied=1), self.spot(10))
        self.assertEqual(autonomy.earned_level(s), 2)

    def test_level3_needs_reply_rate(self):
        s = autonomy.stats_from(self.touches(150, replied=3), self.spot(10))
        self.assertEqual(autonomy.earned_level(s), 2)
        s = autonomy.stats_from(self.touches(150, replied=5), self.spot(10))
        self.assertEqual(autonomy.earned_level(s), 3)

    def test_downgrades(self):
        s = autonomy.stats_from(self.touches(100, bounced=4, replied=5), self.spot(10))
        self.assertEqual(autonomy.earned_level(s), 1)
        self.assertTrue(any("bounce" in r for r in autonomy.downgrade_reasons(s)))
        s = autonomy.stats_from(self.touches(100, replied=5), self.spot(10, errors=1))
        self.assertEqual(autonomy.earned_level(s), 1)

    def test_settings_is_ceiling(self):
        s = autonomy.stats_from(self.touches(150, replied=10), self.spot(10))
        self.assertEqual(autonomy.effective_level(1, s)[0], 1)
        self.assertEqual(autonomy.effective_level(3, s)[0], 3)


class ScoreMergeTests(unittest.TestCase):
    def test_score_ranges_and_tiers(self):
        strong = {"buyer_or_vendor": "BUYER", "evidence_url": "https://a", "first_line_source": "https://b",
                  "email": "maya@acme.io", "email_label": "VERIFIED-PUBLIC"}
        weak = {"buyer_or_vendor": "VENDOR", "check_before_sending": "large listed company: low reply odds"}
        self.assertGreaterEqual(score.score(strong), 70)
        self.assertEqual(score.tier(score.score(strong)), "1")
        self.assertLess(score.score(weak), 50)

    def test_merge_dedupes_by_email_and_domain(self):
        existing = [{"company": "Acme", "website": "https://www.acme.io", "email": "jo@acme.io"}]
        incoming = [{"company": "Acme Ltd", "website": "acme.io/about"},
                    {"company": "Beta", "email": "al@beta.io", "priority": "3"},
                    {"company": "Beta Two", "email": "cy@beta.io", "priority": "5"}]
        fresh, dropped = merge.merge_new(existing, incoming)
        self.assertEqual(len(fresh), 1)
        self.assertEqual(fresh[0]["company"], "Beta Two")
        self.assertEqual(len(dropped), 2)


if __name__ == "__main__":
    unittest.main()
