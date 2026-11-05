"""Tests for pilot.connector (sandbox only — not a live payment).

Run from funding-replay/:  python3 -m unittest discover -s tests/pilot -p 'test_connector.py'
"""

import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from pilot import connector as C  # noqa: E402

SECRET = "test-secret-not-real"


class Clock:
    def __init__(self, t="2026-11-13T07:00:00Z"):
        self.t = t

    def __call__(self):
        return self.t


def make(scenario="normal", org_id="org-1", conn=None, clock=None):
    conn = conn or sqlite3.connect(":memory:")
    clock = clock or Clock()
    return C.SandboxConnector(conn, SECRET, clock, org_id=org_id, scenario=scenario), conn, clock


class Signing(unittest.TestCase):
    def test_sign_verify(self):
        body = b'{"a":1}'
        sig = C.sign(SECRET, body)
        self.assertEqual(len(sig), 64)
        self.assertTrue(C.verify(SECRET, body, sig))
        self.assertTrue(C.verify(SECRET, body, sig.upper()))

    def test_tampered_body_or_sig_or_secret(self):
        body = C.event_body({"provider_event_id": "x", "kind": "accepted"})
        sig = C.sign(SECRET, body)
        self.assertFalse(C.verify(SECRET, body.replace(b"accepted", b"credited"), sig))
        self.assertFalse(C.verify(SECRET, body, sig[:-1] + ("0" if sig[-1] != "0" else "1")))
        self.assertFalse(C.verify("other-secret", body, sig))
        for bad in (None, "", "zz", 123, "é" * 64, sig[:10]):
            self.assertFalse(C.verify(SECRET, body, bad), bad)

    def test_empty_secret_refused(self):
        with self.assertRaises(C.ConnectorError):
            C.sign("", b"x")
        self.assertFalse(C.verify("", b"x", "00"))
        with self.assertRaises(C.ConnectorError):
            C.SandboxConnector(sqlite3.connect(":memory:"), "")

    def test_constant_time_compare_used(self):
        import inspect
        self.assertIn("compare_digest", inspect.getsource(C.verify))

    def test_parse_event_body(self):
        ev = {"provider_event_id": "e1", "provider_ref": "p", "kind": "credited", "occurred_at": "2026-11-13T07:00:00Z"}
        self.assertEqual(C.parse_event_body(C.event_body(ev))["kind"], "credited")
        for bad in (b"not json", b"[]", C.event_body(dict(ev, kind="paid")), C.event_body({"kind": "accepted"})):
            with self.assertRaises(ValueError):
                C.parse_event_body(bad)


