/**
 * v1 Phase 5.3: field-encryption key maintenance (docs/runbooks/KEY_ROTATION.md). Runs as the schema OWNER, never as
 * the web app's login, while the app keeps serving:
 *   DATABASE_OWNER_URL=<owner login> CLEARLINE_KMS_KEYS=<id:key,...> npx tsx --conditions=react-server scripts/crypto/keys.ts <command> [--org <uuid>]
 * Commands:
 *   status            data key versions per organisation and how many values each sealed; values not yet sealed
 *   backfill          seal every value written before encryption was on (expand step); also re-seals stale values
 *   reencrypt         the lazy re-encrypt job: move values sealed with a retired data key to the active one (same pass)
 *   rotate-data-keys  a new data key version per organisation (the old one is retired, still opens)
 *   rewrap            re-wrap every organisation key under the active master key (first key in CLEARLINE_KMS_KEYS)
 *   verify            open every sealed value; compare with its plaintext copy and its blind index (exit 3 on a problem)
 *   purge-retired     delete retired data keys no stored value uses any more
 * Prints counts, organisation ids and key ids only: never a key, a value or a ciphertext.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../src/server/db/schema";
import type { Db } from "../../src/server/db/client";
import { keyStatus, purgeRetiredKeys, rewrapAll, rotateDataKeys, sealAll, verifyAll } from "../../src/server/crypto/maintenance";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const out = (v: unknown) => process.stdout.write(`${JSON.stringify(v)}\n`);

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("set DATABASE_OWNER_URL to the schema owner login (key maintenance never runs as the app's login)");
  const cmd = process.argv[2];
  const org = arg("org");
  const orgIds = org ? [org] : undefined;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema }) as Db;
  try {
    const role = (await pool.query("select rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0] as { rolbypassrls: boolean; rolsuper: boolean };
    if (!role?.rolbypassrls || role.rolsuper) throw new Error("key maintenance runs as the schema owner login (BYPASSRLS, not a superuser)");
    if (cmd === "status") out(await keyStatus(db, { orgIds }));
    else if (cmd === "backfill" || cmd === "reencrypt") out(await sealAll(db, { orgIds, batchSize: Number(arg("batch") ?? 500) }));
    else if (cmd === "rotate-data-keys") out(await rotateDataKeys(db, { orgIds }));
    else if (cmd === "rewrap") out(await rewrapAll(db));
    else if (cmd === "verify") { const r = await verifyAll(db, { orgIds }); out(r); if (r.problems.length) process.exitCode = 3; }
    else if (cmd === "purge-retired") out(await purgeRetiredKeys(db, { orgIds }));
    else { process.stderr.write("usage: keys.ts status|backfill|reencrypt|rotate-data-keys|rewrap|verify|purge-retired [--org <uuid>] [--batch N]\n"); process.exitCode = 2; }
  } finally {
    await pool.end();
  }
}
main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
