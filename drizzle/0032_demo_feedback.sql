-- Demo build: presenter feedback notes ("Note feedback" on every screen of a demo build). Runs as the schema owner.
-- A note records the screen, its route, the member's role, the time and the note text. Written only by a signed-in
-- member of a DEMO organisation (data mode 'demo'), as themselves and with their current role, for the organisation
-- they act in; read by members of that organisation. Append-only for the runtime login (no update, no delete). The
-- table exists in every database (migrations are the same everywhere), but outside a demo organisation the insert
-- policy refuses every row, and outside a demo build the app has no route that writes it.
CREATE FUNCTION app_org_is_demo(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = org AND o.data_mode = 'demo')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_org_is_demo(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org_is_demo(uuid) TO clearline_app;
--> statement-breakpoint
CREATE TABLE "demo_feedback" (
	"org_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"screen" text NOT NULL,
	"route" text NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "demo_feedback_org_id_id_pk" PRIMARY KEY("org_id","id"),
	CONSTRAINT "demo_feedback_screen_chk" CHECK (length("demo_feedback"."screen") between 1 and 200),
	CONSTRAINT "demo_feedback_route_chk" CHECK ("demo_feedback"."route" like '/%' and length("demo_feedback"."route") <= 500),
	CONSTRAINT "demo_feedback_note_chk" CHECK (length(btrim("demo_feedback"."note")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "demo_feedback" ADD CONSTRAINT "demo_feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "demo_feedback" ADD CONSTRAINT "demo_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "demo_feedback_list_idx" ON "demo_feedback" USING btree ("org_id","created_at");
--> statement-breakpoint
ALTER TABLE demo_feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE demo_feedback FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY member_read ON demo_feedback FOR SELECT USING (org_id = app_org_id() AND app_is_member(org_id));
--> statement-breakpoint
CREATE POLICY demo_member_insert ON demo_feedback FOR INSERT WITH CHECK (org_id = app_org_id() AND app_is_member(org_id)
  AND user_id = app_user_id() AND role = app_member_role(org_id) AND app_org_is_demo(org_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON demo_feedback TO clearline_app;
