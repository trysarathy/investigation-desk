-- v1 phase 3 (volume and workers). Runs as the schema owner. No existing control is relaxed:
--  * the worker keeps its own limited login (clearline_jobs, 0029): it gains the job events table and two narrow
--    SECURITY DEFINER functions (who asked for a manual job; which organisations have uploads to purge), nothing else;
--  * the web app (clearline_app) may only ENQUEUE a manual job for itself: INSERT of eight columns, under a policy that
--    pins the organisation, the member (run_as = the signed-in user), the trigger 'manual' and a queued, untouched row
--    (the entity_scope restrictive policy of 0053 applies as for every jobs row); it cannot change or delete a job;
--  * members read their organisation's job events (progress) exactly as they read its jobs.

-- 1. Jobs: four kinds, a manual trigger, the stage the job is at, a heartbeat, recoveries and parameters/result.
ALTER TABLE jobs DROP CONSTRAINT jobs_kind_chk;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_chk CHECK (kind IN ('reconcile', 'retention', 'revaluation', 'pickup'));
--> statement-breakpoint
ALTER TABLE jobs DROP CONSTRAINT jobs_trigger_chk;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_trigger_chk CHECK (trigger IN ('schedule', 'rule_change', 'manual'));
--> statement-breakpoint
-- A retention job belongs to an organisation, not an entity or a member (it runs as the retention login, see below).
ALTER TABLE jobs ALTER COLUMN entity_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE jobs ALTER COLUMN run_as DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_subject_chk CHECK (
  (kind = 'retention' AND entity_id IS NULL AND run_as IS NULL AND trigger = 'schedule')
  OR (kind <> 'retention' AND entity_id IS NOT NULL AND run_as IS NOT NULL));
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN stage text;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN heartbeat_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN recoveries integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN params jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE jobs ADD COLUMN result jsonb;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_stage_chk CHECK (stage IS NULL OR stage ~ '^[a-z_]{1,32}$');
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_recoveries_chk CHECK (recoveries >= 0);
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_dedupe_chk CHECK (dedupe_key ~ '^[A-Za-z0-9:/._#-]{1,128}$');
--> statement-breakpoint
-- one row per (organisation, entity, key), an organisation-level job included (its entity is NULL)
DROP INDEX jobs_dedupe_idx;
--> statement-breakpoint
CREATE UNIQUE INDEX jobs_dedupe_idx ON jobs USING btree (org_id, entity_id, dedupe_key) NULLS NOT DISTINCT;
--> statement-breakpoint
CREATE INDEX jobs_org_created_idx ON jobs USING btree (org_id, created_at DESC);
--> statement-breakpoint

