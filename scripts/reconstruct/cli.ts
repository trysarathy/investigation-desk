/**
 * rc6 phase 10: the Case Reconstruction CLI. LOCAL ONLY: it reads one day of a provider's anonymised data from a
 * directory, writes the reconstruction report into --out, and nothing else. No network, no database, no upload.
 *
 *   npx tsx scripts/reconstruct/reconstruct.ts --in <dir> --out <dir> [--mapping <file>] [--generated-at <text>]
 *   npx tsx scripts/reconstruct/reconstruct.ts --purge <dir> [--yes]
 *
 * Refusals (exit 1): CI is set; the input or output directory is inside a git repository but not under its
 * git-ignored reconstruction-data/ (the bundled sample is the one exception for --in); --out exists and holds files
 * this tool did not write. The tool writes only report.json, report.html, report.csv and its manifest, and only
 * inside --out. --purge deletes only the files its manifest lists, unchanged since it wrote them, and only after --yes.
 * See docs/runbooks/RECONSTRUCTION_DATA_HANDLING.md.
 */
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { reconstructDay, type InputFile } from "../../src/lib/clearline/merchant/reconstruct/build";
import { reportCsv, reportHtml, reportJson } from "../../src/lib/clearline/merchant/reconstruct/render";

export const DATA_DIR = "reconstruction-data";
export const MANIFEST = ".clearline-reconstruction.json";
export const OUTPUTS = ["report.json", "report.html", "report.csv"] as const;
const MANIFEST_TOOL = "clearline-reconstruct";

