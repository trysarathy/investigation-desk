/**
 * v1 Phase 5.3: per-organisation field-encryption keys, stored WRAPPED by the KMS master key (never in the clear).
 * Security, RLS and the change rules: drizzle/0083_org_data_keys.sql (was 0071). See src/server/crypto/org-keys.ts.
 */
import { sql } from "drizzle-orm";
import { check, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./schema";

export const orgDataKeys = pgTable("org_data_keys", {
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  purpose: text("purpose").notNull(),
  version: integer("version").notNull(),
  kekId: text("kek_id").notNull(),
  wrappedKey: text("wrapped_key").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  retiredAt: timestamp("retired_at", { withTimezone: true, mode: "date" }),
  rewrappedAt: timestamp("rewrapped_at", { withTimezone: true, mode: "date" }),
}, (t) => [
  primaryKey({ columns: [t.orgId, t.purpose, t.version] }),
  uniqueIndex("org_data_keys_one_active_uq").on(t.orgId, t.purpose).where(sql`${t.status} = 'active'`),
  check("org_data_keys_purpose_chk", sql`${t.purpose} in ('data','index') and (${t.purpose} = 'data' or ${t.version} = 1)`),
  check("org_data_keys_status_chk", sql`${t.status} in ('active','retired') and (${t.status} = 'retired') = (${t.retiredAt} is not null)`),
  check("org_data_keys_version_chk", sql`${t.version} > 0`),
]);
