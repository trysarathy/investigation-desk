import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { MERCHANT_E2E } from "./env";

/**
 * Rebuilds the merchant e2e database from the committed migrations (schema owner) and seeds the fictional provider,
 * merchants and users through the real admin CLI (`scripts/control/admin.ts seed-merchant-cases`), which loads the
 * three cases through the ingestion adapters. Nothing is reconciled yet: the journeys do that through the UI.
 * rc7: also a fictional LIVE merchant for the upload journeys (tests/e2e-merchant/live-seed.ts), with an empty
 * upload folder.
 */
export async function resetMerchantDatabase() {
  const pool = new Pool({ connectionString: MERCHANT_E2E.ownerUrl });
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP FUNCTION IF EXISTS refuse_change CASCADE;");
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();
  const r = spawnSync("npx", ["tsx", "--conditions=react-server", "scripts/control/admin.ts", "seed-merchant-cases"], {
    env: { ...process.env, DATABASE_URL: MERCHANT_E2E.ownerUrl, CLEARLINE_SEED_PASSWORD: MERCHANT_E2E.password },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`seed-merchant-cases failed: ${r.stderr || r.stdout}`);
  rmSync(MERCHANT_E2E.uploadDir, { recursive: true, force: true });
  const live = spawnSync("npx", ["tsx", "--conditions=react-server", "tests/e2e-merchant/seed-live-cli.ts"], {
    env: { ...process.env, DATABASE_URL: MERCHANT_E2E.ownerUrl, CLEARLINE_SEED_PASSWORD: MERCHANT_E2E.password },
    encoding: "utf8",
  });
  if (live.status !== 0) throw new Error(`live merchant seed failed: ${live.stderr || live.stdout}`);
}

/** Owner-side SQL for assertions and for the one test-only setup step (a merchant's full grant). */
export async function ownerQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: MERCHANT_E2E.ownerUrl });
  try { return (await pool.query(text, params)).rows as T[]; } finally { await pool.end(); }
}