-- 2. Job events: what the worker did, stage by stage (append-only; ids, stages, codes and counts only).
CREATE TABLE job_events (
  org_id uuid NOT NULL REFERENCES organizations(id),
  id bigint GENERATED ALWAYS AS IDENTITY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  at timestamp with time zone NOT NULL DEFAULT now(),
  event text NOT NULL,
  stage text,
  attempt integer,
  code text,
  counts jsonb,
  PRIMARY KEY (org_id, id),
  CONSTRAINT job_events_event_chk CHECK (event IN ('claimed', 'stage', 'heartbeat', 'done', 'cancelled', 'retry', 'dead', 'recovered', 'requeued')),
  CONSTRAINT job_events_stage_chk CHECK (stage IS NULL OR stage ~ '^[a-z_]{1,32}$'),
  CONSTRAINT job_events_code_chk CHECK (code IS NULL OR code ~ '^[A-Z0-9_]{2,64}$'),
  CONSTRAINT job_events_counts_chk CHECK (counts IS NULL OR jsonb_typeof(counts) = 'object')
);
--> statement-breakpoint
CREATE INDEX job_events_job_idx ON job_events USING btree (job_id, id);
--> statement-breakpoint
CREATE FUNCTION job_events_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'job_events is append-only' USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint
CREATE TRIGGER job_events_no_update BEFORE UPDATE ON job_events FOR EACH ROW EXECUTE FUNCTION job_events_append_only();
--> statement-breakpoint
-- the event's organisation is its job's (a worker cannot file an event under another organisation)
CREATE FUNCTION job_events_same_org() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'job event for another organisation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION job_events_same_org() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER job_events_org BEFORE INSERT ON job_events FOR EACH ROW EXECUTE FUNCTION job_events_same_org();
--> statement-breakpoint
ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE job_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY member_read ON job_events FOR SELECT TO clearline_app USING (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
-- a scoped member sees an event only when its job is visible (the job's own policies, entity_scope included, apply)
CREATE POLICY entity_scope ON job_events AS RESTRICTIVE FOR ALL TO clearline_app
  USING (EXISTS (SELECT 1 FROM jobs p WHERE p.id = job_events.job_id AND p.org_id = job_events.org_id));
--> statement-breakpoint
CREATE POLICY jobs_queue ON job_events TO clearline_jobs USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON job_events TO clearline_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON job_events TO clearline_jobs;
--> statement-breakpoint

-- 3. The web app enqueues a manual job for the signed-in member only (never a scheduled one, never another member's).
CREATE POLICY member_enqueue ON jobs FOR INSERT TO clearline_app WITH CHECK (
  org_id = app_org_id() AND app_is_member(org_id) AND run_as = app_user_id() AND trigger = 'manual'
  AND kind IN ('reconcile', 'revaluation', 'pickup') AND entity_id IS NOT NULL
  AND status = 'queued' AND attempts = 0 AND locked_by IS NULL AND locked_at IS NULL AND run_id IS NULL AND result IS NULL AND recoveries = 0);
--> statement-breakpoint
GRANT INSERT (org_id, entity_id, kind, trigger, dedupe_key, run_as, run_after, params) ON jobs TO clearline_app;
--> statement-breakpoint

-- 4. Who a manual job runs as: the member who asked, while their membership of the organisation is active (the worker
-- then signs in as them through resolveTenant, which checks the membership and entity scope again; the run checks the
-- permission). Nothing for a revoked member or anyone else.
CREATE FUNCTION jobs_requester_principal(org uuid, member text) RETURNS TABLE (slug text, user_id text, name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT o.slug, u.id, u.name, u.email
  FROM public.organization_memberships m
  JOIN public.organizations o ON o.id = m.org_id
  JOIN public.users u ON u.id = m.user_id
  WHERE m.org_id = org AND m.user_id = member AND m.revoked_at IS NULL
  LIMIT 1
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobs_requester_principal(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION jobs_requester_principal(uuid, text) TO clearline_jobs;
--> statement-breakpoint

-- 5. Which organisations have an upload past its retention date (ids only), so the scheduler can enqueue retention.
CREATE FUNCTION jobs_retention_due(at timestamp with time zone) RETURNS TABLE (org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT DISTINCT u.org_id FROM public.uploads u WHERE u.status <> 'deleted' AND u.delete_after <= at
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobs_retention_due(timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION jobs_retention_due(timestamp with time zone) TO clearline_jobs;
--> statement-breakpoint

-- 6. Runs record what they ran on: per-part input hashes, the uploads (and their mapping template versions) the rows
-- came from, and the engine version. A stored result carries a fingerprint of its content, so a run rewrites only
-- what changed (the same stored state as rewriting everything).
ALTER TABLE reconciliation_runs ADD COLUMN input_manifest jsonb;
--> statement-breakpoint
ALTER TABLE reconciliation_runs ADD COLUMN engine_version text;
--> statement-breakpoint
ALTER TABLE match_records ADD COLUMN content_sha256 text;
--> statement-breakpoint
ALTER TABLE match_records ADD CONSTRAINT match_records_content_sha_chk CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
ALTER TABLE merchant_journal_proposals ADD COLUMN content_sha256 text;
--> statement-breakpoint
ALTER TABLE merchant_journal_proposals ADD CONSTRAINT merchant_journal_content_sha_chk CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$');
--> statement-breakpoint
-- A fingerprint never outlives its content: an update that changes a record's (or proposal's) content without
-- giving a new fingerprint clears it, so the next run rewrites that row instead of trusting a stale fingerprint.
CREATE FUNCTION clear_stale_content_sha() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.content_sha256 IS NOT DISTINCT FROM OLD.content_sha256 THEN NEW.content_sha256 := NULL; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER match_records_content_sha BEFORE UPDATE OF decision, deciding_step, rule_id, chain, provider, bank, ledger, explanation, engine_version, bank_evidence, settled
  ON match_records FOR EACH ROW EXECUTE FUNCTION clear_stale_content_sha();
--> statement-breakpoint
CREATE TRIGGER merchant_journal_content_sha BEFORE UPDATE OF entity_id, pattern, lines, currency, evidence_refs
  ON merchant_journal_proposals FOR EACH ROW EXECUTE FUNCTION clear_stale_content_sha();
