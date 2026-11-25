-- v1 phase 1.2 (security control, strengthens): e-mail verification tokens, the local e-mail outbox and the
-- database-backed rate limits. Runs as the schema owner.
--
-- * auth_tokens: single-use, short-lived tokens for e-mail verification. Only the SHA-256 of the token is stored;
--   a token is spent by one UPDATE ... WHERE used_at IS NULL AND expires_at > now() (src/server/email-verification.ts).
--   (Password-reset tokens are Better Auth's, in `verifications`, stored hashed: verification.storeIdentifier.)
-- * email_outbox: the LOCAL stand-in e-mail sender (src/server/email/outbox.ts). The web app may only INSERT into it;
--   it can never read a message back (a message carries a one-time link). Tests and an operator read it as the owner.
-- * auth_rate_events: attempts per scope and keyed hash (account e-mail or client address, HMAC-keyed with the
--   server secret so the table holds no addresses), shared by every instance.

CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"token_sha256" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_hash_uq" UNIQUE("token_sha256"),
	CONSTRAINT "auth_tokens_purpose_chk" CHECK ("auth_tokens"."purpose" in ('verify_email')),
	CONSTRAINT "auth_tokens_hash_chk" CHECK ("auth_tokens"."token_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_tokens_ttl_chk" CHECK ("auth_tokens"."expires_at" > "auth_tokens"."created_at" AND "auth_tokens"."expires_at" <= "auth_tokens"."created_at" + interval '24 hours')
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id", "purpose");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_tokens TO clearline_app;
--> statement-breakpoint

CREATE TABLE "email_outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"text_body" text NOT NULL,
	"html_body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_size_chk" CHECK (length("email_outbox"."subject") <= 300 AND length("email_outbox"."text_body") <= 20000 AND coalesce(length("email_outbox"."html_body"), 0) <= 50000)
);
--> statement-breakpoint
GRANT INSERT ON email_outbox TO clearline_app;
--> statement-breakpoint

CREATE TABLE "auth_rate_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"scope" text NOT NULL,
	"key_hash" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_events_scope_chk" CHECK ("auth_rate_events"."scope" ~ '^[a-z_]{1,40}$'),
	CONSTRAINT "auth_rate_events_key_chk" CHECK ("auth_rate_events"."key_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE INDEX "auth_rate_events_key_at_idx" ON "auth_rate_events" USING btree ("scope", "key_hash", "at");
--> statement-breakpoint
CREATE INDEX "auth_rate_events_at_idx" ON "auth_rate_events" USING btree ("at");
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON auth_rate_events TO clearline_app;
