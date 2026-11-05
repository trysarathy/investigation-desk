-- Separate records of externally evidenced collections and bills of lading.
-- No mechanism in these tables conveys ownership, releases documents or settles funds.
CREATE TABLE trade_external_records (
 id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id),
 kind TEXT NOT NULL CHECK(kind IN ('collection','ebl')),
 reference TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id),
 status TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>=1),
 details TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(org_id,kind,reference), UNIQUE(org_id,id)
);
CREATE INDEX ix_trade_records_org ON trade_external_records(org_id,created_at);
CREATE TABLE trade_record_events (
 org_id TEXT NOT NULL, record_id TEXT NOT NULL, seq INTEGER NOT NULL,
 action TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id), known_at TEXT NOT NULL,
 payload TEXT NOT NULL, resulting_status TEXT NOT NULL, key TEXT NOT NULL,
 fingerprint TEXT NOT NULL, PRIMARY KEY(record_id,seq), UNIQUE(org_id,actor_id,key),
 FOREIGN KEY(org_id,record_id) REFERENCES trade_external_records(org_id,id)
);
CREATE TRIGGER trade_record_events_no_update BEFORE UPDATE ON trade_record_events
BEGIN SELECT RAISE(ABORT,'immutable trade record event'); END;
CREATE TRIGGER trade_record_events_no_delete BEFORE DELETE ON trade_record_events
BEGIN SELECT RAISE(ABORT,'immutable trade record event'); END;
