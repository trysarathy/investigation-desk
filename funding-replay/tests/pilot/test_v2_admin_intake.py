"""§13.1 facility policy administration (CLI), §13.2 intake fields + CSV v2, migration 0003 upgrade. Real HTTP server."""

import contextlib
import io
import json
import os
import shutil
import sqlite3
import tempfile
import unittest
import uuid

from backend_support import ServerCase, kestrel_body, Client, T0  # noqa: F401  (puts the repo root on sys.path)
from pilot import cli, commands, db, imports

POL = "POL-HL v2026.12-1"


def run_cli(path, *args):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = cli.main(["--db", path] + list(args))
        except SystemExit as e:  # argparse refusal (e.g. a required option missing)
            code = e.code
    return code, out.getvalue(), err.getvalue()


class MigrationUpgradeTest(unittest.TestCase):
    """A database created with 0001, 0002 and 0100 only (the d94177e schema), with a case in it, upgrades in place."""

    def test_upgrade_legacy_db_with_data_then_read_case(self):
        tmp = tempfile.mkdtemp(prefix="pilot-mig-")
        old_env = os.environ.get("PILOT_ENV")
        os.environ["PILOT_ENV"] = "test"
        db.set_clock(T0)
        try:
            legacy = os.path.join(tmp, "legacy-migrations")
            os.makedirs(legacy)
            for name in ("0001_init.sql", "0002_case_numbers_per_org.sql", "0100_sandbox.sql"):
                shutil.copy(os.path.join(db.MIGRATIONS_DIR, name), legacy)
            path = os.path.join(tmp, "legacy.db")
            conn = db.connect(path)
            self.assertEqual(db.migrate(conn, legacy), ["0001_init", "0002_case_numbers_per_org", "0100_sandbox"])
            conn.execute("INSERT INTO orgs(id, name, created_at) VALUES ('ORG-LG', 'Legacy (Synthetic)', ?)", (T0,))
            conn.execute("INSERT INTO users(org_id, email, name, role, password_hash, created_at) VALUES "
                         "('ORG-LG', 'op@legacy.test', 'Lena Ong', 'operator', 'x', ?)", (T0,))
            conn.execute("INSERT INTO facilities(id, org_id, name, currency, limit_minor, fee_flat_minor, policy_version, "
                         "funding_account_start_minor) VALUES ('FAC-LG', 'ORG-LG', 'Legacy facility', 'SGD', 1000000, "
                         "500, 'POL-LG v1', 2000000)")
            conn.execute("INSERT INTO cases(id, org_id, created_by, owner_user_id, status, version, created_at, importer, "
                         "supplier, payout_minor, payout_currency, funding_minor, funding_currency, quote_ref, deadline_at, "
                         "deadline_tz, window_a_at, window_a_cutoff_at, facility_id) VALUES ('CL-2026-LG-00001', 'ORG-LG', "
                         "1, 1, 'assessing', 1, ?, 'Old Importer', 'Old Supplier', 100000, 'USD', 135000, 'SGD', 'Q-OLD', "
                         "'2026-12-04T10:00:00Z', 'Asia/Singapore', '2026-12-02T07:00:00Z', '2026-12-02T08:00:00Z', "
                         "'FAC-LG')", (T0,))
            conn.execute("INSERT INTO events(org_id, case_id, seq, type, payload, effective_at, known_at, actor_user_id, "
                         "actor_role, provenance) VALUES ('ORG-LG', 'CL-2026-LG-00001', 1, 'case_created', "
                         "'{\"facility_id\": \"FAC-LG\"}', ?, ?, 1, 'operator', 'operator_entered')", (T0, T0))
            before = conn.execute("SELECT * FROM events").fetchall()
            done = db.migrate(conn)
            self.assertEqual(done, ["0003_brief_v2"])
            self.assertEqual(db.migrate(conn), [])
            self.assertEqual([tuple(r) for r in conn.execute("SELECT * FROM events").fetchall()],
                             [tuple(r) for r in before])
            fac = db.one(conn, "SELECT * FROM facilities WHERE id='FAC-LG'")
            self.assertEqual(fac["required_evidence"], "balance")
            vers = db.all_rows(conn, "SELECT * FROM facility_versions WHERE facility_id='FAC-LG'")
            self.assertEqual(len(vers), 1)
            self.assertEqual(vers[0]["policy_version"], "POL-LG v1")
            self.assertEqual(json.loads(vers[0]["terms"])["limit_minor"], 1000000)
            with self.assertRaises(sqlite3.DatabaseError):
                conn.execute("UPDATE facility_versions SET terms='{}'")
            user = {"id": 1, "org_id": "ORG-LG", "role": "operator", "name": "Lena Ong", "email": "op@legacy.test"}
            v = commands.read_case(conn, user, "CL-2026-LG-00001")
            self.assertEqual(v["header"]["invoice_ref"], None)
            self.assertEqual(v["header"]["owner"]["name"], "Lena Ong")
            self.assertEqual(v["header"]["funding"], "SGD 1,350.00")
            self.assertEqual(v["duplicate_check"]["status"], "not_checked")
            self.assertEqual(v["decision_record"]["checkpoints"], [])
            self.assertEqual(cli.check(conn), [])
            conn.close()
        finally:
            db.set_clock(None)
            if old_env is None:
                os.environ.pop("PILOT_ENV", None)
            else:
                os.environ["PILOT_ENV"] = old_env
            shutil.rmtree(tmp, ignore_errors=True)


