"""HTTP JSON API for the pilot desk + static UI. Cookie sessions, CSRF header, org scoping, security headers."""

import http.cookies
import json
import logging
import mimetypes
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

from . import auth, commands, db
from .commands import CommandError

log = logging.getLogger("pilot.server")

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
JSON_LIMIT = 1024 * 1024
EVIDENCE_LIMIT = 7 * 1024 * 1024 + 64 * 1024  # base64 of 5 MB plus JSON overhead
DRAIN_LIMIT = 16 * 1024 * 1024
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
       "font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
SIG_HEADERS = ("X-Clearline-Signature", "X-Sandbox-Signature")
CASE_RE = re.compile(r"^/api/cases/([A-Za-z0-9-]{1,40})(/.*)?$")
PLACEHOLDER = (b"<!doctype html><html><head><meta charset=\"utf-8\"><title>Clearline pilot desk</title></head>"
               b"<body><p>Clearline pilot desk API is running. The UI files (pilot/static) are not installed.</p>"
               b"</body></html>")


def pilot_env():
    return os.environ.get("PILOT_ENV", "dev")


class PilotServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, db_path, static_dir=STATIC_DIR):
        self.db_path = db_path
        self.static_dir = static_dir
        ThreadingHTTPServer.__init__(self, addr, Handler)


def make_server(db_path, host="127.0.0.1", port=8765, static_dir=STATIC_DIR, migrate=True):
    if migrate:
        conn = db.connect(db_path)
        try:
            db.migrate(conn)
        finally:
            conn.close()
    return PilotServer((host, port), db_path, static_dir)


def serve_in_thread(db_path, host="127.0.0.1", port=0):
    """Start a server on a background thread (tests). Returns (server, thread)."""
    srv = make_server(db_path, host, port)
    t = threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    t.start()
    return srv, t


