"""Independent adversarial challenge, round 2: what is new in PILOT_CONTRACT §13.

Every test drives a *running* server in a separate OS process over HTTP (harness reused from
test_challenger_pilot.py) and checks the database through separate sqlite connections.

Tests whose docstring starts with "DEFECT" are expected to FAIL against commit 495629c; every other test documents
an attack that is resisted.
"""

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, ROOT)

from backend_support import Client, kestrel_body  # noqa: E402
from test_challenger_pilot import (Base, Srv, T0, SECRET, OWED_TOTAL, free_port,  # noqa: E402
                                   pool_map, w_command_retry)
import time  # noqa: E402

T1 = "2026-12-01T02:00:00Z"
T2 = "2026-12-01T03:00:00Z"
T3 = "2026-12-01T04:00:00Z"
T4 = "2026-12-01T05:00:00Z"
NO_MATCH = "No matching record in this provider's book."


def cmd_body(ctype, version, **params):
    return dict(params, type=ctype, idempotency_key=str(uuid.uuid4()), expected_version=version)


class B2(Base):
    def route(self, view, key="C"):
        return next(r for r in view["routes"] if r["key"] == key)

    def codes(self, view, key="C"):
        return sorted(b["code"] for b in self.route(view, key)["blockers"])

    def replay(self, c, cid, at):
        return c.get("/api/cases/%s?as_of=%s" % (cid, at))

    def update_facility(self, *args, check=True):
        return self.s.cli("update-facility", "--id", "FAC-HL-01", *args, check=check)

    def add_invoice(self, c, cid, ref, amount="61,400.00", currency="EUR", **extra):
        return c.cmd(cid, "add_observation", kind="invoice", amount=amount, currency=currency, invoice_ref=ref,
                     issuer="Lindqvist Optics AB", issued_at="2026-11-25T02:00:00Z", **extra)


