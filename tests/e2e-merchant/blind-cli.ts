/**
 * rc7 Phase 5 blind test helper, run by the spec in its own process (tsx --conditions=react-server):
 *   seed  — the blank fictional live merchant (owner connection, DATABASE_URL = owner login), like the admin CLI;
 *   judge — read what the UI produced and judge it against the generator's truth (READ ONLY; DATABASE_URL = runtime
 *           login, through the Finance member's row-level security). Prints one JSON line.
 * Test only; synthetic data only.
 */
import { closeDatabase, database } from "../../src/server/db/client";
import { seedBlindMerchant } from "./blind-seed";
import { judgeBlind } from "./blind-judge";

async function main() {
  const cmd = process.argv[2];
  if (cmd === "seed") {
    const pw = process.env.CLEARLINE_SEED_PASSWORD;
    if (!pw || pw.length < 12) throw new Error("set CLEARLINE_SEED_PASSWORD (≥ 12 chars)");
    await seedBlindMerchant(database(), pw);
  } else if (cmd === "judge") {
    process.stdout.write(`${JSON.stringify(await judgeBlind())}\n`);
  } else throw new Error("usage: blind-cli.ts seed|judge");
  await closeDatabase();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closeDatabase(); process.exit(1); });
