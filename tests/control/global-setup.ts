import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Rebuilds the test database from the committed migrations once per run (owner connection). */
export default async function setup() {
  const owner = process.env.CLEARLINE_TEST_OWNER_URL;
  if (!owner || !process.env.CLEARLINE_TEST_RUNTIME_URL || !process.env.CLEARLINE_TEST_JOBS_URL) {
    throw new Error("BLOCKED: set CLEARLINE_TEST_OWNER_URL, CLEARLINE_TEST_RUNTIME_URL and CLEARLINE_TEST_JOBS_URL to a PostgreSQL 16 test database (scripts/db/setup-local.sh)");
  }
  const pool = new Pool({ connectionString: owner });
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP FUNCTION IF EXISTS refuse_change CASCADE;");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
}
