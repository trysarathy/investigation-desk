-- v1 phase 0: every difference names the reconciliation run and rule-set version that produced it, and a later run
-- that re-decides the payment marks the previous rows superseded (when, and by which run). Rows are never deleted
-- and their amounts, types, reasons and rules never change: superseding sets two columns, once, and nothing else.
-- Pages, exports and month-end read the current rows (superseded_at is null); the superseded rows stay in the
-- evidence and audit views. Runs as the schema owner.
--
-- SECURITY CONTROL CHANGE (flagged for approval): the app role gains UPDATE on the two supersede columns of
-- differences only (column-scoped grant). The append-only trigger is replaced by one that still refuses every
-- DELETE and every UPDATE except NULL -> set on (superseded_at, superseded_by_run_id), and refuses to supersede a
-- difference an approved write-off relies on.

ALTER TABLE "differences" ADD COLUMN "run_id" uuid;
--> statement-breakpoint
ALTER TABLE "differences" ADD COLUMN "rule_set_version" text;
--> statement-breakpoint
-- 'run': written by a run (every new row). 'backfill_derived': an older row whose run was derived from the stored
-- decision that names it (the run that wrote that decision, input hash and time window matching). 'backfill_unknown':
-- an older row whose run cannot be derived (rule_set_version 'legacy:unknown', run_id null).
ALTER TABLE "differences" ADD COLUMN "stamp_source" text;
--> statement-breakpoint
ALTER TABLE "differences" ADD COLUMN "superseded_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "differences" ADD COLUMN "superseded_by_run_id" uuid;
--> statement-breakpoint

-- Backfill. The old append-only trigger refuses every UPDATE; it is dropped here and replaced below.
DROP TRIGGER differences_append_only ON differences;
--> statement-breakpoint
-- The run that wrote each payment's current decision: same entity, a 'changed' run, same input hash, and the
-- decision's computed_at inside the run's start/finish window (the latest such run, should two qualify).
CREATE TEMP TABLE difference_backfill_runs AS
SELECT m.org_id, m.order_id, r.id AS run_id, r.rule_set_version, r.finished_at
FROM match_records m
JOIN invoices i ON i.org_id = m.org_id AND i.order_id = m.order_id
JOIN LATERAL (
  SELECT x.id, x.rule_set_version, x.finished_at FROM reconciliation_runs x
  WHERE x.org_id = m.org_id AND x.entity_id = i.entity_id AND x.status = 'changed' AND x.input_sha256 = m.input_sha256
    AND m.computed_at BETWEEN x.started_at AND x.finished_at
  ORDER BY x.started_at DESC LIMIT 1
) r ON true;
--> statement-breakpoint
-- The persisted ids the current decision names.
CREATE TEMP TABLE difference_backfill_current AS
SELECT DISTINCT m.org_id, m.order_id, d ->> 'persistedId' AS id
FROM match_records m, jsonb_array_elements(coalesce(m.explanation -> 'differences', '[]'::jsonb)) d
WHERE d ->> 'persistedId' IS NOT NULL;
--> statement-breakpoint
-- Current rows whose run is derivable.
UPDATE differences x SET run_id = b.run_id, rule_set_version = b.rule_set_version, stamp_source = 'backfill_derived'
FROM difference_backfill_current c JOIN difference_backfill_runs b ON b.org_id = c.org_id AND b.order_id = c.order_id
WHERE x.org_id = c.org_id AND x.id = c.id AND x.order_id = c.order_id;
--> statement-breakpoint
UPDATE differences SET rule_set_version = 'legacy:unknown', stamp_source = 'backfill_unknown' WHERE stamp_source IS NULL;
--> statement-breakpoint
-- Rows of a payment that has a stored decision but are not named by it were written by an earlier run: superseded.
-- By the run that wrote the current decision when derivable (at its finish), else at migration time with no run.
-- A row an approved write-off relies on is never superseded.
UPDATE differences x SET superseded_at = coalesce(b.finished_at, now()), superseded_by_run_id = b.run_id
FROM match_records m LEFT JOIN difference_backfill_runs b ON b.org_id = m.org_id AND b.order_id = m.order_id
WHERE x.org_id = m.org_id AND x.order_id = m.order_id
  AND NOT EXISTS (SELECT 1 FROM difference_backfill_current c WHERE c.org_id = x.org_id AND c.id = x.id)
  AND NOT EXISTS (SELECT 1 FROM writeoff_proposals w WHERE w.org_id = x.org_id AND w.status = 'approved' AND w.difference_ids ? x.id);
