/**
 * v1 phase 4: posting-rules signatures (drizzle/0066_posting_rules_signatures.sql). Append-only; a revocation is the
 * only change, once. The signed catalogue is stored with the row (locked).
 */
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const postingRulesSignatures = pgTable("posting_rules_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  version: text("version").notNull(),
  versionSha256: text("version_sha256").notNull(),
  catalogue: jsonb("catalogue").notNull(),
  signedByUserId: text("signed_by_user_id").notNull().references(() => users.id),
  signedByName: text("signed_by_name").notNull(),
  signedAt: ts("signed_at").notNull().defaultNow(),
  mfaVerifiedAt: ts("mfa_verified_at").notNull(),
  revokedAt: ts("revoked_at"),
  revokedByUserId: text("revoked_by_user_id").references(() => users.id),
  revokedReason: text("revoked_reason"),
});
