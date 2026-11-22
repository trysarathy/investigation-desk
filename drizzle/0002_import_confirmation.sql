ALTER TABLE "statement_imports" DROP CONSTRAINT "statement_imports_status_chk";--> statement-breakpoint
ALTER TABLE "statement_imports" ADD COLUMN "lines" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_confirmer_chk" CHECK ("statement_imports"."confirmed_by" is null or "statement_imports"."confirmed_by" <> "statement_imports"."imported_by");--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_status_chk" CHECK ("statement_imports"."status" in ('pending_confirmation','imported','rejected','declined'));