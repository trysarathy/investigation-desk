-- v1 Phase 0.5 (founder decisions 12-16): the evidence-level split. A match record stores its bank evidence level
-- apart from its decision: 'none' or 'imported_two_person_confirmed' (an imported statement line, confirmed by a second
-- person, in a batch that ties). The third level, 'bank_authenticated', is reserved: nothing produces it yet, so this
-- check refuses it until a later migration adds a bank connection. `settled` = every batch of the payment ties to the
-- cent with evidence of at least imported_two_person_confirmed. Existing rows get 'none' / false (never higher than the
-- evidence supports) until the next run re-decides them. Runs as the schema owner; no existing control is changed.
ALTER TABLE "match_records" ADD COLUMN "bank_evidence" text DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "match_records" ADD COLUMN "settled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_bank_evidence_chk" CHECK ("match_records"."bank_evidence" in ('none','imported_two_person_confirmed'));
--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_settled_chk" CHECK (NOT "match_records"."settled" OR "match_records"."bank_evidence" <> 'none');
--> statement-breakpoint
ALTER TABLE "match_records" ADD CONSTRAINT "match_records_bank_evidence_part_chk" CHECK (("match_records"."bank"->>'evidence') IS NULL OR ("match_records"."bank"->>'evidence') = "match_records"."bank_evidence");
