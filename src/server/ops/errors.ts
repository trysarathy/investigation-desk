/**
 * v1 phase 5.4: error tracking behind a small interface. Each report is a Sentry-compatible event (the fields of
 * Sentry's event payload: event_id, timestamp, level, platform, environment, release, tags, extra, exception.values
 * with type, value and a frames-only stacktrace), already scrubbed (./scrub.ts): no request body, no message text that
 * names a person, an address or a secret, no source code.
 *
 * No paid service is wired in. The implementations are:
 *   CLEARLINE_ERROR_TRACKER=file  + CLEARLINE_ERROR_LOG_FILE=<path>  -> one JSON event per line, file mode 0600
 *   unset / none                                                     -> dropped (the log line still records it)
 * A deployment that adopts a hosted tracker implements ErrorTracker (send the same event to its ingestion API) and
 * selects it in errorTracker() below; docs/runbooks/INCIDENT_RESPONSE.md lists what must be checked first (data
 * residency, a scrubbing review, a DPA).
 */
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { scrubError, scrubStack, scrubValue } from "./scrub";

export interface ErrorEvent {
  event_id: string;
  timestamp: string;
  level: "error" | "warning" | "fatal";
  platform: "node";
  logger: "clearline";
  environment: string;
  release?: string;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  exception: { values: { type: string; value: string; stacktrace: { frames: ReturnType<typeof scrubStack> } }[] };
}

export interface CaptureContext {
  /** The log event or route this happened in (e.g. "api_unexpected_error"). */
  event?: string;
  level?: ErrorEvent["level"];
  tags?: Record<string, string>;
  /** Ids, codes and counts. Scrubbed again regardless. */
  extra?: Record<string, unknown>;
}

export interface ErrorTracker {
  captureException(err: unknown, ctx?: CaptureContext): Promise<void>;
}

const TAG = /^[A-Za-z0-9_.:/-]{1,64}$/;

/** The scrubbed, Sentry-shaped event for one error (exported for tests and for a future hosted tracker). */
export function toErrorEvent(err: unknown, ctx: CaptureContext = {}, env: Record<string, string | undefined> = process.env, now = new Date()): ErrorEvent {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : `non-error thrown: ${typeof err}`);
  const s = scrubError(e);
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...(ctx.tags ?? {}), ...(ctx.event ? { event: ctx.event } : {}), ...(s.code ? { code: s.code } : {}) })) {
    if (TAG.test(k) && typeof v === "string" && TAG.test(v)) tags[k] = v;
  }
  const release = env.CLEARLINE_RELEASE;
  return {
    event_id: randomUUID().replace(/-/g, ""),
    timestamp: now.toISOString(),
    level: ctx.level ?? "error",
    platform: "node",
    logger: "clearline",
    environment: env.CLEARLINE_DEPLOY_ENV || "local",
    ...(release && TAG.test(release) ? { release } : {}),
    tags,
    extra: scrubValue(ctx.extra ?? {}) as Record<string, unknown>,
    exception: { values: [{ type: s.type, value: s.message, stacktrace: { frames: scrubStack(e.stack) } }] },
  };
}

/** The local stand-in: appends one event per line to a file only the server's user can read. */
export class FileErrorTracker implements ErrorTracker {
  constructor(readonly file: string, private readonly env: Record<string, string | undefined> = process.env) {}
  async captureException(err: unknown, ctx?: CaptureContext) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await appendFile(this.file, `${JSON.stringify(toErrorEvent(err, ctx, this.env))}\n`, { mode: 0o600 });
  }
}

/** Keeps events in memory (tests). */
export class MemoryErrorTracker implements ErrorTracker {
  readonly events: ErrorEvent[] = [];
  async captureException(err: unknown, ctx?: CaptureContext) { this.events.push(toErrorEvent(err, ctx)); }
}

export const noErrorTracker: ErrorTracker = { async captureException() { /* not configured */ } };

let override: ErrorTracker | undefined;
/** Tests: replace the tracker (undefined restores the configured one). */
export function setErrorTrackerForTests(t: ErrorTracker | undefined) { override = t; }

export class ErrorTrackerMisconfigured extends Error {
  readonly code = "ERROR_TRACKER_MISCONFIGURED";
}

/** The configured tracker. An unknown CLEARLINE_ERROR_TRACKER value, or `file` without a path, is refused. */
export function errorTracker(env: Record<string, string | undefined> = process.env): ErrorTracker {
  if (override) return override;
  const kind = env.CLEARLINE_ERROR_TRACKER ?? "";
  if (kind === "" || kind === "none") return noErrorTracker;
  if (kind === "file") {
    const file = env.CLEARLINE_ERROR_LOG_FILE;
    if (!file) throw new ErrorTrackerMisconfigured("CLEARLINE_ERROR_TRACKER=file needs CLEARLINE_ERROR_LOG_FILE");
    return new FileErrorTracker(path.resolve(file), env);
  }
  throw new ErrorTrackerMisconfigured(`CLEARLINE_ERROR_TRACKER must be file or none (got ${JSON.stringify(kind.slice(0, 20))})`);
}
