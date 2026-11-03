"""HTTP server tests (in-process, ephemeral port). Synthetic replay -- no funds move."""

import http.client
import json
import os
import subprocess
import sys
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
REPO_ROOT = os.path.dirname(PROJECT)
sys.path.insert(0, PROJECT)
sys.path.insert(0, os.path.join(PROJECT, "app"))

import server as app_server  # noqa: E402
from engine import replay  # noqa: E402

LABEL = "Synthetic replay — no funds move."


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = app_server.make_server(0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        self.request("POST", "/api/reset", b"{}")

    def request(self, method, path, body=None, headers=None, content_type="application/json"):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = dict(headers or {})
        if body is not None:
            hdrs.setdefault("Content-Type", content_type)
        conn.request(method, path, body=body, headers=hdrs)
        res = conn.getresponse()
        data = res.read()
        conn.close()
        return res, data

    def json(self, method, path, payload=None, raw=None, **kw):
        body = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
        res, data = self.request(method, path, body, **kw)
        return res, json.loads(data.decode("utf-8"))

    def evaluate(self, scenario="reference", time="friday", rate="8"):
        return self.json("POST", "/api/evaluate", {"scenario": scenario, "decision_time": time,
                                                   "funding_rate_pct": rate})

    # ---------------------------------------------------------------- tests
    def test_meta(self):
        res, body = self.json("GET", "/api/meta")
        self.assertEqual(res.status, 200)
        self.assertEqual(body["label"], LABEL)
        self.assertEqual(body["default_rate_pct"], "8")
        self.assertEqual(body["current_dataset"], "sample")
        self.assertEqual([s["id"] for s in body["scenarios"]], list(replay.SCENARIOS))
        self.assertTrue(all(s["synthetic"] for s in body["scenarios"]))
        self.assertEqual([d["id"] for d in body["decision_times"]], ["friday", "monday", "retro"])
        self.assertEqual(body["decision_times"][0]["as_of_sgt"], "Fri 13 Nov 2026, 15:00 SGT")
        self.assertEqual(res.getheader("Cache-Control"), "no-store")
        self.assertTrue(res.getheader("Content-Type").startswith("application/json"))
        self.assertIsNone(res.getheader("Access-Control-Allow-Origin"))

    def test_index_and_static(self):
        res, data = self.request("GET", "/")
        self.assertEqual(res.status, 200)
        self.assertTrue(res.getheader("Content-Type").startswith("text/html"))
        self.assertEqual(res.getheader("Cache-Control"), "no-store")
        self.assertIn(b"<html", data.lower())
        res, _ = self.request("GET", "/static/../server.py")
        self.assertEqual(res.status, 404)
        res, _ = self.request("GET", "/static/%2e%2e/server.py")
        self.assertEqual(res.status, 404)
        res, _ = self.request("GET", "/nope")
        self.assertEqual(res.status, 404)

    def test_evaluate_matches_engine(self):
        res, body = self.evaluate("reference", "retro", "8")
        self.assertEqual(res.status, 200)
        s = replay.SCENARIOS["reference"]
        from decimal import Decimal
        expected = replay.evaluate(s["events"], "retro", Decimal("8"), s)
        self.assertEqual(body, json.loads(json.dumps(expected, ensure_ascii=False)))
        self.assertEqual(body["comparison"]["net_benefit_before_subscription"], "SGD 78.77")
        res, body = self.json("POST", "/api/evaluate", raw=b'{"scenario":"reference","decision_time":"retro",'
                                                            b'"funding_rate_pct":0}')
        self.assertEqual(body["comparison"]["net_benefit_before_subscription"], "SGD −10.00")

    def test_evaluate_friday_has_no_monday_leak(self):
        _, body = self.evaluate("reference", "friday")
        text = json.dumps(body, ensure_ascii=False)
        self.assertEqual(body["decision"]["state"], "KEEP_FRIDAY")
        for forbidden in ("78.77", '"Q-MON"', '"CAP-MON"', "135,382.50"):
            self.assertNotIn(forbidden, text)

    def test_evaluate_bad_inputs(self):
        for payload in ({"scenario": "nope", "decision_time": "friday", "funding_rate_pct": "8"},
                        {"scenario": "reference", "decision_time": "tuesday", "funding_rate_pct": "8"},
                        {"scenario": "reference", "decision_time": "friday", "funding_rate_pct": "-1"},
                        {"scenario": "reference", "decision_time": "friday", "funding_rate_pct": "abc"},
                        {"scenario": "reference", "decision_time": "friday", "funding_rate_pct": "101"}):
            res, body = self.json("POST", "/api/evaluate", payload)
            self.assertEqual(res.status, 400, payload)
            self.assertFalse(body["ok"])
            self.assertEqual(body["label"], LABEL)
        res, body = self.json("POST", "/api/evaluate", raw=b"not json")
        self.assertEqual(res.status, 400)

    def test_import_good_then_bad_keeps_last_good_then_reset(self):
        csv_text = replay.SCENARIOS["delayed_receivable"]["csv"].encode("utf-8")
        res, body = self.json("POST", "/api/import", raw=csv_text, content_type="text/csv")
        self.assertEqual(res.status, 200)
        self.assertEqual(body["ok"], True)
        self.assertEqual(body["scenario"], "imported")
        _, meta = self.json("GET", "/api/meta")
        self.assertEqual(meta["current_dataset"], "imported")
        self.assertIn("imported", [s["id"] for s in meta["scenarios"]])
        _, good = self.evaluate("imported", "monday")
        self.assertEqual(good["decision"]["state"], "INSUFFICIENT_CASH")
        self.assertEqual(good["scenario"]["id"], "imported")

        bad = csv_text.decode().replace("2026-11-13T09:05:00+08:00", "2026-11-13T09:05:00", 1).encode()
        res, body = self.json("POST", "/api/import", raw=bad, content_type="text/csv")
        self.assertEqual(res.status, 400)
        self.assertFalse(body["ok"])
        self.assertTrue(any(e["column"] == "known_at" and isinstance(e["row"], int) and e["row"] > 1
                            for e in body["errors"]))
        _, meta = self.json("GET", "/api/meta")
        self.assertEqual(meta["current_dataset"], "imported")
        _, again = self.evaluate("imported", "monday")
        self.assertEqual(again, good)

        res, body = self.json("POST", "/api/reset", {})
        self.assertEqual(res.status, 200)
        _, meta = self.json("GET", "/api/meta")
        self.assertEqual(meta["current_dataset"], "sample")
        self.assertNotIn("imported", [s["id"] for s in meta["scenarios"]])
        res, _ = self.evaluate("imported", "monday")
        self.assertEqual(res.status, 400)

    def test_import_error_when_nothing_imported_keeps_samples(self):
        res, body = self.json("POST", "/api/import", raw=b"record_id,kind\nA,obligation\n", content_type="text/csv")
        self.assertEqual(res.status, 400)
        self.assertTrue(all(e["row"] == 1 for e in body["errors"]))
        _, meta = self.json("GET", "/api/meta")
        self.assertEqual(meta["current_dataset"], "sample")

    def test_import_conflicting_ids_rejected(self):
        text = replay.SCENARIOS["reference"]["csv"]
        lines = text.strip("\n").split("\n")
        bad = "\n".join(lines + [lines[1].replace("100000.00", "1.00")]) + "\n"
        res, body = self.json("POST", "/api/import", raw=bad.encode(), content_type="text/csv")
        self.assertEqual(res.status, 400)
        self.assertIn("conflicts", body["errors"][0]["message"])

    def test_body_over_1mb_rejected(self):
        big = b"x" * (1024 * 1024 + 1)
        res, body = self.json("POST", "/api/import", raw=big, content_type="text/csv")
        self.assertEqual(res.status, 413)
        self.assertFalse(body["ok"])

    def test_other_methods_rejected(self):
        for method in ("PUT", "DELETE", "PATCH", "OPTIONS"):
            res, _ = self.request(method, "/api/meta")
            self.assertEqual(res.status, 405, method)
        res, _ = self.request("GET", "/api/evaluate")
        self.assertEqual(res.status, 404)
        res, _ = self.request("POST", "/api/meta", b"{}")
        self.assertEqual(res.status, 404)

    def test_foreign_origin_and_host_rejected(self):
        res, _ = self.request("POST", "/api/reset", b"{}", headers={"Origin": "http://evil.example"})
        self.assertEqual(res.status, 403)
        res, _ = self.request("GET", "/api/meta", headers={"Host": "evil.example:%d" % self.port})
        self.assertEqual(res.status, 403)
        res, _ = self.request("POST", "/api/reset", b"{}",
                              headers={"Origin": "http://127.0.0.1:%d" % self.port})
        self.assertEqual(res.status, 200)


class LaunchCommands(unittest.TestCase):
    """Both documented launch commands start the server."""

    def _launch(self, cwd, script):
        proc = subprocess.Popen([sys.executable, script, "--port", "0"], cwd=cwd, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        try:
            port = None
            for _ in range(5):
                line = proc.stdout.readline()
                if "Serving on http://127.0.0.1:" in line:
                    port = int(line.rsplit(":", 1)[1])
                    break
            self.assertIsNotNone(port, proc.stderr.read() if proc.poll() is not None else "no banner")
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
            conn.request("GET", "/api/meta")
            res = conn.getresponse()
            body = json.loads(res.read().decode("utf-8"))
            conn.close()
            self.assertEqual(res.status, 200)
            self.assertEqual(body["label"], LABEL)
        finally:
            proc.terminate()
            proc.wait(timeout=10)
            proc.stdout.close()
            proc.stderr.close()

    def test_from_repo_root(self):
        self._launch(REPO_ROOT, os.path.join("funding-replay", "app", "server.py"))

    def test_from_project_dir(self):
        self._launch(PROJECT, os.path.join("app", "server.py"))


if __name__ == "__main__":
    unittest.main()
