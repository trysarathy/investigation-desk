import "server-only";
import { sql } from "drizzle-orm";
import { database } from "../db/client";

/**
 * v1 phase 5.5: uptime checks. Two answers, neither leaking detail (no error text, version, host, count or timing):
 *
 *   GET /api/health  liveness for the load balancer: 200 while the process can reach the database, 503 when it cannot.
 *                    The worker is reported ("ok" | "stale") but never fails it: a stopped worker must not take the
 *                    web app out of rotation.
 *   GET /api/ready   readiness for uptime monitoring and deploy checks: 200 only when the database answers AND a job
 *                    worker has reported a pass within CLEARLINE_WORKER_STALE_SECONDS (default 300), otherwise 503.
 *
 * Both read the database through the runtime login and one function, ops_worker_last_seen() (drizzle/0081, was 0075), which
 * returns the newest heartbeat time and nothing else.
 */
export type CheckState = "ok" | "fail";
export type WorkerState = "ok" | "stale";
export interface HealthChecks { database: CheckState; worker: WorkerState }

export const DEFAULT_WORKER_STALE_SECONDS = 300;
const DB_TIMEOUT_MS = 3_000;

export function workerStaleSeconds(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CLEARLINE_WORKER_STALE_SECONDS);
  return Number.isInteger(n) && n >= 30 && n <= 86_400 ? n : DEFAULT_WORKER_STALE_SECONDS;
}

/** Reads the newest worker heartbeat (null: none yet). Throws if the database does not answer in time. */
export type LastSeenReader = () => Promise<Date | null>;

export const readLastSeen: LastSeenReader = async () => {
  const q = database().execute(sql`select ops_worker_last_seen() as t`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("database check timed out")), DB_TIMEOUT_MS); });
  try {
    const r = await Promise.race([q, timeout]);
    const t = (r.rows[0] as { t: Date | string | null } | undefined)?.t;
    return t ? new Date(t) : null;
  } finally { clearTimeout(timer); }
};

/** Pure decision from one read: the database answered (or not) and how old the newest heartbeat is. */
export function decide(lastSeen: Date | null | "unreachable", now: Date, staleSeconds: number): HealthChecks {
  if (lastSeen === "unreachable") return { database: "fail", worker: "stale" };
  const fresh = lastSeen !== null && now.getTime() - lastSeen.getTime() <= staleSeconds * 1000;
  return { database: "ok", worker: fresh ? "ok" : "stale" };
}

export async function runChecks(read: LastSeenReader = readLastSeen, now: () => Date = () => new Date(), env = process.env): Promise<HealthChecks> {
  let lastSeen: Date | null | "unreachable";
  try { lastSeen = await read(); } catch { lastSeen = "unreachable"; }
  return decide(lastSeen, now(), workerStaleSeconds(env));
}

const HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json", "X-Robots-Tag": "noindex" };

export async function healthResponse(read?: LastSeenReader): Promise<Response> {
  const checks = await runChecks(read);
  const ok = checks.database === "ok";
  const status = !ok ? "down" : checks.worker === "ok" ? "ok" : "degraded";
  return new Response(JSON.stringify({ status, checks }), { status: ok ? 200 : 503, headers: HEADERS });
}

export async function readyResponse(read?: LastSeenReader): Promise<Response> {
  const checks = await runChecks(read);
  const ready = checks.database === "ok" && checks.worker === "ok";
  return new Response(JSON.stringify({ status: ready ? "ready" : "not_ready", checks }), { status: ready ? 200 : 503, headers: HEADERS });
}