export interface CliDeps {
  env: Readonly<Record<string, string | undefined>>;
  /** Directory holding the bundled samples (scripts/reconstruct/sample). */
  sampleRoot: string;
  cwd?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

interface Manifest { tool: typeof MANIFEST_TOOL; version: 1; label: string; createdDir: boolean; files: { path: string; bytes: number; sha256: string }[] }

export const USAGE = [
  "Usage:",
  "  npx tsx scripts/reconstruct/reconstruct.ts --in <dir> --out <dir> [--mapping <file>] [--generated-at <text>]",
  "  npx tsx scripts/reconstruct/reconstruct.ts --purge <dir> [--yes]",
  "Local only: no network, no database, no upload. Refuses to run when CI is set. Input and output inside a git",
  `repository must be under its git-ignored ${DATA_DIR}/. See docs/runbooks/RECONSTRUCTION_DATA_HANDLING.md.`,
].join("\n");

class Refused extends Error {}

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  const valued = new Set(["--in", "--out", "--mapping", "--generated-at", "--purge"]);
  const flags = new Set(["--yes", "--help"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags.has(a)) { out[a] = true; continue; }
    if (!valued.has(a)) throw new Refused(`Unknown argument ${JSON.stringify(a)}.`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Refused(`${a} needs a value.`);
    if (a in out) throw new Refused(`${a} is given twice.`);
    out[a] = v;
    i++;
  }
  return out;
}

/** The nearest directory at or above `p` that holds a .git entry (a repository or a worktree), or null. */
export function gitRoot(p: string): string | null {
  for (let d = p; ; d = dirname(d)) {
    if (existsSync(join(d, ".git"))) return d;
    if (dirname(d) === d) return null;
  }
}

/** Whether the repository's own .gitignore ignores reconstruction-data/ at its root. */
export function ignoresDataDir(root: string): boolean {
  let text = "";
  try { text = readFileSync(join(root, ".gitignore"), "utf8"); } catch { return false; }
  return text.split(/\r?\n/).some((l) => /^\/?reconstruction-data\/?$/.test(l.trim()));
}

/** Real path of `p`, or of its nearest existing ancestor joined with the rest (for a directory still to create). */
function realish(p: string): string {
  const abs = resolve(p);
  const rest: string[] = [];
  for (let d = abs; ; d = dirname(d)) {
    try { return join(realpathSync(d), ...rest.reverse()); } catch { /* not there yet */ }
    if (dirname(d) === d) return abs;
    rest.push(basename(d));
  }
}

/** Data may sit outside any git repository, or inside one only under its git-ignored reconstruction-data/. */
export function placementProblem(real: string): string | null {
  const root = gitRoot(real);
  if (!root) return null;
  const rel = relative(root, real);
  const first = rel.split(sep)[0];
  if (first !== DATA_DIR) return `it is inside the git repository ${root} but not under ${join(root, DATA_DIR)}${sep}. Put provider data under ${DATA_DIR}/ or outside the repository.`;
  if (!ignoresDataDir(root)) return `${join(root, DATA_DIR)}${sep} is not listed in ${join(root, ".gitignore")}, so it could be committed.`;
  return null;
}

function bundledSample(real: string, sampleRoot: string): boolean {
  let names: string[] = [];
  try { names = readdirSync(sampleRoot); } catch { return false; }
  return names.some((n) => { try { return realpathSync(join(sampleRoot, n)) === real && statSync(real).isDirectory(); } catch { return false; } });
}

function readManifest(dir: string): Manifest | null {
  const p = join(dir, MANIFEST);
  if (!existsSync(p)) return null;
  if (!lstatSync(p).isFile()) throw new Refused(`${p} is not a regular file.`);
  let m: unknown;
  try { m = JSON.parse(readFileSync(p, "utf8")); } catch { throw new Refused(`${p} is not a manifest this tool wrote.`); }
  const ok = !!m && typeof m === "object" && (m as Manifest).tool === MANIFEST_TOOL && (m as Manifest).version === 1 && Array.isArray((m as Manifest).files)
    && (m as Manifest).files.every((f) => f && typeof f.path === "string" && (OUTPUTS as readonly string[]).includes(f.path) && typeof f.sha256 === "string");
  if (!ok) throw new Refused(`${p} is not a manifest this tool wrote.`);
  return m as Manifest;
}

/** Write one file into `dir` only: never through a link, never over a file the manifest does not list. */
function writeInside(dir: string, name: string, data: string, listed: ReadonlySet<string>) {
  const p = join(dir, name);
  if (dirname(p) !== dir) throw new Refused(`Refusing to write ${p}.`);
  if (existsSync(p) || isLink(p)) {
    const st = lstatSync(p);
    if (!st.isFile() || !listed.has(name)) throw new Refused(`${p} exists and was not written by this tool.`);
    unlinkSync(p);
  }
  writeFileSync(p, data, { flag: "wx", mode: 0o600 });
}
const isLink = (p: string) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

async function run(a: Record<string, string | true>, deps: CliDeps): Promise<number> {
  const say = deps.out ?? ((l: string) => process.stdout.write(l + "\n"));
  const cwd = deps.cwd ?? process.cwd();
  const at = (p: string) => (isAbsolute(p) ? p : resolve(cwd, p));
  if (typeof a["--in"] !== "string" || typeof a["--out"] !== "string") throw new Refused("--in and --out are required.");
  const inReal = realish(at(a["--in"]));
  if (!existsSync(inReal) || !statSync(inReal).isDirectory()) throw new Refused(`Input ${a["--in"]} is not a directory.`);
  const sample = bundledSample(inReal, deps.sampleRoot);
  if (!sample) { const p = placementProblem(inReal); if (p) throw new Refused(`Refusing the input: ${p}`); }
  const outReal = realish(at(a["--out"]));
  const op = placementProblem(outReal);
  if (op) throw new Refused(`Refusing the output: ${op}`);
  if (outReal === inReal || outReal.startsWith(inReal + sep) || inReal.startsWith(outReal + sep)) throw new Refused("--out must not be the input directory, inside it, or around it.");
  const generatedAt = typeof a["--generated-at"] === "string" ? a["--generated-at"] : null;
  if (generatedAt !== null && !/^[0-9A-Za-z:.+\- ]{1,40}$/.test(generatedAt)) throw new Refused("--generated-at is up to 40 letters, digits, spaces or : . + -");

  // Output directory: new (its parent must exist), or one this tool wrote before.
  let manifest: Manifest | null = null;
  let createdDir: boolean;
  if (existsSync(outReal)) {
    if (!lstatSync(outReal).isDirectory()) throw new Refused(`Output ${a["--out"]} is not a directory.`);
    manifest = readManifest(outReal);
    const listed = new Set(manifest?.files.map((f) => f.path) ?? []);
    const foreign = readdirSync(outReal).filter((n) => n !== MANIFEST && !listed.has(n));
    if (foreign.length) throw new Refused(`Output ${a["--out"]} holds files this tool did not write (${foreign.sort().join(", ")}); use a new or empty directory.`);
    createdDir = manifest?.createdDir ?? false;
  } else {
    if (!existsSync(dirname(outReal))) throw new Refused(`The parent of ${a["--out"]} does not exist; the tool creates only the output directory itself.`);
    createdDir = true;
  }

  const files: InputFile[] = readdirSync(inReal).sort().filter((n) => lstatSync(join(inReal, n)).isFile()).map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(join(inReal, n))) }));
  const mapping = typeof a["--mapping"] === "string" ? { name: basename(a["--mapping"]), bytes: new Uint8Array(readFileSync(at(a["--mapping"]))) } : null;
  const { report } = await reconstructDay(files, { sample, generatedAt, mapping });
  const outputs: [string, string][] = [["report.json", reportJson(report)], ["report.html", reportHtml(report)], ["report.csv", reportCsv(report)]];

  if (createdDir && !existsSync(outReal)) mkdirSync(outReal, { mode: 0o700 });
  const listed = new Set(manifest?.files.map((f) => f.path) ?? []);
  for (const [name, data] of outputs) writeInside(outReal, name, data, listed);
  const next: Manifest = { tool: MANIFEST_TOOL, version: 1, label: report.label, createdDir, files: outputs.map(([path, data]) => ({ path, bytes: Buffer.byteLength(data), sha256: sha(data) })) };
  writeInside(outReal, MANIFEST, `${JSON.stringify(next, null, 2)}\n`, new Set([MANIFEST]));
  say(report.label);
  say(`Reconstruction written to ${a["--out"]}: ${OUTPUTS.join(", ")}.`);
  say(`${report.items.length} items, ${report.bridges.length} batches, ${report.journals.length} journal proposals (posting rule pending sign-off), ${report.unmappable.length} unmappable fields, ${report.questions.length} questions for the provider.`);
  say(`Delete it when done: npx tsx scripts/reconstruct/reconstruct.ts --purge ${a["--out"]} --yes`);
  return 0;
}

