-- v1 phase 0 (carried over from rc6): entities and matching policies are created only by the provisioning path.
-- rc6 (0007) granted the app role INSERT and UPDATE on merchant_entities and merchant_policy with every other merchant
-- table. Nothing in the web app or the job worker creates an entity or a policy, or changes an entity: `add-entity`
-- in the admin CLI (scripts/control/admin.ts → src/server/merchant-setup.ts) and the fictional seeds run as the schema
-- OWNER. With the broad grant, any member of a merchant could create an entity (and an Admin a revision-1 policy) in
-- its own organisation directly through the runtime login, bypassing the CLI's validation and audit.
-- After this migration the runtime login can read both tables, and can UPDATE merchant_policy only (the Settings page
-- edit, still Admin-only and one revision at a time by the check_policy_change trigger from 0009). It cannot insert
-- an entity or a policy, or change an entity, at all. APPROVAL-ONLY: this changes a security control (it tightens it).
REVOKE INSERT, UPDATE ON merchant_entities FROM clearline_app;
--> statement-breakpoint
REVOKE INSERT ON merchant_policy FROM clearline_app;
