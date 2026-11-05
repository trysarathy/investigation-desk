"""Run a previously unseen full-drawing credit into a real provider case via the HTTP application."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from backend_support import ServerCase, T0
from test_trade_journey import terms, presentation, ROOT
from pilot import db


class UnifiedProduct(ServerCase):
    def request(self, client, source, action, payload=None, key=None):
        return client.req("POST", ROOT+"/"+source["id"]+"/commands", {
            "action":action,"version":source["version"],"idempotency_key":key or uuid.uuid4().hex,
            "payload":payload or {}})

    def setup_credit(self, op, reviewer):
        self.ref = "LC-"+uuid.uuid4().hex[:12]
        draft=self.assertOk(op.req("POST", ROOT, terms(reference=self.ref,amount="34567.89")),201)
        for actor,action,payload in [
            (reviewer,"issue",{}),(op,"present",presentation(amount="34567.89")),
            (reviewer,"examine",{}),(reviewer,"accept",{"reason":"Examined two complete records"}),
            (op,"request_financing_review",{})]:
            draft=self.assertOk(self.request(actor,draft,action,payload))
        return draft

    def funding(self):
        return {"funding_amount":"45321.70","funding_currency":"SGD","quote_ref":"Q-561",
                "contract_ref":"AUTH-712","deadline_at":"2026-12-04T10:00:00Z","deadline_tz":"Asia/Singapore",
                "window_a_at":"2026-12-02T07:00:00Z","window_a_cutoff_at":"2026-12-02T08:00:00Z"}

    def test_linked_credit_lives_through_partial_repayment_and_closure(self):
        op=self.client();rv=self.client("reviewer"); foreign=self.client(org="meridian")
        doc=self.setup_credit(op,rv);payload=self.funding();key=uuid.uuid4().hex
        self.assertEqual(self.request(foreign,doc,"open_funding_case",payload).status,404)
        self.assertEqual(self.request(rv,doc,"open_funding_case",payload).status,403)
        self.assertEqual(self.request(op,doc,"open_funding_case",dict(payload,payout_amount="999999")).status,422)
        linked=self.assertOk(self.request(op,doc,"open_funding_case",payload,key))
        cid=linked["funding_case"]["id"]
        self.assertEqual(self.assertOk(self.request(op,doc,"open_funding_case",payload,key))["funding_case"]["id"],cid)
        self.assertEqual(self.request(op,linked,"open_funding_case",payload).status,409)
        self.assertEqual(foreign.case(cid).status,404)
        view=self.assertOk(op.case(cid));self.assertIdentities(view)
        self.assertEqual(view["header"]["payout"],"USD 34,567.89")
        self.assertEqual(view["header"]["funding"],"SGD 45,321.70")
        self.assertEqual(view["exposure_panel"]["status"],"none")
        self.assertEqual(view["supplier_panel"]["status"],"none")
        self.stop();self.start();op.port=rv.port=self.port
        restored=self.assertOk(op.get(ROOT+"/"+doc["id"]))
        self.assertEqual(restored["funding_case"]["id"],cid)
        self.add_balance(op,cid)
        def move(user,action,**args):
            updated=self.assertOk(user.cmd(cid,action,**args));self.assertIdentities(updated);return updated
        move(op,"request_advance",reason="Payout deadline precedes customer receipt")
        self.assertEqual(op.cmd(cid,"approve_and_reserve",reason="try self approval").status,403)
        view=move(rv,"approve_and_reserve",reason="Permitted facility and confirmed cash")
        self.assertEqual(view["exposure_panel"]["reserved"],"SGD 45,321.70")
        self.assertEqual(view["exposure_panel"]["principal_outstanding"],"SGD 0.00")
        db.set_clock("2026-12-01T03:00:00Z")
        move(op,"record_draw",reference="DRAW-"+self.ref)
        move(op,"instruct_payout",route="manual",external_ref="BANK-"+self.ref)
        v=move(op,"record_delivery",status="accepted",reference="BANK-ACCEPT")
        self.assertEqual(v["supplier_panel"]["status"],"accepted")
        v=move(op,"record_delivery",status="credited",reference="SUPPLIER-CREDIT",location="Beneficiary bank")
        self.assertEqual(v["supplier_panel"]["status"],"credited")
        self.assertEqual(v["exposure_panel"]["total_outstanding"],"SGD 45,471.70")
        v=move(op,"record_customer_receipt",amount="50000",currency="SGD",reference="Customer paid importer")
        self.assertEqual(v["exposure_panel"]["total_outstanding"],"SGD 45,471.70")
        for seq,(amount,pending) in enumerate([("20000.00","SGD 25,471.70"),("25471.70","SGD 0.00")]):
            v=move(op,"record_repayment",amount=amount,currency="SGD",bank_ref="repay-"+str(seq))
            rid=v["collections"]["repayments"][-1]["id"]
            v=move(op,"match_repayment",repayment_id=rid)
            self.assertEqual(v["exposure_panel"]["total_outstanding"],pending)
            if seq==0:
                self.assertEqual(v["collections"]["repayments"][0]["allocation"]["principal"],"SGD 19,850.00")
                self.assertEqual(op.cmd(cid,"close_case").status,409)
        self.assertEqual(move(op,"close_case")["status"],"closed")
        export=op.get("/api/cases/"+cid+"/export?format=json")
        self.assertEqual(export.status,200);self.assertIn(self.ref,export.raw.decode())

    def test_racing_handoffs_create_only_one_funding_case(self):
        op=self.client();op2=self.client();rv=self.client("reviewer")
        v=self.setup_credit(op,rv); sync=Barrier(2)
        def handoff(client):
            sync.wait(timeout=3)
            return self.request(client,v,"open_funding_case",self.funding())
        with ThreadPoolExecutor(max_workers=2) as pool: responses=list(pool.map(handoff,[op,op2]))
        self.assertEqual(sorted(r.status for r in responses),[200,409])
        cid=next(r for r in responses if r.status==200).json["funding_case"]["id"]
        with self.env.conn() as conn:
            self.assertEqual(conn.execute("select count(*) from cases where id=?", (cid,)).fetchone()[0],1)
            self.assertEqual(conn.execute("select count(*) from cases").fetchone()[0],1)
            self.assertEqual(conn.execute("select count(*) from reservations").fetchone()[0],0)

    def test_accepting_a_waiver_is_not_authority_to_fund_a_different_drawing(self):
        op,rv=self.client(),self.client("reviewer")
        v=self.assertOk(op.req("POST",ROOT,terms(amount="100.00")),201)
        for user,action,payload in [
            (rv,"issue",{}),(op,"present",presentation(amount="80.00")),(rv,"examine",{}),
            (rv,"request_waiver",{"reason":"Presented amount differs"}),
            (op,"record_waiver",{"evidence_ref":"WAIVER-1"}),
            (rv,"accept_waiver",{"reason":"Reviewed applicant response"}),
            (op,"request_financing_review",{})]:
            v=self.assertOk(self.request(user,v,action,payload))
        result=self.request(op,v,"open_funding_case",self.funding())
        self.assertEqual(result.status,409)
        self.assertEqual(result.json["error"]["code"],"settlement_terms_unresolved")
        with self.env.conn() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM cases").fetchone()[0],0)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM instrument_funding_links").fetchone()[0],0)