function purge(target: string, yes: boolean, deps: CliDeps): number {
  const say = deps.out ?? ((l: string) => process.stdout.write(l + "\n"));
  const dir = realish(resolve(deps.cwd ?? process.cwd(), target));
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) throw new Refused(`${target} is not a directory.`);
  const p = placementProblem(dir);
  if (p) throw new Refused(`Refusing to purge: ${p}`);
  const m = readManifest(dir);
  if (!m) throw new Refused(`${target} has no ${MANIFEST}: the tool purges only output directories it created.`);
  const del: string[] = [];
  const keep: string[] = [];
  for (const f of m.files) {
    const fp = join(dir, f.path);
    if (!existsSync(fp)) continue;
    const st = lstatSync(fp);
    if (st.isFile() && sha(readFileSync(fp)) === f.sha256) del.push(f.path); else keep.push(f.path);
  }
  if (!yes) {
    say(`Would delete from ${target}: ${[...del, MANIFEST].join(", ")}${m.createdDir ? ", then the directory if it is empty" : ""}.`);
    if (keep.length) say(`Would keep (changed since the tool wrote them): ${keep.join(", ")}.`);
    say("Nothing was deleted. Re-run with --yes to delete.");
    return 2;
  }
  for (const n of del) unlinkSync(join(dir, n));
  if (keep.length) {
    say(`Deleted ${del.length} file(s). Kept ${keep.join(", ")} (changed since the tool wrote them) and the manifest; delete those yourself if they are yours to delete.`);
    return 1;
  }
  unlinkSync(join(dir, MANIFEST));
  let removedDir = false;
  if (m.createdDir && readdirSync(dir).length === 0) { rmdirSync(dir); removedDir = true; }
  say(`Deleted ${del.length + 1} file(s) the tool created${removedDir ? " and the directory" : ""} from ${target}.`);
  return 0;
}

/** The CLI. Returns the exit code: 0 done, 1 refused, 2 usage or confirmation needed. */
export async function main(argv: readonly string[], deps: CliDeps): Promise<number> {
  const err = deps.err ?? ((l: string) => process.stderr.write(l + "\n"));
  if (deps.env.CI !== undefined) { err("Refusing to run: CI is set. The reconstruction tool is local only and never runs in CI."); return 1; }
  let a: Record<string, string | true>;
  try { a = parseArgs(argv); } catch (e) { err(e instanceof Error ? e.message : String(e)); err(USAGE); return 2; }
  if (a["--help"] || argv.length === 0) { (deps.out ?? ((l: string) => process.stdout.write(l + "\n")))(USAGE); return a["--help"] ? 0 : 2; }
  try {
    if (typeof a["--purge"] === "string") {
      if (a["--in"] || a["--out"] || a["--mapping"] || a["--generated-at"]) throw new Refused("--purge takes only a directory and --yes.");
      return purge(a["--purge"], a["--yes"] === true, deps);
    }
    if (a["--yes"]) throw new Refused("--yes goes with --purge only.");
    return await run(a, deps);
  } catch (e) {
    if (e instanceof Refused) { err(e.message); return 1; }
    throw e;
  }
}
