-- One accepted full drawing may originate only one provider funding case.
CREATE UNIQUE INDEX IF NOT EXISTS cases_org_id_id ON cases(org_id,id);
CREATE TABLE instrument_funding_links (
 org_id TEXT NOT NULL, credit_id TEXT NOT NULL, case_id TEXT NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 PRIMARY KEY(org_id,credit_id), UNIQUE(org_id,case_id),
 FOREIGN KEY(org_id,credit_id) REFERENCES trade_credits(org_id,id),
 FOREIGN KEY(org_id,case_id) REFERENCES cases(org_id,id)
);
CREATE TRIGGER funding_links_no_update BEFORE UPDATE ON instrument_funding_links
BEGIN SELECT RAISE(ABORT,'Funding origin is immutable'); END;
CREATE TRIGGER funding_links_no_delete BEFORE DELETE ON instrument_funding_links
BEGIN SELECT RAISE(ABORT,'Funding origin is immutable'); END;
