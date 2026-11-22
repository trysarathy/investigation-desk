/**
 * rc6 Case Reconstruction CLI entry point (local only). See scripts/reconstruct/cli.ts and
 * docs/runbooks/RECONSTRUCTION_DATA_HANDLING.md.
 *   npx tsx scripts/reconstruct/reconstruct.ts --in <dir> --out <dir> [--mapping <file>] [--generated-at <text>]
 */
import { join } from "node:path";
import { main } from "./cli";

main(process.argv.slice(2), { env: process.env, sampleRoot: join(__dirname, "sample") }).then(
  (code) => { process.exitCode = code; },
  (e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; },
);
