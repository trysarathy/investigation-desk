CREATE TABLE "merchant_invitations" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"merchant_org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "merchant_invitations_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "merchant_invitations_role_chk" CHECK ("merchant_invitations"."role" in ('admin','payment_ops','finance','approver','viewer')),
	CONSTRAINT "merchant_invitations_status_chk" CHECK ("merchant_invitations"."status" in ('pending','accepted','revoked')),
	CONSTRAINT "merchant_invitations_email_chk" CHECK ("merchant_invitations"."email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length("merchant_invitations"."email") <= 254)
);
--> statement-breakpoint
CREATE TABLE "merchant_onboarding" (
	"org_id" uuid NOT NULL,
	"merchant_org_id" uuid NOT NULL,
	"column_mapping" jsonb,
	"policy_defaults" jsonb,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_onboarding_org_id_merchant_org_id_pk" PRIMARY KEY("org_id","merchant_org_id")
);
--> statement-breakpoint
ALTER TABLE "merchant_invitations" ADD CONSTRAINT "merchant_invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_invitations" ADD CONSTRAINT "merchant_invitations_merchant_org_id_organizations_id_fk" FOREIGN KEY ("merchant_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_invitations" ADD CONSTRAINT "merchant_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_onboarding" ADD CONSTRAINT "merchant_onboarding_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_onboarding" ADD CONSTRAINT "merchant_onboarding_merchant_org_id_organizations_id_fk" FOREIGN KEY ("merchant_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_onboarding" ADD CONSTRAINT "merchant_onboarding_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_invitations_pending_uq" ON "merchant_invitations" USING btree ("org_id","merchant_org_id","email") WHERE "merchant_invitations"."status" = 'pending';