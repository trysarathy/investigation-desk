import sqlite3
import unittest
import uuid
from backend_support import Env
from pilot import trade_records as rec
from pilot.commands import CommandError

class TradeRecordTest(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.conn = self.env.conn()
        names = ["operator@harbourline.test","reviewer@harbourline.test","viewer@harbourline.test","operator@meridian.test"]
        self.op,self.rev,self.viewer,self.other = [self.env.user(e) for e in names]
        self.collection = dict(kind="collection", reference="DC-001", evidence_ref="instruction-01",
                principal="seller", drawee="buyer", remitting_bank="remitting institution",
                collecting_bank="collecting institution", arrangement_ref="agreement-341",
                record_format="PDF/A", presentation_place="partner sandbox mailbox",
                currency="USD",amount="100.00",collection_mode="DP")
        self.ebl = dict(kind="ebl",reference="BOL-17",evidence_ref="issuer:event-17",
                        issuer="carrier",controller="seller",platform="sandbox registry")
    def tearDown(self):
        self.conn.close()
        self.env.close()
    def make(self,p=None):
        return rec.create(self.conn,self.op,p or self.collection,"create")
    def cmd(self,r,act,u=None,key=None,**fields):
        return rec.command(self.conn,u or self.rev,r["id"],act,dict(evidence_ref="external:"+act,**fields),key or str(uuid.uuid4()),r["version"])
    def test_dp_and_da_separate_payment_and_release(self):
        for mode in ["DP","DA"]:
            r=rec.create(self.conn,self.op,dict(self.collection,collection_mode=mode,reference="ref-"+mode),mode)
            r=self.cmd(r,"present",self.op)
            with self.assertRaises(CommandError): self.cmd(r,"record_release")
            if mode=="DA":
                r=self.cmd(r,"record_acceptance")
                r=self.cmd(r,"record_release")
                self.assertEqual(r["status"],"released_against_acceptance")
            with self.assertRaises(CommandError): self.cmd(r,"record_payment",amount="100",currency="SGD")
            with self.assertRaises(CommandError): self.cmd(r,"record_payment",amount="99",currency="USD")
            r=self.cmd(r,"record_payment",amount="100",currency="USD")
            if mode=="DP": r=self.cmd(r,"record_release")
            self.assertEqual(r["status"],"released_and_paid")
            self.assertEqual(r["version"],len(r["events"]))
    def test_explicit_arrangement_and_duplicate_instruction(self):
        with self.assertRaises(CommandError): self.make(dict(self.collection,arrangement_ref=""))
        r=self.make()
        self.assertEqual(self.make()["id"],r["id"])
        with self.assertRaises(CommandError): rec.create(self.conn,self.op,self.collection,"different-create")
    def test_nonpayment_is_terminal_for_simple_profile(self):
        r=self.cmd(self.make(),"present",self.op)
        r=self.cmd(r,"refuse")
        with self.assertRaises(CommandError): self.cmd(r,"record_release")
    def test_ebl_replay_and_control_not_transferred_by_clearline(self):
        r=self.make(self.ebl)
        later=self.cmd(r,"record_control_change",key="change1",controller="buyer")
        self.assertEqual(later["details"]["controller"],"buyer")
        surrendered=self.cmd(later,"surrender")
        self.assertIsNone(surrendered["details"]["controller"])
        again=self.cmd(r,"record_control_change",key="change1",controller="buyer")
        self.assertEqual(again,later)
        with self.assertRaises(CommandError): self.cmd(r,"record_control_change",key="change1",controller="lender")
        with self.assertRaises(CommandError): self.cmd(surrendered,"record_control_change",controller="wrong")
        self.assertIn("does not establish exclusive control",r["scope"])
    def test_late_evidence_retains_recorded_time_and_rejects_forecast(self):
        r=self.make(dict(self.ebl,effective_at="2026-11-30T23:00:00Z"))
        ev=r["events"][0]
        self.assertLess(ev["payload"]["effective_at"],ev["known_at"])
        with self.assertRaises(CommandError):
            self.cmd(r,"record_control_change",controller="buyer",effective_at="2099-11-30T23:00:00Z")
        self.assertEqual(rec.detail(self.conn,self.op,r["id"])["version"],1)

    def test_tenant_role_and_immutable_history(self):
        r=self.make()
        self.assertEqual(rec.list_records(self.conn,self.other),[])
        with self.assertRaises(CommandError) as e: rec.detail(self.conn,self.other,r["id"])
        self.assertEqual(e.exception.status,404)
        with self.assertRaises(CommandError): self.cmd(r,"present",self.viewer)
        with self.assertRaises(CommandError): self.cmd(r,"present",self.other)
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE trade_record_events SET action='bogus'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("DELETE FROM trade_record_events")

if __name__=="__main__":
    unittest.main()
