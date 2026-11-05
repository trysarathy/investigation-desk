-- Single-provider sandbox; all credit terms immutable after creation.
CREATE TABLE trade_credits (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), reference TEXT NOT NULL,
 applicant TEXT NOT NULL, beneficiary TEXT NOT NULL, issuing_bank TEXT NOT NULL,
 advising_bank TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 required_documents TEXT NOT NULL, expires_at TEXT NOT NULL, presentation_deadline_at TEXT NOT NULL,
 profile TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 issued_at TEXT, status TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 UNIQUE(org_id,reference), UNIQUE(org_id,id)
);
CREATE TABLE trade_presentations (
 credit_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, presented_at TEXT NOT NULL, recorded_at TEXT NOT NULL,
 currency TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
 FOREIGN KEY(org_id,credit_id) REFERENCES trade_credits(org_id,id)
);
CREATE TABLE trade_documents (
 org_id TEXT NOT NULL, credit_id TEXT NOT NULL REFERENCES trade_presentations(credit_id),
 ordinal INTEGER NOT NULL, kind TEXT NOT NULL, reference TEXT NOT NULL, issuer TEXT, sha256 TEXT,
 PRIMARY KEY(credit_id,ordinal), FOREIGN KEY(org_id,credit_id) REFERENCES trade_credits(org_id,id)
);
CREATE TABLE trade_events (
 org_id TEXT NOT NULL, credit_id TEXT NOT NULL, seq INTEGER NOT NULL, action TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL, effective_at TEXT NOT NULL,
 known_at TEXT NOT NULL, status TEXT NOT NULL, payload_json TEXT NOT NULL,
 PRIMARY KEY(credit_id,seq), FOREIGN KEY(org_id,credit_id) REFERENCES trade_credits(org_id,id)
);
CREATE TRIGGER trade_events_no_update BEFORE UPDATE ON trade_events
BEGIN SELECT RAISE(ABORT,'trade events are immutable'); END;
CREATE TRIGGER trade_events_no_delete BEFORE DELETE ON trade_events
BEGIN SELECT RAISE(ABORT,'trade events are immutable'); END;
CREATE TABLE trade_requests (
 org_id TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id), request_key TEXT NOT NULL,
 digest TEXT NOT NULL, response_json TEXT NOT NULL,
 PRIMARY KEY(org_id,actor_id,request_key)
);
CREATE INDEX trade_queue ON trade_credits(org_id,status,created_at);

-- One review task per accepted presentation; this table is not a loan, reservation or draw.
CREATE TABLE trade_financing_tasks (
 org_id TEXT NOT NULL, credit_id TEXT NOT NULL PRIMARY KEY,
 trigger_seq INTEGER NOT NULL, created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('awaiting_handoff','handed_off')),
 handed_off_at TEXT, handed_off_by INTEGER REFERENCES users(id),
 FOREIGN KEY(org_id,credit_id) REFERENCES trade_credits(org_id,id),
 FOREIGN KEY(credit_id,trigger_seq) REFERENCES trade_events(credit_id,seq)
);

CREATE TRIGGER trade_credit_terms_no_update BEFORE UPDATE OF id,org_id,reference,applicant,beneficiary,issuing_bank,
 advising_bank,currency,amount_minor,required_documents,expires_at,presentation_deadline_at,profile,
 created_by,created_at ON trade_credits
BEGIN SELECT RAISE(ABORT,'credit terms are immutable under this profile'); END;
CREATE TRIGGER trade_presentation_no_update BEFORE UPDATE ON trade_presentations
BEGIN SELECT RAISE(ABORT,'a recorded presentation is immutable'); END;
CREATE TRIGGER trade_presentation_no_delete BEFORE DELETE ON trade_presentations
BEGIN SELECT RAISE(ABORT,'a recorded presentation is immutable'); END;
CREATE TRIGGER trade_document_no_update BEFORE UPDATE ON trade_documents
BEGIN SELECT RAISE(ABORT,'recorded document metadata are immutable'); END;
CREATE TRIGGER trade_document_no_delete BEFORE DELETE ON trade_documents
BEGIN SELECT RAISE(ABORT,'recorded document metadata are immutable'); END;
