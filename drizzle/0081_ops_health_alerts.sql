-- v1 phase 5.5: what uptime checks and alert rules read. Runs as the schema owner. No existing control is relaxed:
-- one new table only the jobs login writes, and two SECURITY DEFINER functions that return a timestamp and counts.
--
-- 1. ops_worker_heartbeats: the job worker records each pass (worker id, start, last pass, pass count). Only the jobs
--    login (`clearline_jobs`) may read or write it; RLS is forced; the runtime login has no privilege on it.
-- 2. ops_worker_last_seen(): the newest heartbeat time, nothing else. EXECUTE for the runtime login (the /api/ready and
--    /api/health checks and the status page) and the jobs login. APPROVAL-ONLY (v1 E4): this is one new function grant
--    to the runtime login; tests/control/ops-health.test.ts pins that it returns a single timestamp.
-- 3. ops_alert_metrics(since, now_at): aggregate COUNTS across every organisation for the alert rules (failed runs, dead
--    jobs, failed sign-ins and second factors, job backlog, chain reads per network and status). No ids, no names, no
--    addresses, no organisation. EXECUTE for the jobs login only (the worker evaluates the rules).

CREATE TABLE "ops_worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"passes" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ops_worker_heartbeats_id_chk" CHECK ("worker_id" ~ '^[A-Za-z0-9._:-]{1,128}$'),
	CONSTRAINT "ops_worker_heartbeats_passes_chk" CHECK ("passes" >= 0)
);
--> statement-breakpoint
ALTER TABLE ops_worker_heartbeats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops_worker_heartbeats FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON ops_worker_heartbeats FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ops_worker_heartbeats TO clearline_jobs;
--> statement-breakpoint
CREATE POLICY ops_worker_heartbeats_jobs ON ops_worker_heartbeats TO clearline_jobs USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE FUNCTION ops_worker_last_seen() RETURNS timestamp with time zone
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT max(last_seen_at) FROM public.ops_worker_heartbeats
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION ops_worker_last_seen() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ops_worker_last_seen() TO clearline_app, clearline_jobs;
--> statement-breakpoint

CREATE FUNCTION ops_alert_metrics(since timestamp with time zone, now_at timestamp with time zone) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT jsonb_build_object(
    'failed_runs', (SELECT count(*) FROM public.reconciliation_runs WHERE status = 'failed' AND finished_at >= since),
    'dead_jobs', (SELECT count(*) FROM public.jobs WHERE status = 'dead' AND finished_at >= since),
    'login_failures', (SELECT count(*) FROM public.login_failures WHERE at >= since),
    'mfa_failures', (SELECT count(*) FROM public.auth_rate_events WHERE scope = 'mfa_account' AND at >= since),
    'queued_due', (SELECT count(*) FROM public.jobs WHERE status = 'queued' AND run_after <= now_at),
    'oldest_due_seconds', (SELECT coalesce(floor(extract(epoch FROM now_at - min(run_after))), 0)::bigint FROM public.jobs WHERE status = 'queued' AND run_after <= now_at),
    'worker_last_seen', (SELECT max(last_seen_at) FROM public.ops_worker_heartbeats),
    'chain', coalesce((SELECT jsonb_object_agg(network, jsonb_build_object('total', total, 'unavailable', unavailable))
      FROM (SELECT network, count(*) AS total, count(*) FILTER (WHERE status = 'unavailable') AS unavailable
        FROM public.chain_reads WHERE at >= since AND at <= now_at AND network ~ '^[a-z0-9_]{1,32}$' GROUP BY network) c), '{}'::jsonb)
  )
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION ops_alert_metrics(timestamp with time zone, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ops_alert_metrics(timestamp with time zone, timestamp with time zone) TO clearline_jobs;
