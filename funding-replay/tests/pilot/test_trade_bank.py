import hashlib,hmac,json,os,sqlite3,unittest
from unittest.mock import patch
from backend_support import Env, Client, ServerCase
from pilot import db,trade_bank as bank
from pilot.commands import CommandError

class BankInboxTest(unittest.TestCase):
    def setUp(self):
        self.env=Env(); self.conn=self.env.conn()
        self.user=self.env.user("operator@harbourline.test")
        self.other=self.env.user("operator@meridian.test")
        self.okey="abcdefgh"*5
        self.nkey="ijklmnop"*5
        self.config=patch.dict(os.environ,{"PILOT_TRADE_BANK_KEYS_JSON":json.dumps({self.user["org_id"]:self.okey,self.other["org_id"]:self.nkey})})
        self.config.start()
        self.conn.execute("""INSERT INTO trade_credits (id,org_id,reference,applicant,beneficiary,issuing_bank,advising_bank,currency,amount_minor,required_documents,expires_at,presentation_deadline_at,profile,created_by,created_at,status,version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",("test-lc",self.user["org_id"],"ref","A","B","I","D","USD",100,"[]","2027-01-01T00:00:00Z","2026-12-30T00:00:00Z","sandbox",self.user["id"],db.now_iso(),"draft",1))
        self.obj=dict(event_id="evt-1",instrument_id="test-lc",bank_reference="sandbox-ref",status="received",observed_at=db.now_iso())
    def tearDown(self):
        self.config.stop();self.conn.close();self.env.close()
    def signed(self,raw=None,org=None,key=None,skew=0):
        raw=json.dumps(self.obj).encode() if raw is None else raw
        org=org or self.user["org_id"]
        stamp=str(int(db.now().timestamp())+skew)
        mac=hmac.new((key or self.okey).encode(),bank.signing_bytes(org,stamp,raw),hashlib.sha256).hexdigest()
        return raw,dict(zip(("X-Trade-Org","X-Trade-Timestamp","X-Trade-Signature"),(org,stamp,mac)))
    def put(self,*args,**kw): return bank.ingest(self.conn,*self.signed(*args,**kw))
    def test_signed_delivery_and_dup_does_not_change_credit(self):
        self.assertEqual(self.put()[0],201)
        self.assertTrue(self.put(skew=1)[1]["duplicate"])
        self.assertEqual(len(bank.observations(self.conn,self.user,"test-lc")),1)
        self.assertEqual(self.conn.execute("SELECT version,status FROM trade_credits").fetchone()[1],"draft")
        with self.assertRaises(sqlite3.IntegrityError):
            self.conn.execute("UPDATE trade_bank_observations SET status='processing'")
        self.obj["status"]="processing"
        with self.assertRaises(CommandError) as e: self.put()
        self.assertEqual(e.exception.status,409)
    def test_stale_lines_shifting_and_forged_signatures_denied(self):
        for kw in [{"skew":-301},{"skew":301},{"key":"attacker"}]:
            with self.assertRaises(CommandError) as e: self.put(**kw)
            self.assertEqual(e.exception.status,401)
        raw,headers=self.signed()
        with self.assertRaises(CommandError): bank.ingest(self.conn,raw+b" ",headers)
        with self.assertRaises(CommandError): bank.ingest(self.conn,raw,dict(headers,**{"X-Trade-Org":"arbitrary"}))
    def test_scope_and_disabled_status(self):
        with self.assertRaises(CommandError) as e: self.put(org=self.other["org_id"],key=self.nkey)
        self.assertEqual(e.exception.status,404)
        with self.assertRaises(CommandError) as e: bank.observations(self.conn,self.other,"test-lc")
        self.assertEqual(e.exception.status,404)
        with patch.dict(os.environ,{"PILOT_TRADE_BANK_KEYS_JSON":"{}"}):
            with self.assertRaises(CommandError) as e:self.put()
            self.assertEqual(e.exception.status,503)
    def test_malformed_no_facts_persisted(self):
        for raw in [b"null",b"[]",b'{"x":1,"x":2}',b"\xff",b" "*33000]:
            with self.assertRaises(CommandError): self.put(raw=raw)
        for mods in [{"status":"paid"},{"observed_at":"2029-01-01T00:00:00Z"},{"instrument_id":{}},{"extra":"bad"}]:
            with self.assertRaises(CommandError): self.put(raw=json.dumps(dict(self.obj,**mods)).encode())
        self.assertEqual(bank.observations(self.conn,self.user,"test-lc"),[])

class BankInboxHTTPTest(ServerCase):
    def test_signed_transport_actor_and_privileged_read_are_separate(self):
        op=self.client(); other=self.client(org="meridian")
        body=dict(reference="LC/http",applicant="Importer",beneficiary="Exporter",issuing_bank="Issuer",advising_bank="Advisor",
                  currency="USD",amount="200.00",expires_at="2027-01-01T00:00:00Z",required_documents=["invoice"],idempotency_key="http-create")
        lc=self.assertOk(op.req("POST","/api/trade/instruments",body),201)
        inbox="/api/trade/bank/sandbox/observations"
        query="/api/trade/instruments/"+lc["id"]+"/bank-observations"
        org=self.env.user("operator@harbourline.test")["org_id"]
        key="sandboxtest:"+"!"*32
        raw=json.dumps(dict(event_id="evt-http",instrument_id=lc["id"],bank_reference="received-17",status="received",observed_at=db.now_iso())).encode()
        stamp=str(int(db.now().timestamp()))
        mac=hmac.new(key.encode(),bank.signing_bytes(org,stamp,raw),hashlib.sha256).hexdigest()
        headers={"Content-Type":"application/json","X-Trade-Org":org,"X-Trade-Timestamp":stamp,"X-Trade-Signature":mac}
        sender=Client(self.port)
        with patch.dict(os.environ,{"PILOT_TRADE_BANK_KEYS_JSON":json.dumps({org:key})}):
            self.assertEqual(sender.req("POST",inbox,raw=raw).status,401)
            self.assertEqual(sender.req("POST",inbox,headers=headers,raw=raw).status,201)
            self.assertEqual(sender.req("POST",inbox,headers=headers,raw=raw).status,200)
        self.assertEqual(sender.get(query).status,401)
        self.assertEqual(other.get(query).status,404)
        items=self.assertOk(op.get(query))["observations"]
        self.assertEqual([i["event_id"] for i in items],["evt-http"])
        self.assertEqual(op.get("/api/trade/instruments/"+lc["id"]).json["status"],"draft")

if __name__=="__main__": unittest.main()
