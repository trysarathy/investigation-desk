"""Backup, restore and health for the pilot SQLite database (DATA module; standard library only).

* ``backup(db_path, dest_path)`` — sqlite3 online backup API (safe while the server
  runs, WAL included), ``PRAGMA integrity_check`` on the copy, then writes
  ``dest_path`` and ``dest_path + ".sha256"`` (``sha256sum`` format).
* ``restore(src_path, db_path)`` — refuses if the backup fails ``integrity_check`` or
  its checksum does not match the manifest; checkpoints the current database, moves it
  (and any ``-wal``/``-shm``) aside as ``db_path + ".pre-restore-<UTC timestamp>"``,
  then copies the backup in.  Stop the server before restoring.
* ``health(conn)`` — ``{ok, db: 'ok' | error text, migrations: count, wal: bool}``.

See docs/pilot/RECOVERY.md.
"""

import hashlib
import os
import shutil
import sqlite3
from datetime import datetime, timezone

__all__ = ["OpsError", "RestoreRefused", "backup", "restore", "health", "sha256_file", "integrity_check"]


class OpsError(Exception):
    """Backup could not be made (message says what to do)."""


class RestoreRefused(OpsError):
    """Restore refused; the current database was not touched."""


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def integrity_check(path):
    """Return 'ok' or the problem text. Opens read-only; never creates a file."""
    if not os.path.isfile(path):
        return "file not found"
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % _uri_path(path), uri=True)
        try:
            rows = conn.execute("PRAGMA integrity_check").fetchall()
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        return "not a readable SQLite database (%s)" % exc
    result = "; ".join(str(r[0]) for r in rows)
    return "ok" if result == "ok" else result


def _uri_path(path):
    from urllib.parse import quote
    return quote(os.path.abspath(path))


def _manifest_path(path):
    return path + ".sha256"


def _write_manifest(path, digest):
    tmp = _manifest_path(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("%s  %s\n" % (digest, os.path.basename(path)))
    os.replace(tmp, _manifest_path(path))


def _read_manifest(path):
    mp = _manifest_path(path)
    if not os.path.isfile(mp):
        return None
    with open(mp, encoding="utf-8") as fh:
        first = fh.read().strip().split()
    return first[0].lower() if first else ""


def backup(db_path, dest_path, *, overwrite=False):
    """Online backup of ``db_path`` to ``dest_path`` plus ``dest_path.sha256``.

    Returns ``{path, manifest, sha256, size, integrity: 'ok', created_at}``.
    """
    if not os.path.isfile(db_path):
        raise OpsError("database %s not found; check PILOT_DB" % db_path)
    if os.path.abspath(db_path) == os.path.abspath(dest_path):
        raise OpsError("backup destination must differ from the live database")
    if os.path.exists(dest_path) and not overwrite:
        raise OpsError("%s already exists; choose a new file name (backups are never overwritten)" % dest_path)
    d = os.path.dirname(os.path.abspath(dest_path))
    os.makedirs(d, exist_ok=True)
    tmp = dest_path + ".partial"
    if os.path.exists(tmp):
        os.remove(tmp)
    src = sqlite3.connect("file:%s?mode=ro" % _uri_path(db_path), uri=True)
    try:
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode=DELETE")  # self-contained single file
            rows = dst.execute("PRAGMA integrity_check").fetchall()
        finally:
            dst.close()
    finally:
        src.close()
    result = "; ".join(str(r[0]) for r in rows)
    if result != "ok":
        os.remove(tmp)
        raise OpsError("backup copy failed integrity_check (%s); the live database may be damaged — "
                       "do not overwrite older backups, see RECOVERY.md" % result)
    digest = sha256_file(tmp)
    os.replace(tmp, dest_path)
    _write_manifest(dest_path, digest)
    return {
        "path": dest_path, "manifest": _manifest_path(dest_path), "sha256": digest,
        "size": os.path.getsize(dest_path), "integrity": "ok",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def _stamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def restore(src_path, db_path, *, require_manifest=True):
    """Replace ``db_path`` with the verified backup ``src_path``.

    Returns ``{restored_from, db_path, sha256, previous_saved_as}``; ``previous_saved_as`` is
    None when there was no current database.  Raises ``RestoreRefused`` (nothing changed) on
    a missing file, checksum mismatch or failed integrity check.
    """
    if not os.path.isfile(src_path):
        raise RestoreRefused("backup %s not found" % src_path)
    if os.path.abspath(src_path) == os.path.abspath(db_path):
        raise RestoreRefused("backup and live database are the same file")
    expected = _read_manifest(src_path)
    if expected is None and require_manifest:
        raise RestoreRefused("checksum manifest %s is missing; restore only backups made by `pilot.cli backup`"
                             % _manifest_path(src_path))
    digest = sha256_file(src_path)
    if expected is not None and expected != digest:
        raise RestoreRefused("checksum mismatch for %s (manifest %s…, file %s…); the backup is damaged or was "
                             "changed — use another backup" % (src_path, expected[:12], digest[:12]))
    problem = integrity_check(src_path)
    if problem != "ok":
        raise RestoreRefused("backup %s failed integrity_check: %s" % (src_path, problem))

    target_dir = os.path.dirname(os.path.abspath(db_path))
    os.makedirs(target_dir, exist_ok=True)
    tmp = db_path + ".restore-tmp"
    shutil.copyfile(src_path, tmp)
    if sha256_file(tmp) != digest:
        os.remove(tmp)
        raise RestoreRefused("copy of the backup did not match its checksum; nothing was changed")

    previous = None
    if os.path.exists(db_path):
        # Fold any WAL content into the main file so the saved copy is complete.
        try:
            c = sqlite3.connect(db_path)
            try:
                c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                c.close()
        except sqlite3.DatabaseError:
            pass  # damaged current file: keep it as-is for inspection
        base = db_path + ".pre-restore-" + _stamp()
        previous, n = base, 1
        while os.path.exists(previous):
            n += 1
            previous = "%s-%d" % (base, n)
        os.replace(db_path, previous)
        for suffix in ("-wal", "-shm", "-journal"):
            if os.path.exists(db_path + suffix):
                os.replace(db_path + suffix, previous + suffix)
    else:
        for suffix in ("-wal", "-shm", "-journal"):
            if os.path.exists(db_path + suffix):  # stray sidecar would corrupt the restored file
                os.replace(db_path + suffix, db_path + suffix + ".orphan-" + _stamp())
    os.replace(tmp, db_path)
    return {"restored_from": src_path, "db_path": db_path, "sha256": digest, "previous_saved_as": previous}


def health(conn):
    """Cheap health probe. Never includes secrets or paths."""
    out = {"ok": False, "db": "ok", "migrations": 0, "wal": False}
    try:
        conn.execute("SELECT 1").fetchone()
        mode = conn.execute("PRAGMA journal_mode").fetchone()
        out["wal"] = bool(mode) and str(mode[0]).lower() == "wal"
        has = conn.execute(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'").fetchone()[0]
        if has:
            out["migrations"] = int(conn.execute("SELECT count(*) FROM schema_migrations").fetchone()[0])
        out["ok"] = True
    except sqlite3.Error as exc:
        out["db"] = "error: %s" % type(exc).__name__ + (": %s" % exc if str(exc) else "")
    return out
