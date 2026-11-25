-- v1 phase 1.2 (security control, strengthens): multi-factor sign-in. Runs as the schema owner.
--
-- * users.two_factor_enabled + two_factors: Better Auth's two-factor plugin (TOTP). The TOTP secret and the recovery
--   codes are stored ENCRYPTED with the server secret (BETTER_AUTH_SECRET) by the plugin; never in plaintext.
-- * passkeys: WebAuthn credentials (public keys only; a private key never leaves the authenticator).
-- * sessions.mfa_verified_at: when THIS session proved a second factor (NULL = password only). The MFA gate
--   (src/server/mfa-gate.ts) refuses a session of an enrolled user that has not proved one.
-- * sessions.reauthenticated_at: the last step-up (fresh second factor, or the password for a user without MFA).
-- * org_security_settings: per-organisation "require MFA for every member" (Admins and Approvers always need it).
--
-- Identity tables have no row-level security (Better Auth reads them before any tenant context exists), exactly like
-- users / sessions / accounts / verifications (0001). org_security_settings is tenant data and has forced RLS.

ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reauthenticated_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone,
	CONSTRAINT "two_factors_user_uq" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"public_key_spki" text NOT NULL,
	"alg" integer NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"transports" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkeys_credential_uq" UNIQUE("credential_id"),
	CONSTRAINT "passkeys_alg_chk" CHECK ("passkeys"."alg" in (-7, -257)),
	CONSTRAINT "passkeys_name_chk" CHECK (length("passkeys"."name") between 1 and 60),
	CONSTRAINT "passkeys_cred_chk" CHECK (length("passkeys"."credential_id") between 16 and 1366 AND "passkeys"."credential_id" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "passkeys_count_chk" CHECK ("passkeys"."sign_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON two_factors, passkeys TO clearline_app;
--> statement-breakpoint
CREATE TABLE "org_security_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"require_mfa_all" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_security_settings" ADD CONSTRAINT "org_security_settings_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "org_security_settings" ADD CONSTRAINT "org_security_settings_user_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE org_security_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_security_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Every member reads their organisation's policy (the MFA gate needs it); only an Admin of THAT organisation, acting
-- in it, writes it, and only as themselves.
CREATE POLICY member_read ON org_security_settings FOR SELECT USING (app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY admin_insert ON org_security_settings FOR INSERT
  WITH CHECK (org_id = app_org_id() AND app_member_role(org_id) = 'admin' AND updated_by = app_user_id());
--> statement-breakpoint
CREATE POLICY admin_update ON org_security_settings FOR UPDATE
  USING (org_id = app_org_id() AND app_member_role(org_id) = 'admin')
  WITH CHECK (org_id = app_org_id() AND app_member_role(org_id) = 'admin' AND updated_by = app_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON org_security_settings TO clearline_app;
