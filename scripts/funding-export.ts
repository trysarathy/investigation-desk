import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { importCsv } from "../src/lib/funding/imports";
import { emptyFunding, type ImportKind } from "../src/lib/funding/model";
import { validateFundingData } from "../src/lib/funding/store";
import { buildOutputs } from "../src/lib/funding/outputs";
import type { ExportSettings } from "../src/lib/funding/outputs/journals";
async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const sample = args.includes("--sample"),
    source = flag("--data"),
    out = flag("--out"),
    at = flag("--as-of"),
    config = flag("--settings");
  if (!out || !at || !config || (!sample && !source) || (sample && source))
    throw Error(
      "Usage: npm run funding-export -- --sample|--data store.json --settings settings.json --as-of UTC_TIME --out NEW_DIRECTORY",
    );
  let data = emptyFunding();
  if (sample) {
    for (const kind of [
      "customers",
      "advances",
      "cash",
      "payouts",
      "receipts",
    ] as ImportKind[])
      data = importCsv(
        data,
        kind,
        await readFile(path.join("fixtures/funding", kind + ".csv"), "utf8"),
        undefined,
        kind + ".csv",
        at,
      );
  } else
    data = validateFundingData(JSON.parse(await readFile(source!, "utf8")));
  const settings = JSON.parse(await readFile(config, "utf8")) as ExportSettings;
  const files = buildOutputs(data, at, settings, sample);
  await mkdir(out, { mode: 0o700 });
  for (const [name, body] of Object.entries(files))
    await writeFile(path.join(out, name), body, { mode: 0o600 });
  process.stdout.write(
    `Created ${Object.keys(files).length} review files in ${out}. Nothing was sent or posted.\n`,
  );
}
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Export failed."}\n`,
  );
  process.exitCode = 1;
});
