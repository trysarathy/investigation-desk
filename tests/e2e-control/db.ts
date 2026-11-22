import { spawnSync } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { E2E } from "./env";

/**
 * Rebuilds the e2e database from the committed migrations (schema owner) and seeds the fictional demo through the
 * real admin CLI (`scripts/control/admin.ts seed-demo`), exactly as an operator would. Test-only.
 */
export async function resetDatabase() {
  const pool = new Pool({ connectionString: E2E.ownerUrl });
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP FUNCTION IF EXISTS refuse_change CASCADE;");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/control/admin.ts", "seed-demo"], {
    env: { ...process.env, DATABASE_URL: E2E.ownerUrl, CLEARLINE_SEED_PASSWORD: E2E.password },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`seed-demo failed: ${r.stderr || r.stdout}`);
}
