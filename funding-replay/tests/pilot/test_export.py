"""Tests for pilot.export (synthetic data only).

Run from funding-replay/:  python3 -m unittest discover -s tests/pilot -p 'test_export.py'
"""

import csv
import io
import json
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from pilot.export import render_case_history  # noqa: E402

EVIL = "<script>alert('x')</script>"


def case_view():
    return {
        "id": "CL-2026-00001",
        "version": 7,
        "status": "outstanding",
        "header": {
            "importer": "Example Importer " + EVIL, "supplier": "Example Supplier & Co (synthetic)",
            "payout": "USD 1,000.00", "funding": {"display": "SGD 1,350.00", "minor": 135000, "currency": "SGD"},
            "quote_ref": "QT-1", "deadline_local": "Wed 18 Nov 2026 17:00 SGT", "deadline_tz": "Asia/Singapore",
            "deadline_utc": "2026-11-18T09:00:00Z", "owner": "Op One", "reference": "PO-1",
        },
        "decision": {"headline": "Payout accepted; credit not yet evidenced", "tone": "warn",
                     "binding_constraint": "none", "next_action": "Record beneficiary credit", "owner_role": "operator"},
        "supplier_panel": {"status": "accepted", "label": "Provider accepted (not credited)",
                           "last_evidenced": "2026-11-13T08:00:00Z", "provenance": "sandbox_simulation", "attempt": 1},
        "exposure_panel": {"status": "outstanding", "reserved": "SGD 0.00", "principal_outstanding": "SGD 1,350.00",
                           "fees_outstanding": "SGD 25.00", "total_outstanding": "SGD 1,375.00",
                           "due_at_local": "Fri 18 Dec 2026", "owed_by": "Importer", "owed_to": "Provider"},
        "identities": [{"name": "limit = available + reserved + principal_outstanding", "ok": True, "detail": "ok"},
                       {"name": "drawn = repaid + outstanding", "ok": False, "detail": "off by SGD 1.00"}],
        "evidence": [{"id": 3, "filename": "balance.pdf", "content_type": "application/pdf", "size": 1234,
                      "sha256": "ab" * 32, "data": b"%PDF-SECRET-BYTES", "provenance": "external_record"}],
        "session": {"token": "SESSIONTOKEN"},
        "csrf": "CSRFTOKEN",
        "owner_user": {"name": "Op One", "password_hash": "scrypt$SECRETHASH"},
    }


def events():
    return [
        {"id": 11, "seq": 1, "type": "case_created", "payload": json.dumps({"importer": "x"}),
         "effective_at": "2026-11-12T01:00:00Z", "known_at": "2026-11-12T01:00:05Z", "actor_user_id": 1,
         "actor_name": "Op One", "actor_role": "operator", "provenance": "operator_entered", "reason": None},
        {"id": 12, "seq": 2, "type": "observation_added", "payload": {"kind": "balance", "amount": "100.00"},
         "effective_at": "2026-11-12T01:00:00Z", "known_at": "2026-11-12T02:00:00Z", "actor_user_id": 1,
         "actor": {"name": "Op One", "role": "operator"}, "provenance": "operator_entered", "reason": "typo " + EVIL},
        {"id": 13, "seq": 3, "type": "observation_superseded", "payload": {"kind": "balance", "amount": "1000.00",
                                                                        "password_hash": "LEAK"},
         "effective_at": "2026-11-12T01:00:00Z", "known_at": "2026-11-12T03:00:00Z", "actor_user_id": 2,
         "actor_name": "Rev Two", "actor_role": "reviewer", "provenance": "operator_entered",
         "reason": "Wrong amount keyed", "corrects_event_id": 12},
        {"id": 14, "seq": 4, "type": "connector_event", "payload": {"kind": "accepted", "evidence": {"data": b"BYTES"}},
         "effective_at": "2026-11-13T08:00:00Z", "known_at": "2026-11-13T08:00:01Z", "actor_user_id": None,
         "actor_role": "system", "provenance": "sandbox_simulation", "reason": "=HYPERLINK(\"http://x\")"},
    ]


SECRETS = ("SECRETHASH", "SESSIONTOKEN", "CSRFTOKEN", "PDF-SECRET-BYTES", "LEAK", "BYTES\"")


