-- Pair identity is canonical, tenant scoped, and versioned regardless of which case is opened.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dup_cases_org_id ON cases(org_id,id);
CREATE TABLE duplicate_decisions(
  org_id TEXT NOT NULL,
  case_a TEXT NOT NULL, case_b TEXT NOT NULL CHECK(case_a<case_b),
  version INTEGER NOT NULL CHECK(version>0),
  disposition TEXT NOT NULL CHECK(disposition IN ('distinct','possible_duplicate','confirmed_duplicate','reopen')),
  reason TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id),
  actor_role TEXT NOT NULL, known_at TEXT NOT NULL, request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL, signal_snapshot TEXT NOT NULL,
  PRIMARY KEY(org_id,case_a,case_b,version),
  UNIQUE(org_id,actor_id,request_key),
  FOREIGN KEY(org_id,case_a) REFERENCES cases(org_id,id),
  FOREIGN KEY(org_id,case_b) REFERENCES cases(org_id,id)
);
CREATE INDEX ix_dup_by_second_case ON duplicate_decisions(org_id,case_b,case_a,version);
CREATE TRIGGER duplicate_decisions_no_update BEFORE UPDATE ON duplicate_decisions
BEGIN SELECT RAISE(ABORT,'duplicate decisions are append-only'); END;
CREATE TRIGGER duplicate_decisions_no_delete BEFORE DELETE ON duplicate_decisions
BEGIN SELECT RAISE(ABORT,'duplicate decisions are append-only'); END;