# ================================================================ 1. decision record and as-of replay
class ReplayTest(B2):
    def test_replay_shows_only_what_was_known_then(self):
        op, rv, rv2 = self.client(), self.client("reviewer"), self.client("reviewer2")
        x = self.new_case(op, importer="Replay Importer")["id"]
        self.add_balance(op, x)
        y = self.new_case(op)["id"]
        self.add_balance(op, y)
        # T1: another case reserves capacity; X gets an invoice observation and an evidence file.
        self.restart(T1, op, rv, rv2)
        self.ok(op.cmd(y, "request_advance", reason="r"))
        self.ok(rv.cmd(y, "approve_and_reserve", reason="ok"))
        self.ok(op.evidence(x, "later.txt", "text/plain", b"later evidence"), 201)
        self.ok(self.add_invoice(op, x, "INV-LATER-1"))
        self.ok(op.cmd(x, "request_advance", reason="first request"))
        # T2: facility terms change; X is declined.
        self.restart(T2, op, rv, rv2)
        self.update_facility("--policy-version", "POL-HL v2", "--fee-flat", "999.00")
        self.ok(rv.cmd(x, "decline", reason="Not convinced"))
        # T3: new evidence, re-request, approved by a different reviewer.
        self.restart(T3, op, rv, rv2)
        self.add_balance(op, x, amount="25,000.00", as_of="2026-12-01T03:30:00Z")
        self.ok(op.cmd(x, "request_advance", reason="second request"))
        self.ok(rv2.cmd(x, "approve_and_reserve", reason="New balance is fine"))
        live = self.ok(op.case(x))

        r0 = self.ok(self.replay(op, x, "2026-12-01T01:30:00Z"))
        txt = json.dumps(r0)
        self.assertEqual(r0["actions"], [])
        self.assertIsNone(r0["version"])
        self.assertIn("Replay", r0["replay"]["note"])
        self.assertNotIn("INV-LATER-1", txt)
        self.assertNotIn("later.txt", txt)
        self.assertNotIn("Not convinced", txt)
        self.assertEqual(len(r0["evidence"]), 1)
        self.assertEqual(r0["status"], "assessing")
        self.assertEqual(r0["facility"]["reserved_other_cases"], "SGD 0.00")
        self.assertEqual(r0["facility"]["policy_version"], "POL-HL v2026.12-1")
        self.assertEqual(r0["decision_record"]["judgments"], [])
        self.assertTrue(all(cp["at"] <= "2026-12-01T01:30:00Z" for cp in r0["decision_record"]["checkpoints"]))

        r1 = self.ok(self.replay(op, x, "2026-12-01T02:30:00Z"))
        self.assertEqual(r1["status"], "awaiting_review")
        self.assertEqual(r1["facility"]["reserved_other_cases"], "SGD 89,450.25")
        self.assertEqual(r1["facility"]["policy_version"], "POL-HL v2026.12-1")

        r2 = self.ok(self.replay(op, x, "2026-12-01T03:30:00Z"))
        self.assertEqual(r2["status"], "declined")
        self.assertEqual(r2["facility"]["policy_version"], "POL-HL v2")
        self.assertEqual([j["decision"] for j in r2["decision_record"]["judgments"]], ["declined"])
        # A later approval never rewrites the earlier decline or earlier checkpoints.
        self.assertEqual([j["decision"] for j in live["decision_record"]["judgments"]], ["declined", "approved"])
        self.assertEqual(live["decision_record"]["judgments"][0], r2["decision_record"]["judgments"][0])
        n = len(r2["decision_record"]["checkpoints"])
        self.assertEqual(live["decision_record"]["checkpoints"][:n], r2["decision_record"]["checkpoints"])
        self.assertEqual(live["status"], "reserved")

    def test_replay_other_org_or_before_creation_is_404_and_leaks_nothing(self):
        a = self.client()
        cid = self.new_case(a, importer="Secret Replay Importer", supplier="Secret Replay Supplier")["id"]
        b = self.client("operator", "meridian")
        for at in (T0, "2026-12-01T01:00:00Z", "2030-01-01T00:00:00Z", "2000-01-01T00:00:00Z", "garbage"):
            r = self.replay(b, cid, at)
            self.assertIn(r.status, (404, 422), r)
            self.assertNotIn(b"Secret Replay", r.raw)
            self.assertNotIn(b"Kestrel", r.raw)
        r = self.replay(b, cid, "2030-01-01T00:00:00Z")
        self.assertEqual(r.status, 404, r)
        r = self.replay(a, cid, "2026-11-30T00:00:00Z")
        self.assertEqual(r.status, 404, r)
        self.assertNotIn(b"Secret Replay", r.raw)
        r = b.get("/api/cases/%s/report?format=html" % cid)
        self.assertEqual(r.status, 404, r)

    def test_replay_as_of_in_the_future_is_not_presented_as_known(self):
        """DEFECT (minor): as_of after the server clock is accepted and labelled 'Replay: shows only what was known
        at <future time>' with routes evaluated on the future clock — a projection presented as a record."""
        op = self.client()
        cid = self.new_case(op)["id"]
        self.add_balance(op, cid)
        r = self.replay(op, cid, "2026-12-05T00:00:00Z")
        if r.status == 200:
            self.assertLessEqual(r.json["replay"]["as_of"], T0, "replay claims knowledge at a future time: %s"
                                 % r.json["replay"]["note"])

    def test_client_cannot_set_known_at_or_checkpoint_timing(self):
        op = self.client()
        cid = self.new_case(op)["id"]
        ev = self.ok(op.evidence(cid, "b.csv", "text/csv", b"a,b\n1,2\n", known_at="2026-11-01T00:00:00Z"), 201)
        self.ok(op.cmd(cid, "add_observation", kind="balance", amount="20,000.00", currency="SGD",
                       as_of="2026-12-01T00:30:00Z", source="s", evidence_id=ev["evidence_added"]["id"],
                       known_at="2026-11-01T00:00:00Z", trigger="clock", trigger_event_seq=1,
                       at="2026-11-01T00:00:00Z"))
        rows = self.s.sql("SELECT type, known_at, payload FROM events WHERE case_id=?", (cid,))
        self.assertTrue(all(r["known_at"] == T0 for r in rows), rows)
        cps = [json.loads(r["payload"]) for r in rows if r["type"] == "eligibility_evaluated"]
        self.assertTrue(cps)
        self.assertNotIn("clock", [c["trigger"] for c in cps])
        self.assertEqual(self.s.scalar("SELECT known_at FROM evidence WHERE case_id=?", (cid,)), T0)