class Common(unittest.TestCase):
    def test_filenames_and_types(self):
        for fmt, ctype in (("json", "application/json"), ("csv", "text/csv"), ("html", "text/html")):
            body, ct, name = render_case_history(case_view(), events(), fmt)
            self.assertIsInstance(body, bytes)
            self.assertTrue(ct.startswith(ctype))
            self.assertEqual(name, "CL-2026-00001-history.%s" % fmt)

    def test_unknown_format(self):
        with self.assertRaises(ValueError):
            render_case_history(case_view(), events(), "xml")

    def test_no_secrets_any_format(self):
        for fmt in ("json", "csv", "html"):
            body = render_case_history(case_view(), events(), fmt)[0].decode("utf-8")
            for s in SECRETS:
                self.assertNotIn(s, body, (fmt, s))
            self.assertNotIn("password_hash", body, fmt)

    def test_filename_sanitised(self):
        cv = case_view()
        cv["id"] = "../../etc/passwd"
        self.assertEqual(render_case_history(cv, [], "csv")[2], "______etc_passwd-history.csv")

    def test_inputs_not_mutated(self):
        cv, evs = case_view(), events()
        render_case_history(cv, evs, "html")
        self.assertEqual(cv["csrf"], "CSRFTOKEN")
        self.assertEqual(evs[0]["seq"], 1)


class Json(unittest.TestCase):
    def test_structure(self):
        doc = json.loads(render_case_history(case_view(), events(), "json")[0])
        self.assertEqual(doc["case_id"], "CL-2026-00001")
        self.assertEqual(len(doc["events"]), 4)
        self.assertEqual(doc["events"][1]["actor_name"], "Op One")
        self.assertEqual(doc["events"][1]["corrected_by_seq"], [3])
        self.assertEqual(doc["events"][2]["corrects_seq"], 2)
        self.assertEqual(doc["events"][0]["payload"], {"importer": "x"})
        self.assertEqual(doc["evidence"][0]["sha256"], "ab" * 32)
        self.assertNotIn("data", doc["evidence"][0])
        self.assertEqual(doc["totals"]["total_outstanding"], "SGD 1,375.00")
        self.assertEqual(len(doc["identities"]), 2)
        self.assertEqual(doc["events"][3]["actor_name"], "System")


class Csv(unittest.TestCase):
    def test_one_row_per_event(self):
        body = render_case_history(case_view(), events(), "csv")[0].decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(body)))
        self.assertEqual(len(rows), 4)
        self.assertEqual([r["seq"] for r in rows], ["1", "2", "3", "4"])
        self.assertEqual(rows[2]["corrects_event_id"], "12")
        self.assertEqual(rows[2]["corrects_seq"], "2")
        self.assertEqual(rows[1]["corrected_by_seq"], "3")
        self.assertEqual(rows[2]["actor_name"], "Rev Two")
        self.assertEqual(rows[2]["actor_role"], "reviewer")
        self.assertEqual(rows[0]["case_id"], "CL-2026-00001")
        self.assertTrue(rows[3]["reason"].startswith("'="), "formula injection guarded")

    def test_events_sorted_by_seq(self):
        evs = list(reversed(events()))
        rows = list(csv.DictReader(io.StringIO(render_case_history(case_view(), evs, "csv")[0].decode())))
        self.assertEqual([r["seq"] for r in rows], ["1", "2", "3", "4"])


class Html(unittest.TestCase):
    def setUp(self):
        self.page = render_case_history(case_view(), events(), "html")[0].decode("utf-8")

    def test_escapes_script(self):
        self.assertNotIn("<script", self.page.lower())
        self.assertIn("&lt;script&gt;", self.page)

    def test_title_and_content(self):
        self.assertIn("<title>CL-2026-00001 — case history</title>", self.page)
        for s in ("Example Supplier &amp; Co (synthetic)", "USD 1,000.00", "SGD 1,350.00", "Provider exposure",
                  "Supplier status", "SGD 1,375.00", "DOES NOT HOLD", "balance.pdf", "ab" * 32, "Rev Two", "reviewer",
                  "Wrong amount keyed", "sandbox_simulation", "Sandbox — not a live payment",
                  "2026-11-12T03:00:00Z", "operator_entered"):
            self.assertIn(s, self.page, s)

    def test_corrections_linked(self):
        self.assertIn('id="ev-12" class="struck"', self.page)
        self.assertIn('Corrects <a href="#ev-12">#2</a>', self.page)
        self.assertIn('Corrected by <a href="#ev-13">#3</a>', self.page)

    def test_every_event_row(self):
        self.assertEqual(len(re.findall(r'<tr id="ev-', self.page)), 4)

    def test_self_contained(self):
        self.assertNotRegex(self.page, r"(?i)<(script|link|img|iframe)\b")
        self.assertNotRegex(self.page, r"(?i)\bon[a-z]+\s*=")
        self.assertNotIn("http://", self.page.replace("&quot;http://x&quot;", ""))
        self.assertIn("default-src 'none'", self.page)

    def test_empty_history(self):
        page = render_case_history({"id": "CL-2026-00002"}, [], "html")[0].decode()
        self.assertIn("No events.", page)


if __name__ == "__main__":
    unittest.main()
