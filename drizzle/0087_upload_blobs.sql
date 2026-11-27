-- v1 (hosting): uploaded files stored in PostgreSQL, for deployments whose functions share no disk (Vercel). Runs as
-- the schema owner. Additive only: one new table; no existing control is relaxed.
--
-- upload_blobs holds exactly what LocalDiskStorage writes to disk: the SEALED file (src/server/storage/local.ts,
-- sealUpload: "CLU1" | IV | AES-256-GCM ciphertext | tag with CLEARLINE_UPLOAD_KEY, bound to "<org id>/<storage key>"),
-- never the plain bytes in production. It is used only with CLEARLINE_UPLOAD_STORE=postgres
-- (src/server/storage/postgres.ts); the default store stays on local disk.
--  * size_bytes and sha256 describe the stored (sealed) body, so a damaged row is recognised before it is opened.
--  * A blob never changes: the app role may read, insert and delete it, never update it.
--  * Isolation as every organisation table: visible and writable only inside the transaction's organisation, and only
--    to an active member (merchant_isolation). The Auditor's RESTRICTIVE policies (0078/0085) hide it from an Auditor
--    and refuse an Auditor's writes, as for every table outside the evidence pack. There is no entity_id (a file is
--    reached through its uploads row, which carries the entity scope), so there is no entity_scope policy.
--  * Cross-organisation work (the orphan sweep, retention, merchant deletion and export) runs on the owner connection,
--    as it already does for the uploads table.

CREATE TABLE "upload_blobs" (
	"org_id" uuid NOT NULL REFERENCES "organizations"("id"),
	"storage_key" text NOT NULL,
	"body" bytea NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("org_id", "storage_key"),
	CONSTRAINT "upload_blobs_key_chk" CHECK ("storage_key" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "upload_blobs_size_chk" CHECK ("size_bytes" = octet_length("body")),
	CONSTRAINT "upload_blobs_sha256_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE upload_blobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE upload_blobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON upload_blobs FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY merchant_isolation ON upload_blobs TO clearline_app USING (org_id = app_org_id() AND app_is_member(org_id))
  WITH CHECK (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY auditor_read ON upload_blobs AS RESTRICTIVE FOR SELECT TO clearline_app USING ((SELECT app_auditor_period()) IS NULL OR false);
--> statement-breakpoint
CREATE POLICY auditor_no_insert ON upload_blobs AS RESTRICTIVE FOR INSERT TO clearline_app WITH CHECK (NOT (SELECT app_is_auditor()));
--> statement-breakpoint
CREATE POLICY auditor_no_update ON upload_blobs AS RESTRICTIVE FOR UPDATE TO clearline_app USING (NOT (SELECT app_is_auditor()));
--> statement-breakpoint
CREATE POLICY auditor_no_delete ON upload_blobs AS RESTRICTIVE FOR DELETE TO clearline_app USING (NOT (SELECT app_is_auditor()));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON upload_blobs TO clearline_app;