# ================================================================ 2. policy-required facts (§13.4)
class PolicyFactsTest(B2):
    def setUp(self):
        B2.setUp(self)
        self.op, self.rv = self.client(), self.client("reviewer")

    def invoice_policy(self):
        self.update_facility("--policy-version", "POL-HL inv", "--required-evidence", "invoice,balance")

    def test_wrong_currency_invoice_does_not_satisfy_invoice_policy(self):
        """DEFECT (material): with invoice required by policy, an invoice record whose reference matches but whose
        currency/amount have nothing to do with the case payout (USD 1.00 vs EUR 61,4xx) clears the policy
        blocker and route C becomes feasible; an advance can be requested and approved on it."""
        self.invoice_policy()
        body = kestrel_body()
        cid = self.new_case(self.op, **body)["id"]
        self.add_balance(self.op, cid)
        v = self.ok(self.op.case(cid))
        self.assertIn("policy_requires_invoice", self.codes(v))
        v = self.ok(self.add_invoice(self.op, cid, body["invoice_ref"], amount="1.00", currency="USD"))
        status = self.route(v)["status"]
        req = self.op.cmd(cid, "request_advance", reason="r").status
        appr = self.rv.cmd(cid, "approve_and_reserve", reason="ok").status
        self.assertNotEqual(status, "feasible", "USD 1.00 invoice cleared the invoice policy for an EUR %s payout "
                            "(request %d, approve %d)" % (body["payout_amount"], req, appr))

    def test_wrong_currency_balance_does_not_satisfy_balance_policy(self):
        """DEFECT (minor): route C's 'Policy requires balance' is cleared by a balance in a currency other than the
        funding currency (route A refuses to count the same record)."""
        cid = self.new_case(self.op)["id"]
        v = self.ok(self.op.cmd(cid, "add_observation", kind="balance", amount="5.00", currency="USD",
                                as_of="2026-12-01T00:30:00Z", source="s"))
        self.assertIn("balance_other_currency", self.codes(v, "A"))
        self.assertNotEqual(self.route(v)["status"], "feasible")

    def test_importer_scope_invoice_does_not_satisfy_case_invoice_policy(self):
        """DEFECT (minor): `scope` is stored but never evaluated; an importer-scoped invoice clears the case's
        invoice policy exactly like a case-scoped one."""
        self.invoice_policy()
        body = kestrel_body()
        cid = self.new_case(self.op, **body)["id"]
        self.add_balance(self.op, cid)
        v = self.ok(self.add_invoice(self.op, cid, body["invoice_ref"], amount=body["payout_amount"], scope="importer"))
        self.assertNotEqual(self.route(v)["status"], "feasible")

    def test_stale_conflicting_superseded_mismatched_future_evidence_never_clears(self):
        self.invoice_policy()
        body = kestrel_body()
        cid = self.new_case(self.op, **body)["id"]
        # stale balance (30 h old)
        v = self.ok(self.op.cmd(cid, "add_observation", kind="balance", amount="20,000.00", currency="SGD",
                                as_of="2026-11-29T19:00:00Z", source="s"))
        self.assertIn("policy_stale_balance", self.codes(v))
        # future-dated balance and invoice are refused
        r = self.op.cmd(cid, "add_observation", kind="balance", amount="20,000.00", currency="SGD",
                        as_of="2026-12-02T00:00:00Z", source="s")
        self.assertEqual(r.status, 422, r)
        r = self.op.cmd(cid, "add_observation", kind="invoice", amount="1.00", currency="EUR", invoice_ref=body["invoice_ref"],
                        issuer="x", issued_at="2026-12-03T00:00:00Z")
        self.assertEqual(r.status, 422, r)
        # wrong invoice reference
        v = self.ok(self.add_invoice(self.op, cid, "INV-SOMETHING-ELSE", amount=body["payout_amount"]))
        self.assertIn("invoice_ref_mismatch", self.codes(v))
        # two conflicting fresh balances at the same as-of
        self.ok(self.op.cmd(cid, "add_observation", kind="balance", amount="20,000.00", currency="SGD",
                            as_of="2026-12-01T00:30:00Z", source="s"))
        v = self.ok(self.op.cmd(cid, "add_observation", kind="balance", amount="21,000.00", currency="SGD",
                                as_of="2026-12-01T00:30:00Z", source="s"))
        self.assertIn("conflicting_balance", self.codes(v))
        self.assertNotEqual(self.route(v)["status"], "feasible")
        r = self.op.cmd(cid, "request_advance", reason="r")
        self.assertEqual(r.status, 409, r)
        # two conflicting invoices with the case reference
        self.ok(self.add_invoice(self.op, cid, body["invoice_ref"], amount=body["payout_amount"]))
        v = self.ok(self.add_invoice(self.op, cid, body["invoice_ref"], amount="70,000.00"))
        self.assertIn("conflicting_invoice", self.codes(v))
        # superseding one of the conflicting balances with a corrected amount (same as-of) leaves one active
        bal_ids = [o["event_id"] for o in v["observations"] if o["kind"] == "balance" and not o["struck"]]
        self.assertEqual(len(bal_ids), 3)
        self.assertEqual(self.route(v)["status"], "unknown")

    def test_complete_evidence_never_clears_cash_or_headroom(self):
        cid = self.new_case(self.op, funding_amount="650,000.00")["id"]
        self.add_balance(self.op, cid, amount="700,000.00")
        v = self.ok(self.op.case(cid))
        rc = self.route(v)
        self.assertEqual(rc["status"], "infeasible")
        self.assertEqual(rc["missing"], [])
        kinds = {b["kind"] for b in rc["blockers"]}
        self.assertTrue({"cash", "credit"} <= kinds, rc["blockers"])
        self.assertIn("even with complete evidence", v["decision"]["headline"])
        r = self.op.cmd(cid, "request_advance", reason="r")
        self.assertEqual(r.status, 409, r)

    def test_binding_constraint_names_money_when_cash_and_evidence_both_missing(self):
        """DEFECT (minor): A and B closed for non-evidence reasons, route C short of funding cash AND headroom and
        also missing the required balance. The decision names route A's passed cutoff as the binding constraint
        and offers 'Close with exception'; the money shortfall (which no evidence can fix) is not named."""
        cid = self.new_case(self.op, funding_amount="650,000.00", window_a_at="2026-11-30T07:00:00Z",
                            window_a_cutoff_at="2026-11-30T08:00:00Z")["id"]
        v = self.ok(self.op.case(cid))
        rc = self.route(v)
        self.assertEqual(rc["status"], "infeasible")
        self.assertTrue(rc["missing"])
        d = v["decision"]
        self.assertRegex((d["binding_constraint"] or "") + " " + d["headline"], r"(?i)funding cash|headroom",
                         "decision: %r" % d)


