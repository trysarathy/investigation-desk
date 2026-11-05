"""Payout connector interface and the sandbox simulator (DATA module; standard library only).

Sandbox — not a live payment.  ``SandboxConnector`` simulates a payout provider in
the local SQLite database (tables from ``migrations/0100_sandbox.sql``).  It never
contacts a bank or provider, never holds funds and never moves money.  Every event
it emits carries ``provenance = "sandbox_simulation"`` and the label
``"Sandbox — not a live payment"``.

Event shape (PILOT_CONTRACT §10)::

    {provider_event_id, provider_ref, payout_ref, kind: accepted|credited|failed|returned,
     occurred_at: "...Z", provenance: "sandbox_simulation", label: "Sandbox — not a live payment"}

Webhook delivery: ``deliver(events, post_fn, secret)`` POSTs each event as canonical
JSON to ``/api/connector/sandbox/events`` with header ``X-Clearline-Signature`` =
hex HMAC-SHA256 of the exact body bytes.  The receiver must ``verify()`` the
signature and de-duplicate on ``provider_event_id`` (scenario ``duplicate_events``
replays ids on purpose; ``out_of_order`` sends ``credited`` before ``accepted``).
See docs/pilot/CONNECTOR.md.
"""

import hashlib
import hmac
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

try:
    from typing import Protocol
except ImportError:  # pragma: no cover
    Protocol = object

__all__ = [
    "SANDBOX_LABEL", "PROVENANCE", "EVENTS_PATH", "SIGNATURE_HEADER", "SCENARIOS", "EVENT_KINDS",
    "PayoutConnector", "SandboxConnector", "ConnectorError", "ConnectorConflict",
    "sign", "verify", "event_body", "parse_event_body", "deliver", "ensure_schema",
]

SANDBOX_LABEL = "Sandbox — not a live payment"
PROVENANCE = "sandbox_simulation"
EVENTS_PATH = "/api/connector/sandbox/events"
SIGNATURE_HEADER = "X-Clearline-Signature"
EVENT_KINDS = ("accepted", "credited", "failed", "returned")
SCENARIOS = ("normal", "timeout_then_accept", "fail", "return", "duplicate_events", "out_of_order")
_CURRENCIES = {"SGD", "USD", "EUR", "GBP", "HKD", "JPY"}

# Provider-side status machine (what the simulated provider "knows").
_TRANSITIONS = {
    "accepted": {"credited", "failed"},
    "credited": {"returned"},
}
# The next step each scenario scripts after the current status (advance() with no kind).
_SCRIPT_NEXT = {
    "normal": {"accepted": "credited"},
    "timeout_then_accept": {"accepted": "credited"},
    "fail": {"accepted": "failed"},
    "return": {"accepted": "credited", "credited": "returned"},
    "duplicate_events": {"accepted": "credited"},
    "out_of_order": {"accepted": "credited"},
}

_MIGRATION = os.path.join(os.path.dirname(os.path.abspath(__file__)), "migrations", "0100_sandbox.sql")


class ConnectorError(Exception):
    """Invalid use of the connector (unknown ref, illegal transition, bad scenario)."""


class ConnectorConflict(ConnectorError):
    """The same payout_ref was submitted again with different details."""


class PayoutConnector(Protocol):
    """What the desk needs from any payout provider integration (sandbox or, later, real)."""

    def submit(self, payout_ref, amount_minor, currency, beneficiary):
        """Instruct one payout, idempotent on ``payout_ref``.

        Returns ``{status: 'accepted'|'timeout'|'rejected', provider_ref, detail}``.
        ``timeout`` means *unknown*: the caller must not re-instruct; it queries with
        ``get_status(provider_ref)`` (or resubmits the identical ``payout_ref``, which
        never creates a second payment)."""

    def get_status(self, provider_ref):
        """Return every event the provider has for ``provider_ref`` (oldest first)."""


# ---------------------------------------------------------------- signing

