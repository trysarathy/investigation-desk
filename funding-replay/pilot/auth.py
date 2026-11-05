"""Users, scrypt password hashes, sessions (hashed tokens, 12 h idle), CSRF tokens, roles, login throttle."""

import datetime as _dt
import hashlib
import hmac
import secrets

from . import db

ROLES = ("operator", "reviewer", "viewer", "admin")
SESSION_IDLE = _dt.timedelta(hours=12)
THROTTLE_WINDOW = _dt.timedelta(minutes=15)
THROTTLE_MAX = 5
_N, _R, _P = 2 ** 14, 8, 1


class AuthError(Exception):
    def __init__(self, status, code, message):
        Exception.__init__(self, message)
        self.status, self.code, self.message = status, code, message


def hash_password(password):
    if not isinstance(password, str) or len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return "scrypt$%d$%d$%d$%s$%s" % (_N, _R, _P, salt.hex(), dk.hex())


def verify_password(password, stored):
    try:
        alg, n, r, p, salt, want = stored.split("$")
        if alg != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p),
                            dklen=len(bytes.fromhex(want)))
        return hmac.compare_digest(dk.hex(), want)
    except (ValueError, TypeError):
        return False


_DUMMY = None


def _dummy_hash():
    global _DUMMY
    if _DUMMY is None:
        _DUMMY = hash_password("dummy-password-for-timing")
    return _DUMMY


def normalize_email(email):
    return (email or "").strip().lower()


def create_org(conn, org_id, name):
    conn.execute("INSERT INTO orgs(id, name, created_at) VALUES (?,?,?)", (org_id, name, db.now_iso()))
    return org_id


def create_user(conn, org_id, email, name, role, password):
    if role not in ROLES:
        raise ValueError("Role must be one of %s." % ", ".join(ROLES))
    if not db.one(conn, "SELECT id FROM orgs WHERE id=?", (org_id,)):
        raise ValueError("Unknown org %s." % org_id)
    email = normalize_email(email)
    if "@" not in email:
        raise ValueError("A valid email is required.")
    cur = conn.execute(
        "INSERT INTO users(org_id, email, name, role, password_hash, created_at) VALUES (?,?,?,?,?,?)",
        (org_id, email, name, role, hash_password(password), db.now_iso()))
    return cur.lastrowid


def _token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def login(conn, email, password):
    """Return (token, csrf, user) or raise AuthError (401 bad credentials, 429 throttled)."""
    email = normalize_email(email)
    now = db.now()
    since = db.iso(now - THROTTLE_WINDOW)
    with db.tx(conn):
        conn.execute("DELETE FROM login_failures WHERE at < ?", (db.iso(now - _dt.timedelta(days=1)),))
        n = conn.execute("SELECT COUNT(*) FROM login_failures WHERE email=? AND at>=?", (email, since)).fetchone()[0]
    if n >= THROTTLE_MAX:
        raise AuthError(429, "login_throttled",
                        "Too many failed sign-in attempts for this email. Wait 15 minutes and try again.")
    user = db.one(conn, "SELECT * FROM users WHERE email=?", (email,))
    ok = verify_password(password or "", user["password_hash"] if user else _dummy_hash())
    if not user or not ok or user["disabled"]:
        with db.tx(conn):
            conn.execute("INSERT INTO login_failures(email, at) VALUES (?,?)", (email, db.iso(now)))
        raise AuthError(401, "bad_credentials", "Email or password is not correct.")
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(24)
    with db.tx(conn):
        conn.execute("DELETE FROM login_failures WHERE email=?", (email,))
        conn.execute("DELETE FROM sessions WHERE last_seen < ?", (db.iso(now - SESSION_IDLE),))
        conn.execute("INSERT INTO sessions(token_hash, user_id, csrf, created_at, last_seen) VALUES (?,?,?,?,?)",
                     (_token_hash(token), user["id"], csrf, db.iso(now), db.iso(now)))
    return token, csrf, public_user(user)


def public_user(u):
    return {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"], "org_id": u["org_id"]}


def session_user(conn, token):
    """Return the session's user dict (with 'csrf') or None if missing/expired/disabled."""
    if not token:
        return None
    th = _token_hash(token)
    row = db.one(conn, "SELECT s.csrf, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id "
                       "WHERE s.token_hash=?", (th,))
    if not row or row["disabled"]:
        return None
    now = db.now()
    last = db.parse_iso(row["last_seen"])
    if now - last > SESSION_IDLE:
        with db.tx(conn):
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (th,))
        return None
    if now - last > _dt.timedelta(seconds=60):
        with db.tx(conn):
            conn.execute("UPDATE sessions SET last_seen=? WHERE token_hash=?", (db.iso(now), th))
    u = public_user(row)
    u["csrf"] = row["csrf"]
    return u


def check_csrf(user, header_value):
    return bool(header_value) and hmac.compare_digest(str(header_value), user["csrf"])


def logout(conn, token):
    if token:
        with db.tx(conn):
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (_token_hash(token),))
