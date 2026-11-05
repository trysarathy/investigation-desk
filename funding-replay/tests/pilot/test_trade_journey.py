"""Documentary-credit simulation: command results, independent review and money isolation over real HTTP."""

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from backend_support import Client, ServerCase, T0
from pilot import db

ROOT = "/api/trade/instruments"


def key():
    return str(uuid.uuid4())


def terms(**changes):
    values = {
        "reference": "LC-MACHINE-041",
        "applicant": "Juniper Mechanics (Synthetic)",
        "beneficiary": "Kite Components (Synthetic)",
        "issuing_bank": "Harbour Issuer (Synthetic)",
        "advising_bank": "Kite Advising Bank (Synthetic)",
        "currency": "USD", "amount": "24751.13",
        "expires_at": "2026-12-04T08:00:00Z",
        "presentation_deadline_at": "2026-12-03T08:00:00Z",
        "required_documents": ["invoice", "bill_of_lading"], "idempotency_key": key(),
    }
    values.update(changes)
    return values


def presentation(**changes):
    values = {
        "presented_at": T0, "amount": "24751.13", "currency": "USD",
        "documents": [{"kind": "invoice", "reference": "INV-041"},
                      {"kind": "bill_of_lading", "reference": "BL-041"}],
    }
    values.update(changes)
    return values


