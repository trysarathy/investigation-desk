"""Atomic capacity at the DB boundary: threads with separate connections and OS processes race approve_and_reserve."""

import multiprocessing
import os
import sqlite3
import threading
import unittest
import uuid


import backend_support  # noqa: F401,E402  (puts the repo root on sys.path)
from pilot import cli, commands, db
from backend_support import Env, T0, kestrel_body
from pilot.commands import CommandError

BIG = "300,000.00"  # two of these exceed the SGD 500,000.00 limit


def _prepare(env, n=2, amount=BIG):
    """Create n cases with a fresh balance and a pending advance request. Returns case ids."""
    op = env.user("operator@harbourline.test")
    ids = []
    conn = env.conn()
    try:
        for _ in range(n):
            st, v = commands.create_case(conn, op, kestrel_body(funding_amount=amount))
            cid = v["id"]
            st, v = commands.execute(conn, op, cid, {
                "type": "add_observation", "idempotency_key": str(uuid.uuid4()), "expected_version": v["version"],
                "kind": "balance", "amount": "20,000.00", "currency": "SGD", "as_of": "2026-12-01T00:30:00Z",
                "source": "Bank portal (synthetic)"})
            st, v = commands.execute(conn, op, cid, {"type": "request_advance", "idempotency_key": str(uuid.uuid4()),
                                                     "expected_version": v["version"], "reason": "race test"})
            ids.append((cid, v["version"]))
    finally:
        conn.close()
    return ids


def _approve(path, email, cid, version):
    conn = db.connect(path)
    try:
        u = db.one(conn, "SELECT id, name, email, role, org_id FROM users WHERE email=?", (email,))
        st, v = commands.execute(conn, u, cid, {"type": "approve_and_reserve", "idempotency_key": str(uuid.uuid4()),
                                                "expected_version": version, "reason": "race"})
        return ("ok", st, None)
    except CommandError as e:
        return ("err", e.status, e.code)
    finally:
        conn.close()


def _proc_worker(path, email, cid, version, start, out):
    os.environ["PILOT_ENV"] = "test"
    os.environ["PILOT_CLOCK"] = T0
    start.wait(10)
    out.put((cid,) + _approve(path, email, cid, version))


def _assert_db_identities(tc, env):
    conn = env.conn()
    try:
        tc.assertEqual(cli.check(conn), [])
        n = conn.execute("SELECT COUNT(*) FROM reservations WHERE status='active'").fetchone()[0]
        total = conn.execute("SELECT IFNULL(SUM(amount_minor),0) FROM reservations WHERE status='active'").fetchone()[0]
    finally:
        conn.close()
    return n, total


class CapacityRaceTest(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def _check_one_winner(self, results):
        oks = [r for r in results if r[1] == "ok"]
        errs = [r for r in results if r[1] == "err"]
        self.assertEqual(len(oks), 1, results)
        self.assertEqual(len(errs), 1, results)
        self.assertEqual(errs[0][2:], (409, "insufficient_capacity"))
        n, total = _assert_db_identities(self, self.env)
        self.assertEqual((n, total), (1, 30000000))

    def test_two_threads_separate_connections(self):
        ids = _prepare(self.env)
        barrier = threading.Barrier(2)
        results = []
        lock = threading.Lock()

        def run(cid, ver):
            barrier.wait(5)
            r = _approve(self.env.path, "reviewer@harbourline.test", cid, ver)
            with lock:
                results.append((cid,) + r)

        ts = [threading.Thread(target=run, args=a) for a in ids]
        for t in ts:
            t.start()
        for t in ts:
            t.join(30)
        self._check_one_winner(results)

    def test_two_os_processes(self):
        ids = _prepare(self.env)
        ctx = multiprocessing.get_context("spawn")
        start, out = ctx.Event(), ctx.Queue()
        procs = [ctx.Process(target=_proc_worker, args=(self.env.path, "reviewer@harbourline.test", cid, ver, start, out))
                 for cid, ver in ids]
        for p in procs:
            p.start()
        start.set()
        results = [out.get(timeout=60) for _ in procs]
        for p in procs:
            p.join(30)
            self.assertEqual(p.exitcode, 0)
        self._check_one_winner(results)

    def test_same_case_double_approve_gives_one_reservation(self):
        (cid, ver), = _prepare(self.env, n=1, amount="50,000.00")
        barrier = threading.Barrier(2)
        results = []

        def run():
            barrier.wait(5)
            results.append(_approve(self.env.path, "reviewer@harbourline.test", cid, ver))

        ts = [threading.Thread(target=run) for _ in range(2)]
        for t in ts:
            t.start()
        for t in ts:
            t.join(30)
        self.assertEqual(sorted(r[0] for r in results), ["err", "ok"], results)
        err = [r for r in results if r[0] == "err"][0]
        self.assertEqual(err[1], 409)
        self.assertIn(err[2], ("stale_version", "not_requested"))
        n, total = _assert_db_identities(self, self.env)
        self.assertEqual((n, total), (1, 5000000))

    def test_database_rejects_second_live_reservation_and_overdraw(self):
        (cid, ver), = _prepare(self.env, n=1, amount="50,000.00")
        self.assertEqual(_approve(self.env.path, "reviewer@harbourline.test", cid, ver)[0], "ok")
        conn = self.env.conn()
        try:
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO reservations(org_id, facility_id, case_id, amount_minor, status, expires_at, "
                             "created_at) VALUES ('ORG-HL','FAC-HL-01',?,100,'active','2026-12-03T00:00:00Z',?)",
                             (cid, T0))
            (cid2, _), = _prepare(self.env, n=1, amount="10.00")
            with self.assertRaises(sqlite3.IntegrityError) as ctx:
                conn.execute("INSERT INTO reservations(org_id, facility_id, case_id, amount_minor, status, expires_at, "
                             "created_at) VALUES ('ORG-HL','FAC-HL-01',?,46000000,'active','2026-12-03T00:00:00Z',?)",
                             (cid2, T0))
            self.assertIn("insufficient_capacity", str(ctx.exception))
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("INSERT INTO draws(org_id, case_id, facility_id, principal_minor, fee_minor, effective_at) "
                             "VALUES ('ORG-HL', ?, 'FAC-HL-01', 5000000, 15000, ?)", (cid, T0))
        finally:
            conn.close()

    def test_capacity_shortfall_names_the_short_pool(self):
        conn = self.env.conn()
        with db.tx(conn):
            conn.execute("UPDATE facilities SET funding_account_start_minor=10000000 WHERE id='FAC-HL-01'")
        conn.close()
        (a, va), (b, vb) = _prepare(self.env, n=2, amount="60,000.00")
        self.assertEqual(_approve(self.env.path, "reviewer@harbourline.test", a, va)[0], "ok")
        r = _approve(self.env.path, "reviewer@harbourline.test", b, vb)
        self.assertEqual(r, ("err", 409, "insufficient_capacity"))
        conn = self.env.conn()
        try:
            v = commands.read_case(conn, self.env.user("reviewer@harbourline.test"), b)
        finally:
            conn.close()
        c = next(x for x in v["routes"] if x["key"] == "C")
        self.assertTrue(c["capacity_ok"])
        self.assertFalse(c["cash_ok"])
        self.assertTrue(any("funding cash" in d for d in c["disqualifiers"]))


if __name__ == "__main__":
    unittest.main()
