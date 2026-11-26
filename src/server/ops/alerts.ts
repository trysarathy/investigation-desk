/**
 * v1 phase 5.5: alert rules. A small, pure rules engine over one metrics snapshot, and a dispatcher that sends only
 * changes (a new alert, a repeat after `renotifyMinutes`, a resolution) to an AlertSink (./alert-sinks.ts).
 *
 * The snapshot is counts only (drizzle/0081 ops_alert_metrics, read by the job worker's limited login, plus the backup
 * status file the backup job writes). An alert's summary is built from those counts: it never names an organisation, a
 * person, an address or an amount.
 *
 * Rules (thresholds in DEFAULT_THRESHOLDS; each can be overridden by CLEARLINE_ALERT_<NAME> env vars, see
 * thresholdsFromEnv):
 *   failed_runs            any reconciliation run failed, or any job went dead, in the window            (high)
 *   failed_login_spike     failed password sign-ins + failed second factors in the window >= threshold    (medium)
 *   job_backlog            due jobs waiting >= threshold, or the oldest due job is older than threshold   (medium)
 *   worker_down            no worker heartbeat, or none newer than the stale limit                        (high)
 *   chain_provider_outage  per network: >= minReads chain reads and >= share of them unavailable          (high)
 *   backup_failure         the last backup failed, none succeeded within maxAgeHours, or no status at all (high)
 */

export interface ChainCounts { total: number; unavailable: number }
export interface BackupStatus { lastRunAt: string | null; lastStatus: "ok" | "failed" | "unknown"; lastSuccessAt: string | null }
export interface AlertMetrics {
  at: Date;
  windowMinutes: number;
  failedRuns: number;
  deadJobs: number;
  loginFailures: number;
  mfaFailures: number;
  queuedDue: number;
  oldestDueSeconds: number;
  workerLastSeen: Date | null;
  chain: Record<string, ChainCounts>;
  /** null: backups are not monitored by this process (CLEARLINE_BACKUP_STATUS_FILE unset). */
  backup: BackupStatus | null;
}

export interface Thresholds {
  failedLogins: number;
  backlogJobs: number;
  backlogOldestSeconds: number;
  workerStaleSeconds: number;
  chainMinReads: number;
  chainUnavailableShare: number;
  backupMaxAgeHours: number;
}
export const DEFAULT_THRESHOLDS: Thresholds = {
  failedLogins: 30, backlogJobs: 50, backlogOldestSeconds: 30 * 60, workerStaleSeconds: 300,
  chainMinReads: 5, chainUnavailableShare: 0.5, backupMaxAgeHours: 26,
};

export type Severity = "high" | "medium";
export type RuleId = "failed_runs" | "failed_login_spike" | "job_backlog" | "worker_down" | "chain_provider_outage" | "backup_failure";
export interface Alert {
  rule: RuleId;
  /** Stable identity for de-duplication: the rule, plus the network for a chain outage. */
  key: string;
  severity: Severity;
  /** One line built from counts only. */
  summary: string;
  /** The runbook to open (docs/runbooks/). */
  runbook: string;
}

const RUNBOOK: Record<RuleId, string> = {
  failed_runs: "docs/runbooks/INCIDENT_RESPONSE.md",
  failed_login_spike: "docs/runbooks/KEY_COMPROMISE.md",
  job_backlog: "docs/runbooks/INCIDENT_RESPONSE.md",
  worker_down: "docs/runbooks/INCIDENT_RESPONSE.md",
  chain_provider_outage: "docs/runbooks/CHAIN_PROVIDER_OUTAGE.md",
  backup_failure: "docs/runbooks/RESTORE.md",
};
const NETWORK = /^[a-z0-9_]{1,32}$/;
const n = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);

/** Evaluate every rule. Pure and deterministic: the same snapshot always gives the same alerts, in rule order. */
export function evaluate(m: AlertMetrics, t: Thresholds = DEFAULT_THRESHOLDS): Alert[] {
  const out: Alert[] = [];
  const add = (rule: RuleId, severity: Severity, summary: string, key: string = rule) => out.push({ rule, key, severity, summary, runbook: RUNBOOK[rule] });
  const w = `in the last ${n(m.windowMinutes)} min`;

  if (n(m.failedRuns) + n(m.deadJobs) > 0) add("failed_runs", "high", `${n(m.failedRuns)} failed reconciliation run(s) and ${n(m.deadJobs)} dead job(s) ${w}`);

  const logins = n(m.loginFailures) + n(m.mfaFailures);
  if (logins >= t.failedLogins) add("failed_login_spike", "medium", `${n(m.loginFailures)} failed password sign-in(s) and ${n(m.mfaFailures)} failed second factor(s) ${w} (threshold ${t.failedLogins})`);

  if (n(m.queuedDue) >= t.backlogJobs || n(m.oldestDueSeconds) >= t.backlogOldestSeconds) {
    add("job_backlog", "medium", `${n(m.queuedDue)} due job(s) waiting; the oldest for ${Math.floor(n(m.oldestDueSeconds) / 60)} min`);
  }

  const age = m.workerLastSeen ? Math.floor((m.at.getTime() - m.workerLastSeen.getTime()) / 1000) : null;
  if (age === null) add("worker_down", "high", "no job worker has ever reported a pass");
  else if (age > t.workerStaleSeconds) add("worker_down", "high", `no job worker pass for ${Math.floor(age / 60)} min (limit ${Math.floor(t.workerStaleSeconds / 60)} min)`);

  for (const network of Object.keys(m.chain).sort()) {
    if (!NETWORK.test(network)) continue;
    const c = m.chain[network];
    const total = n(c.total), down = n(c.unavailable);
    if (total >= t.chainMinReads && down / total >= t.chainUnavailableShare) {
      add("chain_provider_outage", "high", `${network}: ${down} of ${total} chain reads unavailable ${w}`, `chain_provider_outage:${network}`);
    }
  }

  if (m.backup) {
    const b = m.backup;
    const lastOk = b.lastSuccessAt ? Date.parse(b.lastSuccessAt) : NaN;
    const okAgeH = Number.isNaN(lastOk) ? null : (m.at.getTime() - lastOk) / 3_600_000;
    if (b.lastStatus === "failed") add("backup_failure", "high", "the last backup run failed");
    else if (okAgeH === null) add("backup_failure", "high", "no successful backup is recorded");
    else if (okAgeH > t.backupMaxAgeHours) add("backup_failure", "high", `no successful backup for ${Math.floor(okAgeH)} h (limit ${t.backupMaxAgeHours} h)`);
  }
  return out;
}

