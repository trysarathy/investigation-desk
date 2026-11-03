#!/usr/bin/env python3
"""Local HTTP server for the funding decision replay (reconstructed engine).

Standard library only. Binds to 127.0.0.1. Serves app/static/ and a small JSON API:

    GET  /api/meta
    POST /api/evaluate   {"scenario", "decision_time", "funding_rate_pct"}
    POST /api/import     raw CSV text (<= 1 MB)
    POST /api/reset

Synthetic replay -- no funds move. Nothing here contacts a bank, a provider or any network.

Run from the repository root:   python3 funding-replay/app/server.py [--port 8765]
or from funding-replay/:        python3 app/server.py [--port 8765]
"""

import argparse
import json
import os
import re
import sys
import threading
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(APP_DIR)
STATIC_DIR = os.path.join(APP_DIR, "static")
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

from engine import replay  # noqa: E402

HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_BODY = 1024 * 1024  # 1 MB
DEFAULT_RATE = "8"
RATE_RE = re.compile(r"^[0-9]{1,3}(\.[0-9]{1,6})?$")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
}
# Same-origin only: no external fonts, CDNs or network calls.
CSP = ("default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
       "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; "
       "frame-ancestors 'none'")

PLACEHOLDER = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Funding replay</title></head>
<body><p><strong>Synthetic replay — no funds move.</strong></p>
<p>The interface has not been built yet. The reconstructed engine is running; see <a href="/api/meta">/api/meta</a>.</p>
</body></html>
"""

IMPORTED_META = {
    "id": "imported",
    "name": "Imported CSV",
    "description": "Records you imported in this session. Use synthetic or redacted data only; nothing is stored on disk.",
}


class AppState:
    """In-memory dataset: the immutable samples plus an optional imported scenario."""

    def __init__(self):
        self.lock = threading.Lock()
        self.imported = None  # dict like a SCENARIOS entry, or None

    def current_dataset(self):
        return "imported" if self.imported is not None else "sample"

    def scenarios(self):
        out = [replay.scenario_meta(s) for s in replay.SCENARIOS.values()]
        if self.imported is not None:
            out.append(replay.scenario_meta(self.imported))
        return out

    def get(self, scenario_id):
        if scenario_id == "imported":
            return self.imported
        return replay.SCENARIOS.get(scenario_id)

    def import_csv(self, text):
        events, errors = replay.load_events(text)
        if errors:
            return False, errors  # last good dataset kept unchanged
        scenario = dict(IMPORTED_META)
        scenario.update({"synthetic": True, "events": events, "csv": text})
        self.imported = scenario
        return True, len(events)

    def reset(self):
        self.imported = None


class Handler(BaseHTTPRequestHandler):
    server_version = "FundingReplay/0.1"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------ utils
    def log_message(self, fmt, *args):  # quiet unless --verbose
        if getattr(self.server, "verbose", False):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _common_headers(self, content_type, length):
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)

    def _send_json(self, status, payload, extra_headers=()):
        body = dict(payload)
        body.setdefault("label", replay.LABEL)
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self._sent = True
        self.send_response(status)
        self._common_headers("application/json; charset=utf-8", len(data))
        for k, v in extra_headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _send_bytes(self, status, data, content_type):
        self._sent = True
        self.send_response(status)
        self._common_headers(content_type, len(data))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status, message, **extra):
        payload = {"ok": False, "error": message}
        payload.update(extra)
        self._send_json(status, payload)

    def _allowed_origin(self):
        """Reject DNS-rebinding Hosts and cross-site Origins (no CORS)."""
        port = self.server.server_address[1]
        hosts = {"127.0.0.1:%d" % port, "localhost:%d" % port}
        host = self.headers.get("Host", "")
        if host not in hosts:
            return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {"http://" + h for h in hosts}:
            return False
        return True

    def _read_body(self):
        if self.headers.get("Transfer-Encoding"):
            self.close_connection = True
            self._error(411, "Send a Content-Length; chunked bodies are not accepted.")
            return None
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.close_connection = True
            self._error(400, "Invalid Content-Length.")
            return None
        if length < 0:
            self.close_connection = True
            self._error(400, "Invalid Content-Length.")
            return None
        if length > MAX_BODY:
            self.close_connection = True
            # Drain a bounded amount so the client can read the 413 instead of a reset.
            remaining = min(length, 8 * MAX_BODY)
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
            self._error(413, "Request body is larger than 1 MB.",
                        errors=[{"row": None, "column": "", "message": "File is larger than 1 MB."}])
            return None
        return self.rfile.read(length) if length else b""

    # ---------------------------------------------------------------- methods
    def _do_GET(self):
        if not self._allowed_origin():
            return self._error(403, "Forbidden host or origin.")
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path == "/api/meta":
            with self.server.state.lock:
                payload = {
                    "label": replay.LABEL,
                    "engine": replay.ENGINE,
                    "scenarios": self.server.state.scenarios(),
                    "decision_times": replay.decision_times_json(),
                    "default_rate_pct": DEFAULT_RATE,
                    "current_dataset": self.server.state.current_dataset(),
                }
            return self._send_json(200, payload)
        if path.startswith("/api/"):
            return self._error(404, "Unknown API path.")
        if path in ("/", "/index.html"):
            return self._serve_static("index.html", placeholder=True)
        if path.startswith("/static/"):
            return self._serve_static(path[len("/static/"):])
        return self._error(404, "Not found.")

    def _serve_static(self, rel, placeholder=False):
        root = os.path.realpath(STATIC_DIR)
        target = os.path.realpath(os.path.join(root, rel))
        inside = target == root or target.startswith(root + os.sep)
        if inside and os.path.isfile(target):
            ext = os.path.splitext(target)[1].lower()
            ctype = CONTENT_TYPES.get(ext)
            if ctype is None:
                return self._error(404, "Not found.")
            with open(target, "rb") as handle:
                return self._send_bytes(200, handle.read(), ctype)
        if placeholder:
            return self._send_bytes(200, PLACEHOLDER.encode("utf-8"), CONTENT_TYPES[".html"])
        return self._error(404, "Not found.")

    def _do_POST(self):
        if not self._allowed_origin():
            self.close_connection = True
            return self._error(403, "Forbidden host or origin.")
        path = self.path.split("?", 1)[0]
        if path not in ("/api/evaluate", "/api/import", "/api/reset"):
            self.close_connection = True
            return self._error(404, "Unknown API path.")
        body = self._read_body()
        if body is None:
            return
        if path == "/api/evaluate":
            return self._evaluate(body)
        if path == "/api/import":
            return self._import(body)
        with self.server.state.lock:
            self.server.state.reset()
        return self._send_json(200, {"ok": True, "current_dataset": "sample"})

    def _evaluate(self, body):
        try:
            req = json.loads(body.decode("utf-8") or "{}", parse_float=Decimal)
        except (UnicodeDecodeError, ValueError):
            return self._error(400, "Body must be JSON: {scenario, decision_time, funding_rate_pct}.")
        if not isinstance(req, dict):
            return self._error(400, "Body must be a JSON object.")
        scenario_id = req.get("scenario", "reference")
        decision_time = req.get("decision_time", "friday")
        raw_rate = req.get("funding_rate_pct", DEFAULT_RATE)
        if isinstance(raw_rate, bool) or not isinstance(raw_rate, (str, int, Decimal)):
            return self._error(400, "funding_rate_pct must be a number between 0 and 100.")
        text = str(raw_rate).strip()
        if not RATE_RE.match(text):  # ASCII digits only; Decimal() would accept full-width digits
            return self._error(400, "funding_rate_pct must be a number between 0 and 100.")
        try:
            rate = Decimal(text)
        except InvalidOperation:
            return self._error(400, "funding_rate_pct must be a number between 0 and 100.")
        if not rate.is_finite() or rate < 0 or rate > 100:
            return self._error(400, "funding_rate_pct must be a number between 0 and 100.")
        with self.server.state.lock:
            scenario = self.server.state.get(scenario_id) if isinstance(scenario_id, str) else None
        if scenario is None:
            return self._error(400, "Unknown scenario %r." % (scenario_id,))
        if decision_time not in ("friday", "monday", "retro"):
            return self._error(400, "Unknown decision_time %r." % (decision_time,))
        try:
            result = replay.evaluate(scenario["events"], decision_time, rate, scenario)
        except Exception:  # never drop the connection; never echo internals
            self.close_connection = True
            return self._error(500, "The engine could not evaluate this dataset. No result is shown.")
        return self._send_json(200, result)

    def _import(self, body):
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            return self._send_json(400, {"ok": False, "errors": [
                {"row": None, "column": "", "message": "The file is not UTF-8 text."}]})
        with self.server.state.lock:
            ok, info = self.server.state.import_csv(text)
            dataset = self.server.state.current_dataset()
        if not ok:
            return self._send_json(400, {"ok": False, "errors": info[:200], "error_count": len(info),
                                         "current_dataset": dataset})
        return self._send_json(200, {"ok": True, "scenario": "imported", "records": info,
                                     "current_dataset": dataset})

    def _guarded(self, handler):
        self._sent = False
        try:
            handler()
        except Exception:
            self.close_connection = True
            if not self._sent:
                try:
                    self._error(500, "Internal error. No result is shown.")
                except Exception:
                    pass

    def do_GET(self):
        self._guarded(self._do_GET)

    def do_POST(self):
        self._guarded(self._do_POST)

    def _method_not_allowed(self):
        self.close_connection = True
        self._send_json(405, {"ok": False, "error": "Method not allowed."}, [("Allow", "GET, POST")])

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = do_TRACE = do_CONNECT = _method_not_allowed


def make_server(port=DEFAULT_PORT, verbose=False):
    server = ThreadingHTTPServer((HOST, port), Handler)
    server.daemon_threads = True
    server.state = AppState()
    server.verbose = verbose
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description="Funding decision replay (synthetic; no funds move).")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="port on 127.0.0.1 (default 8765; 0 = any)")
    parser.add_argument("--verbose", action="store_true", help="log requests to stderr")
    args = parser.parse_args(argv)
    server = make_server(args.port, args.verbose)
    port = server.server_address[1]
    print("Funding replay (reconstructed engine). %s" % replay.LABEL, flush=True)
    print("Serving on http://127.0.0.1:%d" % port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
