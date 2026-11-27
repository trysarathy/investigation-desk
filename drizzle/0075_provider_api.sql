-- v1 phase 2.2: the provider API adapter. A merchant's connection to its own payment provider's REST API (read-only
-- pulls into the upload pipeline) and the webhook events that provider sends. No secret is stored: a connection names
-- the server secret holding the API key (and the webhook signing secret) by reference, in a reserved namespace.
-- A webhook delivery's body is never stored: only its event id, its SHA-256 and the signed time.

CREATE TABLE "provider_api_connections" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" text NOT NULL,
	"provider_org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"file_type" text NOT NULL,
	"template_name" text NOT NULL,
	"config" jsonb NOT NULL,
	"api_key_ref" text NOT NULL,
	"webhook_secret_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_by" text,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "provider_api_connections_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "provider_api_connections_id_uq" UNIQUE("id"),
	CONSTRAINT "provider_api_connections_type_chk" CHECK ("provider_api_connections"."file_type" in ('provider_export','settlement_report','settlement_payments')),
	CONSTRAINT "provider_api_connections_name_chk" CHECK (length("provider_api_connections"."name") between 1 and 120),
	CONSTRAINT "provider_api_connections_template_chk" CHECK (length("provider_api_connections"."template_name") between 1 and 120),
	CONSTRAINT "provider_api_connections_key_ref_chk" CHECK ("provider_api_connections"."api_key_ref" ~ '^CLEARLINE_PROVIDER_KEY_[A-Z0-9_]{1,48}$'),
	CONSTRAINT "provider_api_connections_hook_ref_chk" CHECK ("provider_api_connections"."webhook_secret_ref" is null or "provider_api_connections"."webhook_secret_ref" ~ '^CLEARLINE_PROVIDER_WEBHOOK_[A-Z0-9_]{1,48}$'),
	CONSTRAINT "provider_api_connections_config_chk" CHECK (jsonb_typeof("provider_api_connections"."config") = 'object' and length("provider_api_connections"."config"::text) <= 8000),
	CONSTRAINT "provider_api_connections_status_chk" CHECK ("provider_api_connections"."status" in ('active','disabled')),
	CONSTRAINT "provider_api_connections_disabled_chk" CHECK (("provider_api_connections"."status" = 'disabled') = ("provider_api_connections"."disabled_at" is not null and "provider_api_connections"."disabled_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "provider_pulls" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"template_id" uuid NOT NULL,
	"template_version" integer NOT NULL,
	"start_cursor" text,
	"next_cursor" text,
	"pages" integer DEFAULT 0 NOT NULL,
	"records" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"events_consumed" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	"error_code" text,
	"started_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "provider_pulls_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "provider_pulls_status_chk" CHECK ("provider_pulls"."status" in ('running','succeeded','unchanged','failed')),
	CONSTRAINT "provider_pulls_key_chk" CHECK ("provider_pulls"."idempotency_key" ~ '^[A-Za-z0-9._:-]{8,128}$'),
	CONSTRAINT "provider_pulls_cursor_chk" CHECK (coalesce(length("provider_pulls"."start_cursor"), 0) <= 500 and coalesce(length("provider_pulls"."next_cursor"), 0) <= 500),
	CONSTRAINT "provider_pulls_counts_chk" CHECK ("provider_pulls"."pages" >= 0 and "provider_pulls"."records" >= 0 and "provider_pulls"."requests" >= 0 and "provider_pulls"."retries" >= 0 and "provider_pulls"."events_consumed" >= 0),
	CONSTRAINT "provider_pulls_error_chk" CHECK ("provider_pulls"."error_code" is null or "provider_pulls"."error_code" ~ '^[a-z_]{1,60}$'),
	CONSTRAINT "provider_pulls_finished_chk" CHECK (("provider_pulls"."status" = 'running') = ("provider_pulls"."finished_at" is null)),
	CONSTRAINT "provider_pulls_failed_chk" CHECK (("provider_pulls"."status" = 'failed') = ("provider_pulls"."error_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"body_sha256" text NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pull_id" uuid,
	CONSTRAINT "provider_webhook_events_pk" PRIMARY KEY("org_id","connection_id","event_id"),
	CONSTRAINT "provider_webhook_events_id_chk" CHECK ("provider_webhook_events"."event_id" ~ '^[A-Za-z0-9._:-]{1,128}$'),
	CONSTRAINT "provider_webhook_events_sha_chk" CHECK ("provider_webhook_events"."body_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "provider_api_connections" ADD CONSTRAINT "provider_api_connections_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_api_connections" ADD CONSTRAINT "provider_api_connections_provider_fk" FOREIGN KEY ("provider_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_api_connections" ADD CONSTRAINT "provider_api_connections_entity_fk" FOREIGN KEY ("org_id","entity_id") REFERENCES "public"."merchant_entities"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_api_connections" ADD CONSTRAINT "provider_api_connections_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_api_connections" ADD CONSTRAINT "provider_api_connections_disabled_by_fk" FOREIGN KEY ("disabled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_api_connections_name_uq" ON "provider_api_connections" USING btree ("org_id","name");--> statement-breakpoint
ALTER TABLE "provider_pulls" ADD CONSTRAINT "provider_pulls_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."provider_api_connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_pulls" ADD CONSTRAINT "provider_pulls_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."mapping_templates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_pulls" ADD CONSTRAINT "provider_pulls_upload_fk" FOREIGN KEY ("org_id","upload_id") REFERENCES "public"."uploads"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_pulls" ADD CONSTRAINT "provider_pulls_started_by_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_pulls_key_uq" ON "provider_pulls" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_pulls_one_running_uq" ON "provider_pulls" USING btree ("org_id","connection_id") WHERE "provider_pulls"."status" = 'running';--> statement-breakpoint
CREATE INDEX "provider_pulls_connection_idx" ON "provider_pulls" USING btree ("org_id","connection_id","started_at");--> statement-breakpoint
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."provider_api_connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_pull_fk" FOREIGN KEY ("org_id","pull_id") REFERENCES "public"."provider_pulls"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_webhook_events_pending_idx" ON "provider_webhook_events" USING btree ("org_id","connection_id") WHERE "provider_webhook_events"."pull_id" IS NULL;
