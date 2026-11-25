/**
 * v1 Phase 5.3: reconciliation time on the DEMO SEED with field encryption off and on (docs/perf/ENCRYPTION_V1_PERF.md).
 *   CLEARLINE_TEST_OWNER_URL=<owner> CLEARLINE_TEST_RUNTIME_URL=<runtime> npx tsx --conditions=react-server scripts/perf/encryption-recon.ts [--iterations 20]
 * Seeds the demo world twice into a migrated, EMPTY test database (suffixes -plain and -enc; the second with a key made
 * for this run only), then for each entity times, in one owner transaction each:
 *   load    = loadReconcileInput (reads every row; with encryption on, opens every sealed value)
 *   engine  = reconcile() on that input (pure; the same either way)
 * and checks both seeds give the same reconciliation input apart from bank line ids (random per organisation) and the
 * same decisions. Prints timings (ms) only. Fictional demo data only.
 */
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";
import { closeDatabase } from "../../src/server/db/client";
import { seedDemo } from "../../src/server/demo-seed";
import { loadReconcileInput, plainForDisplay } from "../../src/server/merchant-store";
import { inputSha256 } from "../../src/server/merchant";
import { reconcile } from "../../src/lib/clearline/merchant";
import { recordingOf } from "../../src/lib/clearline/merchant/chain";
import { DEMO_ENTITY_IDS, demoWorld } from "../../src/lib/clearline/demo/world";
import { allDemoTransfers } from "../../src/lib/clearline/demo/next-day";
import { installDemoClock } from "../demo/clock";
import { LocalKms, setKmsForTests } from "../../src/server/crypto/kms";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };

async function main() {
  const owner = process.env.CLEARLINE_TEST_OWNER_URL;
  process.env.DATABASE_URL ??= process.env.CLEARLINE_TEST_RUNTIME_URL;
  if (!owner || !process.env.DATABASE_URL) throw new Error("set CLEARLINE_TEST_OWNER_URL and CLEARLINE_TEST_RUNTIME_URL to an empty migrated test database");
  process.env.CLEARLINE_UPLOAD_DIR ??= "/tmp/clearline-perf-uploads";
  const pool = new Pool({ connectionString: owner, max: 4 });
  const db = drizzle(pool, { schema }) as Db;
  const iterations = Number(arg("iterations") ?? 20);
  const recording = recordingOf(allDemoTransfers(demoWorld()));
  const out: Record<string, unknown> = {};
  const kms = new LocalKms([["perf", randomBytes(32)]]); // made for this run only
  try {
    const orgs: Record<string, string> = {};
    for (const mode of ["plain", "enc"] as const) {
      setKmsForTests(mode === "enc" ? kms : null);
      const clock = installDemoClock();
      const t0 = performance.now();
      try { orgs[mode] = (await seedDemo(db, { password: `perf-${randomBytes(6).toString("hex")}`, recording, setClock: clock.set, suffix: `-${mode}` })).orgs.merchant; } finally { clock.restore(); }
      out[`seed_ms_${mode}`] = Math.round(performance.now() - t0);
    }
    const sealed = await db.execute(sql`select count(*)::int n from chain_transfers where org_id = ${orgs.enc} and to_address_enc is not null`);
    out.sealed_transfers_enc = (sealed.rows[0] as { n: number }).n;
    for (const e of Object.values(DEMO_ENTITY_IDS)) {
      const res: Record<string, { load: number[]; engine: number[]; hash?: string; decisions?: string }> = { plain: { load: [], engine: [] }, enc: { load: [], engine: [] } };
      for (let i = 0; i < iterations; i++) {
        for (const mode of (i % 2 ? ["enc", "plain"] : ["plain", "enc"]) as ("plain" | "enc")[]) {
          setKmsForTests(mode === "enc" ? kms : null);
          const t0 = performance.now();
          const input = await db.transaction((tx) => loadReconcileInput(tx, orgs[mode], e));
          const t1 = performance.now();
          const r = reconcile(input);
          const t2 = performance.now();
          res[mode].load.push(t1 - t0); res[mode].engine.push(t2 - t1);
          const masked = { ...input, bankLines: input.bankLines.map((b) => ({ ...b, bankLineId: "-", provenance: "-" })).sort((x, y) => (JSON.stringify(plainForDisplay(x)) < JSON.stringify(plainForDisplay(y)) ? -1 : 1)) };
          res[mode].hash = inputSha256(masked);
          res[mode].decisions = JSON.stringify(r.records.map((x) => [x.orderId, x.explanation.decision, x.explanation.ruleId]));
        }
      }
      out[e] = {
        load_ms_median: { plain: median(res.plain.load), enc: median(res.enc.load) },
        engine_ms_median: { plain: median(res.plain.engine), enc: median(res.enc.engine) },
        same_input: res.plain.hash === res.enc.hash, same_decisions: res.plain.decisions === res.enc.decisions,
      };
    }
    process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  } finally {
    await pool.end();
    await closeDatabase();
  }
}
main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exitCode = 1; });