class FacilityAdminTest(ServerCase):
    def test_create_facility_blank_org_and_scenario_a_amounts(self):
        p = self.env.path
        self.assertEqual(run_cli(p, "create-org", "--id", "ORG-SM", "--name", "Saltmarsh (Synthetic)")[0], 0)
        conn = self.env.conn()
        with db.tx(conn):
            from pilot import auth
            auth.create_user(conn, "ORG-SM", "op@sm.test", "Priya Nair", "operator", "sm-operator-pass")
            auth.create_user(conn, "ORG-SM", "rv@sm.test", "Daniel Koh", "reviewer", "sm-reviewer-pass")
        conn.close()
        code, out, err = run_cli(p, "create-facility", "--org", "ORG-SM", "--id", "FAC-SM-01", "--name", "Advance",
                                 "--currency", "SGD", "--limit", "120,000.00", "--fee-flat", "60.00", "--fee-bps", "0",
                                 "--allocation", "fees_first", "--funding-cash", "80,000.00",
                                 "--policy-version", "POL-SM v1", "--required-evidence", "balance")
        self.assertEqual(code, 0, err)
        # bad inputs are refused with a message, nothing created
        self.assertEqual(run_cli(p, "create-facility", "--org", "ORG-SM", "--id", "FAC-SM-02", "--name", "x",
                                 "--currency", "SGD", "--limit", "1.5e5", "--funding-cash", "1", "--policy-version",
                                 "P")[0], 1)
        self.assertEqual(run_cli(p, "create-facility", "--org", "ORG-SM", "--id", "FAC-SM-03", "--name", "x",
                                 "--currency", "SGD", "--limit", "100", "--funding-cash", "1", "--policy-version",
                                 "P", "--required-evidence", "horoscope")[0], 1)
        op, rv = Client(self.port), Client(self.port)
        self.assertEqual(op.login("op@sm.test", "sm-operator-pass").status, 200)
        self.assertEqual(rv.login("rv@sm.test", "sm-reviewer-pass").status, 200)
        self.assertEqual(op.get("/api/cases").json["results"], [])
        v = self.assertOk(op.req("POST", "/api/cases", kestrel_body(
            funding_amount="16,800.00", payout_amount="12,400.00", payout_currency="USD", invoice_ref="INV-FA-0042",
            observations=[{"kind": "balance", "amount": "1,250.00", "currency": "SGD", "as_of": "2026-12-01T00:30:00Z",
                           "source": "Bank portal"}])), 201)
        cid = v["id"]
        self.assertTrue(cid.startswith("CL-2026-SM-"))
        self.assertEqual(v["header"]["facility_id"], "FAC-SM-01")
        self.assertEqual(self.route(v, "C")["status"], "feasible", self.route(v, "C"))
        self.assertOk(op.cmd(cid, "request_advance", reason="r"))
        v = self.assertOk(rv.cmd(cid, "approve_and_reserve", reason="ok"))
        appr = [t for t in v["timeline"] if t["type"] == "advance_approved"][0]
        self.assertIn("POL-SM v1", appr["text"])
        v = self.assertOk(op.cmd(cid, "record_draw", reference="D1"))
        self.assertEqual(v["exposure_panel"]["total_outstanding"], "SGD 16,860.00")
        self.assertOk(op.cmd(cid, "instruct_payout", route="manual", external_ref="B1"))
        v = self.assertOk(op.cmd(cid, "record_repayment", amount="6,000.00", currency="SGD", bank_ref="R1"))
        v = self.assertOk(op.cmd(cid, "match_repayment", repayment_id=v["collections"]["repayments"][0]["id"]))
        al = v["collections"]["repayments"][0]["allocation"]
        self.assertEqual((al["fees"], al["principal"]), ("SGD 60.00", "SGD 5,940.00"))
        self.assertEqual(v["exposure_panel"]["principal_outstanding"], "SGD 10,860.00")
        self.assertIdentities(v)

    def test_update_facility_versions_and_approval_binding(self):
        p = self.env.path
        op, rv = self.client(), self.client("reviewer")
        cid, v = self.to_reserved(op, rv)
        # every change needs a NEW policy version
        self.assertEqual(run_cli(p, "update-facility", "--id", "FAC-HL-01", "--policy-version", POL,
                                 "--fee-flat", "200.00")[0], 1)
        code, out, err = run_cli(p, "update-facility", "--id", "FAC-HL-01", "--fee-flat", "200.00")
        self.assertNotEqual(code, 0)
        self.assertEqual(run_cli(p, "update-facility", "--id", "FAC-HL-01", "--policy-version", "POL-HL v2")[0], 1)
        code, out, err = run_cli(p, "update-facility", "--id", "FAC-HL-01", "--policy-version", "POL-HL v2",
                                 "--fee-flat", "200.00", "--required-evidence", "invoice,balance", "--by", "credit-ops")
        self.assertEqual(code, 0, err)
        code, out, _ = run_cli(p, "list-facilities", "--org", "ORG-HL")
        facs = json.loads(out)
        self.assertEqual([x["policy_version"] for x in facs[0]["versions"]], [POL, "POL-HL v2"])
        self.assertEqual(facs[0]["versions"][1]["terms"]["fee_flat_minor"], 20000)
        self.assertEqual(facs[0]["versions"][1]["changed_by"], "credit-ops")
        self.assertEqual(facs[0]["required_evidence"], ["invoice", "balance"])
        # the earlier approval keeps the version in force when the reviewer acted
        exp = self.assertOk(op.get("/api/cases/%s/export?format=json" % cid))
        appr = [e for e in exp["events"] if e["type"] == "advance_approved"][0]
        self.assertEqual(appr["payload"]["policy_version"], POL)
        self.assertEqual(appr["payload"]["fee_minor"], 15000)
        conn = self.env.conn()
        first = db.one(conn, "SELECT id FROM facility_versions WHERE facility_id='FAC-HL-01' AND policy_version=?", (POL,))
        conn.close()
        self.assertEqual(appr["payload"]["facility_version_id"], first["id"])
        # a new case is approved under v2 and must carry an invoice
        v2 = self.new_case(op)
        cid2 = v2["id"]
        self.add_balance(op, cid2)
        rc = self.route(op.case(cid2).json, "C")
        self.assertEqual(rc["status"], "unknown")
        self.assertIn("Policy POL-HL v2 requires invoice: not on record", rc["missing"])
        # §13.4 / challenger v2: the invoice must carry the case payout currency and amount to satisfy the policy.
        self.assertOk(op.cmd(cid2, "add_observation", kind="invoice", amount=v2["header"]["payout"].split(" ", 1)[1],
                             currency="EUR",
                             invoice_ref=v2["header"]["invoice_ref"], issuer="Lindqvist Optics AB",
                             issued_at="2026-11-28T02:00:00Z"))
        self.assertOk(op.cmd(cid2, "request_advance", reason="r"))
        v = self.assertOk(rv.cmd(cid2, "approve_and_reserve", reason="ok"))
        exp = self.assertOk(op.get("/api/cases/%s/export?format=json" % cid2))
        appr = [e for e in exp["events"] if e["type"] == "advance_approved"][0]
        self.assertEqual((appr["payload"]["policy_version"], appr["payload"]["fee_minor"]), ("POL-HL v2", 20000))
        self.assertEqual(appr["payload"]["required_evidence"], ["invoice", "balance"])

    def test_list_and_disable_users(self):
        p = self.env.path
        op = self.client()
        code, out, _ = run_cli(p, "list-users", "--org", "ORG-HL")
        self.assertEqual(code, 0)
        self.assertIn("operator@harbourline.test", out)
        self.assertNotIn("meridian", out)
        self.assertEqual(run_cli(p, "disable-user", "--email", "Operator@Harbourline.test")[0], 0)
        self.assertEqual(op.get("/api/me").status, 401)  # existing session ended
        self.assertEqual(Client(self.port).login("operator@harbourline.test", "pilot-dev-operator").status, 401)
        self.assertIn("disabled", run_cli(p, "list-users", "--org", "ORG-HL")[1])
        self.assertEqual(run_cli(p, "disable-user", "--email", "nobody@x.test")[0], 1)


