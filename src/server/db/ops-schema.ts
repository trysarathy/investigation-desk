/**
 * rc7 phase 3a: software operations. Reconciliation runs (append-only history), the PostgreSQL job queue, the daily
 * schedule per entity and rule-change notices. Security and constraints: drizzle/0024_reconciliation_runs.sql and 0025_jobs_schedules.sql.
 */
import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const org = () => uuid("org_id").notNull().references(() => organizations.id);

export const RUN_TRIGGERS = ["manual", "schedule", "rule_change"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** One reconciliation run of one entity: what decided it (rule set + policy revision), on which input, and counts. */
export const reconciliationRuns = pgTable("reconciliation_runs", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(), entityId: text("entity_id").notNull(),
  trigger: text("trigger").$type<RunTrigger>().notNull(), jobId: uuid("job_id"), startedBy: text("started_by").notNull().references(() => users.id),
  ruleSetVersion: text("rule_set_version").notNull(), policyRevision: integer("policy_revision").notNull(),
  inputSha256: text("input_sha256"), status: text("status").$type<"changed" | "no_change" | "failed">().notNull(),
  startedAt: ts("started_at").notNull(), finishedAt: ts("finished_at").notNull(),
  matched: integer("matched").notNull().default(0), withDifference: integer("with_difference").notNull().default(0),
  review: integer("review").notNull().default(0), exceptions: integer("exceptions").notNull().default(0), unpaid: integer("unpaid").notNull().default(0),
  /** Payments a person had closed, left as they were. */
  kept: integer("kept").notNull().default(0),
  /** "Rule change would differ" notices this run recorded. */
  notices: integer("notices").notNull().default(0),
  errorCode: text("error_code"),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

export const reconciliationSchedules = pgTable("reconciliation_schedules", {
  orgId: org(), entityId: text("entity_id").notNull(),
  localTime: text("local_time").notNull().default("02:00"), enabled: boolean("enabled").notNull().default(true),
  runAs: text("run_as").notNull().references(() => users.id), updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.entityId] })]);

export type JobStatus = "queued" | "running" | "done" | "dead" | "cancelled";
export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(), orgId: org(), entityId: text("entity_id").notNull(),
  kind: text("kind").notNull().default("reconcile"), trigger: text("trigger").$type<"schedule" | "rule_change">().notNull(),
  dedupeKey: text("dedupe_key").notNull(), runAs: text("run_as").notNull().references(() => users.id),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: ts("run_after").notNull(), lockedAt: ts("locked_at"), lockedBy: text("locked_by"),
  lastErrorCode: text("last_error_code"), runId: uuid("run_id"),
  createdAt: ts("created_at").notNull().defaultNow(), finishedAt: ts("finished_at"),
});

export const ruleChangeNotices = pgTable("rule_change_notices", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(), entityId: text("entity_id").notNull(), orderId: text("order_id").notNull(),
  runId: uuid("run_id").notNull(), ruleSetVersion: text("rule_set_version").notNull(), policyRevision: integer("policy_revision").notNull(),
  storedDecision: text("stored_decision").notNull(), storedRuleId: text("stored_rule_id").notNull(),
  newDecision: text("new_decision").notNull(), newRuleId: text("new_rule_id").notNull(),
  fingerprint: text("fingerprint").notNull(), createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);
