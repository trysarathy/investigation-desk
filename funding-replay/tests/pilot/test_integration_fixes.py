"""Integration owner's regressions for the challenger's findings: what happens AFTER the fix, end to end."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import test_challenger_pilot as C  # noqa: E402  (reuses its real-server harness)


class PostCloseRecovery(C.Base):
    def test_return_after_close_flags_review_queue_and_reopen_leads_to_reinstruction(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.drawn(op, rv)
        pref = self.ok(op.cmd(cid, "instruct_payout", route="sandbox"))["supplier_panel"]["provider_ref"]
        self.ok(op.req("POST", "/api/cases/%s/sandbox/advance" % cid, {}))
        self.ok(op.cmd(cid, "record_repayment", amount=C.OWED_TOTAL, currency="SGD", bank_ref="R1"))
        rid = self.ok(op.case(cid))["collections"]["repayments"][0]["id"]
        self.ok(op.cmd(cid, "match_repayment", repayment_id=rid))
        self.ok(op.cmd(cid, "close_case"))
        self.assertEqual(self.signed_event(op, {"provider_event_id": pref + "-RET", "provider_ref": pref, "payout_ref": cid + "-P1",
                                                "kind": "returned", "occurred_at": C.T0}).status, 200)
        v = self.ok(rv.case(cid))
        self.assertEqual(v["status"], "post_close_review")
        self.assertIn("after closing", v["decision"]["headline"])
        self.assertEqual(v["supplier_panel"]["status"], "returned")
        q = self.ok(rv.get("/api/queue"))
        self.assertIn(cid, [r["case_id"] for s in q["sections"] if s["key"] == "uncertain_delivery" for r in s["rows"]])
        self.assertEqual(op.cmd(cid, "reopen_case", reason="x").status, 403)          # reviewer only
        v = self.ok(rv.cmd(cid, "reopen_case", reason="Beneficiary bank returned the funds after close"))
        self.assertTrue(any(a["type"] == "authorize_reinstruction" and a["enabled"] for a in self.ok(rv.case(cid))["actions"]))
        self.assertTrue(all(i["ok"] for i in v["identities"]))

    def test_exception_close_refused_while_payout_outcome_open(self):
        op, rv = self.client(), self.client("reviewer")
        cid = self.drawn(op, rv)
        self.ok(op.cmd(cid, "instruct_payout", route="sandbox"))
        r = rv.cmd(cid, "close_with_exception", disposition="supplier_paid_outside", reason="paid elsewhere")
        self.assertEqual(r.status, 409, r)


if __name__ == "__main__":
    unittest.main()
