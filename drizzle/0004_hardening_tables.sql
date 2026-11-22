CREATE TABLE "login_failures" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_failures_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email_sha256" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statement_imports" ADD COLUMN "lines_sha256" text;--> statement-breakpoint
CREATE INDEX "login_failures_email_at_idx" ON "login_failures" USING btree ("email_sha256","at");