class IntakeTest(ServerCase):
    def test_invoice_ref_required_and_intake_fields(self):
        op = self.client()
        b = kestrel_body()
        b.pop("invoice_ref")
        r = op.req("POST", "/api/cases", b)
        self.assertEqual((r.status, r.json["error"]["field"]), (422, "invoice_ref"))
        rv = self.env.user("reviewer@harbourline.test")
        v = self.new_case(op, invoice_ref="INV-LO-7781", customer_ref="KES-PO-5521", quote_source="Provider FX desk",
                          quote_at="2026-12-01T00:45:00Z", owner_user_id=rv["id"])
        h = v["header"]
        self.assertEqual((h["invoice_ref"], h["customer_ref"], h["quote_source"], h["quote_at"]["utc"]),
                         ("INV-LO-7781", "KES-PO-5521", "Provider FX desk", "2026-12-01T00:45:00Z"))
        self.assertEqual(h["owner"]["name"], "Ravi Menon")
        created = [t for t in v["timeline"] if t["type"] == "case_created"][0]
        self.assertEqual(created["actor_role"], "operator")
        # owner must be an active operator/reviewer of the same org
        viewer = self.env.user("viewer@harbourline.test")
        other = self.env.user("operator@meridian.test")
        for uid in (viewer["id"], other["id"], 99999, "1"):
            r = op.req("POST", "/api/cases", kestrel_body(owner_user_id=uid))
            self.assertEqual((r.status, r.json["error"]["field"]), (422, "owner_user_id"), r)
        r = op.req("POST", "/api/cases", kestrel_body(quote_at="2027-06-01T00:00:00Z"))
        self.assertEqual((r.status, r.json["error"]["field"]), (422, "quote_at"))

    def test_csv_v2_marker_owner_email_and_v1_rule(self):
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "fixtures_v2_sample.csv"), encoding="utf-8") as fh:
            text = fh.read()
        self.assertEqual(imports.csv_version(text), "v2")
        rows, errors = imports.parse_cases_csv(text)
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["invoice_ref"], "INV-SYN-0101")
        self.assertEqual(rows[0]["owner_email"], "reviewer@harbourline.test")
        self.assertTrue(rows[0]["quote_at"].endswith("Z"))
        # v2 rows need invoice_ref; unknown markers are refused
        lines = text.splitlines()
        bad = lines[:2] + [lines[2].replace("INV-SYN-0101", "")]
        rows, errors = imports.parse_cases_csv("\n".join(bad) + "\n")
        self.assertEqual(rows, [])
        self.assertTrue(any("invoice_ref" in e for e in errors), errors)
        rows, errors = imports.parse_cases_csv("#clearline-cases v9\n" + "\n".join(lines[1:]))
        self.assertTrue(errors[0].startswith("File: unknown format marker"))
        # v1 header with a v2 column hints at the marker
        rows, errors = imports.parse_cases_csv("\n".join(lines[1:]))
        self.assertTrue(any("v2 column" in e for e in errors), errors)
        db.set_clock("2026-12-03T12:00:00Z")
        op = self.client()
        r = op.req("POST", "/api/cases/import", {"csv": text})
        self.assertEqual(r.status, 200, r)
        v = self.assertOk(op.case(r.json["created"][0]))
        self.assertEqual(v["header"]["owner"]["name"], "Ravi Menon")
        self.assertEqual(v["header"]["invoice_ref"], "INV-SYN-0101")
        self.assertEqual(v["duplicate_check"]["text"], "No matching record in this provider's book.")
        # owner_email from another org is a row error, nothing created
        other = text.replace("reviewer@harbourline.test", "operator@meridian.test").replace("INV-SYN-01", "INV-SYN-09")
        r = op.req("POST", "/api/cases/import", {"csv": other})
        self.assertEqual(r.status, 422, r)
        self.assertTrue(any("owner_email" in e for e in r.json["errors"]), r.json)


if __name__ == "__main__":
    unittest.main()
