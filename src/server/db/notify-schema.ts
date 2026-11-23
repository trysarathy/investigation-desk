/**
 * rc7 phase 3b: in-app notifications. Raised only by database triggers on events that already happen (a run, a new
 * exception or assignment, an approval request, a validated bank statement, a rule-change notice); read by members
 * whose current role is the audience (or the one member named). Security: drizzle/0027_notifications.sql.
 */
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const NOTIFICATION_KINDS = ["run_finished", "run_failed", "exception_assigned", "approval_waiting", "bank_statement_waiting", "rule_change"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notifications = pgTable("notifications", {
  orgId: uuid("org_id").notNull().references(() => organizations.id), id: uuid("id").notNull().defaultRandom(),
  kind: text("kind").$type<NotificationKind>().notNull(), audienceRole: text("audience_role").notNull(), audienceUserId: text("audience_user_id").references(() => users.id),
  entityId: text("entity_id"), subjectType: text("subject_type").notNull(), subjectId: text("subject_id").notNull(), title: text("title").notNull(),
  dedupeKey: text("dedupe_key").notNull(), createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

export const notificationReads = pgTable("notification_reads", {
  orgId: uuid("org_id").notNull(), notificationId: uuid("notification_id").notNull(), userId: text("user_id").notNull().references(() => users.id),
  readAt: ts("read_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.notificationId, t.userId], name: "notification_reads_pk" })]);

export const ruleChangeAcks = pgTable("rule_change_acks", {
  orgId: uuid("org_id").notNull(), noticeId: uuid("notice_id").notNull(), ackedBy: text("acked_by").notNull().references(() => users.id),
  note: text("note"), ackedAt: ts("acked_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.noticeId], name: "rule_change_acks_pk" })]);
