/**
 * v1 phase 5.4: the one structured logger. One JSON line per event on stdout (info) or stderr (warn, error), every field
 * passed through the PII scrubber (./scrub.ts) first. Events are short snake_case names; fields should be ids, codes and
 * counts (the scrubber is the safety net, not the plan).
 *
 *   import { log } from "@/server/ops/log";
 *   log.info("job_done", { jobId, counts });
 *   log.error("upload_failed", err, { orgId });   // also reported to the error tracker (./errors.ts)
 *
 * Not `server-only`: the job worker and the admin CLI use it too. It never reads request bodies itself.
 */
import { scrubError, scrubValue } from "./scrub";
import { errorTracker } from "./errors";

export type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const EVENT = /^[a-z][a-z0-9_.:-]{0,79}$/;

export interface LogLine { ts: string; level: Level; event: string; [field: string]: unknown }
export type LogWriter = (line: LogLine) => void;

const defaultWriter: LogWriter = (line) => {
  const s = JSON.stringify(line);
  // The one place that writes log lines to the console (scripts/ops/check-log-safety.mjs allows it).
  if (line.level === "warn" || line.level === "error") process.stderr.write(`${s}\n`);
  else process.stdout.write(`${s}\n`);
};

let writer: LogWriter = defaultWriter;
/** Tests: capture lines (pass undefined to restore stdout/stderr). */
export function setLogWriterForTests(w: LogWriter | undefined) { writer = w ?? defaultWriter; }

function minLevel(): Level {
  const v = process.env.CLEARLINE_LOG_LEVEL;
  return v === "debug" || v === "info" || v === "warn" || v === "error" ? v : "info";
}

/** Builds the scrubbed line (exported for tests). Unknown or unsafe event names become "invalid_event". */
export function buildLine(level: Level, event: string, fields: Record<string, unknown> = {}, now = new Date()): LogLine {
  const scrubbed = scrubValue(fields) as Record<string, unknown>;
  delete scrubbed.ts; delete scrubbed.level; delete scrubbed.event;
  return { ts: now.toISOString(), level, event: EVENT.test(event) ? event : "invalid_event", ...scrubbed };
}

function emit(level: Level, event: string, fields?: Record<string, unknown>) {
  if (RANK[level] < RANK[minLevel()]) return;
  try { writer(buildLine(level, event, fields)); } catch { /* logging never breaks the request */ }
}

export const log = {
  debug: (event: string, fields?: Record<string, unknown>) => emit("debug", event, fields),
  info: (event: string, fields?: Record<string, unknown>) => emit("info", event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => emit("warn", event, fields),
  /**
   * Logs the error's type and code (never its message: a database or parser message can quote the data it choked on)
   * and reports it, with the scrubbed message and a frames-only stack, to the configured error tracker.
   */
  error: (event: string, err?: unknown, fields: Record<string, unknown> = {}) => {
    const e = err instanceof Error ? (({ type, code }) => ({ type, ...(code ? { code } : {}) }))(scrubError(err)) : err === undefined ? undefined : { type: typeof err };
    emit("error", event, { ...fields, ...(e ? { error: e } : {}) });
    if (err === undefined) return;
    try { void errorTracker().captureException(err, { event, extra: fields }).catch(() => undefined); } catch { /* misconfigured tracker: the line above still records it */ }
  },
};
