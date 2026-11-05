"""Sandbox payouts through the backend: signed ingestion, dedupe, out-of-order, timeout = unknown, reinstruction."""

import json
import unittest.mock

import backend_support  # noqa: F401  (puts the repo root on sys.path)
from backend_support import ServerCase
from pilot import commands, connector, db


def counts(env, cid):
    conn = env.conn()
    try:
        return (conn.execute("SELECT COUNT(*) FROM draws WHERE case_id=?", (cid,)).fetchone()[0],
                conn.execute("SELECT COUNT(*) FROM payouts WHERE case_id=?", (cid,)).fetchone()[0],
                conn.execute("SELECT COUNT(*) FROM sandbox_payouts WHERE payout_ref LIKE ?", (cid + "%",)).fetchone()[0])
    finally:
        conn.close()


class SandboxTest(ServerCase):
    def drawn(self):
        op, rv = self.client(), self.client("reviewer")
        cid, v = self.to_reserved(op, rv)
        self.assertOk(op.cmd(cid, "record_draw", reference="D1"))
        return op, rv, cid

    def post_event(self, c, event, secret=commands.DEV_SECRET, sig=None):
        body = connector.event_body(event)
        return c.req("POST", "/api/connector/sandbox/events", raw=body, csrf=False,
                     headers={connector.SIGNATURE_HEADER: sig or connector.sign(secret, body)})

    def test_normal_flow_via_signed_events_with_duplicates_and_delays(self):
        op, rv, cid = self.drawn()
        v = self.assertOk(op.cmd(cid, "instruct_payout", route="sandbox"))
        sp = v["supplier_panel"]
        self.assertEqual(sp["status"], "accepted")
        self.assertIn("Sandbox — not a live payment", sp["label"])
        self.assertEqual(sp["provenance"], "sandbox_simulation")
        pref = sp["provider_ref"]
        ev = {"provider_event_id": pref + "-E9", "provider_ref": pref, "payout_ref": cid + "-P1",
              "kind": "credited", "occurred_at": "2026-12-01T01:00:00Z"}
        # Bad signature is refused and records nothing.
        r = self.post_event(op, ev, sig="00" * 32)
        self.assertEqual((r.status, r.code), (401, "bad_signature"))
        r = self.post_event(op, ev, secret="wrong")
        self.assertEqual(r.status, 401)
        r = self.post_event(op, ev)
        self.assertEqual(r.status, 200, r)
        self.assertTrue(r.json["applied"])
        # Duplicate replay: 2xx, nothing new.
        n_events = len(self.assertOk(op.case(cid))["timeline"])
        r = self.post_event(op, ev)
        self.assertEqual(r.status, 200)
        self.assertTrue(r.json["duplicate"])
        v = self.assertOk(op.case(cid))
        self.assertEqual(len(v["timeline"]), n_events)
        # Delayed, out-of-order acceptance: stored, not applied.
        late = dict(ev, provider_event_id=pref + "-E0", kind="accepted")
        r = self.post_event(op, late)
        self.assertEqual(r.status, 200)
        self.assertFalse(r.json["applied"])
        v = self.assertOk(op.case(cid))
        self.assertEqual(v["supplier_panel"]["status"], "credited")
        self.assertIdentities(v)
        self.assertEqual(counts(self.env, cid), (1, 1, 1))
        # Unknown payout reference.
        r = self.post_event(op, dict(ev, provider_ref="SBX-NOPE", payout_ref="nope", provider_event_id="x1"))
        self.assertEqual(r.status, 404)
        # Querying never re-submits.
        v = self.assertOk(self.client().case(cid))
        self.assertEqual(counts(self.env, cid), (1, 1, 1))

    def test_sandbox_advance_uses_signed_ingestion_and_dedupes(self):
        op, rv, cid = self.drawn()
        v = self.assertOk(op.cmd(cid, "instruct_payout", route="sandbox", scenario="duplicate_events"))
        a = self.action(v, "sandbox_advance")
        self.assertTrue(a["enabled"])
        self.assertEqual(a["label"], "Sandbox simulation: deliver next provider event")
        r = op.req("POST", a["endpoint"], {})
        self.assertEqual(r.status, 200, r)
        v = r.json
        self.assertEqual(v["supplier_panel"]["status"], "credited")
        delivered = v["sandbox_delivery"]["delivered"]
        self.assertGreaterEqual(len(delivered), 2)  # duplicates sent on purpose
        self.assertTrue(all(d["ok"] for d in delivered))
        self.assertEqual(counts(self.env, cid), (1, 1, 1))
        self.assertIdentities(v)
        types = [t["type"] for t in v["timeline"]]
        self.assertEqual(types.count("delivery_recorded"), 2)  # accepted + credited, each once
        viewer = self.client("viewer")
        self.assertEqual(viewer.req("POST", a["endpoint"], {}).status, 403)

    def test_out_of_order_scenario(self):
        op, rv, cid = self.drawn()
        v = self.assertOk(op.cmd(cid, "instruct_payout", route="sandbox", scenario="out_of_order"))
        r = op.req("POST", "/api/cases/%s/sandbox/advance" % cid, {})
        self.assertEqual(r.status, 200, r)
        self.assertEqual(r.json["supplier_panel"]["status"], "credited")
        hist = r.json["supplier_panel"]["history"]
        self.assertFalse([h for h in hist if h["status"] == "accepted"][-1]["applied"])

    def test_timeout_is_unknown_then_query_same_reference(self):
        op, rv, cid = self.drawn()
        v = self.assertOk(op.cmd(cid, "instruct_payout", route="sandbox", scenario="timeout_then_accept"))
        self.assertEqual(v["supplier_panel"]["status"], "unknown")
        self.assertEqual(v["decision"]["tone"], "unknown")
        self.assertIn("Do not re-submit", v["decision"]["headline"])
        r = op.cmd(cid, "instruct_payout", route="sandbox")
        self.assertEqual((r.status, r.code), (409, "delivery_unknown"))
        self.assertEqual(rv.cmd(cid, "authorize_reinstruction", reason="x").json["error"]["code"], "not_failed")
        q = self.assertOk(op.get("/api/queue"))
        self.assertIn(cid, [x["case_id"] for x in q["sections"][3]["rows"]])
        v = self.assertOk(op.cmd(cid, "query_payout_status"))
        self.assertEqual(v["supplier_panel"]["status"], "accepted")
        v = self.assertOk(op.cmd(cid, "query_payout_status"))  # nothing new, no duplicate events
        self.assertEqual([t["type"] for t in v["timeline"]].count("delivery_recorded"), 1)
        self.assertEqual(counts(self.env, cid), (1, 1, 1))

    def test_failed_then_reviewer_authorizes_reinstruction(self):
        op, rv, cid = self.drawn()
        self.assertOk(op.cmd(cid, "instruct_payout", route="sandbox", scenario="fail"))
        r = op.req("POST", "/api/cases/%s/sandbox/advance" % cid, {})
        v = self.assertOk(r)
        self.assertEqual(v["supplier_panel"]["status"], "failed")
        self.assertEqual(v["decision"]["tone"], "failed")
        self.assertEqual(v["decision"]["next_action"]["command"], "authorize_reinstruction")
        r = op.cmd(cid, "instruct_payout", route="manual", external_ref="BANK-2")
        self.assertEqual((r.status, r.code), (409, "reinstruction_needed"))
        self.assertOk(rv.cmd(cid, "authorize_reinstruction", reason="Beneficiary details corrected"))
        v = self.assertOk(op.cmd(cid, "instruct_payout", route="manual", external_ref="BANK-2"))
        self.assertEqual(v["supplier_panel"]["attempt"], 2)
        self.assertEqual(counts(self.env, cid)[:2], (1, 2))
        # A delayed credit for the failed attempt never revives it or creates a payout.
        conn = self.env.conn()
        pref = conn.execute("SELECT provider_ref FROM payouts WHERE case_id=? AND attempt=1", (cid,)).fetchone()[0]
        conn.close()
        r = self.post_event(op, {"provider_event_id": pref + "-LATE", "provider_ref": pref, "payout_ref": cid + "-P1",
                                 "kind": "credited", "occurred_at": "2026-12-01T01:00:00Z"})
        self.assertEqual(r.status, 200)
        self.assertFalse(r.json["applied"])
        v = self.assertOk(op.case(cid))
        self.assertEqual((v["supplier_panel"]["attempt"], v["supplier_panel"]["status"]), (2, "instructed"))
        self.assertEqual(counts(self.env, cid)[:2], (1, 2))
        self.assertIdentities(v)

    def test_sandbox_disabled_without_connector(self):
        op, rv, cid = self.drawn()
        with unittest.mock.patch.object(commands, "connector_module", return_value=None):
            v = self.assertOk(op.case(cid))
            self.assertFalse(v["sandbox"]["available"])
            self.assertIn("not installed", v["sandbox"]["reason"])
            r = op.cmd(cid, "instruct_payout", route="sandbox")
            self.assertEqual((r.status, r.code), (409, "sandbox_unavailable"))
            r = op.req("POST", "/api/connector/sandbox/events", raw=b"{}", csrf=False)
            self.assertEqual(r.status, 503)
        self.assertEqual(counts(self.env, cid)[1], 0)


if __name__ == "__main__":
    import unittest
    unittest.main()