class Submit(unittest.TestCase):
    def test_normal_flow(self):
        sb, conn, clock = make()
        r = sb.submit("PAY-1", 100000, "USD", "Example Supplier (synthetic)")
        self.assertEqual(r["status"], "accepted")
        self.assertTrue(r["provider_ref"].startswith("SBX-"))
        self.assertIn(C.SANDBOX_LABEL, r["detail"])
        self.assertEqual(r["label"], "Sandbox — not a live payment")
        self.assertEqual(r["provenance"], "sandbox_simulation")
        evs = sb.get_status(r["provider_ref"])
        self.assertEqual([e["kind"] for e in evs], ["accepted"])
        e = evs[0]
        self.assertEqual(set(e) >= {"provider_event_id", "provider_ref", "kind", "occurred_at"}, True)
        self.assertEqual(e["occurred_at"], "2026-11-13T07:00:00Z")
        self.assertEqual(e["provenance"], "sandbox_simulation")
        clock.t = "2026-11-13T09:30:00Z"
        new = sb.advance(r["provider_ref"])
        self.assertEqual([(x["kind"], x["occurred_at"]) for x in new], [("credited", "2026-11-13T09:30:00Z")])
        self.assertEqual([e["kind"] for e in sb.get_status(r["provider_ref"])], ["accepted", "credited"])
        with self.assertRaises(C.ConnectorError):
            sb.advance(r["provider_ref"])  # normal has nothing after credited

    def test_idempotent_on_payout_ref(self):
        sb, conn, _ = make()
        a = sb.submit("PAY-1", 100000, "USD", "Ben")
        b = sb.submit("PAY-1", 100000, "USD", "Ben", scenario="fail")
        self.assertEqual(a["provider_ref"], b["provider_ref"])
        self.assertTrue(b["duplicate"])
        self.assertEqual(b["scenario"], "normal")  # resubmission never changes the original
        self.assertEqual(conn.execute("SELECT count(*) FROM sandbox_payouts").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT submit_count FROM sandbox_payouts").fetchone()[0], 2)
        self.assertEqual(len(sb.get_status(a["provider_ref"])), 1)  # no second acceptance emitted

    def test_resubmit_with_different_details_conflicts(self):
        sb, conn, _ = make()
        sb.submit("PAY-1", 100000, "USD", "Ben")
        with self.assertRaises(C.ConnectorConflict):
            sb.submit("PAY-1", 100001, "USD", "Ben")
        self.assertEqual(conn.execute("SELECT count(*) FROM sandbox_payouts").fetchone()[0], 1)

    def test_org_scoping(self):
        conn = sqlite3.connect(":memory:")
        a, _, _ = make(org_id="org-a", conn=conn)
        b, _, _ = make(org_id="org-b", conn=conn)
        ra = a.submit("PAY-1", 100, "SGD", "Ben")
        rb = b.submit("PAY-1", 100, "SGD", "Ben")
        self.assertNotEqual(ra["provider_ref"], rb["provider_ref"])
        self.assertEqual(b.get_status(ra["provider_ref"]), [])
        self.assertIsNone(b.payout(ra["provider_ref"]))
        with self.assertRaises(C.ConnectorError):
            b.advance(ra["provider_ref"])
        self.assertEqual(len(a.pending_events()), 1)
        self.assertEqual(len(b.pending_events()), 1)

    def test_rejected_inputs(self):
        sb, _, _ = make()
        for i, (amt, ccy, ben) in enumerate(((0, "USD", "B"), (-5, "USD", "B"), (10, "XYZ", "B"), (10, "USD", " "),
                                             (1.5, "USD", "B"))):
            r = sb.submit("REJ-%d" % i, amt, ccy, ben)
            self.assertEqual(r["status"], "rejected", (amt, ccy, ben))
            self.assertEqual(sb.get_status(r["provider_ref"]), [])
            with self.assertRaises(C.ConnectorError):
                sb.advance(r["provider_ref"])
        again = sb.submit("REJ-0", 0, "USD", "B")
        self.assertEqual(again["status"], "rejected")

    def test_unknown_scenario(self):
        with self.assertRaises(C.ConnectorError):
            make(scenario="explode")
        sb, _, _ = make()
        with self.assertRaises(C.ConnectorError):
            sb.submit("P", 1, "USD", "B", scenario="explode")

    def test_get_status_unknown(self):
        sb, _, _ = make()
        self.assertEqual(sb.get_status("SBX-NOPE"), [])


class Scenarios(unittest.TestCase):
    def test_timeout_then_accept(self):
        sb, _, _ = make()
        r = sb.submit("PAY-T", 5000, "SGD", "Ben", scenario="timeout_then_accept")
        self.assertEqual(r["status"], "timeout")
        self.assertIn("Do not re-instruct", r["detail"])
        self.assertTrue(r["provider_ref"])
        # querying with the same reference reveals acceptance
        self.assertEqual([e["kind"] for e in sb.get_status(r["provider_ref"])], ["accepted"])
        again = sb.submit("PAY-T", 5000, "SGD", "Ben")
        self.assertEqual((again["status"], again["provider_ref"], again["duplicate"]),
                         ("accepted", r["provider_ref"], True))

    def test_fail(self):
        sb, _, _ = make()
        r = sb.submit("PAY-F", 5000, "SGD", "Ben", scenario="fail")
        self.assertEqual([e["kind"] for e in sb.advance(r["provider_ref"])], ["failed"])
        self.assertEqual(sb.payout(r["provider_ref"])["status"], "failed")
        with self.assertRaises(C.ConnectorError):
            sb.advance(r["provider_ref"], "credited")

    def test_return(self):
        sb, _, _ = make()
        r = sb.submit("PAY-R", 5000, "SGD", "Ben", scenario="return")
        sb.advance(r["provider_ref"])
        sb.advance(r["provider_ref"])
        self.assertEqual([e["kind"] for e in sb.get_status(r["provider_ref"])], ["accepted", "credited", "returned"])

    def test_duplicate_events_replay_ids(self):
        sb, _, _ = make()
        r = sb.submit("PAY-D", 5000, "SGD", "Ben", scenario="duplicate_events")
        sb.advance(r["provider_ref"])
        pend = sb.pending_events()
        self.assertEqual([e["kind"] for e in pend], ["accepted", "accepted", "credited", "credited"])
        self.assertEqual(pend[0]["provider_event_id"], pend[1]["provider_event_id"])
        self.assertEqual(pend[2]["provider_event_id"], pend[3]["provider_event_id"])
        self.assertNotEqual(pend[0]["provider_event_id"], pend[2]["provider_event_id"])
        self.assertEqual(len(sb.get_status(r["provider_ref"])), 2)  # provider view is de-duplicated

    def test_out_of_order_credited_before_accepted(self):
        sb, _, clock = make()
        r = sb.submit("PAY-O", 5000, "SGD", "Ben", scenario="out_of_order")
        self.assertEqual(r["status"], "accepted")
        self.assertEqual(sb.pending_events(), [])
        clock.t = "2026-11-13T10:00:00Z"
        new = sb.advance(r["provider_ref"])
        self.assertEqual([e["kind"] for e in new], ["credited", "accepted"])
        pend = sb.pending_events()
        self.assertEqual([e["kind"] for e in pend], ["credited", "accepted"])
        # acceptance happened earlier even though it is delivered later
        self.assertLess(pend[1]["occurred_at"], pend[0]["occurred_at"])
        self.assertEqual(pend[1]["occurred_at"], "2026-11-13T07:00:00Z")

    def test_explicit_transitions(self):
        sb, _, _ = make()
        r = sb.submit("PAY-X", 5000, "SGD", "Ben")
        with self.assertRaises(C.ConnectorError):
            sb.advance(r["provider_ref"], "returned")
        with self.assertRaises(C.ConnectorError):
            sb.advance(r["provider_ref"], "paid")
        sb.advance(r["provider_ref"], "failed")
        with self.assertRaises(C.ConnectorError):
            sb.advance(r["provider_ref"], "accepted")


class Delivery(unittest.TestCase):
    def receiver(self, status=200):
        """A stand-in for POST /api/connector/sandbox/events: verifies, de-duplicates by provider_event_id."""
        seen, applied, calls = set(), [], []

        def post(path, body, headers):
            calls.append((path, body, headers))
            if not C.verify(SECRET, body, headers.get(C.SIGNATURE_HEADER)):
                return 401
            ev = C.parse_event_body(body)
            if ev["provider_event_id"] in seen:
                return 200  # replay acknowledged, not applied again
            seen.add(ev["provider_event_id"])
            applied.append(ev["kind"])
            return status
        return post, applied, calls

    def test_deliver_signs_and_posts(self):
        sb, _, _ = make()
        r = sb.submit("PAY-1", 5000, "SGD", "Ben")
        post, applied, calls = self.receiver()
        res = sb.deliver_pending(post)
        self.assertEqual([x["ok"] for x in res], [True])
        path, body, headers = calls[0]
        self.assertEqual(path, "/api/connector/sandbox/events")
        self.assertEqual(headers["X-Clearline-Signature"], C.sign(SECRET, body))
        self.assertEqual(json.loads(body)["provider_ref"], r["provider_ref"])
        self.assertEqual(json.loads(body)["label"], C.SANDBOX_LABEL)
        self.assertEqual(sb.pending_events(), [])
        self.assertEqual(sb.deliver_pending(post), [])

    def test_replayed_event_ids_applied_once(self):
        sb, _, _ = make()
        r = sb.submit("PAY-D", 5000, "SGD", "Ben", scenario="duplicate_events")
        sb.advance(r["provider_ref"])
        post, applied, calls = self.receiver()
        sb.deliver_pending(post)
        self.assertEqual(len(calls), 4)
        self.assertEqual(applied, ["accepted", "credited"])
        # replay the same bodies again (e.g. attacker or retry): still applied once
        for path, body, headers in list(calls):
            post(path, body, headers)
        self.assertEqual(applied, ["accepted", "credited"])

    def test_tampered_delivery_rejected(self):
        sb, _, _ = make()
        sb.submit("PAY-1", 5000, "SGD", "Ben")
        post, applied, _ = self.receiver()

        def tamper(path, body, headers):
            return post(path, body.replace(b"accepted", b"credited"), headers)
        res = sb.deliver_pending(tamper)
        self.assertEqual(res[0]["status"], 401)
        self.assertFalse(res[0]["ok"])
        self.assertEqual(applied, [])
        self.assertEqual(len(sb.pending_events()), 1)  # stays pending

    def test_wrong_secret_deliver(self):
        sb, _, _ = make()
        sb.submit("PAY-1", 5000, "SGD", "Ben")
        post, applied, _ = self.receiver()
        res = C.deliver(sb.pending_events(), post, "wrong-secret")
        self.assertEqual(res[0]["status"], 401)
        self.assertEqual(applied, [])

    def test_failed_post_stays_pending(self):
        sb, _, _ = make()
        sb.submit("PAY-1", 5000, "SGD", "Ben")

        def boom(path, body, headers):
            raise ConnectionError("down")
        res = sb.deliver_pending(boom)
        self.assertEqual(res[0]["ok"], False)
        self.assertEqual(res[0]["error"], "ConnectionError")
        self.assertEqual(len(sb.pending_events()), 1)
        post, applied, _ = self.receiver()
        self.assertTrue(sb.deliver_pending(lambda p, b, h: (post(p, b, h), b""))[0]["ok"])

    def test_post_fn_status_shapes(self):
        class Resp:
            status = 204
        ev = [{"provider_event_id": "e", "provider_ref": "p", "kind": "accepted", "occurred_at": "t"}]
        self.assertTrue(C.deliver(ev, lambda *a: Resp(), SECRET)[0]["ok"])
        self.assertFalse(C.deliver(ev, lambda *a: 500, SECRET)[0]["ok"])


class Persistence(unittest.TestCase):
    def test_factory_and_file_persistence_and_migration_file(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "s.db")
        sb = C.SandboxConnector(lambda: sqlite3.connect(path), SECRET, Clock(), org_id="o")
        r = sb.submit("PAY-1", 10, "JPY", "Ben")
        sb2 = C.SandboxConnector(lambda: sqlite3.connect(path), SECRET, Clock(), org_id="o")
        self.assertEqual(sb2.submit("PAY-1", 10, "JPY", "Ben")["provider_ref"], r["provider_ref"])
        conn = sqlite3.connect(path)
        cols = [c[1] for c in conn.execute("PRAGMA table_info(sandbox_payouts)")]
        self.assertIn("org_id", cols)
        self.assertEqual(conn.execute("SELECT count(*) FROM sandbox_payouts").fetchone()[0], 1)
        # migration is re-runnable (forward-only, IF NOT EXISTS)
        with open(os.path.join(ROOT, "pilot", "migrations", "0100_sandbox.sql")) as fh:
            conn.executescript(fh.read())
            fh.seek(0)
            conn.executescript(fh.read())
        self.assertEqual(conn.execute("SELECT count(*) FROM sandbox_payouts").fetchone()[0], 1)

    def test_joins_callers_transaction(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE t(x)")
        sb, _, _ = make(conn=conn)
        sb.payout("warm-up")  # create schema
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("INSERT INTO t VALUES (1)")
        sb.submit("PAY-1", 10, "USD", "Ben")
        self.assertTrue(conn.in_transaction)  # did not commit the caller's work
        conn.rollback()
        self.assertEqual(conn.execute("SELECT count(*) FROM sandbox_payouts").fetchone()[0], 0)
        self.assertEqual(conn.execute("SELECT count(*) FROM t").fetchone()[0], 0)

    def test_concurrent_submits_one_payment(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "c.db")
        C.SandboxConnector(lambda: sqlite3.connect(path), SECRET, Clock(), org_id="o").payout("init")
        refs, errors = [], []

        def worker():
            try:
                sb = C.SandboxConnector(lambda: sqlite3.connect(path, timeout=10), SECRET, Clock(), org_id="o")
                refs.append(sb.submit("PAY-RACE", 10, "USD", "Ben")["provider_ref"])
            except Exception as exc:  # pragma: no cover
                errors.append(exc)
        ts = [threading.Thread(target=worker) for _ in range(8)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        self.assertEqual(errors, [])
        self.assertEqual(len(set(refs)), 1)
        conn = sqlite3.connect(path)
        self.assertEqual(conn.execute("SELECT count(*) FROM sandbox_payouts").fetchone()[0], 1)
        self.assertEqual(conn.execute("SELECT count(*) FROM sandbox_events").fetchone()[0], 1)

    def test_datetime_clock(self):
        from datetime import datetime, timezone, timedelta
        tz = timezone(timedelta(hours=8))
        sb, _, _ = make(clock=lambda: datetime(2026, 11, 13, 15, 0, tzinfo=tz))
        r = sb.submit("P", 1, "USD", "B")
        self.assertEqual(sb.get_status(r["provider_ref"])[0]["occurred_at"], "2026-11-13T07:00:00Z")

    def test_protocol_shape(self):
        sb, _, _ = make()
        for name in ("submit", "get_status"):
            self.assertTrue(callable(getattr(sb, name)))
            self.assertTrue(hasattr(C.PayoutConnector, name))


if __name__ == "__main__":
    unittest.main()
