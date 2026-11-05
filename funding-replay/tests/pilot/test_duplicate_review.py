import sqlite3,uuid,unittest
from backend_support import Env,kestrel_body
from pilot import commands,duplicates
from pilot.commands import CommandError


class DuplicateReviewTest(unittest.TestCase):
    def setUp(self):
        self.env=Env(); self.conn=self.env.conn()
        self.op=self.env.user('operator@harbourline.test');self.rv=self.env.user('reviewer@harbourline.test')
        self.other=self.env.user('operator@meridian.test');self.viewer=self.env.user('viewer@harbourline.test')
    def tearDown(self):
        self.conn.close();self.env.close()
    def case(self,user=None,**over):
        return commands.create_case(self.conn,user or self.op,kestrel_body(**over))[1]['id']
    def decide(self,cid,candidate,user,op='distinct',ver=0,key=None):
        return duplicates.record(self.conn,user,cid,dict(candidate_id=candidate,disposition=op,version=ver,reason='Checked two source invoices',idempotency_key=key or str(uuid.uuid4())))
    def test_false_positive_override_and_reverse_pair(self):
        a=self.case();b=self.case(reference='po-kes-5521')
        r=duplicates.read(self.conn,self.op,a);self.assertEqual(r['candidates'][0]['candidate']['id'],b)
        self.assertIn('Same normalized case reference',r['candidates'][0]['signals'])
        self.decide(a,b,self.op,'possible_duplicate')
        self.decide(b,a,self.rv,'distinct',1)
        with self.assertRaises(CommandError):self.decide(a,b,self.rv,'confirmed_duplicate',2)
        self.decide(a,b,self.rv,'reopen',2)
        v=self.decide(b,a,self.rv,'confirmed_duplicate',3)
        history=v['candidates'][0]['history']
        self.assertEqual([h['disposition'] for h in history],['possible_duplicate','distinct','reopen','confirmed_duplicate'])
        self.assertEqual(history[-1]['actor_id'],self.rv['id'])
        self.assertNotEqual(duplicates.read(self.conn,self.op,a)['scope'],'')
        self.assertEqual(self.conn.execute('SELECT COUNT(*) FROM reservations').fetchone()[0],0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute('DELETE FROM duplicate_decisions')
    def test_scope_and_roles(self):
        a=self.case();b=self.case(user=self.other)
        r=duplicates.read(self.conn,self.op,a)
        self.assertEqual(r['candidates'],[]);self.assertIn("this provider",r['message'])
        for fn in [lambda:duplicates.read(self.conn,self.other,a),lambda:self.decide(a,b,self.rv)]:
            with self.assertRaises(CommandError) as exc:fn()
            self.assertEqual(exc.exception.status,404)
        c=self.case()
        for u in [self.viewer,self.op]:
            with self.assertRaises(CommandError) as exc:self.decide(a,c,u)
            self.assertEqual(exc.exception.status,403)
    def test_retries_versions_and_non_matches(self):
        a=self.case();b=self.case(reference='other')
        self.decide(a,b,self.rv,key='same-key')
        self.assertEqual(self.decide(a,b,self.rv,key='same-key')['candidates'][0]['version'],1)
        with self.assertRaises(CommandError):self.decide(a,b,self.rv,'reopen',1,'same-key')
        with self.assertRaises(CommandError):self.decide(a,b,self.rv,'reopen',0)
        c=self.case(reference='separate',payout_amount='100.01')
        with self.assertRaises(CommandError) as exc:self.decide(a,c,self.rv)
        self.assertEqual(exc.exception.code,'not_candidate')

from backend_support import ServerCase

class DuplicateReviewHTTP(ServerCase):
    def test_route_privacy_and_review(self):
        op,rv=self.client(),self.client('reviewer')
        a=self.new_case(op)['id']; b=self.new_case(op)['id']
        path='/api/cases/'+a+'/duplicate-review'
        self.assertEqual(self.assertOk(op.get(path))['candidates'][0]['candidate']['id'],b)
        payload=dict(candidate_id=b,disposition='distinct',version=0,reason='Separate source invoices reviewed',idempotency_key='review-web')
        self.assertEqual(rv.req('POST',path,payload,csrf=False).status,403)
        self.assertEqual(self.assertOk(rv.req('POST',path,payload))['candidates'][0]['disposition'],'distinct')
        self.assertEqual(self.client(org='meridian').get(path).status,404)