--> statement-breakpoint

DROP TABLE difference_backfill_runs, difference_backfill_current;
--> statement-breakpoint
ALTER TABLE "differences" ALTER COLUMN "rule_set_version" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "differences" ALTER COLUMN "stamp_source" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "differences" ADD CONSTRAINT "differences_stamp_chk" CHECK (
  ("stamp_source" in ('run','backfill_derived') and "run_id" is not null and "rule_set_version" !~ '^legacy:')
  or ("stamp_source" = 'backfill_unknown' and "run_id" is null and "rule_set_version" = 'legacy:unknown'));
--> statement-breakpoint
ALTER TABLE "differences" ADD CONSTRAINT "differences_superseded_chk" CHECK ("superseded_by_run_id" is null or "superseded_at" is not null);
--> statement-breakpoint
-- A run row is inserted at the end of the run's transaction, after its differences: the run sets these two checks
-- DEFERRED for its own transaction (SET CONSTRAINTS). Everywhere else they are immediate, so a deletion that removes
-- runs before differences is refused at once (and never leaves pending trigger events behind an ALTER TABLE).
ALTER TABLE "differences" ADD CONSTRAINT "differences_run_fk" FOREIGN KEY ("org_id","run_id") REFERENCES "public"."reconciliation_runs"("org_id","id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "differences" ADD CONSTRAINT "differences_superseded_by_run_fk" FOREIGN KEY ("org_id","superseded_by_run_id") REFERENCES "public"."reconciliation_runs"("org_id","id") DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
CREATE INDEX "differences_current_idx" ON "differences" USING btree ("org_id","order_id") WHERE "superseded_at" IS NULL;
--> statement-breakpoint

-- A new row is written by a run, stamped, and not born superseded.
CREATE FUNCTION differences_check_insert() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.stamp_source <> 'run' OR NEW.run_id IS NULL OR NEW.rule_set_version ~ '^legacy:' OR NEW.superseded_at IS NOT NULL OR NEW.superseded_by_run_id IS NOT NULL THEN
    RAISE EXCEPTION 'a new difference names the run and rule-set version that produced it and is current' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER differences_stamp_required BEFORE INSERT ON differences FOR EACH ROW EXECUTE FUNCTION differences_check_insert();
--> statement-breakpoint
-- Append-only, except that a current row may be marked superseded once, by a run; never deleted, nothing else changes.
-- SECURITY DEFINER so that the approved-write-off check sees every write-off of the row's organisation.
CREATE FUNCTION differences_supersede_only() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'differences are append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL OR NEW.superseded_by_run_id IS NULL
     OR (to_jsonb(NEW) - 'superseded_at' - 'superseded_by_run_id') <> (to_jsonb(OLD) - 'superseded_at' - 'superseded_by_run_id') THEN
    RAISE EXCEPTION 'differences are append-only: a current row may only be marked superseded by a run, once' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.writeoff_proposals w WHERE w.org_id = OLD.org_id AND w.status = 'approved' AND w.difference_ids ? OLD.id) THEN
    RAISE EXCEPTION 'a difference an approved write-off relies on is never superseded' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Same trigger name as before (upload retention disables it by name to remove an upload's own rows).
CREATE TRIGGER differences_append_only BEFORE UPDATE OR DELETE ON differences FOR EACH ROW EXECUTE FUNCTION differences_supersede_only();
--> statement-breakpoint
GRANT UPDATE ("superseded_at", "superseded_by_run_id") ON differences TO clearline_app;
