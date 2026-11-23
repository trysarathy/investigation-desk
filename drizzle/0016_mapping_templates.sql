CREATE TABLE "mapping_templates" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider_org_id" uuid,
	"file_type" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"header_signature" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapping_templates_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "mapping_templates_type_chk" CHECK ("mapping_templates"."file_type" in ('provider_export','settlement_report','orders_invoices','bank_statement')),
	CONSTRAINT "mapping_templates_provider_chk" CHECK (("mapping_templates"."file_type" in ('provider_export','settlement_report')) = ("mapping_templates"."provider_org_id" is not null)),
	CONSTRAINT "mapping_templates_name_chk" CHECK (length("mapping_templates"."name") between 1 and 120),
	CONSTRAINT "mapping_templates_version_chk" CHECK ("mapping_templates"."version" >= 1),
	CONSTRAINT "mapping_templates_sig_chk" CHECK ("mapping_templates"."header_signature" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "data_mode" text DEFAULT 'sample' NOT NULL;--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_provider_org_id_organizations_id_fk" FOREIGN KEY ("provider_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_templates" ADD CONSTRAINT "mapping_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_templates_version_uq" ON "mapping_templates" USING btree ("org_id","file_type","name","version");--> statement-breakpoint
CREATE INDEX "mapping_templates_signature_idx" ON "mapping_templates" USING btree ("org_id","file_type","header_signature");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_data_mode_chk" CHECK ("organizations"."data_mode" in ('sample','live'));