/** Threshold overrides from CLEARLINE_ALERT_* (an invalid value keeps the default). */
export function thresholdsFromEnv(env: Record<string, string | undefined> = process.env): Thresholds {
  const num = (k: string, d: number, min: number, max: number) => {
    const v = Number(env[k]);
    return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= min && v <= max ? v : d;
  };
  const d = DEFAULT_THRESHOLDS;
  return {
    failedLogins: num("CLEARLINE_ALERT_FAILED_LOGINS", d.failedLogins, 1, 100_000),
    backlogJobs: num("CLEARLINE_ALERT_BACKLOG_JOBS", d.backlogJobs, 1, 1_000_000),
    backlogOldestSeconds: num("CLEARLINE_ALERT_BACKLOG_OLDEST_SECONDS", d.backlogOldestSeconds, 60, 7 * 86_400),
    workerStaleSeconds: num("CLEARLINE_WORKER_STALE_SECONDS", d.workerStaleSeconds, 30, 86_400),
    chainMinReads: num("CLEARLINE_ALERT_CHAIN_MIN_READS", d.chainMinReads, 1, 1_000_000),
    chainUnavailableShare: num("CLEARLINE_ALERT_CHAIN_UNAVAILABLE_SHARE", d.chainUnavailableShare, 0.01, 1),
    backupMaxAgeHours: num("CLEARLINE_ALERT_BACKUP_MAX_AGE_HOURS", d.backupMaxAgeHours, 1, 24 * 14),
  };
}

// ---- dispatch -------------------------------------------------------------------------------------------------------

export interface AlertNotification {
  state: "firing" | "resolved";
  rule: RuleId;
  key: string;
  severity: Severity;
  summary: string;
  runbook: string;
  at: string;
  /** When this alert first fired (the same for its repeats and its resolution). */
  since: string;
  environment: string;
}

export interface AlertSink {
  send(n: AlertNotification): Promise<void>;
}

/** What has been notified: key -> first fired, last notified, and the alert itself (for its resolution). */
export type AlertState = Record<string, { since: string; lastSent: string; alert: Alert }>;

export interface AlertStateStore {
  load(): Promise<AlertState>;
  save(s: AlertState): Promise<void>;
}

export class MemoryAlertStateStore implements AlertStateStore {
  private s: AlertState = {};
  async load() { return structuredClone(this.s); }
  async save(s: AlertState) { this.s = structuredClone(s); }
}

export interface DispatchResult { firing: number; sent: number; resolved: number; failed: number }

/**
 * Send what changed: each alert not yet notified (or last notified more than `renotifyMinutes` ago) as "firing", and
 * each previously notified key that no longer fires as "resolved". A send that throws is counted and retried on the
 * next evaluation (its state is not advanced). Returns counts.
 */
export async function dispatch(alerts: Alert[], store: AlertStateStore, sink: AlertSink, opts: { now: Date; renotifyMinutes?: number; environment?: string }): Promise<DispatchResult> {
  const state = await store.load();
  const now = opts.now.toISOString();
  const renotifyMs = (opts.renotifyMinutes ?? 240) * 60_000;
  const environment = opts.environment ?? "local";
  const out: DispatchResult = { firing: alerts.length, sent: 0, resolved: 0, failed: 0 };
  const firingKeys = new Set(alerts.map((a) => a.key));
  for (const a of alerts) {
    const prev = state[a.key];
    if (prev && opts.now.getTime() - Date.parse(prev.lastSent) < renotifyMs) { prev.alert = a; continue; }
    const since = prev?.since ?? now;
    try {
      await sink.send({ state: "firing", rule: a.rule, key: a.key, severity: a.severity, summary: a.summary, runbook: a.runbook, at: now, since, environment });
      state[a.key] = { since, lastSent: now, alert: a };
      out.sent++;
    } catch { out.failed++; }
  }
  for (const key of Object.keys(state)) {
    if (firingKeys.has(key)) continue;
    const { alert, since } = state[key];
    try {
      await sink.send({ state: "resolved", rule: alert.rule, key, severity: alert.severity, summary: alert.summary, runbook: alert.runbook, at: now, since, environment });
      delete state[key];
      out.resolved++;
    } catch { out.failed++; }
  }
  await store.save(state);
  return out;
}
