/**
 * rc7 phase 3a: software operations. Reconciliation runs (append-only history), the PostgreSQL job queue, the daily
 * schedule per entity and rule-change notices. Security and constraints: drizzle/0024_reconciliation_runs.sql and 0025_jobs_schedules.sql.
 */
import { bigint, boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { organizations, users } from "./schema";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const org = () => uuid("org_id").notNull().references(() => organizations.id);

export const RUN_TRIGGERS = ["manual", "schedule", "rule_change"] as const;
export const JOB_KINDS = ["reconcile", "retention", "revaluation", "pickup"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
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
  /** v1 phase 3 (0079, was 0064): per-part input hashes, the uploads and mapping template versions the rows came from. */
  inputManifest: jsonb("input_manifest"), engineVersion: text("engine_version"),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

export const reconciliationSchedules = pgTable("reconciliation_schedules", {
  orgId: org(), entityId: text("entity_id").notNull(),
  localTime: text("local_time").notNull().default("02:00"), enabled: boolean("enabled").notNull().default(true),
  runAs: text("run_as").notNull().references(() => users.id), updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.entityId] })]);

export type JobStatus = "queued" | "running" | "done" | "dead" | "cancelled";
export const jobs = pgTable("jobs", {
  /** v1 phase 3 (0079, was 0064): a retention job belongs to an organisation only (no entity, no member). */
  id: uuid("id").primaryKey().defaultRandom(), orgId: org(), entityId: text("entity_id"),
  kind: text("kind").$type<JobKind>().notNull().default("reconcile"), trigger: text("trigger").$type<"schedule" | "rule_change" | "manual">().notNull(),
  dedupeKey: text("dedupe_key").notNull(), runAs: text("run_as").references(() => users.id),
  status: text("status").$type<JobStatus>().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(5),
  runAfter: ts("run_after").notNull(), lockedAt: ts("locked_at"), lockedBy: text("locked_by"),
  lastErrorCode: text("last_error_code"), runId: uuid("run_id"),
  createdAt: ts("created_at").notNull().defaultNow(), finishedAt: ts("finished_at"),
  /** v1 phase 3 (0079, was 0064): the stage it is at, the worker's last heartbeat, how often it was taken back from a vanished worker. */
  stage: text("stage"), heartbeatAt: ts("heartbeat_at"), recoveries: integer("recoveries").notNull().default(0),
  params: jsonb("params").notNull().default({}), result: jsonb("result"),
});

/** v1 phase 3 (0079, was 0064): what the worker did with a job, stage by stage (append-only; ids, stages, codes and counts). */
export const JOB_EVENTS = ["claimed", "stage", "heartbeat", "done", "cancelled", "retry", "dead", "recovered", "requeued"] as const;
export const jobEvents = pgTable("job_events", {
  orgId: org(), id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity(), jobId: uuid("job_id").notNull(),
  at: ts("at").notNull().defaultNow(), event: text("event").$type<(typeof JOB_EVENTS)[number]>().notNull(), stage: text("stage"),
  attempt: integer("attempt"), code: text("code"), counts: jsonb("counts"),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

export const ruleChangeNotices = pgTable("rule_change_notices", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(), entityId: text("entity_id").notNull(), orderId: text("order_id").notNull(),
  runId: uuid("run_id").notNull(), ruleSetVersion: text("rule_set_version").notNull(), policyRevision: integer("policy_revision").notNull(),
  storedDecision: text("stored_decision").notNull(), storedRuleId: text("stored_rule_id").notNull(),
  newDecision: text("new_decision").notNull(), newRuleId: text("new_rule_id").notNull(),
  fingerprint: text("fingerprint").notNull(), createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);

/** v1 phase 3 (0080, was 0065): a month of an entity, signed off by a preparer and locked by a different Admin. */
export const periodLocks = pgTable("period_locks", {
  orgId: org(), entityId: text("entity_id").notNull(), period: text("period").notNull(),
  status: text("status").$type<"requested" | "locked" | "rejected">().notNull().default("requested"),
  requestedBy: text("requested_by").notNull().references(() => users.id), requestedAt: ts("requested_at").notNull().defaultNow(), reason: text("reason").notNull(),
  decidedBy: text("decided_by").references(() => users.id), decidedAt: ts("decided_at"), decisionReason: text("decision_reason"),
}, (t) => [primaryKey({ columns: [t.orgId, t.entityId, t.period] })]);

/** v1 phase 3 (0080, was 0065): what a run would now decide for a locked month's payment, filed in the next open month. */
export const periodCorrections = pgTable("period_corrections", {
  orgId: org(), id: uuid("id").notNull().defaultRandom(), entityId: text("entity_id").notNull(), orderId: text("order_id").notNull(),
  correctsPeriod: text("corrects_period").notNull(), correctionPeriod: text("correction_period").notNull(), runId: uuid("run_id").notNull(),
  storedDecision: text("stored_decision"), storedRuleId: text("stored_rule_id"), newDecision: text("new_decision").notNull(), newRuleId: text("new_rule_id").notNull(),
  fingerprint: text("fingerprint").notNull(), createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.id] })]);