class Handler(BaseHTTPRequestHandler):
    server_version = "ClearlinePilot"
    sys_version = ""

    # ------------------------------------------------------------ plumbing
    def log_message(self, fmt, *args):  # never log query strings (search terms may contain party names)
        pass

    def log_request(self, code="-", size="-"):
        path = urlsplit(self.path).path
        log.info("%s %s %s", self.command, path, code)

    def _security_headers(self, html=False):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", CSP)
        if pilot_env() == "pilot":
            self.send_header("Strict-Transport-Security", "max-age=31536000")

    def _send(self, status, body, ctype, headers=None, cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self._security_headers()
        for k, v in (headers or {}).items():
            if isinstance(v, list):
                for x in v:
                    self.send_header(k, x)
            else:
                self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, obj, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8", headers)

    def _error(self, status, code, message, field=None, extra=None):
        e = {"code": code, "message": message}
        if field:
            e["field"] = field
        b = {"error": e}
        b.update(extra or {})
        self._json(status, b)

    def _cookie_token(self):
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        try:
            c = http.cookies.SimpleCookie()
            c.load(raw)
        except http.cookies.CookieError:
            return None
        m = c.get("cl_session")
        return m.value if m else None

    def _session_cookie(self, token, clear=False):
        parts = ["cl_session=%s" % ("" if clear else token), "Path=/", "HttpOnly", "SameSite=Strict"]
        parts.append("Max-Age=0" if clear else "Max-Age=43200")
        if pilot_env() == "pilot":
            parts.append("Secure")
        return "; ".join(parts)

    def _read_body(self, limit):
        n = self.headers.get("Content-Length")
        if n is None:
            if self.headers.get("Transfer-Encoding"):
                self.close_connection = True
                raise CommandError(411, "length_required", "Send a Content-Length header (chunked uploads are not accepted).")
            return b""
        try:
            n = int(n)
        except ValueError:
            raise CommandError(400, "bad_request", "Invalid Content-Length.")
        if n < 0:
            raise CommandError(400, "bad_request", "Invalid Content-Length.")
        if n > limit:
            self.close_connection = True
            if n <= DRAIN_LIMIT:
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(65536, left))
                    if not chunk:
                        break
                    left -= len(chunk)
            what = "Evidence uploads are limited to 5 MB per file" if limit == EVIDENCE_LIMIT else \
                ("Requests are limited to 1 MB of JSON" if limit == JSON_LIMIT else "Requests are limited to %d bytes" % limit)
            raise CommandError(413, "payload_too_large", "%s; this request is %.1f MB." % (what, n / 1048576.0))
        return self.rfile.read(n) if n else b""

    def _json_body(self, limit=JSON_LIMIT):
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        raw = self._read_body(limit)
        if ctype != "application/json":
            raise CommandError(415, "unsupported_media_type", "Send Content-Type: application/json.")
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise CommandError(400, "bad_json", "The request body is not valid JSON.")

    # ------------------------------------------------------------ dispatch
    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def _dispatch(self, method):
        url = urlsplit(self.path)
        path = unquote(url.path)
        self.query = parse_qs(url.query)
        conn = None
        try:
            if not path.startswith("/api/"):
                if method != "GET":
                    raise CommandError(405, "method_not_allowed", "Method not allowed.")
                return self._static(path)
            conn = db.connect(self.server.db_path)
            self.conn = conn
            self._api(method, path)
        except CommandError as e:
            self._json(e.status, e.body())
        except auth.AuthError as e:
            self._error(e.status, e.code, e.message)
        except Exception as e:  # noqa: BLE001
            log.error("unhandled %s on %s %s", type(e).__name__, method, path.split("?")[0])
            log.debug("unhandled", exc_info=True)
            try:
                self._error(500, "internal", "Unexpected server error; no partial change was saved. Try again or "
                                             "contact the pilot owner.")
            except Exception:  # noqa: BLE001
                pass
        finally:
            if conn is not None:
                conn.close()

    def _user(self, required=True):
        u = auth.session_user(self.conn, self._cookie_token())
        if u is None and required:
            raise CommandError(401, "unauthenticated", "Sign in to continue.")
        return u

    def _mutating_user(self):
        u = self._user()
        if not auth.check_csrf(u, self.headers.get("X-CSRF-Token")):
            raise CommandError(403, "csrf_required", "Missing or wrong X-CSRF-Token header. Reload the page and retry.")
        return u

    def _api(self, method, path):
        conn = self.conn
        if path == "/api/health" and method == "GET":
            return self._json(200, self._health())
        if path == "/api/login" and method == "POST":
            body = self._json_body()
            token, csrf, user = auth.login(conn, body.get("email"), body.get("password"))
            org = db.one(conn, "SELECT id, name FROM orgs WHERE id=?", (user["org_id"],))
            return self._json(200, self._me(user, org, csrf), {"Set-Cookie": self._session_cookie(token)})
        if path == "/api/connector/sandbox/events" and method == "POST":
            raw = self._read_body(JSON_LIMIT)
            sig = next((self.headers.get(h) for h in SIG_HEADERS if self.headers.get(h)), None)
            st, resp = commands.ingest_sandbox_body(conn, raw, sig)
            return self._json(st, resp)
        if path == "/api/logout" and method == "POST":
            self._mutating_user()
            auth.logout(conn, self._cookie_token())
            return self._json(200, {"ok": True}, {"Set-Cookie": self._session_cookie("", clear=True)})
        if path == "/api/me" and method == "GET":
            u = self._user()
            org = db.one(conn, "SELECT id, name FROM orgs WHERE id=?", (u["org_id"],))
            return self._json(200, self._me(u, org, u["csrf"]))
        if path == "/api/trade/bank/sandbox/observations" and method == "POST":
            from .trade_bank import ingest
            raw = self._read_body(32768)
            status, reply = ingest(conn, raw, self.headers)
            return self._json(status, reply)
        if path.startswith("/api/trade/"):
            return self._trade_api(method, path)
        if path == "/api/queue" and method == "GET":
            return self._json(200, commands.queue(conn, self._user()))
        if path == "/api/facilities" and method == "GET":
            return self._json(200, commands.facilities(conn, self._user()))
        if path == "/api/users" and method == "GET":
            u = self._user()
            rows = db.all_rows(conn, "SELECT id, name, role FROM users WHERE org_id=? AND disabled=0 AND role<>'admin' "
                                     "ORDER BY name", (u["org_id"],))
            return self._json(200, {"users": rows})
        if path == "/api/cases":
            if method == "GET":
                return self._json(200, commands.search(conn, self._user(), (self.query.get("q") or [""])[0]))
            if method == "POST":
                u = self._mutating_user()
                st, resp = commands.create_case(conn, u, self._json_body())
                return self._json(st, resp)
        if path == "/api/cases/import" and method == "POST":
            u = self._mutating_user()
            st, resp = commands.import_cases(conn, u, self._json_body())
            return self._json(st, resp)
        m = CASE_RE.match(path)
        if m:
            cid, rest = m.group(1), m.group(2) or ""
            if rest == "" and method == "GET":
                v = commands.read_case(conn, self._user(), cid)
                if v is None:
                    raise CommandError(404, "not_found", "No such case in your organisation.")
                return self._json(200, v)
            if rest == "/commands" and method == "POST":
                u = self._mutating_user()
                st, resp = commands.execute(conn, u, cid, self._json_body())
                return self._json(st, resp)
            if rest == "/sandbox/advance" and method == "POST":
                u = self._mutating_user()
                st, resp = commands.sandbox_advance(conn, self.server.db_path, u, cid, self._json_body())
                return self._json(st, resp)
            if rest == "/export" and method == "GET":
                fmt = (self.query.get("format") or ["json"])[0]
                out = commands.export_case(conn, self._user(), cid, fmt)
                if out is None:
                    raise CommandError(404, "not_found", "No such case in your organisation.")
                body, ctype, fname = out
                if ctype.startswith("text/") and "charset" not in ctype:
                    ctype += "; charset=utf-8"
                return self._send(200, body, ctype, {"Content-Disposition": 'attachment; filename="%s"' % _safe_name(fname)})
            if rest == "/evidence" and method == "POST":
                u = self._mutating_user()
                st, resp = commands.add_evidence(conn, u, cid, self._json_body(EVIDENCE_LIMIT))
                return self._json(st, resp)
            em = re.match(r"^/evidence/(EV-\d{1,12})$", rest)
            if em and method == "GET":
                u = self._user()
                row = commands.get_evidence(conn, u, cid, em.group(1))
                if row is None:
                    raise CommandError(404, "not_found", "No such evidence in your organisation.")
                return self._send(200, bytes(row["data"]), row["content_type"], {
                    "Content-Disposition": 'attachment; filename="%s"' % _safe_name(row["filename"]),
                    "X-Evidence-SHA256": row["sha256"]})
        if method not in ("GET", "POST"):
            raise CommandError(405, "method_not_allowed", "Method not allowed.")
        raise CommandError(404, "not_found", "No such API endpoint.")

    def _trade_api(self, method, path):
        # Authenticate before revealing whether a particular instrument exists.
        user = self._user() if method == "GET" else self._mutating_user()
        if method not in ("GET", "POST"):
            raise CommandError(405, "method_not_allowed", "Method not allowed.")
        inbox = re.fullmatch(r"/api/trade/instruments/([A-Za-z0-9_-]{1,80})/bank-observations", path)
        if inbox and method == "GET":
            from .trade_bank import observations
            return self._json(200, {"observations": observations(self.conn,user,inbox.group(1))})
        if path == "/api/trade/calendar/preview" and method == "POST":
            from .trade_calendar import preview_calendar
            try:
                result = preview_calendar(self._trade_body())
            except ValueError as err:
                raise CommandError(422, "invalid_calendar", str(err))
            return self._json(200, result)
        if path == "/api/trade/messages/preview" and method == "POST":
            from .trade_messages import parse_message
            data = self._trade_body()
            try:
                preview = parse_message(data.get("kind"), data.get("raw"))
            except ValueError as err:
                raise CommandError(422, "invalid_message", str(err))
            return self._json(200, preview)
        match = re.fullmatch(r"/api/trade/(instruments|records)(?:/([A-Za-z0-9_-]{1,80})(/commands)?)?", path)
        if not match:
            raise CommandError(404, "not_found", "No such trade endpoint.")
        group, rid, commands_path = match.groups()
        if group == "records":
            from . import trade_records as svc
            listing = svc.list_records
        else:
            from . import trade as svc
            listing = svc.list_instruments
        if method == "GET" and not commands_path:
            return self._json(200, svc.detail(self.conn, user, rid) if rid else {group: listing(self.conn, user)})
        if method == "POST" and (commands_path or not rid):
            data = self._trade_body()
            key = data.pop("idempotency_key", None)
            if not isinstance(key, str) or not key.strip() or len(key) > 128:
                raise CommandError(422, "invalid_key", "A nonempty idempotency_key (maximum 128 characters) is required.")
            if not rid:
                return self._json(201, svc.create(self.conn, user, data, key))
            action, payload, version = data.get("action"), data.get("payload", {}), data.get("version")
            if not isinstance(action,str) or not isinstance(payload,dict) or type(version) is not int:
                raise CommandError(422, "invalid_command", "Send action, object payload and integer version.")
            return self._json(200, svc.command(self.conn, user, rid, action, payload, key, version))
        raise CommandError(405, "method_not_allowed", "Method not allowed.")

    def _trade_body(self):
        data = self._json_body(131072)
        if not isinstance(data, dict):
            raise CommandError(422, "invalid_body", "Send a JSON object.")
        return data

    def _me(self, user, org, csrf):
        return {"user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]},
                "org": {"id": org["id"], "name": org["name"]}, "csrf": csrf, "env": pilot_env()}

    def _health(self):
        try:
            from . import ops
            h = ops.health(self.conn)
        except ImportError:
            h = {"ok": True, "db": "ok"}
        h["migrations"] = len(db.applied_migrations(self.conn))
        out = {"ok": bool(h.get("ok")), "db": h.get("db", "ok"), "migrations": h["migrations"]}
        if pilot_env() != "pilot":
            out["env"] = pilot_env()
        return out

    # ------------------------------------------------------------ static
    def _static(self, path):
        root = os.path.realpath(self.server.static_dir)
        rel = path.lstrip("/") or "index.html"
        target = os.path.realpath(os.path.join(root, rel))
        if not (target == root or target.startswith(root + os.sep)):
            raise CommandError(404, "not_found", "Not found.")
        if not os.path.isfile(target):
            if "." in os.path.basename(rel):
                raise CommandError(404, "not_found", "Not found.")
            target = os.path.join(root, "index.html")  # SPA fallback
        if not os.path.isfile(target):
            return self._send(200, PLACEHOLDER, "text/html; charset=utf-8")
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(target, "rb") as fh:
            body = fh.read()
        cache = "no-cache" if target.endswith(".html") else "public, max-age=300"
        self._send(200, body, ctype, cache=cache)


def _safe_name(name):
    return re.sub(r"[^A-Za-z0-9._-]", "_", name or "file")[:120]


def run(db_path, host="127.0.0.1", port=8765):
    srv = make_server(db_path, host, port)
    log.info("serving on %s:%d env=%s", host, srv.server_address[1], pilot_env())
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
