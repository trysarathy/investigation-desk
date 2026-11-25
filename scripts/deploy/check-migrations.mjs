#!/usr/bin/env node
/**
 * v1 phase 6: expand/contract migration lint. Run in CI on every pull request and before every staging or production
 * deploy (.github/workflows/ci.yml, deploy-staging.yml, deploy-production.yml).
 *
 *   node scripts/deploy/check-migrations.mjs --base <git ref>   (the base branch of the PR, or the commit running in
 *                                                              the environment being deployed to)
 *
 * During a deploy the OLD code keeps running while the new migrations apply (the migrate job runs before the new
 * containers take traffic), and a rollback puts the old code back on the NEW schema. So a release may only EXPAND
 * the schema. For every migration file added since <base>:
 *
 *   - DROP TABLE / DROP COLUMN / DROP FUNCTION / DROP VIEW of an identifier that the code at <base> OR at HEAD still
 *     names (src/, scripts/, tests/control excluded) fails: stop using it in one release, drop it in a later one.
 *   - RENAME (table, column) and ALTER COLUMN ... TYPE always fail: old and new code cannot both work. Expand instead
 *     (add the new column, write both, backfill, switch reads, then drop the old one in a later release).
 *   - An edited or deleted migration that <base> already had fails (a migration that ran is never changed).
 *
 * A finding can be waived only with a line in the migration itself:
 *   -- migration-lint: allow <drop|rename|type> <identifier> -- <reason>
 * The waiver is printed in the output so a reviewer sees it. Prints file names and identifiers only.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ID = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QID = String.raw`(?:${ID}\.)?(${ID})`;
const unq = (s) => s.replace(/^"|"$/g, "");

/** SQL without comments (-- line and /* block *\/), whitespace collapsed. String literals are kept as they are. */
export function stripSql(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ").replace(/\s+/g, " ");
}

/** Waivers written in the migration: [{ rule, id, reason }]. */
export function waivers(sql) {
  const out = [];
  for (const m of sql.matchAll(/--\s*migration-lint:\s*allow\s+(drop|rename|type)\s+([A-Za-z0-9_."]+)\s+--\s*(\S.*)$/gm)) out.push({ rule: m[1], id: unq(m[2].split(".").pop()), reason: m[3].trim() });
  return out;
}

/** The schema-breaking statements in one migration: [{ rule: drop|rename|type, kind, id, table? }]. */
export function destructive(sql) {
  const s = stripSql(sql);
  const out = [];
  for (const m of s.matchAll(new RegExp(String.raw`\bDROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|TYPE|SEQUENCE)\s+(?:IF\s+EXISTS\s+)?([^;]+?)(?:\s+(?:CASCADE|RESTRICT))?\s*(?:;|$)`, "gi"))) {
    for (const part of m[2].replace(/\([^)]*\)/g, "").split(",")) {
      const name = part.trim().split(".").pop();
      if (name) out.push({ rule: "drop", kind: m[1].toLowerCase().replace(/\s+/g, " "), id: unq(name.trim()) });
    }
  }
  for (const m of s.matchAll(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${QID}\s+([^;]+)`, "gi"))) {
    const table = unq(m[1]), body = m[2];
    for (const d of body.matchAll(new RegExp(String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(${ID})`, "gi"))) out.push({ rule: "drop", kind: "column", id: unq(d[1]), table });
    for (const r of body.matchAll(new RegExp(String.raw`\bRENAME\s+(?:COLUMN\s+)?(${ID})\s+TO\s+(${ID})`, "gi"))) {
      if (/^RENAME\s+TO\b/i.test(r[0])) continue;
      out.push({ rule: "rename", kind: "column", id: unq(r[1]), to: unq(r[2]), table });
    }
    const rt = new RegExp(String.raw`\bRENAME\s+TO\s+(${ID})`, "i").exec(body);
    if (rt) out.push({ rule: "rename", kind: "table", id: table, to: unq(rt[1]) });
    for (const t of body.matchAll(new RegExp(String.raw`\bALTER\s+(?:COLUMN\s+)?(${ID})\s+(?:SET\s+DATA\s+)?TYPE\b`, "gi"))) out.push({ rule: "type", kind: "column", id: unq(t[1]), table });
  }
  return out;
}

/**
 * Findings for a set of new migrations. `uses(id)` says which code trees still name the identifier: a subset of
 * ["base", "head"]. Returns { failures: string[], waived: string[] }.
 */
export function judge(migrations, uses) {
  const failures = [], waived = [];
  for (const { file, sql } of migrations) {
    const w = waivers(sql);
    for (const d of destructive(sql)) {
      const what = `${file}: ${d.rule === "drop" ? "DROP" : d.rule === "rename" ? "RENAME" : "TYPE CHANGE"} ${d.kind} ${d.table ? `${d.table}.` : ""}${d.id}${d.to ? ` -> ${d.to}` : ""}`;
      const ok = w.find((x) => x.rule === d.rule && x.id === d.id);
      if (ok) { waived.push(`${what} (waived: ${ok.reason})`); continue; }
      if (d.rule !== "drop") { failures.push(`${what}: old and new code cannot both run on this schema; expand instead (add, dual-write, backfill, switch, drop later)`); continue; }
      const where = uses(d.id);
      if (where.length) failures.push(`${what}: still named by the code at ${where.join(" and ")}; stop using it in one release and drop it in a later one`);
    }
  }
  return { failures, waived };
}

const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const CODE = ["src", "scripts"];
const EXCLUDE = [":(exclude)scripts/deploy/check-migrations.mjs"];

function codeNames(ref, id) {
  try {
    const args = ref ? ["grep", "-l", "-w", "-F", id, ref, "--", ...CODE, ...EXCLUDE] : ["grep", "-l", "-w", "-F", id, "--", ...CODE, ...EXCLUDE];
    return git(...args).trim().length > 0;
  } catch { return false; } // git grep exits 1 when nothing matches
}

function main(argv) {
  const i = argv.indexOf("--base");
  const base = i >= 0 ? argv[i + 1] : process.env.MIGRATION_BASE;
  if (!base) { console.error("usage: check-migrations.mjs --base <git ref>"); return 2; }
  try { git("rev-parse", "--verify", `${base}^{commit}`); } catch { console.error(`check-migrations: base ${base} is not a commit here (fetch it first: fetch-depth 0)`); return 2; }
  const changed = git("diff", "--name-status", "--no-renames", `${base}...HEAD`, "--", "drizzle/").trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
  const failures = [];
  const added = [];
  for (const [status, file] of changed) {
    if (!/^drizzle\/\d{4}_.*\.sql$/.test(file)) continue;
    if (status === "A") added.push({ file, sql: readFileSync(path.join(ROOT, file), "utf8") });
    else failures.push(`${file}: ${status === "D" ? "deleted" : "edited"} after it was released (base has it); add a new migration instead`);
  }
  const r = judge(added, (id) => [codeNames(base, id) ? "base" : null, codeNames(null, id) ? "head" : null].filter(Boolean));
  failures.push(...r.failures);
  for (const w of r.waived) console.log(`WAIVED  ${w}`);
  for (const f of failures) console.log(`FAIL    ${f}`);
  console.log(`check-migrations: ${added.length} new migration(s) since ${base.slice(0, 12)}; ${failures.length} failure(s), ${r.waived.length} waived`);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
