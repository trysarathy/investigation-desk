-- New decisions only. Prior route states cannot be inferred from today's facility headroom.
CREATE TABLE funding_decision_snapshots (
 org_id TEXT NOT NULL, case_id TEXT NOT NULL, sequence INTEGER NOT NULL, known_at TEXT NOT NULL,
 command TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users(id), role TEXT NOT NULL,
 reason TEXT, model_version TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
 PRIMARY KEY(org_id,case_id,sequence), FOREIGN KEY(org_id,case_id) REFERENCES cases(org_id,id)
);
CREATE TRIGGER decision_snapshots_no_update BEFORE UPDATE ON funding_decision_snapshots
BEGIN SELECT RAISE(ABORT,'Decision snapshots are append only'); END;
CREATE TRIGGER decision_snapshots_no_delete BEFORE DELETE ON funding_decision_snapshots
BEGIN SELECT RAISE(ABORT,'Decision snapshots are append only'); END;
