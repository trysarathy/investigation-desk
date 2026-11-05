from backend_support import ServerCase,T0
from pilot import db


class DecisionReport(ServerCase):
    def setUp(self):
        super().setUp()
        self.op=self.client()
        self.cid=self.new_case(self.op)['id']
        self.url='/api/cases/'+self.cid+'/decision-report'

    def sample(self,side,key,**changed):
        b=dict(side=side,basis='recorded',source_ref='Ops timer 17',service_comparable=True,active_minutes=20,elapsed_minutes=80,touchpoints=3,repeated_requests=2,deadline_met=True,idempotency_key=key)
        b.update(changed)
        return self.op.req('POST',self.url,b)

    def test_not_measured_then_replay_without_hindsight_and_precision(self):
        initial=self.assertOk(self.op.get(self.url))
        self.assertEqual(initial['comparison']['basis'],'not measured')
        db.set_clock('2026-12-01T02:00:00Z')
        self.assertOk(self.sample('baseline','bl'))
        self.assertOk(self.op.cmd(self.cid,'add_note',text='Later hindsight secret'))
        report=self.assertOk(self.sample('pilot','p1',basis='estimated',active_minutes=5,elapsed_minutes=70,touchpoints=1,repeated_requests=None))
        self.assertEqual(report['comparison']['basis'],'estimated')
        self.assertEqual(report['comparison']['baseline_minus_pilot']['active_minutes'],15)
        self.assertEqual(report['comparison']['baseline_minus_pilot']['other_elapsed_minutes'],-5)
        self.assertIsNone(report['comparison']['baseline_minus_pilot']['repeated_requests'])
        past=self.op.get(self.url+'?as_of='+T0)
        self.assertEqual(past.json,initial)
        self.assertNotIn(b'Later hindsight secret',past.raw)
        self.assertEqual(self.op.get(self.url+'?as_of=2026-12-02T00:00:00Z').status,422)

    def test_noncomparable_no_deltas_synthetic_never_claims_savings(self):
        self.assertOk(self.sample('baseline','b2'))
        r=self.assertOk(self.sample('pilot','p2',deadline_met=False))
        self.assertEqual(r['comparison'],{'basis':'not comparable','baseline_minus_pilot':{}})
        r=self.assertOk(self.sample('pilot','p3',basis='synthetic'))
        self.assertEqual(r['comparison']['basis'],'synthetic')

    def test_roles_tenant_isolation_idempotency_and_validation(self):
        report=self.assertOk(self.sample('baseline','id1'))
        self.assertEqual(self.assertOk(self.sample('baseline','id1')),report)
        self.assertEqual(self.sample('baseline','id1',touchpoints=1).status,409)
        self.assertEqual(self.sample('pilot','id2',active_minutes=True).status,422)
        self.assertEqual(self.sample('pilot','id3',active_minutes=90).status,422)
        self.assertEqual(self.client(org='meridian').get(self.url).status,404)
        self.assertEqual(self.client('viewer').req('POST',self.url,{}).status,403)
        self.assertEqual(self.op.req('POST',self.url,{},csrf=False).status,403)
