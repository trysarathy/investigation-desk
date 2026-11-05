-- Measurement snapshots are corrections by supersession, never in-place replacements.
CREATE TABLE pilot_measurements (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 org_id TEXT NOT NULL REFERENCES orgs(id),
 case_id TEXT NOT NULL REFERENCES cases(id),
 actor INTEGER NOT NULL REFERENCES users(id),
 side TEXT NOT NULL CHECK(side IN ('baseline','pilot')),
 known_at TEXT NOT NULL,
 body TEXT NOT NULL,
 request_key TEXT NOT NULL,
 UNIQUE(org_id,actor,request_key)
);
CREATE INDEX ix_measurement_asof ON pilot_measurements(org_id,case_id,known_at,id);
CREATE TRIGGER measurements_no_update BEFORE UPDATE ON pilot_measurements
BEGIN SELECT RAISE(ABORT,'measurements are append-only'); END;
CREATE TRIGGER measurements_no_delete BEFORE DELETE ON pilot_measurements
BEGIN SELECT RAISE(ABORT,'measurements are append-only'); END;
