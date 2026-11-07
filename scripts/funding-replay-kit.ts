import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { replayCase, replayReport, validateManifest } from "../src/lib/funding/replay-kit";
import type { ImportKind } from "../src/lib/funding/model";

async function main() {
  const args = process.argv.slice(2);
  const option = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const sample = args.includes("--sample");
  const manifestPath = sample
    ? path.resolve("fixtures/funding/replay/cases.json")
    : option("--cases") && path.resolve(option("--cases")!);
  if (!manifestPath || (sample && option("--cases")))
    throw Error("Use --sample or --cases PRIVATE_MANIFEST --out NEW_DIRECTORY.");
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  if (sample && (!manifest.synthetic || manifest.cases.length !== 5))
    throw Error("The included example must contain five synthetic cases.");
  const root = await realpath(path.dirname(manifestPath));
  const allowed = sample ? path.dirname(root) : root;
  const started = Date.now();
  const results = [];
  for (const c of manifest.cases) {
    const inputs: Partial<Record<ImportKind, string>> = {};
    for (const [kind, relative] of Object.entries(c.inputs)) {
      const file = await realpath(path.resolve(root, relative));
      if (!file.startsWith(allowed + path.sep))
        throw Error("Refusing a file outside the permitted case directory.");
      inputs[kind as ImportKind] = await readFile(file, "utf8");
    }
    results.push(replayCase(c, inputs));
  }
  const output = option("--out")
    ? path.resolve(option("--out")!)
    : sample ? await mkdtemp(path.join(tmpdir(), "clearline-replay-")) : undefined;
  if (!output) throw Error("Choose a new private --out directory.");
  if (option("--out")) await mkdir(output, { mode: 0o700 });
  await writeFile(path.join(output, "report.md"),
    replayReport(results, manifest.synthetic), { mode: 0o600 });
  await writeFile(path.join(output, "report.json"),
    JSON.stringify({ synthetic: manifest.synthetic, cases: results }, null, 2) + "\n",
    { mode: 0o600 });
  process.stdout.write("Five-case replay: " + results.length + " cases; " +
    (Date.now() - started) + " ms. Report: " + output + "\n");
}
main().catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : "Replay failed") + "\n");
  process.exitCode = 1;
});
