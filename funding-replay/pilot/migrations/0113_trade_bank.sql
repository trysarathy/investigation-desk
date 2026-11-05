-- Records authenticated delivery of a sandbox bank message, not its economic truth.
CREATE TABLE trade_bank_observations (
 org_id TEXT NOT NULL, event_id TEXT NOT NULL, instrument_id TEXT NOT NULL,
 bank_reference TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('received','processing','rejected')),
 observed_at TEXT NOT NULL, known_at TEXT NOT NULL, payload_sha256 TEXT NOT NULL,
 PRIMARY KEY(org_id,event_id),
 FOREIGN KEY(org_id,instrument_id) REFERENCES trade_credits(org_id,id)
);
CREATE INDEX ix_trade_bank_obs_record ON trade_bank_observations(org_id,instrument_id,known_at);
CREATE TRIGGER trade_bank_obs_no_update BEFORE UPDATE ON trade_bank_observations
BEGIN SELECT RAISE(ABORT,'immutable bank observation'); END;
CREATE TRIGGER trade_bank_obs_no_delete BEFORE DELETE ON trade_bank_observations
BEGIN SELECT RAISE(ABORT,'immutable bank observation'); END;
