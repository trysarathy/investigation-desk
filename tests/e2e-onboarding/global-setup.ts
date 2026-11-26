import { spawnSync } from "node:child_process";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { ONBOARDING_E2E } from "./env";

/**
 * A fresh database from the committed migrations, then the fictional starting point through the REAL admin CLI:
 * one provider organisation and one platform operator. Everything else happens in the browser.
 */
export default async function globalSetup() {
  const pool = new Pool({ connectionString: ONBOARDING_E2E.ownerUrl });
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP FUNCTION IF EXISTS refuse_change CASCADE;");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  const env = { ...process.env, DATABASE_URL: ONBOARDING_E2E.ownerUrl, DATABASE_OWNER_URL: ONBOARDING_E2E.ownerUrl, CLEARLINE_NEW_PASSWORD: ONBOARDING_E2E.password, CLEARLINE_ORIGIN: ONBOARDING_E2E.origin };
  for (const args of [
    ["create-provider", "e2e-provider", "--name", "Fictional Provider (e2e)", "--timezone", "Asia/Singapore"],
    ["create-user", "operator@platform.example", "Platform Operator (fictional)"],
    ["grant-platform-operator", "operator@platform.example"],
  ]) {
    const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/control/admin.ts", ...args], { env, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`admin ${args[0]} failed: ${r.stderr || r.stdout}`);
  }
}
