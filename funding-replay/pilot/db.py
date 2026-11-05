"""SQLite access: connect (WAL, foreign keys, busy timeout), forward-only migrations, BEGIN IMMEDIATE tx, clock."""

import contextlib
import datetime as _dt
import glob
import os
import sqlite3
import threading

MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations")
UTC = _dt.timezone.utc

_clock_lock = threading.Lock()
_clock = None


def parse_iso(text):
    """Parse an ISO-8601 instant ('2026-11-18T15:00:00Z' or with offset) into an aware UTC datetime."""
    if isinstance(text, _dt.datetime):
        dt = text
    else:
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Time is required in ISO-8601 form, e.g. 2026-11-18T15:00:00Z.")
        s = text.strip()
        if s.endswith("Z") or s.endswith("z"):
            s = s[:-1] + "+00:00"
        dt = _dt.datetime.fromisoformat(s)
    if dt.tzinfo is None:
        raise ValueError("Time %r has no zone; give UTC with a trailing Z." % (text,))
    return dt.astimezone(UTC).replace(microsecond=0)


def iso(dt):
    return parse_iso(dt).strftime("%Y-%m-%dT%H:%M:%SZ")


def set_clock(value):
    """Pin the clock (datetime or ISO string); None restores PILOT_CLOCK / real time."""
    global _clock
    with _clock_lock:
        _clock = None if value is None else parse_iso(value)


def now():
    with _clock_lock:
        c = _clock
    if c is not None:
        return c
    env = os.environ.get("PILOT_CLOCK")
    if env:
        return parse_iso(env)
    return _dt.datetime.now(UTC).replace(microsecond=0)


def now_iso():
    return iso(now())


def db_path(path=None):
    p = path or os.environ.get("PILOT_DB")
    if not p:
        raise RuntimeError("Set PILOT_DB (or pass --db) to the SQLite file path.")
    return p


def connect(path=None, timeout=15.0):
    conn = sqlite3.connect(db_path(path), timeout=timeout, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=%d" % int(timeout * 1000))
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


@contextlib.contextmanager
def tx(conn):
    """One write transaction taken with BEGIN IMMEDIATE (the write lock is held from the start)."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def _statements(sql):
    buf = []
    for line in sql.splitlines(True):
        buf.append(line)
        joined = "".join(buf)
        if sqlite3.complete_statement(joined):
            if joined.strip():
                yield joined
            buf = []
    rest = "".join(buf).strip()
    if rest and not all(l.strip().startswith("--") or not l.strip() for l in rest.splitlines()):
        raise ValueError("Incomplete SQL statement at end of migration")


def migration_files(directory=None):
    out = []
    for p in sorted(glob.glob(os.path.join(directory or MIGRATIONS_DIR, "*.sql"))):
        name = os.path.basename(p)
        if name[:4].isdigit():
            out.append((name[:-4], p))
    return out


def applied_migrations(conn):
    try:
        return [r[0] for r in conn.execute("SELECT version FROM schema_migrations ORDER BY version")]
    except sqlite3.OperationalError:
        return []


def migrate(conn, directory=None):
    """Apply pending migrations in order, each in its own BEGIN IMMEDIATE transaction. Returns versions applied."""
    conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
    done = []
    for version, path in migration_files(directory):
        with open(path, encoding="utf-8") as fh:
            sql = fh.read()
        with tx(conn):
            if conn.execute("SELECT 1 FROM schema_migrations WHERE version=?", (version,)).fetchone():
                continue
            for stmt in _statements(sql):
                conn.execute(stmt)
            conn.execute("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)", (version, now_iso()))
        done.append(version)
    return done


def one(conn, sql, args=()):
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r is not None else None


def all_rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args).fetchall()]
