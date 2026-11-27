/**
 * `npx tsx scripts/samples/make-samples.ts`: writes the customer sample files (fictional company "Kestrelbay Synthetic",
 * entity ENT-SG-SYN, SGD) from the synthetic generator's small preset into samples/ and public/samples/ (served by the
 * app as "Download sample files"). Fictional values only; deterministic (the preset's fixed seed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { smallPreset, type SyntheticFile } from "../../src/lib/clearline/synthetic";

async function main() {
  const { world, files } = await smallPreset();
  const sg = world.entitySpecs[0];
  const pick = (kinds: SyntheticFile["kind"][], account?: string) => files.find((f) => kinds.includes(f.kind) && (!account || f.account === account) && (!f.entityId || f.entityId === sg.id));
  const chosen: [string, SyntheticFile | undefined][] = [
    ["provider-settlement-report", pick(["provider_export_a"])],
    ["bank-statement", pick(["bank_csv"], sg.bankAccountId)],
    ["invoices-orders", pick(["order_list_xlsx", "order_list_csv"])],
  ];
  for (const dir of ["samples", "public/samples"]) mkdirSync(path.resolve(dir), { recursive: true });
  for (const [label, f] of chosen) {
    if (!f) throw new Error(`no ${label} file in the small preset`);
    const ext = path.extname(f.name) || ".csv";
    const name = `kestrelbay-sample-${label}${ext}`;
    for (const dir of ["samples", "public/samples"]) writeFileSync(path.resolve(dir, name), f.bytes);
    process.stdout.write(`${name}  (${f.kind}, ${f.bytes.length} bytes)\n`);
  }
}
main().catch((e) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
