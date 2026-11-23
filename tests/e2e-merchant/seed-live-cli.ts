/** Seeds the fictional live merchant of the upload journeys (schema owner connection, as the admin CLI). Test only. */
import { closeDatabase, database } from "../../src/server/db/client";
import { seedLiveMerchant } from "./live-seed";

async function main() {
  const pw = process.env.CLEARLINE_SEED_PASSWORD;
  if (!pw || pw.length < 12) throw new Error("set CLEARLINE_SEED_PASSWORD (≥ 12 chars)");
  await seedLiveMerchant(database(), pw);
  await closeDatabase();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await closeDatabase(); process.exit(1); });
