"""money, db (migrations, append-only, clock), auth hashing, CLI (migrate/seed/check/serve in a subprocess)."""

import json
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import shutil
import time
import unittest
import urllib.request

import backend_support  # noqa: F401  (puts the repo root on sys.path)
from backend_support import Env
from pilot import auth, cli, db
from pilot import money as M

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class MoneyTest(unittest.TestCase):
    def test_parse_and_format(self):
        self.assertEqual(M.parse("48,250.00", "USD"), M.Money(4825000, "USD"))
        self.assertEqual(M.parse("89450.25", "SGD").minor, 8945025)
        self.assertEqual(M.parse("2850000", "JPY").minor, 2850000)
        self.assertEqual(str(M.Money(4825000, "USD")), "USD 48,250.00")
        self.assertEqual(str(M.Money(-5, "SGD")), "SGD -0.05")
        self.assertEqual(str(M.Money(2850000, "JPY")), "JPY 2,850,000")
        self.assertEqual(M.parse("SGD 1.50", "SGD").minor, 150)

    def test_rejections(self):
        for bad, ccy in ((48250.0, "USD"), ("1e5", "USD"), ("1.001", "USD"), ("1.5", "JPY"), ("-1.00", "SGD"),
                         ("1,00.00", "SGD"), ("", "SGD"), (None, "SGD"), (True, "SGD"), ("1.00", "XYZ"),
                         ("1.00", "sgd"), (" 1 .00", "SGD")):
            with self.assertRaises(M.MoneyError, msg=repr(bad)):
                M.parse(bad, ccy)
        with self.assertRaises(M.MoneyError):
            M.parse("0.00", "SGD", allow_zero=False)
        self.assertEqual(M.parse("-1.00", "SGD", allow_negative=True).minor, -100)

    def test_currency_mismatch(self):
        a, b = M.Money(100, "SGD"), M.Money(100, "USD")
        with self.assertRaises(M.CurrencyMismatch):
            a + b
        with self.assertRaises(M.CurrencyMismatch):
            a < b
        self.assertNotEqual(a, b)
        self.assertEqual((a + M.Money(50, "SGD")).minor, 150)
        with self.assertRaises(M.MoneyError):
            M.Money(1.5, "SGD")


class DbTest(unittest.TestCase):
    def setUp(self):
        self.env = Env()

    def tearDown(self):
        self.env.close()

    def test_pragmas_and_migrations_forward_only(self):
        conn = self.env.conn()
        try:
            self.assertEqual(conn.execute("PRAGMA journal_mode").fetchone()[0], "wal")
            self.assertEqual(conn.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            self.assertGreater(conn.execute("PRAGMA busy_timeout").fetchone()[0], 0)
            applied = db.applied_migrations(conn)
            self.assertIn("0001_init", applied)
            self.assertIn("0100_sandbox", applied)
            self.assertEqual(db.migrate(conn), [])
        finally:
            conn.close()

    def test_events_are_append_only(self):
        conn = self.env.conn()
        try:
            op = self.env.user("operator@harbourline.test")
            from pilot import commands
            st, v = commands.create_case(conn, op, backend_support.kestrel_body())
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("UPDATE events SET type='x' WHERE case_id=?", (v["id"],))
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("DELETE FROM events WHERE case_id=?", (v["id"],))
        finally:
            conn.close()

    def test_clock(self):
        db.set_clock("2026-12-01T09:00:00+08:00")
        self.assertEqual(db.now_iso(), "2026-12-01T01:00:00Z")
        db.set_clock(None)
        os.environ["PILOT_CLOCK"] = "2027-01-02T03:04:05Z"
        try:
            self.assertEqual(db.now_iso(), "2027-01-02T03:04:05Z")
        finally:
            del os.environ["PILOT_CLOCK"]
        with self.assertRaises(ValueError):
            db.parse_iso("2026-12-01T09:00:00")  # no zone

    def test_tx_rolls_back(self):
        conn = self.env.conn()
        try:
            with self.assertRaises(RuntimeError):
                with db.tx(conn):
                    conn.execute("INSERT INTO orgs(id, name, created_at) VALUES ('ORG-X','x','t')")
                    raise RuntimeError("boom")
            self.assertIsNone(db.one(conn, "SELECT id FROM orgs WHERE id='ORG-X'"))
        finally:
            conn.close()

    def test_passwords_and_seed(self):
        h = auth.hash_password("pilot-dev-operator")
        self.assertTrue(h.startswith("scrypt$16384$8$1$"))
        self.assertTrue(auth.verify_password("pilot-dev-operator", h))
        self.assertFalse(auth.verify_password("pilot-dev-operatoR", h))
        conn = self.env.conn()
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0], 0)
            fac = db.one(conn, "SELECT * FROM facilities WHERE id='FAC-HL-01'")
            self.assertEqual((fac["limit_minor"], fac["funding_account_start_minor"], fac["fee_flat_minor"],
                              fac["allocation"], fac["status"], fac["suspension_policy"], fac["policy_version"],
                              fac["balance_max_age_hours"], fac["repayment_days"], fac["reservation_hours"],
                              fac["payout_lead_hours"]),
                             (50000000, 60000000, 15000, "fees_first", "active", "unset", "POL-HL v2026.12-1",
                              24, 3, 72, 8))
            names = {r[0] for r in conn.execute("SELECT name FROM users")}
            self.assertTrue({"Olivia Tan", "Ravi Menon", "Vera Lim"} <= names)
            self.assertEqual(cli.seed(conn), [])  # idempotent
            os.environ["PILOT_ENV"] = "pilot"
            with self.assertRaises(SystemExit):
                cli.seed(conn)
        finally:
            os.environ["PILOT_ENV"] = "test"
            conn.close()


class CliTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="pilot-cli-")
        self.env = dict(os.environ, PILOT_DB=os.path.join(self.dir, "p.db"), PILOT_ENV="dev",
                        PILOT_CLOCK="2026-12-01T01:00:00Z")
        self.env.pop("PILOT_SECRET", None)

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_cli(self, *args, env=None):
        return subprocess.run([sys.executable, "-m", "pilot.cli"] + list(args), cwd=ROOT, env=env or self.env,
                              capture_output=True, text=True, timeout=60)

    def test_migrate_seed_check_serve_and_pilot_guards(self):
        r = self.run_cli("migrate")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("0001_init", r.stdout)
        self.assertEqual(self.run_cli("seed").returncode, 0)
        r = self.run_cli("check")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("check: ok", r.stdout)
        r = self.run_cli("create-org", "--name", "Test Org (Synthetic)", "--id", "ORG-T")
        self.assertEqual(r.stdout.strip(), "ORG-T")
        env = dict(self.env, PILOT_NEW_PASSWORD="a-long-password")
        r = self.run_cli("create-user", "--org", "ORG-T", "--email", "a@t.test", "--name", "A", "--role",
                         "operator", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        proc = subprocess.Popen([sys.executable, "-m", "pilot.cli", "serve", "--port", str(port)], cwd=ROOT,
                                env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            body = None
            for _ in range(100):
                try:
                    body = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=2).read())
                    break
                except OSError:
                    time.sleep(0.1)
            self.assertEqual(body, {"ok": True, "db": "ok", "migrations": 3, "env": "dev"})
        finally:
            proc.terminate()
            _, err = proc.communicate(timeout=10)
        self.assertNotIn(b"Kestrel", err)
        r = self.run_cli("serve", env=dict(self.env, PILOT_ENV="pilot"))
        self.assertEqual(r.returncode, 2)
        self.assertIn("PILOT_SECRET", r.stderr)
        r = self.run_cli("seed", env=dict(self.env, PILOT_ENV="pilot"))
        self.assertNotEqual(r.returncode, 0)
        dest = os.path.join(self.dir, "backup.db")
        r = self.run_cli("backup", dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.path.exists(dest))
        r = self.run_cli("restore", dest)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.run_cli("check").returncode, 0)


if __name__ == "__main__":
    unittest.main()
