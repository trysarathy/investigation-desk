-- Case numbers are allocated per organisation so an id never reveals another customer's case volume.
-- Ids stay globally unique by carrying the organisation's short code: CL-<year>-<org code>-<n>.
CREATE TABLE IF NOT EXISTS case_counters_org (
  org_id TEXT NOT NULL REFERENCES orgs(id),
  year   INTEGER NOT NULL,
  last   INTEGER NOT NULL,
  PRIMARY KEY (org_id, year)
);
