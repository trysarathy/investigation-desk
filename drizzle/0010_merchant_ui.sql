CREATE TABLE "recon_exception_notes" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"exception_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"reference" text,
	"author_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recon_exception_notes_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "recon_exception_notes_kind_chk" CHECK ("recon_exception_notes"."kind" in ('note','evidence')),
	CONSTRAINT "recon_exception_notes_body_chk" CHECK (length("recon_exception_notes"."body") between 1 and 2000),
	CONSTRAINT "recon_exception_notes_ref_chk" CHECK ("recon_exception_notes"."reference" is null or length("recon_exception_notes"."reference") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "recon_exception_notes" ADD CONSTRAINT "recon_exception_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_exception_notes" ADD CONSTRAINT "recon_exception_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recon_exception_notes" ADD CONSTRAINT "recon_exception_notes_exception_fk" FOREIGN KEY ("org_id","exception_id") REFERENCES "public"."recon_exceptions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recon_exception_notes_exception_idx" ON "recon_exception_notes" USING btree ("org_id","exception_id");