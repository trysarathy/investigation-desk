-- rc8: the job queue and the scheduler get their own limited login, `clearline_jobs`, instead of the schema owner.
-- Runs as the schema owner. No existing control is relaxed: the runtime role keeps exactly its grants and policies;
-- the new role is NOBYPASSRLS, owns nothing, cannot create objects, and reaches only the queue.
--
-- scripts/db/setup-local.sh creates the login with its password. If it does not exist yet (an older setup), the role
-- is created here WITHOUT login, so nothing can sign in as it until an administrator sets a password.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clearline_jobs') THEN
    CREATE ROLE clearline_jobs NOLOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO clearline_jobs;
--> statement-breakpoint
-- The queue: claim, complete, retry and enqueue jobs. No delete (retention and tests use the owner).
GRANT SELECT, INSERT, UPDATE ON jobs TO clearline_jobs;
--> statement-breakpoint
-- The schedules are read (members set them through the app); the worker re-checks one before every run.
GRANT SELECT ON reconciliation_schedules TO clearline_jobs;
--> statement-breakpoint
CREATE POLICY jobs_queue ON jobs TO clearline_jobs USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY jobs_queue_read ON reconciliation_schedules FOR SELECT TO clearline_jobs USING (true);
--> statement-breakpoint

-- What enqueueDue needs from merchant tables, and nothing else: per enabled schedule, the entity's UTC offset, the
-- rule-set version and policy revision of its last run that did not fail, and its current policy revision. The
-- jobs login cannot read merchant_entities, reconciliation_runs or merchant_policy themselves.
CREATE FUNCTION jobs_due_schedules() RETURNS TABLE (org_id uuid, entity_id text, local_time text, run_as text, utc_offset_minutes integer,
  prev_rule_set_version text, prev_policy_revision integer, policy_revision integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT s.org_id, s.entity_id, s.local_time, s.run_as, e.utc_offset_minutes, prev.rule_set_version, prev.policy_revision, coalesce(p.revision, 0)
  FROM public.reconciliation_schedules s
  JOIN public.merchant_entities e ON e.org_id = s.org_id AND e.id = s.entity_id
  LEFT JOIN public.merchant_policy p ON p.org_id = s.org_id AND p.entity_id = s.entity_id
  LEFT JOIN LATERAL (SELECT r.rule_set_version, r.policy_revision FROM public.reconciliation_runs r
    WHERE r.org_id = s.org_id AND r.entity_id = s.entity_id AND r.status <> 'failed'
    ORDER BY r.started_at DESC, r.finished_at DESC LIMIT 1) prev ON true
  WHERE s.enabled
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobs_due_schedules() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION jobs_due_schedules() TO clearline_jobs;
--> statement-breakpoint

-- Who a job runs as: the organisation's slug and the member's id, name and email, only while that member's enabled
-- schedule for the entity still names them (the same re-check the worker already makes). Nothing for anyone else.
CREATE FUNCTION jobs_run_principal(org uuid, entity text, member text) RETURNS TABLE (slug text, user_id text, name text, email text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT o.slug, u.id, u.name, u.email
  FROM public.reconciliation_schedules s
  JOIN public.organizations o ON o.id = s.org_id
  JOIN public.users u ON u.id = s.run_as
  WHERE s.org_id = org AND s.entity_id = entity AND s.run_as = member AND s.enabled
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION jobs_run_principal(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION jobs_run_principal(uuid, text, text) TO clearline_jobs;