# ================================================================ 3. same-provider duplicate check (§13.7)
class DuplicateCheckTest(B2):
    def setUp(self):
        B2.setUp(self)
        self.op, self.rv = self.client(), self.client("reviewer")

    def test_cross_org_overlap_never_reveals_existence(self):
        a_body = kestrel_body(invoice_ref="INV-SHARED-1", supplier="Shared Supplier GmbH", payout_amount="10,000.00")
        a = self.new_case(self.op, **a_body)["id"]
        a_events = self.s.scalar("SELECT COUNT(*) FROM events WHERE case_id=?", (a,))
        b_op = self.client("operator", "meridian")
        b_body = kestrel_body(invoice_ref="inv shared 1", supplier="shared supplier gmbh", payout_amount="10,000.00")
        b = self.new_case(b_op, **b_body)
        self.assertEqual(b["duplicate_check"]["status"], "no_match")
        self.assertEqual(b["duplicate_check"]["text"], NO_MATCH)
        self.assertEqual(b["duplicate_check"]["matches"], [])
        self.assertNotIn(a.encode(), json.dumps(b).encode())
        # Same shape as a case with a never-seen reference.
        c = self.new_case(b_op, **kestrel_body(invoice_ref="INV-NEVER-SEEN", supplier="Other Supplier"))
        self.assertEqual(sorted(b["duplicate_check"]), sorted(c["duplicate_check"]))
        self.assertEqual(b["duplicate_check"]["text"], c["duplicate_check"]["text"])
        r = b_op.cmd(b["id"], "add_observation", kind="invoice", amount="10,000.00", currency="EUR",
                     invoice_ref="INV-SHARED-1", issuer="x", issued_at="2026-11-25T00:00:00Z")
        self.assertEqual(r.json["duplicate_check"]["status"], "no_match")
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM events WHERE case_id=?", (a,)), a_events)
        self.assertNotIn("financed elsewhere", json.dumps(b).lower())

    def test_same_org_match_blocks_request_and_duplicate_allows_only_duplicate_case_close(self):
        body = kestrel_body(invoice_ref="INV-DUP-1")
        first = self.new_case(self.op, **body)["id"]
        dup = self.new_case(self.op, **dict(body, invoice_ref="inv/dup-1", idempotency_key=str(uuid.uuid4()),
                                            payout_amount="1.00"))
        self.assertEqual(dup["duplicate_check"]["status"], "potential_match")
        self.assertEqual(dup["duplicate_check"]["matches"], [first])
        cid = dup["id"]
        self.add_balance(self.op, cid)
        r = self.op.cmd(cid, "request_advance", reason="r")
        self.assertEqual(r.status, 409, r)
        self.assertEqual(r.code, "potential_duplicate")
        self.assertEqual(self.op.cmd(cid, "resolve_duplicate_check", decision="duplicate", reason="x").status, 403)
        self.ok(self.rv.cmd(cid, "resolve_duplicate_check", decision="duplicate", reason="Same invoice"))
        for ctype, p in (("request_advance", {"reason": "r"}), ("select_route", {"route": "A"})):
            r = self.op.cmd(cid, ctype, **p)
            self.assertEqual(r.status, 409, (ctype, r))
        r = self.rv.cmd(cid, "resolve_duplicate_check", decision="not_duplicate", reason="changed my mind")
        self.assertEqual(r.status, 409, r)
        for d in ("write_off_referred", "other_documented", "cancelled_before_payout", "supplier_paid_outside"):
            r = self.rv.cmd(cid, "close_with_exception", disposition=d, reason="x")
            self.assertEqual(r.status, 409, (d, r))
        # supersede / new invoice cannot re-open the case for financing
        v = self.ok(self.add_invoice(self.op, cid, "INV-TOTALLY-NEW"))
        self.assertEqual(v["duplicate_check"]["status"], "duplicate")
        self.ok(self.rv.cmd(cid, "close_with_exception", disposition="duplicate_case", reason="dup"))

    def test_second_invoice_observation_silently_clears_potential_match(self):
        """DEFECT (material): a potential match raised by an invoice observation is cleared, with no reviewer,
        by adding a second invoice observation with a non-matching reference: the re-check only looks at the
        case's own invoice_ref plus the NEWEST invoice, not the still-active matching one. request_advance is
        then accepted and the advance can be approved."""
        other = kestrel_body(invoice_ref="INV-BOOKED-77")
        self.new_case(self.op, **other)
        cid = self.new_case(self.op, invoice_ref="INV-OWN-1")["id"]
        self.add_balance(self.op, cid)
        v = self.ok(self.add_invoice(self.op, cid, "INV-BOOKED-77"))
        self.assertEqual(v["duplicate_check"]["status"], "potential_match")
        v = self.ok(self.add_invoice(self.op, cid, "INV-OWN-1"))
        self.assertTrue(any("INV-BOOKED-77" in o["text"] and not o["struck"] for o in v["observations"]),
                        "matching invoice still active")
        status = v["duplicate_check"]["status"]
        req = self.op.cmd(cid, "request_advance", reason="r").status
        appr = self.rv.cmd(cid, "approve_and_reserve", reason="ok").status
        self.assertEqual(status, "potential_match", "potential match cleared without a reviewer (request %d, "
                         "approve %d)" % (req, appr))

    def test_potential_match_raised_after_request_does_not_block_approval(self):
        """DEFECT (material): request the advance first, then add the invoice that matches another case: the
        duplicate check turns potential_match but approve_and_reserve still succeeds — the reviewer approves
        while the same-provider duplicate check is unresolved (the decision headline even hides it)."""
        self.new_case(self.op, **kestrel_body(invoice_ref="INV-BOOKED-88"))
        cid = self.new_case(self.op, invoice_ref="INV-OWN-2")["id"]
        self.add_balance(self.op, cid)
        self.ok(self.op.cmd(cid, "request_advance", reason="r"))
        v = self.ok(self.add_invoice(self.op, cid, "INV-BOOKED-88"))
        self.assertEqual(v["duplicate_check"]["status"], "potential_match")
        r = self.rv.cmd(cid, "approve_and_reserve", reason="ok")
        self.assertEqual(r.status, 409, "approved with an unresolved potential duplicate: %r" % (r,))

    def test_import_and_race_cannot_bypass_the_check(self):
        with open(os.path.join(HERE, "fixtures_v2_sample.csv"), encoding="utf-8") as fh:
            sample = fh.read().splitlines()
        header, row = sample[1], sample[2]
        row = row.replace("2026-12-03 09:00", "2026-12-01 08:00")
        cols = next(__import__("csv").reader([header]))
        vals = next(__import__("csv").reader([row]))
        rec = dict(zip(cols, vals))
        # an existing API case with the same supplier + invoice reference
        self.new_case(self.op, **kestrel_body(supplier=rec["supplier"], invoice_ref=rec["invoice_ref"]))
        import csv as _csv
        import io
        buf = io.StringIO()
        w = _csv.writer(buf, lineterminator="\n")
        w.writerow(cols)
        w.writerow(vals)
        vals2 = list(vals)
        vals2[cols.index("reference")] = "PO-OTHER"
        vals2[cols.index("payout_amount")] = "31,401.00"
        w.writerow(vals2)  # second row in the same file: same invoice ref, sees the first row too
        r = self.op.req("POST", "/api/cases/import", {"csv": "#clearline-cases v2\n" + buf.getvalue()})
        self.assertEqual(r.status, 200, r)
        for nid in r.json["created"]:
            v = self.ok(self.op.case(nid))
            self.assertEqual(v["duplicate_check"]["status"], "potential_match", nid)
        # two reviewers race the resolution: exactly one judgment is recorded
        nid = r.json["created"][0]
        rv2 = self.client("reviewer2")
        res = pool_map(w_command_retry, [(self.s.port, c.cookie, c.csrf, nid, "resolve_duplicate_check",
                                          {"decision": d, "reason": "race"}, time.time() + 0.5)
                                         for c, d in ((self.rv, "not_duplicate"), (rv2, "duplicate"))])
        self.assertEqual(sorted(s for s, _ in res), [200, 409], res)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM events WHERE case_id=? AND type='duplicate_check_resolved'",
                                       (nid,)), 1)


