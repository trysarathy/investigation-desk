import { readPrivateFile } from "../src/lib/funding/private";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { importCsv } from "../src/lib/funding/imports";
import { emptyFunding, type ImportKind } from "../src/lib/funding/model";
import { FundingStore } from "../src/lib/funding/store";
import { buildOutputs } from "../src/lib/funding/outputs";
import { sha256 } from "../src/lib/funding/evidence";
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
  const store = source ? new FundingStore(path.resolve(source)) : undefined;
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
  } else {
    await readPrivateFile(path.resolve(source!));
    data = await store!.load();
  }
  const settings = JSON.parse(await readFile(config, "utf8")) as ExportSettings;
  const files = buildOutputs(data, at, settings, sample);
  const details = {
    as_of: at,
    files: Object.fromEntries(
      Object.entries(files).map(([name, body]) => [name, sha256(body)]),
    ),
    note: "Prepared files; delivery is not observed.",
  };
  await store?.recordAudit(
    {
      actor: { kind: "local_admin", id: "funding-export-cli" },
      action: "export_prepared",
      details,
    },
    data.revision,
  );
  await mkdir(out, { mode: 0o700 });
  for (const [name, body] of Object.entries(files))
    await writeFile(path.join(out, name), body, { mode: 0o600 });
  await store?.recordAudit({
    actor: { kind: "local_admin", id: "funding-export-cli" },
    action: "export_files_written",
    details: {
      ...details,
      note: "Files written to a local directory; no ERP import or external delivery observed.",
    },
  });
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
