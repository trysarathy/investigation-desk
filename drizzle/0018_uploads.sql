CREATE TABLE "merchant_data_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_data_settings_retention_chk" CHECK ("merchant_data_settings"."retention_days" between 1 and 3650)
);
--> statement-breakpoint
CREATE TABLE "upload_rows" (
	"org_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" text NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_hash" text,
	"target_ref" text,
	CONSTRAINT "upload_rows_org_id_upload_id_row_number_pk" PRIMARY KEY("org_id","upload_id","row_number"),
	CONSTRAINT "upload_rows_status_chk" CHECK ("upload_rows"."status" in ('accepted','warning','rejected','duplicate')),
	CONSTRAINT "upload_rows_hash_chk" CHECK ("upload_rows"."row_hash" is null or "upload_rows"."row_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"file_type" text NOT NULL,
	"file_format" text NOT NULL,
	"original_name" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_sha256" text NOT NULL,
	"storage_key" text,
	"encrypted" boolean NOT NULL,
	"status" text DEFAULT 'stored' NOT NULL,
	"rejection_code" text,
	"template_id" uuid,
	"template_version" integer,
	"mapping" jsonb,
	"rows_sha256" text,
	"row_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uploaded_by" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"decision_reason" text,
	"delete_after" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "uploads_type_chk" CHECK ("uploads"."file_type" in ('provider_export','settlement_report','orders_invoices','bank_statement')),
	CONSTRAINT "uploads_format_chk" CHECK ("uploads"."file_format" in ('csv','tsv','xlsx','json','mt940','camt053')),
	CONSTRAINT "uploads_status_chk" CHECK ("uploads"."status" in ('stored','mapped','validated','confirmed','normalised','rejected','deleted')),
	CONSTRAINT "uploads_name_chk" CHECK (length("uploads"."original_name") between 1 and 120),
	CONSTRAINT "uploads_size_chk" CHECK ("uploads"."byte_size" > 0),
	CONSTRAINT "uploads_sha_chk" CHECK ("uploads"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "uploads_key_chk" CHECK ("uploads"."storage_key" is null or "uploads"."storage_key" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "uploads_confirmer_chk" CHECK ("uploads"."confirmed_by" is null or "uploads"."file_type" <> 'bank_statement' or "uploads"."confirmed_by" <> "uploads"."uploaded_by")
);
--> statement-breakpoint
ALTER TABLE "merchant_data_settings" ADD CONSTRAINT "merchant_data_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_data_settings" ADD CONSTRAINT "merchant_data_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_rows" ADD CONSTRAINT "upload_rows_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_rows" ADD CONSTRAINT "upload_rows_upload_fk" FOREIGN KEY ("org_id","upload_id") REFERENCES "public"."uploads"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."mapping_templates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_rows_hash_idx" ON "upload_rows" USING btree ("org_id","row_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_content_uq" ON "uploads" USING btree ("org_id","entity_id","file_type","content_sha256") WHERE "uploads"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "uploads_delete_after_idx" ON "uploads" USING btree ("delete_after") WHERE "uploads"."status" <> 'deleted';