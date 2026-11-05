import sqlite3
from backend_support import ServerCase,T0
from pilot import db, decision_snapshots as snap

class HistoricalDecisionTests(ServerCase):
    def rows(self,cid,stamp=None):
        c=self.env.conn()
        try: return snap.history(c,'ORG-HL',cid,stamp or db.now_iso())
        finally: c.close()

    def test_records_an_evidence_transition_without_earlier_leakage(self):
        op=self.client()
        v=self.new_case(op); cid=v['id']
        self.assertEqual(self.rows(cid),[])
        db.set_clock('2026-12-01T01:30:00Z')
        self.add_balance(op,cid)
        entries=self.rows(cid)
        self.assertEqual(len(entries),1)
        rec=entries[0]
        route=lambda body: next(r for r in body['routes'] if r['key']=='C')
        self.assertEqual(route(rec['before'])['status'],'unknown')
        self.assertEqual(route(rec['after'])['status'],'feasible')
        self.assertTrue(route(rec['after'])['evidence_ids'])
        self.assertEqual(self.rows(cid,T0),[])
        url='/api/cases/'+cid+'/decision-report'
        past=self.assertOk(op.get(url+'?as_of='+T0))
        self.assertEqual(past['decision_snapshots'],[])
        self.assertEqual(self.assertOk(op.get(url))['decision_snapshots'],entries)
        self.assertEqual(self.client(org='meridian').get(url).status,404)
        self.assertEqual(rec['model_version'],snap.MODEL_VERSION)
        # Later changes to facility settings do not affect a persisted earlier decision.
        conn=self.env.conn()
        try:
            conn.execute("UPDATE facilities SET policy_version='revised-later' WHERE org_id='ORG-HL'")
            self.assertEqual(self.rows(cid),entries)
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute("DELETE FROM funding_decision_snapshots WHERE case_id=?",(cid,))
            self.assertEqual(snap.history(conn,'ORG-MER',cid,db.now_iso()),[])
        finally:conn.close()

    def test_stale_version_does_not_append_snapshot(self):
        op=self.client(); cid=self.new_case(op)['id']
        self.add_balance(op,cid)
        before=self.rows(cid)
        bad=op.req('POST','/api/cases/'+cid+'/commands',dict(type='request_advance',expected_version=0,
                   idempotency_key='bad-version',reason='stale'))
        self.assertEqual(bad.status,409)
        self.assertEqual(self.rows(cid),before)

    def test_reviewer_reason_and_contemporaneous_policy_are_recorded(self):
        op,rv=self.client(),self.client('reviewer');cid=self.new_case(op)['id']
        self.add_balance(op,cid)
        self.assertOk(op.cmd(cid,'request_advance',reason='Requested by the importer'))
        self.assertOk(rv.cmd(cid,'decline',reason='Provider risk policy'))
        last=self.rows(cid)[-1]
        self.assertEqual((last['command'],last['role'],last['reason']),('decline','reviewer','Provider risk policy'))
        self.assertTrue(last['after']['policy_version'])
