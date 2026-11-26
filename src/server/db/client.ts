import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { hostedDemoRuntimeUrl } from "./hosted-demo-url";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

declare global { var __clearlineDb: { pool: Pool; db: Db } | undefined }

/**
 * The runtime connection. DATABASE_URL must name the non-owner `clearline_runtime` login (NOBYPASSRLS), never the
 * migration owner: row-level security then applies to every query (see drizzle/0001_security.sql).
 */
export function database(): Db {
  if (!globalThis.__clearlineDb) {
    const url = hostedDemoRuntimeUrl() ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set: Clearline Control needs PostgreSQL (see docs/runbooks/DEPLOYMENT_RUNBOOK_RC5.md)");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10), statement_timeout: 15_000 });
    // An idle connection the server ends (a restart, or the demo reset recreating the database) is dropped from the
    // pool and the next query opens a new one. Without a listener the pool's 'error' event would end the process.
    pool.on("error", (e) => console.error(JSON.stringify({ event: "db_idle_connection_lost", code: (e as { code?: string }).code ?? "unknown" })));
    globalThis.__clearlineDb = { pool, db: drizzle(pool, { schema }) };
  }
  return globalThis.__clearlineDb.db;
}

/** Test and shutdown helper. */
export async function closeDatabase(): Promise<void> {
  const c = globalThis.__clearlineDb;
  globalThis.__clearlineDb = undefined;
  if (c) await c.pool.end();
}