class TradeJourney(ServerCase):

    def draft(self, op, **changes):
        return self.assertOk(op.req("POST", ROOT, terms(**changes)), 201)

    def command(self, client, view, action, payload=None, token=None, version=None):
        return client.req("POST", ROOT + "/" + view["id"] + "/commands", {
            "action": action, "payload": payload or {},
            "version": view["version"] if version is None else version,
            "idempotency_key": token or key(),
        })

    def step(self, client, view, action, status, **payload):
        result = self.assertOk(self.command(client, view, action, payload))
        self.assertEqual(result["status"], status)
        self.assertGreater(result["version"], view["version"])
        return result

    def issue(self, op, reviewer, **changes):
        return self.step(reviewer, self.draft(op, **changes), "issue", "issued")

    def examine(self, op, reviewer, data, expected, **term_changes):
        v = self.issue(op, reviewer, **term_changes)
        v = self.step(op, v, "present", "presented", **data)
        return self.step(reviewer, v, "examine", expected)

    def balances(self):
        # Reads only: user actions must go through the server.
        conn = self.env.conn()
        try:
            return {table: conn.execute("SELECT COUNT(*) FROM " + table).fetchone()[0]
                    for table in ("draws", "reservations", "payouts", "cases")}
        finally:
            conn.close()

    def test_clean_presentation_independent_accept_and_financing_review_only(self):
        op, rv = self.client(), self.client("reviewer")
        before = self.balances()
        v = self.examine(op, rv, presentation(), "examined")
        self.assertFalse(v["findings"])
        self.assertEqual(v["amount_minor"], 2475113)
        self.assertEqual(self.command(op, v, "accept", {"reason": "same operator"}).status, 403)
        before_acceptance = v
        confirm_key = key()
        reason = {"reason": "No discrepancies after manual examination"}
        v = self.assertOk(self.command(rv, before_acceptance, "accept", reason, token=confirm_key))
        self.assertEqual(v["status"], "accepted")
        self.assertEqual(v["financing_review"]["status"], "awaiting_handoff")
        self.assertFalse(v["financing_review"]["funds_moved"])
        self.assertEqual(self.assertOk(self.command(rv, before_acceptance, "accept", reason, token=confirm_key))["version"],
                         v["version"])
        conn = self.env.conn()
        try:
            self.assertEqual(conn.execute("SELECT count(*) FROM trade_financing_tasks WHERE credit_id=?",
                                          (v["id"],)).fetchone()[0], 1)
        finally:
            conn.close()
        v = self.step(op, v, "request_financing_review", "financing_review_requested")
        self.assertEqual(v["financing_review"]["status"], "handed_off")
        self.assertFalse(v["financing_review"]["funds_moved"])
        self.assertEqual(self.balances(), before, "LC workflows must not initiate financial activity")
        events = v["events"]
        self.assertGreaterEqual(len(events), 6)
        self.stop()
        self.start()
        op.port = self.port
        readback = self.assertOk(op.get(ROOT + "/" + v["id"]))
        self.assertEqual(readback["events"], events)
        self.assertEqual(readback["status"], "financing_review_requested")

    def test_waiver_is_evidence_not_final_acceptance(self):
        op, rv = self.client(), self.client("reviewer")
        data = presentation(currency="EUR", amount="17000.05",
                            documents=[{"kind": "invoice", "reference": "I-008"}])
        v = self.examine(op, rv, data, "discrepant")
        self.assertEqual({f["code"] for f in v["findings"]}, {"currency_mismatch", "missing_document"},
                         "Do not compare money amounts across currencies")
        self.assertEqual(self.command(rv, v, "accept", {"reason": "ignore defects"}).status, 409)
        v = self.step(rv, v, "request_waiver", "waiver_requested", reason="Request applicant response")
        self.assertNotEqual(self.command(op, v, "record_waiver", {}).status, 200)
        v = self.step(op, v, "record_waiver", "waiver_recorded", evidence_ref="SYNTH-APPLICANT-045")
        self.assertNotEqual(self.command(op, v, "request_financing_review").status, 200)
        v = self.step(rv, v, "accept_waiver", "accepted", reason="Reviewer considered waiver evidence")
        self.assertEqual(self.balances()["draws"], 0)

    def test_same_currency_amount_mismatch(self):
        op, rv = self.client(), self.client("reviewer")
        v = self.examine(op, rv, presentation(amount="24751.14"), "discrepant")
        self.assertEqual({f["code"] for f in v["findings"]}, {"amount_mismatch"})

    def test_backdated_presentation_cannot_hide_late_receipt(self):
        op, rv = self.client(), self.client("reviewer")
        v = self.issue(op, rv, presentation_deadline_at="2026-12-01T02:00:00Z")
        db.set_clock("2026-12-01T03:00:00Z")
        v = self.step(op, v, "present", "presented", **presentation(presented_at="2026-12-01T01:30:00Z"))
        v = self.step(rv, v, "examine", "discrepant")
        self.assertIn("late_presentation", {f["code"] for f in v["findings"]})

    def test_late_presentation_is_not_silently_accepted(self):
        op, rv = self.client(), self.client("reviewer")
        v = self.issue(op, rv, presentation_deadline_at="2026-12-01T02:00:00Z")
        later = "2026-12-01T03:00:00Z"
        db.set_clock(later)
        v = self.step(op, v, "present", "presented", **presentation(presented_at=later))
        v = self.step(rv, v, "examine", "discrepant")
        self.assertTrue(v["findings"])
        v = self.step(rv, v, "refuse", "refused", reason="Presentation did not meet explicit deadline")
        self.assertNotEqual(self.command(op, v, "request_financing_review").status, 200)

    def test_two_reviewers_cannot_issue_two_undertakings(self):
        op, r1, r2 = self.client(), self.client("reviewer"), self.client("reviewer2")
        draft = self.draft(op)
        gate = Barrier(2)

        def competing_issue(reviewer):
            gate.wait(timeout=10)
            return self.command(reviewer, draft, "issue")

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(competing_issue, (r1, r2)))
        self.assertEqual(sorted(result.status for result in results), [200, 409])
        latest = self.assertOk(op.get(ROOT + "/" + draft["id"]))
        self.assertEqual(sum(e["action"] == "issue" for e in latest["events"]), 1)

    def test_invalid_document_rolls_back_otherwise_valid_presentation(self):
        op, rv = self.client(), self.client("reviewer")
        issued = self.issue(op, rv)
        data = presentation()
        data["documents"][1]["sha256"] = "not-a-digest"
        self.assertEqual(self.command(op, issued, "present", data).status, 422)
        unchanged = self.assertOk(op.get(ROOT + "/" + issued["id"]))
        self.assertEqual(unchanged["version"], issued["version"])
        self.assertIsNone(unchanged["presentation"])
        self.assertEqual(unchanged["events"], issued["events"])
        self.step(op, unchanged, "present", "presented", **presentation())

    def test_org_scope_authentication_role_and_csrf(self):
        op, rv, view = self.client(), self.client("reviewer"), self.client("viewer")
        self.assertEqual(Client(self.port).get(ROOT).status, 401)
        self.assertEqual(op.req("POST", ROOT, terms(), csrf=False).status, 403)
        self.assertEqual(view.req("POST", ROOT, terms()).status, 403)
        draft = self.draft(op)
        self.assertEqual(self.command(op, draft, "issue").status, 403)
        self.assertEqual(self.command(view, draft, "issue").status, 403)
        self.assertEqual(view.get(ROOT + "/" + draft["id"]).status, 200)
        other = self.client("reviewer", org="meridian")
        self.assertEqual(other.get(ROOT + "/" + draft["id"]).status, 404)
        self.assertEqual(other.get(ROOT).json["instruments"], [])
        self.assertEqual(self.command(other, draft, "issue").status, 404)
        self.step(rv, draft, "issue", "issued")

    def test_idempotency_stale_versions_and_immutable_command_history(self):
        op, rv = self.client(), self.client("reviewer")
        payload = terms()
        a = self.assertOk(op.req("POST", ROOT, payload), 201)
        retry = op.req("POST", ROOT, payload)
        self.assertIn(retry.status, (200, 201), retry)
        self.assertEqual(a["id"], retry.json["id"])
        self.assertEqual(op.req("POST", ROOT, dict(payload, amount="1.00")).status, 409)
        k = key()
        issued = self.assertOk(self.command(rv, a, "issue", token=k))
        self.assertEqual(self.command(rv, a, "issue", token=k).status, 200)
        latest = self.assertOk(op.get(ROOT + "/" + a["id"]))
        self.assertEqual(latest["version"], issued["version"])
        self.assertEqual(latest["events"], issued["events"])
        self.assertEqual(self.command(op, a, "present", presentation()).status, 409)
        self.assertEqual(self.command(rv, a, "examine", token=k).status, 409)
        self.assertEqual(self.assertOk(op.get(ROOT + "/" + a["id"]))["status"], "issued")
