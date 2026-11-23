/**
 * rc7 phase 3b: `npm run bench:e2e` — seed a synthetic LIVE organisation through the real upload pipeline (10,000
 * payments and about 530 bank lines over 8 synthetic months), reconcile it with database reads and writes, print the
 * timings, then delete the benchmark organisation (unless --keep). Target: under 60 s.
 *   DATABASE_URL=<runtime login> CLEARLINE_BENCH_OWNER_URL=<owner login> npm run bench:e2e [-- --months 8 --per-month 1250 --keep]
 * Uploaded files go to a temporary folder, encrypted with a key made for this run only. Synthetic data only.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";
import { closeDatabase } from "../../src/server/db/client";
import { deleteMerchant } from "../../src/server/merchant-deletion";
import { runBench } from "./e2e-core";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const TARGET_MS = 60_000;

async function main() {
  const ownerUrl = process.env.CLEARLINE_BENCH_OWNER_URL ?? process.env.CLEARLINE_TEST_OWNER_URL;
  process.env.DATABASE_URL ??= process.env.CLEARLINE_TEST_RUNTIME_URL;
  if (!ownerUrl || !process.env.DATABASE_URL) throw new Error("set DATABASE_URL (runtime login) and CLEARLINE_BENCH_OWNER_URL (owner login) to a migrated database");
  const dir = mkdtempSync(path.join(tmpdir(), "clearline-bench-"));
  process.env.CLEARLINE_UPLOAD_DIR = dir;
  process.env.CLEARLINE_UPLOAD_KEY = randomBytes(32).toString("base64");
  const pool = new Pool({ connectionString: ownerUrl });
  const owner = drizzle(pool, { schema }) as Db;
  try {
    const r = await runBench(owner, { months: Number(arg("months") ?? 8), paymentsPerMonth: Number(arg("per-month") ?? 1250) });
    process.stdout.write(`${JSON.stringify({ payments: r.payments, bankLines: r.bankLines, uploads: r.uploads, rows: r.rows, decisions: r.decisions, timingsMs: r.timingsMs, totalMs: r.totalMs })}\n`);
    process.stdout.write(`end-to-end: ${(r.totalMs / 1000).toFixed(1)} s for ${r.payments} payments and ${r.bankLines} bank lines (target ${TARGET_MS / 1000} s: ${r.totalMs <= TARGET_MS ? "met" : "MISSED"})\n`);
    if (!process.argv.includes("--keep")) await deleteMerchant(owner, r.slug, r.slug);
    if (r.totalMs > TARGET_MS) process.exitCode = 3;
  } finally {
    await pool.end();
    await closeDatabase();
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? (process.env.BENCH_DEBUG ? e.stack : e.message) : String(e)}\n`); process.exitCode = 1; });
