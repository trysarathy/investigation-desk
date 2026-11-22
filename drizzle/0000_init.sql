CREATE TABLE "accounting_exports" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_exports_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "accounting_proposals" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"status" text NOT NULL,
	"rule" text NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounting_proposals_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_decisions" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"decided_by" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_decisions_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "approval_decisions_decision_chk" CHECK ("approval_decisions"."decision" in ('approve','reject'))
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_sha256" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "approval_requests_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "approval_requests_kind_chk" CHECK ("approval_requests"."subject_kind" in ('investigation_resolution')),
	CONSTRAINT "approval_requests_status_chk" CHECK ("approval_requests"."status" in ('pending','approved','rejected','superseded')),
	CONSTRAINT "approval_requests_sha_chk" CHECK ("approval_requests"."payload_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"org_id" uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"engine_id" text,
	"source" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"summary" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"details" jsonb,
	CONSTRAINT "audit_events_org_id_seq_pk" PRIMARY KEY("org_id","seq"),
	CONSTRAINT "audit_events_source_chk" CHECK ("audit_events"."source" in ('engine','server','auth'))
);
--> statement-breakpoint
CREATE TABLE "engine_records" (
	"org_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_records_org_id_collection_id_pk" PRIMARY KEY("org_id","collection","id"),
	CONSTRAINT "engine_records_collection_chk" CHECK ("engine_records"."collection" in ('routes','quotes','instructions','holds','liquidity','fundingDecisions'))
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"intent_id" text,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"owner_id" text,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exceptions_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "funding_obligations" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"kind" text NOT NULL,
	"intent_id" text,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funding_obligations_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "funding_obligations_kind_chk" CHECK ("funding_obligations"."kind" in ('advance','obligation'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"status_code" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_org_id_key_pk" PRIMARY KEY("org_id","key"),
	CONSTRAINT "idempotency_key_chk" CHECK ("idempotency_records"."key" ~ '^[A-Za-z0-9._:-]{8,128}$')
);
--> statement-breakpoint
CREATE TABLE "investigation_notes" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigation_notes_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "investigation_notes_target_chk" CHECK ("investigation_notes"."target_kind" in ('case','exception')),
	CONSTRAINT "investigation_notes_body_chk" CHECK (length("investigation_notes"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"intent_id" text,
	"status" text NOT NULL,
	"owner_id" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"next_action" text,
	"due_date" text,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigations_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "investigations_priority_chk" CHECK ("investigations"."priority" in ('low','normal','high','urgent')),
	CONSTRAINT "investigations_due_chk" CHECK ("investigations"."due_date" is null or "investigations"."due_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "org_engine_state" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"state" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"fictional" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_slug_chk" CHECK ("organizations"."slug" ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"internal_reference" text NOT NULL,
	"beneficiary_name" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"execution" text NOT NULL,
	"settlement" text NOT NULL,
	"reconciliation" text NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intents_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "payment_intents_amount_chk" CHECK ("payment_intents"."amount_minor" >= 0),
	CONSTRAINT "payment_intents_currency_chk" CHECK ("payment_intents"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
CREATE TABLE "provider_events" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"intent_id" text,
	"event_type" text NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_events_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_records" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"intent_id" text,
	"line_id" text NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_records_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "repayment_allocations" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repayment_allocations_org_id_id_pk" PRIMARY KEY("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settlement_evidence" (
	"org_id" uuid NOT NULL,
	"id" text NOT NULL,
	"ord" integer NOT NULL,
	"kind" text NOT NULL,
	"intent_id" text,
	"amount_minor" bigint,
	"currency" text,
	"provenance" text NOT NULL,
	"import_id" uuid,
	"record" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_evidence_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "settlement_evidence_kind_chk" CHECK ("settlement_evidence"."kind" in ('statement_line','chain_observation','evidence_record')),
	CONSTRAINT "settlement_evidence_provenance_chk" CHECK ("settlement_evidence"."provenance" in ('engine_action','seed_fictional','csv_import')),
	CONSTRAINT "settlement_evidence_amount_chk" CHECK ("settlement_evidence"."amount_minor" is null or "settlement_evidence"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "statement_imports" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"file_sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"row_count" integer NOT NULL,
	"accepted_count" integer NOT NULL,
	"rejected_count" integer NOT NULL,
	"status" text NOT NULL,
	"errors" jsonb NOT NULL,
	"imported_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_imports_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "statement_imports_status_chk" CHECK ("statement_imports"."status" in ('imported','rejected')),
	CONSTRAINT "statement_imports_size_chk" CHECK ("statement_imports"."size_bytes" between 1 and 1048576)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounting_exports" ADD CONSTRAINT "accounting_exports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_proposals" ADD CONSTRAINT "accounting_proposals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_request_fk" FOREIGN KEY ("org_id","request_id") REFERENCES "public"."approval_requests"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_records" ADD CONSTRAINT "engine_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exceptions" ADD CONSTRAINT "exceptions_intent_fk" FOREIGN KEY ("org_id","intent_id") REFERENCES "public"."payment_intents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_obligations" ADD CONSTRAINT "funding_obligations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_obligations" ADD CONSTRAINT "funding_obligations_intent_fk" FOREIGN KEY ("org_id","intent_id") REFERENCES "public"."payment_intents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_notes" ADD CONSTRAINT "investigation_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_intent_fk" FOREIGN KEY ("org_id","intent_id") REFERENCES "public"."payment_intents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_engine_state" ADD CONSTRAINT "org_engine_state_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_role_roles_code_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_intent_fk" FOREIGN KEY ("org_id","intent_id") REFERENCES "public"."payment_intents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_intent_fk" FOREIGN KEY ("org_id","intent_id") REFERENCES "public"."payment_intents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repayment_allocations" ADD CONSTRAINT "repayment_allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_evidence" ADD CONSTRAINT "settlement_evidence_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_evidence" ADD CONSTRAINT "settlement_evidence_intent_fk" FOREIGN KEY ("org_id","intent_id") REFERENCES "public"."payment_intents"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_imports" ADD CONSTRAINT "statement_imports_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_decisions_one_per_request_uq" ON "approval_decisions" USING btree ("org_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_version_uq" ON "approval_requests" USING btree ("org_id","subject_kind","subject_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending_uq" ON "approval_requests" USING btree ("org_id","subject_kind","subject_id") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_engine_uq" ON "audit_events" USING btree ("org_id","engine_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("org_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "exceptions_intent_idx" ON "exceptions" USING btree ("org_id","intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "organization_memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "organization_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_intents_ref_idx" ON "payment_intents" USING btree ("org_id","internal_reference");--> statement-breakpoint
CREATE INDEX "provider_events_intent_idx" ON "provider_events" USING btree ("org_id","intent_id");--> statement-breakpoint
CREATE INDEX "reconciliation_records_intent_idx" ON "reconciliation_records" USING btree ("org_id","intent_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "settlement_evidence_kind_idx" ON "settlement_evidence" USING btree ("org_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_imports_file_uq" ON "statement_imports" USING btree ("org_id","file_sha256");