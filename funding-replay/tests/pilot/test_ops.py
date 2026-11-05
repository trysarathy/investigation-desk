"""Tests for pilot.ops backup / restore / health (synthetic data only).

Run from funding-replay/:  python3 -m unittest discover -s tests/pilot -p 'test_ops.py'
"""

import os
import shutil
import sqlite3
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

from pilot import ops  # noqa: E402


def make_db(path, rows=3, wal=True):
    conn = sqlite3.connect(path)
    if wal:
        conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY)")
    conn.executemany("INSERT OR IGNORE INTO schema_migrations VALUES (?)", [("0001",), ("0100",)])
    conn.execute("CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY, importer TEXT)")
    conn.executemany("INSERT INTO cases VALUES (?, ?)",
                     [("CL-2026-%05d" % i, "Synthetic %d" % i) for i in range(1, rows + 1)])
    conn.commit()
    return conn


def case_rows(path):
    c = sqlite3.connect(path)
    try:
        return c.execute("SELECT id, importer FROM cases ORDER BY id").fetchall()
    finally:
        c.close()


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.db = os.path.join(self.dir, "pilot.db")

    def p(self, name):
        return os.path.join(self.dir, name)


class Backup(Base):
    def test_backup_writes_copy_and_manifest(self):
        live = make_db(self.db)  # stays open, WAL not checkpointed
        dest = self.p("backups/b1.db")
        info = ops.backup(self.db, dest)
        live.close()
        self.assertTrue(os.path.isfile(dest))
        self.assertEqual(info["integrity"], "ok")
        self.assertEqual(info["sha256"], ops.sha256_file(dest))
        with open(dest + ".sha256") as fh:
            self.assertEqual(fh.read(), "%s  b1.db\n" % info["sha256"])
        self.assertEqual(case_rows(dest), case_rows(self.db))
        self.assertFalse(os.path.exists(dest + "-wal"))
        self.assertFalse(os.path.exists(dest + ".partial"))

    def test_backup_refuses_overwrite_and_missing_source(self):
        make_db(self.db).close()
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        with self.assertRaises(ops.OpsError):
            ops.backup(self.db, dest)
        with self.assertRaises(ops.OpsError):
            ops.backup(self.p("nope.db"), self.p("x.db"))
        self.assertFalse(os.path.exists(self.p("nope.db")), "must not create an empty database")
        with self.assertRaises(ops.OpsError):
            ops.backup(self.db, self.db)


class Restore(Base):
    def test_round_trip_preserves_rows(self):
        make_db(self.db, rows=5).close()
        before = case_rows(self.db)
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        c = sqlite3.connect(self.db)
        c.execute("DELETE FROM cases WHERE id='CL-2026-00002'")
        c.execute("INSERT INTO cases VALUES ('CL-2026-09999', 'After backup')")
        c.commit()
        c.close()
        info = ops.restore(dest, self.db)
        self.assertEqual(case_rows(self.db), before)
        self.assertTrue(info["previous_saved_as"].startswith(self.db + ".pre-restore-"))
        self.assertIn(("CL-2026-09999", "After backup"), case_rows(info["previous_saved_as"]))
        self.assertEqual(info["sha256"], ops.sha256_file(dest))

    def test_restore_keeps_uncheckpointed_wal_data_in_saved_copy(self):
        live = make_db(self.db)
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        live.execute("INSERT INTO cases VALUES ('CL-2026-08888', 'In WAL only')")
        live.commit()
        live.close()
        info = ops.restore(dest, self.db)
        self.assertIn(("CL-2026-08888", "In WAL only"), case_rows(info["previous_saved_as"]))
        self.assertNotIn(("CL-2026-08888", "In WAL only"), case_rows(self.db))
        self.assertFalse(os.path.exists(self.db + "-wal") and os.path.getsize(self.db + "-wal") > 0)

    def test_refuses_corrupt_file(self):
        make_db(self.db).close()
        before = ops.sha256_file(self.db)
        bad = self.p("corrupt.db")
        with open(bad, "wb") as fh:
            fh.write(b"SQLite format 3\x00" + os.urandom(8192))
        ops._write_manifest(bad, ops.sha256_file(bad))  # checksum matches, contents broken
        with self.assertRaises(ops.RestoreRefused) as cm:
            ops.restore(bad, self.db)
        self.assertIn("integrity", str(cm.exception))
        self.assertEqual(ops.sha256_file(self.db), before)
        self.assertEqual([f for f in os.listdir(self.dir) if "pre-restore" in f], [])

    def test_refuses_damaged_pages(self):
        make_db(self.db, rows=400, wal=False).close()
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        with open(dest, "r+b") as fh:  # scribble over a b-tree page, then re-seal the manifest
            fh.seek(4096 + 10)
            fh.write(b"\xff" * 2000)
        ops._write_manifest(dest, ops.sha256_file(dest))
        with self.assertRaises(ops.RestoreRefused):
            ops.restore(dest, self.db)

    def test_refuses_checksum_mismatch(self):
        make_db(self.db).close()
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        with open(dest + ".sha256", "w") as fh:
            fh.write("0" * 64 + "  b.db\n")
        with self.assertRaises(ops.RestoreRefused) as cm:
            ops.restore(dest, self.db)
        self.assertIn("checksum mismatch", str(cm.exception))

    def test_refuses_missing_manifest_or_file(self):
        make_db(self.db).close()
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        os.remove(dest + ".sha256")
        with self.assertRaises(ops.RestoreRefused):
            ops.restore(dest, self.db)
        ops.restore(dest, self.db, require_manifest=False)  # explicit opt-out still integrity-checks
        with self.assertRaises(ops.RestoreRefused):
            ops.restore(self.p("missing.db"), self.db)
        with self.assertRaises(ops.RestoreRefused):
            ops.restore(self.db, self.db)

    def test_restore_into_empty_location(self):
        make_db(self.db).close()
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        target = self.p("new/pilot.db")
        info = ops.restore(dest, target)
        self.assertIsNone(info["previous_saved_as"])
        self.assertEqual(case_rows(target), case_rows(self.db))

    def test_two_restores_keep_both_previous_files(self):
        make_db(self.db).close()
        dest = self.p("b.db")
        ops.backup(self.db, dest)
        a = ops.restore(dest, self.db)["previous_saved_as"]
        b = ops.restore(dest, self.db)["previous_saved_as"]
        self.assertNotEqual(a, b)
        self.assertTrue(os.path.exists(a) and os.path.exists(b))


class Health(Base):
    def test_health_ok(self):
        conn = make_db(self.db)
        h = ops.health(conn)
        self.assertEqual(h, {"ok": True, "db": "ok", "migrations": 2, "wal": True})
        conn.close()

    def test_health_no_migrations_table(self):
        conn = sqlite3.connect(":memory:")
        h = ops.health(conn)
        self.assertEqual((h["ok"], h["db"], h["migrations"], h["wal"]), (True, "ok", 0, False))

    def test_health_closed_connection(self):
        conn = sqlite3.connect(":memory:")
        conn.close()
        h = ops.health(conn)
        self.assertFalse(h["ok"])
        self.assertTrue(h["db"].startswith("error"))


if __name__ == "__main__":
    unittest.main()
