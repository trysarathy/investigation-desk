"""Brief v2 release scenarios A, G and H, run against the real HTTP server (separate OS process) on a temp database,
with two separately signed-in users, a controlled clock and server restarts. No SQL is used to perform user actions
(SQL is only used to read back and check the database boundary).

Scenario A is run twice: the brief's exact worked amounts, then different operator-entered amounts, so the outcome
must be calculated rather than hard-coded. B/C/D/E/F are covered by test_v2_*.py, test_challenger_pilot.py and
test_integration_fixes.py; see docs/pilot/TRACEABILITY.md.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_challenger_pilot as C  # noqa: E402  (real-server harness)
from backend_support import Client  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
T_MON = "2026-12-07T01:00:00Z"   # Mon 7 Dec 2026 09:00 SGT
T_TUE = "2026-12-08T01:30:00Z"   # Tue 8 Dec 09:30 SGT (next day)
T_FRI = "2026-12-11T02:00:00Z"   # Fri 11 Dec 10:00 SGT (repayment day)
PW = {"op": "scn-operator-pass-1", "rv": "scn-reviewer-pass-1"}


def minor(s):
    """'SGD 16,860.00' -> 1686000 (test-side reconstruction only)."""
    amt = s.split(" ", 1)[1].replace(",", "")
    whole, _, frac = amt.partition(".")
    return int(whole) * 100 + int((frac + "00")[:2])


class Blank(unittest.TestCase):
    """A blank organisation provisioned only through the CLI: users and one facility, no cases, no seed."""

    def setUp(self):
        self.s = C.Srv(clock=T_MON, seed=False)
        self.s.cli("migrate")
        self.s.cli("create-org", "--name", "Saltmarsh Payments (Synthetic)", "--id", "ORG-SM")
        for key, email, name, role in (("op", "ops@saltmarsh.test", "Priya Nair", "operator"),
                                       ("rv", "credit@saltmarsh.test", "Daniel Koh", "reviewer")):
            env = self.s.envd()
            env["PILOT_NEW_PASSWORD"] = PW[key]
            r = subprocess.run([sys.executable, "-m", "pilot.cli", "create-user", "--org", "ORG-SM", "--email", email,
                                "--name", name, "--role", role], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr + r.stdout)
        self.s.cli("create-facility", "--org", "ORG-SM", "--id", "FAC-SM-01", "--name", "Supplier advance (Synthetic)",
                   "--currency", "SGD", "--limit", "120,000.00", "--fee-flat", "60.00", "--fee-bps", "0",
                   "--allocation", "fees_first", "--funding-cash", "80,000.00", "--policy-version", "POL-SM v1",
                   "--required-evidence", "balance")
        self.s.start(T_MON)

    def tearDown(self):
        self.s.close()

    def login(self, key):
        c = Client(self.s.port)
        email = {"op": "ops@saltmarsh.test", "rv": "credit@saltmarsh.test"}[key]
        self.assertEqual(c.login(email, PW[key]).status, 200)
        c._who = (email, PW[key])
        return c

    def restart(self, clock, *clients):
        self.s.restart(clock)
        for c in clients:
            c.port = self.s.port
            self.assertEqual(c.login(*c._who).status, 200)

    def ok(self, r, status=200):
        self.assertEqual(r.status, status, r)
        return r.json


class ScenarioA(Blank):
    def run_deal(self, payout, funding, invoice_ref, repay1, expect):
        op, rv = self.login("op"), self.login("rv")
        self.assertEqual(self.ok(op.get("/api/cases?q="))["results"], [], "workspace must start blank")
        body = {"importer": "Halyard Coffee Traders Pte Ltd", "supplier": "Finca Altamira Exportadora",
                "payout_amount": payout, "payout_currency": "USD", "funding_amount": funding, "funding_currency": "SGD",
                "quote_ref": "Q-" + invoice_ref, "quote_source": "Provider FX desk (operator-entered)",
                "quote_at": "2026-12-07T00:45:00Z", "invoice_ref": invoice_ref, "customer_ref": "HCT-PO-" + invoice_ref[-4:],
                "deadline_at": "2026-12-10T09:00:00Z", "deadline_tz": "Asia/Singapore",
                "window_a_at": "2026-12-08T02:00:00Z", "window_a_cutoff_at": "2026-12-08T05:00:00Z",
                "later_permitted": False, "contract_ref": "MSA-HCT-2026", "facility_id": "FAC-SM-01",
                "reference": invoice_ref, "idempotency_key": "scn-a-" + invoice_ref,
                "observations": [{"kind": "balance", "amount": "1,250.00", "currency": "SGD", "as_of": "2026-12-07T00:30:00Z",
                                  "source": "Importer bank portal (operator-entered)", "provenance": "operator_entered"},
                                 {"kind": "expected_receipt", "amount": "40,000.00", "currency": "SGD",
                                  "expected_at": "2026-12-10T06:00:00Z", "payer": "Importer's customer (forecast)",
                                  "provenance": "operator_entered"}]}
        v = self.ok(op.req("POST", "/api/cases", body), 201)
        cid = v["id"]
        self.assertTrue(cid.startswith("CL-2026-SM-"), cid)
        self.assertEqual(v["duplicate_check"]["text"], "No matching record in this provider's book.")
        self.assertEqual([r["status"] for r in v["routes"]][2], "feasible", v["routes"])
        self.ok(op.cmd(cid, "request_advance", reason="Importer cash SGD 1,250.00; receivable only after the deadline."))
        # ---- restart; a different user recovers the same case and reserves
        self.restart(T_MON, op, rv)
        v = self.ok(rv.case(cid))
        self.assertEqual(v["id"], cid)
        self.assertEqual(op.cmd(cid, "approve_and_reserve", reason="self-approval attempt").status, 403)
        v = self.ok(rv.cmd(cid, "approve_and_reserve", reason="Fresh balance; within POL-SM v1 limits."))
        e = v["exposure_panel"]
        self.assertEqual((e["status"], e["reserved"], e["principal_outstanding"]), ("reserved", "SGD " + funding, "SGD 0.00"))
        # ---- draw once
        self.restart(T_TUE, op, rv)
        v = self.ok(op.cmd(cid, "record_draw", reference="DRW-" + invoice_ref))
        self.assertEqual(op.cmd(cid, "record_draw", reference="DRW-again").status, 409)
        e = v["exposure_panel"]
        self.assertEqual((e["reserved"], e["principal_outstanding"], e["fees_outstanding"]), ("SGD 0.00", "SGD " + funding, "SGD 60.00"))
        # ---- instruction and acceptance are not supplier credit
        v = self.ok(op.cmd(cid, "instruct_payout", route="manual", external_ref="BANK-" + invoice_ref))
        self.assertEqual(v["supplier_panel"]["status"], "instructed")
        v = self.ok(op.cmd(cid, "record_delivery", status="accepted", reference="ACK-" + invoice_ref))
        self.assertEqual(v["supplier_panel"]["status"], "accepted")
        self.assertNotIn("credited", v["decision"]["headline"].lower())
        v = self.ok(op.cmd(cid, "record_delivery", status="credited", reference="MT103-" + invoice_ref))
        self.assertEqual(v["supplier_panel"]["status"], "credited")
        self.assertEqual(v["exposure_panel"]["total_outstanding"], expect["owed"])
        self.assertIn("Supplier credited", v["decision"]["headline"])
        self.assertIn(expect["owed"], v["decision"]["headline"])
        # ---- importer's own receipt changes nothing
        self.restart(T_FRI, op, rv)
        v = self.ok(op.cmd(cid, "record_customer_receipt", amount="40,000.00", currency="SGD", reference="CUST-RCPT"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], expect["owed"])
        # ---- partial, then balance
        v = self.ok(op.cmd(cid, "record_repayment", amount=repay1, currency="SGD", bank_ref="RP1-" + invoice_ref))
        rid = v["collections"]["repayments"][0]["id"]
        v = self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
        al = v["collections"]["repayments"][0]["allocation"]
        self.assertEqual((al["fees"], al["principal"]), ("SGD 60.00", expect["principal_paid_1"]))
        self.assertEqual(v["exposure_panel"]["principal_outstanding"], expect["remaining"])
        self.assertEqual(v["exposure_panel"]["fees_outstanding"], "SGD 0.00")
        bal = expect["remaining"].split(" ", 1)[1]
        v = self.ok(op.cmd(cid, "record_repayment", amount=bal, currency="SGD", bank_ref="RP2-" + invoice_ref))
        rid2 = [r for r in v["collections"]["repayments"] if r["status"] == "unallocated"][0]["id"]
        v = self.ok(op.cmd(cid, "match_repayment", repayment_id=rid2))
        self.assertEqual(v["exposure_panel"]["status"], "ended")
        self.assertEqual([u for u in v["collections"]["unmatched"] if u.get("status") not in ("returned",)], [])
        self.assertTrue(all(i["ok"] for i in v["identities"]), v["identities"])
        v = self.ok(op.cmd(cid, "close_case"))
        self.assertIn("closed", v["status"])
        fac = [f for f in self.ok(op.get("/api/facilities"))["facilities"] if f["id"] == "FAC-SM-01"][0]
        self.assertEqual((fac["available"], fac["principal_outstanding"]), ("SGD 120,000.00", "SGD 0.00"))
        # ---- reconstruct every figure from the exported history alone
        st, x = None, self.ok(op.get("/api/cases/%s/export?format=json" % cid))
        ev = x["events"]
        tot = lambda t, k: sum(e["payload"].get(k, 0) for e in ev if e["type"] == t)  # noqa: E731
        drawn, fee = tot("draw_recorded", "principal_minor"), tot("draw_recorded", "fee_minor")
        self.assertEqual(drawn, minor("SGD " + funding))
        self.assertEqual(fee, 6000)
        self.assertEqual(tot("repayment_matched", "fees_minor"), fee)
        self.assertEqual(tot("repayment_matched", "principal_minor"), drawn)
        self.assertEqual(tot("repayment_recorded", "amount_minor"), drawn + fee)
        self.assertEqual(tot("customer_receipt_recorded", "amount_minor"), 4000000)
        appr = [e for e in ev if e["type"] == "advance_approved"][0]
        self.assertEqual((appr["actor_name"], appr["actor_role"], appr["payload"]["policy_version"]), ("Daniel Koh", "reviewer", "POL-SM v1"))
        self.assertTrue(all(e["known_at"] and e["provenance"] for e in ev))
        return cid

    def test_A_exact_worked_amounts(self):
        self.run_deal("12,400.00", "16,800.00", "INV-FA-2026-0042", "6,000.00",
                      {"owed": "SGD 16,860.00", "principal_paid_1": "SGD 5,940.00", "remaining": "SGD 10,860.00"})

    def test_A_different_amounts_are_calculated(self):
        self.run_deal("7,315.55", "9,912.47", "INV-FA-2026-0917", "3,333.33",
                      {"owed": "SGD 9,972.47", "principal_paid_1": "SGD 3,273.33", "remaining": "SGD 6,639.14"})


class ScenarioG(unittest.TestCase):
    """Upgrade a database created by the repository baseline (d94177e), back it up, restore into a different blank
    location, sign in and reconcile balances, ownership and audit history."""

    BASELINE = "d94177e"

    def test_upgrade_backup_restore_reconcile(self):
        work = tempfile.mkdtemp(prefix="pilot-g-")
        try:
            base_src = os.path.join(work, "baseline")
            os.makedirs(base_src)
            tar = subprocess.run(["git", "-C", ROOT, "archive", self.BASELINE, "funding-replay/pilot"], capture_output=True, check=True).stdout
            subprocess.run(["tar", "-x", "-C", base_src], input=tar, check=True)
            old = os.path.join(base_src, "funding-replay")
            db = os.path.join(work, "baseline.db")
            env = dict(os.environ, PILOT_ENV="test", PILOT_DB=db, PILOT_SECRET=C.SECRET, PILOT_CLOCK=C.T0)
            run = lambda cwd, *a: subprocess.run([sys.executable, "-m", "pilot.cli"] + list(a), cwd=cwd, env=env,  # noqa: E731
                                                 capture_output=True, text=True, check=True)
            run(old, "migrate")
            run(old, "seed")
            # A case created by the BASELINE code through its own HTTP API.
            port = C.free_port()
            p = subprocess.Popen([sys.executable, "-m", "pilot.cli", "serve", "--port", str(port)], cwd=old, env=env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                import time
                for _ in range(200):
                    try:
                        c = Client(port)
                        if c.login("operator@harbourline.test", "pilot-dev-operator").status == 200:
                            break
                    except OSError:
                        time.sleep(0.05)
                body = C.kestrel_body()
                body.pop("invoice_ref", None)
                r = c.req("POST", "/api/cases", body)
                self.assertEqual(r.status, 201, r)
                cid = r.json["id"]
                self.assertEqual(c.cmd(cid, "add_note", text="Created on the baseline build").status, 200)
            finally:
                p.terminate(); p.wait(10)
            before_events = self._events(db, cid)
            # Upgrade with the CURRENT code, then back up and restore into a different blank location.
            run(ROOT, "migrate")
            self.assertEqual(run(ROOT, "check").returncode, 0)
            bk = os.path.join(work, "bk", "pilot-backup.db")
            os.makedirs(os.path.dirname(bk))
            run(ROOT, "backup", bk)
            target = os.path.join(work, "restored", "pilot.db")
            os.makedirs(os.path.dirname(target))
            env2 = dict(env, PILOT_DB=target)
            subprocess.run([sys.executable, "-m", "pilot.cli", "restore", bk], cwd=ROOT, env=env2, check=True, capture_output=True)
            subprocess.run([sys.executable, "-m", "pilot.cli", "check"], cwd=ROOT, env=env2, check=True, capture_output=True)
            self.assertEqual(self._events(target, cid), before_events, "audit history changed across upgrade/restore")
            s2 = C.Srv(db_path=target, clock=C.T0, seed=False)
            s2.start(C.T0)
            try:
                c2 = Client(s2.port)
                self.assertEqual(c2.login("reviewer@harbourline.test", "pilot-dev-reviewer").status, 200)
                v = c2.case(cid)
                self.assertEqual(v.status, 200, v)
                self.assertEqual(v.json["header"]["owner"]["name"], "Olivia Tan")
                self.assertTrue(all(i["ok"] for i in v.json["identities"]))
                self.assertEqual(v.json["header"]["funding"], "SGD 89,450.25")
            finally:
                s2.stop()
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def _events(self, db, cid):
        c = sqlite3.connect(db)
        try:
            return [tuple(r) for r in c.execute("SELECT seq, type, payload, effective_at, known_at, actor_user_id, provenance "
                                                "FROM events WHERE case_id=? ORDER BY seq", (cid,))]
        finally:
            c.close()


class ScenarioH(Blank):
    def test_report_not_measured_then_synthetic_and_no_savings_claims(self):
        op, rv = self.login("op"), self.login("rv")
        cid = ScenarioA.run_deal(self, "12,400.00", "16,800.00", "INV-FA-2026-0555", "6,000.00",
                                 {"owed": "SGD 16,860.00", "principal_paid_1": "SGD 5,940.00", "remaining": "SGD 10,860.00"})
        rep = self.ok(op.get("/api/cases/%s/report?format=json" % cid))
        txt = json.dumps(rep)
        self.assertIn("not measured", txt)
        self.assertNotIn("synthetic", json.dumps(rep.get("baseline", {})).lower())
        for banned in ("capital released", "saved principal"):
            self.assertNotIn(banned, txt.lower().replace("not count capital released", ""))
        # A synthetic baseline (measurement is allowed after close) labels every baseline figure synthetic.
        self.ok(op.cmd(cid, "record_baseline", provenance="synthetic", operator_minutes=95, touchpoints=14,
                       evidence_requests=3, decision_hours=30, deadline_met=True, outcome="paid on time",
                       source_note="Synthetic baseline for the pilot walkthrough, not a customer measurement"))
        rep = self.ok(op.get("/api/cases/%s/report?format=json" % cid))
        self.assertIn("synthetic", json.dumps(rep).lower())
        html = op.get("/api/cases/%s/report?format=html" % cid)
        self.assertEqual(html.status, 200)


if __name__ == "__main__":
    unittest.main()
