-- rc7 blind test (generic): a JSON file whose top-level object holds several lists (e.g. { "records": [...],
-- "payouts": [...] }) is read from the list the person chooses at upload, never guessed. The choice is a file fact:
-- set when the upload is stored and never changed afterwards (as the other file facts; check_upload is unchanged).
ALTER TABLE "uploads" ADD COLUMN "json_list" text;
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_json_list_chk" CHECK ("uploads"."json_list" is null or ("uploads"."file_format" = 'json' and length("uploads"."json_list") between 1 and 200));
--> statement-breakpoint
CREATE FUNCTION check_upload_json_list() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.json_list IS DISTINCT FROM OLD.json_list THEN
    RAISE EXCEPTION 'an upload''s file facts are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER uploads_json_list_check BEFORE UPDATE ON uploads FOR EACH ROW EXECUTE FUNCTION check_upload_json_list();
