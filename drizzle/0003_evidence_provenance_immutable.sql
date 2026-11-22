-- rc5: evidence provenance never changes after insert, and a statement import is confirmed by a second person.

CREATE FUNCTION keep_evidence_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provenance IS DISTINCT FROM OLD.provenance OR NEW.import_id IS DISTINCT FROM OLD.import_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'settlement_evidence provenance, import id and kind are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER settlement_evidence_provenance_immutable BEFORE UPDATE ON settlement_evidence FOR EACH ROW EXECUTE FUNCTION keep_evidence_provenance();
--> statement-breakpoint

-- A pending import may move once to imported or declined, by an active Approver who is not the importer;
-- its file, lines and importer never change; closed imports never change.
CREATE FUNCTION check_import_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'statement import is closed (%)', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('imported', 'declined') THEN
    RAISE EXCEPTION 'a pending import can only be confirmed or declined' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.file_sha256 <> OLD.file_sha256 OR NEW.lines::text <> OLD.lines::text OR NEW.imported_by <> OLD.imported_by THEN
    RAISE EXCEPTION 'statement import content is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.confirmed_by IS NULL OR NEW.confirmed_by = OLD.imported_by THEN
    RAISE EXCEPTION 'maker-checker: the importer cannot confirm their own import' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM organization_memberships m WHERE m.org_id = NEW.org_id AND m.user_id = NEW.confirmed_by
                 AND m.role = 'approver' AND m.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'maker-checker: confirmer is not an active approver' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER statement_imports_transition BEFORE UPDATE ON statement_imports FOR EACH ROW EXECUTE FUNCTION check_import_transition();
--> statement-breakpoint
CREATE TRIGGER statement_imports_no_delete BEFORE DELETE ON statement_imports FOR EACH ROW EXECUTE FUNCTION refuse_change();
