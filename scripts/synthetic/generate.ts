/**
 * Write a synthetic preset's files to a directory and print name, size and sha256 of each.
 *   npx tsx scripts/synthetic/generate.ts [--out synthetic-data/] [--preset month|small] [--seed N] [--month YYYY-MM]
 * Every file is "Synthetic · fictional data": no real people, companies, banks, accounts, wallets or hashes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { coverage, monthPreset, smallPreset } from "../../src/lib/clearline/synthetic";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main(): Promise<void> {
  const out = resolve(arg("out", "synthetic-data/")!);
  const which = arg("preset", "month");
  const seed = arg("seed");
  const month = arg("month");
  const opts = { ...(seed ? { seed: Number(seed) } : {}), ...(month ? { month } : {}) };
  const p = which === "small" ? await smallPreset(opts) : await monthPreset(opts);
  mkdirSync(out, { recursive: true });
  for (const f of p.files) {
    writeFileSync(join(out, f.name), f.bytes);
    process.stdout.write(`${f.bytes.length.toString().padStart(9)}  ${createHash("sha256").update(f.bytes).digest("hex")}  ${f.name}\n`);
  }
  const cov = coverage(p.world, p.truth);
  process.stdout.write(`\n${p.files.length} files → ${out}\npreset ${which}, seed ${p.world.seed}, month ${p.world.month}, ${p.world.orders.length} orders, ${p.world.transfers.length} transfers, ${p.world.batches.length} batches, ${p.world.bankLines.length} bank lines\n`);
  process.stdout.write(`difference types: ${JSON.stringify(cov.differenceTypes)}\nsituations: ${JSON.stringify(cov.situations)}\ndecisions: ${JSON.stringify(cov.decisions)}\n`);
}

main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; });
