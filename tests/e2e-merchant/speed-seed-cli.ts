/**
 * Speed measurement helper (tests/e2e-merchant/speed.spec.ts), run in its own process (tsx --conditions=react-server):
 * rebuilds a SEPARATE database (never the suite's) from the committed migrations and seeds one fictional LIVE
 * merchant with a synthetic month of `SPEED_ROWS` payments (default 10,000), stored and reconciled through the volume
 * bench's own path (scripts/perf/volume-bench.ts), plus one fictional Finance member with the suite's test password.
 *   DATABASE_URL=<runtime login> SPEED_OWNER_URL=<owner login> CLEARLINE_SEED_PASSWORD=... npx tsx --conditions=react-server tests/e2e-merchant/speed-seed-cli.ts
 * Prints one JSON line. Test only; synthetic, fictional data only.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { like } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";
import { closeDatabase } from "../../src/server/db/client";
import { createUser, grantMembership } from "../../src/server/admin";
import { runVolumeRep } from "../../scripts/perf/volume-bench";
import { volumeWorld } from "../../scripts/perf/volume";

export const SPEED_USER = "finance@speed-10k.example";

async function main() {
  const ownerUrl = process.env.SPEED_OWNER_URL;
  const pw = process.env.CLEARLINE_SEED_PASSWORD;
  if (!ownerUrl || !process.env.DATABASE_URL || !pw) throw new Error("set SPEED_OWNER_URL, DATABASE_URL and CLEARLINE_SEED_PASSWORD");
  const rows = Number(process.env.SPEED_ROWS ?? 10_000);
  const pool = new Pool({ connectionString: ownerUrl });
  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP FUNCTION IF EXISTS refuse_change CASCADE;");
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const owner = drizzle(pool, { schema }) as Db;
    const t0 = performance.now();
    const rep = await runVolumeRep(owner, volumeWorld({ payments: rows, bankLines: Math.max(600, Math.round(rows / 20)) }), { keep: true });
    const [org] = await owner.select({ slug: schema.organizations.slug }).from(schema.organizations).where(like(schema.organizations.slug, "vol-%"));
    await createUser(owner, { email: SPEED_USER, name: "Speed Finance (fictional)", password: pw });
    await grantMembership(owner, { orgSlug: org.slug, email: SPEED_USER, role: "finance" });
    process.stdout.write(`${JSON.stringify({ org: org.slug, payments: rep.payments, bankLines: rep.bankLines, records: rep.records, seedMs: Math.round(performance.now() - t0) })}\n`);
  } finally {
    await pool.end();
    await closeDatabase();
  }
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closeDatabase(); process.exit(1); });
