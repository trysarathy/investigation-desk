/**
 * v1 phase 5.6 (privacy): the receipt of a merchant deletion, the minimal records it keeps for the retention period
 * (audit events and approvals, [ASSUMPTION] 7 years) and the record of every retention run. Owner-only: no role holds
 * a privilege on them. Security and constraints: drizzle/0073_privacy_retention.sql.
 */
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const merchantDeletions = pgTable("merchant_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** sha256('clearline-org|' + org id): never the id itself. */
  orgRef: text("org_ref").notNull(),
  deletedAt: ts("deleted_at").notNull().defaultNow(),
  counts: jsonb("counts").$type<Record<string, number>>().notNull(),
  retained: integer("retained").notNull(),
});

export type RetainedKind = "audit_event" | "approval_request" | "approval_decision";
export const retainedRecords = pgTable("retained_records", {
  deletionId: uuid("deletion_id").notNull().references(() => merchantDeletions.id),
  kind: text("kind").$type<RetainedKind>().notNull(),
  position: integer("position").notNull(),
  occurredAt: ts("occurred_at").notNull(),
  retainUntil: ts("retain_until").notNull(),
  record: jsonb("record").$type<Record<string, unknown>>().notNull(),
}, (t) => [primaryKey({ columns: [t.deletionId, t.kind, t.position] })]);

export const retentionRuns = pgTable("retention_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at").notNull(),
  asOf: ts("as_of").notNull(),
  dryRun: boolean("dry_run").notNull(),
  status: text("status").$type<"done" | "failed">().notNull(),
  counts: jsonb("counts").$type<Record<string, number>>().notNull(),
  errorCode: text("error_code"),
});
