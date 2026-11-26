/**
 * v1 phase 1.1 onboarding tables (drizzle/0048). No login but the schema owner holds a privilege on them: the
 * platform console and the setup wizard reach them only through the prov_* functions (drizzle/0049, the
 * `clearline_provisioning` role); the owner's admin CLI writes them directly (invite-admin, grant-platform-operator).
 */
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, roles, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const SETUP_STEPS = ["entities", "ledger", "bank_accounts", "tolerance", "provider", "mapping_templates", "members", "finish"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const platformOperators = pgTable("platform_operators", {
  userId: text("user_id").primaryKey().references(() => users.id),
  grantedAt: ts("granted_at").notNull().defaultNow(),
  revokedAt: ts("revoked_at"),
});

export const orgInvitations = pgTable("org_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  email: text("email").notNull(),
  role: text("role").notNull().references(() => roles.code),
  /** SHA-256 (hex) of the one-time token; the token itself is only in the invitation email. */
  tokenSha256: text("token_sha256").notNull().unique(),
  invitedBy: text("invited_by").references(() => users.id),
  invitedVia: text("invited_via").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  closedAt: ts("closed_at"),
  acceptedUserId: text("accepted_user_id").references(() => users.id),
});

export const orgSetupSteps = pgTable("org_setup_steps", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  step: text("step").notNull(),
  doneBy: text("done_by").notNull().references(() => users.id),
  doneAt: ts("done_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.step] })]);