def _key(secret):
    if secret is None or secret == "" or secret == b"":
        raise ConnectorError("a non-empty secret is required to sign or verify sandbox events")
    return secret.encode("utf-8") if isinstance(secret, str) else bytes(secret)


def sign(secret, body):
    """Hex HMAC-SHA256 of ``body`` (bytes) under ``secret``."""
    if isinstance(body, str):
        body = body.encode("utf-8")
    return hmac.new(_key(secret), body, hashlib.sha256).hexdigest()


def verify(secret, body, sig):
    """Constant-time check of ``sig`` against ``sign(secret, body)``. Never raises on bad input."""
    if not isinstance(sig, (str, bytes)) or not sig:
        return False
    try:
        expected = sign(secret, body).encode("ascii")
        given = sig.strip().lower().encode("ascii") if isinstance(sig, str) else sig.strip().lower()
    except (ConnectorError, UnicodeError, TypeError):
        return False
    return hmac.compare_digest(expected, given)


def event_body(event):
    """Canonical JSON bytes for an event (what is signed and posted)."""
    return json.dumps(event, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def parse_event_body(body):
    """Parse and validate a posted event body. Raises ValueError with a readable message."""
    try:
        ev = json.loads(body.decode("utf-8") if isinstance(body, bytes) else body)
    except (ValueError, UnicodeError):
        raise ValueError("event body is not JSON")
    if not isinstance(ev, dict):
        raise ValueError("event body must be a JSON object")
    for k in ("provider_event_id", "provider_ref", "kind", "occurred_at"):
        if not isinstance(ev.get(k), str) or not ev.get(k):
            raise ValueError("event is missing %s" % k)
    if ev["kind"] not in EVENT_KINDS:
        raise ValueError("unknown event kind %r" % ev["kind"])
    return ev


def _status_of(result):
    if isinstance(result, int):
        return result
    if isinstance(result, tuple) and result and isinstance(result[0], int):
        return result[0]
    for attr in ("status", "status_code", "code"):
        v = getattr(result, attr, None)
        if isinstance(v, int):
            return v
    return None


def deliver(events, post_fn, secret, *, path=EVENTS_PATH):
    """Sign and POST each event: ``post_fn(path, body_bytes, headers)``.

    ``post_fn`` returns an HTTP status (int), a ``(status, body)`` tuple, or an object with
    ``.status``.  Returns ``[{provider_event_id, status, ok}]`` in posting order.
    """
    results = []
    for ev in events:
        body = event_body(ev)
        headers = {"Content-Type": "application/json", SIGNATURE_HEADER: sign(secret, body)}
        try:
            status = _status_of(post_fn(path, body, headers))
        except Exception as exc:  # network failure etc.: leave pending, report
            results.append({"provider_event_id": ev.get("provider_event_id"), "status": None, "ok": False,
                            "error": type(exc).__name__})
            continue
        results.append({"provider_event_id": ev.get("provider_event_id"), "status": status,
                        "ok": status is not None and 200 <= status < 300})
    return results


# ---------------------------------------------------------------- schema

def _statements(sql):
    out, buf = [], ""
    for line in sql.splitlines(True):
        buf += line
        if sqlite3.complete_statement(buf):
            if buf.strip():
                out.append(buf)
            buf = ""
    return out


def ensure_schema(conn):
    """Create the sandbox tables if missing (idempotent; safe inside an open transaction)."""
    have = conn.execute(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('sandbox_payouts','sandbox_events')"
    ).fetchone()[0]
    if have == 2:
        return
    with open(_MIGRATION, encoding="utf-8") as fh:
        for stmt in _statements(fh.read()):
            conn.execute(stmt)


# ---------------------------------------------------------------- sandbox

def _iso_now(clock):
    v = clock() if callable(clock) else clock
    if v is None:
        v = datetime.now(timezone.utc)
    if isinstance(v, datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        return v.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(v)


class SandboxConnector:
    """Simulated payout provider. Sandbox — not a live payment.

    ``SandboxConnector(conn_or_factory, secret, clock=None, *, org_id="default", scenario="normal")``

    * ``conn_or_factory``: a ``sqlite3.Connection`` (used as is; if it already has an open
      transaction the connector joins it and does not commit), or a zero-argument factory
      returning a fresh connection (closed after each operation).
    * ``clock``: callable returning a ``datetime`` or a UTC ISO string (e.g. ``db.now``);
      default is the real UTC clock.
    * ``scenario``: default scenario for ``submit``; each ``submit`` may override it.
    """

    label = SANDBOX_LABEL
    provenance = PROVENANCE

    def __init__(self, conn_or_factory, secret, clock=None, *, org_id="default", scenario="normal"):
        if scenario not in SCENARIOS:
            raise ConnectorError("unknown scenario %r; use one of %s" % (scenario, ", ".join(SCENARIOS)))
        _key(secret)
        self._src = conn_or_factory
        self._is_conn = hasattr(conn_or_factory, "execute")
        if not self._is_conn and not callable(conn_or_factory):
            raise ConnectorError("pass a sqlite3 connection or a connection factory")
        self.secret = secret
        self.clock = clock
        self.org_id = str(org_id)
        self.default_scenario = scenario
        self._schema_ok = False

    # -- plumbing
    @contextmanager
    def _tx(self):
        conn = self._src if self._is_conn else self._src()
        try:
            own = not conn.in_transaction
            if own:
                conn.execute("BEGIN IMMEDIATE")
            try:
                if not self._schema_ok:
                    ensure_schema(conn)
                    self._schema_ok = True
                yield conn
            except BaseException:
                if own:
                    conn.rollback()
                raise
            else:
                if own:
                    conn.commit()
        finally:
            if not self._is_conn:
                conn.close()

    def now(self):
        return _iso_now(self.clock)

    def _row(self, conn, provider_ref):
        r = conn.execute(
            "SELECT provider_ref, payout_ref, amount_minor, currency, beneficiary, scenario, status, "
            "submit_count, created_at FROM sandbox_payouts WHERE org_id=? AND provider_ref=?",
            (self.org_id, provider_ref),
        ).fetchone()
        if r is None:
            return None
        keys = ("provider_ref", "payout_ref", "amount_minor", "currency", "beneficiary", "scenario", "status",
                "submit_count", "created_at")
        return dict(zip(keys, tuple(r)))

    def _provider_ref(self, payout_ref):
        digest = hashlib.sha256(("%s\x1f%s" % (self.org_id, payout_ref)).encode("utf-8")).hexdigest()
        return "SBX-" + digest[:20].upper()

    def _emit(self, conn, p, kind, occurred_at):
        n = conn.execute(
            "SELECT count(DISTINCT provider_event_id) FROM sandbox_events WHERE org_id=? AND provider_ref=?",
            (self.org_id, p["provider_ref"]),
        ).fetchone()[0]
        event_id = "%s-E%d" % (p["provider_ref"], n + 1)
        copies = 2 if p["scenario"] == "duplicate_events" else 1
        for _ in range(copies):
            conn.execute(
                "INSERT INTO sandbox_events (org_id, provider_event_id, provider_ref, kind, occurred_at) "
                "VALUES (?,?,?,?,?)",
                (self.org_id, event_id, p["provider_ref"], kind, occurred_at),
            )

    def _event(self, row, payout_ref):
        return {
            "provider_event_id": row[0], "provider_ref": row[1], "payout_ref": payout_ref,
            "kind": row[2], "occurred_at": row[3], "provenance": PROVENANCE, "label": SANDBOX_LABEL,
        }

    def _response(self, p, status, detail, duplicate=False):
        return {
            "status": status, "provider_ref": p["provider_ref"], "detail": detail,
            "provider_status": p["status"], "scenario": p["scenario"], "duplicate": duplicate,
            "provenance": PROVENANCE, "label": SANDBOX_LABEL,
        }

    # -- PayoutConnector
    def submit(self, payout_ref, amount_minor, currency, beneficiary, *, scenario=None):
        """Simulate instructing a payout. Idempotent on ``payout_ref`` (one sandbox payment per ref)."""
        scenario = scenario or self.default_scenario
        if scenario not in SCENARIOS:
            raise ConnectorError("unknown scenario %r; use one of %s" % (scenario, ", ".join(SCENARIOS)))
        if not isinstance(payout_ref, str) or not payout_ref.strip():
            raise ConnectorError("payout_ref is required")
        beneficiary = "" if beneficiary is None else str(beneficiary)
        now = self.now()
        with self._tx() as conn:
            provider_ref = self._provider_ref(payout_ref)
            existing = conn.execute(
                "SELECT provider_ref FROM sandbox_payouts WHERE org_id=? AND payout_ref=?",
                (self.org_id, payout_ref),
            ).fetchone()
            if existing is not None:
                p = self._row(conn, existing[0])
                if (p["amount_minor"], p["currency"], p["beneficiary"]) != (amount_minor, currency, beneficiary):
                    raise ConnectorConflict(
                        "payout_ref %s was already submitted with different amount, currency or beneficiary; "
                        "no second sandbox payment was created" % payout_ref)
                conn.execute(
                    "UPDATE sandbox_payouts SET submit_count = submit_count + 1, updated_at=? "
                    "WHERE provider_ref=?", (now, p["provider_ref"]))
                status = "rejected" if p["status"] == "rejected" else "accepted"
                return self._response(
                    p, status, "Duplicate submission of %s ignored; the original sandbox payment stands (%s). %s"
                    % (payout_ref, p["status"], SANDBOX_LABEL), duplicate=True)

            problem = None
            if not isinstance(amount_minor, int) or isinstance(amount_minor, bool) or amount_minor <= 0:
                problem = "amount must be a positive integer number of minor units"
            elif currency not in _CURRENCIES:
                problem = "unsupported currency %r" % (currency,)
            elif not beneficiary.strip():
                problem = "beneficiary is required"
            stored_amount = amount_minor if isinstance(amount_minor, int) else 0
            status = "rejected" if problem else "accepted"
            conn.execute(
                "INSERT INTO sandbox_payouts (provider_ref, org_id, payout_ref, amount_minor, currency, beneficiary, "
                "scenario, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (provider_ref, self.org_id, payout_ref, stored_amount, str(currency), beneficiary, scenario,
                 status, now, now),
            )
            p = self._row(conn, provider_ref)
            if problem:
                return self._response(p, "rejected", "Sandbox provider rejected the instruction: %s. %s"
                                      % (problem, SANDBOX_LABEL))
            if scenario != "out_of_order":  # out_of_order holds 'accepted' back until after 'credited'
                self._emit(conn, p, "accepted", now)
            if scenario == "timeout_then_accept":
                return self._response(
                    p, "timeout", "Sandbox provider did not answer in time: status unknown. Do not re-instruct; "
                    "query status with the same reference. %s" % SANDBOX_LABEL)
            return self._response(p, "accepted", "Sandbox provider accepted the instruction (not a credit to the "
                                  "beneficiary). %s" % SANDBOX_LABEL)

    def get_status(self, provider_ref):
        """All events emitted so far for ``provider_ref`` (distinct ids, emission order). [] if unknown."""
        with self._tx() as conn:
            p = self._row(conn, provider_ref)
            if p is None:
                return []
            rows = conn.execute(
                "SELECT provider_event_id, provider_ref, kind, occurred_at FROM sandbox_events "
                "WHERE org_id=? AND provider_ref=? ORDER BY id", (self.org_id, provider_ref)).fetchall()
        out, seen = [], set()
        for r in rows:
            if r[0] not in seen:
                seen.add(r[0])
                out.append(self._event(tuple(r), p["payout_ref"]))
        return out

    # -- simulation controls
    def payout(self, provider_ref):
        """The sandbox payment record (dict) or None."""
        with self._tx() as conn:
            return self._row(conn, provider_ref)

    def advance(self, provider_ref, to_kind=None):
        """Move the simulated payment to ``to_kind`` (or the scenario's next step); returns new events."""
        if to_kind is not None and to_kind not in EVENT_KINDS:
            raise ConnectorError("unknown event kind %r" % (to_kind,))
        now = self.now()
        with self._tx() as conn:
            p = self._row(conn, provider_ref)
            if p is None:
                raise ConnectorError("unknown sandbox provider_ref %r" % (provider_ref,))
            if p["status"] == "rejected":
                raise ConnectorError("sandbox payment %s was rejected; nothing to advance" % provider_ref)
            kind = to_kind or _SCRIPT_NEXT[p["scenario"]].get(p["status"])
            if kind is None:
                raise ConnectorError("scenario %s has no further step after %s" % (p["scenario"], p["status"]))
            if kind not in _TRANSITIONS.get(p["status"], set()):
                raise ConnectorError("sandbox payment %s cannot go from %s to %s" % (provider_ref, p["status"], kind))
            before = conn.execute("SELECT coalesce(max(id),0) FROM sandbox_events").fetchone()[0]
            self._emit(conn, p, kind, now)
            if p["scenario"] == "out_of_order":
                held = conn.execute(
                    "SELECT count(*) FROM sandbox_events WHERE org_id=? AND provider_ref=? AND kind='accepted'",
                    (self.org_id, provider_ref)).fetchone()[0]
                if not held:  # the delayed acceptance arrives after the later event
                    self._emit(conn, p, "accepted", p["created_at"])
            conn.execute("UPDATE sandbox_payouts SET status=?, updated_at=? WHERE provider_ref=?",
                         (kind, now, provider_ref))
            rows = conn.execute(
                "SELECT provider_event_id, provider_ref, kind, occurred_at FROM sandbox_events "
                "WHERE org_id=? AND provider_ref=? AND id > ? ORDER BY id",
                (self.org_id, provider_ref, before)).fetchall()
        return [self._event(tuple(r), p["payout_ref"]) for r in rows]

    def _pending(self, conn, provider_ref=None):
        sql = ("SELECT e.id, e.provider_event_id, e.provider_ref, e.kind, e.occurred_at, p.payout_ref "
               "FROM sandbox_events e JOIN sandbox_payouts p ON p.provider_ref = e.provider_ref "
               "WHERE e.org_id=? AND e.delivered=0")
        args = [self.org_id]
        if provider_ref is not None:
            sql += " AND e.provider_ref=?"
            args.append(provider_ref)
        return conn.execute(sql + " ORDER BY e.id", args).fetchall()

    def pending_events(self, provider_ref=None):
        """Undelivered webhook events in emission order (duplicates included as emitted)."""
        with self._tx() as conn:
            rows = self._pending(conn, provider_ref)
        return [self._event(tuple(r)[1:5], r[5]) for r in rows]

    def deliver_pending(self, post_fn, provider_ref=None, *, path=EVENTS_PATH):
        """Sign and post pending events; marks those answered 2xx as delivered. Returns deliver() results."""
        with self._tx() as conn:
            rows = self._pending(conn, provider_ref)
        events = [self._event(tuple(r)[1:5], r[5]) for r in rows]
        results = deliver(events, post_fn, self.secret, path=path)
        done = [r[0] for r, res in zip(rows, results) if res["ok"]]
        if done:
            with self._tx() as conn:
                conn.executemany("UPDATE sandbox_events SET delivered=1 WHERE id=?", [(i,) for i in done])
        return results

    def sign(self, body):
        return sign(self.secret, body)

    def verify(self, body, sig):
        return verify(self.secret, body, sig)