# ================================================================ 4. facility policy versions (§13.1)
class FacilityVersionTest(B2):
    def setUp(self):
        B2.setUp(self)
        self.op, self.rv = self.client(), self.client("reviewer")

    def test_existing_approval_keeps_its_version_fee_and_due(self):
        cid = self.reserved(self.op, self.rv)
        before = self.ok(self.op.case(cid))
        self.update_facility("--policy-version", "POL-HL v9", "--fee-flat", "999.00", "--repayment-days", "30",
                             "--fee-bps", "50")
        v = self.ok(self.op.cmd(cid, "record_draw", reference="D-1"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD " + OWED_TOTAL)
        self.assertEqual(v["exposure_panel"]["due_at_utc"], before["exposure_panel"]["due_at_utc"])
        appr = [j for j in v["decision_record"]["judgments"] if j["decision"] == "approved"][0]
        self.assertEqual(appr["policy_version"], "POL-HL v2026.12-1")
        self.assertEqual(self.s.scalar("SELECT fee_minor FROM draws WHERE case_id=?", (cid,)), 15000)
        # a new case binds to the version in force when the reviewer acts
        c2 = self.reserved(self.op, self.rv)
        v2 = self.ok(self.op.case(c2))
        appr2 = [j for j in v2["decision_record"]["judgments"] if j["decision"] == "approved"][0]
        self.assertEqual(appr2["policy_version"], "POL-HL v9")

    def test_live_view_of_reserved_case_states_the_approved_terms(self):
        """DEFECT (minor): after update-facility, a case reserved under POL v2026.12-1 (fee SGD 150.00) shows
        route C cost 'SGD 1,446.98 facility fee (policy POL-HL v9)' and header policy POL-HL v9, though the draw
        will charge the approved SGD 150.00."""
        cid = self.reserved(self.op, self.rv)
        self.update_facility("--policy-version", "POL-HL v9", "--fee-flat", "999.00", "--fee-bps", "50")
        v = self.ok(self.op.case(cid))
        rc = self.route(v)
        self.assertEqual(rc["fee"], "SGD 150.00", rc["cost"])
        self.assertEqual(v["header"]["policy_version"], "POL-HL v2026.12-1")

    def test_repayment_allocation_uses_the_approved_terms(self):
        """DEFECT (material): allocation is a facility term but is not bound at approval; changing the facility to
        principal_first after a fees_first approval re-orders how the importer's repayment is applied to this
        existing advance (SGD 1,000.00 goes to principal instead of fee 150.00 + principal 850.00)."""
        cid = self.credited(self.op, self.rv)
        self.update_facility("--policy-version", "POL-HL pf", "--allocation", "principal_first")
        self.ok(self.op.cmd(cid, "record_repayment", amount="1,000.00", currency="SGD", bank_ref="BR-1"))
        v = self.ok(self.op.case(cid))
        rid = v["collections"]["repayments"][0]["id"]
        v = self.ok(self.op.cmd(cid, "match_repayment", repayment_id=rid))
        m = v["collections"]["matches"][0]
        self.assertEqual((m["fees"], m["principal"]), ("SGD 150.00", "SGD 850.00"), m)

    def test_policy_change_cannot_reuse_a_version_or_skip_one(self):
        r = self.update_facility("--fee-flat", "1.00", "--policy-version", "POL-HL v2026.12-1", check=False)
        self.assertNotEqual(r.returncode, 0)
        r = self.update_facility("--policy-version", "POL-NOCHANGE", check=False)
        self.assertNotEqual(r.returncode, 0)
        n = self.s.scalar("SELECT COUNT(*) FROM facility_versions WHERE facility_id='FAC-HL-01'")
        with self.assertRaises(sqlite3.DatabaseError):
            self.s.sql("UPDATE facility_versions SET terms='{}'")
        with self.assertRaises(sqlite3.DatabaseError):
            self.s.sql("DELETE FROM facility_versions")
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM facility_versions WHERE facility_id='FAC-HL-01'"), n)


# ================================================================ 5. re-request after decline
class ReRequestTest(B2):
    def test_decline_stays_and_rerequest_needs_new_evidence_and_four_eyes(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.requested(op)
        self.ok(rv.cmd(cid, "decline", reason="Insufficient comfort"))
        for _ in range(2):
            r = op.cmd(cid, "request_advance", reason="again")
            self.assertEqual(r.status, 409, r)
        self.ok(op.cmd(cid, "add_note", text="please"))
        self.ok(op.cmd(cid, "log_work", minutes=5, activity="chasing"))
        self.assertEqual(op.cmd(cid, "request_advance", reason="again").status, 409)
        self.assertEqual(rv.cmd(cid, "approve_and_reserve", reason="x").status, 409)
        self.add_balance(op, cid, amount="30,000.00", as_of="2026-12-01T00:45:00Z")
        self.ok(op.cmd(cid, "request_advance", reason="again"))
        self.assertEqual(op.cmd(cid, "approve_and_reserve", reason="x").status, 403)
        self.ok(rv.cmd(cid, "approve_and_reserve", reason="ok now"))
        self.assertEqual(op.cmd(cid, "request_advance", reason="third").status, 409)
        self.assertEqual(self.s.scalar("SELECT COUNT(*) FROM reservations WHERE case_id=? AND status='active'",
                                       (cid,)), 1)
        v = self.ok(op.case(cid))
        self.assertEqual([j["decision"] for j in v["decision_record"]["judgments"]], ["declined", "approved"])
        self.assertIn("advance_declined", [t["type"] for t in v["timeline"]])
        with self.assertRaises(sqlite3.DatabaseError):
            self.s.sql("DELETE FROM events WHERE case_id=? AND type='advance_declined'", (cid,))
        self.facility_ok()


# ================================================================ 6. measurement and report (§13.9)
class MeasurementTest(B2):
    def closed_case(self, op, rv):
        cid = self.credited(op, rv)
        self.ok(op.cmd(cid, "record_repayment", amount=OWED_TOTAL, currency="SGD", bank_ref="BR-FULL"))
        rid = self.ok(op.case(cid))["collections"]["repayments"][0]["id"]
        self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
        self.ok(op.cmd(cid, "close_case"))
        return cid

    def test_measurement_on_closed_case_changes_no_money_or_status_and_is_scoped(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.closed_case(op, rv)
        before = self.ok(op.case(cid))
        money = lambda v: (v["status"], v["exposure_panel"], v["collections"], v["supplier_panel"], v["routes"])  # noqa
        tables = lambda: (self.s.sql("SELECT * FROM draws"), self.s.sql("SELECT * FROM reservations"),  # noqa
                          self.s.sql("SELECT * FROM payouts"))
        t0 = tables()
        xss = "<script>alert(1)</script><img src=x onerror=alert(2)>"
        self.ok(op.cmd(cid, "log_work", minutes=30, activity=xss))
        self.ok(rv.cmd(cid, "record_baseline", provenance="synthetic", operator_minutes=240, touchpoints=14,
                       decision_hours=30, deadline_met=False, outcome=xss, source_note=xss))
        after = self.ok(op.case(cid))
        self.assertEqual(money(before), money(after))
        self.assertEqual(t0, tables())
        viewer = self.client("viewer")
        self.assertEqual(viewer.cmd(cid, "log_work", minutes=5, activity="x").status, 403)
        self.assertEqual(viewer.cmd(cid, "record_baseline", provenance="recorded", source_note="x").status, 403)
        b = self.client("operator", "meridian")
        self.assertEqual(b.cmd(cid, "log_work", version=after["version"], minutes=5, activity="x").status, 404)
        self.assertEqual(b.cmd(cid, "record_baseline", version=after["version"], provenance="recorded",
                               source_note="x").status, 404)
        for bad in ({"provenance": "recorded_by_bank", "source_note": "x"}, {"provenance": "synthetic"},
                    {"provenance": "synthetic", "source_note": "x", "operator_minutes": -1},
                    {"provenance": "synthetic", "source_note": "x", "deadline_met": "yes"}):
            self.assertEqual(rv.cmd(cid, "record_baseline", **bad).status, 422, bad)
        self.assertEqual(op.cmd(cid, "log_work", minutes=5, activity="x", provenance="recorded").status, 422)
        rep = self.ok(op.get("/api/cases/%s/report?format=json" % cid))
        for row in rep["rows"]:
            if row["baseline"]["value"] is not None:
                self.assertEqual(row["baseline"]["label"], "synthetic", row)
        txt = json.dumps(rep).lower()
        for bad in ("capital released", "principal", "credit risk"):
            # only allowed inside the explicit not-savings statement
            self.assertEqual(txt.count(bad), json.dumps(rep["not_savings"]).lower().count(bad), bad)
        self.assertNotIn("saving\"", txt)
        html = op.get("/api/cases/%s/report?format=html" % cid)
        self.assertEqual(html.status, 200)
        self.assertNotIn(b"<script>alert", html.raw)
        self.assertNotIn(b"<img src=x", html.raw)
        self.assertIn(b"&lt;script&gt;", html.raw)
        self.assertIn("script-src 'self'", html.headers.get("content-security-policy", ""))
        self.assertEqual(b.get("/api/cases/%s/report?format=json" % cid).status, 404)


# ================================================================ 7. overdue vs default (§13.8)
class DefaultTest(B2):
    def test_declare_default_role_timing_once_and_exposure_kept(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.credited(op, rv)
        self.assertEqual(op.cmd(cid, "declare_default", reason="x").status, 403)
        r = rv.cmd(cid, "declare_default", reason="too early")
        self.assertEqual((r.status, r.code), (409, "not_overdue"))
        self.restart("2026-12-08T01:00:00Z", op, rv)
        v = self.ok(op.case(cid))
        self.assertEqual(v["exposure_panel"]["status_label"], "Overdue — not a default determination")
        self.assertIsNone(v["exposure_panel"]["default_declared"])
        self.assertEqual(op.cmd(cid, "declare_default", reason="x").status, 403)
        v = self.ok(rv.cmd(cid, "declare_default", reason="Importer unresponsive"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD " + OWED_TOTAL)
        self.assertIn("Default declared by a reviewer", v["exposure_panel"]["status_label"])
        r = rv.cmd(cid, "declare_default", reason="again")
        self.assertEqual((r.status, r.code), (409, "already_declared"))
        self.assertEqual(self.s.scalar("SELECT principal_minor - principal_repaid_minor FROM draws WHERE case_id=?",
                                       (cid,)), 8945025)
        self.ok(op.cmd(cid, "record_repayment", amount="100.00", currency="SGD", bank_ref="BR-AFTER"))
        self.facility_ok()


# ================================================================ 8. id leak (not fixed by the per-org case numbering)
class IdLeakTest(B2):
    def test_event_and_evidence_ids_do_not_reveal_other_orgs_activity(self):
        """DEFECT (minor): observation event ids (`observations[].event_id`, timeline `event_id`) and evidence ids
        (`EV-n`) come from global autoincrement counters shared by every organisation, so org B can measure org
        A's activity volume between two of its own requests — the same class of leak d94177e fixed for case ids."""
        b = self.client("operator", "meridian")
        bc = self.new_case(b)["id"]
        e1 = self.ok(b.evidence(bc, "a.txt", "text/plain", b"1"), 201)["evidence_added"]["id"]
        o1 = max(t["event_id"] for t in self.ok(b.case(bc))["timeline"])
        a = self.client()
        for _ in range(3):
            ac = self.new_case(a)["id"]
            self.ok(a.evidence(ac, "a.txt", "text/plain", b"1"), 201)
        e2 = self.ok(b.evidence(bc, "b.txt", "text/plain", b"2"), 201)["evidence_added"]["id"]
        o2 = min(t["event_id"] for t in self.ok(b.case(bc))["timeline"] if t["event_id"] > o1)
        self.assertTrue(int(e2[3:]) - int(e1[3:]) == 1 and o2 - o1 < 5,
                        "evidence id jumped %s -> %s; event id jumped %d -> %d" % (e1, e2, o1, o2))


# ================================================================ 9. migration from d94177e mid-lifecycle
class MigrationTest(unittest.TestCase):
    BASELINE = "d94177e"

    def test_upgrade_with_reserved_and_drawn_cases_keeps_identities_capacity_and_replay(self):
        work = tempfile.mkdtemp(prefix="pilot-chal2-mig-")
        try:
            tar = subprocess.run(["git", "-C", os.path.dirname(ROOT), "archive", self.BASELINE, "funding-replay/pilot"],
                                 capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", work], input=tar, check=True)
            old = os.path.join(work, "funding-replay")
            s = Srv(db_path=os.path.join(work, "old.db"), seed=False)
            run = lambda cwd, *a: subprocess.run([sys.executable, "-m", "pilot.cli"] + list(a), cwd=cwd,  # noqa
                                                 env=s.envd(), capture_output=True, text=True, check=True)
            run(old, "migrate")
            run(old, "seed")
            port = free_port()
            p = subprocess.Popen([sys.executable, "-m", "pilot.cli", "serve", "--port", str(port)], cwd=old,
                                 env=s.envd(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(200):
                    try:
                        op = Client(port)
                        if op.login("operator@harbourline.test", "pilot-dev-operator").status == 200:
                            break
                    except OSError:
                        time.sleep(0.05)
                rv = Client(port)
                rv.login("reviewer@harbourline.test", "pilot-dev-reviewer")
                ids = {}
                for name in ("reserved", "drawn", "assessing"):
                    body = kestrel_body()
                    body.pop("invoice_ref")
                    r = op.req("POST", "/api/cases", body)
                    self.assertEqual(r.status, 201, r)
                    cid = r.json["id"]
                    ids[name] = cid
                    if name == "assessing":
                        continue
                    ev = op.evidence(cid, "b.csv", "text/csv", b"a,b\n1,2\n").json["evidence_added"]["id"]
                    self.assertEqual(op.cmd(cid, "add_observation", kind="balance", amount="20,000.00", currency="SGD",
                                            as_of="2026-12-01T00:30:00Z", source="s", evidence_id=ev).status, 200)
                    self.assertEqual(op.cmd(cid, "request_advance", reason="r").status, 200)
                    self.assertEqual(rv.cmd(cid, "approve_and_reserve", reason="ok").status, 200)
                    if name == "drawn":
                        self.assertEqual(op.cmd(cid, "record_draw", reference="D").status, 200)
            finally:
                p.terminate()
                p.wait(10)
            before = {c: s.sql("SELECT seq, type, payload, known_at FROM events WHERE case_id=? ORDER BY seq", (c,))
                      for c in ids.values()}
            totals = (s.scalar("SELECT SUM(amount_minor) FROM reservations WHERE status IN ('active')"),
                      s.scalar("SELECT SUM(principal_minor) FROM draws"))
            s.cli("migrate")
            s.cli("check")
            s.start()
            try:
                op = Client(s.port)
                op.login("operator@harbourline.test", "pilot-dev-operator")
                rv = Client(s.port)
                rv.login("reviewer@harbourline.test", "pilot-dev-reviewer")
                for c in ids.values():
                    v = op.case(c)
                    self.assertEqual(v.status, 200, v)
                    self.assertTrue(all(i["ok"] for i in v.json["identities"]), v.json["identities"])
                    self.assertEqual(v.json["duplicate_check"]["status"], "not_checked")
                    rp = op.get("/api/cases/%s?as_of=%s" % (c, T0))
                    self.assertEqual(rp.status, 200, rp)
                    self.assertEqual(rp.json["status"], v.json["status"])
                    self.assertEqual(op.get("/api/cases/%s/report?format=json" % c).status, 200)
                fac = op.get("/api/facilities").json["facilities"][0]
                self.assertTrue(fac["identity"]["ok"])
                self.assertEqual(fac["reserved"], "SGD 89,450.25")
                self.assertEqual(fac["principal_outstanding"], "SGD 89,450.25")
                rp = op.get("/api/cases/%s?as_of=%s" % (ids["assessing"], T0)).json
                self.assertEqual(rp["facility"]["reserved_other_cases"], "SGD 89,450.25")
                self.assertEqual(rp["facility"]["principal_outstanding_other_cases"], "SGD 89,450.25")
                # the lifecycle continues on the new build
                v = op.cmd(ids["reserved"], "record_draw", reference="D2")
                self.assertEqual(v.status, 200, v)
                v = op.cmd(ids["drawn"], "instruct_payout", route="manual", external_ref="EXT-M1")
                self.assertEqual(v.status, 200, v)
                r = op.cmd(ids["assessing"], "request_advance", reason="r")
                self.assertEqual(r.status, 409, r)  # no balance: policy blocker, not a crash
                for c in ids.values():
                    after = s.sql("SELECT seq, type, payload, known_at FROM events WHERE case_id=? ORDER BY seq", (c,))
                    self.assertEqual(after[:len(before[c])], before[c])
                fac = op.get("/api/facilities").json["facilities"][0]
                self.assertTrue(fac["identity"]["ok"])
                self.assertEqual(fac["principal_outstanding"], "SGD 178,900.50")
                self.assertEqual(totals, (8945025, 8945025))
                self.assertEqual(s.scalar("SELECT COUNT(*) FROM facility_versions"), 2)
            finally:
                s.stop()
        finally:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
