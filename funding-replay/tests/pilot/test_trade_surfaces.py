"""Verify the user-visible routes agree with the record-only service contracts."""
from backend_support import ServerCase, Client
from test_trade_calendar import request as calendar_fixture
from test_trade_messages import MT

class TradeSurfaces(ServerCase):
    def test_collection_da_release_is_not_payment_across_http(self):
        op, rv = self.client(), self.client('reviewer')
        root='/api/trade/records'
        draft=self.assertOk(op.req('POST', root, dict(kind='collection',reference='HTTP-DA',evidence_ref='E-1',
            principal='Exporter',drawee='Importer',remitting_bank='Remitter',collecting_bank='Collector',
            arrangement_ref='Protocol-19',record_format='PDF',presentation_place='Singapore desk',
            collection_mode='DA',amount='102.25',currency='USD',idempotency_key='start-DA')),201)
        for client,action,status in [(op,'present','presented'),(rv,'record_acceptance','accepted_unpaid'),
            (rv,'record_release','released_against_acceptance'),(rv,'record_payment','released_and_paid')]:
            payload={'evidence_ref':'ext-'+action}
            if action=='record_payment':
                payload.update(amount='102.25',currency='USD')
            draft=self.assertOk(client.req('POST',root+'/'+draft['id']+'/commands',
                 dict(version=draft['version'],action=action,idempotency_key='cmd-'+action,payload=payload)))
            self.assertEqual(draft['status'],status)
        self.assertEqual(self.client(org='meridian').get(root+'/'+draft['id']).status,404)

    def test_diary_and_message_previews_have_no_authority(self):
        op=self.client(); anon=Client(self.port)
        for path,body in [('/calendar/preview',calendar_fixture()),('/messages/preview',dict(kind='mt700',raw=MT))]:
            url='/api/trade'+path
            self.assertEqual(anon.req('POST',url,body).status,401)
            self.assertEqual(op.req('POST',url,body,csrf=False).status,403)
            self.assertOk(op.req('POST',url,body))
        self.assertEqual(self.assertOk(op.get('/api/trade/instruments'))['instruments'],[])
