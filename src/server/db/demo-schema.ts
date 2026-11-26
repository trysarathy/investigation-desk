/**
 * Demo build: presenter feedback notes (drizzle/0032_demo_feedback.sql). Written only for a demo organisation (the
 * insert policy checks its data mode), as the signed-in member with their current role. Demo · fictional data.
 */
import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const demoFeedback = pgTable("demo_feedback", {
  orgId: uuid("org_id").notNull().references(() => organizations.id), id: uuid("id").notNull().defaultRandom(),
  userId: text("user_id").notNull().references(() => users.id), role: text("role").notNull(),
  screen: text("screen").notNull(), route: text("route").notNull(), note: text("note").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] }), index("demo_feedback_list_idx").on(t.orgId, t.createdAt)]);
